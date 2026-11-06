"""local-project-files-v1: Project-local metadata cache and host-admin directory operations.

Source files are opened only for read-only preview or download. Global admission,
license and account hooks remain authoritative and run before these routes.
"""
import hmac
import ipaddress
import os
import re
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from pathlib import Path

from flask import g, jsonify, request, send_file, session
from sqlalchemy import event, select, inspect, text
from sqlalchemy.exc import IntegrityError
try:
    from .local_files_windows import DirectoryIdentity, local_directory, relative_path, validate_name, is_link
    from .local_files_index import empty_scan, scan_directory
    from .account_permissions import request_can
except ImportError:
    from local_files_windows import DirectoryIdentity, local_directory, relative_path, validate_name, is_link
    from local_files_index import empty_scan, scan_directory
    from account_permissions import request_can


PREVIEW_TYPES = {
    '.pdf': ('pdf', 'application/pdf'),
    '.docx': ('word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    '.xlsx': ('excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    '.xls': ('excel', 'application/vnd.ms-excel'),
    '.png': ('image', 'image/png'), '.jpg': ('image', 'image/jpeg'),
    '.jpeg': ('image', 'image/jpeg'), '.gif': ('image', 'image/gif'),
    '.webp': ('image', 'image/webp'), '.bmp': ('image', 'image/bmp'),
    '.txt': ('text', 'text/plain'), '.csv': ('text', 'text/plain'),
    '.mp4': ('video', 'video/mp4'), '.m4v': ('video', 'video/mp4'),
    '.webm': ('video', 'video/webm'), '.ogv': ('video', 'video/ogg'),
    '.mp3': ('audio', 'audio/mpeg'), '.wav': ('audio', 'audio/wav'),
    '.m4a': ('audio', 'audio/mp4'), '.aac': ('audio', 'audio/aac'),
    '.ogg': ('audio', 'audio/ogg'), '.flac': ('audio', 'audio/flac'),
}


class Conflict(Exception):
    pass


def register(runtime, *, choose_folder=None, open_folder=None):
    app,db=runtime.app,runtime.db
    if app.extensions.get('local_project_files'): return True
    lock=threading.RLock(); provider=DirectoryIdentity(); jobs={}; plans={}
    executor=ThreadPoolExecutor(max_workers=2,thread_name_prefix='local-files')

    class Association(db.Model):
        __tablename__='project_local_files'
        project_id=db.Column(db.Integer,db.ForeignKey(runtime.Project.__table__.c.id,ondelete='CASCADE'),primary_key=True)
        revision=db.Column(db.Integer,nullable=False,default=0)
        binding=db.Column(db.String(32),nullable=True)
        path=db.Column(db.Text,nullable=True)
        identity_key=db.Column(db.String(128),unique=True,nullable=True)
        identity=db.Column(db.JSON,nullable=True)
        status=db.Column(db.String(24),default='unlinked')
        scan=db.Column(db.JSON,default=empty_scan)
        cache=db.Column(db.JSON,nullable=True)
        mapping=db.Column(db.JSON,default=dict)
        cache_complete=db.Column(db.Boolean,default=False)
    class Entry(db.Model):
        __tablename__='project_local_file_entries'
        id=db.Column(db.Integer,primary_key=True)
        project_id=db.Column(db.Integer,db.ForeignKey(Association.__table__.c.project_id,ondelete='CASCADE'),index=True,nullable=False)
        binding=db.Column(db.String(32),nullable=False)
        parent=db.Column(db.Text,nullable=False)
        name=db.Column(db.Text,nullable=False)
        path=db.Column(db.Text,nullable=False)
        type=db.Column(db.String(16),nullable=False)
        size=db.Column(db.BigInteger,nullable=False)
        modified=db.Column(db.Float,nullable=False)
    browse_index = db.Index('ix_local_files_folder_listing',
                            Entry.project_id, Entry.binding, Entry.parent, Entry.type, Entry.name)
    with app.app_context():
        Association.__table__.create(db.engine,checkfirst=True)
        Entry.__table__.create(db.engine,checkfirst=True)
        browse_index.create(db.engine,checkfirst=True)
        # A process restart cannot leave a persisted scan reporting active forever.
        for row in db.session.execute(select(Association)).scalars():
            if (row.scan or {}).get('state') in ('queued','scanning'):
                row.scan={**row.scan,'state':'cancelled','complete':False,'finished_at':time.time()}
        db.session.commit()
    app.extensions['local_project_files']=dict(executor=executor,jobs=jobs,plans=plans,Association=Association,Entry=Entry)

    @app.before_request
    def lock_project_deletion():
        if request.method == 'DELETE' and re.fullmatch(r'/api/projects/\d+', request.path):
            lock.acquire()
            g.local_files_delete_lock = True

    @app.teardown_request
    def unlock_project_deletion(_error):
        if g.pop('local_files_delete_lock', False):
            lock.release()

    @event.listens_for(runtime.Project, 'after_delete')
    def clear_deleted_project_files(_mapper, connection, project):
        job = jobs.pop(project.id, None)
        if job:
            job['cancel'].set()
        for token, plan in list(plans.items()):
            if plan['pid'] == project.id:
                plans.pop(token, None)
        connection.execute(Entry.__table__.delete().where(Entry.project_id == project.id))
        connection.execute(Association.__table__.delete().where(Association.project_id == project.id))

    def actor():
        uid=session.get('user_id')
        if not isinstance(uid,int) or isinstance(uid,bool): return None
        return db.session.get(runtime.User,uid,populate_existing=True)
    def host_admin(user):
        try:
            address=ipaddress.ip_address(request.remote_addr or '')
            local=address.is_loopback or bool(getattr(address,'ipv4_mapped',None) and address.ipv4_mapped.is_loopback)
        except ValueError: local=False
        return bool(local and app.config.get('IS_DESKTOP') and user and user.is_active and user.is_admin)
    def can_download(user):
        return bool(user.is_admin or request_can(app, 'export_data'))
    def row_for(pid):
        return db.session.get(Association,pid,populate_existing=True)
    def entries_for(pid, row):
        return db.session.query(Entry).filter_by(project_id=pid, binding=row.binding if row else None)
    def revision(row): return row.revision if row else 0
    def check_revision(row,body):
        value=body.get('expected_revision')
        if type(value) is not int or value!=revision(row): raise Conflict()
    def ensure_row(pid,row):
        if row is None:
            row=Association(project_id=pid,revision=0,scan=empty_scan(),mapping={}); db.session.add(row)
        return row
    def check_identity(row):
        if not row or not row.path: raise ValueError('尚未关联目录')
        path,status=provider.resolve(row.path,row.identity)
        row.status=status
        if status not in ('available','moved'):
            db.session.commit(); raise Conflict()
        row.path=path
        return local_directory(path)
    def stages(project):
        # Stage custom columns are added by earlier runtime patches, not always ORM-mapped.
        if 'stages' in inspect(db.engine).get_table_names():
            columns={c['name'] for c in inspect(db.engine).get_columns('stages')}
            if {'project_id','stage_key'}<=columns:
                selected=[c for c in ('id','stage_key','stage_name','stage_position','template_removed') if c in columns]
                rows=db.session.execute(text('SELECT '+','.join(selected)+' FROM stages WHERE project_id=:pid'),{'pid':project.id}).mappings().all()
                rows=sorted(rows,key=lambda row:(row.get('stage_position') if row.get('stage_position') is not None else row.get('id',0),row.get('id',0)))
                legacy = app.extensions.get('procurement_catalog', {}).get('STAGES', [])
                names = {item.get('key',item.get('id')):item.get('name') for item in legacy}
                return [(s['stage_key'],s.get('stage_name') or names.get(s['stage_key']) or s['stage_key'])
                        for s in rows if not s.get('template_removed')]
        return [(getattr(s,'stage_key',getattr(s,'id',None)),getattr(s,'stage_name',getattr(s,'name','阶段'))) for s in getattr(project,'stages',[])]
    def root_folder_names(pid, row):
        names = entries_for(pid, row).filter_by(parent='', type='directory').with_entities(Entry.name)
        return {name.casefold():name for name, in names}
    def inferred_stage_folder(names, position, stage_name):
        possibilities = {str(stage_name).casefold(), clean_suggestion(f'{position:02d}-{stage_name}').casefold()}
        matches = [names[key] for key in possibilities if key in names]
        return matches[0] if len(matches) == 1 else None
    def state(project,row,user,*,include_stages=True):
        manage=host_admin(user); linked=bool(row and row.path)
        result=dict(project_id=project.id,revision=revision(row),linked=linked,label=Path(row.path).name if linked else '',status=row.status if linked else 'unlinked',capabilities=dict(manage=manage,open=manage and linked and row.status in ('available','moved'),download=can_download(user)),scan=row.scan if row else empty_scan())
        if include_stages:
            summaries=[]
            names = root_folder_names(project.id, row) if linked else {}
            for position,(sid,name) in enumerate(stages(project),1):
                folder=(row.mapping or {}).get(str(sid)) if row else None
                folder = folder or inferred_stage_folder(names, position, name)
                count=0
                if folder:
                    count=entries_for(project.id,row).filter(Entry.type=='file',Entry.path.startswith(folder+'/',autoescape=True)).count()
                summaries.append(dict(stage_id=sid,name=name,folder=folder,count=count,state='unmatched' if not folder else 'unknown' if not row.cache_complete else 'present' if count else 'empty'))
            result['stage_summary'] = summaries
        result['cache'] = row.cache if row else None
        result['binding'] = row.binding if linked else None
        if manage and linked: result['path']=row.path
        return result
    def cancel_job(pid):
        job=jobs.get(pid)
        if job: job['cancel'].set()
    def bind(pid,row,path):
        identity=provider.identify(path); key=identity['volume']+':'+identity['id']
        other=db.session.execute(select(Association).where(Association.identity_key==key,Association.project_id!=pid)).scalar_one_or_none()
        if other: raise Conflict()
        if row and row.identity_key==key:
            row.path=str(path); row.status='available'; return row
        row=ensure_row(pid,row); cancel_job(pid)
        row.revision+=1; row.binding=secrets.token_hex(16); row.path=str(path); row.identity=identity; row.identity_key=key; row.status='available'; row.scan=empty_scan(); row.mapping={}; row.cache_complete=False; row.cache=None
        db.session.query(Entry).filter_by(project_id=pid).delete()
        return row
    def submit_scan(pid,row,*,defer_identity_check=False):
        job=jobs.get(pid)
        if job and job['revision']==row.revision and not job['future'].done(): return row.scan
        expected_path = None if defer_identity_check else check_identity(row)
        rev=row.revision; identity=dict(row.identity); task=secrets.token_urlsafe(18); cancel=threading.Event()
        row.scan={**empty_scan(),'task_id':task,'state':'queued','started_at':time.time()}; db.session.commit()
        def worker():
            with app.app_context():
                try:
                    with lock:
                        current=row_for(pid)
                        if not current or current.revision!=rev or current.scan.get('task_id')!=task: return
                        path=check_identity(current)
                        if expected_path is not None and path != expected_path:
                            current.scan={**current.scan,'state':'error','complete':False,'errors':[{'path':'','code':'IDENTITY_CHANGED'}]}; db.session.commit(); return
                        current.scan={**current.scan,'state':'scanning'}; db.session.commit()
                    entries,scan=scan_directory(path,cancel,directory_reader=lambda directory:
                        provider.read_directory(directory,root=path,identity=identity))
                    scan['task_id']=task
                    with lock:
                        current=row_for(pid)
                        if (not current or current.revision!=rev or current.scan.get('task_id')!=task
                                or not current.path or not db.session.get(runtime.Project,pid)):
                            return
                        _,status=provider.resolve(str(path),identity)
                        if status not in ('available','moved'):
                            scan.update(state='error',complete=False,errors=[{'path':'','code':'IDENTITY_CHANGED'}])
                        elif cancel.is_set():
                            scan.update(state='cancelled',complete=False)
                        current.status=status; current.scan=scan
                        if scan['state']=='complete' or (scan['state']=='partial' and not current.cache_complete):
                            db.session.query(Entry).filter_by(project_id=pid).delete()
                            # bounded inserts keep SQLite parameter counts below platform limits.
                            for i in range(0,len(entries),500):
                                db.session.execute(Entry.__table__.insert(),[dict(project_id=pid,binding=current.binding,**e) for e in entries[i:i+500]])
                            current.cache_complete=scan['complete']
                            current.cache = {key:scan[key] for key in ('files','folders','bytes','complete','finished_at')}
                        db.session.commit()
                except Exception as error:
                    db.session.rollback()
                    with lock:
                        current=row_for(pid)
                        if current and current.revision==rev and current.scan.get('task_id')==task:
                            code = 'IDENTITY_CHANGED' if isinstance(error, Conflict) else 'SCAN_FAILED'
                            current.scan={**current.scan,'state':'error','complete':False,'errors':[{'path':'','code':code}],'finished_at':time.time()}; db.session.commit()
                finally: db.session.remove()
        jobs[pid]=dict(revision=rev,task_id=task,cancel=cancel,future=executor.submit(worker))
        return row.scan
    def browser_scan(pid, row, mode):
        scan = row.scan or empty_scan()
        initial = scan['state'] == 'idle'
        refresh = mode == 'refresh' and time.time() - (scan.get('started_at') or 0) >= 30
        if not (initial or refresh) or scan['state'] in ('queued', 'scanning'):
            return scan
        # Bound opportunistic work and defer disk access to the same guarded scanner.
        if sum(not job['future'].done() for job in jobs.values()) >= 8:
            return scan
        return submit_scan(pid, row, defer_identity_check=True)

    def folder_status(root,name):
        p=root/name
        if not os.path.lexists(p): return 'new'
        return 'existing' if p.is_dir() and not is_link(p) else 'conflict'
    def clean_suggestion(value):
        value=re.sub(r'[<>:"/\\|?*\x00-\x1f]','_',str(value)).strip().rstrip('. ')[:180] or '项目'
        try: return validate_name(value)
        except ValueError: return '_'+value

    def content(pid, row, user):
        relative = relative_path(request.args.get('path', ''))
        mode = request.args.get('mode')
        if not relative or mode not in ('preview', 'download'):
            raise ValueError('文件请求无效')
        if mode == 'download' and not can_download(user):
            return jsonify(error='当前账号没有下载权限', code='PERMISSION_DENIED'), 403
        if not row or not row.path:
            return jsonify(error='项目尚未关联目录'), 404
        if (request.args.get('revision', type=int) != row.revision
                or request.args.get('binding') != row.binding):
            raise Conflict()
        entry = entries_for(pid,row).filter_by(path=relative, type='file').first()
        if entry is None:
            return jsonify(error='文件不在当前项目的扫描结果中'), 404
        preview = PREVIEW_TYPES.get(Path(entry.name).suffix.lower())
        if mode == 'preview' and preview is None:
            return jsonify(error='此格式暂不支持在线预览'), 415
        root, status = provider.resolve(row.path, row.identity)
        if status not in ('available', 'moved'):
            raise Conflict()
        stream = provider.open_content(root, relative, row.identity)
        try:
            stat = os.fstat(stream.fileno())
            response = send_file(stream, download_name=entry.name,
                                 as_attachment=mode == 'download',
                                 mimetype=preview[1] if mode == 'preview' else 'application/octet-stream',
                                 conditional=False, etag=False, last_modified=stat.st_mtime)
            response.content_length = stat.st_size
            response.make_conditional(request.environ, accept_ranges=True, complete_length=stat.st_size)
            response.headers['Cache-Control'] = 'private, no-store'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['Content-Security-Policy'] = "sandbox; default-src 'none'"
            response.call_on_close(stream.close)
            return response
        except BaseException:
            stream.close()
            raise

    def dispatch(pid,action):
        user=actor()
        if not user or not user.is_active: return jsonify(error='请先登录有效账号',code='PERMISSION_DENIED'),403
        write=request.method not in ('GET', 'HEAD')
        if write:
            if not host_admin(user): return jsonify(error='请在主机客户端使用管理员账号',code='PERMISSION_DENIED'),403
            expected=session.get('csrf_token'); supplied=request.headers.get('X-CSRFToken') or request.headers.get('X-CSRF-Token')
            if not isinstance(expected,str) or not supplied or not hmac.compare_digest(expected,supplied): return jsonify(error='页面安全令牌已失效',code='csrf_required'),400
        body=request.get_json(silent=True) if write else {}
        if not isinstance(body,dict): return jsonify(error='请求格式无效'),400
        index_mode = request.args.get('index') if action == 'entries' and request.method == 'GET' else None
        index_requested = index_mode in ('initial', 'refresh')
        with lock if write or action == 'content' or index_requested else nullcontext():
            try:
                project=db.session.get(runtime.Project,pid,populate_existing=True)
                if not project: return jsonify(error='项目不存在'),404
                access = app.extensions.get('deadline_project_access')
                if access and not access(user, project):
                    return jsonify(error='无权访问此项目',code='PERMISSION_DENIED'),403
                row=row_for(pid)
                # Successful replay is keyed to the original project and resulting revision.
                token=body.get('plan_token'); plan=plans.get(token) if isinstance(token,str) else None
                if action=='directories' and plan and plan.get('result') and plan['pid']==pid and revision(row)==plan['result']['state']['revision'] and body.get('expected_revision')==plan['revision'] and time.monotonic()<plan['expires']:
                    return jsonify(plan['result'])
                if write and action!='choose': check_revision(row,body)
                if action=='state': return jsonify(state(project,row,user,include_stages=request.args.get('view') != 'browser'))
                if action=='content': return content(pid,row,user)
                if action=='choose':
                    if not callable(choose_folder): return jsonify(error='原生选择器不可用'),503
                    chosen=choose_folder()
                    if isinstance(chosen,(tuple,list)): chosen=chosen[0] if chosen else None
                    return jsonify(path=str(local_directory(chosen))) if chosen else jsonify(cancelled=True)
                if action=='association':
                    if request.method=='DELETE':
                        row=ensure_row(pid,row); cancel_job(pid); row.revision+=1; row.binding=None; row.path=None; row.identity=None; row.identity_key=None; row.mapping={}; row.status='unlinked'; row.scan=empty_scan(); row.cache_complete=False; row.cache=None
                        db.session.query(Entry).filter_by(project_id=pid).delete()
                    else: row=bind(pid,row,local_directory(body.get('path')))
                    db.session.commit(); return jsonify(state(project,row,user))
                if action=='entries':
                    parent=relative_path(request.args.get('parent','')); q=request.args.get('q','')[:256]
                    offset=max(0,int(request.args.get('offset',0))); limit=min(100,max(1,int(request.args.get('limit',100))))
                    query=entries_for(pid,row)
                    query=query.filter(Entry.name.contains(q,autoescape=True)) if q else query.filter_by(parent=parent)
                    total=query.count(); items=[]
                    for entry in query.order_by(Entry.type,Entry.name,Entry.id).offset(offset).limit(limit):
                        item = {k:getattr(entry,k) for k in ('name','path','type','size','modified')}
                        if entry.type == 'file':
                            item['preview_kind'] = PREVIEW_TYPES.get(Path(entry.name).suffix.lower(), ('', ''))[0]
                        items.append(item)
                    result = dict(revision=revision(row), binding=row.binding if row else None,
                                  items=items, total=total, has_more=offset+len(items)<total)
                    if index_requested and row and row.path:
                        result['scan'] = browser_scan(pid, row, index_mode)
                    return jsonify(result)
                if action=='scan':
                    if not write: return jsonify(scan=row.scan if row else empty_scan())
                    if not row or not row.path: raise ValueError()
                    return jsonify(scan=submit_scan(pid,row)),202
                if action=='cancel':
                    job=jobs.get(pid)
                    if not job or job['task_id']!=body.get('task_id') or job['revision']!=revision(row): raise Conflict()
                    job['cancel'].set(); return jsonify(scan=row.scan)
                if action=='open':
                    root=check_identity(row); rel=relative_path(body.get('relative_path',''))
                    if rel and not entries_for(pid,row).filter_by(path=rel,type='directory').first(): raise ValueError()
                    target=local_directory(root/rel)
                    if not callable(open_folder): return jsonify(error='主机目录打开器不可用'),503
                    with provider.pin_directory(target,root=root,identity=row.identity):
                        open_folder(str(target))
                    db.session.commit(); return jsonify(message='已打开文件夹')
                if action=='template':
                    root=Path(row.path) if row and row.path else None
                    # Cached metadata only: remote reads never probe host directories.
                    folders=[]
                    names = root_folder_names(pid, row) if root else {}
                    for i,(sid,name) in enumerate(stages(project),1):
                        suggested=(row.mapping or {}).get(str(sid)) if row else None
                        suggested=suggested or inferred_stage_folder(names, i, name) or clean_suggestion(f'{i:02d}-{name}')
                        item=entries_for(pid,row).filter_by(path=suggested).first() if root else None
                        folders.append(dict(stage_id=sid,name=suggested,status='existing' if item and item.type=='directory' else 'conflict' if item else 'new'))
                    number = getattr(project, 'number', '') or getattr(project, 'project_number', '')
                    return jsonify(revision=revision(row),root_name=root.name if root else clean_suggestion(f"{number}-{getattr(project,'name','项目')}".strip('-')),folders=folders)
                if action=='preview':
                    linked=bool(row and row.path)
                    if linked:
                        if body.get('parent_path'): raise ValueError()
                        root=check_identity(row); anchor=root; root_name=root.name
                    else:
                        anchor=local_directory(body.get('parent_path')); root_name=validate_name(body.get('root_name')); root=anchor/root_name
                        if os.path.lexists(root): raise Conflict()
                    folders=body.get('folders')
                    if not isinstance(folders,list) or len(folders)>200: raise ValueError()
                    parsed=[]; names=set(); stage_ids=set()
                    allowed={str(sid) for sid,_ in stages(project)}
                    for item in folders:
                        if not isinstance(item,dict): raise ValueError()
                        name=validate_name(item.get('name')); sid=item.get('stage_id')
                        if sid is not None and str(sid) not in allowed: raise ValueError()
                        if name.casefold() in names or (sid is not None and str(sid) in stage_ids): raise ValueError()
                        names.add(name.casefold()); stage_ids.add(str(sid))
                        parsed.append(dict(stage_id=sid,name=name,status=folder_status(root,name) if linked else 'new'))
                    now=time.monotonic()
                    for key in list(plans):
                        if plans[key]['expires']<=now: del plans[key]
                    if len(plans)>=256: raise ValueError('预览数量过多')
                    token=secrets.token_urlsafe(32)
                    plans[token]=dict(pid=pid,revision=revision(row),binding=row.binding if row else None,linked=linked,anchor=str(anchor),identity=provider.identify(anchor),root_name=root_name,folders=parsed,expires=now+300)
                    db.session.commit(); return jsonify(plan_token=token,root_name=root_name,folders=parsed,expires_in=300)
                if action=='directories':
                    if (not plan or plan['pid']!=pid or plan['revision']!=revision(row)
                            or plan['binding']!=(row.binding if row else None) or time.monotonic()>=plan['expires']):
                        raise Conflict()
                    anchor,status=provider.resolve(plan['anchor'],plan['identity'])
                    if status!='available': raise Conflict()
                    anchor=local_directory(anchor); root=anchor if plan['linked'] else anchor/plan['root_name']
                    if plan['linked']:
                        if check_identity(row)!=root: raise Conflict()
                    elif os.path.lexists(root): raise Conflict()
                    statuses=[folder_status(root,item['name']) for item in plan['folders']]
                    if 'conflict' in statuses: raise Conflict()
                    # Consume before touching disk. Partial OS failure must require fresh preview.
                    del plans[token]
                    created=[]; existing=[]
                    with provider.pin_directory(anchor,root=anchor,identity=plan['identity']) as anchor_handle:
                        root_context = nullcontext(anchor_handle) if plan['linked'] else provider.create_child_directory(
                            anchor_handle,anchor,plan['root_name'])
                        with root_context as root_handle:
                            for item in plan['folders']:
                                name=item['name']; status=folder_status(root,name)
                                if status=='conflict': raise Conflict()
                                if status=='existing': existing.append(name)
                                else:
                                    with provider.create_child_directory(root_handle,root,name):
                                        created.append(name)
                            row=bind(pid,row,root)
                    mapping=dict(row.mapping or {})
                    for item in plan['folders']:
                        if item['stage_id'] is not None: mapping[str(item['stage_id'])]=item['name']
                    if mapping!=row.mapping:
                        if (row.scan or {}).get('state') in ('queued', 'scanning'):
                            cancel_job(pid)
                            row.scan = {**row.scan, 'state':'cancelled', 'complete':False, 'finished_at':time.time()}
                        row.mapping=mapping; row.revision+=1
                    db.session.commit()
                    result=dict(created=created,existing=existing,state=state(project,row,user)); plan['result']=result; plans[token]=plan
                    return jsonify(result)
                raise ValueError()
            except (Conflict,IntegrityError):
                db.session.rollback(); return jsonify(error='目录或关联已变化，请刷新后重新确认',code='LOCAL_FILES_CONFLICT'),409
            except (OSError,ValueError,TypeError):
                db.session.rollback(); return jsonify(error='目录不可用或请求无效；原有资料未修改',code='LOCAL_FILES_INVALID'),400
    routes=[('', 'state',['GET']),('/association','association',['PUT','DELETE']),('/choose','choose',['POST']),('/entries','entries',['GET']),('/content','content',['GET']),('/scan','scan',['GET','POST']),('/scan/cancel','cancel',['POST']),('/open','open',['POST']),('/template','template',['GET']),('/preview','preview',['POST']),('/directories','directories',['POST'])]
    for suffix,action,methods in routes:
        app.add_url_rule('/api/projects/<int:pid>/local-files'+suffix,'local_files_'+action,lambda pid,action=action:dispatch(pid,action),methods=methods)
    return True
