"""Endpoints: accounts."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select

from models import (
    User,
)
from database import get_session
from auth import (
    get_password_hash, verify_password, create_access_token,
    get_current_user_from_token,
)
from config import registration_enabled
from schemas import (
    UserCreate, UserResponse, UserUpdate, PasswordUpdate,
)

router = APIRouter()

@router.put("/api/auth/me", response_model=UserResponse)
def update_my_profile(
    profile_in: UserUpdate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    current_user.first_name = profile_in.first_name
    current_user.last_name = profile_in.last_name
    if profile_in.avatar:
        current_user.avatar = profile_in.avatar
    if profile_in.theme_preference:
        current_user.theme_preference = profile_in.theme_preference
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user


@router.put("/api/auth/me/password")
def change_my_password(
    pwd_in: PasswordUpdate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    if not verify_password(pwd_in.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="La contraseña actual es incorrecta")
    current_user.hashed_password = get_password_hash(pwd_in.new_password)
    session.add(current_user)
    session.commit()
    return {"message": "Contraseña actualizada correctamente"}


@router.post("/api/auth/register", response_model=UserResponse)
def register(user_in: UserCreate, session: Session = Depends(get_session)):
    if not registration_enabled():
        raise HTTPException(status_code=403, detail="El registro público está desactivado; pide una cuenta a un administrador")
    existing_user = session.exec(
        select(User).where((User.username == user_in.username) | (User.email == user_in.email))
    ).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="El usuario o email ya existe")
    
    user = User(
        username=user_in.username,
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password)
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@router.post("/api/auth/login")
def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session)
):
    user = session.exec(select(User).where(User.username == form_data.username)).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Credenciales incorrectas")
        
    token = create_access_token(data={"sub": user.username})
    response.set_cookie(key="pyckets_token", value=token, httponly=True, samesite="lax")
    return {"access_token": token, "token_type": "bearer"}


@router.get("/api/auth/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user_from_token)):
    return current_user


@router.get("/api/users", response_model=List[UserResponse])
def get_users(
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Acceso restringido a administradores")
    return session.exec(select(User)).all()


@router.post("/api/users", response_model=UserResponse)
def create_user_by_admin(
    user_in: UserCreate,
    current_user: User = Depends(get_current_user_from_token),
    session: Session = Depends(get_session)
):
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Acceso restringido a administradores")
    existing = session.exec(
        select(User).where((User.username == user_in.username) | (User.email == user_in.email))
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="El usuario o email ya existe")
        
    user = User(
        username=user_in.username,
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password)
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user
