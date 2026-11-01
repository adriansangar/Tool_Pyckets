# Pyckets

Gestor de tickets kanban portátil: API FastAPI + SQLModel (SQLite) y frontend estático.

## Arranque rápido

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python init_db.py                      # primera vez: crea tablas y el usuario "adrian"
python run.py --db pyckets.db          # http://127.0.0.1:8000
```

`init_db.py` genera una contraseña aleatoria para `adrian` y la muestra una sola vez
(o usa `PYCKETS_ADMIN_PASSWORD`). Cámbiala desde el perfil tras el primer acceso.

## Estructura

```
main.py          crea la app, monta /static y registra los routers
config.py        constantes y variables de entorno (uploads, límites, CORS, registro)
database.py      motor SQLite y migraciones de columnas
models.py        tablas (SQLModel)
schemas.py       esquemas Pydantic de entrada y salida
permissions.py   roles por proyecto y validaciones comunes
auth.py          JWT, contraseñas y comprobación de permisos
routers/         accounts, projects, tickets, epics, github, meta
services/        tickets (auditoría), github_sync (sincronización)
github_service.py cliente de la API de GitHub
static/          frontend (index.html, app.js, styles.css)
migrations/      Alembic (env.py y versions/)
tests/           pruebas de regresión (pytest)
```

Dónde va cada cosa: un endpoint nuevo, en el router de su tema; una regla de negocio
repetida, en `services/` o `permissions.py`; una constante o variable de entorno, en `config.py`.

## Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `PYCKETS_DB_PATH` | `pyckets.db` | Ruta de la base de datos (la fija `run.py --db`) |
| `SECRET_KEY` | aleatoria, guardada en `.pyckets_secret` | Firma de sesiones (JWT) |
| `PYCKETS_ALLOW_REGISTRATION` | `0` | `1` abre el registro público |
| `PYCKETS_CORS_ORIGINS` | vacío (sin CORS) | Orígenes permitidos, separados por comas |
| `PYCKETS_ADMIN_PASSWORD` | aleatoria | Contraseña inicial de `adrian` en `init_db.py` |

`.pyckets_secret` y `pyckets.db` no deben subirse a git.

## Permisos

| Acción | Admin general | Admin de proyecto | Usuario normal |
|---|---|---|---|
| Crear, archivar y borrar proyectos; dar acceso a usuarios | Sí | No | No |
| Gestionar épicas | Sí | Sí | No |
| Conectar repositorios de GitHub | Sí | Sí | No |
| Crear tickets | Sí | Sí | Sí (sin asignar a otros ni épica) |
| Editar y mover tickets | Todos | Todos | Solo los asignados a él (o los suyos sin asignar) |
| Cambiar asignado, épica o proyecto de un ticket | Sí | Sí | No |
| Ver el tablero, comentar | Sí | Sí | Sí |

Roles: admin general = `is_superuser`; admin de proyecto = rol `owner` o `admin`; usuario normal = `member`;
`viewer` es solo lectura. `GET /api/projects` devuelve `my_role` para que el frontend adapte la interfaz.
Los webhooks de GitHub exigen `webhook_secret` en el repositorio.

## Migraciones (Alembic)

`create_db_and_tables()` deja la base de datos en la última versión al arrancar: una BD nueva se crea desde
`migrations/versions/0001_baseline.py`; una BD anterior a Alembic se completa, se marca como `0001` y se actualiza.
Para cambiar el esquema:

```bash
# 1) edita models.py
# 2) genera la migración (revísala antes de aplicarla)
PYCKETS_DB_PATH=pyckets.db alembic -c alembic.ini revision --autogenerate -m "descripcion"
```

Haz copia de `pyckets.db` antes de actualizar. Épicas: pertenecen a un proyecto y los tickets las referencian por
nombre (`Ticket.epic`); renombrar o borrar una épica actualiza sus tickets.

## Tests

```bash
pip install pytest
pytest tests
```
