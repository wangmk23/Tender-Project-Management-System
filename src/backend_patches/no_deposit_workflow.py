"""Restore only unchanged stages whose automatic skip has recorded provenance."""
from datetime import date
import hashlib
import json
from sqlalchemy import text


def _state(row):
    return hashlib.sha256(json.dumps(dict(row),sort_keys=True,ensure_ascii=False,default=str).encode('utf-8')).hexdigest()


def cleanup_deleted_project(db, pid):
    if db.session.execute(text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='no_deposit_auto_skips'")).first():
        db.session.execute(text('DELETE FROM no_deposit_auto_skips WHERE project_id=:pid'), {'pid': pid})


def apply(db, pid, enabled, *, new_project=False):
    db.session.execute(text('CREATE TABLE IF NOT EXISTS no_deposit_auto_skips(project_id INTEGER,stage_key TEXT,prior_json TEXT,applied_hash TEXT,PRIMARY KEY(project_id,stage_key))'))
    result={'auto_skipped':[],'restored':[],'preserved':[]}
    rows={row['stage_key']:dict(row) for row in db.session.execute(text('SELECT * FROM stages WHERE project_id=:pid'),{'pid':pid}).mappings()}
    if enabled:
        for key,row in rows.items():
            if 'deposit_refund' not in json.loads(row.get('modules_json') or '[]'):
                continue
            if not new_project and (row['completed'] or row['skipped']):
                continue
            prior={name:row.get(name) for name in ('completed','skipped','completed_date','completed_at')}
            if new_project: prior=dict(completed=0,skipped=0,completed_date=None,completed_at=None)
            db.session.execute(text('UPDATE stages SET completed=1,skipped=1,completed_date=:today WHERE project_id=:pid AND stage_key=:key'),dict(today=date.today().isoformat(),pid=pid,key=key))
            updated=db.session.execute(text('SELECT * FROM stages WHERE project_id=:pid AND stage_key=:key'),dict(pid=pid,key=key)).mappings().one()
            db.session.execute(text('INSERT OR REPLACE INTO no_deposit_auto_skips VALUES(:pid,:key,:prior,:hash)'),dict(pid=pid,key=key,prior=json.dumps(prior),hash=_state(updated)))
            result['auto_skipped'].append(key)
    else:
        markers=list(db.session.execute(text('SELECT * FROM no_deposit_auto_skips WHERE project_id=:pid'),{'pid':pid}).mappings())
        for marker in markers:
            key=marker['stage_key'];row=rows.get(key)
            if row is not None and _state(row)==marker['applied_hash']:
                prior=json.loads(marker['prior_json'])
                db.session.execute(text('UPDATE stages SET completed=:completed,skipped=:skipped,completed_date=:completed_date,completed_at=:completed_at WHERE project_id=:pid AND stage_key=:key'),dict(prior,pid=pid,key=key))
                result['restored'].append(key)
            elif row is not None:
                result['preserved'].append(key)
        db.session.execute(text('DELETE FROM no_deposit_auto_skips WHERE project_id=:pid'),{'pid':pid})
    return result
