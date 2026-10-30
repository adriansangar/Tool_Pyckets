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
- [x] **Filtros Inteligentes (Omnibar):** Evolución del buscador superior hacia una barra de comandos avanzada capaz de interpretar queries compuestas (ej. `is:bug @adrian`).
- [x] **Tableros Customizables:** Lógica en el frontend y backend para permitir añadir, renombrar, colorear y reordenar columnas de forma independiente para cada proyecto.

# 🔗 Fase 8: Integración con GitHub y Trazabilidad del Desarrollo

Objetivo: conectar Pyckets con GitHub para vincular los tickets con el código fuente y visualizar la actividad del desarrollo prácticamente en tiempo real, manteniendo una arquitectura preparada para funcionar en local y desplegarse posteriormente con Uvicorn.

- [x] **Integración con GitHub API:** implementar un servicio backend dedicado para autenticarse con GitHub y consultar repositorios, ramas, commits y pull requests.
- [x] **Gestión de Repositorios:** permitir conectar uno o varios repositorios de GitHub a cada proyecto de Pyckets, con configuración independiente.
- [x] **Panel de Actividad GitHub:** crear un feed cronológico de actividad que muestre commits recientes, autor, mensaje, rama, fecha y enlace directo a GitHub.
- [x] **Vinculación de Tickets y Commits:** permitir asociar commits a tickets mediante referencias como `PYK-123` en los mensajes de commit, así como mediante vinculación manual desde la interfaz.
- [x] **Timeline del Ticket:** añadir una sección de actividad dentro del panel de detalle de cada ticket que combine cambios de estado, comentarios, commits, ramas y pull requests relacionados.
- [x] **Seguimiento de Pull Requests:** mostrar las PR asociadas a cada ticket, incluyendo estado (abierta, fusionada o cerrada), autor, revisores, checks de CI y enlace directo.
- [x] **Detección de Ramas:** permitir crear o vincular una rama de desarrollo desde un ticket, utilizando una nomenclatura configurable como `feature/PYK-123-descripcion`.
- [x] **Actualización Automática:** implementar sincronización periódica con la GitHub API para el modo local y webhooks para recibir eventos en tiempo real cuando la aplicación esté publicada y sea accesible desde GitHub.
- [x] **Automatización del Ciclo de Vida:** permitir configurar reglas para actualizar el estado de los tickets cuando se abra o fusione una PR, sin sobrescribir cambios manuales de forma inesperada.
- [x] **Historial de Sincronización:** registrar la última sincronización, errores de conexión, eventos procesados y posibles duplicados para facilitar el diagnóstico.
- [x] **Gestión Segura de Credenciales:** almacenar tokens exclusivamente en el backend, utilizar permisos mínimos y variables de entorno o un almacén de secretos apropiado; nunca exponer credenciales en el frontend ni versionarlas en Git.
- [x] **Configuración por Proyecto:** añadir una sección de integraciones para conectar, desconectar y configurar repositorios, ramas por defecto y reglas de automatización.
- [x] **Resiliencia y Límites de API:** gestionar paginación, rate limits, reintentos, eventos duplicados y recuperación tras interrupciones de la sincronización.
- [x] **Pruebas de Integración:** validar autenticación, asociación de eventos con tickets, idempotencia de webhooks, errores de red y funcionamiento sin conexión a GitHub.

**Criterios de aceptación:**
- Cada proyecto puede vincularse a un repositorio sin mezclar actividad de otros proyectos.
- Los commits y las PR relacionadas aparecen en el ticket correspondiente y enlazan con GitHub.
- La sincronización local funciona sin requerir que GitHub pueda acceder directamente a `localhost`.
- Al desplegar la aplicación, los webhooks permiten recibir eventos sin depender exclusivamente del sondeo periódico.
- La aplicación sigue funcionando si GitHub no está disponible y recupera la sincronización posteriormente.
- Ningún token o secreto queda expuesto al navegador o al repositorio de código.

# ✨ Fase 9: UI Premium, Productividad y Gestión Avanzada de Proyectos

Objetivo: evolucionar Pyckets hacia un gestor de tickets de alto rendimiento, con una experiencia visual inspirada en Linear, Jira y Monday, navegación por teclado, vistas personalizables y herramientas avanzadas para gestionar proyectos de software.

## 🎨 1. Rediseño Visual y Sistema de Diseño

- [ ] **Design System Unificado:** definir una biblioteca de componentes reutilizables para botones, formularios, modales, menús, tooltips, badges, avatares, tablas y tarjetas.
- [ ] **Estética Premium:** rediseñar la interfaz con jerarquía visual clara, tipografía moderna, espaciado consistente, bordes sutiles y animaciones discretas.
- [ ] **Temas Personalizables:** implementar temas oscuro, claro y automático según el sistema operativo, con persistencia de preferencias.
- [ ] **Paletas por Proyecto:** permitir personalizar el color de acento, icono y apariencia de cada proyecto.
- [ ] **Sidebar Avanzada:** añadir secciones plegables, proyectos favoritos, vistas guardadas, indicadores de actividad y navegación rápida.
- [ ] **Panel de Detalle Mejorado:** convertir el panel lateral en una ficha completa del ticket con secciones organizadas, edición inline y navegación entre tickets sin cerrar el panel.
- [ ] **Microinteracciones:** incorporar transiciones suaves, skeleton loaders, estados de carga, feedback visual al guardar y notificaciones toast.
- [ ] **Diseño Responsive:** adaptar los tableros, tablas, filtros y paneles para pantallas pequeñas, tablets y escritorio.
- [ ] **Accesibilidad:** garantizar navegación por teclado, foco visible, contraste adecuado, etiquetas accesibles y compatibilidad con lectores de pantalla.

## ⌨️ 2. Command Palette y Productividad por Teclado

- [ ] **Command Palette Global:** ampliar `Ctrl+K` para ejecutar acciones, navegar entre proyectos, cambiar vistas, crear tickets y acceder a configuraciones desde un único buscador.
- [ ] **Atajos Configurables:** permitir consultar y personalizar combinaciones de teclas, evitando conflictos con el sistema operativo y los campos de edición.
- [ ] **Quick Create:** crear tickets rápidamente sin abandonar la vista actual, con título, proyecto, estado, prioridad y asignado.
- [ ] **Navegación entre Tickets:** implementar atajos para moverse al ticket anterior o siguiente y abrir el detalle sin utilizar el ratón.
- [ ] **Acciones en Lote:** seleccionar varios tickets y cambiar sus estados, asignados, etiquetas, prioridades o fechas de vencimiento de una sola vez.
- [ ] **Acciones Contextuales:** añadir menús accesibles mediante teclado y ratón en tickets, columnas, proyectos y vistas.
- [ ] **Undo y Confirmación:** ofrecer deshacer para operaciones reversibles y confirmaciones explícitas para eliminaciones permanentes.

## 🗂️ 3. Vistas Avanzadas y Tableros Personalizables

- [ ] **Kanban Premium:** mejorar las tarjetas, encabezados de columnas, contadores, agrupación visual, drag and drop y feedback durante los cambios de estado.
- [ ] **Vista Tabla Avanzada:** incorporar ordenación por columnas, filtros por campo, columnas configurables, redimensionamiento y edición inline.
- [ ] **Vista Calendario:** visualizar tickets por fecha límite y planificar entregas mediante un calendario mensual y semanal.
- [ ] **Vista Timeline y Gantt:** representar duración, fechas, dependencias y solapamientos entre tareas para planificar proyectos complejos.
- [ ] **Vista Mi Trabajo:** crear un espacio personal con tickets asignados, vencimientos próximos, tareas atrasadas y elementos recientemente actualizados.
- [ ] **Vistas Guardadas:** permitir guardar filtros, ordenación, agrupaciones y columnas visibles con nombre propio.
- [ ] **Agrupación Dinámica:** agrupar tickets por estado, prioridad, asignado, etiqueta, epic o fecha.
- [ ] **Filtros Compuestos:** soportar operadores AND/OR, exclusiones, rangos de fechas, campos vacíos y combinaciones de condiciones.
- [ ] **Ordenación y Límites de Trabajo:** permitir priorizar tickets dentro de cada columna y configurar límites WIP para detectar acumulación de trabajo.
- [ ] **Columnas Inteligentes:** mostrar recuentos, capacidad configurada y señales visuales de columnas saturadas.

## 🎫 4. Gestión Profesional del Ciclo de Vida del Ticket

- [ ] **Modelo de Ticket Ampliado:** incorporar prioridad, tipo de incidencia, estimación, reporter, fecha de creación, última actualización y resolución.
- [ ] **Tipos de Ticket:** soportar tareas, bugs, historias de usuario, épicas, mejoras técnicas y subtareas.
- [ ] **Jerarquía de Trabajo:** relacionar épicas, historias, tareas y subtareas, con navegación entre elementos padre e hijos.
- [ ] **Dependencias entre Tickets:** permitir bloquear, ser bloqueado por, relacionar o duplicar tickets, detectando dependencias circulares.
- [ ] **Comentarios y Discusiones:** añadir comentarios, menciones a usuarios, edición de comentarios y notificaciones de respuestas.
- [ ] **Historial de Cambios:** registrar quién modificó cada campo, cuándo se realizó el cambio y cuál era el valor anterior.
- [ ] **Checklists:** incorporar listas de verificación dentro de los tickets para descomponer tareas sin crear subtickets innecesarios.
- [ ] **Adjuntos:** permitir adjuntar imágenes, logs, capturas de pantalla y documentos con límites de tamaño y validación de archivos.
- [ ] **Plantillas de Tickets:** crear plantillas reutilizables para bugs, tareas técnicas, incidencias y revisiones de código.
- [ ] **Tickets Recurrentes:** programar la creación periódica de tareas de mantenimiento o seguimiento.
- [ ] **Duplicados y Relaciones:** detectar posibles tickets duplicados y facilitar la vinculación entre incidencias relacionadas.
- [ ] **Archivado y Recuperación:** permitir archivar tickets y restaurarlos conservando su historial.

## 🔎 5. Búsqueda Global y Sistema de Filtros

- [ ] **Búsqueda de Texto Completa:** buscar por título, descripción, identificador, comentarios, etiquetas y otros campos relevantes.
- [ ] **Sintaxis de Consultas Ampliada:** soportar expresiones como `is:open`, `priority:high`, `@adrian`, `#bug`, `due:overdue` y `project:backend`.
- [ ] **Autocompletado Contextual:** sugerir valores válidos según los proyectos, usuarios, estados, prioridades y etiquetas disponibles.
- [ ] **Filtros Visuales:** permitir construir consultas mediante menús sin necesidad de conocer la sintaxis.
- [ ] **Historial de Búsquedas:** recuperar búsquedas recientes y fijar las más utilizadas.
- [ ] **Búsqueda Global entre Proyectos:** encontrar tickets en todos los proyectos respetando permisos y filtros activos.

## 📊 6. Dashboard, Métricas y Seguimiento

- [ ] **Dashboard Personalizable:** permitir organizar widgets de resumen, actividad, métricas y tareas pendientes.
- [ ] **Métricas de Proyecto:** visualizar tickets abiertos, completados, atrasados, bloqueados y distribuidos por prioridad.
- [ ] **Burndown y Progreso:** representar el avance de un sprint o de una entrega respecto al trabajo pendiente.
- [ ] **Cycle Time y Lead Time:** medir cuánto tarda un ticket desde su creación hasta su finalización, diferenciando tiempo total y tiempo activo cuando existan datos suficientes.
- [ ] **Control de Carga:** mostrar la distribución de tareas por persona y detectar asignaciones desequilibradas.
- [ ] **Seguimiento de Vencimientos:** identificar fechas límite próximas, retrasos y tendencias de cumplimiento.
- [ ] **Actividad Reciente:** unificar los cambios importantes del proyecto, incluyendo actividad de tickets e integraciones externas.
- [ ] **Exportación de Informes:** permitir exportar listados y métricas a CSV y generar informes resumidos.
- [ ] **Definición Transparente de Métricas:** documentar fórmulas, periodos y datos excluidos para evitar interpretaciones incorrectas.

## ⚙️ 7. Automatizaciones y Reglas de Negocio

- [ ] **Motor de Automatizaciones:** crear reglas del tipo desencadenante + condición + acción.
- [ ] **Cambios Automáticos de Estado:** actualizar el estado cuando se cumplan condiciones configuradas.
- [ ] **Asignación Automática:** asignar responsables según etiquetas, tipo de ticket, proyecto o reglas definidas.
- [ ] **Alertas de Vencimiento:** generar avisos cuando se aproxime una fecha límite o un ticket quede atrasado.
- [ ] **Automatizaciones con GitHub:** conectar eventos de commits, pull requests y CI con el ciclo de vida del ticket.
- [ ] **Reglas Configurables:** permitir activar, desactivar, probar y consultar el historial de ejecución de cada automatización.
- [ ] **Protección contra Bucles:** detectar reglas que se disparen recursivamente y limitar reintentos y ejecuciones repetidas.

## 🔔 8. Notificaciones y Centro de Actividad

- [ ] **Centro de Notificaciones:** reunir menciones, asignaciones, comentarios, cambios relevantes y eventos de integración.
- [ ] **Preferencias de Notificación:** permitir elegir qué eventos generan avisos y cuáles se silencian.
- [ ] **Seguimiento de Tickets:** permitir observar tickets y recibir avisos de sus cambios.
- [ ] **Indicadores de Lectura:** distinguir notificaciones nuevas de las ya consultadas.
- [ ] **Resumen de Actividad:** ofrecer un resumen de novedades desde la última visita.
- [ ] **Notificaciones No Intrusivas:** utilizar avisos dentro de la aplicación y reservar las notificaciones externas para una futura configuración.

## 👥 9. Preparación para Trabajo Colaborativo

- [ ] **Usuarios y Perfiles:** diseñar un modelo de usuarios persistente con identificadores estables y perfiles.
- [ ] **Autenticación:** implementar inicio de sesión seguro cuando se habilite el acceso multiusuario.
- [ ] **Roles y Permisos:** definir roles de administrador, miembro y lector, con permisos por proyecto.
- [ ] **Aislamiento de Datos:** garantizar que los usuarios solo puedan acceder a los proyectos y recursos autorizados.
- [ ] **Edición Concurrente:** gestionar modificaciones simultáneas mediante control de versiones o detección de conflictos.
- [ ] **Actualizaciones en Directo:** evaluar WebSockets o Server-Sent Events para reflejar cambios de otros usuarios sin recargar la página.
- [ ] **Auditoría:** registrar operaciones relevantes y acciones administrativas.

## ⚡ 10. Rendimiento, Fiabilidad y Preparación para Producción

- [ ] **Actualización Parcial de la UI:** evitar reconstruir el tablero completo cuando cambie un solo ticket.
- [ ] **Paginación y Carga Progresiva:** gestionar proyectos con miles de tickets sin degradar la experiencia.
- [ ] **Optimización de Consultas:** revisar índices, relaciones y consultas de base de datos.
- [ ] **Persistencia de Preferencias:** conservar tema, vista, filtros, ordenación, proyecto activo y preferencias del usuario.
- [ ] **Estados de Error:** mostrar mensajes claros para errores de red, permisos, validación y conflictos de datos.
- [ ] **Operaciones Optimistas:** reflejar inmediatamente los cambios de estado y revertirlos si el backend rechaza la operación.
- [ ] **Seguridad del Frontend:** escapar contenido de usuario, evitar inyecciones HTML, validar datos en backend y proteger las operaciones sensibles.
- [ ] **API Consistente:** documentar endpoints, esquemas, códigos de error y validaciones, manteniendo separada la lógica de negocio de las rutas HTTP.
- [ ] **Pruebas Automatizadas:** cubrir modelos, endpoints, permisos, filtros, automatizaciones y operaciones críticas del frontend.
- [ ] **Migraciones de Base de Datos:** versionar los cambios de esquema y proporcionar una ruta segura de actualización.
- [ ] **Configuración por Entorno:** separar desarrollo local, pruebas y producción mediante configuración externa.
- [ ] **Backups y Restauración:** implementar copias de seguridad y comprobar periódicamente que pueden restaurarse.
- [ ] **Despliegue con Uvicorn:** preparar configuración de producción, logs, gestión de procesos, proxy inverso y HTTPS cuando corresponda.
- [ ] **Documentación de Instalación:** documentar configuración, variables de entorno, dependencias, inicialización y actualización de la aplicación.

**Criterios de aceptación:**
- La interfaz mantiene una experiencia consistente entre vistas y temas.
- Los atajos, filtros y acciones rápidas funcionan sin interferir con la edición de formularios.
- Los tickets conservan sus relaciones, historial y metadatos al cambiar de vista.
- Las métricas se calculan a partir de datos persistidos y definiciones documentadas.
- Las funcionalidades de colaboración respetan permisos y evitan sobrescribir cambios silenciosamente.
- La aplicación puede ejecutarse en local y dispone de una ruta documentada para desplegarse de forma segura.
- Las funcionalidades avanzadas se incorporan progresivamente sin romper las características existentes.