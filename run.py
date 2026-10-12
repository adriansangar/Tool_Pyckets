import argparse
import os
import uvicorn

def main():
    # 1. Configuramos los argumentos de la CLI
    parser = argparse.ArgumentParser(description="🚀 Pyckets - Gestor Kanban Portátil")
    parser.add_argument(
        "--db", 
        type=str, 
        default="pyckets.db",
        help="Ruta al archivo SQLite (ej: ../mi-proyecto-paralelo/kanban.db)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Puerto para levantar el servidor web (por defecto: 8000)"
    )
    
    args = parser.parse_args()

    # 2. Inyectamos la ruta en el entorno ANTES de que uvicorn importe main.py
    # Esto garantiza que database.py lea la ruta correcta al inicializarse.
    os.environ["PYCKETS_DB_PATH"] = args.db

    # 3. Feedback visual en la terminal
    print("\n" + "="*50)
    print(" 🚀 Arrancando motor Pyckets...")
    print(f" 📂 Base de datos : {os.path.abspath(args.db)}")
    print(f" 🌐 Interfaz web   : http://127.0.0.1:{args.port}")
    print("="*50 + "\n")

    # 4. Lanzamos el servidor de forma programática. 
    # reload=False es importante para un empaquetado final de producción.
    uvicorn.run("main:app", host="127.0.0.1", port=args.port, reload=False)

if __name__ == "__main__":
    main()