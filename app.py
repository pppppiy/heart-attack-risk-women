from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import numpy as np
import pandas as pd
import os

app = Flask(__name__)
_origins = os.environ.get("ALLOWED_ORIGINS", "*")
CORS(app, origins=[o.strip() for o in _origins.split(",")] if _origins != "*" else "*")

BASE = os.path.dirname(os.path.abspath(__file__))

try:
    model         = joblib.load(os.path.join(BASE, "random_forest_women_heart_attack_model.pkl"))
    preprocessor  = joblib.load(os.path.join(BASE, "preprocessor.pkl"))
    feature_names = joblib.load(os.path.join(BASE, "feature_columns.pkl"))
except Exception as e:
    raise RuntimeError(
        "Failed to load model files. This is usually a scikit-learn/xgboost "
        "version mismatch between training and runtime, OR the v3 files "
        "weren't renamed to match these exact filenames. "
        f"Original error: {e}"
    )


try:
    THRESHOLD = joblib.load(os.path.join(BASE, "recommended_threshold.pkl"))
except Exception:
    THRESHOLD = 0.025  # from the last training run's PR-curve optimum
    print("⚠️  recommended_threshold.pkl not found — using the last known "
          "value (0.025). Re-run training and save this file to keep it exact.")

print(f"✅ Model loaded. Expects {len(feature_names)} features. Threshold={THRESHOLD}")

# ── Input validation ──────────────────────────────────────────────────────────
# Only fields the FRONTEND actually collects from the user go here. Derived/
# interaction features (pulse_pressure, obese, age_hypertension, etc.) are
# computed server-side in build_patient_df — never collected directly.
NUMERIC_RANGES = {
    "age":              (18, 99,   "years"),
    "bmi":              (14, 70,   "kg/m2"),
    "waist_hip_ratio":  (0.5, 1.5, "ratio"),
    "systolic_bp":      (80, 220,  "mmHg"),
    "diastolic_bp":     (40, 140,  "mmHg"),
    "hdl_cholesterol":  (10, 120,  "mg/dL"),
    "triglycerides":    (20, 1000, "mg/dL"),
    "fasting_glucose":  (50, 500,  "mg/dL"),
    "income_ratio":     (0, 5,     "ratio-to-poverty-line"),
    "education":        (1, 5,    "NHANES education code"),
}

BINARY_FIELDS = [
    "diabetes", "prediabetes", "hypertension", "high_cholesterol",
    "kidney_disease", "arthritis", "thyroid_problem",
    "current_smoker", "smoking", "menopause", "hysterectomy", "ovaries_removed",
]


def validate_input(data: dict) -> list:
    errors = []
    for field, (lo, hi, unit) in NUMERIC_RANGES.items():
        if field not in data or data[field] is None or data[field] == "":
            continue
        try:
            value = float(data[field])
        except (TypeError, ValueError):
            errors.append(f"'{field}' must be a number.")
            continue
        if not np.isfinite(value):
            errors.append(f"'{field}' must be a finite number.")
            continue
        if value < lo or value > hi:
            errors.append(f"'{field}' must be between {lo} and {hi} {unit} (got {value}).")

    for field in BINARY_FIELDS:
        if field not in data or data[field] is None:
            continue
        try:
            value = int(data[field])
        except (TypeError, ValueError):
            errors.append(f"'{field}' must be 0 or 1.")
            continue
        if value not in (0, 1):
            errors.append(f"'{field}' must be 0 or 1 (got {value}).")

    return errors

# ── Explainability ────────────────────────────────────────────────────────────
# `model` is now a CalibratedClassifierCV wrapping an XGBClassifier — SHAP's
# TreeExplainer can't be pointed at the calibration wrapper directly. We pull
# out one of the underlying fitted XGBoost estimators (from the internal CV
# folds) and explain with that instead. This is an approximation: the
# explanation reflects the RAW (uncalibrated) model's decision structure,
# while the probability shown to the user is the calibrated one. In practice
# calibration reshapes probabilities, not which features drive a prediction,
# so this is a reasonable and standard compromise — but worth stating
# explicitly in your write-up as a limitation.
try:
    import shap
    base_estimator = model.calibrated_classifiers_[0].estimator
    explainer = shap.TreeExplainer(base_estimator)
    TRANSFORMED_FEATURE_NAMES = list(preprocessor.get_feature_names_out())
    SHAP_AVAILABLE = True
    print("✅ SHAP explainer ready (using underlying XGBoost estimator).")
except Exception as e:
    explainer = None
    TRANSFORMED_FEATURE_NAMES = []
    SHAP_AVAILABLE = False
    print(f"⚠️  SHAP explainability unavailable ({e}). Predictions will still work, "
          f"but responses won't include a factor breakdown.")

FEATURE_LABELS = {
    "age": "Age",
    "bmi": "BMI",
    "waist_hip_ratio": "Waist-to-hip ratio",
    "systolic_bp": "Systolic blood pressure",
    "diastolic_bp": "Diastolic blood pressure",
    "pulse_pressure": "Pulse pressure (systolic − diastolic)",
    "hdl_cholesterol": "HDL cholesterol",
    "triglycerides": "Triglycerides",
    "fasting_glucose": "Fasting glucose",
    "income_ratio": "Income-to-poverty ratio",
    "education": "Education level",
    "diabetes": "Diabetes",
    "prediabetes": "Prediabetes",
    "hypertension": "Hypertension",
    "high_cholesterol": "High cholesterol",
    "kidney_disease": "Kidney disease",
    "arthritis": "Arthritis",
    "thyroid_problem": "Thyroid condition",
    "current_smoker": "Current smoker",
    "smoking": "Smoking history",
    "menopause": "Post-menopause",
    "hysterectomy": "Hysterectomy",
    "ovaries_removed": "Ovaries removed",
    "obese": "Obesity (BMI ≥ 30)",
    "diabetes_obesity": "Diabetes + obesity combination",
    "smoking_hypertension": "Smoking + hypertension combination",
    "age_hypertension": "Age × hypertension interaction",
    "metabolic_syndrome_proxy": "Metabolic syndrome risk count",
}


def strip_prefix(transformed_name: str) -> str:
    return transformed_name.split("__", 1)[1] if "__" in transformed_name else transformed_name


def explain_prediction(processed_row, raw_row: pd.Series, top_n: int = 6):
    if not SHAP_AVAILABLE:
        return []

    shap_values = explainer.shap_values(processed_row)

    # XGBoost binary classifiers return a single array of shape (1, n_features)
    # rather than RandomForest's (1, n_features, n_classes) — handle both.
    if isinstance(shap_values, list):
        contributions = shap_values[1][0]
    elif shap_values.ndim == 3:
        contributions = shap_values[0, :, 1]
    else:
        contributions = shap_values[0]

    ranked = sorted(
        zip(TRANSFORMED_FEATURE_NAMES, contributions),
        key=lambda kv: abs(kv[1]),
        reverse=True,
    )

    factors = []
    for name, contrib in ranked:
        base = strip_prefix(name)
        if base not in FEATURE_LABELS:
            continue
        if abs(contrib) < 0.002:
            continue

        value = raw_row.get(base)
        if isinstance(value, (np.floating, np.integer)):
            value = value.item()
        if isinstance(value, float) and np.isnan(value):
            value = None

        factors.append({
            "feature": base,
            "label": FEATURE_LABELS[base],
            "value": value,
            "impact": round(float(contrib), 4),
            "direction": "increases" if contrib > 0 else "decreases",
        })
        if len(factors) >= top_n:
            break

    return factors


# ── Helper ────────────────────────────────────────────────────────────────────
def build_patient_df(data: dict) -> pd.DataFrame:
    row = {col: np.nan for col in feature_names}

    numeric_direct = [
        "age", "bmi", "waist_hip_ratio", "systolic_bp", "diastolic_bp",
        "hdl_cholesterol", "triglycerides", "fasting_glucose",
        "income_ratio", "education",
    ]
    for field in numeric_direct:
        if field in data and data[field] is not None:
            row[field] = float(data[field])

    binary_direct = [
        "diabetes", "prediabetes", "hypertension", "high_cholesterol",
        "kidney_disease", "arthritis", "thyroid_problem",
        "current_smoker", "smoking", "menopause", "hysterectomy", "ovaries_removed",
    ]
    for field in binary_direct:
        if field in data and data[field] is not None:
            row[field] = int(data[field])

    def as_binary(value) -> int:
        if value is None or (isinstance(value, float) and np.isnan(value)):
            return 0
        return int(value)

    # Derived numeric
    sbp = row.get("systolic_bp", np.nan)
    dbp = row.get("diastolic_bp", np.nan)
    if not (isinstance(sbp, float) and np.isnan(sbp)) and not (isinstance(dbp, float) and np.isnan(dbp)):
        row["pulse_pressure"] = sbp - dbp

    bmi = row.get("bmi", np.nan)
    if not (isinstance(bmi, float) and np.isnan(bmi)):
        row["obese"] = int(float(bmi) >= 30)

    dia = as_binary(row.get("diabetes"))
    ob  = as_binary(row.get("obese"))
    row["diabetes_obesity"] = dia * ob

    smk = as_binary(row.get("smoking"))
    htn = as_binary(row.get("hypertension"))
    row["smoking_hypertension"] = smk * htn

    age = row.get("age", np.nan)
    if not (isinstance(age, float) and np.isnan(age)):
        row["age_hypertension"] = float(age) * htn

    chol = as_binary(row.get("high_cholesterol"))
    row["metabolic_syndrome_proxy"] = ob + htn + dia + chol

    return pd.DataFrame([row])


# ── Routes ────────────────────────────────────────────────────────────────────
@app.route("/", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "model": "women_heart_attack_xgb_v3",
        "features": len(feature_names),
        "threshold": THRESHOLD,
    })


@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({"error": "No JSON body received"}), 400

        validation_errors = validate_input(data)
        if validation_errors:
            return jsonify({"error": "Invalid input", "details": validation_errors}), 400

        patient_df  = build_patient_df(data)
        processed   = preprocessor.transform(patient_df)
        probability = float(model.predict_proba(processed)[0][1])
        prediction  = "high_risk" if probability >= THRESHOLD else "low_risk"

        try:
            top_factors = explain_prediction(processed, patient_df.iloc[0])
        except Exception as shap_err:
            print(f"⚠️  SHAP explanation failed for this request: {shap_err}")
            top_factors = []

        return jsonify({
            "probability": round(probability, 4),
            "prediction":  prediction,
            "threshold":   THRESHOLD,
            "high_risk":   probability >= THRESHOLD,
            "top_factors": top_factors,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/features", methods=["GET"])
def features():
    return jsonify({"features": feature_names})


@app.route("/ranges", methods=["GET"])
def ranges():
    return jsonify({
        "numeric": {k: {"min": v[0], "max": v[1], "unit": v[2]} for k, v in NUMERIC_RANGES.items()},
        "binary_fields": BINARY_FIELDS,
    })


if __name__ == "__main__":
    # Local development only. In production Render runs: gunicorn app:app
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
