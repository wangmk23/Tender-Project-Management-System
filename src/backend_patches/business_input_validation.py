"""Pure input validation for preserved compiled business handlers."""


def validate_business_input(endpoint, payload, methods):
    from datetime import date, datetime
    from decimal import Decimal, InvalidOperation

    if not isinstance(payload, dict):
        return "业务数据须为对象"
    labels = {
        'pickup_date': '领取或寄出日期', 'sent_date': '寄出日期', 'invoice_date': '开票日期',
        'submit_date': '收到日期', 'reply_date': '答复日期', 'reply_deadline': '答复截止日期',
        'response_deadline': '回复截止日期', 'deadline': '办理期限', 'publish_date': '发布日期',
        'completed_date': '完成日期', 'event_time': '发生时间', 'original_deadline': '原截止时间',
        'new_deadline': '调整后截止时间', 'planned_at': '计划时间', 'winning_amount': '中标或成交金额',
        'amount': '开票金额', 'budget': '采购包预算', 'number': '项目编号', 'name': '项目名称',
        'no_deposit': '无需投标保证金', 'is_terminated': '项目关闭状态',
        'procurement_archive_sent': '采购人资料移交状态', 'is_shortlisted': '入围状态',
        'required': '必检项状态', 'completed': '完成状态', 'skipped': '跳过状态',
        'force_complete': '强制完成状态', 'affects_deadline': '调整截止时间',
        'applicable': '资料适用状态', 'has_original': '原件状态', 'has_scan': '扫描件状态',
        'transferred': '移交状态', 'needs_statement': '说明材料要求', 'affects_result': '影响采购结果',
        'targets': '质疑对象', 'issues': '质疑事项',
    }
    date_fields = {
        'api_create_notice_delivery': ('pickup_date',),
        'api_update_notice_delivery': ('pickup_date',),
        'api_create_archive_delivery': ('sent_date',),
        'api_update_archive_delivery': ('sent_date',),
        'api_create_service_fee_invoice': ('invoice_date',),
        'api_update_service_fee_invoice': ('invoice_date',),
        'api_create_complaint': ('submit_date', 'reply_date', 'reply_deadline'),
        'api_update_complaint': ('submit_date', 'reply_date', 'reply_deadline'),
        'api_create_complaint_event': ('deadline',),
        'api_update_delete_complaint_event': ('deadline',),
        'api_create_clarification': ('publish_date',),
        'api_update_delete_clarification': ('publish_date',),
        'api_update_stage': ('completed_date',),
        'api_batch_advance_stage': ('completed_date',),
    }
    datetime_fields = {
        'api_create_complaint_event': ('event_time',),
        'api_update_delete_complaint_event': ('event_time',),
        'api_create_clarification': ('original_deadline', 'new_deadline'),
        'api_update_delete_clarification': ('original_deadline', 'new_deadline'),
        'api_update_stage': ('planned_at',),
    }
    amount_fields = {
        'api_create_bid_result': ('winning_amount',),
        'api_update_bid_result': ('winning_amount',),
        'api_create_service_fee_invoice': ('amount',),
        'api_update_service_fee_invoice': ('amount',),
        'api_create_lot': ('budget',),
        'api_update_lot': ('budget',),
    }
    bool_fields = {
        'api_create_project': ('no_deposit',),
        'api_update_project': ('no_deposit', 'is_terminated', 'procurement_archive_sent'),
        'api_create_bid_result': ('is_shortlisted',),
        'api_update_bid_result': ('is_shortlisted',),
        'api_create_stage_checklist_item': ('required',),
        'api_update_delete_stage_checklist_item': ('required', 'completed'),
        'api_create_clarification': ('affects_deadline',),
        'api_update_delete_clarification': ('affects_deadline',),
        'api_update_stage': ('completed', 'skipped', 'force_complete'),
        'api_bulk_update_archive_catalog': ('applicable', 'has_original', 'has_scan', 'transferred'),
        'api_update_delete_archive_catalog_item': ('applicable', 'has_original', 'has_scan', 'transferred'),
    }

    def check_date(data, field, timed=False):
        if field not in data or data[field] is None or data[field] == '':
            return None
        value = data[field]
        if not isinstance(value, str):
            return labels.get(field, field) + "格式不正确"
        try:
            (datetime if timed else date).fromisoformat(value)
        except ValueError:
            return labels.get(field, field) + "格式不正确"
        return None

    def check_bool(data, field):
        if field in data and not isinstance(data[field], bool):
            return labels.get(field, field) + "须为开启或关闭状态"
        return None

    for field in date_fields.get(endpoint, ()):
        error = check_date(payload, field)
        if error:
            return error
    for field in datetime_fields.get(endpoint, ()):
        error = check_date(payload, field, True)
        if error:
            return error
    for field in bool_fields.get(endpoint, ()):
        if endpoint == 'api_bulk_update_archive_catalog' and payload.get(field) is None:
            continue  # Bulk form uses null to mean "keep each item's value".
        error = check_bool(payload, field)
        if error:
            return error

    normalized = {}
    for field in amount_fields.get(endpoint, ()):
        if field not in payload:
            continue
        value = payload[field]
        if value is None or value == '':
            normalized[field] = None
            continue
        if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
            return labels.get(field, field) + "必须为有效的非负金额"
        try:
            amount = Decimal(str(value))
        except (InvalidOperation, ValueError):
            return labels.get(field, field) + "必须为有效的非负金额"
        if not amount.is_finite() or amount < 0:
            return labels.get(field, field) + "必须为有效的非负金额"
        # SQLite Numeric converts to float; reject values that overflow that
        # representation before the original handler can store infinity.
        try:
            if not Decimal(str(float(amount))).is_finite():
                return labels.get(field, field) + "超出可保存范围"
        except (OverflowError, ValueError):
            return labels.get(field, field) + "超出可保存范围"

    if endpoint in ('api_create_project', 'api_update_project'):
        if 'budget' in payload and payload['budget'] is not None:
            value = payload['budget']
            if isinstance(value, bool) or not isinstance(value, (str, int, float)):
                return "项目预算须为文本或数字"
        for field in ('number', 'name'):
            if field in payload and (not isinstance(payload[field], str) or not payload[field].strip()):
                return labels.get(field, field) + "不能为空"
        if 'method' in payload and (not isinstance(payload['method'], str) or payload['method'] not in methods):
            return "采购方式不正确"
        if 'year' in payload:
            value = payload['year']
            if endpoint == 'api_create_project' and (value is None or value == ''):
                normalized['year'] = None
            else:
                valid = isinstance(value, int) and not isinstance(value, bool)
                if isinstance(value, str):
                    valid = bool(value) and len(value) <= 64 and value.isascii() and value.isdecimal() and len(value.lstrip('0')) <= 4
                if not valid or not 1 <= int(value) <= 9999:
                    return "年度须为 1 至 9999 的整数"
                normalized['year'] = int(value)

    if endpoint in ('api_bulk_update_archive_catalog', 'api_update_delete_archive_catalog_item'):
        for field in ('agency_copies', 'purchaser_copies'):
            if field not in payload:
                continue
            value = payload[field]
            if value is None or value == '':
                if endpoint == 'api_bulk_update_archive_catalog':
                    continue
                normalized[field] = 0
                continue
            valid = isinstance(value, int) and not isinstance(value, bool)
            if isinstance(value, str):
                valid = bool(value) and len(value) <= 64 and value.isascii() and value.isdecimal() and len(value.lstrip('0')) <= 19
            if not valid or not 0 <= int(value) <= 9223372036854775807:
                return "留存份数必须为非负整数"
            normalized[field] = int(value)

    if endpoint in ('api_create_complaint', 'api_update_complaint'):
        for field in ('targets', 'issues'):
            if field not in payload:
                continue
            items = payload[field]
            if not isinstance(items, list) or len(items) > 1000:
                return labels.get(field, field) + "须为不超过1000项的列表"
            for item in items:
                if not isinstance(item, dict):
                    return labels.get(field, field) + "记录格式不正确"
                if field == 'targets':
                    error = check_date(item, 'response_deadline') or check_bool(item, 'needs_statement')
                else:
                    error = check_bool(item, 'affects_result')
                if error:
                    return error

    for field, value in normalized.items():
        if field == 'year' and value is None:
            payload.pop(field, None)
        else:
            payload[field] = value
    return None
