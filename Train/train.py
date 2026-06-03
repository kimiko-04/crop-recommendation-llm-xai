"""
Crop Recommendation — Training Script
Run once to train and save both models.  After this, use app.py for the UI.
"""

import json
import numpy as np
import pandas as pd
import torch
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.metrics import confusion_matrix, classification_report, precision_recall_fscore_support
from datasets import Dataset, DatasetDict
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
    EarlyStoppingCallback,
)

# ── Config ─────────────────────────────────────────────────────────────────────
ROOT       = Path(__file__).resolve().parent.parent
DATA_PATH  = ROOT / "Crop_recommendation.csv"
MODELS_DIR = ROOT / "saved_models"
MAX_LENGTH = 128
BATCH_SIZE = 8
EPOCHS     = 8
LR         = 5e-5
SEED       = 42

DEVICE   = "cuda" if torch.cuda.is_available() else "cpu"
USE_FP16 = torch.cuda.is_available()

CHECKPOINTS = {
    "distilbert": "distilbert-base-uncased",
    "bert":       "bert-base-uncased",
}

print(f"Device : {DEVICE}  |  FP16: {USE_FP16}")
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# ── Data ───────────────────────────────────────────────────────────────────────
df = pd.read_csv(DATA_PATH)

labels   = sorted(df["label"].unique())
label2id = {lbl: i for i, lbl in enumerate(labels)}
id2label = {i: lbl for i, lbl in enumerate(labels)}

df["label"] = df["label"].map(label2id)

train_df, test_df = train_test_split(
    df, test_size=0.2, random_state=SEED, stratify=df["label"]
)

# Compute stats from training data only 
stats = train_df.describe().loc["mean"]
print(f"Stats computed from training set only ({len(train_df)} rows)")


def create_text(row):
    n_desc    = "high"  if row["N"]           > stats["N"]           else "low"
    p_desc    = "high"  if row["P"]           > stats["P"]           else "low"
    k_desc    = "high"  if row["K"]           > stats["K"]           else "low"
    temp_desc = "warm"  if row["temperature"] > 25                   else "cool"
    hum_desc  = "humid" if row["humidity"]    > stats["humidity"]    else "dry"
    rain_desc = "heavy" if row["rainfall"]    > stats["rainfall"]    else "moderate"
    return (
        f"Field Profile: The soil has a Nitrogen level of {row['N']} ({n_desc}), "
        f"Phosphorus at {row['P']} ({p_desc}), and Potassium at {row['K']} ({k_desc}) "
        f"with a pH balance of {row['ph']:.2f}. "
        f"Weather Context: The temperature is {temp_desc} at {row['temperature']:.1f}°C, "
        f"humidity is {hum_desc} at {row['humidity']:.1f}%, and "
        f"the area receives {rain_desc} rainfall of {row['rainfall']:.1f}mm."
    )



train_df = train_df.copy()
test_df  = test_df.copy()
train_df["text"] = train_df.apply(create_text, axis=1)
test_df["text"]  = test_df.apply(create_text, axis=1)

dataset = DatasetDict({
    "train": Dataset.from_pandas(train_df, preserve_index=False),
    "test":  Dataset.from_pandas(test_df,  preserve_index=False),
})

print(f"Train: {len(dataset['train'])}  |  Test: {len(dataset['test'])}")
print(f"Classes ({len(labels)}): {labels}\n")


feature_cols = ["N", "P", "K", "temperature", "humidity", "ph", "rainfall"]
(MODELS_DIR / "stats.json").write_text(json.dumps(stats[feature_cols].to_dict()))
(MODELS_DIR / "label_map.json").write_text(
    json.dumps({
        "label2id": label2id,
        "id2label": {str(k): v for k, v in id2label.items()},
        "labels":   labels,
    })
)

# ── Training ───────────────────────────────────────────────────────────────────
def compute_metrics(eval_pred):
    logits, true_labels = eval_pred
    preds = np.argmax(logits, axis=-1)
    return {"accuracy": float((preds == true_labels).mean())}


def train_model(key, checkpoint):
    save_dir = MODELS_DIR / key

    if (save_dir / "config.json").exists():
        print(f"[{key}] Already trained — skipping. Delete {save_dir} to retrain.")
        return

    print(f"\n── Training {key} ({checkpoint}) ──────────────────────────────")
    tokenizer = AutoTokenizer.from_pretrained(checkpoint)

    tok_ds = dataset.map(
        lambda b: tokenizer(b["text"], truncation=True, padding="max_length", max_length=MAX_LENGTH),
        batched=True,
    )

    model = AutoModelForSequenceClassification.from_pretrained(
        checkpoint, num_labels=len(labels), label2id=label2id, id2label=id2label,
    )

    args = TrainingArguments(
        output_dir=str(save_dir / "checkpoints"),
        eval_strategy="epoch",
        save_strategy="epoch",
        learning_rate=LR,
        per_device_train_batch_size=BATCH_SIZE,
        num_train_epochs=EPOCHS,
        weight_decay=0.01,
        warmup_ratio=0.1,
        logging_steps=10,
        load_best_model_at_end=True,
        metric_for_best_model="accuracy",
        greater_is_better=True,
        fp16=USE_FP16,
        report_to="none",
        seed=SEED,
    )

    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=tok_ds["train"],
        eval_dataset=tok_ds["test"],
        compute_metrics=compute_metrics,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=3)],
    )

    trainer.train()
    trainer.save_model(str(save_dir))
    tokenizer.save_pretrained(str(save_dir))

    acc = max((h.get("eval_accuracy", 0) for h in trainer.state.log_history), default=0.0)
    (save_dir / "meta.json").write_text(json.dumps({"accuracy": acc}))
    print(f"[{key}] Saved to {save_dir}  |  Best accuracy: {acc:.4f}")


for key, ckpt in CHECKPOINTS.items():
    train_model(key, ckpt)

# ── Evaluation ─────────────────────────────────────────────────────────────────
print("\n── Evaluation ──────────────────────────────────────────────────────")

model_accuracies = {}
for key in CHECKPOINTS:
    save_dir  = MODELS_DIR / key
    tokenizer = AutoTokenizer.from_pretrained(save_dir)
    model     = AutoModelForSequenceClassification.from_pretrained(save_dir).to(DEVICE).eval()

    preds = []
    for item in dataset["test"]:
        inputs = tokenizer(
            item["text"], return_tensors="pt",
            truncation=True, padding="max_length", max_length=MAX_LENGTH,
        ).to(DEVICE)
        with torch.no_grad():
            preds.append(int(torch.argmax(model(**inputs).logits, dim=-1).item()))

    y_true = list(dataset["test"]["label"])
    acc    = (np.array(preds) == np.array(y_true)).mean()
    model_accuracies[key] = float(acc)

    print(f"\n── {key.upper()} Classification Report ──")
    print(classification_report(y_true, preds, target_names=labels))

    # Compute weighted-average precision, recall, F1
    prec, rec, f1, _ = precision_recall_fscore_support(
        y_true, preds, average="weighted", zero_division=0
    )

    # Save all metrics so app.py can display them
    (save_dir / "meta.json").write_text(json.dumps({
        "accuracy":  float(acc),
        "precision": float(prec),
        "recall":    float(rec),
        "f1":        float(f1),
    }))

    fig, ax = plt.subplots(figsize=(14, 11))
    sns.heatmap(confusion_matrix(y_true, preds), annot=True, fmt="d",
                cmap="YlGnBu", xticklabels=labels, yticklabels=labels, ax=ax)
    ax.set_title(f"{key.upper()} Confusion Matrix  (acc {acc:.4f})")
    ax.set_xlabel("Predicted"); ax.set_ylabel("Actual")
    fig.tight_layout()
    fig.savefig(MODELS_DIR / f"cm_{key}.png", dpi=100)
    plt.close(fig)
    print(f"[{key}] Accuracy: {acc:.4f} | Precision: {prec:.4f} | Recall: {rec:.4f} | F1: {f1:.4f}")
    print(f"[{key}] Metrics and confusion matrix saved.")

best = max(model_accuracies, key=model_accuracies.get)
print(f"\n\U0001f3c6 Best model: {best.upper()}  (accuracy {model_accuracies[best]:.4f})")
print("\nTraining complete. Run app.py to launch the Gradio interface.")
