const API_BASE = "/api";
const boardContainer = document.getElementById("board-container");
const listContainer = document.getElementById("list-container");
const ticketListBody = document.getElementById("ticket-list-body");
const btnToggleView = document.getElementById("toggle-view");

let isListView = false;
let globalColumns = [];

// --- INIT: Carga inicial ---
async function initBoard() {
    try {
        const [columnsRes, ticketsRes] = await Promise.all([
            fetch(`${API_BASE}/columns`),
            fetch(`${API_BASE}/tickets`)
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

// --- TOGGLE VISTAS ---
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

// --- RENDER KANBAN ---
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

            ticketDiv.innerHTML = `
                <div class="ticket-title">${ticket.title}</div>
                ${ticket.description ? `<div class="ticket-desc">${ticket.description}</div>` : ""}
                <div class="tags-container">
                    ${ticket.tags && ticket.tags.length > 0 ? ticket.tags.map(tag => `<span class="tag-badge">${tag}</span>`).join("") : ""}
                </div>
            `;
            colContent.appendChild(ticketDiv);
        }
    });
}

// --- RENDER LISTA CON EDICIÓN INLINE ---
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
            <td style="font-weight: 500; font-size: 0.95rem;">${ticket.title}</td>
            <td>
                <select class="status-select" onchange="syncTicketStatus(${ticket.id}, this.value)">
                    ${optionsHtml}
                </select>
            </td>
            <td>
                <div class="tags-container" style="margin-top: 0;">
                    ${ticket.tags && ticket.tags.length > 0
                        ? ticket.tags.map(tag => `<span class="tag-badge">${tag}</span>`).join("")
                        : "<span style='color: #a5adba; font-size: 0.8rem;'>Sin etiquetas</span>"}
                </div>
            </td>
        `;
        ticketListBody.appendChild(tr);
    });
}

// --- FILTROS RÁPIDOS ---
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

// --- BÚSQUEDA REACTIVA ---
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

// --- SINCRONIZADOR DE ESTADOS (API + DOM) ---
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

// --- DRAG & DROP ---
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

// --- PANEL LATERAL DE CREACIÓN ---
const sidePanel = document.getElementById("side-panel");
const btnNewTicket = document.getElementById("new-ticket");
const btnClosePanel = document.getElementById("close-panel");
const btnCancel = document.getElementById("cancel-ticket");
const formTicket = document.getElementById("ticket-form");

if (btnNewTicket && sidePanel) {
    const closePanel = () => {
        sidePanel.classList.remove("open");
        setTimeout(() => { if(formTicket) formTicket.reset(); }, 300);
    };

    btnNewTicket.addEventListener("click", () => {
        sidePanel.classList.add("open");
        setTimeout(() => {
            const titleInput = document.getElementById("ticket-title");
            if(titleInput) titleInput.focus();
        }, 300);
    });

    if (btnClosePanel) btnClosePanel.addEventListener("click", closePanel);
    if (btnCancel) btnCancel.addEventListener("click", closePanel);

    if (formTicket) {
        formTicket.addEventListener("submit", async (e) => {
            e.preventDefault();
            const newTicketData = {
                title: document.getElementById("ticket-title").value,
                description: document.getElementById("ticket-desc").value,
                status: "todo",
                tags: []
            };

            try {
                const response = await fetch(`${API_BASE}/tickets`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newTicketData)
                });

                if (response.ok) {
                    const savedTicket = await response.json();
                    renderTickets([savedTicket]);
                    renderTableTickets([savedTicket], false);
                    setupDragAndDrop();
                    closePanel();
                }
            } catch (error) {
                console.error("Error al guardar:", error);
            }
        });
    }
}

// --- ATAJOS DE TECLADO ---
document.addEventListener("keydown", (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape' && sidePanel && sidePanel.classList.contains("open")) {
            e.target.blur();
            if (btnClosePanel) btnClosePanel.click();
        }
        return;
    }

    if (e.key.toLowerCase() === 'c' && btnNewTicket) {
        e.preventDefault();
        btnNewTicket.click();
    }

    if (e.key.toLowerCase() === 'k' && btnToggleView) {
        e.preventDefault();
        btnToggleView.click();
    }

    if (e.key === 'Escape' && sidePanel && sidePanel.classList.contains("open")) {
        if (btnClosePanel) btnClosePanel.click();
    }
});

// --- ARRANQUE ---
document.addEventListener("DOMContentLoaded", initBoard);