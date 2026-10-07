const API_BASE = "/api";
const boardContainer = document.getElementById("board-container");

// Función principal que orquesta la carga de datos
async function initBoard() {
    try {
        // Lanzamos ambas peticiones en paralelo para ahorrar tiempo
        const [columnsRes, ticketsRes] = await Promise.all([
            fetch(`${API_BASE}/columns`),
            fetch(`${API_BASE}/tickets`)
        ]);

        const columns = await columnsRes.json();
        const tickets = await ticketsRes.json();

        renderColumns(columns);
        renderTickets(tickets);
    } catch (error) {
        console.error("Error crítico cargando el tablero:", error);
        boardContainer.innerHTML = "<p>Error al conectar con la base de datos.</p>";
    }
}

// Genera la estructura de las columnas en el DOM
function renderColumns(columns) {
    boardContainer.innerHTML = ""; 

    columns.forEach(col => {
        // Normalizamos el nombre (ej. "To Do" -> "todo", "In Progress" -> "in_progress")
        // Esto servirá como enlace entre la columna y el estado del ticket
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

// Inserta cada ticket en su columna correspondiente
function renderTickets(tickets) {
    tickets.forEach(ticket => {
        // Buscamos el contenedor interno de la columna que coincide con el status del ticket
        const colContent = document.querySelector(`.column-content[data-status="${ticket.status}"]`);
        
        if (colContent) {
            const ticketDiv = document.createElement("div");
            ticketDiv.className = "ticket-card";
            ticketDiv.draggable = true; // Propiedad HTML5 nativa clave para el siguiente paso
            ticketDiv.dataset.id = ticket.id; // Guardamos la ID de BD en el HTML
            
            // Construimos el interior de la tarjeta
            ticketDiv.innerHTML = `
                <div class="ticket-title">${ticket.title}</div>${ticket.description ? `<div style="font-size: 0.8rem; color: #5e6c84; margin-bottom: 8px;">${ticket.description}</div>` : ""}
                <div style="font-size: 0.75rem; color: #0052cc; font-weight: bold;">
                    ${ticket.tags && ticket.tags.length > 0 ? ticket.tags.map(tag => `#${tag}`).join(" ") : ""}
                </div>
            `;
            
            colContent.appendChild(ticketDiv);
        }
    });
}

// Arrancar la maquinaria cuando el navegador termine de leer el HTML
document.addEventListener("DOMContentLoaded", initBoard);

// --- LÓGICA DE DRAG & DROP ---

let draggedTicket = null;

function setupDragAndDrop() {
    const tickets = document.querySelectorAll('.ticket-card');
    const columns = document.querySelectorAll('.column-content');

    // 1. Eventos para las tarjetas que se arrastran
    tickets.forEach(ticket => {
        ticket.addEventListener('dragstart', (e) => {
            draggedTicket = ticket;
            // Un pequeño efecto visual para indicar que se está moviendo
            setTimeout(() => ticket.style.opacity = '0.5', 0); 
        });

        ticket.addEventListener('dragend', () => {
            // Restaurar estilo al soltar (ya sea con éxito o si se cancela)
            if (draggedTicket) draggedTicket.style.opacity = '1';
            draggedTicket = null;
        });
    });

    // 2. Eventos para las zonas donde se pueden soltar (Columnas)
    columns.forEach(column => {
        // Necesario para que el navegador permita el drop
        column.addEventListener('dragover', (e) => {
            e.preventDefault(); 
        });

        // Efecto visual al pasar por encima de una columna válida
        column.addEventListener('dragenter', (e) => {
            e.preventDefault();
            column.style.backgroundColor = '#e2e4e9'; 
        });

        column.addEventListener('dragleave', () => {
            column.style.backgroundColor = ''; 
        });

        // 3. El evento clave: Soltar la tarjeta
        column.addEventListener('drop', async (e) => {
            e.preventDefault();
            column.style.backgroundColor = ''; // Limpiamos el color hover

            if (draggedTicket) {
                // Comprobamos si realmente cambió de columna para no saturar la API
                const oldColumn = draggedTicket.closest('.column-content');
                if (oldColumn === column) return;

                // Movemos el elemento en el DOM instantáneamente (Optimistic UI)
                column.appendChild(draggedTicket);

                const ticketId = draggedTicket.dataset.id;
                const newStatus = column.dataset.status;

                // Lanzamos la actualización a la base de datos
                await updateTicketStatus(ticketId, newStatus);
            }
        });
    });
}

// Llama al endpoint ultraligero que creamos en FastAPI
async function updateTicketStatus(ticketId, status) {
    try {
        const response = await fetch(`${API_BASE}/tickets/${ticketId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: status })
        });

        if (!response.ok) {
            console.error(`Error de servidor: ${response.status}`);
            // En un caso real, aquí devolveríamos el ticket a su columna original
        }
    } catch (error) {
        console.error("Error de red al actualizar el ticket:", error);
    }
}

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
        
        // Inicializamos los eventos una vez que el DOM está construido
        setupDragAndDrop();
        
    } catch (error) {
        console.error("Error crítico cargando el tablero:", error);
        boardContainer.innerHTML = "<p>Error al conectar con la base de datos.</p>";
    }
}

// --- LÓGICA DE CREACIÓN DE TICKETS ---

const modal = document.getElementById("ticket-modal");
const btnNewTicket = document.getElementById("new-ticket");
const btnCancel = document.getElementById("cancel-ticket");
const formNewTicket = document.getElementById("new-ticket-form");

// Abrir el modal
btnNewTicket.addEventListener("click", () => {
    modal.style.display = "flex";
    document.getElementById("ticket-title").focus(); // Autoselecciona el input
});

// Cerrar el modal
const closeModal = () => {
    modal.style.display = "none";
    formNewTicket.reset(); // Limpiamos el formulario
};

btnCancel.addEventListener("click", closeModal);

// Cerrar haciendo clic fuera de la ventana blanca
modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
});

// Enviar los datos al Backend
formNewTicket.addEventListener("submit", async (e) => {
    e.preventDefault(); // Evitamos que la página se recargue

    const newTicketData = {
        title: document.getElementById("ticket-title").value,
        description: document.getElementById("ticket-desc").value,
        status: "todo", // Por defecto caen en la primera columna
        tags: [] // Lo dejamos vacío de momento en el MVP
    };

    try {
        const response = await fetch(`${API_BASE}/tickets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newTicketData)
        });

        if (response.ok) {
            const savedTicket = await response.json();
            
            // Reutilizamos la función que ya tenemos, pasándole un array con el nuevo ticket
            renderTickets([savedTicket]); 
            
            // OJO: Hay que volver a atar los eventos de Drag & Drop para el nuevo ticket
            setupDragAndDrop(); 
            
            closeModal();
        } else {
            console.error("Error al crear el ticket");
        }
    } catch (error) {
        console.error("Error de red:", error);
    }
});