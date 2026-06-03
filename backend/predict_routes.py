import os
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from models import PredictRequest
from ml_engine import predict_crop, compute_shap, generate_reasoning
from database import predictions_collection

SECRET_KEY    = os.getenv("SECRET_KEY", "change-me-in-production-use-env-file")
ALGORITHM     = "HS256"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
router        = APIRouter(prefix="/predict", tags=["predict"])


async def _get_user(token: str = Depends(oauth2_scheme)) -> str:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload["sub"]
    except (JWTError, KeyError):
        raise HTTPException(401, "Invalid or expired token")


async def _log(email: str, req: PredictRequest, result: dict):
    try:
        await predictions_collection.insert_one({
            "user_email": email,
            "timestamp":  datetime.now(timezone.utc).isoformat(),
            "inputs":     req.model_dump(),
            "result":     result,
        })
    except Exception:
        pass


@router.post("")
async def predict(req: PredictRequest, email: str = Depends(_get_user)):
    result = predict_crop(
        n=req.n, p=req.p, k=req.k, ph=req.ph,
        temp=req.temperature, hum=req.humidity, rain=req.rainfall,
    )
    asyncio.create_task(_log(email, req, result))
    return result


@router.post("/reason")
async def reason(req: PredictRequest, _: str = Depends(_get_user)):
    result = generate_reasoning(
        n=req.n, p=req.p, k=req.k, ph=req.ph,
        temp=req.temperature, hum=req.humidity, rain=req.rainfall,
    )
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.post("/explain")
async def explain(req: PredictRequest, _: str = Depends(_get_user)):
    result = compute_shap(
        n=req.n, p=req.p, k=req.k, ph=req.ph,
        temp=req.temperature, hum=req.humidity, rain=req.rainfall,
    )
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result
