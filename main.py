"""Punto de entrada de Pyckets: crea la app, monta el frontend y registra los routers."""
import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from config import CORS_ORIGINS, GITHUB_SYNC_INTERVAL_SECONDS
from database import create_db_and_tables, engine
from models import User
from services.github_sync import periodic_github_sync
from routers import accounts, meta, projects, tickets, github

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    with Session(engine) as session:
        admin = session.exec(select(User).where(User.username == "adrian")).first()
        if admin and not admin.is_superuser:
            admin.is_superuser = True
            session.add(admin)
            session.commit()

    sync_task = asyncio.create_task(periodic_github_sync(GITHUB_SYNC_INTERVAL_SECONDS))
    yield
    sync_task.cancel()


app = FastAPI(title="Pyckets API", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def read_index():
    return FileResponse(os.path.join("static", "index.html"))

if CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

for _module in (accounts, meta, projects, tickets, github):
    app.include_router(_module.router)
