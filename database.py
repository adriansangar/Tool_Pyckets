from sqlmodel import SQLModel, create_engine, Session

# Archivo local de SQLite. En el futuro esto podrá inyectarse vía CLI.
sqlite_file_name = "pyckets.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

# El flag connect_args es esencial para SQLite + FastAPI (entorno multi-hilo)
engine = create_engine(
    sqlite_url, 
    echo=True, # Cambiar a False en producción para limpiar los logs
    connect_args={"check_same_thread": False} 
)

def create_db_and_tables():
    """Genera las tablas leyendo la metadata de SQLModel"""
    SQLModel.metadata.create_all(engine)

def get_session():
    """Generador para inyectar la sesión en los endpoints de FastAPI"""
    with Session(engine) as session:
        yield session