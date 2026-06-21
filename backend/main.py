"""
Entry point for the CropAI FastAPI backend.

Router layout:
  /auth/*      — register & login (public)
  /predict/*   — inference, SHAP, reasoning, history (JWT user)
  /models/*    — model info & confusion matrix (public)
  /admin/*     — user CRUD, model management, drift monitor (JWT admin)
  /field/*     — satellite GeoTIFF upload & NDVI analysis (JWT user)
"""
import sys
import os
import bcrypt
from datetime import datetime, timezone

# Ensure sibling modules (database, ml_engine, …) are importable without a package install.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from auth_routes    import router as auth_router
from predict_routes import router as predict_router
from model_routes   import router as model_router
from admin_routes   import router as admin_router
from field_routes   import router as field_router
from database import users_collection

app = FastAPI(title="Crop Recommendation API", version="1.0.0")

# Allow the Vite dev server (5173/5174) and any local React app (3000).
# Credentials=True is required so the browser sends the JWT Authorization header.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(predict_router)
app.include_router(model_router)
app.include_router(admin_router)
app.include_router(field_router)


@app.on_event("startup")
async def seed_admin():
    # Insert a default admin account only if none exists yet, so re-starts are idempotent.
    if not await users_collection.find_one({"role": "admin"}):
        hashed = bcrypt.hashpw(b"admin123", bcrypt.gensalt()).decode()
        await users_collection.insert_one({
            "username":  "Admin",
            "email":     "admin@cropai.com",
            "password":  hashed,
            "role":      "admin",
            "is_active": True,
            "joined_at": datetime.now(timezone.utc).isoformat(),
        })
        print("[main] Admin seeded — email: admin@cropai.com  password: admin123")


@app.get("/health")
def health():
    return {"status": "ok"}
