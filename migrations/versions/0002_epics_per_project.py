"""Épicas por proyecto

Convierte la tabla epic (global) en una entidad de proyecto y migra los nombres
de épica que ya usan los tickets (texto libre) a filas de epic por proyecto.
Las épicas globales sin proyecto se descartan tras migrar.

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

DEFAULT_COLOR = "#6366f1"


def upgrade() -> None:
    with op.batch_alter_table("epic") as batch:
        batch.add_column(sa.Column("project_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=True))
        batch.create_foreign_key("fk_epic_project", "project", ["project_id"], ["id"])
        batch.create_index("ix_epic_project_id", ["project_id"])
        batch.create_unique_constraint("uq_epic_project_name", ["project_id", "name"])

    conn = op.get_bind()
    global_colors = {name: color for name, color in conn.execute(sa.text("SELECT name, color FROM epic WHERE project_id IS NULL"))}
    pairs = conn.execute(sa.text(
        "SELECT DISTINCT project_id, epic FROM ticket "
        "WHERE project_id IS NOT NULL AND epic IS NOT NULL AND TRIM(epic) != ''"
    )).fetchall()
    for project_id, name in pairs:
        conn.execute(
            sa.text("INSERT INTO epic (project_id, name, color) VALUES (:p, :n, :c)"),
            {"p": project_id, "n": name.strip(), "c": global_colors.get(name, DEFAULT_COLOR)},
        )
    conn.execute(sa.text("DELETE FROM epic WHERE project_id IS NULL"))


def downgrade() -> None:
    with op.batch_alter_table("epic") as batch:
        batch.drop_constraint("uq_epic_project_name", type_="unique")
        batch.drop_index("ix_epic_project_id")
        batch.drop_constraint("fk_epic_project", type_="foreignkey")
        batch.drop_column("description")
        batch.drop_column("project_id")
