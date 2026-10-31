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
    await fetchAndRenderTickets();
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
    try {
        const ticketUrl = currentProjectId ? `${API_BASE}/tickets?project_id=${currentProjectId}` : `${API_BASE}/tickets`;
        const [columnsRes, ticketsRes] = await Promise.all([
            authFetch(`${API_BASE}/columns`),
            authFetch(ticketUrl)
        ]);

        if (!columnsRes.ok || !ticketsRes.ok) return;

        globalColumns = await columnsRes.json();
        fillStatusOptions();
        rawTickets = await ticketsRes.json();

        applyOmnibarFilter();
        renderQuickFilters(rawTickets);
        setupDragAndDrop();
    } catch (error) {
        console.error("Error cargando el tablero:", error);
    }
}

function parseOmnibar(q) {
    const f = { text: [], assignee: [], priority: [], status: [], label: [], type: [] };
    String(q || "").trim().split(/\s+/).filter(Boolean).forEach(tok => {
        const m = tok.match(/^(assignee|priority|status|label|type):(.+)$/i);
        if (m) f[m[1].toLowerCase()].push(norm(m[2]));
        else if (tok[0] === "@" && tok.length > 1) f.assignee.push(norm(tok.slice(1)));
        else if (tok[0] === "#" && tok.length > 1) f.label.push(norm(tok.slice(1)));
        else f.text.push(norm(tok));
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
        projects.forEach(p => {
            const a = document.createElement("a");
            a.className = "nav-item project-link";
            a.href = "#";
            a.innerHTML = `<span class="project-color" style="background-color: ${esc(p.color)};"></span> <span class="text">${esc(p.name)}</span>`;
            
            a.addEventListener("click", async (e) => {
                e.preventDefault();
                document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
                a.classList.add("active");
                
                currentProjectId = p.id;
                document.getElementById("board-title").textContent = p.name;
                if (headerNewTicketBtn) headerNewTicketBtn.style.display = "inline-flex"; setProjectChrome(true); 
                
                boardContainer.style.display = "none";
                if (listContainer) listContainer.style.display = "none";
                document.getElementById("quick-filters").style.display = "none";
                
                const home = document.getElementById("project-home");
                if (home) {
                    home.style.display = "block";
                    document.getElementById("home-project-name").textContent = `Resumen: ${p.name}`;
                    
                    const tRes = await authFetch(`${API_BASE}/tickets?project_id=${currentProjectId}`);
                    if (tRes.ok) {
                        const tickets = await tRes.json();
                        renderProjectDashboard(tickets);
                    }
                    await loadProjectGithubFeed();
                }
            });
            
            projectList.appendChild(a);
        });
    } catch (e) {
        console.error("Error cargando proyectos:", e);
    }
}

if (btnToggleView) {
    btnToggleView.addEventListener("click", () => {
        isListView = !isListView;
        const home = document.getElementById("project-home");
        if (home && home.style.display !== "none") return;

        if (isListView) {
            boardContainer.style.display = "none";
            if (listContainer) listContainer.style.display = "block";
            btnToggleView.textContent = "Vista Kanban";
        } else {
            boardContainer.style.display = "flex";
            if (listContainer) listContainer.style.display = "none";
            btnToggleView.textContent = "Vista Lista";
        }
    });
}

function renderColumns(columns) {
    if (!boardContainer) return;
    boardContainer.innerHTML = "";
    columns.forEach(col => {
        const statusId = statusIdOf(col.name);
        const colDiv = document.createElement("div");
        colDiv.className = "kanban-column";
        colDiv.dataset.status = statusId;
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
                    <span class="priority-badge priority-${esc(prio)}">${PRIO_LABEL[prio] || esc(titleCase(prio))}</span>
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
            <td><span class="priority-badge priority-${esc(prio)}">${PRIO_LABEL[prio] || esc(titleCase(prio))}</span> <span class="type-badge">${TYPE_LABEL[type] || esc(titleCase(type))}</span></td>
            <td class="ticket-link">${esc(ticket.title)}</td>
            <td><span class="status-pill status-${esc(st)}">${esc(statusLabel(st))}</span></td>
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
                    await fetchAndRenderTickets();
                    closePanel();
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
            document.getElementById("ticket-epic").value = ticket.epic || "";
            document.getElementById("ticket-assignee").value = ticket.assignee || "";
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
    if (currentUser && (currentUser.is_superuser || currentUser.username === "adrian")) {
        navBtn.style.display = "flex";
    } else {
        navBtn.style.display = "none";
    }
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
    const sa = document.getElementById("side-avatar"), su = document.getElementById("side-user");
    if (sa) sa.textContent = user.avatar || "🚀";
    if (su) su.textContent = user.first_name ? `${user.first_name} ${user.last_name || ""}`.trim() : `@${user.username}`;

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

const commandActions = [
    { title: "⚡ Crear Nuevo Ticket", action: () => { if (headerNewTicketBtn) headerNewTicketBtn.click(); } },
    { title: "📊 Cambiar a Vista Lista / Kanban", action: () => { if (btnToggleView) btnToggleView.click(); } },
    { title: "🌙 Cambiar Tema Claro/Oscuro", action: () => { document.getElementById("theme-toggle").click(); } },
    { title: "👤 Ver Mis Tickets Asignados", action: () => { navGlobalMine.click(); } },
    { title: "🏠 Ver Todos los Tickets", action: () => { navGlobalAll.click(); } }
];

function openCommandPalette() {
    if (!commandPaletteModal) return;
    commandPaletteModal.style.display = "flex";
    commandPaletteInput.value = "";
    renderCommandActions(commandActions);
    setTimeout(() => commandPaletteInput.focus(), 100);
}

function closeCommandPalette() {
    if (commandPaletteModal) commandPaletteModal.style.display = "none";
}

function renderCommandActions(actions) {
    if (!commandPaletteList) return;
    commandPaletteList.innerHTML = actions.map((act, i) => `
        <div class="command-item ${i === 0 ? 'selected' : ''}" data-index="${i}">
            <span>${act.title}</span>
            <kbd style="font-size:0.7rem; background:var(--bg-app); padding:2px 6px; border-radius:4px;">Enter</kbd>
        </div>
    `).join("");

    commandPaletteList.querySelectorAll(".command-item").forEach((item, idx) => {
        item.addEventListener("click", () => {
            actions[idx].action();
            closeCommandPalette();
        });
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
    commandPaletteInput.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = commandActions.filter(a => a.title.toLowerCase().includes(query));
        renderCommandActions(filtered);
    });
}

// NAVEGACION Y PROYECTOS
if (navGlobalAll) {
    navGlobalAll.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
        navGlobalAll.classList.add("active");
        
        currentProjectId = null;
        document.getElementById("board-title").textContent = "Todos los tickets";
        if (headerNewTicketBtn) headerNewTicketBtn.style.display = "none"; setProjectChrome(false);
        
        document.getElementById("project-home").style.display = "none";
        document.getElementById("quick-filters").style.display = "flex";
        
        if (isListView) {
            document.getElementById("list-container").style.display = "block";
            boardContainer.style.display = "none";
        } else {
            boardContainer.style.display = "flex";
            document.getElementById("list-container").style.display = "none";
        }
        fetchAndRenderTickets();
    });
}

if (navGlobalMine) {
    navGlobalMine.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
        navGlobalMine.classList.add("active");
        
        currentProjectId = null;
        document.getElementById("board-title").textContent = "Mis tickets";
        if (headerNewTicketBtn) headerNewTicketBtn.style.display = "none"; setProjectChrome(false);
        
        document.getElementById("project-home").style.display = "none";
        document.getElementById("quick-filters").style.display = "flex";
        
        if (searchInput) searchInput.value = "@" + (currentUser ? currentUser.username : "adrian");
        fetchAndRenderTickets();
    });
}

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
function setProjectChrome(on) {
    const tabs = document.getElementById("project-tabs");
    if (tabs) tabs.style.display = on ? "flex" : "none";
    if (btnToggleView) btnToggleView.style.display = on ? "none" : "";
    if (on) setTab("home", false);
}
function setTab(tab, load = true) {
    document.querySelectorAll("#project-tabs .tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
    const home = document.getElementById("project-home"), qf = document.getElementById("quick-filters");
    home.style.display = tab === "home" ? "block" : "none";
    qf.style.display = tab === "home" ? "none" : "flex";
    boardContainer.style.display = tab === "board" ? "flex" : "none";
    listContainer.style.display = tab === "list" ? "block" : "none";
    if (load && tab !== "home") fetchAndRenderTickets();
}
document.querySelectorAll("#project-tabs .tab").forEach(t => t.addEventListener("click", () => setTab(t.dataset.tab)));

function renderProjectDashboard(tickets) {
    const total = tickets.length, today = new Date().toLocaleDateString("sv-SE");
    const by = (s) => tickets.filter(t => norm(t.status) === s).length;
    const done = by("done"), late = tickets.filter(t => t.due_date && String(t.due_date).slice(0, 10) < today && norm(t.status) !== "done").length;
    const pts = tickets.reduce((a, t) => a + (t.story_points || 0), 0), pct = total ? Math.round(done / total * 100) : 0;
    const card = (n, l, x = "") => `<div class="stat-card"><div class="stat-num">${n}</div><div class="stat-label">${l}</div>${x}</div>`;
    document.getElementById("home-stats").innerHTML =
        card(total, "Tickets") + card(by("in_progress"), "En progreso") + card(late, "Vencidos") + card(pts, "Story points") +
        card(pct + "%", "Completado", `<div class="progress"><i style="width:${pct}%"></i></div>`);
    document.getElementById("home-breakdown").innerHTML = globalColumns.map(c => {
        const id = statusIdOf(c.name), n = by(id);
        return `<div class="bd-row" data-status="${id}"><span>${esc(titleCase(c.name))}</span><div class="bd-bar"><i style="width:${total ? n / total * 100 : 0}%"></i></div><span>${n}</span></div>`;
    }).join("") || '<p class="empty-note">Sin columnas configuradas.</p>';
}

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

// Menú de cuenta
const accMenu = document.getElementById("account-menu");
document.getElementById("btn-account").addEventListener("click", (e) => { e.stopPropagation(); accMenu.style.display = accMenu.style.display === "none" ? "block" : "none"; });
document.addEventListener("click", () => { accMenu.style.display = "none"; });
document.getElementById("menu-profile").addEventListener("click", () => btnOpenProfile.click());

const btnGoBoard = document.getElementById("btn-go-board");
if (btnGoBoard) btnGoBoard.addEventListener("click", () => setTab("board"));
