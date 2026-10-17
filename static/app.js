const API_BASE = "/api";
const boardContainer = document.getElementById("board-container");
const listContainer = document.getElementById("list-container");
const ticketListBody = document.getElementById("ticket-list-body");
const btnToggleView = document.getElementById("toggle-view");

const navGlobalAll = document.getElementById("nav-global-all");
const navGlobalMine = document.getElementById("nav-global-mine");
const headerNewTicketBtn = document.getElementById("header-new-ticket");
const focusSearchBtn = document.getElementById("focus-search");
const searchInput = document.getElementById("search-filter");

let isListView = false;
let globalColumns = [];
let rawTickets = []; // Guardamos copia en memoria de los tickets sin filtrar
let currentProjectId = null;

// --- INIT: Carga inicial ---
async function initBoard() {
    await loadProjects();
    await fetchAndRenderTickets();
}

async function fetchAndRenderTickets() {
    try {
        const url = currentProjectId ? `${API_BASE}/tickets?project_id=${currentProjectId}` : `${API_BASE}/tickets`;
        const [columnsRes, ticketsRes] = await Promise.all([
            fetch(`${API_BASE}/columns`),
            fetch(url)
        ]);

        globalColumns = await columnsRes.json();
        rawTickets = await ticketsRes.json();

        applyOmnibarFilter();
        renderQuickFilters(rawTickets);
        setupDragAndDrop();
    } catch (error) {
        console.error("Error crítico cargando el tablero:", error);
    }
}

// --- PARSER DE LA OMNIBAR INTELIGENTE ---
function filterTicketsByOmnibar(tickets, queryStr) {
    if (!queryStr || !queryStr.trim()) return tickets;

    let query = queryStr.trim();

    // 1. Extraer tokens de estado: is:done, is:todo, is:in_progress, status:done
    const statusMatches = [...query.matchAll(/(?:is|status):([\w_]+)/gi)];
    const statuses = statusMatches.map(m => m[1].toLowerCase());
    query = query.replace(/(?:is|status):([\w_]+)/gi, '').trim();

    // 2. Extraer tokens de asignado: @adrian o assignee:adrian
    const assigneeMatches = [...query.matchAll(/(?:@|assignee:)(\w+)/gi)];
    const assignees = assigneeMatches.map(m => m[1].toLowerCase());
    query = query.replace(/(?:@|assignee:)(\w+)/gi, '').trim();

    // 3. Extraer tokens de etiqueta: #bug o tag:backend
    const tagMatches = [...query.matchAll(/(?:#|tag:)(\w+)/gi)];
    const tags = tagMatches.map(m => m[1].toLowerCase());
    query = query.replace(/(?:#|tag:)(\w+)/gi, '').trim();

    // 4. Extraer tokens de Epic: epic:"Core Engine" o epic:core
    const epicMatches = [...query.matchAll(/epic:(?:"([^"]+)"|(\w+))/gi)];
    const epics = epicMatches.map(m => (m[1] || m[2]).toLowerCase());
    query = query.replace(/epic:(?:"([^"]+)"|(\w+))/gi, '').trim();

    // 5. Texto libre restante
    const textSearch = query.toLowerCase().trim();

    return tickets.filter(ticket => {
        // Validación de Estado
        if (statuses.length > 0) {
            const ticketStatus = (ticket.status || 'todo').toLowerCase();
            const matchesStatus = statuses.some(s => 
                ticketStatus.includes(s) || 
                (s === 'todo' && ticketStatus === 'todo') || 
                (s === 'progress' && ticketStatus === 'in_progress')
            );
            if (!matchesStatus) return false;
        }

        // Validación de Asignado
        if (assignees.length > 0) {
            const ticketAssignee = (ticket.assignee || '').toLowerCase();
            if (!assignees.some(a => ticketAssignee.includes(a))) return false;
        }

        // Validación de Etiquetas
        if (tags.length > 0) {
            const ticketTags = (ticket.tags || []).map(t => t.toLowerCase());
            if (!tags.some(t => ticketTags.includes(t))) return false;
        }

        // Validación de Epic
        if (epics.length > 0) {
            const ticketEpic = (ticket.epic || '').toLowerCase();
            if (!epics.some(e => ticketEpic.includes(e))) return false;
        }

        // Búsqueda de Texto Plano en Título o Descripción
        if (textSearch) {
            const titleMatch = (ticket.title || '').toLowerCase().includes(textSearch);
            const descMatch = (ticket.description || '').toLowerCase().includes(textSearch);
            if (!titleMatch && !descMatch) return false;
        }

        return true;
    });
}

function applyOmnibarFilter() {
    const query = searchInput ? searchInput.value : '';
    const filteredTickets = filterTicketsByOmnibar(rawTickets, query);
    
    renderColumns(globalColumns);
    renderTickets(filteredTickets);
    renderTableTickets(filteredTickets, true);
}

// Búsqueda reactiva en tiempo real al escribir
if (searchInput) {
    searchInput.addEventListener("input", () => {
        applyOmnibarFilter();
    });
}

// --- NAVEGACIÓN Y VISTAS GLOBALES ---
if (focusSearchBtn && searchInput) {
    focusSearchBtn.addEventListener("click", () => searchInput.focus());
}

if (navGlobalAll) {
    navGlobalAll.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
        navGlobalAll.classList.add("active");
        
        currentProjectId = null;
        document.getElementById("board-title").textContent = "Todos los Tickets";
        if (headerNewTicketBtn) headerNewTicketBtn.style.display = "none";
        
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
    navGlobalMine.addEventListener("click", async (e) => {
        e.preventDefault();
        document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
        navGlobalMine.classList.add("active");
        
        currentProjectId = null;
        document.getElementById("board-title").textContent = "Mis Tickets (Asignados a mí)";
        if (headerNewTicketBtn) headerNewTicketBtn.style.display = "none";
        
        document.getElementById("project-home").style.display = "none";
        document.getElementById("quick-filters").style.display = "flex";
        
        if (isListView) {
            document.getElementById("list-container").style.display = "block";
            boardContainer.style.display = "none";
        } else {
            boardContainer.style.display = "flex";
            document.getElementById("list-container").style.display = "none";
        }
        
        if (searchInput) searchInput.value = "@adrian";
        fetchAndRenderTickets();
    });
}

// --- CARGA DINÁMICA DE PROYECTOS ---
async function loadProjects() {
    try {
        const res = await fetch(`${API_BASE}/projects`);
        const projects = await res.json();
        const projectList = document.getElementById("project-list");
        if(!projectList) return;
        
        projectList.innerHTML = "";
        projects.forEach(p => {
            const a = document.createElement("a");
            a.className = "nav-item project-link";
            a.href = "#";
            a.innerHTML = `<span class="project-color" style="background-color: ${p.color};"></span> <span class="text">${p.name}</span>`;
            
            a.addEventListener("click", async (e) => {
                e.preventDefault();
                document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
                a.classList.add("active");
                
                currentProjectId = p.id;
                document.getElementById("board-title").textContent = p.name;
                if (headerNewTicketBtn) headerNewTicketBtn.style.display = "inline-flex"; 
                
                boardContainer.style.display = "none";
                if (listContainer) listContainer.style.display = "none";
                document.getElementById("quick-filters").style.display = "none";
                
                const home = document.getElementById("project-home");
                if (home) {
                    home.style.display = "block";
                    document.getElementById("home-project-name").textContent = `Resumen: ${p.name}`;
                    
                    const tRes = await fetch(`${API_BASE}/tickets?project_id=${currentProjectId}`);
                    const tickets = await tRes.json();
                    document.getElementById("stat-total").textContent = tickets.length;
                    document.getElementById("stat-done").textContent = tickets.filter(t => t.status === "done").length;
                }
            });
            
            projectList.appendChild(a);
        });
    } catch (e) {
        console.error("Error cargando proyectos:", e);
    }
}

// --- TOGGLE VISTAS ---
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

// --- RENDERIZADO ---
function renderColumns(columns) {
    if (!boardContainer) return;
    boardContainer.innerHTML = "";
    columns.forEach(col => {
        const statusId = col.name.toLowerCase().replace(/\s+/g, '_').replace('to_do', 'todo');
        const colDiv = document.createElement("div");
        colDiv.className = "kanban-column";
        colDiv.innerHTML = `
            <div class="column-header">${col.name}</div>
            <div class="column-content" data-status="${statusId}" id="col-${statusId}"></div>
        `;
        boardContainer.appendChild(colDiv);
    });
}

function renderTickets(tickets) {
    tickets.forEach(ticket => {
        const status = ticket.status || "todo";
        const colContent = document.querySelector(`.column-content[data-status="${status}"]`);
        
        if (colContent) {
            const ticketDiv = document.createElement("div");
            ticketDiv.className = "ticket-card";
            ticketDiv.draggable = true;
            ticketDiv.dataset.id = ticket.id;
            
            ticketDiv.addEventListener("dblclick", () => openEditPanel(ticket.id));

            const epicHtml = ticket.epic ? `<div class="epic-badge">${ticket.epic}</div>` : '';
            const assigneeHtml = ticket.assignee ? `<div class="assignee-avatar" title="${ticket.assignee}">${ticket.assignee.charAt(0).toUpperCase()}</div>` : '';
            const dateHtml = ticket.due_date ? `<span>📅 ${ticket.due_date}</span>` : '';

            ticketDiv.innerHTML = `
                ${epicHtml}
                <div class="ticket-title">${ticket.title}</div>
                ${ticket.description ? `<div class="ticket-desc">${ticket.description}</div>` : ""}
                <div class="tags-container">
                    ${ticket.tags && ticket.tags.length > 0 ? ticket.tags.map(tag => `<span class="tag-badge">${tag}</span>`).join("") : ""}
                </div>
                <div class="ticket-meta">
                    ${dateHtml}
                    ${assigneeHtml}
                </div>
            `;
            colContent.appendChild(ticketDiv);
        }
    });
}

function renderTableTickets(tickets, clearTable = false) {
    if (!ticketListBody) return;
    if (clearTable) ticketListBody.innerHTML = "";

    tickets.forEach(ticket => {
        const tr = document.createElement("tr");
        const currentStatus = ticket.status || "todo";

        const optionsHtml = globalColumns.map(col => {
            const statusId = col.name.toLowerCase().replace(/\s+/g, '_').replace('to_do', 'todo');
            const isSelected = (currentStatus === statusId) ? "selected" : "";
            return `<option value="${statusId}" ${isSelected}>${col.name}</option>`;
        }).join("");

        tr.innerHTML = `
            <td style="color: var(--text-muted); font-size: 0.85rem;">TB-${ticket.id}</td>
            <td style="font-weight: 600; color: var(--primary); cursor: pointer;" onclick="openEditPanel(${ticket.id})">${ticket.title}</td>
            <td>
                <select class="status-select" onchange="syncTicketStatus(${ticket.id}, this.value)">
                    ${optionsHtml}
                </select>
            </td>
            <td><span class="epic-badge">${ticket.epic || '-'}</span></td>
            <td style="font-size: 0.85rem;">${ticket.assignee || '-'}</td>
            <td style="font-size: 0.85rem; color: var(--text-muted);">${ticket.due_date || '-'}</td>
            <td>
                <div class="tags-container" style="margin-top: 0;">
                    ${ticket.tags && ticket.tags.length > 0
                        ? ticket.tags.map(tag => `<span class="tag-badge">${tag}</span>`).join("")
                        : "<span style='color: #a5adba; font-size: 0.8rem;'>-</span>"}
                </div>
            </td>
        `;
        ticketListBody.appendChild(tr);
    });
}

function renderQuickFilters(tickets) {
    const filtersBar = document.getElementById("quick-filters");
    if (!filtersBar) return;

    const allTags = new Set();
    tickets.forEach(ticket => {
        if (ticket.tags) ticket.tags.forEach(tag => allTags.add(tag));
    });

    filtersBar.innerHTML = `
        <span class="filter-label">Filtros rápidos:</span>
        <button class="filter-pill active" data-filter="">Todos</button>
    `;

    allTags.forEach(tag => {
        const btn = document.createElement("button");
        btn.className = "filter-pill";
        btn.dataset.filter = `#${tag.toLowerCase()}`;
        btn.textContent = `#${tag}`;
        filtersBar.appendChild(btn);
    });

    filtersBar.querySelectorAll(".filter-pill").forEach(pill => {
        pill.addEventListener("click", (e) => {
            filtersBar.querySelectorAll(".filter-pill").forEach(p => p.classList.remove("active"));
            e.target.classList.add("active");

            if (searchInput) {
                searchInput.value = e.target.dataset.filter;
                applyOmnibarFilter();
            }
        });
    });
}

async function syncTicketStatus(ticketId, newStatus) {
    await updateTicketStatus(ticketId, newStatus);
    const ticketCard = document.querySelector(`.ticket-card[data-id="${ticketId}"]`);
    const newColumn = document.querySelector(`.column-content[data-status="${newStatus}"]`);
    if (ticketCard && newColumn) {
        newColumn.appendChild(ticketCard);
    }
}

async function updateTicketStatus(ticketId, status) {
    try {
        await fetch(`${API_BASE}/tickets/${ticketId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: status })
        });
    } catch (error) {
        console.error("Error:", error);
    }
}

let draggedTicket = null;
function setupDragAndDrop() {
    const tickets = document.querySelectorAll('.ticket-card');
    const columns = document.querySelectorAll('.column-content');

    tickets.forEach(ticket => {
        ticket.addEventListener('dragstart', () => {
            draggedTicket = ticket;
            setTimeout(() => ticket.style.opacity = '0.5', 0);
        });
        ticket.addEventListener('dragend', () => {
            if (draggedTicket) draggedTicket.style.opacity = '1';
            draggedTicket = null;
        });
    });

    columns.forEach(column => {
        column.addEventListener('dragover', (e) => e.preventDefault());
        column.addEventListener('dragenter', (e) => {
            e.preventDefault();
            column.style.backgroundColor = '#e2e4e9';
        });
        column.addEventListener('dragleave', () => {
            column.style.backgroundColor = '';
        });
        column.addEventListener('drop', async (e) => {
            e.preventDefault();
            column.style.backgroundColor = '';
            if (draggedTicket) {
                const oldColumn = draggedTicket.closest('.column-content');
                if (oldColumn === column) return;

                column.appendChild(draggedTicket);
                const ticketId = draggedTicket.dataset.id;
                const newStatus = column.dataset.status;
                await updateTicketStatus(ticketId, newStatus);
            }
        });
    });
}

const sidePanel = document.getElementById("side-panel");
const btnClosePanel = document.getElementById("close-panel");
const btnCancel = document.getElementById("cancel-ticket");
const formTicket = document.getElementById("ticket-form");
const panelTitle = document.getElementById("panel-title");

if (sidePanel) {
    const closePanel = () => {
        sidePanel.classList.remove("open");
        setTimeout(() => { 
            if(formTicket) {
                formTicket.reset(); 
                document.getElementById("ticket-id").value = "";
                panelTitle.textContent = "Nuevo Ticket";
            }
        }, 300);
    };

    if (headerNewTicketBtn) {
        headerNewTicketBtn.addEventListener("click", () => {
            panelTitle.textContent = "Nuevo Ticket";
            sidePanel.classList.add("open");
            setTimeout(() => document.getElementById("ticket-title").focus(), 300);
        });
    }

    if (btnClosePanel) btnClosePanel.addEventListener("click", closePanel);
    if (btnCancel) btnCancel.addEventListener("click", closePanel);

    if (formTicket) {
        formTicket.addEventListener("submit", async (e) => {
            e.preventDefault();
            
            const rawTags = document.getElementById("ticket-tags").value;
            const tagsArray = rawTags ? rawTags.split(",").map(t => t.trim()).filter(t => t) : [];
            const timeVal = document.getElementById("ticket-time").value;
            
            const ticketData = {
                title: document.getElementById("ticket-title").value,
                description: document.getElementById("ticket-desc").value,
                epic: document.getElementById("ticket-epic").value || null,
                assignee: document.getElementById("ticket-assignee").value || null,
                due_date: document.getElementById("ticket-due").value || null,
                time_logged: timeVal ? parseInt(timeVal) : 0,
                project_id: currentProjectId,
                tags: tagsArray,
                status: "todo"
            };

            const ticketId = document.getElementById("ticket-id").value;
            const isEditing = !!ticketId;
            const method = isEditing ? 'PUT' : 'POST';
            const url = isEditing ? `${API_BASE}/tickets/${ticketId}` : `${API_BASE}/tickets`;

            if (isEditing) {
                const existingCard = document.querySelector(`.ticket-card[data-id="${ticketId}"]`);
                if (existingCard) {
                    ticketData.status = existingCard.closest('.column-content').dataset.status;
                }
            }

            try {
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(ticketData)
                });

                if (response.ok) {
                    fetchAndRenderTickets();
                    closePanel();
                }
            } catch (error) {
                console.error("Error al guardar:", error);
            }
        });
    }
}

async function openEditPanel(ticketId) {
    try {
        const response = await fetch(`${API_BASE}/tickets`);
        const allTickets = await response.json();
        const ticket = allTickets.find(t => t.id == ticketId);
        
        if (ticket) {
            document.getElementById("ticket-id").value = ticket.id;
            document.getElementById("ticket-title").value = ticket.title || "";
            document.getElementById("ticket-desc").value = ticket.description || "";
            document.getElementById("ticket-epic").value = ticket.epic || "";
            document.getElementById("ticket-assignee").value = ticket.assignee || "";
            document.getElementById("ticket-due").value = ticket.due_date || "";
            document.getElementById("ticket-time").value = ticket.time_logged || 0;
            document.getElementById("ticket-tags").value = ticket.tags ? ticket.tags.join(", ") : "";
            
            panelTitle.textContent = `Editar TB-${ticket.id}`;
            sidePanel.classList.add("open");
        }
    } catch (error) {
        console.error("Error cargando el ticket:", error);
    }
}

// --- IR AL TABLERO KANBAN ---
const btnGoBoard = document.getElementById("btn-go-board");
if (btnGoBoard) {
    btnGoBoard.addEventListener("click", () => {
        document.getElementById("project-home").style.display = "none";
        document.getElementById("quick-filters").style.display = "flex";
        
        if (isListView) {
            document.getElementById("list-container").style.display = "block";
        } else {
            document.getElementById("board-container").style.display = "flex";
        }
        fetchAndRenderTickets();
    });
}

// --- ARCHIVAR PROYECTO ACTUAL ---
const btnArchiveProject = document.getElementById("btn-archive-project");
if (btnArchiveProject) {
    btnArchiveProject.addEventListener("click", async () => {
        if (!currentProjectId) return;

        const confirmArchive = confirm("¿Seguro que quieres archivar este proyecto?");
        if (confirmArchive) {
            try {
                const res = await fetch(`${API_BASE}/projects/${currentProjectId}/archive`, {
                    method: 'PUT'
                });
                if (res.ok) {
                    currentProjectId = null;
                    await loadProjects();
                    document.getElementById("nav-global-all").click();
                }
            } catch (err) {
                console.error("Error archivando el proyecto:", err);
            }
        }
    });
}

// --- MODAL CREAR PROYECTO ---
const projectModal = document.getElementById("project-modal");
const btnOpenCreateProject = document.getElementById("btn-open-create-project");
const btnCloseProjectModal = document.getElementById("close-project-modal");
const projectForm = document.getElementById("project-form");

if (btnOpenCreateProject) btnOpenCreateProject.addEventListener("click", () => projectModal.style.display = "flex");
if (btnCloseProjectModal) btnCloseProjectModal.addEventListener("click", () => projectModal.style.display = "none");

if (projectForm) {
    projectForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = document.getElementById("new-project-name").value;
        const color = document.getElementById("new-project-color").value;

        try {
            const res = await fetch(`${API_BASE}/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, color })
            });
            if (res.ok) {
                projectModal.style.display = "none";
                projectForm.reset();
                await loadProjects();
            }
        } catch (err) {
            console.error("Error creando proyecto", err);
        }
    });
}

// --- MODAL PROYECTOS ARCHIVADOS Y ACCIONES ---
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

if (closeArchivedModal) {
    closeArchivedModal.addEventListener("click", () => archivedModal.style.display = "none");
}

async function renderArchivedProjectsList() {
    const listContainer = document.getElementById("archived-project-list");
    if (!listContainer) return;

    try {
        const res = await fetch(`${API_BASE}/projects?include_archived=true`);
        const allProjects = await res.json();
        const archivedProjects = allProjects.filter(p => p.is_archived);

        if (archivedProjects.length === 0) {
            listContainer.innerHTML = "<p style='color: var(--text-muted); font-size: 0.9rem;'>No hay proyectos archivados.</p>";
            return;
        }

        listContainer.innerHTML = "";
        archivedProjects.forEach(p => {
            const div = document.createElement("div");
            div.className = "archived-item";
            div.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span class="project-color" style="background-color: ${p.color};"></span>
                    <span style="font-weight: 600;">${p.name}</span>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn" style="padding: 4px 10px; font-size: 0.8rem;" onclick="unarchiveProject(${p.id})">Restaurar</button>
                    <button class="btn" style="padding: 4px 10px; font-size: 0.8rem; color: #ff5630; border-color: #ff5630;" onclick="deleteProjectPermanently(${p.id})">Eliminar</button>
                </div>
            `;
            listContainer.appendChild(div);
        });
    } catch (err) {
        console.error("Error cargando proyectos archivados:", err);
    }
}

window.unarchiveProject = async function(projectId) {
    try {
        const res = await fetch(`${API_BASE}/projects/${projectId}/unarchive`, { method: 'PUT' });
        if (res.ok) {
            await loadProjects();
            await renderArchivedProjectsList();
        }
    } catch (err) {
        console.error("Error al restaurar proyecto:", err);
    }
};

window.deleteProjectPermanently = async function(projectId) {
    if (confirm("⚠️ ¿Seguro que quieres ELIMINAR permanentemente este proyecto y TODOS sus tickets? Esta acción no se puede deshacer.")) {
        try {
            const res = await fetch(`${API_BASE}/projects/${projectId}`, { method: 'DELETE' });
            if (res.ok) {
                await loadProjects();
                await renderArchivedProjectsList();
            }
        } catch (err) {
            console.error("Error al eliminar proyecto:", err);
        }
    }
};

// --- ATAJOS DE TECLADO ---
document.addEventListener("keydown", (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape' && sidePanel && sidePanel.classList.contains("open")) {
            e.target.blur();
            if (btnClosePanel) btnClosePanel.click();
        }
        return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (searchInput) searchInput.focus();
    }

    if (e.key.toLowerCase() === 'c' && currentProjectId) {
        e.preventDefault();
        if (headerNewTicketBtn) headerNewTicketBtn.click();
    }

    if (e.key.toLowerCase() === 'k' && !(e.ctrlKey || e.metaKey) && btnToggleView) {
        e.preventDefault();
        btnToggleView.click();
    }

    if (e.key === 'Escape') {
        if (sidePanel && sidePanel.classList.contains("open") && btnClosePanel) btnClosePanel.click();
        if (projectModal) projectModal.style.display = "none";
        if (archivedModal) archivedModal.style.display = "none";
    }
});

// --- SIDEBAR Y MODO OSCURO ---
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
        const currentTheme = document.documentElement.getAttribute("data-theme");
        if (currentTheme === "dark") {
            document.documentElement.removeAttribute("data-theme");
            themeToggleBtn.textContent = "🌙";
        } else {
            document.documentElement.setAttribute("data-theme", "dark");
            themeToggleBtn.textContent = "☀️";
        }
    });
}

// --- LÓGICA DE AUTOCOMPLETADO OMNIBAR ---
const suggestionsContainer = document.getElementById("omnibar-suggestions");
let activeSuggestionIndex = -1;

function getOmnibarSuggestions(currentWord) {
    const word = currentWord.toLowerCase();
    let options = [];

    // 1. Asignados (@...)
    if (word.startsWith("@")) {
        const query = word.slice(1);
        const assignees = [...new Set(rawTickets.map(t => t.assignee).filter(Boolean))];
        options = assignees
            .filter(a => a.toLowerCase().includes(query))
            .map(a => ({ value: `@${a}`, label: `@${a}`, type: "Asignado" }));
    } 
    // 2. Etiquetas (#...)
    else if (word.startsWith("#")) {
        const query = word.slice(1);
        const tags = [...new Set(rawTickets.flatMap(t => t.tags || []))];
        options = tags
            .filter(t => t.toLowerCase().includes(query))
            .map(t => ({ value: `#${t}`, label: `#${t}`, type: "Etiqueta" }));
    } 
    // 3. Estados (is:...)
    else if (word.startsWith("is:") || word.startsWith("status:")) {
        const prefix = word.startsWith("is:") ? "is:" : "status:";
        const query = word.slice(prefix.length);
        const statuses = ["todo", "in_progress", "done"];
        options = statuses
            .filter(s => s.includes(query))
            .map(s => ({ value: `${prefix}${s}`, label: `${prefix}${s}`, type: "Estado" }));
    } 
    // 4. Epics (epic:...)
    else if (word.startsWith("epic:")) {
        const query = word.slice(5).replace(/"/g, '');
        const epics = [...new Set(rawTickets.map(t => t.epic).filter(Boolean))];
        options = epics
            .filter(e => e.toLowerCase().includes(query))
            .map(e => ({ 
                value: e.includes(" ") ? `epic:"${e}"` : `epic:${e}`, 
                label: `epic:${e}`, 
                type: "Epic" 
            }));
    }
    // 5. Sugerencias por defecto si está empezando a escribir
    else if (word === "") {
        options = [
            { value: "@", label: "@asignado", type: "Filtro" },
            { value: "#", label: "#etiqueta", type: "Filtro" },
            { value: "is:", label: "is:estado", type: "Filtro" },
            { value: "epic:", label: "epic:nombre", type: "Filtro" }
        ];
    }

    return options;
}

function showOmnibarSuggestions() {
    if (!searchInput || !suggestionsContainer) return;

    const cursorPos = searchInput.selectionStart;
    const textBeforeCursor = searchInput.value.slice(0, cursorPos);
    const words = textBeforeCursor.split(/\s+/);
    const currentWord = words[words.length - 1];

    const suggestions = getOmnibarSuggestions(currentWord);

    if (suggestions.length === 0) {
        suggestionsContainer.style.display = "none";
        activeSuggestionIndex = -1;
        return;
    }

    activeSuggestionIndex = 0;
    suggestionsContainer.innerHTML = suggestions.map((item, index) => `
        <div class="suggestion-item ${index === 0 ? 'selected' : ''}" data-value="${item.value}">
            <span>${item.label}</span>
            <span class="suggestion-badge">${item.type}</span>
        </div>
    `).join("");

    suggestionsContainer.style.display = "block";

    // Clic en sugerencia
    suggestionsContainer.querySelectorAll(".suggestion-item").forEach(item => {
        item.addEventListener("click", () => applySuggestion(item.dataset.value));
    });
}

function applySuggestion(selectedValue) {
    const cursorPos = searchInput.selectionStart;
    const text = searchInput.value;
    const textBeforeCursor = text.slice(0, cursorPos);
    const textAfterCursor = text.slice(cursorPos);
    
    const words = textBeforeCursor.split(/\s+/);
    words[words.length - 1] = selectedValue;

    const newTextBefore = words.join(" ") + " ";
    searchInput.value = newTextBefore + textAfterCursor;
    
    // Posicionar cursor tras la inserción
    const newCursorPos = newTextBefore.length;
    searchInput.setSelectionRange(newCursorPos, newCursorPos);
    
    suggestionsContainer.style.display = "none";
    searchInput.focus();
    applyOmnibarFilter();
}

// Eventos del Input
if (searchInput) {
    searchInput.addEventListener("input", () => {
        showOmnibarSuggestions();
    });

    searchInput.addEventListener("focus", () => {
        showOmnibarSuggestions();
    });

    searchInput.addEventListener("keydown", (e) => {
        if (!suggestionsContainer || suggestionsContainer.style.display === "none") return;

        const items = suggestionsContainer.querySelectorAll(".suggestion-item");
        if (items.length === 0) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            activeSuggestionIndex = (activeSuggestionIndex + 1) % items.length;
            updateSelectedSuggestion(items);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            activeSuggestionIndex = (activeSuggestionIndex - 1 + items.length) % items.length;
            updateSelectedSuggestion(items);
        } else if (e.key === "Enter" || e.key === "Tab") {
            if (activeSuggestionIndex >= 0 && items[activeSuggestionIndex]) {
                e.preventDefault();
                applySuggestion(items[activeSuggestionIndex].dataset.value);
            }
        } else if (e.key === "Escape") {
            suggestionsContainer.style.display = "none";
        }
    });
}

function updateSelectedSuggestion(items) {
    items.forEach((item, index) => {
        item.classList.toggle("selected", index === activeSuggestionIndex);
        if (index === activeSuggestionIndex) {
            item.scrollIntoView({ block: "nearest" });
        }
    });
}

// Cerrar desplegable si se hace clic fuera
document.addEventListener("click", (e) => {
    if (suggestionsContainer && !e.target.closest(".search-container")) {
        suggestionsContainer.style.display = "none";
    }
});

document.addEventListener("DOMContentLoaded", initBoard);