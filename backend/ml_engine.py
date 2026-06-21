"""
ML inference engine for the FastAPI backend.

Core idea: tabular soil/weather data is converted to a natural-language
sentence ("Field Profile: ..."), then fed into a fine-tuned BERT or DistilBERT
sequence classifier instead of a traditional ML model (Random Forest, XGBoost, etc.).
This approach lets us layer two XAI methods on top of the NLP model:
  1. SHAP KernelExplainer  — model-agnostic numeric feature attribution
  2. BERT CLS attention    — attention-weight-based natural-language reasoning

All models are loaded into memory once at import time so that every HTTP
request hits an already-warm model with no cold-start cost.
"""
import json
import re
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


def get_active_csv_path() -> Path:
    """Return the currently active training dataset path.

    Falls back to the default Crop_recommendation.csv if no custom dataset
    has been uploaded or the uploaded file no longer exists.
    """
    cfg = MODELS_DIR / "active_dataset.json"
    if cfg.exists():
        try:
            info = json.loads(cfg.read_text())
            path = Path(info["path"])
            if path.exists():
                return path
        except Exception:
            pass
    return CSV_PATH

DEVICE     = "cuda" if torch.cuda.is_available() else "cpu"
MAX_LENGTH = 128  # tokens; the NLP template is ~60-70 tokens so 128 is sufficient

# ── Model versioning helpers ──────────────────────────────────────────────────
# Versioning scheme: base names are "bert" / "distilbert";
# promoted retrained models become "bert_v2", "bert_v3", etc.
# The regex matches both the base names and the versioned suffixes.

_VERSION_RE = re.compile(r'^(bert|distilbert)(_v(\d+))?$')


def _scan_model_dirs() -> list:
    """Return all valid model directory names, sorted by base then version number."""
    found = []
    if not MODELS_DIR.exists():
        return found
    for d in MODELS_DIR.iterdir():
        if d.is_dir() and _VERSION_RE.match(d.name) and (d / "config.json").exists():
            found.append(d.name)
    def _sort(name):
        m = _VERSION_RE.match(name)
        return (m.group(1), int(m.group(3)) if m.group(3) else 1)
    return sorted(found, key=_sort)


def _next_version_key(base: str) -> str:
    """Return the next available versioned key, e.g. "bert_v3" if bert_v2 already exists."""
    max_v = 1
    for k in loaded:
        m = re.match(rf'^{base}_v(\d+)$', k)
        if m:
            max_v = max(max_v, int(m.group(1)))
    return f"{base}_v{max_v + 1}"


# ── Module-level state ────────────────────────────────────────────────────────
# Using module globals instead of a class so that all routes share the same
# in-process objects without any import-time circular dependency.

_ready        = False   # True only after all models load without error
_error        = None    # Holds the exception message if loading failed
loaded        = {}      # key → (tokenizer, model) pairs, ALL versions kept in RAM
id2label      = {}      # int id → crop name (from label_map.json)
label2id      = {}      # crop name → int id
labels        = []      # ordered list of all 22 crop class names
stats_raw     = {}      # training-set feature means (used as SHAP background)
best_key      = None    # the currently active model key (can be overridden by admin)
_temperatures = {}      # key → calibration temperature scalar (default 1.0 = no scaling)

try:
    for required in ["stats.json", "label_map.json"]:
        if not (MODELS_DIR / required).exists():
            raise FileNotFoundError(f"{required} not found — run train.py first")

    stats_raw = json.loads((MODELS_DIR / "stats.json").read_text())
    label_map = json.loads((MODELS_DIR / "label_map.json").read_text())
    labels    = label_map["labels"]
    label2id  = label_map["label2id"]
    id2label  = {int(k): v for k, v in label_map["id2label"].items()}

    model_accuracies = {}
    for key in _scan_model_dirs():
        save_dir = MODELS_DIR / key
        if not (save_dir / "config.json").exists():
            continue
        print(f"[ml_engine] Loading {key} ...")
        tok  = AutoTokenizer.from_pretrained(save_dir)
        # attn_implementation="eager" is required for generate_reasoning(), which passes
        # output_attentions=True.  The default "sdpa" (scaled dot product) backend in
        # Transformers >=4.36 drops attention weights when output_attentions=True, causing
        # a silent fallback and a deprecation warning.  "eager" always returns them correctly.
        mdl  = AutoModelForSequenceClassification.from_pretrained(
            save_dir, attn_implementation="eager"
        ).to(DEVICE).eval()
        meta = json.loads((save_dir / "meta.json").read_text())
        loaded[key]           = (tok, mdl)
        model_accuracies[key] = meta.get("accuracy", 0.0)
        # Temperature scaling: a single scalar T is learned post-training to
        # make softmax confidences better calibrated (logits / T before softmax).
        # T=1.0 is a no-op; T>1.0 softens probabilities toward uniform.
        cache = MODELS_DIR / key / "temperature.json"
        _temperatures[key] = json.loads(cache.read_text())["temperature"] if cache.exists() else 1.0

    if not loaded:
        raise RuntimeError("No models found — run train.py first")

    # Default active model = highest validation accuracy at training time.
    best_key = max(model_accuracies, key=model_accuracies.get)
    print(f"[ml_engine] Best model: {best_key.upper()} ({model_accuracies[best_key]:.4f})")

    # Admin can override the active model via the UI; the choice is persisted in
    # active_model.json so it survives server restarts.
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
    # Soft failure: the server still starts so the frontend can show a useful
    # error message instead of a connection-refused.
    _error = str(exc)
    print(f"[ml_engine] WARNING: {exc}", file=sys.stderr)


# ── Active model control ──────────────────────────────────────────────────────

def set_active_model(key: str) -> dict:
    global best_key
    if key not in loaded:
        return {"error": f"Model '{key}' not loaded"}
    best_key = key
    # Persist the choice so it survives a server restart.
    (MODELS_DIR / "active_model.json").write_text(json.dumps({"active": key}))
    return {"active": key}


def get_active_model() -> str:
    return best_key


# ── Retrain management ────────────────────────────────────────────────────────
# Retraining runs in a background daemon thread so the HTTP request that
# triggers it returns immediately. Progress is tracked in _retrain_status
# and polled by the admin UI. Cancel support uses threading.Event: the
# _CancelCallback checks the flag at the end of each epoch and tells the
# Trainer to stop early — it never aborts mid-batch.

_retrain_status: dict = {}
_cancel_flags:   dict = {}   # key → threading.Event, set by cancel_retrain()

# HuggingFace Hub checkpoint names for each supported base model.
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
        df = pd.read_csv(get_active_csv_path())
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

    if not candidate_dir.exists():
        return {"error": f"No candidate found for '{key}'"}

    try:
        new_key = _next_version_key(key)
        new_dir = MODELS_DIR / new_key
        shutil.copytree(candidate_dir, new_dir)

        tok = AutoTokenizer.from_pretrained(new_dir)
        mdl = AutoModelForSequenceClassification.from_pretrained(new_dir).to(DEVICE).eval()
        loaded[new_key] = (tok, mdl)

        temp_cache = new_dir / "temperature.json"
        _temperatures[new_key] = (
            json.loads(temp_cache.read_text())["temperature"]
            if temp_cache.exists() else 1.0
        )

        best_key = new_key
        (MODELS_DIR / "active_model.json").write_text(json.dumps({"active": new_key}))

        shutil.rmtree(candidate_dir)
        _retrain_status.pop(key, None)
        return {"message": f"{key} candidate saved as {new_key}", "new_key": new_key}

    except Exception as exc:
        return {"error": str(exc)}


def discard_candidate(key: str) -> dict:
    candidate_dir = MODELS_DIR / f"{key}_candidate"
    if not candidate_dir.exists():
        return {"error": f"No candidate found for '{key}'"}
    shutil.rmtree(candidate_dir)
    _retrain_status.pop(key, None)
    return {"message": f"{key} candidate discarded"}


def delete_model_version(version_key: str) -> dict:
    global best_key
    if version_key not in loaded:
        return {"error": f"Model '{version_key}' not found"}
    if version_key == best_key:
        return {"error": "Cannot delete the active model. Set a different model as active first."}
    model_dir = MODELS_DIR / version_key
    if model_dir.exists():
        shutil.rmtree(model_dir)
    del loaded[version_key]
    _temperatures.pop(version_key, None)
    return {"message": f"Model '{version_key}' deleted successfully"}


# ── Inference helpers ─────────────────────────────────────────────────────────

def _build_text(n, p, k, ph, temp, hum, rain) -> str:
    """Convert 7 numeric features into the natural-language sentence the model was trained on.

    The template adds qualitative descriptors ("high"/"low", "warm"/"cool", etc.)
    anchored to the training-set mean.  Both the raw number AND the descriptor are
    included so the tokenizer sees stable keywords that BERT can attend to —
    which is what the attention-based reasoning step later relies on.
    """
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


def _run_inference(active: str, n: float, p: float, k: float, ph: float,
                   temp: float, hum: float, rain: float) -> dict:
    """Internal inference on a specific, already-snapshotted model key.

    All callers (predict_crop, compute_shap, generate_reasoning) snapshot
    best_key into a local variable ONCE and pass it here, so the tokenizer,
    model weights, temperature scalar, and model_used label all come from
    the same model even if an admin switches the active model mid-request.
    """
    tok, mdl = loaded[active]
    text     = _build_text(n, p, k, ph, temp, hum, rain)
    inputs   = tok(
        text, return_tensors="pt",
        truncation=True, padding="max_length", max_length=MAX_LENGTH,
    ).to(DEVICE)
    with torch.no_grad():
        # Divide logits by temperature BEFORE softmax to calibrate confidence.
        # Without this the model tends to be overconfident (probabilities cluster near 1.0).
        logits = mdl(**inputs).logits / _temperatures[active]
        probs  = torch.softmax(logits, dim=-1)[0]

    prob_dict  = {id2label[i]: float(probs[i]) for i in range(len(labels))}
    top_crop   = max(prob_dict, key=prob_dict.get)
    confidence = prob_dict[top_crop]
    top5 = sorted(prob_dict.items(), key=lambda x: x[1], reverse=True)[:5]

    return {
        "recommended_crop": top_crop,
        "confidence":       round(confidence * 100, 2),
        "top5":             [{"crop": c, "probability": round(prob * 100, 2)} for c, prob in top5],
        "model_used":       active.upper(),
    }


def predict_crop(n: float, p: float, k: float, ph: float,
                 temp: float, hum: float, rain: float) -> dict:
    if not _ready:
        return {"error": _error or "Models not loaded"}
    # Snapshot best_key once — all reads within this request use the same model.
    active = best_key
    return _run_inference(active, n, p, k, ph, temp, hum, rain)


_FEATURE_NAMES = ["N", "P", "K", "pH", "Temperature", "Humidity", "Rainfall"]

# SHAP baseline: a single row of training-set feature means.
# KernelExplainer computes SHAP values as deviations from this baseline prediction.
# Using the mean is standard practice — it represents the "average field" from the dataset.
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

    # Snapshot best_key ONCE. All subsequent reads (tok_obj, temp_scale, predict, closure)
    # use `active` so the entire SHAP computation is locked to a single model.
    active     = best_key
    tok_obj, mdl_obj = loaded[active]
    temp_scale = _temperatures[active]

    top_result = _run_inference(active, n, p, k, ph, temp, hum, rain)
    if "error" in top_result:
        return top_result

    top_crop  = top_result["recommended_crop"]
    class_idx = label2id[top_crop]

    # _predict_fn is the black-box function SHAP treats as the model.
    # It receives a 2-D numpy array of feature rows, converts each row back to
    # the NLP text template, runs them through the BERT model in batches, and
    # returns the probability of the TOP predicted class for each row.
    # KernelExplainer calls this function ~100*n_features times (nsamples=100),
    # which is why SHAP takes ~30 s — it has no knowledge of the model internals.
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
    # nsamples=100: number of random coalitions per feature. Higher = more accurate
    # but slower. 100 is enough for 7 features and an FYP demo context.
    sv        = explainer.shap_values(x, nsamples=100, silent=True)

    return {
        "crop":       top_crop,
        "base_value": round(float(explainer.expected_value), 4),
        "values":     {name: round(float(v), 4)
                       for name, v in zip(_FEATURE_NAMES, sv[0])},
        "model_used": active.upper(),
    }


# ── BERT attention-based reasoning ────────────────────────────────────────────
# This is a SEPARATE XAI method from SHAP — the two serve different purposes:
#   SHAP → numeric attribution (which features pushed the probability up/down)
#   Attention → readable sentence (which parts of the text the model "looked at")
#
# Method: extract CLS-token attention weights from the last transformer layer,
# average across all heads, then map known feature keywords to their token
# positions.  The 3 features whose keyword tokens attracted the most CLS
# attention are considered the model's top reasons for the prediction.

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

    # Snapshot best_key ONCE so tokenizer, model, and predicted crop all come
    # from the same model even if an admin switches mid-request.
    active     = best_key
    tok_obj, mdl_obj = loaded[active]

    top_result = _run_inference(active, n, p, k, ph, temp, hum, rain)
    if "error" in top_result:
        return top_result
    crop = top_result["recommended_crop"]

    text   = _build_text(n, p, k, ph, temp, hum, rain)
    inputs = tok_obj(text, return_tensors="pt", truncation=True,
                     max_length=MAX_LENGTH).to(DEVICE)
    tokens = [t.lower() for t in tok_obj.convert_ids_to_tokens(inputs["input_ids"][0])]

    with torch.no_grad():
        # output_attentions=True returns a tuple of attention tensors per layer.
        out = mdl_obj(**inputs, output_attentions=True)

    # Shape: (heads, seq_len, seq_len) → take the last layer, CLS row (index 0),
    # average across all attention heads → 1-D vector of length seq_len.
    cls_attn = out.attentions[-1][0, :, 0, :].mean(dim=0).cpu().numpy()

    # For each feature, find which token positions correspond to its keywords
    # and average the CLS attention at those positions.
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
        "model_used":        active.upper(),
    }


# ── Model info & confusion matrix ─────────────────────────────────────────────

import csv as _csv

def get_model_info() -> dict:
    if not _ready:
        return {"error": _error or "Models not loaded"}

    models_data = {}
    for key in loaded:
        m    = _VERSION_RE.match(key)
        base = m.group(1) if m else key
        ver  = int(m.group(3)) if m and m.group(3) else 1
        meta_path = MODELS_DIR / key / "meta.json"
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        cm_path = MODELS_DIR / key / "confusion_matrix.json"
        cm = json.loads(cm_path.read_text()) if cm_path.exists() else None
        models_data[key] = {
            "name":             f"{base.upper()} v{ver}",
            "base":             base,
            "version":          ver,
            "key":              key,
            "accuracy":         round(meta.get("accuracy",  0) * 100, 2),
            "precision":        round(meta.get("precision", 0) * 100, 2),
            "recall":           round(meta.get("recall",    0) * 100, 2),
            "f1":               round(meta.get("f1",        0) * 100, 2),
            "confusion_matrix": cm,
        }

    return {"active": best_key, "best_model": best_key.upper(), "models": models_data, "labels": labels}


def compute_confusion_matrix(key: str) -> dict:
    cache_path = MODELS_DIR / key / "confusion_matrix.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text())

    if not _ready or key not in loaded:
        return {"error": f"Model '{key}' not available"}

    tok_obj, mdl_obj = loaded[key]
    temp_scale = _temperatures[key]

    rows = []
    with open(get_active_csv_path(), newline="", encoding="utf-8") as f:
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
