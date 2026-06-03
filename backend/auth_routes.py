import os
import bcrypt
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException
from jose import jwt
from database import users_collection
from models import UserCreate, UserLogin, Token

SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production-use-env-file")
ALGORITHM  = "HS256"
TOKEN_EXP  = 60 * 24  # 24 hours

router = APIRouter(prefix="/auth", tags=["auth"])


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def _make_token(email: str, username: str, role: str = "user") -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_EXP)
    return jwt.encode(
        {"sub": email, "username": username, "role": role, "exp": expire},
        SECRET_KEY, algorithm=ALGORITHM,
    )


@router.post("/register", status_code=201)
async def register(body: UserCreate):
    if await users_collection.find_one({"email": body.email}):
        raise HTTPException(400, "Email already registered")
    await users_collection.insert_one({
        "username":  body.username,
        "email":     body.email,
        "password":  _hash(body.password),
        "role":      "user",
        "is_active": True,
        "joined_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"message": "Account created successfully"}


@router.post("/login", response_model=Token)
async def login(body: UserLogin):
    user = await users_collection.find_one({"email": body.email})
    if not user or not _verify(body.password, user["password"]):
        raise HTTPException(401, "Invalid email or password")
    if not user.get("is_active", True):
        raise HTTPException(403, "Account has been disabled")
    return {
        "access_token": _make_token(body.email, user["username"], user.get("role", "user")),
        "token_type":   "bearer",
    }
