"""
Admin routes — all require a JWT with role="admin".

Covers four concern areas:
  1. User management  — list, toggle active/disabled, delete, clear history
  2. Model management — switch active model, trigger/cancel retrain, promote/discard candidates
  3. Analytics        — total predictions, top-10 recommended crops
  4. Drift monitoring — PSI-based comparison of recent predictions vs training distribution
  5. Dataset          — upload a custom training CSV or reset to the default one
"""
import io
import os
import json
import csv as _csv
import numpy as np
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, File, UploadFile
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from database import users_collection, predictions_collection
from ml_engine import (
    loaded, get_model_info, compute_confusion_matrix,
    set_active_model, start_retrain, get_retrain_status, cancel_retrain,
    promote_candidate, discard_candidate, delete_model_version,
    MODELS_DIR, stats_raw, get_active_csv_path,
)

SECRET_KEY    = os.getenv("SECRET_KEY", "change-me-in-production-use-env-file")
ALGORITHM     = "HS256"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

router = APIRouter(prefix="/admin", tags=["admin"])


async def _get_admin(token: str = Depends(oauth2_scheme)) -> str:
    """Verify the JWT and confirm the caller has role='admin'."""
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


@router.delete("/models/version/{version_key}")
def delete_model_version_endpoint(version_key: str, _: str = Depends(_get_admin)):
    result = delete_model_version(version_key)
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

_REQUIRED_COLS = {"N", "P", "K", "temperature", "humidity", "ph", "rainfall", "label"}


@router.get("/dataset/info")
def get_dataset_info(_: str = Depends(_get_admin)):
    csv_path = get_active_csv_path()
    cfg_path = MODELS_DIR / "active_dataset.json"
    is_custom = cfg_path.exists()
    name = json.loads(cfg_path.read_text()).get("name", csv_path.name) if is_custom else "Crop_recommendation.csv"
    uploaded_at = json.loads(cfg_path.read_text()).get("uploaded_at") if is_custom else None

    with open(csv_path, newline="", encoding="utf-8") as f:
        rows = list(_csv.DictReader(f))
    crops = sorted({r["label"].strip() for r in rows if r.get("label", "").strip()})
    return {
        "is_custom":   is_custom,
        "filename":    name,
        "uploaded_at": uploaded_at,
        "rows":        len(rows),
        "crops":       crops,
        "crop_count":  len(crops),
    }


@router.post("/dataset/upload")
async def upload_dataset(file: UploadFile = File(...), _: str = Depends(_get_admin)):
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(400, "Only .csv files are supported")

    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "File must be UTF-8 encoded")

    reader = _csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(400, "CSV file is empty or has no header row")

    missing = _REQUIRED_COLS - set(reader.fieldnames)
    if missing:
        raise HTTPException(400, f"Missing required columns: {', '.join(sorted(missing))}")

    rows = list(reader)
    if len(rows) < 50:
        raise HTTPException(400, f"Dataset too small ({len(rows)} rows). Minimum 50 rows required.")

    for col in ["N", "P", "K", "temperature", "humidity", "ph", "rainfall"]:
        bad = sum(1 for r in rows if not _is_numeric(r.get(col, "")))
        if bad:
            raise HTTPException(400, f"Column '{col}' contains {bad} non-numeric value(s)")

    empty_labels = sum(1 for r in rows if not r.get("label", "").strip())
    if empty_labels:
        raise HTTPException(400, f"Column 'label' has {empty_labels} empty value(s)")

    crops = sorted({r["label"].strip() for r in rows})
    if len(crops) < 2:
        raise HTTPException(400, "Dataset must contain at least 2 crop classes")

    save_path = MODELS_DIR.parent / "uploaded_dataset.csv"
    save_path.write_bytes(content)

    cfg = {
        "path":        str(save_path),
        "name":        file.filename,
        "uploaded_at": datetime.now().isoformat(),
    }
    (MODELS_DIR / "active_dataset.json").write_text(json.dumps(cfg))

    return {
        "message":    f"Dataset '{file.filename}' uploaded successfully",
        "filename":   file.filename,
        "rows":       len(rows),
        "crops":      crops,
        "crop_count": len(crops),
    }


@router.delete("/dataset")
def reset_dataset(_: str = Depends(_get_admin)):
    cfg_path = MODELS_DIR / "active_dataset.json"
    if cfg_path.exists():
        cfg_path.unlink()
    upload_path = MODELS_DIR.parent / "uploaded_dataset.csv"
    if upload_path.exists():
        upload_path.unlink()
    return {"message": "Reset to default dataset (Crop_recommendation.csv)"}


def _is_numeric(val: str) -> bool:
    try:
        float(val.strip())
        return True
    except (ValueError, AttributeError):
        return False


def _compute_psi(expected: np.ndarray, actual: np.ndarray, n_bins: int = _PSI_BINS) -> float:
    """
    Population Stability Index (PSI) between expected (training) and actual
    (recent predictions) distributions.

    PSI = Σ (actual% - expected%) * ln(actual% / expected%)

    Equal-frequency binning is used on the expected (training) data so each bin
    holds the same number of training samples. The actual (recent prediction)
    data is then counted into those same bin edges — this avoids empty bins in
    the reference distribution, which would make log(0) undefined.

    Reference: Yurdakul, B. (2018). Western Michigan University.
    """
    # Build bin edges from the training data using equal-frequency (quantile) binning.
    # np.unique removes duplicate edges that appear when many values share the same number.
    percentiles = np.linspace(0, 100, n_bins + 1)
    breakpoints = np.unique(np.percentile(expected, percentiles))

    if len(breakpoints) < 2:
        return 0.0

    exp_counts = np.histogram(expected, bins=breakpoints)[0].astype(float)
    act_counts = np.histogram(actual,   bins=breakpoints)[0].astype(float)

    # Replace zero counts with a tiny epsilon to keep log() defined.
    exp_pct = np.where(exp_counts == 0, 1e-4, exp_counts / len(expected))
    act_pct = np.where(act_counts == 0, 1e-4, act_counts / len(actual))

    psi = float(np.sum((act_pct - exp_pct) * np.log(act_pct / exp_pct)))
    return round(abs(psi), 4)


def _load_training_data() -> dict:
    """Read training CSV and return per-feature value lists."""
    data: dict = {k: [] for k in _FEATURE_MAP}
    with open(get_active_csv_path(), newline="", encoding="utf-8") as f:
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
