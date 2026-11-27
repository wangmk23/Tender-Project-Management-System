"""Application models built from the declared schema, with explicit relationships.

The schema mirror is an inventory, not a runnable ORM. Each factory owns its
metadata and mappers; no model instances or sessions are shared between apps.
"""
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Column, ForeignKey, Table, UniqueConstraint, text
from sqlalchemy.orm import relationship
from src.backend_patches import schema_models


def scalar_payload(instance):
    result = {}
    for column in instance.__table__.columns:
        value = getattr(instance, column.name)
        if isinstance(value, (date, datetime)):
            value = value.isoformat()
        elif isinstance(value, Decimal):
            value = float(value)
        result[column.name] = value
    return result


def build_models(db):
    models = {}
    core_tables = set(schema_models.CORE_ORM_TABLE_MAP.values())
    for name, table_name in schema_models.CORE_ORM_TABLE_MAP.items():
        spec = schema_models.TABLE_SPECS[table_name]
        columns = []
        for col in spec['columns']:
            key, typ = col['name'], col['type']
            foreign = [ForeignKey(f"{f['table']}.{f['to']}") for f in spec['foreign_keys'] if f['from'] == key and f['table'] in core_tables]
            options = dict(primary_key=col['pk'], nullable=not col['notnull'] and not col['pk'])
            if not col['pk']:
                if col.get('default') is not None:
                    raw = col['default']
                    options['server_default'] = text(raw)
                    options['default'] = int(raw) if raw.lstrip('-').isdigit() else raw.strip("'")
                elif typ == 'BOOLEAN':
                    options['default'] = key in ('is_active', 'applicable', 'required')
                elif key == 'created_at' or key == 'uploaded_at':
                    options['default'] = datetime.now
                elif typ.startswith(('TEXT', 'VARCHAR')):
                    options['default'] = ''
            columns.append(Column(key, schema_models._sqlalchemy_type(typ), *foreign, **options))
        unique = [UniqueConstraint(*idx['columns']) for idx in spec.get('indexes', []) if idx.get('unique') and idx['columns']]
        table = Table(table_name, db.metadata, *columns, *unique)
        models[name] = type(name, (db.Model,), {'__table__': table, 'to_dict': scalar_payload})

    def link(parent, child, collection, fk, reverse, *, dynamic=False):
        p, c = models[parent], models[child]
        setattr(p, collection, relationship(c, foreign_keys=[getattr(c, fk)], back_populates=reverse,
            cascade='all, delete-orphan', lazy='dynamic' if dynamic else 'select', order_by=c.id))
        setattr(c, reverse, relationship(p, foreign_keys=[getattr(c, fk)], back_populates=collection))

    collections = {
        'Stage': 'stages', 'ProjectLot': 'lots', 'SupplierRegistration': 'registrations',
        'BidResult': 'bid_results', 'NoticeDelivery': 'notice_deliveries',
        'ServiceFeeInvoice': 'service_fee_invoices', 'ArchiveDelivery': 'archive_deliveries',
        'Complaint': 'complaints', 'AnnouncementClarification': 'clarifications',
        'ArchiveCatalogItem': 'archive_catalog_items', 'StageChecklistItem': 'stage_checklist_items',
        'Attachment': 'attachments',
    }
    for child, collection in collections.items():
        link('Project', child, collection, 'project_id', 'project', dynamic=child == 'Attachment')
    for child in ('SupplierRegistration', 'BidResult', 'NoticeDelivery', 'ServiceFeeInvoice', 'Complaint', 'ComplaintTarget', 'ComplaintIssue', 'AnnouncementClarification'):
        c = models[child]
        c.lot = relationship(models['ProjectLot'], foreign_keys=[c.lot_id])
    for child, collection in [('ComplaintEvent','events'),('ComplaintTarget','targets'),('ComplaintIssue','issues')]:
        link('Complaint', child, collection, 'complaint_id', 'complaint')
    for parent, fk, reverse in [('SupplierRegistration','registration_id','registration'), ('Complaint','complaint_id','complaint'), ('ComplaintEvent','complaint_event_id','complaint_event'), ('AnnouncementClarification','clarification_id','clarification')]:
        # Attachments also belong to their project, so related collections do not
        # own their lifecycle; existing route handlers perform explicit deletion.
        p, a = models[parent], models['Attachment']
        setattr(p, 'attachments', relationship(a, foreign_keys=[getattr(a, fk)], back_populates=reverse))
        setattr(a, reverse, relationship(p, foreign_keys=[getattr(a, fk)], back_populates='attachments'))

    def stage_payload(stage):
        result = scalar_payload(stage)
        result.update(key=stage.stage_key, name=stage.stage_name, icon=stage.stage_icon)
        return result
    models['Stage'].to_dict = stage_payload

    Project = models['Project']
    def active_stages(project):
        return sorted((s for s in project.stages if not s.template_removed), key=lambda s: (s.stage_position if s.stage_position is not None else s.id or 0))
    def summary(project):
        result = scalar_payload(project)
        stages = active_stages(project)
        pending = next((s for s in stages if not s.completed and not s.skipped), None)
        result.update(stages=[s.to_dict() for s in stages], progress=project.progress,
            current_stage_key=pending.stage_key if pending else '',
            current_stage_name=(pending.stage_name or pending.stage_key) if pending else '已完成',
            lots=[x.to_dict() for x in project.lots], registration_count=len(project.registrations))
        return result
    def detail(project):
        result = summary(project)
        for child, collection in collections.items():
            if collection in ('stages','lots','attachments'):
                continue
            result[collection] = [x.to_dict() for x in getattr(project, collection)]
        result['attachments'] = [x.to_dict() for x in project.attachments]
        return result
    Project.progress = property(lambda p: round(sum(bool(s.completed or s.skipped) for s in active_stages(p)) / len(active_stages(p)) * 100) if active_stages(p) else 0)
    Project.current_stage_key = property(lambda p: next((s.stage_key for s in active_stages(p) if not s.completed and not s.skipped), ''))
    Project.to_summary_dict = summary
    Project.to_dict = detail
    def ensure_stages(project):
        from flask import current_app
        definitions = current_app.extensions['runtime_context']['STAGES']
        existing = {s.stage_key for s in project.stages}
        for position, definition in enumerate(definitions):
            if definition['key'] not in existing:
                project.stages.append(models['Stage'](stage_key=definition['key'],
                    stage_name=definition['name'], stage_icon=definition['icon'], stage_position=position))
    Project.ensure_stages = ensure_stages
    # Business defaults are created by procurement_catalog at project creation;
    # reading an existing project must not rewrite its historical workflow.
    Project.ensure_workflow_defaults = lambda self: None
    Project.get_stage = lambda self, key: next((s for s in self.stages if s.stage_key == key), None)
    def user_payload(user):
        return {key:getattr(user,key) for key in ('id','username','is_admin','is_active','display_name')}
    models['User'].to_dict = user_payload
    return models
