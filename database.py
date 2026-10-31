import os
from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy import text

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

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    migrate_db()