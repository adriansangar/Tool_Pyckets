import os
from sqlmodel import SQLModel, create_engine, Session

# 1. Leemos la ruta inyectada desde el CLI, o usamos un valor por defecto
db_path = os.getenv("PYCKETS_DB_PATH", "pyckets.db")
sqlite_url = f"sqlite:///{db_path}"

# 2. Inicializamos el motor. echo=False para no saturar la terminal del usuario.
engine = create_engine(
    sqlite_url, 
    echo=False, 
    connect_args={"check_same_thread": False} 
)

def create_db_and_tables():
    """Genera las tablas leyendo la metadata de SQLModel"""
    SQLModel.metadata.create_all(engine)

def get_session():
    """Generador para inyectar la sesión en los endpoints de FastAPI"""
    with Session(engine) as session:
        yield session