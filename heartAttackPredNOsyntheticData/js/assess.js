const toggleState = {};

/* ── Toggle buttons ── */
function toggleBtn(el) {
  el.classList.toggle('active');
  toggleState[el.dataset.key] = el.classList.contains('active') ? 1 : 0;
  markSectionProgress();
}

/* ── Read numeric inputs ── */
function numVal(id) {
  const v = document.getElementById(id).value;
  return v === '' ? null : parseFloat(v);
}

function getApiUrl() {
    const el = document.getElementById('api-url');
    const inputVal = el ? el.value.trim().replace(/\/$/, '') : '';
    return inputVal || "https://heart-attack-risk-women.onrender.com";
}

/* ── Sidebar progress tracking ── */
function markSectionProgress() {
  const sectionMap = {
    'basic': ['age', 'bmi'],
    'blood': ['systolic', 'hdl', 'triglycerides', 'fasting_glucose'],
    'medical': ['diabetes','hypertension','high_cholesterol','depression','kidney_disease','arthritis','thyroid_problem','prediabetes'],
    'womens': ['menopause','hysterectomy','ovaries_removed','gestational_diabetes_proxy','pregnancy_hypertension_proxy'],
    'lifestyle': ['smoking','current_smoker','physical_activity','poor_mental_days'],
  };

  document.querySelectorAll('.progress-step').forEach(step => {
    const section = step.dataset.section;
    const fields = sectionMap[section] || [];
    const hasValue = fields.some(f => {
      const el = document.getElementById(f);
      if (el) return el.value !== '';
      return toggleState[f] !== undefined;
    });
    if (hasValue) {
      step.classList.add('done');
      step.classList.remove('active');
      step.querySelector('.ps-icon').innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.5 6.5L5.5 9.5L10.5 4" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
  });
}

document.querySelectorAll('.form-input').forEach(el => {
  el.addEventListener('input', markSectionProgress);
});

/* ── BMI calculator ──
   Pure arithmetic done in the browser (BMI = weight/height²), purely to
   populate the #bmi field for the user's convenience. This is NOT prediction
   logic — it never touches risk scoring, which still only ever comes from
   the backend model's /predict response. ── */
let bmiUnitMode = 'metric';

function toggleBmiCalc() {
  const body = document.getElementById('bmi-calc-body');
  const caret = document.getElementById('bmi-calc-caret');
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  caret.textContent = isOpen ? '▾' : '▴';
}

function setBmiUnits(mode) {
  bmiUnitMode = mode;
  document.getElementById('unit-metric').classList.toggle('active', mode === 'metric');
  document.getElementById('unit-imperial').classList.toggle('active', mode === 'imperial');
  document.getElementById('bmi-metric-fields').style.display = mode === 'metric' ? 'grid' : 'none';
  document.getElementById('bmi-imperial-fields').style.display = mode === 'imperial' ? 'grid' : 'none';
  calcBmi();
}

function calcBmi() {
  const resultEl = document.getElementById('bmi-calc-result');
  let heightM = null;
  let weightKg = null;

  if (bmiUnitMode === 'metric') {
    const cm = numVal('height_cm');
    const kg = numVal('weight_kg');
    if (cm && kg) {
      heightM = cm / 100;
      weightKg = kg;
    }
  } else {
    const ft = numVal('height_ft');
    const inch = numVal('height_in') || 0;
    const lb = numVal('weight_lb');
    if (ft && lb) {
      heightM = ((ft * 12) + inch) * 0.0254;
      weightKg = lb * 0.453592;
    }
  }

  if (!heightM || !weightKg || heightM <= 0) {
    resultEl.textContent = 'Enter height and weight to calculate BMI.';
    resultEl.classList.remove('ready');
    return;
  }

  const bmi = weightKg / (heightM * heightM);
  const bmiField = document.getElementById('bmi');
  bmiField.value = bmi.toFixed(1);
  bmiField.dispatchEvent(new Event('input')); // keep progress tracker in sync

  let category = 'Healthy weight';
  if (bmi < 18.5) category = 'Underweight';
  else if (bmi >= 25 && bmi < 30) category = 'Overweight';
  else if (bmi >= 30) category = 'Obese';

  resultEl.textContent = `Calculated BMI: ${bmi.toFixed(1)} kg/m² (${category}) — filled in above.`;
  resultEl.classList.add('ready');
  clearFieldError('bmi');
}

/* ── Input validation ──
   Mirrors the ranges enforced server-side in app.py's NUMERIC_RANGES. This
   is a UX convenience only — the backend re-checks everything regardless,
   so this never becomes the source of truth for what's "valid". ── */
const VALIDATION_RANGES = {
  age:              { min: 18,  max: 99,   label: 'age' },
  bmi:              { min: 14,  max: 70,   label: 'BMI' },
  waist_hip:        { min: 0.5, max: 1.5,  label: 'waist-to-hip ratio' },
  systolic:         { min: 80,  max: 220,  label: 'systolic BP' },
  hdl:              { min: 10,  max: 120,  label: 'HDL cholesterol' },
  triglycerides:    { min: 20,  max: 1000, label: 'triglycerides' },
  fasting_glucose:  { min: 50,  max: 500,  label: 'fasting glucose' },
  poor_mental_days: { min: 0,   max: 30,   label: 'poor mental health days' },
};

function clearFieldError(id) {
  const input = document.getElementById(id);
  const err = document.getElementById('err-' + id);
  if (input) input.classList.remove('has-error');
  if (err) err.classList.remove('show');
}

function setFieldError(id, message) {
  const input = document.getElementById(id);
  const err = document.getElementById('err-' + id);
  if (input) input.classList.add('has-error');
  if (err) {
    if (message) err.textContent = message;
    err.classList.add('show');
  }
}

/* Returns true if every filled-in field is within range; false and shows
   inline errors otherwise. Empty fields are allowed (all fields optional). */
function validateInputs() {
  let allValid = true;
  let firstInvalidId = null;

  for (const id in VALIDATION_RANGES) {
    const el = document.getElementById(id);
    if (!el) continue;
    clearFieldError(id);

    if (el.value === '') continue; // optional field left blank — fine

    const { min, max, label } = VALIDATION_RANGES[id];
    const value = parseFloat(el.value);

    if (isNaN(value) || !isFinite(value)) {
      setFieldError(id, `Enter a valid number for ${label}.`);
      allValid = false;
      if (!firstInvalidId) firstInvalidId = id;
      continue;
    }

    if (value < min || value > max) {
      setFieldError(id, `${label[0].toUpperCase() + label.slice(1)} must be between ${min} and ${max}.`);
      allValid = false;
      if (!firstInvalidId) firstInvalidId = id;
    }
  }

  if (!allValid && firstInvalidId) {
    document.getElementById(firstInvalidId).scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return allValid;
}

function scrollToSection(name) {
  const el = document.getElementById('section-' + name);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── Main predict function ──
   Risk is always determined by calling the trained model's /predict
   endpoint (a Random Forest served via the Flask API in scripts/app.py).
   There is no local if/else scoring fallback: if the model can't be
   reached, we tell the user that plainly instead of guessing. ── */
async function runAssessment() {
  if (!validateInputs()) {
    return; // inline errors are already shown; don't call the API with bad data
  }

  const btn = document.getElementById('submit-btn');
  const spinner = document.getElementById('spinner');
  const label = document.getElementById('btn-label');

  btn.disabled = true;
  spinner.style.display = 'block';
  label.textContent = 'Analyzing…';

  const inputs = {
    age:             numVal('age'),
    bmi:             numVal('bmi'),
    waist_hip_ratio: numVal('waist_hip'),
    systolic_bp:     numVal('systolic'),
    hdl_cholesterol: numVal('hdl'),
    triglycerides:   numVal('triglycerides'),
    fasting_glucose: numVal('fasting_glucose'),
    poor_mental_days: numVal('poor_mental_days'),
    source_dataset:  'BRFSS',
    ...toggleState,
  };

  const apiUrl = getApiUrl();

  const resetButton = () => {
    btn.disabled = false;
    spinner.style.display = 'none';
    label.textContent = 'Get my risk score';
  };

  if (!apiUrl) {
    resetButton();
    renderModelUnavailable('No model API URL is configured, so no prediction can be made.');
    return;
  }

  try {
    const res = await fetch(apiUrl + '/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || ('Model API responded with ' + res.status));
    }

    const data = await res.json();
    resetButton();
    // Pass the dynamic threshold from the API (with a fallback of 0.025 just in case)
    renderResult(data.probability, data.top_factors || [], data.threshold || 0.025);
  } catch (err) {
    console.warn('Model API error:', err.message);
    resetButton();
    renderModelUnavailable(err.message);
  }
}

/* ── Render result ── */
function renderResult(probability, factors, threshold = 0.025) {
  const isHigh = probability >= threshold;
  const pct    = Math.round(probability * 100);

  // Header
  const header = document.getElementById('r-header');
  header.className = 'result-card-header ' + (isHigh ? 'high' : 'low');

  const icon = document.getElementById('r-icon');
  icon.className = 'result-icon-wrap ' + (isHigh ? 'high' : 'low');
  icon.innerHTML = isHigh
    ? `<svg width="30" height="30" viewBox="0 0 30 30" fill="none"><path d="M15 27L5 17L5 11C5 8.239 7.239 6 10 6C11.789 6 13.368 6.945 14.25 8.373C14.617 8.966 15.383 8.966 15.75 8.373C16.632 6.945 18.211 6 20 6C22.761 6 25 8.239 25 11V17L15 27Z" fill="white" stroke="white" stroke-width="1.5" stroke-linejoin="round"/><path d="M15 12v6M12 15h6" stroke="#E8354A" stroke-width="2" stroke-linecap="round"/></svg>`
    : `<svg width="30" height="30" viewBox="0 0 30 30" fill="none"><path d="M15 27C15 27 4 20 4 12C4 8.686 6.686 6 10 6C11.789 6 13.368 6.945 14.25 8.373C14.617 8.966 15.383 8.966 15.75 8.373C16.632 6.945 18.211 6 20 6C23.314 6 26 8.686 26 12C26 20 15 27 15 27Z" fill="white" stroke="white" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 14.5l3.5 3.5L21 10" stroke="#1A7A4A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  document.getElementById('r-title').className = 'result-verdict-title ' + (isHigh ? 'high' : 'low');
  document.getElementById('r-title').textContent = isHigh ? 'Higher risk detected' : 'Lower risk estimated';
  document.getElementById('r-sub').textContent = isHigh
    ? 'Your profile includes several factors associated with elevated heart attack risk. Consider speaking with your cardiologist.'
    : 'Your profile suggests a relatively lower risk. Continue monitoring and maintaining healthy habits.';

  document.getElementById('r-score').textContent = probability.toFixed(2);
  document.getElementById('r-source').innerHTML = `<span class="source-tag api-source">Live model</span>`;

  // Bar
  const bar = document.getElementById('r-bar');
  bar.style.width = pct + '%';
  bar.className = 'risk-bar-fill ' + (isHigh ? 'high' : 'low');

  // Dynamic Threshold Marker Positioning & Labeling
  const thresholdLine = document.getElementById('r-threshold');
  if (thresholdLine) {
    const thresholdPct = threshold * 100;
    thresholdLine.style.setProperty('--pos', thresholdPct + '%');
    
    // Position the pseudo-elements via inline style or direct manipulation
    const beforeEl = thresholdLine.querySelector('::before'); // Handled via css variable trick or inline styling below:
    thresholdLine.style.cssText = `
      --threshold-pos: ${thresholdPct}%;
    `;
  }

  // Factors
  const factorsEl = document.getElementById('r-factors');
  if (factors && factors.length) {
    factorsEl.innerHTML = factors.map(f => {
      const risk = f.direction === 'increases';
      return `
      <div class="factor-chip ${risk ? 'risk' : 'ok'}">
        ${risk
          ? `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.4"/><path d="M4.5 4.5l4 4M8.5 4.5l-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`
          : `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.4"/><path d="M4 6.5l2 2 3.5-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        }
        ${f.label}
      </div>
    `;
    }).join('');
  } else {
    factorsEl.innerHTML = `<p style="font-size:13px;color:var(--ink-4);grid-column:1/-1">The model didn't return a factor breakdown for this request.</p>`;
  }

  // Next steps
  const nextSteps = document.getElementById('r-nextsteps');
  if (isHigh) {
    nextSteps.innerHTML = `
      <h4>Recommended next steps</h4>
      <div class="next-step-item">Schedule a cardiovascular risk consultation with your doctor</div>
      <div class="next-step-item">Ask about a lipid panel, fasting glucose, and blood pressure workup</div>
      <div class="next-step-item">Discuss your hormonal and reproductive history with your cardiologist</div>
      <div class="next-step-item">Review your diet, activity level, and smoking status</div>
    `;
  } else {
    nextSteps.innerHTML = `
      <h4>Keeping your risk low</h4>
      <div class="next-step-item">Continue regular physical activity (150 min/week of moderate exercise)</div>
      <div class="next-step-item">Get routine bloodwork — lipids and glucose — at your annual checkup</div>
      <div class="next-step-item">Maintain a heart-healthy diet and healthy weight</div>
      <div class="next-step-item">Be aware of menopause-related risk changes as you age</div>
    `;
  }

  // Show result
  const panel = document.getElementById('result-panel');
  panel.className = 'result-panel show';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── Model-unavailable state ──
   Shown when the model API can't be reached — we never substitute a
   guessed score, we just say so clearly. ── */
function renderModelUnavailable(message) {
  const header = document.getElementById('r-header');
  header.className = 'result-card-header error';

  const icon = document.getElementById('r-icon');
  icon.className = 'result-icon-wrap error';
  icon.innerHTML = `<svg width="30" height="30" viewBox="0 0 30 30" fill="none"><circle cx="15" cy="15" r="12" stroke="white" stroke-width="2"/><path d="M15 9v7M15 20v.5" stroke="white" stroke-width="2.2" stroke-linecap="round"/></svg>`;

  document.getElementById('r-title').className = 'result-verdict-title error';
  document.getElementById('r-title').textContent = 'Model unavailable';
  document.getElementById('r-sub').textContent =
    'The trained model couldn\'t be reached, so no risk score can be shown. ' +
    (message ? 'Details: ' + message : '') +
    ' Make sure the Flask API (scripts/app.py) is running and the API URL is correct, then try again.';

  document.getElementById('r-score').textContent = '—';
  document.getElementById('r-source').innerHTML = `<span class="source-tag local-source">No prediction</span>`;

  const bar = document.getElementById('r-bar');
  bar.style.width = '0%';
  bar.className = 'risk-bar-fill';

  document.getElementById('r-factors').innerHTML =
    `<p style="font-size:13px;color:var(--ink-4);grid-column:1/-1">No factors to show — the model did not return a prediction.</p>`;
  document.getElementById('r-nextsteps').innerHTML = '';

  const panel = document.getElementById('result-panel');
  panel.className = 'result-panel show';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── Reset ── */
function resetForm() {
  document.getElementById('result-panel').className = 'result-panel';
  document.querySelectorAll('.form-input').forEach(el => el.value = '');
  document.querySelectorAll('.toggle-btn').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.form-input.has-error').forEach(el => el.classList.remove('has-error'));
  document.querySelectorAll('.field-error.show').forEach(el => el.classList.remove('show'));
  Object.keys(toggleState).forEach(k => delete toggleState[k]);
  const bmiResult = document.getElementById('bmi-calc-result');
  if (bmiResult) {
    bmiResult.textContent = 'Enter height and weight to calculate BMI.';
    bmiResult.classList.remove('ready');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
