"""project-record-versions-v1: snapshot tokens under the caller's SQLite transaction."""
from __future__ import annotations

import hashlib
import json
import re
from flask import g, has_request_context, jsonify, request, session
from sqlalchemy import event, text
from sqlalchemy.exc import SQLAlchemyError

_PROJECT = re.compile(r'^/api/projects/(\d+)/?$')
_STAGE = re.compile(r'^/api/projects/(\d+)/stages/([^/]+)/?$')


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
        separators=(',', ':'), default=str).encode('utf-8')).hexdigest()


def snapshots(db, identities):
    """Read in bounded batches; never issue one query for each sidebar row."""
    projects, stages = {}, {}
    identities = list(dict.fromkeys(int(identity) for identity in identities))
    for offset in range(0, len(identities), 400):
        chunk = identities[offset:offset + 400]
        params = {f'p{i}': value for i, value in enumerate(chunk)}
        placeholders = ','.join(':' + key for key in params)
        for row in db.session.execute(text(f'SELECT * FROM projects WHERE id IN ({placeholders})'), params).mappings():
            projects[row['id']] = dict(row)
        for row in db.session.execute(text(f'SELECT * FROM stages WHERE project_id IN ({placeholders}) ORDER BY id'), params).mappings():
            stages.setdefault(row['project_id'], []).append(dict(row))
    return {pid: dict(project=_digest([project, stages.get(pid, [])]),
        stages={row['stage_key']: _digest(row) for row in stages.get(pid, [])}) for pid, project in projects.items()}


def register(app, db, models, authorize):
    if app.extensions.get('project_record_versions'):
        return
    with app.app_context():
        db.session.execute(text('CREATE TABLE IF NOT EXISTS project_record_version_lock(id INTEGER PRIMARY KEY)'))
        db.session.execute(text('INSERT OR IGNORE INTO project_record_version_lock(id) VALUES(1)'))
        db.session.commit()
    app.extensions['project_record_versions'] = True

    def capture_committed_snapshot(unit):
        if not has_request_context() or hasattr(g, 'committed_record_snapshots'):
            return
        identities = getattr(g, 'record_version_write_ids', None)
        if not identities and getattr(g, 'record_version_creating', False) and models.get('Project'):
            unit.flush()
            identities = [row.id for row in unit.identity_map.values() if isinstance(row, models['Project'])]
        if not identities:return
        unit.flush()
        # Never attach a later writer's token to an earlier writer's payload.
        g.committed_record_snapshots = snapshots(db, identities)
    event.listen(db.session.session_factory, 'before_commit', capture_committed_snapshot)

    @app.before_request
    def protect_project_snapshot():
        path, method = request.path, request.method
        if path == '/api/projects' and method == 'POST':
            g.record_version_creating = True
            return None
        project_match, stage_match = _PROJECT.fullmatch(path), _STAGE.fullmatch(path)
        reading = method == 'GET' and (path == '/api/projects' or project_match)
        batch = method == 'POST' and path == '/api/batch/advance-stage'
        writing = (project_match and method in {'PUT', 'PATCH', 'DELETE'}) or (stage_match and method in {'PUT', 'PATCH'}) or batch
        if not reading and not writing:
            return None
        try:
            connection = db.session.connection()
            raw = connection.connection.driver_connection
            if reading:
                # Payload and its physical-row token must describe one snapshot.
                if connection.dialect.name == 'sqlite' and not raw.in_transaction:
                    connection.exec_driver_sql('BEGIN')
                return None
            data = request.get_json(silent=True)
            if not isinstance(data, dict):
                return None
            ids = data.get('project_ids') if batch else [int((project_match or stage_match)[1])]
            if not isinstance(ids, list) or not ids or any(isinstance(pid, bool) or not str(pid).isascii() or not str(pid).isdigit() for pid in ids):
                return None  # existing handler provides the input error
            ids = [int(pid) for pid in ids]
            for pid in ids:
                _, denied = authorize(models, write=True, pid=pid)
                if denied:
                    return denied
            if method == 'DELETE':
                User = models.get('User')
                user = db.session.get(User, session.get('user_id')) if User else None
                admin = bool(getattr(user, 'is_admin', False)) if User else bool(session.get('is_admin'))
                if not admin:
                    return None  # original admin_required remains authoritative
            # Serialize compare + mutation even if a preceding hook began a read transaction.
            db.session.execute(text('UPDATE project_record_version_lock SET id=id WHERE id=1'))
            db.session.expire_all()
            g.record_version_write_ids = ids
            current = snapshots(db, ids)
            g.record_version_bases = {pid: item['project'] for pid, item in current.items()}
            conflicts = []
            for pid in ids:
                if pid not in current:
                    continue
                if batch:
                    supplied = (data.get('record_versions') or {}).get(str(pid)) if isinstance(data.get('record_versions'), dict) else None
                    actual = current[pid]['stages'].get(data.get('stage_key'))
                elif stage_match:
                    supplied, actual = data.get('record_version'), current[pid]['stages'].get(stage_match[2])
                else:
                    supplied, actual = data.get('record_version'), current[pid]['project']
                # Older clients remain compatible; their writes invalidate newer snapshots.
                if supplied is not None and supplied != actual:
                    conflicts.append(pid)
            if conflicts:
                db.session.rollback()
                return jsonify(error='内容已被其他操作更新，请重新加载最新内容并保留草稿核对',
                    code='RECORD_VERSION_CONFLICT', projects=conflicts), 409
        except SQLAlchemyError:
            db.session.rollback()
            return jsonify(error='暂时无法确认最新记录，原修改未提交，请重新读取后重试', code='RECORD_VERSION_UNAVAILABLE'), 503
        return None

    @app.after_request
    def expose_project_snapshot(response):
        if response.status_code >= 400 or not response.is_json:
            return response
        project_match, stage_match = _PROJECT.fullmatch(request.path), _STAGE.fullmatch(request.path)
        if not ((request.path == '/api/projects' and request.method in {'GET','POST'}) or project_match or stage_match):
            return response
        payload = response.get_json()
        rows = payload if isinstance(payload, list) else [payload]
        rows = [row for row in rows if isinstance(row, dict) and isinstance(row.get('id'), int)]
        current = (snapshots(db, [row['id'] for row in rows]) if request.method == 'GET'
            else getattr(g, 'committed_record_snapshots', {}))
        for row in rows:
            version = current.get(row['id'])
            if not version:
                continue
            row['record_version'] = version['project']
            base = getattr(g, 'record_version_bases', {}).get(row['id'])
            if base is not None:row['record_version_base'] = base
            for stage in row.get('stages') or []:
                key = stage.get('key') or stage.get('stage_key')
                if key in version['stages']:
                    stage['record_version'] = version['stages'][key]
        response.set_data(app.json.dumps(payload))
        return response
