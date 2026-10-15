const API_BASE = "/api";
const boardContainer = document.getElementById("board-container");
const listContainer = document.getElementById("list-container");
const ticketListBody = document.getElementById("ticket-list-body");
const btnToggleView = document.getElementById("toggle-view");

let isListView = false;
let globalColumns = [];
let currentProjectId = null;

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
        const tickets = await ticketsRes.json();

        renderColumns(globalColumns);
        renderTickets(tickets);
        renderTableTickets(tickets, true);
        renderQuickFilters(tickets);
        setupDragAndDrop();
    } catch (error) {
        console.error("Error crítico cargando el tablero:", error);
    }
}

if (btnToggleView) {
    btnToggleView.addEventListener("click", () => {
        isListView = !isListView;
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
        btn.dataset.filter = tag.toLowerCase();
        btn.textContent = `#${tag}`;
        filtersBar.appendChild(btn);
    });

    filtersBar.querySelectorAll(".filter-pill").forEach(pill => {
        pill.addEventListener("click", (e) => {
            filtersBar.querySelectorAll(".filter-pill").forEach(p => p.classList.remove("active"));
            e.target.classList.add("active");

            const searchInput = document.getElementById("search-filter");
            if (searchInput) {
                searchInput.value = e.target.dataset.filter;
                searchInput.dispatchEvent(new Event('input'));
            }
        });
    });
}

const searchFilter = document.getElementById("search-filter");
if (searchFilter) {
    searchFilter.addEventListener("input", (e) => {
        const term = e.target.value.toLowerCase();
        document.querySelectorAll(".ticket-card").forEach(card => {
            card.style.display = card.textContent.toLowerCase().includes(term) ? "flex" : "none";
        });
        document.querySelectorAll("#ticket-list-body tr").forEach(row => {
            row.style.display = row.textContent.toLowerCase().includes(term) ? "table-row" : "none";
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
const btnNewTicket = document.getElementById("new-ticket");
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

    if (btnNewTicket) {
        btnNewTicket.addEventListener("click", () => {
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
            
            document.getElementById("panel-title").textContent = `Editar TB-${ticket.id}`;
            document.getElementById("side-panel").classList.add("open");
        }
    } catch (error) {
        console.error("Error cargando el ticket:", error);
    }
}

document.addEventListener("keydown", (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape' && sidePanel && sidePanel.classList.contains("open")) {
            e.target.blur();
            if (btnClosePanel) btnClosePanel.click();
        }
        return;
    }

    if (e.key.toLowerCase() === 'c') {
        const newTicketBtn = document.getElementById("sidebar-new-ticket");
        if (newTicketBtn) {
            e.preventDefault();
            newTicketBtn.click();
        }
    }

    if (e.key.toLowerCase() === 'k' && btnToggleView) {
        e.preventDefault();
        btnToggleView.click();
    }

    if (e.key === 'Escape' && sidePanel && sidePanel.classList.contains("open")) {
        if (btnClosePanel) btnClosePanel.click();
    }
});

const toggleSidebarBtn = document.getElementById('toggle-sidebar');
const sidebar = document.getElementById('sidebar');

if (toggleSidebarBtn && sidebar) {
    toggleSidebarBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });
}

const sidebarNewTicketBtn = document.getElementById("sidebar-new-ticket");
if (sidebarNewTicketBtn && sidePanel) {
    sidebarNewTicketBtn.addEventListener("click", () => {
        document.getElementById("panel-title").textContent = "Nuevo Ticket";
        sidePanel.classList.add("open");
        setTimeout(() => document.getElementById("ticket-title").focus(), 300);
    });
}

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
            
            a.addEventListener("click", (e) => {
                e.preventDefault();
                document.querySelectorAll(".project-link").forEach(el => el.classList.remove("active"));
                a.classList.add("active");
                currentProjectId = p.id;
                document.getElementById("board-title").textContent = p.name;
                fetchAndRenderTickets();
            });
            
            projectList.appendChild(a);
        });
    } catch (e) {
        console.error("Error cargando proyectos:", e);
    }
}

const themeToggleBtn = document.getElementById("theme-toggle");
if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
        const currentTheme = document.documentElement.getAttribute("data-theme");
        if (currentTheme === "dark") {
            document.documentElement.removeAttribute("data-theme");
        } else {
            document.documentElement.setAttribute("data-theme", "dark");
        }
    });
}

document.addEventListener("DOMContentLoaded", initBoard);