import os, sys, tempfile
_tmp = tempfile.mkdtemp()
os.environ["PYCKETS_DB_PATH"] = os.path.join(_tmp, "test.db")
os.environ.pop("PYCKETS_ALLOW_REGISTRATION", None)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session
from database import create_db_and_tables, engine
from models import User, Project, ProjectMember, ProjectRole, Column
from auth import get_password_hash
import main

@pytest.fixture(scope="session")
def world():
    create_db_and_tables()
    with Session(engine) as s:
        a = User(username="a", email="a@x", hashed_password=get_password_hash("pw"))
        b = User(username="b", email="b@x", hashed_password=get_password_hash("pw"))
        v = User(username="viewer", email="v@x", hashed_password=get_password_hash("pw"))
        m = User(username="m", email="m@x", hashed_password=get_password_hash("pw"))
        root = User(username="root", email="r@x", hashed_password=get_password_hash("pw"), is_superuser=True)
        s.add_all([a, b, v, m, root, Column(name="TODO", order=1), Column(name="IN PROGRESS", order=2), Column(name="DONE", order=3)])
        pa, pb = Project(name="PA"), Project(name="PB")
        s.add_all([pa, pb]); s.commit()
        for o in (a, b, v, m, root, pa, pb): s.refresh(o)
        s.add_all([ProjectMember(project_id=pa.id, user_id=a.id, role=ProjectRole.OWNER),
                   ProjectMember(project_id=pb.id, user_id=b.id, role=ProjectRole.OWNER),
                   ProjectMember(project_id=pa.id, user_id=v.id, role=ProjectRole.VIEWER),
                   ProjectMember(project_id=pa.id, user_id=m.id, role=ProjectRole.MEMBER)])
        s.commit()
        return {"PA": pa.id, "PB": pb.id, "uid_m": m.id, "uid_b": b.id, "uid_a": a.id, "uid_v": v.id}

def _client(username=None):
    c = TestClient(main.app, raise_server_exceptions=False)
    if username:
        r = c.post("/api/auth/login", data={"username": username, "password": "pw"})
        c.headers["Authorization"] = "Bearer " + r.json()["access_token"]
    return c

@pytest.fixture(scope="session")
def ca(world): return _client("a")
@pytest.fixture(scope="session")
def cb(world): return _client("b")
@pytest.fixture(scope="session")
def cv(world): return _client("viewer")
@pytest.fixture(scope="session")
def cm(world): return _client("m")
@pytest.fixture(scope="session")
def cr(world): return _client("root")
@pytest.fixture(scope="session")
def anon(world): return _client()

@pytest.fixture()
def ticket(ca, world):
    r = ca.post("/api/tickets", json={"title": "t", "project_id": world["PA"], "priority": "MEDIUM", "ticket_type": "TASK"})
    assert r.status_code == 200, r.text
    return r.json()
