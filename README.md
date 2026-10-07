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

- [ ] **Soporte CLI (Command Line Interface):** Modificar el punto de entrada de `uvicorn` para aceptar un flag `--db-path`. Ejemplo: `python main.py --db-path ../mi-otro-proyecto/pyckets.db`.
- [ ] **Filtros Básicos:** Implementar en el frontend los selectores para filtrar la vista actual por `Epic` o `Tag`.
- [ ] **Documentación de Uso:** Actualizar este README con las instrucciones para arrancar el servidor en un proyecto nuevo.
