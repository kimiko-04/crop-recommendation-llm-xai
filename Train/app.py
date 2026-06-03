"""
Crop Recommendation — Gradio App
Loads pre-trained models from saved_models/ and launches the UI.
Reminder - Run train.py first if saved_models/ does not exist yet.
"""

import json
import sys
import numpy as np
import pandas as pd
import torch
import shap
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import gradio as gr
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.metrics import precision_score, recall_score, f1_score
from scipy.optimize import minimize_scalar
from transformers import AutoTokenizer, AutoModelForSequenceClassification

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT       = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "saved_models"

for required in ["stats.json", "label_map.json"]:
    if not (MODELS_DIR / required).exists():
        sys.exit(f"[ERROR] {MODELS_DIR / required} not found. Run train.py first.")

# ── Load shared metadata ───────────────────────────────────────────────────────
stats_raw = json.loads((MODELS_DIR / "stats.json").read_text())
label_map = json.loads((MODELS_DIR / "label_map.json").read_text())

labels   = label_map["labels"]
label2id = label_map["label2id"]
id2label = {int(k): v for k, v in label_map["id2label"].items()}

DEVICE     = "cuda" if torch.cuda.is_available() else "cpu"
MAX_LENGTH = 128

MODEL_KEYS = ["distilbert", "bert"]

# ── Load models ───────────────────────────────────────────────────────────────
loaded = {}
model_accuracies = {}

model_metrics = {}   # stores accuracy, precision, recall, f1 per model

for key in MODEL_KEYS:
    save_dir = MODELS_DIR / key
    if not (save_dir / "config.json").exists():
        sys.exit(f"[ERROR] Model '{key}' not found at {save_dir}. Run train.py first.")

    print(f"Loading {key} from {save_dir} ...")
    tokenizer = AutoTokenizer.from_pretrained(save_dir)
    model     = AutoModelForSequenceClassification.from_pretrained(save_dir).to(DEVICE).eval()
    meta      = json.loads((save_dir / "meta.json").read_text())

    loaded[key]           = (tokenizer, model)
    model_accuracies[key] = meta.get("accuracy", 0.0)
    model_metrics[key]    = {
        "accuracy":  meta.get("accuracy",  0.0),
        "precision": meta.get("precision", 0.0),
        "recall":    meta.get("recall",    0.0),
        "f1":        meta.get("f1",        0.0),
    }
    print(f"  [{key}] accuracy: {model_accuracies[key]:.4f}")

best_key = max(model_accuracies, key=model_accuracies.get)
print(f"\nBest model: {best_key.upper()}  ({model_accuracies[best_key]:.4f})\n")

# ── Prediction helpers ────────────────────────────────────────────────────────
def build_text(n, p, k, ph, temp, hum, rain):
    n_desc    = "high"  if n    > stats_raw["N"]           else "low"
    p_desc    = "high"  if p    > stats_raw["P"]           else "low"
    k_desc    = "high"  if k    > stats_raw["K"]           else "low"
    temp_desc = "warm"  if temp > 25                       else "cool"
    hum_desc  = "humid" if hum  > stats_raw["humidity"]    else "dry"
    rain_desc = "heavy" if rain > stats_raw["rainfall"]    else "moderate"
    return (
        f"Field Profile: The soil has a Nitrogen level of {n} ({n_desc}), "
        f"Phosphorus at {p} ({p_desc}), and Potassium at {k} ({k_desc}) "
        f"with a pH balance of {ph:.2f}. "
        f"Weather Context: The temperature is {temp_desc} at {temp:.1f}°C, "
        f"humidity is {hum_desc} at {hum:.1f}%, and "
        f"the area receives {rain_desc} rainfall of {rain:.1f}mm."
    )


# ── Temperature calibration ────────────────────────────────────────────────────
def _find_temperature(key):
    """Find optimal softmax temperature on the held-out test set.

    Minimises negative log-likelihood. Result cached to disk after first run.
    """
    cache_path = MODELS_DIR / key / "temperature.json"
    if cache_path.exists():
        T = json.loads(cache_path.read_text())["temperature"]
        print(f"  [{key}] loaded cached temperature T={T:.4f}")
        return T

    print(f"  [{key}] calibrating temperature on test set …")
    tok, mdl = loaded[key]

    df = pd.read_csv(ROOT / "Crop_recommendation.csv")
    _, test_df = train_test_split(
        df, test_size=0.2, random_state=42, stratify=df["label"]
    )

    all_logits, all_labels = [], []
    for _, row in test_df.iterrows():
        text   = build_text(row["N"], row["P"], row["K"], row["ph"],
                            row["temperature"], row["humidity"], row["rainfall"])
        inputs = tok(text, return_tensors="pt", truncation=True,
                     padding="max_length", max_length=MAX_LENGTH).to(DEVICE)
        with torch.no_grad():
            all_logits.append(mdl(**inputs).logits[0].cpu().numpy())
        all_labels.append(label2id[row["label"]])

    logits = np.array(all_logits)
    labels = np.array(all_labels)

    def nll(T):
        scaled    = logits / T
        log_sum   = np.log(np.exp(scaled).sum(axis=1, keepdims=True))
        log_probs = scaled - log_sum
        return -log_probs[np.arange(len(labels)), labels].mean()

    result = minimize_scalar(nll, bounds=(0.5, 20.0), method="bounded")
    T = float(result.x)
    cache_path.write_text(json.dumps({"temperature": T}))
    print(f"  [{key}] optimal temperature T={T:.4f}  (cached)")
    return T

print("Calibrating model temperatures …")
_temperatures = {key: _find_temperature(key) for key in MODEL_KEYS}
print()


def predict_single(key, n, p, k, ph, temp, hum, rain):
    tok, mdl = loaded[key]
    text     = build_text(n, p, k, ph, temp, hum, rain)
    inputs   = tok(
        text, return_tensors="pt",
        truncation=True, padding="max_length", max_length=MAX_LENGTH,
    ).to(DEVICE)
    with torch.no_grad():
        logits = mdl(**inputs).logits / _temperatures[key]
        probs  = torch.softmax(logits, dim=-1)[0]
    return {id2label[i]: float(probs[i]) for i in range(len(labels))}


def _ensure_full_metrics(key):
    """Compute precision, recall, F1 on the test set if missing from meta.json."""
    meta_path = MODELS_DIR / key / "meta.json"
    meta      = json.loads(meta_path.read_text())
    if all(k in meta for k in ("precision", "recall", "f1")):
        return meta

    print(f"  [{key}] computing precision/recall/F1 on test set …")
    df = pd.read_csv(ROOT / "Crop_recommendation.csv")
    _, test_df = train_test_split(
        df, test_size=0.2, random_state=42, stratify=df["label"]
    )

    y_true, y_pred = [], []
    for _, row in test_df.iterrows():
        probs    = predict_single(key, row["N"], row["P"], row["K"],
                                  row["ph"], row["temperature"],
                                  row["humidity"], row["rainfall"])
        y_pred.append(max(probs, key=probs.get))
        y_true.append(row["label"])

    meta["precision"] = precision_score(y_true, y_pred, average="weighted", zero_division=0)
    meta["recall"]    = recall_score(y_true, y_pred, average="weighted", zero_division=0)
    meta["f1"]        = f1_score(y_true, y_pred, average="weighted", zero_division=0)
    meta_path.write_text(json.dumps(meta))
    print(f"  [{key}] precision={meta['precision']:.4f}  recall={meta['recall']:.4f}  f1={meta['f1']:.4f}")
    return meta

print("Computing full metrics …")
for key in MODEL_KEYS:
    meta = _ensure_full_metrics(key)
    model_metrics[key]["precision"] = meta["precision"]
    model_metrics[key]["recall"]    = meta["recall"]
    model_metrics[key]["f1"]        = meta["f1"]
print()

# ── SHAP Setup ────────────────────────────────────────────────────────────────
# Feature order matches CSV columns: N, P, K, temperature, humidity, ph, rainfall
FEATURE_NAMES = ["N", "P", "K", "temperature", "humidity", "ph", "rainfall"]
FEATURE_LABELS = [
    "Nitrogen (N)", "Phosphorus (P)", "Potassium (K)",
    "Temperature (°C)", "Humidity (%)", "Soil pH", "Rainfall (mm)",
]

_df_bg = pd.read_csv(ROOT / "Crop_recommendation.csv")[FEATURE_NAMES].astype(float)
_bg    = _df_bg.mean().values.reshape(1, -1)


def _model_fn(X):
    """SHAP-compatible black-box wrapper: (n, 7) float array → (n, n_classes) probabilities.

    Column order of X: N, P, K, temperature, humidity, ph, rainfall
    """
    out = []
    for row in X:
        probs = predict_single(
            best_key,
            n=float(row[0]), p=float(row[1]), k=float(row[2]),
            ph=float(row[5]), temp=float(row[3]),
            hum=float(row[4]), rain=float(row[6]),
        )
        out.append([probs[id2label[i]] for i in range(len(labels))])
    return np.array(out)


print("Initialising SHAP KernelExplainer …")
_explainer = shap.KernelExplainer(_model_fn, _bg)
print("SHAP explainer ready.\n")

def shap_explain(n, p, k, ph, temp, hum, rain):
    """Run prediction + SHAP explanation; return (probs_dict, matplotlib_figure)."""
    probs    = predict_single(best_key, n, p, k, ph, temp, hum, rain)
    top_crop = max(probs, key=probs.get)
    top_idx  = label2id[top_crop]

    # x column order: N, P, K, temperature, humidity, ph, rainfall
    x  = np.array([[n, p, k, temp, hum, ph, rain]])
    sv = _explainer.shap_values(x, nsamples=100, silent=True)
    # SHAP >=0.44: returns ndarray (n_samples, n_features, n_classes) or list[(n_samples, n_features)]
    if isinstance(sv, list):
        vals = sv[top_idx][0]          # list path: index by class, then sample
    elif sv.ndim == 3:
        vals = sv[0, :, top_idx]       # array path: (sample, feature, class)
    else:
        vals = sv[0]                   # single-output fallback

    fig, ax = plt.subplots(figsize=(8, 4))
    colors = ["#2ecc71" if v >= 0 else "#e74c3c" for v in vals]
    bars   = ax.barh(FEATURE_LABELS, vals, color=colors, edgecolor="white", height=0.6)
    ax.axvline(0, color="#444", linewidth=0.9, linestyle="--")
    ax.set_xlabel("SHAP value  (positive = supports this crop recommendation)")
    ax.set_title(
        f"Feature Contributions — Predicted: {top_crop}  ({probs[top_crop]:.1%} confidence)"
        f"\n[{best_key.upper()} model | SHAP KernelExplainer]",
        fontsize=10,
    )
    ax.bar_label(bars, fmt="%.4f", padding=4, fontsize=8)
    fig.tight_layout()

    explanation = _build_explanation(top_crop, probs[top_crop], n, p, k, ph, temp, hum, rain, vals)
    return probs, fig, explanation


def _build_explanation(top_crop, confidence, n, p, k, ph, temp, hum, rain, shap_vals):
    n_desc    = "high"  if n    > stats_raw["N"]        else "low"
    p_desc    = "high"  if p    > stats_raw["P"]        else "low"
    k_desc    = "high"  if k    > stats_raw["K"]        else "low"
    temp_desc = "warm"  if temp > 25                    else "cool"
    hum_desc  = "humid" if hum  > stats_raw["humidity"] else "dry"
    rain_desc = "heavy" if rain > stats_raw["rainfall"] else "moderate"

    condition_map = {
        "Nitrogen (N)":     f"the nitrogen level is {n_desc} ({n:.0f})",
        "Phosphorus (P)":   f"the phosphorus level is {p_desc} ({p:.0f})",
        "Potassium (K)":    f"the potassium level is {k_desc} ({k:.0f})",
        "Temperature (°C)": f"the temperature is {temp_desc} ({temp:.1f}°C)",
        "Humidity (%)":     f"the humidity is {hum_desc} ({hum:.1f}%)",
        "Soil pH":          f"the soil pH is {ph:.1f}",
        "Rainfall (mm)":    f"the rainfall is {rain_desc} ({rain:.1f}mm)",
    }

    ranked   = sorted(zip(FEATURE_LABELS, shap_vals), key=lambda x: abs(x[1]), reverse=True)
    support  = [(l, v) for l, v in ranked if v > 0]
    opposing = [(l, v) for l, v in ranked if v < 0]

    lines = [f"**{top_crop.capitalize()}** is recommended with **{confidence:.1%} confidence**.\n"]

    if support:
        factors = " and ".join(condition_map[l] for l, _ in support[:2])
        lines.append(f"The {factors}, which are ideal conditions for growing {top_crop}.")

    if len(support) > 2:
        extra = condition_map[support[2][0]]
        lines.append(f"The {extra} also contributes positively.")

    if opposing:
        factor = condition_map[opposing[0][0]]
        lines.append(
            f"The {factor} is less optimal for {top_crop}, "
            f"but the overall soil and climate profile still strongly favours this crop."
        )

    return "  \n".join(lines)

# ── Gradio UI ─────────────────────────────────────────────────────────────────
SLIDER_DEFS = [
    ("Nitrogen (N)",     0,   300, 50,   1  ),
    ("Phosphorus (P)",   0,   300, 50,   1  ),
    ("Potassium (K)",    0,   300, 50,   1  ),
    ("Soil pH",          3.5, 9.5, 6.5,  0.1),
    ("Temperature (°C)", 10,  50,  25,   0.5),
    ("Humidity (%)",     10,  100, 60,   1  ),
    ("Rainfall (mm)",    20,  500, 100,  5  ),
]

def make_sliders():
    return [
        gr.Slider(minimum=mn, maximum=mx, value=val, step=step, label=lbl)
        for lbl, mn, mx, val, step in SLIDER_DEFS
    ]


acc_str = "  |  ".join(f"{k.upper()}: `{v:.2%}`" for k, v in model_accuracies.items())

cm_paths = {key: str(MODELS_DIR / f"cm_{key}.png") for key in MODEL_KEYS}

with gr.Blocks(title="Crop Recommendation") as demo:
    gr.Markdown(
        "# \U0001f33e Crop Recommendation System\n"
        "Fine-tuned **BERT** & **DistilBERT** on soil/climate data.\n\n"
        f"{acc_str}  |  Best model: **{best_key.upper()}**"
    )

    with gr.Tabs():
        # Tab 1 — best model + SHAP explanation
        with gr.Tab(f"Best Model ({best_key.upper()})"):
            gr.Markdown(
                "_Adjust the sliders and click **Recommend Crop** to see the top prediction "
                "and a SHAP chart showing which soil/climate feature drove the recommendation._"
            )
            with gr.Row():
                with gr.Column(scale=1):
                    s1 = make_sliders()
                    b1 = gr.Button("Recommend Crop", variant="primary")
                with gr.Column(scale=2):
                    o1        = gr.Label(num_top_classes=5, label="Top Crop Recommendations")
                    shap_plot = gr.Plot(label="SHAP Feature Contributions")
                    expl_out  = gr.Markdown(label="Why this crop?")
            b1.click(fn=shap_explain, inputs=s1, outputs=[o1, shap_plot, expl_out])

           

        # Tab 2 — evaluation charts
        with gr.Tab("Evaluation"):
            # Metrics table
            metrics_md = "### Model Performance Metrics (Weighted Average on Test Set)\n\n"
            metrics_md += "| Metric | " + " | ".join(k.upper() for k in MODEL_KEYS) + " |\n"
            metrics_md += "|---|" + "|".join("---" for _ in MODEL_KEYS) + "|\n"
            for metric in ["accuracy", "precision", "recall", "f1"]:
                row = f"| **{metric.capitalize()}** |"
                for k in MODEL_KEYS:
                    val = model_metrics[k][metric]
                    row += f" {val:.4f} ({val:.2%}) |"
                metrics_md += row + "\n"
            gr.Markdown(metrics_md)
            with gr.Row():
                for key in MODEL_KEYS:
                    p = cm_paths[key]
                    if Path(p).exists():
                        gr.Image(p, label=f"{key.upper()} Confusion Matrix")
                    else:
                        gr.Markdown(f"_Run train.py to generate the {key.upper()} confusion matrix._")

demo.launch(inbrowser=True, theme=gr.themes.Soft())
