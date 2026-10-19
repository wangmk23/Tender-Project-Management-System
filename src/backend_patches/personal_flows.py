"""personal-flows-v1: opt-in local defaults migration; never touch project history."""
from __future__ import annotations
import json

# Only the explicit compatible personal build enables initial activation.
BUNDLED_PERSONAL_FLOWS = False


def activate(database):
    if not BUNDLED_PERSONAL_FLOWS:
        return
    if __package__:from . import procurement_catalog as c
    else:import procurement_catalog as c
    c._lock(database)
    if c.personal_profile(database):
        return
    cat=c.load_catalog(database)
    edited=set()
    for scope,raw in c._sql(database,"SELECT scope,payload_json FROM procurement_config_audit WHERE action='method_update'"):
        row=json.loads(raw);before=row.get('before') or {};after=row.get('after') or {}
        if (before.get('template_mode'),before.get('stages')) != (after.get('template_mode'),after.get('stages')):
            edited.add(scope)
    grouped={}
    for m in cat['methods']:grouped.setdefault(m['name'],[]).append(m)
    visible=set();issues=[];updated=[]
    for name,rows in grouped.items():
        sources=[m for m in rows if m['regime'] is None or not m.get('reference_preset') or m['id'] in edited]
        if not sources:continue
        signatures={c._json(c.method_stages(database,m)) for m in sources}
        if len(signatures)>1:
            visible.update(m['id'] for m in sources)
            issues.append(dict(name=name,reason='保存了不同的自定义流程，已保留，请选择所需流程后编辑'))
            continue
        source=next((m for m in sources if m['regime'] is None),sources[0]);visible.add(source['id'])
        try:flow=c.normalize_stages(c.method_stages(database,source))
        except c.CatalogError:
            issues.append(dict(name=name,reason='原流程校验未通过，已保留，请编辑核对'));continue
        for target in rows:
            if target['id']==source['id'] or c.method_stages(database,target)==flow:continue
            try:c._validate_guarantee_anchors(c.guarantee_defaults(database,target['id']),flow)
            except c.CatalogError:
                issues.append(dict(name=name,reason='其他同名方式的保证金起算阶段与原流程不兼容，已保留该项'));continue
            c._sql(database,"UPDATE procurement_methods SET template_mode='independent',stages=:s,revision=revision+1,updated_at=:t WHERE id=:id",dict(s=c._json(flow),t=c._now(),id=target['id']))
            updated.append(dict(source_id=source['id'],target_id=target['id']))
    profile=dict(active=True,visible_method_ids=sorted(visible),hidden_method_ids=[m['id'] for m in cat['methods'] if m['id'] not in visible],issues=issues,updated=updated)
    c._sql(database,'CREATE TABLE IF NOT EXISTS personal_flow_profiles(id INTEGER PRIMARY KEY CHECK(id=1),profile_json TEXT NOT NULL,before_json TEXT NOT NULL,created_at TEXT NOT NULL)')
    c._sql(database,'INSERT INTO personal_flow_profiles VALUES(1,:p,:b,:t)',dict(p=c._json(profile),b=c._json(cat['methods']),t=c._now()))
    c._bump(database);c._audit(database,'personal_flow_activation','catalog',profile,'personal_upgrade')
