"""external-online-bidding-v1: external platform workflow and registration ledger."""

import json
import hmac
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

TEXT_FIELDS = ('platform', 'announcement_url', 'registration_end', 'start_at', 'end_at',
               'ended_at', 'end_reason', 'evidence', 'publication_url', 'publication_date',
               'fee_date', 'fee_reference', 'notice_date', 'notice_reference')
BOOL_FIELDS = ('received', 'document_prepared', 'document_confirmed', 'agreement_signed',
               'announcement_done', 'roster_locked', 'verified', 'publication_done',
               'fee_received', 'notice_delivered', 'archive_checked')


def now_local():
    return datetime.now(timezone(timedelta(hours=8))).replace(tzinfo=None)


def timestamp(value):
    try:
        result = datetime.fromisoformat(value)
        if result.tzinfo is not None:
            raise ValueError()
        return result
    except (TypeError, ValueError):
        raise ValueError('请填写有效的北京时间日期和时间') from None


def money(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount <= 0 or amount > Decimal('999999999999.99') or amount != amount.quantize(Decimal('.01')):
            raise ValueError()
        return format(amount, '.2f')
    except (InvalidOperation, ValueError):
        raise ValueError('报价必须为大于零、最多两位小数的金额') from None


def validate(raw, registrations, lot_ids=None):
    if not isinstance(raw, dict):
        raise ValueError('登记信息格式无效')
    data = {}
    data['lot_ids'] = list(lot_ids or [])
    for field in TEXT_FIELDS:
        value = raw.get(field, '')
        if not isinstance(value, str) or len(value) > 2000:
            raise ValueError('登记文字过长或格式无效')
        data[field] = value.strip()
    for field in BOOL_FIELDS:
        value = raw.get(field, False)
        if not isinstance(value, bool):
            raise ValueError('确认状态必须为布尔值')
        data[field] = value
    for field in ('start_at', 'end_at', 'registration_end', 'ended_at', 'publication_date', 'fee_date', 'notice_date'):
        if data[field]:
            timestamp(data[field])
    start, end = data['start_at'], data['end_at']
    if bool(start) != bool(end):
        raise ValueError('竞价开始与截止时间需同时填写')
    if start and timestamp(start) >= timestamp(end):
        raise ValueError('竞价截止时间必须晚于开始时间')
    if start and data['registration_end'] and timestamp(data['registration_end']) > timestamp(start):
        raise ValueError('报名截止时间不得晚于竞价开始时间')
    for field in ('announcement_url', 'publication_url'):
        if data[field] and not re.match(r'^https?://[^\s]+$', data[field], re.I):
            raise ValueError('公告链接必须是 http 或 https 地址')
    lookup = {int(r['id']): r for r in registrations}
    rows = raw.get('records', [])
    if not isinstance(rows, list) or len(rows) > 10000:
        raise ValueError('供应商记录格式无效')
    seen = set()
    records = []
    identities = set()
    for row in rows:
        if not isinstance(row, dict) or type(row.get('registration_id')) is not int:
            raise ValueError('报名记录无效')
        rid = row['registration_id']
        if rid not in lookup or rid in seen:
            raise ValueError('供应商不属于本项目或重复登记')
        seen.add(rid)
        registration = lookup[rid]
        review = row.get('review', 'pending')
        if review not in ('pending', 'supplement', 'approved', 'rejected'):
            raise ValueError('审核状态无效')
        note = row.get('review_note', '')
        if not isinstance(note, str) or len(note) > 2000:
            raise ValueError('审核意见无效')
        if review in ('supplement', 'rejected') and not note.strip():
            raise ValueError('需补正或不通过时必须填写审核原因')
        amount = row.get('amount', '')
        quoted_at = row.get('quoted_at', '')
        if amount not in ('', None):
            amount = money(amount)
            if review != 'approved':
                raise ValueError('仅审核通过的供应商可登记有效报价')
            if not start or not quoted_at or not timestamp(start) <= timestamp(quoted_at) < timestamp(end):
                raise ValueError('平台报价时间必须在竞价时段内（不含截止时刻）')
        else:
            amount = ''
            if quoted_at:
                raise ValueError('填写平台报价时间时必须同时填写金额')
        identity = (registration.get('lot_id'), str(registration['company_name']).strip().casefold())
        if review == 'approved' and identity in identities:
            raise ValueError('同一采购包的供应商重复，请先核对报名记录')
        if review == 'approved':
            identities.add(identity)
        records.append(dict(registration_id=rid, company_name=registration['company_name'],
                            lot_id=registration.get('lot_id'), review=review, review_note=note.strip(),
                            amount=amount, quoted_at=quoted_at))
    data['records'] = records
    resolutions = raw.get('resolutions', [])
    if not isinstance(resolutions, list) or len(resolutions) > 1000:
        raise ValueError('同价处理记录格式无效')
    data['resolutions'] = []
    resolved_lots = set()
    for resolution in resolutions:
        if not isinstance(resolution, dict) or type(resolution.get('registration_id')) is not int:
            raise ValueError('请选择平台确定的同价成交供应商')
        candidates = [r for r in records if r['lot_id'] == resolution.get('lot_id') and r['review'] == 'approved' and r['amount']]
        lowest = min((Decimal(r['amount']) for r in candidates), default=None)
        tied = [r for r in candidates if Decimal(r['amount']) == lowest]
        note = resolution.get('note', '')
        if len(tied) < 2 or resolution['registration_id'] not in [r['registration_id'] for r in tied] or not isinstance(note, str) or not note.strip() or len(note) > 2000 or resolution.get('lot_id') in resolved_lots:
            raise ValueError('同价处理须选择并列最低价供应商，并填写平台处理依据；每包仅一条')
        resolved_lots.add(resolution.get('lot_id'))
        data['resolutions'].append(dict(lot_id=resolution.get('lot_id'), registration_id=resolution['registration_id'], note=note.strip()))
    if lot_ids and any(r['lot_id'] not in lot_ids for r in records):
        raise ValueError('报名记录缺少有效采购包，请先修正所属包')
    if data['roster_locked']:
        if seen != set(lookup) or any(r['review'] in ('pending', 'supplement') for r in records):
            raise ValueError('请处理全部报名审核后确认参竞名单完整')
        if not data['registration_end']:
            raise ValueError('请填写报名截止时间')
        if timestamp(data['registration_end']) > now_local():
            raise ValueError('报名尚未截止，不能确认最终参竞名单')
    if data['verified']:
        if not data['roster_locked'] or not start or not data['ended_at'] or not data['evidence']:
            raise ValueError('核对结果前请确认名单、竞价时段、平台结束时间和结果凭证')
        ended = timestamp(data['ended_at'])
        if ended > now_local():
            raise ValueError('平台结束时间不能晚于当前时间')
        if ended < timestamp(start):
            raise ValueError('平台结束时间不能早于开始时间')
        eligible = [r for r in records if r['review'] == 'approved']
        if data['end_reason'] == 'all_quoted':
            if not eligible or any(not r['amount'] for r in eligible):
                raise ValueError('全部报价结束需要每个合格供应商均有有效报价')
        elif data['end_reason'] == 'deadline':
            if ended < timestamp(end):
                raise ValueError('截止结束时间不得早于竞价截止时间')
        else:
            raise ValueError('请选择平台结束原因')
        if any(r['quoted_at'] and timestamp(r['quoted_at']) > ended for r in records):
            raise ValueError('平台结束时间不能早于最后报价时间')
    if data['document_confirmed'] and not data['document_prepared']:
        raise ValueError('请先确认文件编制完成')
    if data['announcement_done'] and not (data['platform'] and data['announcement_url'] and data['registration_end']):
        raise ValueError('发布完成需要平台、公告链接和报名截止时间')
    if data['publication_done']:
        if not data['verified'] or not data['publication_url'] or not data['publication_date']:
            raise ValueError('公示完成需要已核对的平台结果、公示链接和日期')
        results = summarize(data)['lots']
        if not results or any(not lot['winner'] for lot in results):
            raise ValueError('存在无报价或最低价并列的采购包，请先按平台规则处理异常，不能确认正常成交公示')
    if data['fee_received'] and not (data['fee_date'] and data['fee_reference']):
        raise ValueError('到账记录需要填写到账日期和凭证')
    if data['notice_delivered'] and not (data['fee_received'] and data['notice_date'] and data['notice_reference']):
        raise ValueError('请先确认服务费到账，再登记通知书日期和凭证')
    if data['archive_checked'] and not data['notice_delivered']:
        raise ValueError('请先完成收费及成交通知书')
    return data


def summarize(data, now=None):
    now = now or now_local()
    rows = data.get('records', [])
    eligible = [r for r in rows if r['review'] == 'approved']
    verified = data.get('verified', False)
    start, end = data.get('start_at'), data.get('end_at')
    status = '待设置竞价时段'
    if start and end:
        status = '待开始' if now < timestamp(start) else '报价登记中'
        if now >= timestamp(end) or (eligible and all(r['amount'] for r in eligible)):
            status = '待核对平台结果'
    if verified:
        status = '平台结果已核对'
    lots = []
    for lid in dict.fromkeys([*data.get('lot_ids', []), *(r.get('lot_id') for r in rows)]):
        candidates = [r for r in eligible if r.get('lot_id') == lid and r['amount']]
        candidates.sort(key=lambda r: Decimal(r['amount']))
        lowest = candidates[0]['amount'] if candidates else None
        winners = [r for r in candidates if r['amount'] == lowest]
        resolution = next((r for r in data.get('resolutions', []) if r['lot_id'] == lid), None)
        if len(winners) > 1 and resolution:
            winners = [r for r in winners if r['registration_id'] == resolution['registration_id']]
        lot_status = '待核对' if not verified else '无有效报价，待处理' if not candidates else '最低价并列，待处理' if len(winners) > 1 else '最低价已确认'
        lots.append(dict(lot_id=lid, status=lot_status, amount=lowest,
                         winner=winners[0]['company_name'] if verified and len(winners) == 1 else None,
                         quotes=candidates))
    return dict(status=status, verified=verified, eligible=len(eligible),
                quoted=sum(bool(r['amount']) for r in eligible), lots=lots)


def roster_stale(data, registrations, lot_ids):
    lookup = {r['id']: (r['company_name'], r.get('lot_id')) for r in registrations}
    records = data.get('records', [])
    return (any(lookup.get(r['registration_id']) != (r['company_name'], r.get('lot_id')) for r in records)
            or (data.get('roster_locked') and len(lookup) != len(records))
            or (data.get('verified') and set(data.get('lot_ids', [])) != set(lot_ids)))


def result_error(data, results):
    lots = summarize(data)['lots']
    if len(results) != len(lots):
        return '请按采购包逐一登记成交结果，不能缺少或重复'
    for lot in lots:
        if not lot['winner']:
            return '存在未处理的竞价结果，请先核对平台结果'
        matching = [r for r in results if r.get('lot_id') == lot['lot_id']]
        try:
            valid = len(matching) == 1 and matching[0].get('winning_supplier') == lot['winner'] and money(matching[0].get('winning_amount')) == lot['amount']
        except ValueError:
            valid = False
        if not valid:
            return '成交结果记录与已核对报价不一致，请按采购包登记正确的成交供应商和金额'
    return ''


def notice_error(data, notices):
    lots = summarize(data)['lots']
    for lot in lots:
        matching = [r for r in notices if r.get('lot_id') == lot['lot_id']]
        if not matching or any(r.get('supplier_name') != lot['winner'] for r in matching):
            return '请核对各采购包的通知书领取记录，收件供应商必须与最新成交结果一致'
    if any(r.get('lot_id') not in [lot['lot_id'] for lot in lots] for r in notices):
        return '通知书记录包含不匹配的采购包，请核对'
    return ''


def completion_error(key, data):
    conditions = {
        'announcement': ('announcement_done', '请登记平台发布信息'),
        'registration_end': ('roster_locked', '请完成报名审核并确认参竞名单'),
        'online_quotation': ('verified', '请核对外部平台报价结果'),
        'bid_results': ('verified', '请核对外部平台报价结果'),
        'service_fee': ('fee_received', '请登记服务费到账信息'),
        'result_announced': ('publication_done', '请确认成交结果公示已完成'),
        'online_fee_notice': ('notice_delivered', '请依次完成服务费到账与成交通知书'),
        'archived': ('notice_delivered', '请先完成通知书送达记录'),
    }
    field, error = conditions.get(key, (None, ''))
    return error if field and not data.get(field) else ''


def stage_roles(stage):
    """Use the project snapshot's modules; standard ids support older snapshots."""
    key = getattr(stage, 'stage_key', '')
    if getattr(stage, 'template_removed', False):
        return []
    modules = getattr(stage, 'modules_json', None)
    try:
        modules = json.loads(modules) if isinstance(modules, str) else modules or []
    except (TypeError, ValueError):
        modules = []
    roles = []
    for module, role in [('online_bidding', 'online_quotation'), ('result_publication', 'result_announced'), ('bid_results', 'bid_results'),
                         ('service_fee', 'service_fee'),
                         ('winning_notice', 'online_fee_notice'), ('archive', 'archived'),
                         ('registration', 'registration_end')]:
        if module in modules:
            roles.append(role)
    if key and key not in roles:
        roles.append(key)
    return roles


def resolutions_changed(previous, data):
    """Allow first platform resolution of unresolved lots, protect existing decisions."""
    old = {r['lot_id']: r for r in previous.get('resolutions', [])}
    new = {r['lot_id']: r for r in data.get('resolutions', [])}
    if any(new.get(lid) != resolution for lid, resolution in old.items()):
        return True
    unresolved = {lot['lot_id'] for lot in summarize(previous)['lots'] if lot['status'] == '最低价并列，待处理'}
    return any(lid not in old and lid not in unresolved for lid in new)


def register(app, db, models):
    from flask import jsonify, request, session
    from sqlalchemy import text
    if getattr(app, '_online_bidding_registered', False):
        return
    Project = models['Project']
    login_required = models['login_required']

    def role(project, stage):
        if getattr(stage, 'modules_json', None) is not None:
            return stage_roles(stage)
        # Frozen Stage models predate the SQL-only snapshot metadata columns.
        from sqlalchemy import inspect
        from types import SimpleNamespace
        if inspect(db.engine).has_table('stages'):
            try:
                import stage_templates
            except ModuleNotFoundError:
                from src.backend_patches import stage_templates
            stage_templates.ensure_v5_snapshot_schema(db.session, text)
            row = db.session.execute(text('SELECT modules_json,template_removed FROM stages WHERE project_id=:pid AND stage_key=:key'),
                                     dict(pid=project.id, key=stage.stage_key)).first()
            if row:
                return stage_roles(SimpleNamespace(stage_key=stage.stage_key, modules_json=row[0], template_removed=row[1]))
        return stage_roles(stage)

    def applies(project):
        try:
            from stage_templates import online_bidding_enabled
        except ModuleNotFoundError:
            from src.backend_patches.stage_templates import online_bidding_enabled
        return (project is not None and project.method == '网上竞价'
                and online_bidding_enabled(db.session, text, project.id))

    def schema():
        db.session.execute(text('CREATE TABLE IF NOT EXISTS online_bidding_ledgers (project_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL)'))
        db.session.execute(text('CREATE TABLE IF NOT EXISTS online_bidding_history (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, actor TEXT NOT NULL, recorded_at TEXT NOT NULL, reason TEXT NOT NULL)'))

    def load(pid):
        row = db.session.execute(text('SELECT revision,payload FROM online_bidding_ledgers WHERE project_id=:pid'), dict(pid=pid)).first()
        return (row[0], json.loads(row[1])) if row else (0, {})

    def registrations(project):
        return [dict(id=r.id, company_name=r.company_name, lot_id=r.lot_id) for r in project.registrations]

    @login_required
    def ledger(pid):
        project = db.get_or_404(Project, pid)
        if project.method != '网上竞价':
            return jsonify(error='仅网上竞价项目可使用此登记'), 400
        schema()
        revision, previous = load(pid)
        if request.method == 'PUT':
            expected = str(session.get('csrf_token') or '')
            supplied = str(request.headers.get('X-CSRFToken') or '')
            if not expected or not hmac.compare_digest(expected.encode(), supplied.encode()):
                return jsonify(error='请求已过期，请刷新后重试'), 403
            if getattr(project, 'is_terminated', False):
                return jsonify(error='项目已关闭，不能修改登记'), 409
            raw = request.get_json(silent=True)
            if not isinstance(raw, dict) or type(raw.get('revision')) is not int or raw['revision'] != revision:
                return jsonify(error='记录已更新，请重新打开后编辑'), 409
            reason = raw.get('reason', '')
            if not isinstance(reason, str) or len(reason) > 2000 or (revision and not reason.strip()):
                return jsonify(error='修改已有登记必须填写办理或更正原因'), 400
            try:
                data = validate(raw.get('data'), registrations(project), [lot.id for lot in project.lots])
                if previous.get('verified'):
                    changed = roster_stale(previous, registrations(project), [lot.id for lot in project.lots]) or resolutions_changed(previous, data) or any(previous.get(key) != data.get(key) for key in ('records', 'start_at', 'end_at', 'registration_end', 'ended_at', 'end_reason'))
                    if changed and any(data.get(key) for key in ('verified', 'publication_done', 'notice_delivered')):
                        raise ValueError('已核对的报价或名单发生变更：请先将相关阶段改为待办，取消结果核对及后续确认后保存，再重新核对')
                if applies(project):
                    for stage in project.stages:
                        if stage.stage_key != raw.get('stage_key') and getattr(stage, 'completed', False) and any(completion_error(key, data) for key in role(project, stage)):
                            raise ValueError('对应阶段已完成，请先将该阶段改为待办后更正办理登记')
                if data.get('publication_done'):
                    error = result_error(data, [dict(lot_id=r.lot_id, winning_supplier=r.winning_supplier, winning_amount=r.winning_amount) for r in getattr(project, 'bid_results', [])])
                    if error:
                        raise ValueError(error)
                if data.get('notice_delivered'):
                    error = notice_error(data, [dict(lot_id=r.lot_id, supplier_name=r.supplier_name) for r in getattr(project, 'notice_deliveries', [])])
                    if error:
                        raise ValueError(error)
            except ValueError as error:
                return jsonify(error=str(error)), 400
            payload = json.dumps(data, ensure_ascii=False)
            if revision:
                updated = db.session.execute(text('UPDATE online_bidding_ledgers SET revision=revision+1,payload=:payload WHERE project_id=:pid AND revision=:revision'), dict(payload=payload, pid=pid, revision=revision))
                if updated.rowcount != 1:
                    db.session.rollback()
                    return jsonify(error='记录已更新，请重新打开后编辑'), 409
            else:
                from sqlalchemy.exc import IntegrityError
                try:
                    db.session.execute(text('INSERT INTO online_bidding_ledgers VALUES (:pid,1,:payload)'), dict(pid=pid, payload=payload))
                except IntegrityError:
                    db.session.rollback()
                    return jsonify(error='记录已更新，请重新打开后编辑'), 409
            db.session.execute(text('INSERT INTO online_bidding_history(project_id,revision,payload,actor,recorded_at,reason) VALUES (:pid,:revision,:payload,:actor,:recorded_at,:reason)'), dict(pid=pid, revision=revision+1, payload=payload, actor=str(session.get('username') or session.get('user_id')), recorded_at=now_local().isoformat(timespec='seconds'), reason=reason.strip() or '首次登记'))
            db.session.commit()
            revision, previous = revision+1, data
        history = db.session.execute(text('SELECT revision,actor,recorded_at,reason,payload FROM online_bidding_history WHERE project_id=:pid ORDER BY revision DESC LIMIT 20'), dict(pid=pid)).mappings().all()
        current_regs = registrations(project)
        stale = roster_stale(previous, current_regs, [lot.id for lot in project.lots])
        summary = summarize(previous)
        if stale:
            summary = dict(status='报名资料已变更，请重新核对登记', verified=False, eligible=0, quoted=0, lots=[])
        return jsonify(revision=revision, data=previous, summary=summary, stale=bool(stale), history=[dict(h, payload=json.loads(h['payload'])) for h in history])

    app.add_url_rule('/api/projects/<int:pid>/online-bidding', 'online_bidding_ledger', ledger, methods=['GET', 'PUT'])

    @app.before_request
    def guard_completion():
        business = re.fullmatch(r'/api/projects/(\d+)/(bid-results|notice-deliveries)(?:/(\d+))?', request.path)
        if business and request.method in ('POST', 'PUT') and session.get('user_id'):
            project = db.session.get(Project, int(business[1]))
            if applies(project):
                schema()
                _, stored = load(project.id)
                if not stored.get('verified') or roster_stale(stored, registrations(project), [lot.id for lot in project.lots]):
                    return jsonify(error='请先核对最新平台报价结果'), 400
                body = request.get_json(silent=True) or {}
                if not isinstance(body, dict):
                    return jsonify(error='业务记录格式无效'), 400
                field = 'winning_supplier' if business[2] == 'bid-results' else 'supplier_name'
                collection = getattr(project, 'bid_results' if business[2] == 'bid-results' else 'notice_deliveries', [])
                original = next((r for r in collection if str(r.id) == business[3]), None)
                lot_id = body.get('lot_id', getattr(original, 'lot_id', None))
                try:
                    lot_id = int(lot_id) if lot_id not in ('', None) else None
                except (TypeError, ValueError):
                    return jsonify(error='采购包无效'), 400
                target = next((lot for lot in summarize(stored)['lots'] if lot['lot_id'] == lot_id), None)
                supplier = body.get(field, getattr(original, field, ''))
                if not target or not target['winner'] or supplier != target['winner']:
                    return jsonify(error='供应商必须与该采购包已核对的成交结果一致'), 400
                if business[2] == 'bid-results':
                    try:
                        if money(body.get('winning_amount', getattr(original, 'winning_amount', ''))) != target['amount']:
                            raise ValueError()
                    except ValueError:
                        return jsonify(error='成交金额必须与已核对的最低报价一致'), 400
                elif not stored.get('fee_received') or not stored.get('publication_done'):
                    return jsonify(error='请先完成公示，并在收费阶段保存到账信息，再办理成交通知书'), 400
        if request.method == 'POST' and request.path == '/api/batch/advance-stage' and session.get('user_id'):
            batch = request.get_json(silent=True) or {}
            if isinstance(batch, dict) and isinstance(batch.get('project_ids'), list):
                for pid in batch['project_ids']:
                    if type(pid) is not int and not (isinstance(pid, str) and pid.isdigit()):
                        continue
                    project = db.session.get(Project, int(pid))
                    if applies(project):
                        return jsonify(error='网上竞价项目请逐阶段核对办理记录后完成，不支持批量跳过核对'), 400
        match = re.fullmatch(r'/api/projects/(\d+)/stages/([^/]+)', request.path)
        raw = request.get_json(silent=True) or {}
        if request.method != 'PUT' or not match or not isinstance(raw, dict) or not raw.get('completed'):
            return None
        # Existing authentication remains responsible for rejecting unauthenticated writes.
        if not session.get('user_id'):
            return None
        project = db.session.get(Project, int(match[1]))
        if not project or project.method != '网上竞价':
            return None
        # Only the new explicit workflow opts into strict completion checks.
        if not applies(project):
            return None
        stage = next((s for s in project.stages if s.stage_key == match[2]), None)
        keys = role(project, stage) if stage is not None else [match[2]]
        if keys and all(key in ('plan_received', 'online_documents', 'doc_prepare', 'doc_review', 'doc_finalized', 'agreement_signed') for key in keys):
            return None
        schema()
        _, data = load(project.id)
        try:
            if roster_stale(data, registrations(project), [lot.id for lot in project.lots]):
                raise ValueError('报名资料或采购包已变更，请重新核对竞价登记')
            valid = validate(data, registrations(project), [lot.id for lot in project.lots])
            error = next((completion_error(key, valid) for key in keys if completion_error(key, valid)), '')
            if not error and any(key in ('bid_results', 'result_announced', 'online_fee_notice', 'archived') for key in keys):
                error = result_error(valid, [dict(lot_id=r.lot_id, winning_supplier=r.winning_supplier, winning_amount=r.winning_amount) for r in getattr(project, 'bid_results', [])])
            if not error and any(key in ('online_fee_notice', 'archived') for key in keys):
                error = notice_error(valid, [dict(lot_id=r.lot_id, supplier_name=r.supplier_name) for r in getattr(project, 'notice_deliveries', [])])
        except ValueError as exc:
            error = str(exc)
        if raw.get('skipped'):
            error = '网上竞价核心阶段不能跳过，请登记实际办理情况'
        if error:
            return jsonify(error=error), 400
        return None

    app._online_bidding_registered = True
