"""Configuración y constantes de Pyckets (todo lo que depende del entorno vive aquí)."""
import os

UPLOAD_DIR = os.path.join("static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
GITHUB_SYNC_INTERVAL_SECONDS = 300

CORS_ORIGINS = [o.strip() for o in os.getenv("PYCKETS_CORS_ORIGINS", "").split(",") if o.strip()]

def registration_enabled() -> bool:
    return os.getenv("PYCKETS_ALLOW_REGISTRATION", "0") == "1"
