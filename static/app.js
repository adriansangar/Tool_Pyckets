const API_BASE = "/api";
const boardContainer = document.getElementById("board-container");
const listContainer = document.getElementById("list-container");
const ticketListBody = document.getElementById("ticket-list-body");
const btnToggleView = document.getElementById("toggle-view");

const navGlobalAll = document.getElementById("nav-global-all");
const navGlobalMine = document.getElementById("nav-global-mine");
const headerNewTicketBtn = document.getElementById("header-new-ticket");
const searchInput = document.getElementById("search-filter");
const suggestionsContainer = document.getElementById("omnibar-suggestions");

let isListView = false;
let globalColumns = [];
let rawTickets = [];
let currentProjectId = null;
let projectRoles = {};
let projectsById = {};   // id -> proyecto (con my_role)
let currentView = "home"; // home | mywork | project
let currentTab = "home";  // home | board | list (dentro de un proyecto)
let homeReady = false;
let currentEpic = null;          // null = nivel proyecto; nombre de épica; o NO_EPIC
const NO_EPIC = "__none__";
let epicsCache = {};              // proyecto -> [{id, name, color, open}]   // id de proyecto -> rol del usuario (owner/admin/member/viewer)
let currentUser = null;
let selectedTicketIds = new Set();
let activeSuggestionIndex = -1;
let editingTicket = null;

// ---------- Helpers ----------
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = (v) => String(v ?? "").toLowerCase();
const titleCase = (s) => { s = String(s ?? ""); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); };
const PRIO_LABEL = { urgent: "Urgente", high: "Alta", medium: "Media", low: "Baja" };
const TYPE_LABEL = { task: "Tarea", bug: "Bug", feature: "Feature", epic: "Épica" };
const statusIdOf = (name) => String(name).toLowerCase().replace(/\s+/g, "_");
function statusLabel(id) {
    const col = globalColumns.find(c => statusIdOf(c.name) === norm(id));
    return titleCase(col ? col.name : String(id || "").replace(/_/g, " "));
}
function setSelectValue(id, value, fallback) {
    const el = document.getElementById(id);
    el.value = String(value || fallback).toUpperCase();   // la API devuelve minúsculas, los <option> van en mayúsculas
    if (el.selectedIndex === -1) el.value = fallback;
}
function dueChip(t) {
    if (!t.due_date) return "";
    const d = String(t.due_date).slice(0, 10);
    const today = new Date().toLocaleDateString("sv-SE");
    const late = d < today && norm(t.status) !== "done";
    const label = new Date(d + "T00:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" });
    return `<span class="due-chip ${late ? "overdue" : ""}" title="Fecha límite">${label}</span>`;
}
function updateColumnCounts() {
    document.querySelectorAll(".column-content").forEach(c => {
        const el = document.getElementById("count-" + c.dataset.status);
        if (el) el.textContent = c.querySelectorAll(".ticket-card").length;
    });
}


async function authFetch(url, options = {}) {
    const token = localStorage.getItem("pyckets_token");
    options.headers = {
        ...options.headers,
        ...(token ? { "Authorization": `Bearer ${token}` } : {})
    };

    const response = await fetch(url, options);
    if (response.status === 401) {
        const loginScreen = document.getElementById("login-screen");
        if (loginScreen) loginScreen.style.display = "flex";
    }
    return response;
}

async function initBoard() {
    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) return;

    await loadProjects();
    await navigate("home");
}

async function checkAuth() {
    const loginScreen = document.getElementById("login-screen");
    const token = localStorage.getItem("pyckets_token");
    
    if (!token) {
        if (loginScreen) loginScreen.style.display = "flex";
        return false;
    }

    try {
        const res = await authFetch(`${API_BASE}/auth/me`);
        if (res.ok) {
            currentUser = await res.json();
            updateProfileUI(currentUser);
            if (loginScreen) loginScreen.style.display = "none";
            return true;
        }
    } catch (e) {
        console.error("Error verificando sesión:", e);
    }

    if (loginScreen) loginScreen.style.display = "flex";
    return false;
}

const loginForm = document.getElementById("login-form");
if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const usernameInput = document.getElementById("login-username").value;
        const passwordInput = document.getElementById("login-password").value;
        const errorDiv = document.getElementById("login-error");

        const formData = new URLSearchParams();
        formData.append("username", usernameInput);
        formData.append("password", passwordInput);

        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: formData
            });

            if (res.ok) {
                const data = await res.json();
                localStorage.setItem("pyckets_token", data.access_token);
                if (errorDiv) errorDiv.style.display = "none";
                document.getElementById("login-screen").style.display = "none";
                await initBoard();
            } else {
                const data = await res.json();
                if (errorDiv) {
                    errorDiv.textContent = data.detail || "Credenciales incorrectas";
                    errorDiv.style.display = "block";
                }
            }
        } catch (err) {
            console.error("Error iniciando sesión:", err);
        }
    });
}

const btnLogout = document.getElementById("btn-logout");
if (btnLogout) {
    btnLogout.addEventListener("click", () => {
        if (confirm("¿Quieres cerrar sesión?")) {
            localStorage.removeItem("pyckets_token");
            currentUser = null;
            location.reload();
        }
    });
}

async function fetchAndRenderTickets() {
    if (!currentProjectId) return;   // el tablero y la lista solo existen dentro de un proyecto
    try {
        const ticketUrl = currentProjectId ? `${API_BASE}/tickets?project_id=${currentProjectId}` : `${API_BASE}/tickets`;
        const [columnsRes, ticketsRes] = await Promise.all([
            authFetch(`${API_BASE}/columns`),
            authFetch(ticketUrl)
        ]);

        if (!columnsRes.ok || !ticketsRes.ok) return;

        globalColumns = await columnsRes.json();
        fillStatusOptions();
        const all = await ticketsRes.json();
        rawTickets = currentEpic === null ? all
            : all.filter(t => currentEpic === NO_EPIC ? !(t.epic || "").trim() : t.epic === currentEpic);

        applyOmnibarFilter();
        renderQuickFilters(rawTickets);
        setupDragAndDrop();
    } catch (error) {
        console.error("Error cargando el tablero:", error);
    }
}

function parseOmnibar(q) {
    const f = { text: [], assignee: [], priority: [], status: [], label: [], type: [], epic: [] };
    const clean = (s) => norm(s.replace(/"/g, ""));
    (String(q || "").match(/(?:[^\s"]+|"[^"]*")+/g) || []).forEach(tok => {
        const m = tok.match(/^(assignee|priority|status|label|type|epic):(.+)$/i);
        if (m) f[m[1].toLowerCase()].push(clean(m[2]));
        else if (tok[0] === "@" && tok.length > 1) f.assignee.push(clean(tok.slice(1)));
        else if (tok[0] === "#" && tok.length > 1) f.label.push(clean(tok.slice(1)));
        else f.text.push(clean(tok));
    });
    return f;
}

function filterTicketsByOmnibar(tickets, queryStr) {
    const f = parseOmnibar(queryStr);
    return tickets.filter(t => {
        const tags = (t.tags || []).map(norm);
        const hay = norm(`tb-${t.id} ${t.title} ${t.assignee || ""} ${tags.join(" ")}`);
        return f.assignee.every(a => norm(t.assignee).includes(a))
            && f.priority.every(p => norm(t.priority) === p)
            && f.status.every(s => norm(t.status) === s.replace(/\s+/g, "_"))
            && f.type.every(s => norm(t.ticket_type) === s)
            && f.epic.every(s => norm(t.epic) === s)
            && f.label.every(l => tags.some(tg => tg.includes(l)))
            && f.text.every(w => hay.includes(w));
    });
}

function applyOmnibarFilter() {
    const query = searchInput ? searchInput.value : '';
    const filteredTickets = filterTicketsByOmnibar(rawTickets, query);
    
    renderColumns(globalColumns);
    renderTickets(filteredTickets);
    renderTableTickets(filteredTickets, true);
    updateColumnCounts();
}

if (searchInput) {
    searchInput.addEventListener("input", () => applyOmnibarFilter());
}

async function loadProjects() {
    try {
        const res = await authFetch(`${API_BASE}/projects`);
        if (!res.ok) return;
        const projects = await res.json();
        const projectList = document.getElementById("project-list");
        if(!projectList) return;
        
        projectList.innerHTML = "";
        projectRoles = {};
        projectsById = {};
        projects.forEach(p => {
            projectRoles[p.id] = p.my_role;
            projectsById[p.id] = p;
            const a = document.createElement("a");
            a.className = "nav-item project-link";
            a.dataset.id = p.id;
            a.title = p.name;
            a.href = "#";
            a.innerHTML = `<span class="project-color" style="background-color: ${esc(p.color)};"></span> <span class="text">${esc(p.name)}</span>`;
            
            a.addEventListener("click", (e) => { e.preventDefault(); navigate("project", { project: p }); });
            projectList.appendChild(a);
        });
        if (currentProjectId) renderSidebarEpics(currentProjectId, true);
        syncSidebarActive();
        if (currentView === "home" && homeReady) loadHome();
    } catch (e) {
        console.error("Error cargando proyectos:", e);
    }
}

if (btnToggleView) {
    btnToggleView.addEventListener("click", () => {
        if (currentView === "project" && currentTab !== "home") setTab(currentTab === "board" ? "list" : "board");
    });
}

function renderColumns(columns) {
    if (!boardContainer) return;
    boardContainer.innerHTML = "";
    columns.forEach((col, idx) => {
        const statusId = statusIdOf(col.name);
        const colDiv = document.createElement("div");
        colDiv.className = "kanban-column";
        colDiv.dataset.status = statusId;
        colDiv.style.setProperty("--i", idx);
        colDiv.innerHTML = `
            <div class="column-header">
                <span class="col-title"><span class="status-dot"></span>${esc(titleCase(col.name))}</span>
                <span class="column-count" id="count-${statusId}">0</span>
            </div>
            <div class="column-content" data-status="${statusId}" id="col-${statusId}"></div>`;
        boardContainer.appendChild(colDiv);
    });
}

function renderTickets(tickets) {
    tickets.forEach(ticket => {
        const colContent = document.querySelector(`.column-content[data-status="${ticket.status || "todo"}"]`);
        if (!colContent) return;
        const prio = norm(ticket.priority) || "medium";
        const type = norm(ticket.ticket_type) || "task";
        const div = document.createElement("div");
        div.className = "ticket-card";
        div.draggable = true;
        div.dataset.id = ticket.id;
        div.addEventListener("click", () => openEditPanel(ticket.id));
        div.innerHTML = `
            <div class="ticket-top">
                <span class="ticket-key">TB-${ticket.id}</span>
                ${ticket.epic ? `<span class="epic-badge">${esc(ticket.epic)}</span>` : ""}
            </div>
            <div class="ticket-title">${esc(ticket.title)}</div>
            ${ticket.description ? `<div class="ticket-desc">${esc(ticket.description)}</div>` : ""}
            <div class="tags-container">${(ticket.tags || []).map(t => `<span class="tag-badge">#${esc(t)}</span>`).join("")}</div>
            <div class="ticket-meta">
                <div class="meta-left">
                    ${prioIcon(prio)}
                    <span class="type-badge">${TYPE_LABEL[type] || esc(titleCase(type))}</span>
                    ${dueChip(ticket)}
                    ${ticket.story_points ? `<span class="points-chip" title="Story points">${ticket.story_points}</span>` : ""}
                </div>
                ${ticket.assignee ? `<div class="assignee-avatar" title="${esc(ticket.assignee)}">${esc(ticket.assignee.charAt(0).toUpperCase())}</div>` : ""}
            </div>`;
        colContent.appendChild(div);
    });
}

function renderTableTickets(tickets, clearTable = false) {
    if (!ticketListBody) return;
    if (clearTable) ticketListBody.innerHTML = "";
    if (!tickets.length) {
        ticketListBody.innerHTML = '<tr class="empty-row"><td colspan="8">No hay tickets que coincidan con el filtro.</td></tr>';
        return;
    }
    tickets.forEach(ticket => {
        const prio = norm(ticket.priority) || "medium";
        const type = norm(ticket.ticket_type) || "task";
        const st = norm(ticket.status) || "todo";
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><input type="checkbox" class="ticket-select-check" data-id="${ticket.id}" ${selectedTicketIds.has(ticket.id) ? "checked" : ""}></td>
            <td class="ticket-key">TB-${ticket.id}</td>
            <td>${prioIcon(prio, true)} <span class="type-badge">${TYPE_LABEL[type] || esc(titleCase(type))}</span></td>
            <td class="ticket-link">${esc(ticket.title)}</td>
            <td><span class="si-label">${statusIcon(st)}<span>${esc(statusLabel(st))}</span></span></td>
            <td>${ticket.assignee ? esc(ticket.assignee) : '<span class="empty-note">Sin asignar</span>'}</td>
            <td>${dueChip(ticket) || '<span class="empty-note">—</span>'}</td>
            <td class="num">${ticket.story_points || 0}</td>`;
        tr.addEventListener("click", (e) => { if (!e.target.closest("input")) openEditPanel(ticket.id); });
        ticketListBody.appendChild(tr);
    });
    document.querySelectorAll(".ticket-select-check").forEach(chk => {
        chk.addEventListener("change", (e) => {
            const id = parseInt(e.target.dataset.id);
            if (e.target.checked) selectedTicketIds.add(id); else selectedTicketIds.delete(id);
            updateBulkToolbar();
        });
    });
}

function updateBulkToolbar() {
    const bar = document.getElementById("bulk-actions-bar");
    const countSpan = document.getElementById("bulk-selected-count");
    if (!bar || !countSpan) return;

    if (selectedTicketIds.size > 0) {
        countSpan.textContent = `${selectedTicketIds.size} seleccionados`;
        bar.style.display = "flex";
    } else {
        bar.style.display = "none";
    }
}

const btnCancelBulk = document.getElementById("btn-cancel-bulk");
if (btnCancelBulk) {
    btnCancelBulk.addEventListener("click", () => {
        selectedTicketIds.clear();
        updateBulkToolbar();
        applyOmnibarFilter();
    });
}

const btnApplyBulk = document.getElementById("btn-apply-bulk");
if (btnApplyBulk) {
    btnApplyBulk.addEventListener("click", async () => {
        const newStatus = document.getElementById("bulk-status-select").value;
        const newPriority = document.getElementById("bulk-priority-select").value;

        if (!newStatus && !newPriority) {
            alert("Selecciona al menos un atributo a modificar.");
            return;
        }

        try {
            const res = await authFetch(`${API_BASE}/tickets/bulk-update`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ticket_ids: Array.from(selectedTicketIds),
                    status: newStatus || null,
                    priority: newPriority || null
                })
            });

            if (res.ok) {
                selectedTicketIds.clear();
                updateBulkToolbar();
                await fetchAndRenderTickets();
            }
        } catch (e) {
            console.error("Error en acción masiva:", e);
        }
    });
}

function renderQuickFilters(tickets) {
    const filtersBar = document.getElementById("quick-filters");
    if (!filtersBar) return;
    filtersBar.innerHTML = `
        <span class="filter-label">Filtros rápidos</span>
        <button class="filter-pill active" onclick="filterByPriority('', this)">Todos</button>
        <button class="filter-pill" onclick="filterByPriority('URGENT', this)"><span class="dot" style="background: var(--prio-urgent)"></span>Urgentes</button>
        <button class="filter-pill" onclick="filterByPriority('HIGH', this)"><span class="dot" style="background: var(--prio-high)"></span>Altas</button>
    `;
}

window.filterByPriority = function(prio, btn) {
    document.querySelectorAll("#quick-filters .filter-pill").forEach(p => p.classList.remove("active"));
    if (btn) btn.classList.add("active");
    if (searchInput) searchInput.value = prio ? "priority:" + prio.toLowerCase() : "";
    applyOmnibarFilter();
};

async function updateTicketStatus(ticketId, status) {
    try {
        const res = await authFetch(`${API_BASE}/tickets/${ticketId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: status })
        });
        return res.ok;
    } catch (error) {
        console.error("Error:", error);
        return false;
    }
}

function toast(msg, kind = "info") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.setAttribute("role", "status");
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

let draggedTicket = null;
function setupDragAndDrop() {
    const tickets = document.querySelectorAll('.ticket-card');
    const columns = document.querySelectorAll('.column-content');

    tickets.forEach(ticket => {
        ticket.addEventListener('dragstart', () => {
            draggedTicket = ticket;
            ticket._from = ticket.parentElement; ticket._next = ticket.nextSibling;
            setTimeout(() => ticket.style.opacity = '0.5', 0);
        });
        ticket.addEventListener('dragend', () => {
            if (draggedTicket) draggedTicket.style.opacity = '1';
            draggedTicket = null;
        });
    });

    columns.forEach(column => {
        column.addEventListener('dragover', (e) => { e.preventDefault(); column.classList.add('drag-over'); });
        column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
        column.addEventListener('drop', async (e) => {
            e.preventDefault();
            if (draggedTicket) {
                column.classList.remove('drag-over');
                column.appendChild(draggedTicket);
                updateColumnCounts();
                const ticketId = draggedTicket.dataset.id;
                const newStatus = column.dataset.status;
                const card = draggedTicket, from = card._from, next = card._next;
                if (from !== column) {
                    const ok = await updateTicketStatus(ticketId, newStatus);
                    if (ok) {
                        const t = rawTickets.find(x => x.id == ticketId);
                        if (t) t.status = newStatus;
                    } else {
                        from.insertBefore(card, next);
                        updateColumnCounts();
                        toast("No se pudo mover el ticket; se ha restaurado su posición.", "error");
                    }
                }
            }
        });
    });
}

// PANEL LATERAL TICKET
const sidePanel = document.getElementById("side-panel");
const btnClosePanel = document.getElementById("close-panel");
const formTicket = document.getElementById("ticket-form");
const panelTitle = document.getElementById("panel-title");

if (sidePanel) {
    const closePanel = () => {
        sidePanel.classList.remove("open", "full", "editing");
        editingTicket = null;
        setTimeout(() => { 
            if(formTicket) {
                formTicket.reset(); 
                document.getElementById("ticket-id").value = "";
                panelTitle.textContent = "Nuevo ticket";
                document.getElementById("checklist-section").style.display = "none";
                document.getElementById("history-section").style.display = "none";
                document.getElementById("branch-generator-box").style.display = "none";
                document.getElementById("manual-commit-form").style.display = "none";
            }
        }, 300);
    };

    if (headerNewTicketBtn) {
        headerNewTicketBtn.addEventListener("click", () => {
            panelTitle.textContent = "Nuevo ticket";
            loadEpicOptions(currentProjectId, currentEpic && currentEpic !== NO_EPIC ? currentEpic : "");
            applyTicketFormRole(currentProjectId);
            sidePanel.classList.add("open");
        });
    }

    if (btnClosePanel) btnClosePanel.addEventListener("click", closePanel);
    const btnCancelTicket = document.getElementById("cancel-ticket");
    if (btnCancelTicket) btnCancelTicket.addEventListener("click", closePanel);
    const overlay = document.getElementById("panel-overlay");
    if (overlay) overlay.addEventListener("click", closePanel);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sidePanel.classList.contains("open")) closePanel(); });

    if (formTicket) {
        formTicket.addEventListener("submit", async (e) => {
            e.preventDefault();
            
            const rawTags = document.getElementById("ticket-tags").value;
            const tagsArray = rawTags ? rawTags.split(",").map(t => t.trim()).filter(t => t) : [];
            const spVal = document.getElementById("ticket-story-points").value;
            
            const ticketData = {
                title: document.getElementById("ticket-title").value,
                description: document.getElementById("ticket-desc").value,
                ticket_type: document.getElementById("ticket-type").value,
                priority: document.getElementById("ticket-priority").value,
                epic: document.getElementById("ticket-epic").value || null,
                assignee: document.getElementById("ticket-assignee").value || null,
                due_date: document.getElementById("ticket-due").value || null,
                story_points: spVal ? parseInt(spVal) : 0,
                project_id: editingTicket ? (editingTicket.project_id ?? currentProjectId) : currentProjectId,
                tags: tagsArray,
                status: document.getElementById("ticket-status").value || (editingTicket && editingTicket.status) || "todo"
            };

            const ticketId = document.getElementById("ticket-id").value;
            const isEditing = !!ticketId;
            const method = isEditing ? 'PUT' : 'POST';
            const url = isEditing ? `${API_BASE}/tickets/${ticketId}` : `${API_BASE}/tickets`;

            try {
                const response = await authFetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(ticketData)
                });

                if (response.ok) {
                    await refreshCurrentView();
                    closePanel();
                } else {
                    const err = await response.json().catch(() => ({}));
                    toast(err.detail || "No se pudo guardar el ticket", "error");
                }
            } catch (error) {
                console.error("Error guardando ticket:", error);
            }
        });
    }
}

async function openEditPanel(ticketId) {
    try {
        const response = await authFetch(`${API_BASE}/tickets`);
        if (!response.ok) return;
        const allTickets = await response.json();
        const ticket = allTickets.find(t => t.id == ticketId);
        
        if (ticket) {
            editingTicket = ticket;
            sidePanel.classList.add("editing");
            fillStatusOptions(ticket.status);
            renderWorklogs(ticket.id);
            document.getElementById("ticket-id").value = ticket.id;
            document.getElementById("ticket-title").value = ticket.title || "";
            document.getElementById("ticket-desc").value = ticket.description || "";
            setSelectValue("ticket-type", ticket.ticket_type, "TASK");
            setSelectValue("ticket-priority", ticket.priority, "MEDIUM");
            await loadEpicOptions(ticket.project_id, ticket.epic);
            document.getElementById("ticket-assignee").value = ticket.assignee || "";
            applyTicketFormRole(ticket.project_id);
            document.getElementById("ticket-due").value = String(ticket.due_date || "").slice(0, 10);
            document.getElementById("ticket-story-points").value = ticket.story_points || 0;
            document.getElementById("ticket-tags").value = ticket.tags ? ticket.tags.join(", ") : "";
            
            panelTitle.textContent = `Editar TB-${ticket.id}`;

            // Generator Branch
            const branchBox = document.getElementById("branch-generator-box");
            const branchText = document.getElementById("branch-name-text");
            const slug = (ticket.title || "task").toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            branchText.textContent = `${norm(ticket.ticket_type) === "bug" ? "fix" : "feature"}/TB-${ticket.id}-${slug}`;
            branchBox.style.display = "block";

            sidePanel.classList.add("open");

            await loadChecklist(ticket.id);
            await loadTicketHistory(ticket.id);
            await loadTicketGithubActivity(ticket.id);
            await loadTicketComments(ticket.id);
        }
    } catch (error) {
        console.error("Error cargando ticket:", error);
    }
}

// COPIAR NOMBRE DE RAMA
const btnCopyBranch = document.getElementById("btn-copy-branch");
if (btnCopyBranch) {
    btnCopyBranch.addEventListener("click", () => {
        const branchText = document.getElementById("branch-name-text").textContent;
        navigator.clipboard.writeText(branchText);
        btnCopyBranch.textContent = "Copiado";
        setTimeout(() => btnCopyBranch.textContent = "Copiar", 2000);
    });
}

// CHECKLIST
async function loadChecklist(ticketId) {
    const sec = document.getElementById("checklist-section");
    const list = document.getElementById("checklist-items-list");
    if (!sec || !list) return;

    sec.style.display = "block";
    try {
        const res = await authFetch(`${API_BASE}/tickets/${ticketId}/checklist`);
        if (!res.ok) return;
        const items = await res.json();

        list.innerHTML = items.map(item => `
            <div class="checklist-item ${item.is_completed ? 'completed' : ''}">
                <input type="checkbox" ${item.is_completed ? 'checked' : ''} onclick="toggleCheckItem(${item.id}, ${!item.is_completed}, ${ticketId})">
                <span>${esc(item.content)}</span>
            </div>
        `).join("");
    } catch (e) {
        console.error("Error cargando checklist:", e);
    }
}

window.toggleCheckItem = async function(itemId, isCompleted, ticketId) {
    try {
        await authFetch(`${API_BASE}/checklist/${itemId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_completed: isCompleted })
        });
        await loadChecklist(ticketId);
    } catch (e) {
        console.error("Error actualizando checklist:", e);
    }
};

const btnAddChecklist = document.getElementById("btn-add-checklist");
if (btnAddChecklist) {
    btnAddChecklist.addEventListener("click", async () => {
        const ticketId = document.getElementById("ticket-id").value;
        const input = document.getElementById("new-checklist-item");
        if (!ticketId || !input.value.trim()) return;

        try {
            await authFetch(`${API_BASE}/tickets/${ticketId}/checklist`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: input.value.trim() })
            });
            input.value = "";
            await loadChecklist(ticketId);
        } catch (e) {
            console.error("Error añadiendo item:", e);
        }
    });
}

// HISTORIAL
async function loadTicketHistory(ticketId) {
    const sec = document.getElementById("history-section");
    const list = document.getElementById("ticket-history-list");
    if (!sec || !list) return;

    sec.style.display = "block";
    try {
        const res = await authFetch(`${API_BASE}/tickets/${ticketId}/history`);
        if (!res.ok) return;
        const history = await res.json();

        if (history.length === 0) {
            list.innerHTML = '<p class="empty-note">Sin cambios registrados.</p>';
            return;
        }

        list.innerHTML = history.map(h => `
            <div class="history-item">
                <strong>@${h.author_username}</strong> cambió <code>${h.field_changed}</code> de '${h.old_value || '-'}' a '${h.new_value || '-'}'
            </div>
        `).join("");
    } catch (e) {
        console.error("Error cargando historial:", e);
    }
}

// GITHUB ACTIVIDAD & COMENTARIOS CON ARCHIVOS
const btnToggleManual = document.getElementById("btn-toggle-manual-commit");
const manualForm = document.getElementById("manual-commit-form");
if (btnToggleManual && manualForm) {
    btnToggleManual.addEventListener("click", () => {
        manualForm.style.display = manualForm.style.display === "none" ? "block" : "none";
    });
}

const btnSaveManualCommit = document.getElementById("btn-save-manual-commit");
if (btnSaveManualCommit) {
    btnSaveManualCommit.addEventListener("click", async () => {
        const ticketId = document.getElementById("ticket-id").value;
        const sha = document.getElementById("manual-commit-sha").value.trim();
        const msg = document.getElementById("manual-commit-msg").value.trim();
        const url = document.getElementById("manual-commit-url").value.trim();

        if (!ticketId || !sha || !msg) {
            alert("Completa al menos el SHA y el mensaje.");
            return;
        }

        try {
            const res = await authFetch(`${API_BASE}/tickets/${ticketId}/github/commits`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ commit_sha: sha, message: msg, url: url || "#" })
            });

            if (res.ok) {
                document.getElementById("manual-commit-sha").value = "";
                document.getElementById("manual-commit-msg").value = "";
                document.getElementById("manual-commit-url").value = "";
                manualForm.style.display = "none";
                await loadTicketGithubActivity(ticketId);
            }
        } catch (e) {
            console.error("Error enlazando commit manual:", e);
        }
    });
}

async function loadTicketGithubActivity(ticketId) {
    const container = document.getElementById("ticket-github-activity");
    if (!container) return;

    try {
        const res = await authFetch(`${API_BASE}/tickets/${ticketId}/github`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.commits.length === 0 && data.pull_requests.length === 0) {
            container.innerHTML = '<p class="empty-note">Sin commits ni PRs vinculados.</p>';
            return;
        }

        let html = "";
        data.pull_requests.forEach(pr => {
            html += `<div class="github-item"><a href="${pr.url}" target="_blank">#${pr.pr_number} ${pr.title} [${pr.state}]</a></div>`;
        });
        data.commits.forEach(c => {
            html += `<div class="github-item"><a href="${c.url}" target="_blank"><code>${c.commit_sha.substring(0, 7)}</code> ${c.message}</a></div>`;
        });
        container.innerHTML = html;
    } catch (e) {
        console.error("Error cargando actividad de GitHub:", e);
    }
}

async function loadTicketComments(ticketId) {
    const list = document.getElementById("ticket-comments-list");
    if (!list) return;

    try {
        const res = await authFetch(`${API_BASE}/tickets/${ticketId}/comments`);
        if (!res.ok) return;
        const comments = await res.json();

        if (comments.length === 0) {
            list.innerHTML = '<p class="empty-note">Aún no hay comentarios.</p>';
            return;
        }

        list.innerHTML = comments.map(c => `
            <div class="comment">
                <span class="avatar-badge">${esc(c.author_avatar || "")}</span>
                <div class="comment-main">
                    <div class="comment-head"><strong>@${esc(c.author_username)}</strong><span>${new Date(c.created_at).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}</span></div>
                    <div class="comment-body">${esc(c.content)}</div>
                    ${c.image_url ? `<a href="${esc(c.image_url)}" target="_blank" rel="noopener"><img class="comment-img" src="${esc(c.image_url)}" alt=""></a>` : ""}
                </div>
            </div>
        `).join("");
        
        list.scrollTop = list.scrollHeight;
    } catch (e) {
        console.error("Error cargando comentarios:", e);
    }
}

const btnSendComment = document.getElementById("btn-send-comment");
if (btnSendComment) {
    btnSendComment.addEventListener("click", async () => {
        const ticketId = document.getElementById("ticket-id").value;
        if (!ticketId) return;

        const text = document.getElementById("comment-text").value.trim();
        const fileInput = document.getElementById("comment-file");

        if (!text && fileInput.files.length === 0) return;

        const formData = new FormData();
        formData.append("content", text);
        if (fileInput.files.length > 0) {
            formData.append("file", fileInput.files[0]);
        }

        try {
            const token = localStorage.getItem("pyckets_token");
            const res = await fetch(`${API_BASE}/tickets/${ticketId}/comments`, {
                method: "POST",
                headers: {
                    ...(token ? { "Authorization": `Bearer ${token}` } : {})
                },
                body: formData
            });

            if (res.ok) {
                document.getElementById("comment-text").value = "";
                fileInput.value = "";
                await loadTicketComments(ticketId);
            }
        } catch (err) {
            console.error("Error guardando comentario:", err);
        }
    });
}

// GITHUB MODAL & SYNC
const githubModal = document.getElementById("github-modal");
const btnProjectRepos = document.getElementById("btn-project-repos");
const btnSyncGithub = document.getElementById("btn-sync-github");
const closeGithubModal = document.getElementById("close-github-modal");
const linkRepoForm = document.getElementById("link-repo-form");

if (btnProjectRepos) {
    btnProjectRepos.addEventListener("click", async () => {
        if (!currentProjectId) return;
        await renderProjectRepos();
        githubModal.style.display = "flex";
    });
}
if (closeGithubModal) closeGithubModal.addEventListener("click", () => githubModal.style.display = "none");

async function renderProjectRepos() {
    const list = document.getElementById("project-repos-list");
    if (!list || !currentProjectId) return;

    try {
        const res = await authFetch(`${API_BASE}/projects/${currentProjectId}/repositories`);
        if (!res.ok) return;
        const repos = await res.json();

        list.innerHTML = repos.map(r => `
            <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                <span><strong>${r.owner}/${r.repo_name}</strong></span>
                <button class="btn" style="padding:2px 6px; font-size:0.7rem; color:#ef4444;" onclick="unlinkRepo(${r.id})">Quitar</button>
            </div>
        `).join("");
    } catch (e) {
        console.error("Error cargando repositorios:", e);
    }
}

if (linkRepoForm) {
    linkRepoForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const owner = document.getElementById("repo-owner").value.trim();
        const repo_name = document.getElementById("repo-name").value.trim();
        const access_token = document.getElementById("repo-token").value.trim();
        const auto_move_tickets = document.getElementById("repo-auto-move").checked;
        const webhook_secret = document.getElementById("repo-webhook-secret").value.trim();

        try {
            const res = await authFetch(`${API_BASE}/projects/${currentProjectId}/repositories`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    owner, repo_name,
                    access_token: access_token || null,
                    auto_move_tickets,
                    webhook_secret: webhook_secret || null
                })
            });

            if (res.ok) {
                linkRepoForm.reset();
                await renderProjectRepos();
            }
        } catch (err) {
            console.error("Error vinculando repo:", err);
        }
    });
}

window.unlinkRepo = async function(repoId) {
    if (!confirm("¿Desvincular repositorio?")) return;
    try {
        const res = await authFetch(`${API_BASE}/projects/${currentProjectId}/repositories/${repoId}`, { method: "DELETE" });
        if (res.ok) await renderProjectRepos();
    } catch (err) {
        console.error("Error desvinculando repo:", err);
    }
};

if (btnSyncGithub) {
    btnSyncGithub.addEventListener("click", async () => {
        if (!currentProjectId) return;
        btnSyncGithub.textContent = "Sincronizando…";
        try {
            const res = await authFetch(`${API_BASE}/projects/${currentProjectId}/github/sync`, { method: "POST" });
            if (res.ok) {
                const data = await res.json();
                alert(`✅ ${data.synced_commits} commits y ${data.synced_prs} PRs sincronizados.`);
                await loadProjectGithubFeed();
            }
        } catch (err) {
            console.error("Error sincronizando:", err);
        } finally {
            btnSyncGithub.textContent = "Sincronizar GitHub";
        }
    });
}

async function loadProjectGithubFeed() {
    const feed = document.getElementById("project-github-feed");
    if (!feed || !currentProjectId) return;

    try {
        const res = await authFetch(`${API_BASE}/projects/${currentProjectId}/github/activity`);
        if (!res.ok) return;
        const data = await res.json();

        let html = "";
        data.pull_requests.forEach(pr => { html += `<div>PR #${pr.pr_number} - ${pr.title} (${pr.state})</div>`; });
        data.commits.forEach(c => { html += `<div><code>${c.commit_sha.substring(0,7)}</code> ${c.message}</div>`; });
        feed.innerHTML = html || "<p style='color:var(--text-muted); font-size:0.85rem;'>Sin actividad reciente.</p>";
    } catch (e) {
        console.error("Error en feed:", e);
    }
}

// ARCHIVADOS Y ELIMINACION DE PROYECTOS
const archivedModal = document.getElementById("archived-projects-modal");
const navArchivedProjects = document.getElementById("nav-archived-projects");
const closeArchivedModal = document.getElementById("close-archived-modal");

if (navArchivedProjects) {
    navArchivedProjects.addEventListener("click", async (e) => {
        e.preventDefault();
        await renderArchivedProjectsList();
        archivedModal.style.display = "flex";
    });
}
if (closeArchivedModal) closeArchivedModal.addEventListener("click", () => archivedModal.style.display = "none");

async function renderArchivedProjectsList() {
    const listContainer = document.getElementById("archived-project-list");
    if (!listContainer) return;

    try {
        const res = await authFetch(`${API_BASE}/projects?include_archived=true`);
        if (!res.ok) return;
        const allProjects = await res.json();
        const archivedProjects = allProjects.filter(p => p.is_archived);

        if (archivedProjects.length === 0) {
            listContainer.innerHTML = "<p style='color: var(--text-muted); font-size: 0.9rem;'>No hay proyectos archivados.</p>";
            return;
        }

        listContainer.innerHTML = archivedProjects.map(p => `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span>${p.name}</span>
                <div>
                    <button class="btn" style="padding:2px 8px; font-size:0.75rem;" onclick="unarchiveProject(${p.id})">Restaurar</button>
                    <button class="btn" style="padding:2px 8px; font-size:0.75rem; color:#ef4444;" onclick="deleteProjectPermanently(${p.id})">Eliminar</button>
                </div>
            </div>
        `).join("");
    } catch (err) {
        console.error("Error cargando archivados:", err);
    }
}

window.unarchiveProject = async function(projectId) {
    try {
        const res = await authFetch(`${API_BASE}/projects/${projectId}/unarchive`, { method: 'PUT' });
        if (res.ok) {
            await loadProjects();
            await renderArchivedProjectsList();
        }
    } catch (err) {
        console.error("Error restaurando:", err);
    }
};

window.deleteProjectPermanently = async function(projectId) {
    if (confirm("⚠️ ¿Eliminar permanentemente este proyecto y sus tickets?")) {
        try {
            const res = await authFetch(`${API_BASE}/projects/${projectId}`, { method: 'DELETE' });
            if (res.ok) {
                await loadProjects();
                await renderArchivedProjectsList();
            }
        } catch (err) {
            console.error("Error eliminando:", err);
        }
    }
};

const btnArchiveProject = document.getElementById("btn-archive-project");
if (btnArchiveProject) {
    btnArchiveProject.addEventListener("click", async () => {
        if (!currentProjectId || !confirm("¿Archivar este proyecto?")) return;
        try {
            const res = await authFetch(`${API_BASE}/projects/${currentProjectId}/archive`, { method: 'PUT' });
            if (res.ok) {
                currentProjectId = null;
                await loadProjects();
                document.getElementById("nav-global-all").click();
            }
        } catch (err) {
            console.error("Error archivando:", err);
        }
    });
}

// GESTION DE USUARIOS GLOBALES Y MIEMBROS DE PROYECTO
const navManageUsers = document.getElementById("nav-manage-users");
const usersModal = document.getElementById("users-modal");
const closeUsersModal = document.getElementById("close-users-modal");
const createUserForm = document.getElementById("create-user-form");

const membersModal = document.getElementById("members-modal");
const btnProjectMembers = document.getElementById("btn-project-members");
const closeMembersModal = document.getElementById("close-members-modal");
const addMemberForm = document.getElementById("add-member-form");

function checkAdminUI() {
    const navBtn = document.getElementById("nav-manage-users");
    if (!navBtn) return;
    const isSu = !!(currentUser && (currentUser.is_superuser || currentUser.username === "adrian"));
    navBtn.style.display = isSu ? "flex" : "none";
    // Crear/archivar proyectos y gestionar accesos es cosa del admin general
    ["btn-open-create-project", "btn-project-members", "btn-archive-project"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = isSu ? "" : "none";
    });
}

if (navManageUsers) {
    navManageUsers.addEventListener("click", async () => {
        await renderGlobalUsers();
        usersModal.style.display = "flex";
    });
}
if (closeUsersModal) closeUsersModal.addEventListener("click", () => usersModal.style.display = "none");

async function renderGlobalUsers() {
    const list = document.getElementById("global-users-list");
    if (!list) return;
    try {
        const res = await authFetch(`${API_BASE}/users`);
        if (!res.ok) return;
        const users = await res.json();
        list.innerHTML = users.map(u => `
            <div style="margin-bottom:6px;">
                <strong>${u.username}</strong> (${u.email}) ${u.is_superuser ? '⚡ Admin' : ''}
            </div>
        `).join("");
    } catch (e) {
        console.error("Error usuarios:", e);
    }
}

if (createUserForm) {
    createUserForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("new-user-name").value;
        const email = document.getElementById("new-user-email").value;
        const password = document.getElementById("new-user-pass").value;

        try {
            const res = await authFetch(`${API_BASE}/users`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, email, password })
            });
            if (res.ok) {
                createUserForm.reset();
                await renderGlobalUsers();
            }
        } catch (err) {
            console.error("Error creando usuario:", err);
        }
    });
}

if (btnProjectMembers) {
    btnProjectMembers.addEventListener("click", async () => {
        if (!currentProjectId) return;
        await loadUsersDropdown();
        await renderProjectMembers();
        membersModal.style.display = "flex";
    });
}
if (closeMembersModal) closeMembersModal.addEventListener("click", () => membersModal.style.display = "none");

async function loadUsersDropdown() {
    const select = document.getElementById("select-user-id");
    if (!select) return;
    try {
        const res = await authFetch(`${API_BASE}/users`);
        if (res.ok) {
            const users = await res.json();
            select.innerHTML = '<option value="">Seleccionar Usuario...</option>' + 
                users.map(u => `<option value="${u.id}">${u.username} (${u.email})</option>`).join("");
        }
    } catch (e) {
        select.innerHTML = '<option value="">Cargando usuarios...</option>';
    }
}

async function renderProjectMembers() {
    const list = document.getElementById("project-members-list");
    if (!list || !currentProjectId) return;

    try {
        const res = await authFetch(`${API_BASE}/projects/${currentProjectId}/members`);
        if (!res.ok) return;
        const members = await res.json();

        list.innerHTML = members.map(m => `
            <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                <span><strong>${m.username}</strong> (${m.role})</span>
                <button class="btn" style="padding:2px 6px; font-size:0.7rem; color:#ef4444;" onclick="removeMember(${m.user_id})">Quitar</button>
            </div>
        `).join("");
    } catch (e) {
        console.error("Error miembros:", e);
    }
}

if (addMemberForm) {
    addMemberForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const userId = document.getElementById("select-user-id").value;
        const role = document.getElementById("select-member-role").value;

        if (!userId || !currentProjectId) return;

        try {
            const formData = new FormData();
            formData.append("user_id", userId);
            formData.append("role", role);

            const token = localStorage.getItem("pyckets_token");
            const res = await fetch(`${API_BASE}/projects/${currentProjectId}/members`, {
                method: "POST",
                headers: { ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
                body: formData
            });
            if (res.ok) await renderProjectMembers();
        } catch (err) {
            console.error("Error añadiendo miembro:", err);
        }
    });
}

window.removeMember = async function(userId) {
    if (!currentProjectId || !confirm("¿Quitar acceso a este miembro?")) return;
    try {
        const res = await authFetch(`${API_BASE}/projects/${currentProjectId}/members/${userId}`, { method: "DELETE" });
        if (res.ok) await renderProjectMembers();
    } catch (err) {
        console.error("Error quitando miembro:", err);
    }
};

// PERFIL DE USUARIO
const profileModal = document.getElementById("profile-modal");
const btnOpenProfile = document.getElementById("btn-open-profile");
const closeProfileModal = document.getElementById("close-profile-modal");
const profileForm = document.getElementById("profile-form");
const passwordForm = document.getElementById("password-form");
let selectedAvatar = "🚀";

function updateProfileUI(user) {
    if (!user) return;
    currentUser = user;
    
    const badge = document.getElementById("user-avatar-badge");
    const handle = document.getElementById("user-handle-text");
    if (badge) badge.textContent = user.avatar || "🚀";
    if (handle) handle.textContent = `@${user.username}`;
    const mn = document.getElementById("menu-name"), me = document.getElementById("menu-email");
    if (mn) mn.textContent = user.first_name ? `${user.first_name} ${user.last_name || ""}`.trim() : `@${user.username}`;
    if (me) me.textContent = user.email || "";

    checkAdminUI();

    document.documentElement.setAttribute("data-theme", user.theme_preference === "light" ? "light" : "dark");
}

if (btnOpenProfile) {
    btnOpenProfile.addEventListener("click", () => {
        if (!currentUser) return;
        
        document.getElementById("profile-username").value = `@${currentUser.username}`;
        document.getElementById("profile-email").value = currentUser.email;
        document.getElementById("profile-firstname").value = currentUser.first_name || "";
        document.getElementById("profile-lastname").value = currentUser.last_name || "";
        document.getElementById("profile-theme").value = currentUser.theme_preference || "dark";
        
        selectedAvatar = currentUser.avatar || "🚀";
        profileModal.style.display = "flex";
    });
}
if (closeProfileModal) closeProfileModal.addEventListener("click", () => profileModal.style.display = "none");

const avatarPicker = document.getElementById("avatar-picker");
if (avatarPicker) {
    avatarPicker.querySelectorAll(".avatar-option").forEach(opt => {
        opt.addEventListener("click", () => {
            selectedAvatar = opt.dataset.avatar;
            avatarPicker.querySelectorAll(".avatar-option").forEach(o => o.style.border = "none");
            opt.style.border = "2px solid var(--primary)";
        });
    });
}

if (profileForm) {
    profileForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            const res = await authFetch(`${API_BASE}/auth/me`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    first_name: document.getElementById("profile-firstname").value,
                    last_name: document.getElementById("profile-lastname").value,
                    avatar: selectedAvatar,
                    theme_preference: document.getElementById("profile-theme").value
                })
            });

            if (res.ok) {
                const updatedUser = await res.json();
                updateProfileUI(updatedUser);
                profileModal.style.display = "none";
            }
        } catch (err) {
            console.error("Error guardando perfil:", err);
        }
    });
}

if (passwordForm) {
    passwordForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            const res = await authFetch(`${API_BASE}/auth/me/password`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    current_password: document.getElementById("pwd-current").value,
                    new_password: document.getElementById("pwd-new").value
                })
            });

            if (res.ok) {
                alert("Contraseña actualizada con éxito");
                passwordForm.reset();
            }
        } catch (err) {
            console.error("Error cambiando contraseña:", err);
        }
    });
}

// COMMAND PALETTE (CTRL + K)
const commandPaletteModal = document.getElementById("command-palette-modal");
const commandPaletteInput = document.getElementById("command-palette-input");
const commandPaletteList = document.getElementById("command-palette-list");
const btnTriggerPalette = document.getElementById("btn-trigger-command-palette");

let paletteItems = [];
let paletteTickets = null;

function openCommandPalette() {
    if (!commandPaletteModal) return;
    commandPaletteModal.style.display = "flex";
    commandPaletteInput.value = "";
    renderCommandActions(buildCommands(""));
    paletteTickets = null;
    authFetch(`${API_BASE}/tickets`).then(r => r.ok ? r.json() : []).then(list => {
        paletteTickets = list;
        if (commandPaletteModal.style.display !== "none" && commandPaletteInput.value.trim().length >= 2) renderCommandActions(buildCommands(commandPaletteInput.value));
    }).catch(() => {});
    setTimeout(() => commandPaletteInput.focus(), 60);
}

function closeCommandPalette() {
    if (commandPaletteModal) commandPaletteModal.style.display = "none";
}

function renderCommandActions(items) {
    if (!commandPaletteList) return;
    paletteItems = items;
    if (!items.length) { commandPaletteList.innerHTML = '<div class="command-empty">Sin resultados</div>'; return; }
    let last = null, html = "";
    items.forEach((it, i) => {
        if (it.group !== last) { html += `<div class="command-group">${esc(it.group)}</div>`; last = it.group; }
        html += `<div class="command-item ${i === 0 ? "selected" : ""}" data-index="${i}">
            <span class="ci-icon">${svg(PALETTE_ICONS[it.icon] || "")}</span><span class="ci-title">${esc(it.title)}</span>
            ${it.hint ? `<span class="ci-hint">${esc(it.hint)}</span>` : ""}<kbd>Enter</kbd></div>`;
    });
    commandPaletteList.innerHTML = html;
    commandPaletteList.querySelectorAll(".command-item").forEach(el => {
        el.addEventListener("click", () => { const it = paletteItems[+el.dataset.index]; closeCommandPalette(); if (it) it.action(); });
    });
}

if (btnTriggerPalette) btnTriggerPalette.addEventListener("click", openCommandPalette);

document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openCommandPalette();
    }
    if (e.key === "Escape") {
        closeCommandPalette();
        if (profileModal) profileModal.style.display = "none";
        if (usersModal) usersModal.style.display = "none";
        if (membersModal) membersModal.style.display = "none";
        if (archivedModal) archivedModal.style.display = "none";
        if (githubModal) githubModal.style.display = "none";
    }
});

if (commandPaletteInput) {
    commandPaletteInput.addEventListener("input", (e) => renderCommandActions(buildCommands(e.target.value)));
}

// NAVEGACION: ver el módulo "v13" al final del archivo

const toggleSidebarBtn = document.getElementById('toggle-sidebar');
const sidebar = document.getElementById('sidebar');

if (toggleSidebarBtn && sidebar) {
    toggleSidebarBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });
}

const themeToggleBtn = document.getElementById("theme-toggle");
if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
        const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", next);
    });
}

// Seleccionar todos en la vista lista
const selectAll = document.getElementById("select-all-tickets");
if (selectAll) {
    selectAll.addEventListener("change", () => {
        document.querySelectorAll(".ticket-select-check").forEach(chk => {
            chk.checked = selectAll.checked;
            const id = parseInt(chk.dataset.id);
            if (selectAll.checked) selectedTicketIds.add(id); else selectedTicketIds.delete(id);
        });
        updateBulkToolbar();
    });
}

// Paleta de comandos: navegación con teclado
if (commandPaletteInput) {
    commandPaletteInput.addEventListener("keydown", (e) => {
        const items = [...commandPaletteList.querySelectorAll(".command-item")];
        if (!items.length) return;
        let i = Math.max(items.findIndex(el => el.classList.contains("selected")), 0);
        if (e.key === "Enter") { e.preventDefault(); items[i].click(); return; }
        if (e.key === "ArrowDown") i = (i + 1) % items.length;
        else if (e.key === "ArrowUp") i = (i - 1 + items.length) % items.length;
        else return;
        e.preventDefault();
        items.forEach((el, k) => el.classList.toggle("selected", k === i));
        items[i].scrollIntoView({ block: "nearest" });
    });
}


// ===== v11: contexto de proyecto, dashboard, ticket rápido/completo, horas, cuenta =====
function fillStatusOptions(sel) {
    const el = document.getElementById("ticket-status");
    if (!el || !globalColumns.length) return;
    el.innerHTML = globalColumns.map(c => `<option value="${statusIdOf(c.name)}">${esc(titleCase(c.name))}</option>`).join("");
    el.value = norm(sel) || statusIdOf(globalColumns[0].name);
}

// Panel: columnas principal/lateral y modo completo
(function () {
    const f = document.getElementById("ticket-form"); if (!f) return;
    const actions = f.querySelector(".form-actions"), title = document.getElementById("ticket-title").closest(".form-group");
    const cols = document.createElement("div"), main = document.createElement("div"), side = document.createElement("div");
    cols.className = "fp-cols"; main.className = "fp-main"; side.className = "fp-side";
    const isMain = el => el.id === "checklist-section" || el.id === "history-section" || el.querySelector("#ticket-desc, #ticket-github-activity, #ticket-comments-list");
    [...f.children].forEach(k => { if (k === actions || k === title || k.type === "hidden") return; if (k.querySelector && k.querySelector("#ticket-desc")) k.classList.add("keep");
        (isMain(k) ? main : side).appendChild(k); });
    cols.append(main, side); f.insertBefore(cols, actions);
    document.getElementById("btn-expand-panel").addEventListener("click", () => sidePanel.classList.toggle("full"));
})();

// Registro de horas (localStorage hasta que exista endpoint /tickets/{id}/worklogs)
const wlKey = id => `pyckets_worklogs_${id}`;
const loadWl = id => { try { return JSON.parse(localStorage.getItem(wlKey(id)) || "[]"); } catch { return []; } };
function renderWorklogs(id) {
    const logs = loadWl(id), total = logs.reduce((a, l) => a + l.h, 0);
    document.getElementById("worklog-total").textContent = `${+total.toFixed(2)} h`;
    document.getElementById("worklog-list").innerHTML = logs.slice().reverse().slice(0, 5).map(l =>
        `<div class="worklog-item"><span>${l.h} h${l.note ? " · " + esc(l.note) : ""}</span><span>@${esc(l.by || "?")} · ${new Date(l.at).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</span></div>`).join("");
}
document.getElementById("btn-log-time").addEventListener("click", () => {
    const hrs = parseFloat(document.getElementById("worklog-hours").value);
    if (!(hrs > 0) || !editingTicket) return;
    const logs = loadWl(editingTicket.id);
    logs.push({ h: hrs, note: document.getElementById("worklog-note").value.trim(), by: currentUser && currentUser.username, at: Date.now() });
    localStorage.setItem(wlKey(editingTicket.id), JSON.stringify(logs));
    document.getElementById("worklog-hours").value = ""; document.getElementById("worklog-note").value = "";
    renderWorklogs(editingTicket.id);
});

// Menú de usuario (arriba a la derecha)
const accMenu = document.getElementById("account-menu");
const userMenuBtn = document.getElementById("btn-user-menu");
function toggleUserMenu(open) {
    const show = open === undefined ? accMenu.style.display === "none" : open;
    accMenu.style.display = show ? "block" : "none";
    userMenuBtn.setAttribute("aria-expanded", String(show));
}
userMenuBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleUserMenu(); });
document.addEventListener("click", (e) => { if (!e.target.closest("#account-menu")) toggleUserMenu(false); });
accMenu.addEventListener("click", (e) => { if (e.target.closest(".nav-item")) toggleUserMenu(false); });
document.getElementById("menu-theme").addEventListener("click", () => document.getElementById("theme-toggle").click());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleUserMenu(false); });


// ===== Roles por proyecto y épicas =====
const isProjectAdmin = (pid) => ["owner", "admin"].includes(projectRoles[pid]);

// Épicas, asignación y proyecto solo los cambia un admin del proyecto
function applyTicketFormRole(pid) {
    const admin = isProjectAdmin(pid);
    ["ticket-epic", "ticket-assignee"].forEach(id => { document.getElementById(id).disabled = !admin; });
}

async function loadEpicOptions(projectId, selected) {
    const sel = document.getElementById("ticket-epic");
    sel.innerHTML = '<option value="">Sin épica</option>';
    if (projectId) {
        try {
            const res = await authFetch(`${API_BASE}/projects/${projectId}/epics`);
            if (res.ok) (await res.json()).forEach(e => sel.insertAdjacentHTML("beforeend", `<option value="${esc(e.name)}">${esc(e.name)}</option>`));
        } catch (err) { console.error("Error cargando épicas:", err); }
    }
    if (selected && ![...sel.options].some(o => o.value === selected)) {
        sel.insertAdjacentHTML("beforeend", `<option value="${esc(selected)}">${esc(selected)}</option>`);
    }
    sel.value = selected || "";
}


// =====================================================================
// v13 · Navegación unificada, Inicio, Mi trabajo y Resumen de proyecto
// =====================================================================
const ROLE_LABEL = { owner: "Propietario", admin: "Admin", member: "Miembro", viewer: "Lectura" };
const roleLabel = (role) => (currentUser && currentUser.is_superuser) ? "Admin general" : (ROLE_LABEL[role] || role || "");

function svg(inner) {
    return `<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function prioIcon(p, withLabel = false) {
    p = norm(p) || "medium";
    const label = PRIO_LABEL[p] || titleCase(p);
    let inner;
    if (p === "urgent") {
        inner = '<rect x="2.5" y="2.5" width="11" height="11" rx="3.2" fill="currentColor" stroke="none"/><path d="M8 5.3v3.5" stroke="#fff" stroke-width="1.7"/><circle cx="8" cy="10.9" r="0.95" fill="#fff" stroke="none"/>';
    } else {
        const n = { high: 3, medium: 2, low: 1 }[p] || 2;
        inner = [0, 1, 2].map(i => { const h = 4 + i * 3; return `<rect x="${2.5 + i * 4.2}" y="${13 - h}" width="2.6" height="${h}" rx="0.9" fill="currentColor" stroke="none" opacity="${i < n ? 1 : 0.28}"/>`; }).join("");
    }
    return `<span class="prio-chip prio-${esc(p)}" title="Prioridad: ${esc(label)}">${svg(inner)}${withLabel ? `<span class="prio-label">${esc(label)}</span>` : ""}</span>`;
}

function statusIcon(s) {
    s = norm(s) || "todo";
    const last = globalColumns.length ? statusIdOf(globalColumns[globalColumns.length - 1].name) : "done";
    const kind = s === last || s === "done" ? "done" : (["halted", "in_progress"].includes(s) ? s : "todo");
    const inner = {
        todo: '<circle cx="8" cy="8" r="5.5" stroke-dasharray="2.2 2.2"/>',
        halted: '<circle cx="8" cy="8" r="5.5"/><path d="M6.6 6v4M9.4 6v4" stroke-width="1.6"/>',
        in_progress: '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.6a3.4 3.4 0 0 1 0 6.8z" fill="currentColor" stroke="none"/>',
        done: '<circle cx="8" cy="8" r="6" fill="currentColor" stroke="none"/><path d="m5.6 8.2 1.7 1.7 3.2-3.4" stroke="#fff" stroke-width="1.7"/>'
    }[kind];
    return `<span class="si si-${kind}" title="${esc(statusLabel(s))}">${svg(inner)}</span>`;
}

const dueLabel = (t) => {
    if (!t.due_date) return "<span></span>";
    const label = new Date(String(t.due_date).slice(0, 10) + "T00:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" });
    return `<span class="due ${t.overdue ? "overdue" : ""}" title="Fecha límite">${label}</span>`;
};

function ticketRow(t, i = 0) {
    return `<div class="trow" style="--i:${i}" data-id="${t.id}" role="button" tabindex="0">
        ${statusIcon(t.status)}${prioIcon(t.priority)}<span class="key">TB-${t.id}</span>
        <span class="t">${esc(t.title)}</span>
        ${t.epic ? `<span class="epic-chip">${esc(t.epic)}</span>` : "<span></span>"}
        ${dueLabel(t)}
    </div>`;
}

function openRowOnClick(containerId) {
    const el = document.getElementById(containerId);
    const open = (e) => { const r = e.target.closest(".trow"); if (r) openEditPanel(r.dataset.id); };
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") open(e); });
}

// ---------- navegación por niveles: Inicio / Mi trabajo · Proyecto (resumen por épicas) · Épica (resumen, tablero, lista) ----------
const VIEW_ELS = ["view-home", "view-mywork", "project-home", "epic-home", "board-container", "list-container"];

function playItems(el) {
    if (!el) return;
    el.classList.remove("enter-items");
    void el.offsetWidth;
    el.classList.add("enter-items");
    clearTimeout(el._itemsT);
    el._itemsT = setTimeout(() => el.classList.remove("enter-items"), 1200);
}

function showOnly(id) {
    VIEW_ELS.forEach(v => {
        const el = document.getElementById(v);
        if (!el) return;
        const visible = v === id;
        el.style.display = visible ? (v === "board-container" ? "flex" : "block") : "none";
        el.classList.remove("enter-view");
        if (visible) {
            void el.offsetWidth;
            el.classList.add("enter-view");
            clearTimeout(el._viewT);
            el._viewT = setTimeout(() => el.classList.remove("enter-view"), 700);
        }
    });
}

function syncSidebarActive() {
    document.querySelectorAll(".sidebar .nav-item").forEach(n => n.classList.remove("active", "parent-active"));
    if (currentView === "home") { navGlobalAll.classList.add("active"); return; }
    if (currentView === "mywork") { navGlobalMine.classList.add("active"); return; }
    const link = document.querySelector(`.project-link[data-id="${currentProjectId}"]`);
    if (!link) return;
    if (currentView === "project") { link.classList.add("active"); return; }
    link.classList.add("parent-active");
    const epicLink = [...document.querySelectorAll(".nav-epic")].find(a => a.dataset.epic === currentEpic);
    if (epicLink) epicLink.classList.add("active");
}

function positionTabIndicator() {
    const tabs = document.getElementById("project-tabs"), ind = tabs && tabs.querySelector(".tab-indicator"), active = tabs && tabs.querySelector(".tab.active");
    if (!ind || !active) return;
    ind.style.width = active.offsetWidth + "px";
    ind.style.transform = `translateX(${active.offsetLeft}px)`;
}
window.addEventListener("resize", positionTabIndicator);

function setHeader({ html, tabs = false, search = false, newTicket = false }) {
    document.getElementById("board-title").innerHTML = html;
    document.getElementById("project-tabs").style.display = tabs ? "flex" : "none";
    if (tabs) positionTabIndicator();
    const sc = document.querySelector(".top-header .search-container");
    if (sc) sc.style.display = search ? "" : "none";
    document.getElementById("quick-filters").style.display = search ? "flex" : "none";
    if (headerNewTicketBtn) headerNewTicketBtn.style.display = newTicket ? "inline-flex" : "none";
    if (btnToggleView) btnToggleView.style.display = "none";
}

const projectCrumb = (p) => `<span class="crumb-current"><span class="crumb-dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</span>`;
function epicCrumbs(p) {
    const none = currentEpic === NO_EPIC;
    const known = (epicsCache[p.id] || []).find(e => e.name === currentEpic);
    const color = none ? "var(--text-faint)" : (known ? known.color : "var(--primary)");
    return `<a class="crumb" data-go="project" href="#"><span class="crumb-dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</a>
        <span class="crumb-sep">›</span>
        <span class="crumb-current"><span class="crumb-dot" style="background:${esc(color)}"></span>${esc(none ? "Sin épica" : currentEpic)}</span>`;
}
document.getElementById("board-title").addEventListener("click", (e) => {
    if (e.target.closest("[data-go]")) { e.preventDefault(); navigate("project", { projectId: currentProjectId }); }
});

async function navigate(view, opts = {}) {
    let p = null;
    if (view === "project" || view === "epic") {
        p = opts.project || projectsById[opts.projectId];
        if (!p) return navigate("home");
        currentProjectId = p.id;
    } else {
        currentProjectId = null;
    }
    currentView = view;
    if (view === "home") {
        currentEpic = null;
        syncSidebarActive();
        document.querySelectorAll(".nav-children").forEach(el => el.remove());
        setHeader({ html: "Inicio" });
        showOnly("view-home");
        await loadHome();
    } else if (view === "mywork") {
        currentEpic = null;
        syncSidebarActive();
        document.querySelectorAll(".nav-children").forEach(el => el.remove());
        setHeader({ html: "Mi trabajo" });
        showOnly("view-mywork");
        await loadMyWork();
    } else if (view === "project") {
        currentEpic = null;
        syncSidebarActive();
        setHeader({ html: projectCrumb(p), newTicket: p.my_role !== "viewer" });
        showOnly("project-home");
        renderSidebarEpics(p.id);
        await loadProjectSummary();
    } else if (view === "epic") {
        currentEpic = opts.epic;
        if (searchInput) searchInput.value = opts.search || "";
        syncSidebarActive();
        renderSidebarEpics(p.id, true);
        await setTab(opts.tab || "summary");
    }
}

async function setTab(tab, load = true) {
    currentTab = tab;
    const p = projectsById[currentProjectId];
    if (!p || currentView !== "epic") return;
    setHeader({ html: epicCrumbs(p), tabs: true, search: tab !== "summary", newTicket: p.my_role !== "viewer" });
    document.querySelectorAll("#project-tabs .tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
    positionTabIndicator();
    isListView = tab === "list";
    showOnly(tab === "summary" ? "epic-home" : tab === "board" ? "board-container" : "list-container");
    if (!load) return;
    await fetchAndRenderTickets();
    if (tab === "summary") renderEpicSummary();
    if (tab === "board") playItems(document.getElementById("board-container"));
}

async function refreshCurrentView() {
    if (currentView === "home") return loadHome();
    if (currentView === "mywork") return loadMyWork();
    if (currentView === "project") return loadProjectSummary();
    if (currentView === "epic") { await fetchAndRenderTickets(); if (currentTab === "summary") renderEpicSummary(); }
}
document.querySelectorAll("#project-tabs .tab").forEach(t => t.addEventListener("click", () => setTab(t.dataset.tab)));

// ---------- sidebar: épicas del proyecto abierto ----------
async function loadProjectEpics(pid, force = false) {
    if (!force && epicsCache[pid]) return epicsCache[pid];
    try {
        const res = await authFetch(`${API_BASE}/projects/${pid}/epics`);
        if (res.ok) epicsCache[pid] = (await res.json()).map(e => ({ id: e.id, name: e.name, color: e.color, open: e.tickets_total - e.tickets_done }));
    } catch (err) { console.error("Error cargando épicas:", err); }
    return epicsCache[pid] || [];
}
async function renderSidebarEpics(pid, useCache = false) {
    const epics = await loadProjectEpics(pid, !useCache);
    if (currentProjectId !== pid) return;
    document.querySelectorAll(".nav-children").forEach(el => el.remove());
    const link = document.querySelector(`.project-link[data-id="${pid}"]`);
    if (!link) return;
    const box = document.createElement("div");
    box.className = "nav-children";
    const item = (name, color, count, i, label) => `<a href="#" class="nav-item nav-epic" style="--i:${i}" data-epic="${esc(name)}" title="${esc(label)}">
        <span class="dot" style="background:${esc(color)}"></span><span class="text">${esc(label)}</span><span class="nav-count">${count}</span></a>`;
    box.innerHTML = epics.map((e, i) => item(e.name, e.color, e.open, i, e.name)).join("") + item(NO_EPIC, "var(--text-faint)", "", epics.length, "Sin épica");
    link.after(box);
    playItems(box);
    syncSidebarActive();
}
document.getElementById("project-list").addEventListener("click", (e) => {
    const a = e.target.closest(".nav-epic");
    if (!a) return;
    e.preventDefault();
    navigate("epic", { projectId: currentProjectId, epic: a.dataset.epic });
});
async function afterEpicChange() {
    const pid = currentProjectId;
    await loadProjectEpics(pid, true);
    if (currentView === "project") await loadProjectSummary(); else renderSidebarEpics(pid, true);
}

// ---------- paleta de comandos (Ctrl+K) ----------
const PALETTE_ICONS = {
    home: '<path d="M2.5 7.2 8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5z"/>',
    work: '<path d="m3 4.5 1.2 1.2L6.5 3.5M3 10.5l1.2 1.2 2.3-2.2M9 5h4M9 11h4"/>',
    folder: '<path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/>',
    layers: '<path d="m8 2.5 5.5 3L8 8.5l-5.5-3z"/><path d="m2.5 8.5 5.5 3 5.5-3"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    board: '<rect x="2.5" y="3" width="3.2" height="10" rx="1"/><rect x="6.4" y="3" width="3.2" height="6.5" rx="1"/><rect x="10.3" y="3" width="3.2" height="8" rx="1"/>',
    list: '<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><circle cx="2.8" cy="4" r=".6"/><circle cx="2.8" cy="8" r=".6"/><circle cx="2.8" cy="12" r=".6"/>',
    summary: '<path d="M3 13V8M8 13V3M13 13V6"/>',
    user: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13c0-2.5 2.2-4 5-4s5 1.5 5 4"/>',
    users: '<circle cx="6" cy="5.5" r="2.3"/><path d="M1.8 13c0-2.2 1.9-3.6 4.2-3.6s4.2 1.4 4.2 3.6"/><path d="M10.5 3.5a2.3 2.3 0 0 1 0 4.4M12 9.6c1.4.4 2.2 1.5 2.2 3.4"/>',
    archive: '<rect x="2.5" y="3" width="11" height="2.8" rx=".8"/><path d="M3.5 5.8V13h9V5.8M6.5 8.5h3"/>',
    moon: '<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.3 4.3 0 0 0 6.5 6.5z"/>',
    sidebar: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M6 3v10"/>',
    logout: '<path d="M6.5 3H3.5v10h3M10 5.5 12.5 8 10 10.5M12.5 8H6.5"/>',
    ticket: '<path d="M3 5.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1V7a1.2 1.2 0 0 0 0 2v1.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1.2 1.2 0 0 0 0-2z"/>',
    back: '<path d="M9.5 4 5.5 8l4 4"/>'
};

function buildCommands(query) {
    const q = norm(query).trim();
    const items = [];
    const add = (group, title, icon, action, hint = "", kw = "") => items.push({ group, title, icon, action, hint, kw: norm(`${title} ${group} ${kw}`) });
    const proj = (currentView === "project" || currentView === "epic") ? projectsById[currentProjectId] : null;
    const canCreate = proj && proj.my_role !== "viewer";
    const admin = proj && isProjectAdmin(proj.id);
    const su = !!(currentUser && currentUser.is_superuser);

    if (currentView === "epic" && proj) {
        add("En esta épica", "Resumen", "summary", () => setTab("summary"), "", "vista");
        add("En esta épica", "Tablero", "board", () => setTab("board"), "", "vista kanban");
        add("En esta épica", "Lista", "list", () => setTab("list"), "", "vista tabla");
        add("En esta épica", `Volver a ${proj.name}`, "back", () => navigate("project", { projectId: proj.id }), "", "proyecto atras");
    }
    if (canCreate) add("Crear", "Nuevo ticket", "ticket", () => headerNewTicketBtn.click(), currentEpic && currentEpic !== NO_EPIC ? `en ${currentEpic}` : `en ${proj.name}`, "tarea crear");
    if (admin) add("Crear", "Nueva épica", "layers", () => openEpicModal(), `en ${proj.name}`, "crear epica tablero");
    if (su) add("Crear", "Nuevo proyecto", "folder", () => openProjectModal(), "", "crear");
    if (proj && su) add("Proyecto actual", "Gestionar miembros", "users", () => document.getElementById("btn-project-members").click(), proj.name, "accesos permisos");

    add("Ir a", "Inicio", "home", () => navigate("home"), "", "dashboard proyectos");
    add("Ir a", "Mi trabajo", "work", () => navigate("mywork"), "", "mis tickets asignados");
    Object.values(projectsById).forEach(p => add("Proyectos", p.name, "folder", () => navigate("project", { project: p }), p.id === currentProjectId ? "actual" : "", "proyecto"));
    if (proj) {
        (epicsCache[proj.id] || []).forEach(e => add("Épicas", e.name, "layers", () => navigate("epic", { projectId: proj.id, epic: e.name }), proj.name, "epica tablero"));
        add("Épicas", "Sin épica", "layers", () => navigate("epic", { projectId: proj.id, epic: NO_EPIC }), proj.name, "epica tablero");
    }
    add("Cuenta", "Mi perfil", "user", () => btnOpenProfile.click(), "", "avatar contraseña");
    if (su) add("Cuenta", "Gestión de usuarios", "users", () => document.getElementById("nav-manage-users").click(), "", "admin");
    add("Cuenta", "Proyectos archivados", "archive", () => navArchivedProjects.click());
    add("Preferencias", "Cambiar tema claro / oscuro", "moon", () => document.getElementById("theme-toggle").click(), "", "apariencia");
    add("Preferencias", "Plegar o desplegar la barra lateral", "sidebar", () => toggleSidebarBtn.click());
    add("Cuenta", "Cerrar sesión", "logout", () => document.getElementById("btn-logout").click(), "", "salir");

    if (!q) return items;
    const words = q.split(/\s+/);
    const found = items.filter(it => words.every(w => it.kw.includes(w)));
    if (q.length >= 2 && paletteTickets) {
        paletteTickets
            .filter(t => words.every(w => norm(`tb-${t.id} ${t.title} ${t.assignee || ""}`).includes(w)))
            .slice(0, 6)
            .forEach(t => {
                const pr = projectsById[t.project_id];
                found.push({ group: "Tickets", title: t.title, icon: "ticket", hint: `TB-${t.id}${pr ? " · " + pr.name : ""}`, action: () => openEditPanel(t.id) });
            });
    }
    return found;
}

if (navGlobalAll) navGlobalAll.addEventListener("click", (e) => { e.preventDefault(); navigate("home"); });
if (navGlobalMine) navGlobalMine.addEventListener("click", (e) => { e.preventDefault(); navigate("mywork"); });
const btnHomeNewProject = document.getElementById("btn-home-new-project");
if (btnHomeNewProject) btnHomeNewProject.addEventListener("click", () => document.getElementById("btn-open-create-project").click());


// ---------- Inicio ----------
const kpi = (value, label, { warn = false, extra = "" } = {}) =>
    `<div class="kpi ${warn ? "warn" : ""}"><div class="v">${value}</div><div class="l">${label}</div>${extra}</div>`;

function statusSegments(byStatus) {
    const order = globalColumns.map(c => statusIdOf(c.name));
    Object.keys(byStatus).forEach(s => { if (!order.includes(s)) order.push(s); });
    return order.filter(s => byStatus[s]).map(s => `<i class="seg st-${esc(s)}" style="flex:${byStatus[s]}" title="${esc(statusLabel(s))}: ${byStatus[s]}"></i>`).join("");
}

async function loadHome() {
    const [cRes, wRes, colRes] = await Promise.all([
        authFetch(`${API_BASE}/dashboard`), authFetch(`${API_BASE}/me/work`), authFetch(`${API_BASE}/columns`)
    ]);
    if (!cRes.ok) return;
    const cards = await cRes.json();
    const work = wRes.ok ? await wRes.json() : { total_open: 0, overdue: 0 };
    if (colRes.ok) { globalColumns = await colRes.json(); fillStatusOptions(); }

    const d = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
    document.getElementById("home-subtitle").textContent = d.charAt(0).toUpperCase() + d.slice(1);
    const isSu = !!(currentUser && currentUser.is_superuser);
    if (btnHomeNewProject) btnHomeNewProject.style.display = isSu ? "" : "none";

    document.getElementById("home-summary").innerHTML =
        kpi(cards.length, "Proyectos activos") +
        kpi(work.total_open, "Mis tickets abiertos") +
        kpi(work.overdue, "Mis tickets vencidos", { warn: work.overdue > 0 }) +
        kpi(cards.reduce((a, c) => a + c.overdue, 0), "Vencidos en los proyectos", { warn: cards.some(c => c.overdue > 0) });

    const grid = document.getElementById("home-projects");
    if (!cards.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><b>${isSu ? "Aún no hay proyectos" : "Todavía no tienes proyectos asignados"}</b>${isSu ? "Crea el primero con «Nuevo proyecto»." : "Un administrador te dará acceso."}</div>`;
    } else {
        grid.innerHTML = cards.map((c, i) => `
            <div class="project-card" style="--i:${i}" data-id="${c.id}" role="button" tabindex="0">
                <div class="pc-head"><span class="swatch" style="background:${esc(c.color)}"></span><h3>${esc(c.name)}</h3><span class="chip">${esc(roleLabel(c.my_role))}</span></div>
                <div class="pc-progress"><div class="pc-pct">${c.progress}<small>%</small></div><div class="pc-sub">${c.done} de ${c.total} completados</div></div>
                <div class="statusbar">${statusSegments(c.by_status)}</div>
                <dl class="pc-stats">
                    <div><dt>Abiertos</dt><dd>${c.total - c.done}</dd></div>
                    <div><dt>Vencidos</dt><dd class="${c.overdue ? "warn" : ""}">${c.overdue}</dd></div>
                    <div><dt>Míos</dt><dd>${c.my_open}</dd></div>
                    <div><dt>Épicas</dt><dd>${c.epics}</dd></div>
                </dl>
            </div>`).join("");
    }
    playItems(document.getElementById("home-summary"));
    playItems(grid);
    homeReady = true;
}
(function () {
    const grid = document.getElementById("home-projects");
    const go = (e) => { const c = e.target.closest(".project-card"); if (c) navigate("project", { projectId: +c.dataset.id }); };
    grid.addEventListener("click", go);
    grid.addEventListener("keydown", (e) => { if (e.key === "Enter") go(e); });
})();

// ---------- Mi trabajo ----------
async function loadMyWork() {
    const res = await authFetch(`${API_BASE}/me/work`);
    if (!res.ok) return;
    const w = await res.json();
    document.getElementById("mywork-subtitle").textContent = `${w.total_open} abiertos · ${w.overdue} vencidos`;
    const body = document.getElementById("mywork-body");
    if (!w.groups.length) {
        body.innerHTML = '<div class="section-card"><div class="empty-state"><b>No tienes tickets abiertos</b>Lo que te asignen aparecerá aquí, con los vencidos primero.</div></div>';
        return;
    }
    body.innerHTML = w.groups.map(g => `
        <div class="section-card" style="margin-bottom: 14px;">
            <div class="group-head"><span class="swatch" style="background:${esc(g.project_color)}"></span>${esc(g.project_name)}<span class="count">${g.tickets.length}</span></div>
            ${g.tickets.map((t, i) => ticketRow(t, i)).join("")}
        </div>`).join("");
    playItems(body);
}
openRowOnClick("mywork-body");

// ---------- Resumen de proyecto ----------
let projectEpics = {};
async function loadProjectSummary() {
    const id = currentProjectId;
    const res = await authFetch(`${API_BASE}/projects/${id}/dashboard`);
    if (!res.ok) { toast("No se pudo cargar el resumen del proyecto", "error"); return; }
    const d = await res.json();
    if (id !== currentProjectId) return;   // el usuario cambió de proyecto mientras cargaba
    const admin = isProjectAdmin(id);

    document.getElementById("home-project-name").textContent = d.project.name;
    document.getElementById("home-project-meta").textContent =
        `${roleLabel(d.project.my_role)} · ${d.total} tickets · ${d.story_points_done} de ${d.story_points_total} puntos`;
    ["btn-project-repos", "btn-sync-github"].forEach(b => { document.getElementById(b).style.display = admin ? "" : "none"; });
    document.getElementById("btn-new-epic").style.display = admin ? "" : "none";

    document.getElementById("home-stats").innerHTML =
        kpi(`${d.progress}<small>%</small>`, "Completado", { extra: `<div class="bar ok"><i style="width:${d.progress}%"></i></div>` }) +
        kpi(d.total - d.done, "Abiertos") +
        kpi(d.overdue_count, "Vencidos", { warn: d.overdue_count > 0 }) +
        kpi(`${d.story_points_done}<small> / ${d.story_points_total}</small>`, "Puntos") +
        kpi(d.my_open, "Asignados a mí");

    const totalCols = d.columns.reduce((a, c) => a + c.count, 0);
    document.getElementById("home-breakdown").innerHTML =
        `<div class="statusbar" style="height:8px">${d.columns.filter(c => c.count).map(c => `<i class="seg st-${esc(c.status)}" style="flex:${c.count}"></i>`).join("")}</div>
         <div class="legend">${d.columns.map(c => `<span><i class="dot" style="background:var(--st-${esc(c.status)}, var(--st-todo))"></i>${esc(titleCase(c.name))} · ${c.count}</span>`).join("")}
         ${totalCols ? "" : '<span class="muted">Sin tickets todavía</span>'}</div>`;

    projectEpics = {};
    const epicRow = (e, editable, i = 0) => {
        if (e.id) projectEpics[e.id] = e;
        return `<div class="epic-row" style="--i:${i}" ${e.id ? `data-id="${e.id}"` : 'data-none="1"'}>
            <span class="swatch" style="background:${esc(e.color)}"></span>
            <div style="min-width:0"><div class="name">${esc(e.name)}</div>${e.description ? `<div class="desc">${esc(e.description)}</div>` : ""}</div>
            <div class="bar ok" title="${e.progress}%"><i style="width:${e.progress}%"></i></div>
            <span class="num">${e.done}/${e.total}</span>
            <span class="num ${e.overdue ? "badge-warn" : ""}">${e.overdue ? e.overdue + " venc." : ""}</span>
            ${editable ? '<button class="icon-btn edit" data-edit title="Editar épica"><svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13h2.5L13 5.5 10.5 3 3 10.5V13z"/></svg></button>' : "<span></span>"}
        </div>`;
    };
    const epicsEl = document.getElementById("home-epics");
    epicsEl.innerHTML = (d.epics.length || d.no_epic.total)
        ? d.epics.map((e, i) => epicRow(e, admin, i)).join("") + (d.no_epic.total ? epicRow(d.no_epic, false, d.epics.length) : "")
        : `<div class="empty-state"><b>Aún no hay épicas</b>${admin ? "Crea la primera para organizar el trabajo del proyecto." : "Un admin del proyecto las irá creando."}</div>`;

    playItems(epicsEl);
    playItems(document.getElementById("home-stats"));
    epicsCache[id] = d.epics.map(e => ({ id: e.id, name: e.name, color: e.color, open: e.total - e.done }));
    renderSidebarEpics(id, true);

    document.getElementById("home-overdue").innerHTML = d.overdue.length
        ? d.overdue.map((t, i) => ticketRow(t, i)).join("")
        : '<div class="empty-state">Nada vencido</div>';

    const wlSection = document.getElementById("home-workload-section");
    if (d.workload === null) {
        wlSection.style.display = "none";
    } else {
        wlSection.style.display = "";
        const max = Math.max(1, ...d.workload.map(w => w.open));
        document.getElementById("home-workload").innerHTML = d.workload.length
            ? d.workload.map(w => `<div class="wl-row">
                <span class="assignee-avatar">${w.assignee ? esc(w.assignee.charAt(0).toUpperCase()) : "–"}</span>
                <span>${w.assignee ? "@" + esc(w.assignee) : '<span class="muted">Sin asignar</span>'}</span>
                <div class="bar"><i style="width:${Math.round(100 * w.open / max)}%"></i></div>
                <span class="num">${w.open}</span><span class="num ${w.overdue ? "badge-warn" : ""}">${w.overdue ? w.overdue + " v." : ""}</span></div>`).join("")
            : '<div class="empty-state">Sin tickets abiertos</div>';
    }
    await loadProjectGithubFeed();
}
openRowOnClick("home-overdue");
document.getElementById("home-epics").addEventListener("click", (e) => {
    const row = e.target.closest(".epic-row");
    if (!row) return;
    if (row.dataset.none) { navigate("epic", { projectId: currentProjectId, epic: NO_EPIC }); return; }
    const epic = projectEpics[row.dataset.id];
    if (!epic) return;
    if (e.target.closest("[data-edit]")) { openEpicModal(epic); return; }
    navigate("epic", { projectId: currentProjectId, epic: epic.name });
});

// ---------- Gestor de épicas ----------
const EPIC_COLORS = ["#6872e5", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#64748b"];
let epicColor = EPIC_COLORS[0];
function renderSwatches() {
    document.getElementById("epic-swatches").innerHTML = EPIC_COLORS.map(c =>
        `<button type="button" class="swatch-btn ${c === epicColor ? "selected" : ""}" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join("");
}
function openEpicModal(epic = null) {
    document.getElementById("epic-modal-title").textContent = epic ? "Editar épica" : "Nueva épica";
    document.getElementById("epic-id").value = epic ? epic.id : "";
    document.getElementById("epic-name").value = epic ? epic.name : "";
    document.getElementById("epic-desc").value = epic && epic.description ? epic.description : "";
    epicColor = epic ? epic.color : EPIC_COLORS[0];
    document.getElementById("epic-delete").style.display = epic ? "" : "none";
    renderSwatches();
    document.getElementById("epic-modal").style.display = "flex";
    document.getElementById("epic-name").focus();
}
function closeEpicModal() { document.getElementById("epic-modal").style.display = "none"; }
document.getElementById("btn-new-epic").addEventListener("click", () => openEpicModal());
document.getElementById("epic-cancel").addEventListener("click", closeEpicModal);
document.getElementById("epic-swatches").addEventListener("click", (e) => {
    const b = e.target.closest(".swatch-btn");
    if (b) { epicColor = b.dataset.color; renderSwatches(); }
});
document.getElementById("epic-modal").addEventListener("mousedown", (e) => { if (e.target.id === "epic-modal") closeEpicModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.getElementById("epic-modal").style.display !== "none") closeEpicModal(); });
document.getElementById("epic-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("epic-id").value;
    const body = { name: document.getElementById("epic-name").value.trim(), color: epicColor, description: document.getElementById("epic-desc").value.trim() || null };
    const url = `${API_BASE}/projects/${currentProjectId}/epics${id ? "/" + id : ""}`;
    const res = await authFetch(url, { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { closeEpicModal(); toast(id ? "Épica actualizada" : "Épica creada"); await afterEpicChange(); }
    else { const err = await res.json().catch(() => ({})); toast(err.detail || "No se pudo guardar la épica", "error"); }
});
document.getElementById("epic-delete").addEventListener("click", async () => {
    const id = document.getElementById("epic-id").value;
    const name = document.getElementById("epic-name").value;
    if (!id || !confirm(`¿Eliminar la épica «${name}»? Sus tickets quedarán sin épica.`)) return;
    const res = await authFetch(`${API_BASE}/projects/${currentProjectId}/epics/${id}`, { method: "DELETE" });
    if (res.ok) { closeEpicModal(); toast("Épica eliminada"); await afterEpicChange(); }
    else { const err = await res.json().catch(() => ({})); toast(err.detail || "No se pudo eliminar la épica", "error"); }
});

// ---------- Resumen de una épica (calculado con sus tickets) ----------
function renderEpicSummary() {
    const p = projectsById[currentProjectId];
    if (!p) return;
    const none = currentEpic === NO_EPIC;
    const done = globalColumns.length ? statusIdOf(globalColumns[globalColumns.length - 1].name) : "done";
    const today = new Date().toLocaleDateString("sv-SE");
    const isLate = (t) => t.status !== done && t.due_date && String(t.due_date).slice(0, 10) < today;
    const tickets = rawTickets, total = tickets.length;
    const nDone = tickets.filter(t => t.status === done).length;
    const open = tickets.filter(t => t.status !== done), late = tickets.filter(isLate);
    const pts = tickets.reduce((a, t) => a + (t.story_points || 0), 0);
    const ptsDone = tickets.filter(t => t.status === done).reduce((a, t) => a + (t.story_points || 0), 0);
    const pct = total ? Math.round(100 * nDone / total) : 0;
    const mine = open.filter(t => currentUser && t.assignee === currentUser.username).length;

    document.getElementById("epic-title").textContent = none ? "Sin épica" : currentEpic;
    document.getElementById("epic-meta").textContent = `${p.name} · ${total} tickets · ${ptsDone} de ${pts} puntos`;
    document.getElementById("epic-kpis").innerHTML =
        kpi(`${pct}<small>%</small>`, "Completado", { extra: `<div class="bar ok"><i style="width:${pct}%"></i></div>` }) +
        kpi(open.length, "Abiertos") + kpi(late.length, "Vencidos", { warn: late.length > 0 }) +
        kpi(`${ptsDone}<small> / ${pts}</small>`, "Puntos") + kpi(mine, "Asignados a mí");

    const counts = globalColumns.map(c => ({ id: statusIdOf(c.name), name: c.name, n: tickets.filter(t => t.status === statusIdOf(c.name)).length }));
    document.getElementById("epic-breakdown").innerHTML =
        `<div class="statusbar" style="height:8px">${counts.filter(c => c.n).map(c => `<i class="seg st-${esc(c.id)}" style="flex:${c.n}"></i>`).join("")}</div>
         <div class="legend">${counts.map(c => `<span><i class="dot" style="background:var(--st-${esc(c.id)}, var(--st-todo))"></i>${esc(titleCase(c.name))} · ${c.n}</span>`).join("")}
         ${total ? "" : '<span class="muted">Esta épica aún no tiene tickets</span>'}</div>`;

    document.getElementById("epic-overdue").innerHTML = late.length
        ? late.map((t, i) => ticketRow({ ...t, overdue: true }, i)).join("") : '<div class="empty-state">Nada vencido</div>';

    const wl = document.getElementById("epic-workload-section");
    if (!isProjectAdmin(currentProjectId)) { wl.style.display = "none"; }
    else {
        wl.style.display = "";
        const by = {};
        open.forEach(t => { const k = t.assignee || ""; (by[k] = by[k] || { open: 0, late: 0 }); by[k].open++; if (isLate(t)) by[k].late++; });
        const rows = Object.entries(by).sort((a, b) => b[1].open - a[1].open);
        const max = Math.max(1, ...rows.map(r => r[1].open));
        document.getElementById("epic-workload").innerHTML = rows.length ? rows.map(([name, v], i) => `<div class="wl-row" style="--i:${i}">
            <span class="assignee-avatar">${name ? esc(name.charAt(0).toUpperCase()) : "–"}</span>
            <span>${name ? "@" + esc(name) : '<span class="muted">Sin asignar</span>'}</span>
            <div class="bar"><i style="width:${Math.round(100 * v.open / max)}%"></i></div>
            <span class="num">${v.open}</span><span class="num ${v.late ? "badge-warn" : ""}">${v.late ? v.late + " v." : ""}</span></div>`).join("")
            : '<div class="empty-state">Sin tickets abiertos</div>';
    }
    playItems(document.getElementById("epic-kpis"));
    playItems(document.getElementById("epic-workload"));
}
openRowOnClick("epic-overdue");

// ---------- Crear proyecto (solo admin general) ----------
let newProjectColor = EPIC_COLORS[0];
function renderProjectSwatches() {
    document.getElementById("project-swatches").innerHTML = EPIC_COLORS.map(c =>
        `<button type="button" class="swatch-btn ${c === newProjectColor ? "selected" : ""}" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join("");
}
function openProjectModal() {
    document.getElementById("new-project-name").value = "";
    newProjectColor = EPIC_COLORS[0];
    renderProjectSwatches();
    document.getElementById("project-modal").style.display = "flex";
    document.getElementById("new-project-name").focus();
}
function closeProjectModal() { document.getElementById("project-modal").style.display = "none"; }
document.getElementById("btn-open-create-project").addEventListener("click", openProjectModal);
document.getElementById("close-project-modal").addEventListener("click", closeProjectModal);
document.getElementById("project-swatches").addEventListener("click", (e) => {
    const b = e.target.closest(".swatch-btn");
    if (b) { newProjectColor = b.dataset.color; renderProjectSwatches(); }
});
document.getElementById("project-modal").addEventListener("mousedown", (e) => { if (e.target.id === "project-modal") closeProjectModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeProjectModal(); });
document.getElementById("project-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("new-project-name").value.trim();
    if (!name) return;
    const res = await authFetch(`${API_BASE}/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, color: newProjectColor }) });
    if (res.ok) {
        const created = await res.json();
        closeProjectModal();
        toast("Proyecto creado");
        await loadProjects();
        await navigate("project", { projectId: created.id });
    } else {
        const err = await res.json().catch(() => ({}));
        toast(err.detail || "No se pudo crear el proyecto", "error");
    }
});

// Arranque: si hay sesión guardada se restaura; si no, aparece el login
initBoard();
