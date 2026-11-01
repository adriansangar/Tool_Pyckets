"""Migraciones: BD nueva, BD anterior a Alembic y datos de épicas."""
import os, sqlite3, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def _run(db_path, code):
    env = {**os.environ, "PYCKETS_DB_PATH": db_path}
    r = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-1500:]
    return r.stdout

def test_fresh_database_reaches_head(tmp_path):
    db = str(tmp_path / "fresh.db")
    _run(db, "import database; database.create_db_and_tables(); database.create_db_and_tables()")
    c = sqlite3.connect(db)
    assert c.execute("select version_num from alembic_version").fetchone()[0] == "0002"
    cols = [r[1] for r in c.execute("pragma table_info(epic)")]
    assert {"project_id", "description"} <= set(cols)

def test_pre_alembic_database_is_stamped_and_epics_migrated(tmp_path):
    db = str(tmp_path / "legacy.db")
    # BD con el esquema baseline y SIN tabla alembic_version (como las creadas antes de Alembic)
    _run(db, '''
import database
from alembic import command
command.upgrade(database._alembic_config(), "0001")
import sqlite3
c = sqlite3.connect(%r)
c.execute("INSERT INTO project (id,name,color,accent_color,icon,is_archived) VALUES (1,'P1','#fff','#000','x',0),(2,'P2','#fff','#000','x',0)")
c.execute("INSERT INTO epic (name,color) VALUES ('Core','#ff5733'),('SinUso','#111111')")
rows = [(1,'Core'),(1,'Core'),(1,'UI'),(2,'Core'),(2,None),(2,'  ')]
for i,(p,e) in enumerate(rows,1):
    c.execute("INSERT INTO ticket (id,title,status,priority,ticket_type,tags,project_id,epic,story_points,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,0,'2026-01-01','2026-01-01')",(i,'t%%d'%%i,'todo','MEDIUM','TASK','[]',p,e))
c.execute("DROP TABLE alembic_version")
c.commit()
''' % db)
    _run(db, "import database; database.create_db_and_tables()")
    c = sqlite3.connect(db)
    assert c.execute("select version_num from alembic_version").fetchone()[0] == "0002"
    assert c.execute("select project_id,name,color from epic order by project_id,name").fetchall() == [
        (1, "Core", "#ff5733"), (1, "UI", "#6366f1"), (2, "Core", "#ff5733")]
    assert c.execute("select count(*) from ticket").fetchone()[0] == 6   # ningún ticket se pierde
