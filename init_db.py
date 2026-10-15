from sqlmodel import Session
from database import create_db_and_tables, engine
from models import Column, Epic, Project

def create_seed_data():
    with Session(engine) as session:
        todo = Column(name="To Do", order=1)
        in_progress = Column(name="In Progress", order=2)
        done = Column(name="Done", order=3)
        
        core_engine = Project(name="Core Engine", color="#ff5630")
        ui_redesign = Project(name="Frontend Redesign", color="#36b37e")
        core_epic = Epic(name="Core Engine", color="#ff5733")
        
        session.add_all([todo, in_progress, done, core_epic, core_engine, ui_redesign])
        session.commit()
        print("Datos semilla insertados correctamente.")

if __name__ == "__main__":
    print("Creando base de datos y tablas...")
    create_db_and_tables()
    create_seed_data()