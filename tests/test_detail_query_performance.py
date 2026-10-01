"""Real in-memory ORM query regression; never opens production data."""
import ast
from datetime import datetime
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
from sqlalchemy import Column, ForeignKey, Integer, create_engine, event
from sqlalchemy.orm import Query, Session, declarative_base, joinedload, relationship, selectinload

Base = declarative_base()


class Project(Base):
    __tablename__ = 'perf_project'
    id = Column(Integer, primary_key=True)

    def ensure_workflow_defaults(self):
        pass

    def to_dict(self):
        return {'id': self.id, **{name: [row.id for row in getattr(self, name)]
                for name in ('stages', 'lots', 'registrations', 'stage_checklist_items')}}


for name in ('stages', 'lots', 'registrations', 'stage_checklist_items'):
    child = type(name, (Base,), {'__tablename__': 'perf_' + name,
        'id': Column(Integer, primary_key=True),
        'project_id': Column(ForeignKey('perf_project.id'))})
    setattr(Project, name, relationship(child))


class ProjectQuery(Query):
    def first_or_404(self):
        value = self.first()
        if value is None:
            raise LookupError('404')
        return value


def run_detail(source, counts=(14, 6, 40, 20)):
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as seed:
        project = Project(id=1)
        for name, count in zip(('stages', 'lots', 'registrations', 'stage_checklist_items'), counts):
            model = getattr(Project, name).property.mapper.class_
            setattr(project, name, [model() for _ in range(count)])
        seed.add(project)
        seed.commit()
    statements = []
    event.listen(engine, 'before_cursor_execute', lambda c, cu, sql, p, ctx, many: statements.append(sql))
    node = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == 'api_project')
    risk = types.SimpleNamespace(enrich_project_payload=lambda db, payload, *args: payload)
    workflow = types.SimpleNamespace(apply_project_payload=lambda payload, *args: payload)
    with Session(engine, query_cls=ProjectQuery) as session:
        Project.query = session.query(Project)
        ns = dict(Project=Project, db=types.SimpleNamespace(session=session),
                  joinedload=joinedload, selectinload=selectinload, datetime=datetime,
                  jsonify=lambda value: value, load_app_settings=lambda: {}, text=lambda value: value)
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<api_project>', 'exec'), ns)
        with patch.dict(sys.modules, {'lot_supplier_risk': risk, 'stage_workflow': workflow,
                                     'stage_templates': types.SimpleNamespace(enrich_stage_locations=lambda db, sql, pid, payload: payload)}):
            import time
            start = time.perf_counter()
            payload = ns['api_project'](1)
            elapsed = (time.perf_counter() - start) * 1000
    engine.dispose()
    return payload, statements, elapsed


class DetailQueryPerformanceTests(unittest.TestCase):
    def test_collections_are_loaded_without_cartesian_join_and_payload_is_complete(self):
        source = Path('src/backend_patches/app_replacements.py').read_text(encoding='utf-8')
        payload, statements, _ = run_detail(source)
        self.assertEqual([len(payload[name]) for name in ('stages', 'lots', 'registrations', 'stage_checklist_items')], [14, 6, 40, 20])
        self.assertFalse(any(' JOIN ' in sql.upper() for sql in statements), 'collection joins multiply rows')
        self.assertLessEqual(len(statements), 10)


if __name__ == '__main__':
    unittest.main()
