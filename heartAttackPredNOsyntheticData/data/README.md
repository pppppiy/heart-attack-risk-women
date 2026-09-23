# Data folder

The raw NHANES (.xpt) and BRFSS (.XPT) files used to TRAIN the model are not
included in this deployment package — they total ~1.2GB and are only needed
if you want to retrain the model from scratch in your Colab notebook.

To run the working app (frontend + API), you only need:
  - random_forest_women_heart_attack_model.pkl
  - preprocessor.pkl
  - feature_columns.pkl

These three files are already included in the project root.

If you need to retrain, re-download NHANES/BRFSS data into this folder
matching the original structure:
  data/nhanes/DEMO_L.xpt, RHQ_L.xpt, MCQ_L.xpt, BMX_L.xpt,
              HDL_L.xpt, TRIGLY_L.xpt, GLU_L.xpt, BPXO_L.xpt
  data/brfss/LLCP2023.XPT
