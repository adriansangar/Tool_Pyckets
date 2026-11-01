"""Matriz de permisos (admin general / admin de proyecto / usuario normal) y épicas por proyecto."""

def _mk(client, project, **extra):
    r = client.post("/api/tickets", json={"title": "t", "project_id": project, **extra})
    assert r.status_code == 200, r.text
    return r.json()

# ---------- proyectos y accesos: solo admin general ----------
def test_only_superuser_creates_archives_deletes_projects(ca, cm, cr):
    assert ca.post("/api/projects", json={"name": "x"}).status_code == 403     # admin de proyecto, no general
    assert cm.post("/api/projects", json={"name": "x"}).status_code == 403
    r = cr.post("/api/projects", json={"name": "nuevo"})
    assert r.status_code == 200 and r.json()["id"]
    pid = r.json()["id"]
    assert ca.put(f"/api/projects/{pid}/archive").status_code == 403
    assert cr.put(f"/api/projects/{pid}/archive").status_code == 200
    assert cr.delete(f"/api/projects/{pid}").status_code == 200

def test_only_superuser_manages_members(ca, cr, world):
    data = {"user_id": world["uid_b"], "role": "member"}
    assert ca.post(f"/api/projects/{world['PA']}/members", data=data).status_code == 403
    assert cr.post(f"/api/projects/{world['PA']}/members", data=data).status_code == 200
    assert ca.delete(f"/api/projects/{world['PA']}/members/{world['uid_b']}").status_code == 403
    assert cr.delete(f"/api/projects/{world['PA']}/members/{world['uid_b']}").status_code == 200

def test_projects_expose_my_role(ca, cm, cv, cr, world):
    role = lambda c: {p["id"]: p["my_role"] for p in c.get("/api/projects").json()}[world["PA"]]
    assert (role(ca), role(cm), role(cv), role(cr)) == ("owner", "member", "viewer", "owner")

# ---------- usuario normal ----------
def test_member_can_create_but_not_assign_others(cm, world):
    own = _mk(cm, world["PA"])
    assert own["reporter"] == "m" and own["assignee"] is None
    assert _mk(cm, world["PA"], assignee="m")["assignee"] == "m"
    assert cm.post("/api/tickets", json={"title": "t", "project_id": world["PA"], "assignee": "a"}).status_code == 403

def test_member_edits_only_assigned_or_own_unassigned(ca, cm, world):
    mine = _mk(cm, world["PA"])                       # creado por m, sin asignar
    assert cm.put(f"/api/tickets/{mine['id']}", json={"title": "ok"}).status_code == 200
    others = _mk(ca, world["PA"])                     # de a, sin asignar
    assert cm.put(f"/api/tickets/{others['id']}", json={"title": "no"}).status_code == 403
    assert cm.put(f"/api/tickets/{others['id']}/status", json={"status": "done"}).status_code == 403
    assert cm.post(f"/api/tickets/{others['id']}/checklist", json={"content": "x"}).status_code == 403
    ca.put(f"/api/tickets/{others['id']}", json={"assignee": "m"})   # el admin se lo asigna
    assert cm.put(f"/api/tickets/{others['id']}", json={"title": "ahora si", "status": "in_progress"}).status_code == 200
    assert cm.post(f"/api/tickets/{others['id']}/checklist", json={"content": "x"}).status_code == 200

def test_member_cannot_reassign_or_change_epic_or_project(ca, cm, world):
    ca.post(f"/api/projects/{world['PA']}/epics", json={"name": "EpicaM"})
    t = _mk(ca, world["PA"], assignee="m")
    assert cm.put(f"/api/tickets/{t['id']}", json={"assignee": "a"}).status_code == 403
    assert cm.put(f"/api/tickets/{t['id']}", json={"epic": "EpicaM"}).status_code == 403
    assert cm.put(f"/api/tickets/{t['id']}", json={"project_id": world["PB"]}).status_code == 403
    # reenviar los mismos valores (como hace el panel completo) no es un cambio
    assert cm.put(f"/api/tickets/{t['id']}", json={"assignee": "m", "epic": "", "project_id": world["PA"], "title": "ok"}).status_code == 200

def test_member_bulk_rules(ca, cm, world):
    mine, other = _mk(cm, world["PA"], assignee="m"), _mk(ca, world["PA"])
    assert cm.post("/api/tickets/bulk-update", json={"ticket_ids": [mine["id"]], "status": "in_progress"}).status_code == 200
    assert cm.post("/api/tickets/bulk-update", json={"ticket_ids": [mine["id"], other["id"]], "status": "done"}).status_code == 403
    assert cm.post("/api/tickets/bulk-update", json={"ticket_ids": [mine["id"]], "assignee": "a"}).status_code == 403
    assert ca.post("/api/tickets/bulk-update", json={"ticket_ids": [mine["id"]], "assignee": "a"}).status_code == 200

def test_member_can_comment_any_visible_ticket_viewer_cannot(ca, cm, cv, world):
    t = _mk(ca, world["PA"])
    assert cm.post(f"/api/tickets/{t['id']}/comments", data={"content": "hola"}).status_code == 200
    assert cv.post(f"/api/tickets/{t['id']}/comments", data={"content": "hola"}).status_code == 403
    assert cv.get(f"/api/tickets/{t['id']}/comments").status_code == 200

# ---------- épicas por proyecto ----------
def test_epics_crud_permissions_and_counts(ca, cm, cv, cb, world):
    PA = world["PA"]
    r = ca.post(f"/api/projects/{PA}/epics", json={"name": "Core", "color": "#123456"})
    assert r.status_code == 200
    eid = r.json()["id"]
    assert ca.post(f"/api/projects/{PA}/epics", json={"name": "core"}).status_code == 409   # sin distinguir mayúsculas
    assert cm.post(f"/api/projects/{PA}/epics", json={"name": "Otra"}).status_code == 403
    assert cv.get(f"/api/projects/{PA}/epics").status_code == 200
    assert cb.get(f"/api/projects/{PA}/epics").status_code == 403                          # sin acceso al proyecto

    t1, t2 = _mk(ca, PA, epic="Core"), _mk(ca, PA, epic="Core")
    ca.put(f"/api/tickets/{t2['id']}/status", json={"status": "done"})
    e = [x for x in ca.get(f"/api/projects/{PA}/epics").json() if x["id"] == eid][0]
    assert (e["tickets_total"], e["tickets_done"]) == (2, 1)

    assert ca.put(f"/api/projects/{PA}/epics/{eid}", json={"name": "Core v2"}).status_code == 200
    assert ca.get(f"/api/tickets", params={"project_id": PA}).json() and \
        {t["epic"] for t in ca.get("/api/tickets", params={"project_id": PA}).json() if t["id"] in (t1["id"], t2["id"])} == {"Core v2"}

    assert ca.delete(f"/api/projects/{PA}/epics/{eid}").status_code == 200
    assert {t["epic"] for t in ca.get("/api/tickets", params={"project_id": PA}).json() if t["id"] in (t1["id"], t2["id"])} == {None}

def test_ticket_epic_must_exist_in_its_project(ca, cr, world):
    PA, PB = world["PA"], world["PB"]
    assert ca.post("/api/tickets", json={"title": "x", "project_id": PA, "epic": "NoExiste"}).status_code == 400
    ca.post(f"/api/projects/{PA}/epics", json={"name": "SoloPA"})
    t = _mk(ca, PA, epic="SoloPA")
    assert cr.put(f"/api/tickets/{t['id']}", json={"epic": "SoloPA", "project_id": PB}).status_code == 400   # en PB no existe
    moved = cr.put(f"/api/tickets/{t['id']}", json={"project_id": PB}).json()                                 # al mover se limpia
    assert moved["project_id"] == PB and moved["epic"] is None

def test_legacy_epics_endpoint_only_shows_accessible(ca, cb, world):
    ca.post(f"/api/projects/{world['PA']}/epics", json={"name": "VisibleParaA"})
    assert "VisibleParaA" in [e["name"] for e in ca.get("/api/epics").json()]
    assert "VisibleParaA" not in [e["name"] for e in cb.get("/api/epics").json()]
