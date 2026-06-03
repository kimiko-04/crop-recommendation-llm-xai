import os
import json
import csv as _csv
import numpy as np
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from database import users_collection, predictions_collection
from ml_engine import (
    loaded, get_model_info, compute_confusion_matrix,
    set_active_model, start_retrain, get_retrain_status, cancel_retrain,
    promote_candidate, discard_candidate, MODELS_DIR, stats_raw,
)

SECRET_KEY    = os.getenv("SECRET_KEY", "change-me-in-production-use-env-file")
ALGORITHM     = "HS256"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

router = APIRouter(prefix="/admin", tags=["admin"])


async def _get_admin(token: str = Depends(oauth2_scheme)) -> str:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("role") != "admin":
            raise HTTPException(403, "Admin access required")
        return payload["sub"]
    except (JWTError, KeyError):
        raise HTTPException(401, "Invalid or expired token")


# ── User Management ───────────────────────────────────────────────────────────

@router.get("/users")
async def list_users(_: str = Depends(_get_admin)):
    users = []
    async for u in users_collection.find({}, {"password": 0}):
        u["_id"] = str(u["_id"])
        email = u.get("email", "")
        u["prediction_count"] = await predictions_collection.count_documents(
            {"user_email": email}
        )
        last = await predictions_collection.find_one(
            {"user_email": email}, sort=[("timestamp", -1)]
        )
        u["last_prediction"] = last["timestamp"] if last else None
        users.append(u)
    return {"users": users}


@router.patch("/users/{email}/status")
async def toggle_user_status(email: str, _: str = Depends(_get_admin)):
    user = await users_collection.find_one({"email": email})
    if not user:
        raise HTTPException(404, "User not found")
    if user.get("role") == "admin":
        raise HTTPException(400, "Cannot disable an admin account")
    new_status = not user.get("is_active", True)
    await users_collection.update_one(
        {"email": email}, {"$set": {"is_active": new_status}}
    )
    return {"email": email, "is_active": new_status}


@router.delete("/users/{email}")
async def delete_user(email: str, admin_email: str = Depends(_get_admin)):
    if email == admin_email:
        raise HTTPException(400, "Cannot delete your own account")
    user = await users_collection.find_one({"email": email})
    if not user:
        raise HTTPException(404, "User not found")
    if user.get("role") == "admin":
        raise HTTPException(400, "Cannot delete an admin account")
    await users_collection.delete_one({"email": email})
    await predictions_collection.delete_many({"user_email": email})
    return {"message": f"User {email} deleted"}


@router.delete("/predictions/{email}")
async def clear_user_history(email: str, _: str = Depends(_get_admin)):
    result = await predictions_collection.delete_many({"user_email": email})
    return {"message": f"Cleared {result.deleted_count} prediction(s) for {email}", "deleted": result.deleted_count}


@router.delete("/predictions")
async def clear_all_history(_: str = Depends(_get_admin)):
    result = await predictions_collection.delete_many({})
    return {"message": f"Cleared all {result.deleted_count} prediction(s)", "deleted": result.deleted_count}


# ── Model Management ──────────────────────────────────────────────────────────

@router.get("/models")
def admin_model_info(_: str = Depends(_get_admin)):
    result = get_model_info()
    if "error" in result:
        raise HTTPException(503, result["error"])

    candidates = {}
    for key in ["bert", "distilbert"]:
        cdir = MODELS_DIR / f"{key}_candidate"
        meta_path = cdir / "meta.json"
        if cdir.exists() and meta_path.exists():
            meta = json.loads(meta_path.read_text())
            candidates[key] = {
                "accuracy":  round(meta.get("accuracy",  0) * 100, 2),
                "precision": round(meta.get("precision", 0) * 100, 2),
                "recall":    round(meta.get("recall",    0) * 100, 2),
                "f1":        round(meta.get("f1",        0) * 100, 2),
            }

    result["candidates"]     = candidates
    result["retrain_status"] = get_retrain_status()
    return result


@router.put("/models/active")
def set_model_active(body: dict, _: str = Depends(_get_admin)):
    key = body.get("key", "")
    result = set_active_model(key)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.post("/models/retrain/{key}")
def trigger_retrain(key: str, _: str = Depends(_get_admin)):
    if key not in ["bert", "distilbert"]:
        raise HTTPException(400, f"Unknown model key: '{key}'")
    result = start_retrain(key)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.get("/models/retrain/status")
def retrain_status(_: str = Depends(_get_admin)):
    return get_retrain_status()


@router.post("/models/retrain/{key}/cancel")
def cancel_retrain_endpoint(key: str, _: str = Depends(_get_admin)):
    result = cancel_retrain(key)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.post("/models/promote/{key}")
def promote_model(key: str, _: str = Depends(_get_admin)):
    result = promote_candidate(key)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.delete("/models/candidate/{key}")
def discard_model_candidate(key: str, _: str = Depends(_get_admin)):
    result = discard_candidate(key)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.post("/models/compute-matrix/{key}")
def admin_compute_matrix(key: str, _: str = Depends(_get_admin)):
    if key not in loaded:
        raise HTTPException(404, f"Model '{key}' not found")
    result = compute_confusion_matrix(key)
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result


# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/analytics")
async def get_analytics(_: str = Depends(_get_admin)):
    total = await predictions_collection.count_documents({})

    pipeline = [
        {"$group": {"_id": "$result.recommended_crop", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]
    top_crops = []
    async for doc in predictions_collection.aggregate(pipeline):
        top_crops.append({"crop": doc["_id"], "count": doc["count"]})

    return {"total_predictions": total, "top_crops": top_crops}


# ── Drift Monitor (PSI-based) ─────────────────────────────────────────────────
#
# Method: Population Stability Index (PSI)
# Source: Yurdakul, B. (2018). Statistical properties of population stability
#         index. Western Michigan University.
# Thresholds (industry standard from credit risk / ML deployment literature):
#   PSI < 0.10  → No significant change        (OK)
#   PSI 0.10–0.20 → Moderate shift             (Warning — monitor closely)
#   PSI > 0.20  → Significant distribution shift (Critical — retrain recommended)

_PSI_WARN    = 0.10   # PSI warning threshold
_PSI_CRIT    = 0.20   # PSI critical threshold  (retrain recommended)
_PSI_BINS    = 10     # number of equal-frequency bins
_CONF_WARN   = 75.0   # avg confidence % → warning
_CONF_CRIT   = 60.0   # avg confidence % → critical
_SAMPLE_SIZE = 100    # how many recent predictions to analyse
_MIN_SAMPLES = 20     # minimum for PSI to be statistically meaningful

# Maps CSV column → (prediction input key, display label)
_FEATURE_MAP = {
    "N":           ("n",           "Nitrogen (N)"),
    "P":           ("p",           "Phosphorus (P)"),
    "K":           ("k",           "Potassium (K)"),
    "ph":          ("ph",          "pH"),
    "temperature": ("temperature", "Temperature"),
    "humidity":    ("humidity",    "Humidity"),
    "rainfall":    ("rainfall",    "Rainfall"),
}

CSV_PATH = MODELS_DIR.parent / "Crop_recommendation.csv"


def _compute_psi(expected: np.ndarray, actual: np.ndarray, n_bins: int = _PSI_BINS) -> float:
    """
    Population Stability Index between expected (training) and actual
    (recent predictions) distributions.

    Reference: Yurdakul (2018), Western Michigan University.
    """
    # Bin edges from equal-frequency binning of the expected (training) data
    percentiles = np.linspace(0, 100, n_bins + 1)
    breakpoints = np.unique(np.percentile(expected, percentiles))

    if len(breakpoints) < 2:
        return 0.0

    exp_counts = np.histogram(expected, bins=breakpoints)[0].astype(float)
    act_counts = np.histogram(actual,   bins=breakpoints)[0].astype(float)

    # Convert to proportions; replace zeros to avoid log(0)
    exp_pct = np.where(exp_counts == 0, 1e-4, exp_counts / len(expected))
    act_pct = np.where(act_counts == 0, 1e-4, act_counts / len(actual))

    psi = float(np.sum((act_pct - exp_pct) * np.log(act_pct / exp_pct)))
    return round(abs(psi), 4)


def _load_training_data() -> dict:
    """Read training CSV and return per-feature value lists."""
    data: dict = {k: [] for k in _FEATURE_MAP}
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        for row in _csv.DictReader(f):
            for col in _FEATURE_MAP:
                try:
                    data[col].append(float(row[col]))
                except (KeyError, ValueError):
                    pass
    return data


@router.get("/drift")
async def get_drift_report(_: str = Depends(_get_admin)):
    # Fetch recent predictions newest-first
    cursor = predictions_collection.find(
        {}, {"inputs": 1, "result": 1, "timestamp": 1, "_id": 0}
    ).sort("timestamp", -1).limit(_SAMPLE_SIZE)

    recent = [doc async for doc in cursor]

    _base = {
        "sample_count":     len(recent),
        "features":         [],
        "avg_confidence":   None,
        "confidence_trend": [],
        "alert":            False,
        "min_samples":      _MIN_SAMPLES,
        "thresholds":       {"psi_warn": _PSI_WARN, "psi_crit": _PSI_CRIT,
                             "conf_warn": _CONF_WARN, "conf_crit": _CONF_CRIT},
    }

    if not recent:
        return {**_base, "overall_status": "no_data"}

    # ── Load training distributions ───────────────────────────────────────────
    training = _load_training_data()

    # ── Compute PSI per feature ───────────────────────────────────────────────
    features = []
    for stat_key, (inp_key, label) in _FEATURE_MAP.items():
        actual_vals = [
            doc["inputs"][inp_key]
            for doc in recent
            if "inputs" in doc and inp_key in doc["inputs"]
        ]
        expected_vals = training.get(stat_key, [])

        if not actual_vals or not expected_vals:
            continue

        expected_arr = np.array(expected_vals, dtype=float)
        actual_arr   = np.array(actual_vals,   dtype=float)

        psi = _compute_psi(expected_arr, actual_arr)
        status = (
            "critical" if psi >= _PSI_CRIT else
            "warning"  if psi >= _PSI_WARN else
            "ok"
        )

        features.append({
            "key":          stat_key,
            "label":        label,
            "training_mean": round(float(expected_arr.mean()), 3),
            "recent_mean":   round(float(actual_arr.mean()),   3),
            "psi":           psi,
            "status":        status,
        })

    # ── Confidence stats ──────────────────────────────────────────────────────
    confidences = [
        doc["result"]["confidence"]
        for doc in recent
        if "result" in doc and "confidence" in doc["result"]
    ]
    avg_confidence = round(sum(confidences) / len(confidences), 2) if confidences else None
    conf_status = (
        "critical" if avg_confidence is not None and avg_confidence < _CONF_CRIT else
        "warning"  if avg_confidence is not None and avg_confidence < _CONF_WARN else
        "ok"
    )

    # ── Daily confidence trend (last 7 days in sample) ───────────────────────
    from collections import defaultdict
    daily: dict = defaultdict(list)
    for doc in recent:
        ts = doc.get("timestamp", "")[:10]
        if ts and "result" in doc and "confidence" in doc["result"]:
            daily[ts].append(doc["result"]["confidence"])

    confidence_trend = [
        {"date": day, "avg_confidence": round(sum(v) / len(v), 2), "count": len(v)}
        for day, v in sorted(daily.items())
    ][-7:]

    # ── Overall status ────────────────────────────────────────────────────────
    statuses     = [f["status"] for f in features] + [conf_status]
    overall_status = (
        "critical" if "critical" in statuses else
        "warning"  if "warning"  in statuses else
        "ok"
    )
    max_psi = max((f["psi"] for f in features), default=0.0)

    return {
        "sample_count":     len(recent),
        "features":         features,
        "avg_confidence":   avg_confidence,
        "conf_status":      conf_status,
        "confidence_trend": confidence_trend,
        "overall_status":   overall_status,
        "max_psi":          round(max_psi, 4),
        "alert":            overall_status != "ok",
        "min_samples":      _MIN_SAMPLES,
        "thresholds":       {"psi_warn": _PSI_WARN, "psi_crit": _PSI_CRIT,
                             "conf_warn": _CONF_WARN, "conf_crit": _CONF_CRIT},
    }
