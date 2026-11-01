"""Dashboards: home, resumen de proyecto y 'Mi trabajo' (agregados, orden y permisos)."""
import pytest

PAST, FUTURE = "2020-01-01", "2099-01-01"

@pytest.fixture(scope="module")
def dash(world, ca, cr):
    """Proyecto aislado con datos conocidos. a = admin, m = miembro, viewer = lectura."""
    pid = cr.post("/api/projects", json={"name": "DASH"}).json()["id"]
    for uid, role in ((world["uid_a"], "admin"), (world["uid_m"], "member"), (world["uid_v"], "viewer")):
        assert cr.post(f"/api/projects/{pid}/members", data={"user_id": uid, "role": role}).status_code == 200
    assert ca.post(f"/api/projects/{pid}/epics", json={"name": "E1", "color": "#111111"}).status_code == 200

    def mk(**kw):
        r = ca.post("/api/tickets", json={"project_id": pid, "title": "t", **kw})
        assert r.status_code == 200, r.text
        return r.json()["id"]

    ids = {
        "t1": mk(epic="E1", status="todo", due_date=PAST, assignee="m", priority="HIGH", story_points=3),
        "t2": mk(epic="E1", status="in_progress", due_date=FUTURE, assignee="m", priority="LOW", story_points=2),
        "t3": mk(epic="E1", status="done", due_date=PAST, assignee="a", story_points=5),
        "t4": mk(status="todo", priority="URGENT", story_points=1),
        "t5": mk(status="done", assignee="a"),
    }
    return {"pid": pid, **ids}

def test_home_shows_only_accessible_projects_with_progress(dash, ca, cb, cr):
    card = {c["id"]: c for c in ca.get("/api/dashboard").json()}[dash["pid"]]
    assert (card["total"], card["done"], card["progress"], card["overdue"]) == (5, 2, 40, 1)
    assert card["my_role"] == "admin" and card["epics"] == 1 and card["members"] == 4   # root (creador) + a + m + viewer
    assert card["by_status"] == {"todo": 2, "in_progress": 1, "done": 2}
    assert dash["pid"] not in {c["id"] for c in cb.get("/api/dashboard").json()}      # b no es miembro
    assert dash["pid"] in {c["id"] for c in cr.get("/api/dashboard").json()}          # el admin general ve todo

def test_home_hides_archived_projects(dash, cr):
    pid = cr.post("/api/projects", json={"name": "ARCH"}).json()["id"]
    cr.put(f"/api/projects/{pid}/archive")
    assert pid not in {c["id"] for c in cr.get("/api/dashboard").json()}

def test_project_dashboard_numbers(dash, ca):
    d = ca.get(f"/api/projects/{dash['pid']}/dashboard").json()
    assert (d["total"], d["done"], d["progress"], d["overdue_count"]) == (5, 2, 40, 1)
    assert (d["story_points_total"], d["story_points_done"]) == (11, 5)
    assert [(c["status"], c["count"], c["is_done"]) for c in d["columns"]] == [("todo", 2, False), ("in_progress", 1, False), ("done", 2, True)]
    e1 = d["epics"][0]
    assert (e1["name"], e1["total"], e1["done"], e1["progress"], e1["overdue"], e1["story_points"]) == ("E1", 3, 1, 33, 1, 10)
    assert (d["no_epic"]["total"], d["no_epic"]["done"], d["no_epic"]["progress"]) == (2, 1, 50)
    assert d["by_priority"] == {"urgent": 1, "high": 1, "medium": 0, "low": 1}          # solo tickets abiertos
    assert [t["id"] for t in d["overdue"]] == [dash["t1"]]                              # t3 vencido pero hecho: no cuenta
    assert d["my_open"] == 0 and d["project"]["my_role"] == "admin"

def test_workload_only_for_project_admins(dash, ca, cm, cv, cr):
    wl = {w["assignee"]: w for w in ca.get(f"/api/projects/{dash['pid']}/dashboard").json()["workload"]}
    assert (wl["m"]["open"], wl["m"]["overdue"], wl["m"]["story_points"]) == (2, 1, 5)
    assert wl[None]["open"] == 1 and "a" not in wl                                      # a solo tiene tickets hechos
    assert cr.get(f"/api/projects/{dash['pid']}/dashboard").json()["workload"] is not None
    assert cm.get(f"/api/projects/{dash['pid']}/dashboard").json()["workload"] is None
    assert cv.get(f"/api/projects/{dash['pid']}/dashboard").json()["workload"] is None
    assert cm.get(f"/api/projects/{dash['pid']}/dashboard").json()["my_open"] == 2

def test_project_dashboard_permissions(dash, cb, anon):
    assert cb.get(f"/api/projects/{dash['pid']}/dashboard").status_code == 403
    assert anon.get(f"/api/projects/{dash['pid']}/dashboard").status_code == 401
    assert anon.get("/api/dashboard").status_code == 401 and anon.get("/api/me/work").status_code == 401

def test_project_dashboard_404(ca):
    assert ca.get("/api/projects/999999/dashboard").status_code == 404

def test_my_work_groups_sorted_and_excludes_done(dash, cm, ca):
    work = cm.get("/api/me/work").json()
    group = [g for g in work["groups"] if g["project_id"] == dash["pid"]][0]
    assert [t["id"] for t in group["tickets"]] == [dash["t1"], dash["t2"]]               # vencido primero, hechos fuera
    assert group["tickets"][0]["overdue"] is True and group["tickets"][1]["overdue"] is False
    assert work["total_open"] >= 2 and work["overdue"] >= 1
    a_group = [g for g in ca.get("/api/me/work").json()["groups"] if g["project_id"] == dash["pid"]]
    assert a_group == []                                                                 # a solo tiene tickets hechos

def test_my_work_ignores_projects_without_access(dash, cb, cr):
    other = cr.post("/api/projects", json={"name": "AJENO"}).json()["id"]
    cr.post("/api/tickets", json={"project_id": other, "title": "x", "assignee": "b"})
    assert other not in {g["project_id"] for g in cb.get("/api/me/work").json()["groups"]}   # b nunca fue añadido
