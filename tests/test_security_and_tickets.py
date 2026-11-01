import io

def test_enums_accept_both_cases_and_return_lowercase(ca, world):
    for p, t in (("MEDIUM", "TASK"), ("medium", "task")):
        r = ca.post("/api/tickets", json={"title": "x", "project_id": world["PA"], "priority": p, "ticket_type": t})
        assert r.status_code == 200 and r.json()["priority"] == "medium" and r.json()["ticket_type"] == "task"

def test_put_persists_all_fields_and_logs_history(ca, ticket):
    r = ca.put(f"/api/tickets/{ticket['id']}", json={
        "title": "nuevo", "priority": "HIGH", "ticket_type": "bug", "story_points": 8,
        "due_date": "2026-12-01", "status": "in_progress", "tags": ["a"], "assignee": "a"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert (d["priority"], d["ticket_type"], d["story_points"], d["status"], d["due_date"]) == ("high", "bug", 8, "in_progress", "2026-12-01")
    fields = {h["field_changed"] for h in ca.get(f"/api/tickets/{ticket['id']}/history").json()}
    assert {"priority", "ticket_type", "story_points", "status", "title"} <= fields

def test_put_partial_does_not_reset_other_fields(ca, ticket):
    ca.put(f"/api/tickets/{ticket['id']}", json={"priority": "urgent", "story_points": 5})
    r = ca.put(f"/api/tickets/{ticket['id']}", json={"title": "solo titulo"})
    assert r.json()["priority"] == "urgent" and r.json()["story_points"] == 5

def test_put_empty_due_date_clears_it_and_invalid_status_rejected(ca, ticket):
    assert ca.put(f"/api/tickets/{ticket['id']}", json={"due_date": ""}).json()["due_date"] is None
    assert ca.put(f"/api/tickets/{ticket['id']}", json={"status": "banana"}).status_code == 400
    assert ca.put(f"/api/tickets/{ticket['id']}/status", json={"status": "banana"}).status_code == 400
    assert ca.put(f"/api/tickets/{ticket['id']}/status", json={"status": "done"}).json()["status"] == "done"

def test_other_project_user_cannot_read_or_edit(cb, ticket, world):
    tid = ticket["id"]
    assert all(t["project_id"] != world["PA"] for t in cb.get("/api/tickets").json())
    assert cb.get("/api/tickets", params={"project_id": world["PA"]}).status_code == 403
    assert cb.put(f"/api/tickets/{tid}", json={"title": "hack"}).status_code == 403
    assert cb.put(f"/api/tickets/{tid}/status", json={"status": "done"}).status_code == 403
    assert cb.get(f"/api/tickets/{tid}/comments").status_code == 403
    assert cb.get(f"/api/tickets/{tid}/checklist").status_code == 403
    assert cb.get(f"/api/tickets/{tid}/history").status_code == 403
    assert cb.post(f"/api/tickets/{tid}/checklist", json={"content": "x"}).status_code == 403
    assert cb.post("/api/tickets", json={"title": "x", "project_id": world["PA"]}).status_code == 403
    assert cb.post("/api/tickets/bulk-update", json={"ticket_ids": [tid], "status": "done"}).status_code == 403

def test_viewer_reads_but_cannot_write(cv, ticket):
    tid = ticket["id"]
    assert cv.get(f"/api/tickets/{tid}/comments").status_code == 200
    assert cv.put(f"/api/tickets/{tid}", json={"title": "x"}).status_code == 403
    assert cv.post(f"/api/tickets/{tid}/comments", data={"content": "hola"}).status_code == 403

def test_anonymous_has_no_access(anon, ticket):
    tid = ticket["id"]
    for method, url in (("get", f"/api/tickets/{tid}/checklist"), ("get", f"/api/tickets/{tid}/history"),
                        ("get", "/api/columns"), ("get", "/api/epics"), ("get", "/api/tickets")):
        assert getattr(anon, method)(url).status_code == 401, url
    assert anon.post(f"/api/tickets/{tid}/checklist", json={"content": "x"}).status_code == 401

def test_registration_closed_by_default(anon):
    assert anon.post("/api/auth/register", json={"username": "evil", "email": "e@x", "password": "pw"}).status_code == 403

def test_checklist_roundtrip(ca, ticket):
    tid = ticket["id"]
    item = ca.post(f"/api/tickets/{tid}/checklist", json={"content": "paso"}).json()
    assert ca.put(f"/api/checklist/{item['id']}", json={"is_completed": True}).json()["is_completed"] is True
    assert ca.delete(f"/api/checklist/{item['id']}").status_code == 200
    assert ca.get(f"/api/tickets/{tid}/checklist").json() == []

def test_upload_is_sanitized(ca, ticket):
    tid = ticket["id"]
    png = ("a.png", io.BytesIO(b"\x89PNG\r\n"), "image/png")
    r = ca.post(f"/api/tickets/{tid}/comments", data={"content": "img"}, files={"file": png})
    assert r.status_code == 200 and r.json()["image_url"].startswith("/static/uploads/") and "a.png" not in r.json()["image_url"]
    for name, ctype in (("evil.html", "text/html"), ("../../x.png", "text/plain"), ("x.svg", "image/svg+xml")):
        r = ca.post(f"/api/tickets/{tid}/comments", data={"content": "x"}, files={"file": (name, io.BytesIO(b"<script>"), ctype)})
        assert r.status_code == 400, name
    big = ("big.png", io.BytesIO(b"0" * (5 * 1024 * 1024 + 1)), "image/png")
    assert ca.post(f"/api/tickets/{tid}/comments", data={"content": "x"}, files={"file": big}).status_code == 413
    assert ca.post(f"/api/tickets/{tid}/comments", data={"content": "  "}).status_code == 400

def test_webhook_rejects_repo_without_secret_and_bad_signature(anon, world):
    from sqlmodel import Session
    from database import engine
    from models import Repository
    with Session(engine) as s:
        s.add_all([Repository(project_id=world["PA"], owner="o", repo_name="nosecret"),
                   Repository(project_id=world["PA"], owner="o", repo_name="withsecret", webhook_secret="s3cret")])
        s.commit()
    body = lambda n: {"repository": {"name": n, "owner": {"login": "o"}}, "commits": []}
    hdr = {"X-GitHub-Event": "push"}
    assert anon.post("/api/github/webhook", json=body("nosecret"), headers=hdr).status_code == 401
    assert anon.post("/api/github/webhook", json=body("withsecret"), headers={**hdr, "X-Hub-Signature-256": "sha256=bad"}).status_code == 401
    assert anon.post("/api/github/webhook", json=body("unknown"), headers=hdr).json()["status"] == "ignored"

def test_delete_project_removes_dependents(ca, cr):
    pid = cr.post("/api/projects", json={"name": "tmp", "color": "#fff"}).json()["id"]
    tid = cr.post("/api/tickets", json={"title": "x", "project_id": pid}).json()["id"]
    cr.post(f"/api/tickets/{tid}/checklist", json={"content": "c"})
    assert cr.delete(f"/api/projects/{pid}").status_code == 200
    assert cr.get(f"/api/tickets/{tid}/checklist").status_code == 404
