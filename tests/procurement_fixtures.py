import tempfile
from pathlib import Path
from types import SimpleNamespace
from sqlalchemy import create_engine, text, event
from sqlalchemy.orm import Session

STAGES = [{'key': 'first', 'name': '开始', 'icon': '📥'}, {'key': 'end', 'name': '完成', 'icon': '📦'}]


class CatalogDatabase:
    def __init__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'test.db'
        self.engine = create_engine('sqlite:///' + str(self.path))
        @event.listens_for(self.engine, 'connect')
        def fk(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
        self.session = Session(self.engine)
        for sql in [
            'CREATE TABLE projects(id INTEGER PRIMARY KEY,number TEXT,name TEXT,method TEXT)',
            'CREATE TABLE project_lots(id INTEGER PRIMARY KEY,project_id INTEGER,lot_number TEXT)',
            'CREATE TABLE stages(id INTEGER PRIMARY KEY,project_id INTEGER,stage_key TEXT,completed INTEGER,completed_date TEXT)',
            'CREATE TABLE bid_results(id INTEGER PRIMARY KEY,project_id INTEGER,supplier_name TEXT)',
            "INSERT INTO projects VALUES(1,'OLD-1','旧项目','公开招标')",
            "INSERT INTO stages VALUES(1,1,'first',1,'2026-01-02')",
            "INSERT INTO bid_results VALUES(1,1,'历史供应商')",
        ]:
            self.session.execute(text(sql))
        self.session.commit()

    def close(self):
        self.session.close()
        self.engine.dispose()
        self.tmp.cleanup()

    def project(self, id=1):
        row = self.session.execute(text('SELECT * FROM projects WHERE id=:id'), {'id': id}).mappings().one()
        return SimpleNamespace(**row)
