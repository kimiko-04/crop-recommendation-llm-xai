from fastapi import APIRouter, HTTPException
from ml_engine import get_model_info, compute_confusion_matrix, loaded

router = APIRouter(prefix="/models", tags=["models"])


@router.get("/info")
def model_info():
    result = get_model_info()
    if "error" in result:
        raise HTTPException(503, result["error"])
    return result


@router.post("/compute-matrix/{key}")
def trigger_compute(key: str):
    if key not in loaded:
        raise HTTPException(404, f"Model '{key}' not found")
    result = compute_confusion_matrix(key)
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result
