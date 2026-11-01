"""Entorno de Alembic: usa el engine y los metadatos de la propia aplicación."""
from alembic import context
from sqlmodel import SQLModel

import models  # noqa: F401  (registra las tablas en SQLModel.metadata)
from database import engine

target_metadata = SQLModel.metadata


def run_migrations_online() -> None:
    url_override = context.config.get_main_option("sqlalchemy.url")
    connectable = engine
    if url_override:  # usado solo para generar migraciones contra una BD temporal
        from sqlalchemy import create_engine
        connectable = create_engine(url_override)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,   # SQLite no soporta ALTER completo
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
