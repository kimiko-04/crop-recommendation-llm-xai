"""
ML inference engine for the FastAPI backend.
Loads BERT/DistilBERT models from saved_models/ once at import time.
"""
import json
import sys
import shutil
import threading
import numpy as np
import torch
import shap
from datetime import datetime
from pathlib import Path
from transformers import AutoTokenizer, AutoModelForSequenceClassification

ROOT       = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "saved_models"
CSV_PATH   = ROOT / "Crop_recommendation.csv"

DEVICE     = "cuda" if torch.cuda.is_available() else "cpu"
MAX_LENGTH = 128

_ready   = False
_error   = None
loaded   = {}
id2label = {}
label2id = {}
labels   = []
stats_raw = {}
best_key  = None
_temperatures = {}

try:
    for required in ["stats.json", "label_map.json"]:
        if not (MODELS_DIR / required).exists():
            raise FileNotFoundError(f"{required} not found — run train.py first")

    stats_raw = json.loads((MODELS_DIR / "stats.json").read_text())
    label_map = json.loads((MODELS_DIR / "label_map.json").read_text())
    labels    = label_map["labels"]
    label2id  = label_map["label2id"]
    id2label  = {int(k): v for k, v in label_map["id2label"].items()}

    DEVICE     = "cuda" if torch.cuda.is_available() else "cpu"
    MAX_LENGTH = 128
    MODEL_KEYS = ["distilbert", "bert"]

    model_accuracies = {}
    for key in MODEL_KEYS:
        save_dir = MODELS_DIR / key
        if not (save_dir / "config.json").exists():
            continue
        print(f"[ml_engine] Loading {key} ...")
        tok  = AutoTokenizer.from_pretrained(save_dir)
        mdl  = AutoModelForSequenceClassification.from_pretrained(save_dir).to(DEVICE).eval()
        meta = json.loads((save_dir / "meta.json").read_text())
        loaded[key]           = (tok, mdl)
        model_accuracies[key] = meta.get("accuracy", 0.0)
        cache = MODELS_DIR / key / "temperature.json"
        _temperatures[key] = json.loads(cache.read_text())["temperature"] if cache.exists() else 1.0

    if not loaded:
        raise RuntimeError("No models found — run train.py first")

    best_key = max(model_accuracies, key=model_accuracies.get)
    print(f"[ml_engine] Best model: {best_key.upper()} ({model_accuracies[best_key]:.4f})")

    # Load persisted admin override if it exists
    _active_cfg = MODELS_DIR / "active_model.json"
    if _active_cfg.exists():
        try:
            _saved = json.loads(_active_cfg.read_text()).get("active")
            if _saved and _saved in loaded:
                best_key = _saved
                print(f"[ml_engine] Active model overridden by admin: {best_key.upper()}")
        except Exception:
            pass

    _ready = True

except Exception as exc:
    _error = str(exc)
    print(f"[ml_engine] WARNING: {exc}", file=sys.stderr)


# ── Active model control ──────────────────────────────────────────────────────

def set_active_model(key: str) -> dict:
    global best_key
    if key not in loaded:
        return {"error": f"Model '{key}' not loaded"}
    best_key = key
    (MODELS_DIR / "active_model.json").write_text(json.dumps({"active": key}))
    return {"active": key}


def get_active_model() -> str:
    return best_key


# ── Retrain management ────────────────────────────────────────────────────────

_retrain_status: dict  = {}
_cancel_flags:   dict  = {}   # key → threading.Event

_CHECKPOINTS = {
    "distilbert": "distilbert-base-uncased",
    "bert":       "bert-base-uncased",
}


def get_retrain_status() -> dict:
    return dict(_retrain_status)


def cancel_retrain(key: str) -> dict:
    flag = _cancel_flags.get(key)
    if not flag or _retrain_status.get(key, {}).get("status") != "running":
        return {"error": f"No active retrain found for '{key}'"}
    flag.set()
    _retrain_status[key]["progress"] = "Cancellation requested — stopping after current epoch..."
    return {"message": f"Cancel requested for {key}"}


def start_retrain(key: str) -> dict:
    if key not in _CHECKPOINTS:
        return {"error": f"Unknown model key: {key}"}
    if _retrain_status.get(key, {}).get("status") == "running":
        return {"error": f"{key} retrain already in progress"}
    _cancel_flags[key] = threading.Event()
    _retrain_status[key] = {
        "status":     "running",
        "progress":   "Starting...",
        "started_at": datetime.now().isoformat(),
    }
    threading.Thread(target=_do_retrain, args=(key,), daemon=True).start()
    return {"message": f"Retrain of {key} started"}


def _do_retrain(key: str):
    candidate_dir = MODELS_DIR / f"{key}_candidate"
    try:
        import pandas as pd
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import precision_recall_fscore_support
        from datasets import Dataset, DatasetDict
        from transformers import (
            AutoTokenizer as _Tok,
            AutoModelForSequenceClassification as _Mdl,
            TrainingArguments, Trainer, EarlyStoppingCallback,
        )

        SEED = 42

        _retrain_status[key]["progress"] = "Loading dataset..."
        df = pd.read_csv(CSV_PATH)
        labels_list = sorted(df["label"].unique())
        l2id = {lbl: i for i, lbl in enumerate(labels_list)}
        id2l = {i: lbl for i, lbl in enumerate(labels_list)}
        df["label"] = df["label"].map(l2id)

        train_df, test_df = train_test_split(
            df, test_size=0.2, random_state=SEED, stratify=df["label"]
        )
        st = train_df.describe().loc["mean"]

        def _make_text(row):
            return (
                f"Field Profile: The soil has a Nitrogen level of {row['N']} "
                f"({'high' if row['N'] > st['N'] else 'low'}), "
                f"Phosphorus at {row['P']} "
                f"({'high' if row['P'] > st['P'] else 'low'}), "
                f"and Potassium at {row['K']} "
                f"({'high' if row['K'] > st['K'] else 'low'}) "
                f"with a pH balance of {row['ph']:.2f}. "
                f"Weather Context: The temperature is "
                f"{'warm' if row['temperature'] > 25 else 'cool'} "
                f"at {row['temperature']:.1f}°C, "
                f"humidity is {'humid' if row['humidity'] > st['humidity'] else 'dry'} "
                f"at {row['humidity']:.1f}%, and "
                f"the area receives "
                f"{'heavy' if row['rainfall'] > st['rainfall'] else 'moderate'} "
                f"rainfall of {row['rainfall']:.1f}mm."
            )

        train_df = train_df.copy()
        test_df  = test_df.copy()
        train_df["text"] = train_df.apply(_make_text, axis=1)
        test_df["text"]  = test_df.apply(_make_text, axis=1)

        dataset = DatasetDict({
            "train": Dataset.from_pandas(train_df, preserve_index=False),
            "test":  Dataset.from_pandas(test_df,  preserve_index=False),
        })

        checkpoint = _CHECKPOINTS[key]
        _retrain_status[key]["progress"] = "Loading tokenizer from HuggingFace..."
        tokenizer = _Tok.from_pretrained(checkpoint)

        tok_ds = dataset.map(
            lambda b: tokenizer(
                b["text"], truncation=True, padding="max_length", max_length=MAX_LENGTH
            ),
            batched=True,
        )

        _retrain_status[key]["progress"] = "Initialising model..."
        model = _Mdl.from_pretrained(
            checkpoint, num_labels=len(labels_list),
            label2id=l2id, id2label=id2l,
        )

        def _metrics(eval_pred):
            logits, true_labels = eval_pred
            preds = np.argmax(logits, axis=-1)
            return {"accuracy": float((preds == true_labels).mean())}

        chk_dir = candidate_dir / "checkpoints"
        chk_dir.mkdir(parents=True, exist_ok=True)

        args = TrainingArguments(
            output_dir=str(chk_dir),
            eval_strategy="epoch",
            save_strategy="epoch",
            learning_rate=5e-5,
            per_device_train_batch_size=8,
            num_train_epochs=8,
            weight_decay=0.01,
            warmup_ratio=0.1,
            logging_steps=10,
            load_best_model_at_end=True,
            metric_for_best_model="accuracy",
            greater_is_better=True,
            fp16=torch.cuda.is_available(),
            report_to="none",
            seed=SEED,
        )

        from transformers import TrainerCallback

        class _CancelCallback(TrainerCallback):
            def on_epoch_end(self, args, state, control, **kwargs):
                if _cancel_flags.get(key, threading.Event()).is_set():
                    control.should_training_stop = True
                return control

        _retrain_status[key]["progress"] = "Training (this takes a while)..."
        trainer = Trainer(
            model=model,
            args=args,
            train_dataset=tok_ds["train"],
            eval_dataset=tok_ds["test"],
            compute_metrics=_metrics,
            callbacks=[EarlyStoppingCallback(early_stopping_patience=3), _CancelCallback()],
        )
        trainer.train()

        # Admin cancelled mid-training — clean up and exit
        if _cancel_flags.get(key, threading.Event()).is_set():
            if candidate_dir.exists():
                shutil.rmtree(candidate_dir)
            _retrain_status[key] = {
                "status":   "cancelled",
                "progress": "Cancelled by admin",
            }
            return

        _retrain_status[key]["progress"] = "Saving candidate model..."
        candidate_dir.mkdir(parents=True, exist_ok=True)
        trainer.save_model(str(candidate_dir))
        tokenizer.save_pretrained(str(candidate_dir))

        # Full evaluation for metrics
        _retrain_status[key]["progress"] = "Evaluating candidate..."
        mdl_eval = _Mdl.from_pretrained(str(candidate_dir)).to(DEVICE).eval()
        tok_eval = _Tok.from_pretrained(str(candidate_dir))

        preds_list = []
        for item in dataset["test"]:
            inputs = tok_eval(
                item["text"], return_tensors="pt",
                truncation=True, padding="max_length", max_length=MAX_LENGTH,
            ).to(DEVICE)
            with torch.no_grad():
                preds_list.append(
                    int(torch.argmax(mdl_eval(**inputs).logits, dim=-1).item())
                )

        y_true = list(dataset["test"]["label"])
        acc    = float((np.array(preds_list) == np.array(y_true)).mean())
        prec, rec, f1, _ = precision_recall_fscore_support(
            y_true, preds_list, average="weighted", zero_division=0
        )
        meta = {
            "accuracy":  acc,
            "precision": float(prec),
            "recall":    float(rec),
            "f1":        float(f1),
        }
        (candidate_dir / "meta.json").write_text(json.dumps(meta))

        _retrain_status[key] = {
            "status":       "complete",
            "progress":     "Done",
            "metrics":      meta,
            "completed_at": datetime.now().isoformat(),
        }

    except Exception as exc:
        _retrain_status[key] = {
            "status":   "failed",
            "progress": f"Error: {exc}",
            "error":    str(exc),
        }


def promote_candidate(key: str) -> dict:
    global best_key
    candidate_dir = MODELS_DIR / f"{key}_candidate"
    prod_dir      = MODELS_DIR / key

    if not candidate_dir.exists():
        return {"error": f"No candidate found for '{key}'"}

    try:
        backup_dir = MODELS_DIR / f"{key}_backup"
        if backup_dir.exists():
            shutil.rmtree(backup_dir)
        if prod_dir.exists():
            shutil.copytree(prod_dir, backup_dir)

        if prod_dir.exists():
            shutil.rmtree(prod_dir)
        shutil.copytree(candidate_dir, prod_dir)

        tok = AutoTokenizer.from_pretrained(prod_dir)
        mdl = AutoModelForSequenceClassification.from_pretrained(prod_dir).to(DEVICE).eval()
        loaded[key] = (tok, mdl)

        temp_cache = prod_dir / "temperature.json"
        _temperatures[key] = (
            json.loads(temp_cache.read_text())["temperature"]
            if temp_cache.exists() else 1.0
        )

        _retrain_status.pop(key, None)
        return {"message": f"{key} candidate promoted to production"}

    except Exception as exc:
        return {"error": str(exc)}


def discard_candidate(key: str) -> dict:
    candidate_dir = MODELS_DIR / f"{key}_candidate"
    if not candidate_dir.exists():
        return {"error": f"No candidate found for '{key}'"}
    shutil.rmtree(candidate_dir)
    _retrain_status.pop(key, None)
    return {"message": f"{key} candidate discarded"}


# ── Inference helpers ─────────────────────────────────────────────────────────

def _build_text(n, p, k, ph, temp, hum, rain) -> str:
    n_desc    = "high"  if n    > stats_raw.get("N", 50)        else "low"
    p_desc    = "high"  if p    > stats_raw.get("P", 50)        else "low"
    k_desc    = "high"  if k    > stats_raw.get("K", 50)        else "low"
    temp_desc = "warm"  if temp > 25                             else "cool"
    hum_desc  = "humid" if hum  > stats_raw.get("humidity", 60) else "dry"
    rain_desc = "heavy" if rain > stats_raw.get("rainfall", 100) else "moderate"
    return (
        f"Field Profile: The soil has a Nitrogen level of {n} ({n_desc}), "
        f"Phosphorus at {p} ({p_desc}), and Potassium at {k} ({k_desc}) "
        f"with a pH balance of {ph:.2f}. "
        f"Weather Context: The temperature is {temp_desc} at {temp:.1f}°C, "
        f"humidity is {hum_desc} at {hum:.1f}%, and "
        f"the area receives {rain_desc} rainfall of {rain:.1f}mm."
    )


def predict_crop(n: float, p: float, k: float, ph: float,
                 temp: float, hum: float, rain: float) -> dict:
    if not _ready:
        return {"error": _error or "Models not loaded"}

    tok, mdl = loaded[best_key]
    text     = _build_text(n, p, k, ph, temp, hum, rain)
    inputs   = tok(
        text, return_tensors="pt",
        truncation=True, padding="max_length", max_length=MAX_LENGTH,
    ).to(DEVICE)
    with torch.no_grad():
        logits = mdl(**inputs).logits / _temperatures[best_key]
        probs  = torch.softmax(logits, dim=-1)[0]

    prob_dict  = {id2label[i]: float(probs[i]) for i in range(len(labels))}
    top_crop   = max(prob_dict, key=prob_dict.get)
    confidence = prob_dict[top_crop]
    top5 = sorted(prob_dict.items(), key=lambda x: x[1], reverse=True)[:5]

    return {
        "recommended_crop": top_crop,
        "confidence":       round(confidence * 100, 2),
        "top5":             [{"crop": c, "probability": round(prob * 100, 2)} for c, prob in top5],
        "model_used":       best_key.upper(),
    }


_FEATURE_NAMES = ["N", "P", "K", "pH", "Temperature", "Humidity", "Rainfall"]
_BACKGROUND = np.array([[
    stats_raw.get("N",           50.0),
    stats_raw.get("P",           53.0),
    stats_raw.get("K",           48.0),
    stats_raw.get("ph",           6.47),
    stats_raw.get("temperature", 25.6),
    stats_raw.get("humidity",    71.4),
    stats_raw.get("rainfall",   103.5),
]])


def compute_shap(n: float, p: float, k: float, ph: float,
                 temp: float, hum: float, rain: float) -> dict:
    if not _ready:
        return {"error": _error or "Models not loaded"}

    tok_obj, mdl_obj = loaded[best_key]
    temp_scale = _temperatures[best_key]

    top_result = predict_crop(n, p, k, ph, temp, hum, rain)
    if "error" in top_result:
        return top_result

    top_crop  = top_result["recommended_crop"]
    class_idx = label2id[top_crop]

    def _predict_fn(X: np.ndarray) -> np.ndarray:
        texts = [
            _build_text(float(r[0]), float(r[1]), float(r[2]),
                        float(r[3]), float(r[4]), float(r[5]), float(r[6]))
            for r in X
        ]
        out = []
        batch_size = 16
        for i in range(0, len(texts), batch_size):
            enc = tok_obj(
                texts[i:i + batch_size], return_tensors="pt",
                truncation=True, padding=True, max_length=MAX_LENGTH,
            ).to(DEVICE)
            with torch.no_grad():
                logits = mdl_obj(**enc).logits / temp_scale
                probs  = torch.softmax(logits, dim=-1)[:, class_idx]
            out.extend(probs.cpu().numpy().tolist())
        return np.array(out)

    x         = np.array([[n, p, k, ph, temp, hum, rain]])
    explainer = shap.KernelExplainer(_predict_fn, _BACKGROUND)
    sv        = explainer.shap_values(x, nsamples=100, silent=True)

    return {
        "crop":       top_crop,
        "base_value": round(float(explainer.expected_value), 4),
        "values":     {name: round(float(v), 4)
                       for name, v in zip(_FEATURE_NAMES, sv[0])},
    }


# ── BERT attention-based reasoning ────────────────────────────────────────────

_FEAT_KEYWORDS = {
    "N":           ["nitrogen"],
    "P":           ["phosphorus"],
    "K":           ["potassium"],
    "pH":          ["ph", "balance"],
    "Temperature": ["temperature", "warm", "cool"],
    "Humidity":    ["humidity", "humid", "dry"],
    "Rainfall":    ["rainfall", "heavy", "moderate"],
}


def generate_reasoning(n: float, p: float, k: float, ph: float,
                        temp: float, hum: float, rain: float) -> dict:
    if not _ready:
        return {"error": _error or "Models not loaded"}

    tok_obj, mdl_obj = loaded[best_key]
    temp_scale = _temperatures[best_key]

    top_result = predict_crop(n, p, k, ph, temp, hum, rain)
    if "error" in top_result:
        return top_result
    crop = top_result["recommended_crop"]

    text   = _build_text(n, p, k, ph, temp, hum, rain)
    inputs = tok_obj(text, return_tensors="pt", truncation=True,
                     max_length=MAX_LENGTH).to(DEVICE)
    tokens = [t.lower() for t in tok_obj.convert_ids_to_tokens(inputs["input_ids"][0])]

    with torch.no_grad():
        out = mdl_obj(**inputs, output_attentions=True)

    cls_attn = out.attentions[-1][0, :, 0, :].mean(dim=0).cpu().numpy()

    feat_scores = {}
    for feat, keywords in _FEAT_KEYWORDS.items():
        idx = [i for i, t in enumerate(tokens)
               if any(kw in t for kw in keywords)]
        feat_scores[feat] = float(cls_attn[idx].mean()) if idx else 0.0

    ranked = sorted(feat_scores.items(), key=lambda x: x[1], reverse=True)
    top3   = [f for f, _ in ranked[:3]]

    n_d  = "high" if n    > stats_raw.get("N",           50)  else "low"
    p_d  = "high" if p    > stats_raw.get("P",           53)  else "low"
    k_d  = "high" if k    > stats_raw.get("K",           48)  else "low"
    t_d  = "warm" if temp > 25                                 else "cool"
    h_d  = "humid" if hum > stats_raw.get("humidity",    71)  else "dry"
    r_d  = "heavy" if rain > stats_raw.get("rainfall",  103)  else "moderate"
    ph_d = ("slightly acidic" if ph < 6.0
            else "slightly alkaline" if ph > 7.5
            else "balanced")

    desc = {
        "N":           (f"your soil has {'plenty of' if n_d == 'high' else 'low'} nitrogen "
                        f"({n:.0f} mg/kg), which {'feeds leafy growth well' if n_d == 'high' else 'suits crops that need less feeding'}"),
        "P":           (f"your phosphorus level is {'high' if p_d == 'high' else 'low'} "
                        f"({p:.0f} mg/kg), which {'encourages strong roots and flowering' if p_d == 'high' else 'is suitable for low-demand crops'}"),
        "K":           (f"your potassium is {'high' if k_d == 'high' else 'low'} "
                        f"({k:.0f} mg/kg), which {'helps the crop resist disease and produce quality yield' if k_d == 'high' else 'works for crops with modest needs'}"),
        "pH":          (f"your soil has a {ph_d} pH of {ph:.1f}, "
                        f"which is {'a good range for most crops' if 5.5 <= ph <= 7.5 else 'on the extreme side but manageable'}"),
        "Temperature": (f"the {'warm' if t_d == 'warm' else 'cool'} weather at {temp:.0f}°C "
                        f"{'creates a good growing environment' if t_d == 'warm' else 'keeps the crop comfortable'}"),
        "Humidity":    (f"the {'moist' if h_d == 'humid' else 'relatively dry'} air at {hum:.0f}% humidity "
                        f"{'supports steady crop development' if h_d == 'humid' else 'reduces the risk of fungal disease'}"),
        "Rainfall":    (f"the {'generous' if r_d == 'heavy' else 'moderate'} rainfall of {rain:.0f} mm "
                        f"{'keeps the soil well watered' if r_d == 'heavy' else 'provides enough water without flooding the roots'}"),
    }

    parts = [desc[f] for f in top3 if f in desc]
    if len(parts) >= 3:
        sentence = (f"Your field is a great match for {crop.capitalize()}. "
                    f"The main reasons are that {parts[0]}, and {parts[1]}. "
                    f"On top of that, {parts[2]}.")
    elif len(parts) == 2:
        sentence = (f"{crop.capitalize()} suits your field well. "
                    f"The key factors are that {parts[0]}, and {parts[1]}.")
    else:
        sentence = (f"{crop.capitalize()} is a good fit for your current soil "
                    f"and weather conditions.")

    return {
        "crop":              crop,
        "reasoning":         sentence,
        "top_features":      top3,
        "feature_attention": {k: round(v, 5) for k, v in ranked},
    }


# ── Model info & confusion matrix ─────────────────────────────────────────────

import csv as _csv

def get_model_info() -> dict:
    if not _ready:
        return {"error": _error or "Models not loaded"}

    models_data = {}
    for key in loaded:
        meta_path = MODELS_DIR / key / "meta.json"
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        cm_path = MODELS_DIR / key / "confusion_matrix.json"
        cm = json.loads(cm_path.read_text()) if cm_path.exists() else None
        models_data[key] = {
            "name":             key.upper(),
            "accuracy":         round(meta.get("accuracy",  0) * 100, 2),
            "precision":        round(meta.get("precision", 0) * 100, 2),
            "recall":           round(meta.get("recall",    0) * 100, 2),
            "f1":               round(meta.get("f1",        0) * 100, 2),
            "confusion_matrix": cm,
        }

    return {"best_model": best_key.upper(), "models": models_data, "labels": labels}


def compute_confusion_matrix(key: str) -> dict:
    cache_path = MODELS_DIR / key / "confusion_matrix.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text())

    if not _ready or key not in loaded:
        return {"error": f"Model '{key}' not available"}

    tok_obj, mdl_obj = loaded[key]
    temp_scale = _temperatures[key]

    rows = []
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        for row in _csv.DictReader(f):
            rows.append(row)

    texts, true_ids = [], []
    for row in rows:
        texts.append(_build_text(
            float(row["N"]), float(row["P"]), float(row["K"]),
            float(row["ph"]), float(row["temperature"]),
            float(row["humidity"]), float(row["rainfall"]),
        ))
        true_ids.append(label2id[row["label"]])

    preds, batch_size = [], 32
    for i in range(0, len(texts), batch_size):
        enc = tok_obj(
            texts[i:i + batch_size], return_tensors="pt",
            truncation=True, padding=True, max_length=MAX_LENGTH,
        ).to(DEVICE)
        with torch.no_grad():
            pred = (mdl_obj(**enc).logits / temp_scale).argmax(dim=-1)
        preds.extend(pred.cpu().numpy().tolist())

    n = len(labels)
    matrix = [[0] * n for _ in range(n)]
    for t, p in zip(true_ids, preds):
        matrix[t][p] += 1

    result = {"labels": labels, "matrix": matrix}
    cache_path.write_text(json.dumps(result))
    return result
