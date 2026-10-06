
from sqlmodel import Session
from database import create_db_and_tables, engine
from models import Column, Epic

def create_seed_data():
    with Session(engine) as session:
        # Crear columnas por defecto
        todo = Column(name="To Do", order=1)
        in_progress = Column(name="In Progress", order=2)
        done = Column(name="Done", order=3)
        
        # Crear un Epic de ejemplo
        core_epic = Epic(name="Core Engine", color="#ff5733")
        
        session.add_all([todo, in_progress, done, core_epic])
        session.commit()
        print("Datos semilla insertados correctamente.")

if __name__ == "__main__":
    print("Creando base de datos y tablas...")
    create_db_and_tables()
    create_seed_data()