import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
import os
import pickle

# -----------------------------
# 1️⃣ Textualization Function
# -----------------------------

def textualize_row(row):
    """
    Convert numerical soil features into descriptive sentence.
    """

    sentence = (
        f"The soil contains {row['N']} kg per hectare of nitrogen, "
        f"{row['P']} kg per hectare of phosphorus, "
        f"and {row['K']} kg per hectare of potassium. "
        f"The soil pH level is {row['ph']}. "
        f"The temperature is {row['temperature']} degrees Celsius, "
        f"with humidity at {row['humidity']} percent. "
        f"The rainfall is {row['rainfall']} millimeters. "
        f"Based on these environmental conditions, the most suitable crop is:"
    )

    return sentence


# -----------------------------
# 2️⃣ Load Dataset
# -----------------------------

def load_dataset(csv_path):
    """
    Load crop recommendation dataset
    """
    df = pd.read_csv(csv_path)
    return df


# -----------------------------
# 3️⃣ Apply Textualization
# -----------------------------

def apply_textualization(df):
    """
    Apply textualization to entire dataframe
    """
    df["text"] = df.apply(textualize_row, axis=1)
    return df


# -----------------------------
# 4️⃣ Encode Labels
# -----------------------------

def encode_labels(df, save_path="models/label_encoder.pkl"):
    """
    Encode crop labels into integers
    """

    label_encoder = LabelEncoder()
    df["label_encoded"] = label_encoder.fit_transform(df["label"])

    # Save label encoder
    os.makedirs("models", exist_ok=True)
    with open(save_path, "wb") as f:
        pickle.dump(label_encoder, f)

    return df, label_encoder


# -----------------------------
# 5️⃣ Train-Test Split
# -----------------------------

def split_dataset(df, test_size=0.2, random_state=42):
    """
    Split dataset into train and validation sets
    """

    X = df["text"]
    y = df["label_encoded"]

    X_train, X_val, y_train, y_val = train_test_split(
        X, y,
        test_size=test_size,
        random_state=random_state,
        stratify=y
    )

    return X_train, X_val, y_train, y_val


# -----------------------------
# 6️⃣ Main Preprocessing Pipeline
# -----------------------------

def preprocess_pipeline(csv_path):
    """
    Full preprocessing pipeline
    """

    print("Loading dataset...")
    df = load_dataset(csv_path)

    print("Applying textualization...")
    df = apply_textualization(df)

    print("Encoding labels...")
    df, label_encoder = encode_labels(df)

    print("Splitting dataset...")
    X_train, X_val, y_train, y_val = split_dataset(df)

    print("Preprocessing completed.")

    return X_train, X_val, y_train, y_val, label_encoder


# -----------------------------
# 7️⃣ Run Standalone Test
# -----------------------------

if __name__ == "__main__":

    csv_path = "data/Crop_recommendation.csv"

    X_train, X_val, y_train, y_val, label_encoder = preprocess_pipeline(csv_path)

    print("\nSample Text Example:\n")
    print(X_train.iloc[0])
    print("\nEncoded Label:", y_train.iloc[0])