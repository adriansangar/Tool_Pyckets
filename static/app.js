const API_BASE = "/api";
const boardContainer = document.getElementById("board-container");
const listContainer = document.getElementById("list-container");
const ticketListBody = document.getElementById("ticket-list-body");
const btnToggleView = document.getElementById("toggle-view");

let isListView = false;

// --- INIT: Carga inicial de datos ---
async function initBoard() {
    try {
        const [columnsRes, ticketsRes] = await Promise.all([
            fetch(`${API_BASE}/columns`),
            fetch(`${API_BASE}/tickets`)
        ]);

        const columns = await columnsRes.json();
        const tickets = await ticketsRes.json();

        renderColumns(columns);
        renderTickets(tickets);
        // Le pasamos 'true' para forzar que limpie la tabla antes de inyectar
        renderTableTickets(tickets, true); 
        
        setupDragAndDrop();
    } catch (error) {
        console.error("Error crítico cargando el tablero:", error);
    }
}

// --- TOGGLE: Alternar Vistas ---
btnToggleView.addEventListener("click", () => {
    isListView = !isListView;
    if (isListView) {
        boardContainer.style.display = "none";
        listContainer.style.display = "block";
        btnToggleView.textContent = "Vista Kanban";
    } else {
        boardContainer.style.display = "flex";
        listContainer.style.display = "none";
        btnToggleView.textContent = "Vista Lista";
    }
});

// --- RENDER KANBAN ---
function renderColumns(columns) {
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
        const colContent = document.querySelector(`.column-content[data-status="${ticket.status}"]`);
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

// --- RENDER LISTA ---
function renderTableTickets(tickets, clearTable = false) {
    // Ahora el borrado es explícito y seguro
    if (clearTable) ticketListBody.innerHTML = ""; 

    tickets.forEach(ticket => {
        const tr = document.createElement("tr");
        const statusName = (ticket.status || "todo").replace("_", " "); 
        
        tr.innerHTML = `
            <td style="color: var(--text-muted); font-size: 0.85rem;">TB-${ticket.id}</td>
            <td style="font-weight: 500; font-size: 0.95rem;">${ticket.title}</td>
            <td><span class="status-badge">${statusName}</span></td>
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

async function updateTicketStatus(ticketId, status) {
    try {
        await fetch(`${API_BASE}/tickets/${ticketId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: status })
        });
        // Si recargas la página tras moverlo, también se actualizará en la tabla
    } catch (error) {
        console.error("Error:", error);
    }
}

// --- MODAL DE CREACIÓN ---
const modal = document.getElementById("ticket-modal");
const btnNewTicket = document.getElementById("new-ticket");
const btnCancel = document.getElementById("cancel-ticket");
const formNewTicket = document.getElementById("new-ticket-form");

if (btnNewTicket) {
    btnNewTicket.addEventListener("click", () => {
        modal.style.display = "flex";
        document.getElementById("ticket-title").focus(); 
    });

    const closeModal = () => {
        modal.style.display = "none";
        formNewTicket.reset(); 
    };

    btnCancel.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
    });

    formNewTicket.addEventListener("submit", async (e) => {
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
                
                // Actualizamos ambas vistas pasándole el nuevo ticket
                renderTickets([savedTicket]); 
                // Le pasamos 'false' para que NO limpie la tabla, solo lo añada al final
                renderTableTickets([savedTicket], false); 
                
                setupDragAndDrop(); 
                closeModal();
            }
        } catch (error) {
            console.error("Error:", error);
        }
    });
}

// Disparador inicial
document.addEventListener("DOMContentLoaded", initBoard);