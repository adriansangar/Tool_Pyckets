# 🚀 Pyckets - MVP Roadmap

Pyckets es un gestor de tareas ágil, ligero y portátil diseñado para acoplarse directamente al repositorio de cualquier proyecto. Utiliza **SQLite** como base de datos local y **FastAPI** como motor backend, exponiendo una interfaz web estática con vistas en formato Kanban y Lista.

## 🏗️ Fase 1: Configuración y Modelado de Datos
El objetivo es establecer los cimientos de la base de datos y definir las entidades principales del sistema.

- [x] **Inicializar el entorno:** Crear el entorno virtual (`venv`) y el archivo `requirements.txt` con `fastapi`, `uvicorn` y `sqlmodel`.
- [x] **Definir los Modelos (SQLModel):** Crear el archivo `models.py` con las tablas principales:
  - `Ticket`: id, title, description, status, epic_id, tags (JSON/String), release.
  - `Epic`: id, name, color.
  - `Column`: id, name, order (para configurar el tablero dinámicamente).
- [x] **Motor de Base de Datos:** Crear `database.py` con la lógica para inicializar la conexión (`sqlite:///pyckets.db`) y generar las tablas si no existen.

## ⚙️ Fase 2: Desarrollo de la API REST (Backend)
Construir los endpoints necesarios para que el frontend pueda leer y modificar el estado del proyecto sin recargar la página.

- [x] **Endpoints de Lectura (GET):**
  - `/api/columns`: Devuelve la estructura del tablero.
  - `/api/tickets`: Devuelve todos los tickets.
  - `/api/epics`: Devuelve los epics para los filtros y etiquetas.
- [x] **Endpoints de Escritura (POST/PUT):**
  - `POST /api/tickets`: Creación de un nuevo ticket.
  - `PUT /api/tickets/{id}/status`: Endpoint ultraligero exclusivo para actualizar la columna de un ticket cuando se arrastre en el frontend.
- [x] **Testing del Backend:** Validar las rutas usando la interfaz interactiva autogenerada de FastAPI (`/docs`).

## 🎨 Fase 3: Interfaz de Usuario (Frontend Estático)
Desarrollar una *Single Page Application* (SPA) sencilla usando HTML, CSS y Vanilla JavaScript (o un framework muy ligero).

- [x] **Estructura Base (`index.html`):** Crear el layout principal con un header (para los filtros) y un contenedor central dinámico.
- [x] **Lógica de Conexión (`app.js`):** Implementar las funciones `fetch()` para consumir los endpoints de lectura del backend al cargar la página.
- [x] **Vista Kanban:** Renderizar dinámicamente las columnas y ubicar cada ticket en su columna correspondiente según su estado.
- [x] **Funcionalidad Drag & Drop:** Implementar la lógica para arrastrar tarjetas entre columnas y disparar el `PUT /api/tickets/{id}/status`.
- [x] **Vista de Lista:** Crear un botón que alterne el renderizado del contenedor central hacia una tabla de datos clásica.

## 🚀 Fase 4: Empaquetado y Despliegue Agnóstico
Convertir el proyecto en una herramienta que pueda inyectarse en cualquier otro directorio.

- [x] **Soporte CLI (Command Line Interface):** Modificar el punto de entrada de `uvicorn` para aceptar un flag `--db-path`. Ejemplo: `python main.py --db-path ../mi-otro-proyecto/pyckets.db`.
- [x] **Filtros Básicos:** Implementar en el frontend los selectores para filtrar la vista actual por `Epic` o `Tag`.
- [x] **Documentación de Uso:** Actualizar este README con las instrucciones para arrancar el servidor en un proyecto nuevo.

## 💎 Fase 5: UI/UX Avanzada y Productividad
Refinar la interfaz para maximizar la velocidad de uso y alcanzar estándares profesionales, manteniendo el frontend ligero y sin dependencias.

- [x] **Panel Lateral de Detalles:** Reemplazar el modal central por un panel deslizable a la derecha para permitir la edición del ticket manteniendo visible el contexto del tablero.
- [x] **Edición en Línea (Vista de Lista):** Convertir la tabla en interactiva, permitiendo modificar estados y etiquetas directamente desde las celdas mediante menús desplegables nativos.
- [x] **Filtros Rápidos:** Añadir una botonera de acceso rápido bajo la barra de búsqueda para aplicar filtros comunes con un solo clic.
- [x] **Atajos de Teclado:** Implementar *listeners* globales para operar la aplicación sin ratón (`C` para crear ticket, `K` para alternar vistas, `Esc` para cerrar paneles).

## 🏗️ Fase 6: Enriquecimiento de Datos y Edición Completa
Ampliar el modelo subyacente y la interfaz para gestionar información detallada de cada tarea, acercando la herramienta a estándares profesionales.

- [x] **Expansión del Modelo de Datos:** Modificar `models.py` (SQLModel) para añadir `epic`, `assignee`, `due_date`, `time_logged` y `tags`.
- [x] **Endpoint de Actualización Total:** Crear la ruta `PUT /api/tickets/{id}` en el backend para sobrescribir todos los campos de un ticket.
- [x] **Formulario Extendido en UI:** Añadir inputs de calendario, asignación y tiempo en el panel lateral de `index.html`.
- [x] **Modo Edición Interactivo:** Modificar `app.js` para que al hacer clic en una tarjeta, el panel se abra rellenado con los datos actuales del ticket listo para ser modificado y guardado.

## 🌌 Fase 7: Arquitectura Multi-Proyecto y UI Premium
Evolución del frontend hacia una experiencia de alto rendimiento (inspiración Linear/Jira/Monday) con soporte para múltiples espacios de trabajo.

- [x] **Estructura Multi-Tablero:** Refactorización de `models.py` para crear la entidad `Project` y vincular mediante llaves foráneas los tickets y columnas a proyectos específicos.
- [x] **Layout con Barra Lateral (Sidebar):** Implementación de un menú lateral colapsable para crear, organizar y alternar entre distintos tableros al instante.
- [x] **Dark Mode Profesional:** Rediseño total de la paleta CSS usando variables dinámicas para un tema oscuro de alto contraste (grises profundos, bordes sutiles y acentos de color).
- [ ] **Filtros Inteligentes (Omnibar):** Evolución del buscador superior hacia una barra de comandos avanzada capaz de interpretar queries compuestas (ej. `is:bug @adrian`).
- [ ] **Tableros Customizables:** Lógica en el frontend y backend para permitir añadir, renombrar, colorear y reordenar columnas de forma independiente para cada proyecto.