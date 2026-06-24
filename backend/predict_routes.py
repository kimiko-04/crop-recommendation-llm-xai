"""
Prediction routes — all require a valid user JWT.

Three separate inference endpoints exist on purpose:
  POST /predict        — fast (~100 ms): returns crop + top-5 probabilities
  POST /predict/reason — medium (~200 ms): BERT CLS attention natural-language sentence
  POST /predict/explain — slow (~30 s): SHAP KernelExplainer feature attribution

The frontend calls /predict first, shows the result immediately, then fires
/reason and /explain in parallel (Promise.allSettled) and fills them in when ready.
This way the user never waits 30 s to see any output.
"""
import os
import math
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
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
    """Decode the JWT and return the user's email (stored in the 'sub' claim)."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload["sub"]
    except (JWTError, KeyError):
        raise HTTPException(401, "Invalid or expired token")


async def _log(email: str, req: PredictRequest, result: dict):
    # Fire-and-forget: create_task schedules this in the event loop so the HTTP
    # response is returned immediately without waiting for the DB write.
    try:
        await predictions_collection.insert_one({
            "user_email": email,
            "timestamp":  datetime.now(timezone.utc).isoformat(),
            "inputs":     req.model_dump(),
            "result":     result,
        })
    except Exception:
        pass  # Never let a logging failure break the prediction response


@router.post("")
async def predict(req: PredictRequest, email: str = Depends(_get_user)):
    result = predict_crop(
        n=req.n, p=req.p, k=req.k, ph=req.ph,
        temp=req.temperature, hum=req.humidity, rain=req.rainfall,
    )
    # Log asynchronously — does not block the response
    asyncio.create_task(_log(email, req, result))
    return result


@router.post("/reason")
async def reason(req: PredictRequest, _: str = Depends(_get_user)):
    """Attention-based natural language reasoning — does NOT log (no new prediction)."""
    result = generate_reasoning(
        n=req.n, p=req.p, k=req.k, ph=req.ph,
        temp=req.temperature, hum=req.humidity, rain=req.rainfall,
    )
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.post("/explain")
async def explain(req: PredictRequest, _: str = Depends(_get_user)):
    """SHAP KernelExplainer explanation — slow (~30 s), called in parallel with /reason."""
    result = compute_shap(
        n=req.n, p=req.p, k=req.k, ph=req.ph,
        temp=req.temperature, hum=req.humidity, rain=req.rainfall,
    )
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.get("/history")
async def history(
    email: str = Depends(_get_user),
    page:  int  = Query(1, ge=1),
    limit: int  = Query(20, ge=1, le=100),
    model: str  = Query(None),
):
    """Return the calling user's prediction history, newest first, paginated.

    Optional ?model= filter matches result.model_used (e.g. BERT, BERT_V2, DISTILBERT).
    """
    query = {"user_email": email}
    if model:
        query["result.model_used"] = model.upper()
    skip   = (page - 1) * limit
    cursor = predictions_collection.find(
        query, {"_id": 0}
    ).sort("timestamp", -1).skip(skip).limit(limit)
    items = await cursor.to_list(length=limit)
    total = await predictions_collection.count_documents(query)
    return {
        "items": items,
        "total": total,
        "page":  page,
        "pages": math.ceil(total / limit) if total else 1,
    }


@router.delete("/history/{timestamp:path}")
async def delete_history_item(timestamp: str, email: str = Depends(_get_user)):
    """Delete a single prediction by timestamp, scoped to the calling user."""
    result = await predictions_collection.delete_one(
        {"user_email": email, "timestamp": timestamp}
    )
    if result.deleted_count == 0:
        raise HTTPException(404, "Prediction not found")
    return {"deleted": timestamp}
