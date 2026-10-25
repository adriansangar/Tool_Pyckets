from sqlmodel import Session
from database import create_db_and_tables, engine
from models import Column, Epic, Project, User, ProjectMember, ProjectRole
from auth import get_password_hash

def create_seed_data():
    with Session(engine) as session:
        # 1. Crear usuario por defecto
        admin_user = User(
            username="adrian",
            email="adrian@pyckets.local",
            hashed_password=get_password_hash("admin123"),
            is_superuser=True
        )
        session.add(admin_user)
        session.commit()
        session.refresh(admin_user)

        # 2. Columnas estáticas
        todo = Column(name="TODO", order=1)
        halted = Column(name="HALTED", order=2)
        in_progress = Column(name="IN PROGRESS", order=3)
        done = Column(name="DONE", order=4)
        
        # 3. Proyectos
        core_engine = Project(name="Core Engine", color="#ff5630")
        ui_redesign = Project(name="Frontend Redesign", color="#36b37e")
        core_epic = Epic(name="Core Engine", color="#ff5733")
        
        session.add_all([todo, halted, in_progress, done, core_epic, core_engine, ui_redesign])
        session.commit()
        
        session.refresh(core_engine)
        session.refresh(ui_redesign)

        # 4. Asignar propiedad de los proyectos iniciales al usuario
        m1 = ProjectMember(project_id=core_engine.id, user_id=admin_user.id, role=ProjectRole.OWNER)
        m2 = ProjectMember(project_id=ui_redesign.id, user_id=admin_user.id, role=ProjectRole.OWNER)
        session.add_all([m1, m2])
        session.commit()
        
        print("Base de datos inicializada con autenticación y usuario 'adrian' (Password: admin123).")

if __name__ == "__main__":
    print("Creando base de datos...")
    create_db_and_tables()
    create_seed_data()