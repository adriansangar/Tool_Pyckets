import os
from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy import text, inspect
from alembic import command
from alembic.config import Config

db_path = os.getenv("PYCKETS_DB_PATH", "pyckets.db")
sqlite_url = f"sqlite:///{db_path}"

connect_args = {"check_same_thread": False}
engine = create_engine(sqlite_url, connect_args=connect_args)

def get_session():
    with Session(engine) as session:
        yield session

def migrate_db():
    """Añade automáticamente columnas nuevas a las tablas existentes en SQLite."""
    with engine.connect() as conn:
        new_columns = [
            ("project", "accent_color", "VARCHAR DEFAULT '#0052cc'"),
            ("project", "icon", "VARCHAR DEFAULT '📦'"),
            ("column", "wip_limit", "INTEGER"),
            ("ticket", "priority", "VARCHAR DEFAULT 'MEDIUM'"),
            ("ticket", "ticket_type", "VARCHAR DEFAULT 'TASK'"),
            ("ticket", "parent_id", "INTEGER"),
            ("ticket", "reporter", "VARCHAR"),
            ("ticket", "story_points", "INTEGER DEFAULT 0"),
            ("ticket", "resolution", "VARCHAR"),
            ("ticket", "created_at", "DATETIME"),
            ("ticket", "updated_at", "DATETIME"),
            ("repository", "auto_move_tickets", "BOOLEAN DEFAULT 1"),
            ("repository", "webhook_secret", "VARCHAR"),
            ("ticket", "time_logged", "INTEGER DEFAULT 0"),
        ]
        
        for table, column, col_type in new_columns:
            result = conn.execute(text(f"PRAGMA table_info({table});")).fetchall()
            existing_cols = [row[1] for row in result]
            if existing_cols and column not in existing_cols:
                try:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type};"))
                    conn.commit()
                    print(f"✅ Migración: añadida columna '{column}' a la tabla '{table}'.")
                except Exception as e:
                    print(f"⚠️ Error añadiendo {table}.{column}: {e}")

        # Normalizar valores enum existentes en minúsculas en la tabla ticket
        try:
            conn.execute(text("UPDATE ticket SET priority = 'MEDIUM' WHERE priority = 'medium' OR priority IS NULL;"))
            conn.execute(text("UPDATE ticket SET ticket_type = 'TASK' WHERE ticket_type = 'task' OR ticket_type IS NULL;"))
            conn.commit()
        except Exception as e:
            print(f"⚠️ Error normalizando enums: {e}")

def _alembic_config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(os.path.abspath(__file__)), "migrations"))
    return cfg

def create_db_and_tables():
    """Deja la base de datos en la última versión del esquema (Alembic).

    - BD nueva: Alembic crea todo desde la migración baseline.
    - BD anterior a Alembic: se completa con el mecanismo antiguo (tablas y columnas
      que faltaran), se marca como baseline (0001) y se aplican las migraciones nuevas.
    """
    cfg = _alembic_config()
    tables = set(inspect(engine).get_table_names())
    if "alembic_version" not in tables and "ticket" in tables:
        SQLModel.metadata.create_all(engine)   # tablas que faltaran en BD antiguas
        migrate_db()                           # columnas que faltaran
        command.stamp(cfg, "0001")
    command.upgrade(cfg, "head")
