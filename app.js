const STORAGE_KEY = 'mc_decision_state_v1';
const z90 = 1.2815515655446004;

const state = {
  description: '',
  variables: [],
  alternatives: [],
  samples: 50000,
  decimals: 0,
  results: null,
  draws: [],
  bestAlt: null,
  insights: []
};

const $description = document.getElementById('decisionDescription');
const $describeBtn = document.getElementById('describeBtn');
const $suggestBtn = document.getElementById('suggestBtn');
const $vars = document.getElementById('vars');
const $alts = document.getElementById('alts');
const $expr = document.getElementById('decisionExpr');
const $samples = document.getElementById('samples');
const $decimals = document.getElementById('decimals');
const $run = document.getElementById('runBtn');
const $reset = document.getElementById('resetBtn');
const $export = document.getElementById('exportCsv');
const $err = document.getElementById('err');
const $recommend = document.getElementById('recommendation');
const $insights = document.getElementById('insights');
const $voigrid = document.getElementById('voiGrid');
const $hist = document.getElementById('hist');
const $summaryGrid = document.getElementById('summaryGrid');
const $tplVar = document.getElementById('var-template');
const $tplAlt = document.getElementById('alt-template');

function toNum(s) {
  if (s === undefined || s === null || s === '') return undefined;
  const n = Number(String(s).replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function mean(arr) {
  return arr.reduce((sum, value) => sum + value, 0) / arr.length;
}

function percentile(sorted, p) {
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

function boxMuller() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const mag = Math.sqrt(-2 * Math.log(u));
  return [mag * Math.cos(2 * Math.PI * v), mag * Math.sin(2 * Math.PI * v)];
}

function sampleNormal(mu, sd) {
  const [z] = boxMuller();
  return mu + sd * z;
}

function metalogSPTSample(lowProb, Min, Low, Median, High, Max, u) {
  const ln = Math.log;
  const L = lowProb;
  const lnterm = ln((1 - L) / L);
  const logitU = ln(u / (1 - u));
  const denom1 = lnterm;
  const denom2 = (1 - 2 * L) * lnterm;
  const hasMin = Min !== undefined && Min !== '' && !Number.isNaN(Number(Min));
  const hasMax = Max !== undefined && Max !== '' && !Number.isNaN(Number(Max));
  const bounds = hasMin && hasMax ? 'b' : hasMin ? 'sl' : hasMax ? 'su' : 'u';
  const aMin = hasMin ? Number(Min) : undefined;
  const aMax = hasMax ? Number(Max) : undefined;
  if (bounds === 'u') {
    return (
      Median +
      0.5 * (High - Low) / denom1 * logitU +
      ((1 - 2 * ((Median - Low) / (High - Low))) * (High - Low) / denom2) * (u - 0.5) * logitU
    );
  }
  if (bounds === 'sl') {
    return (
      aMin +
      Math.exp(
        Math.log(Median - aMin) +
          0.5 * (Math.log((High - aMin) / (Low - aMin)) / denom1) * logitU +
          (Math.log(((High - aMin) * (Low - aMin)) / ((Median - aMin) * (Median - aMin))) / denom2) * (u - 0.5) * logitU
      )
    );
  }
  if (bounds === 'su') {
    const expo =
      Math.log(aMax - Median) +
      0.5 * (Math.log((aMax - High) / (aMax - Low)) / denom1) * logitU +
      (Math.log(((aMax - High) * (aMax - Low)) / ((aMax - Median) * (aMax - Median))) / denom2) * (u - 0.5) * logitU;
    return aMax - Math.exp(expo);
  }
  if (bounds === 'b') {
    const A = Math.log((Median - aMin) / (aMax - Median));
    const B = 0.5 * (Math.log(((High - aMin) / (aMax - High)) / ((Low - aMin) / (aMax - Low))) / denom1) * logitU;
    const C =
      (Math.log(
        (((High - aMin) / (aMax - High)) * ((Low - aMin) / (aMax - Low))) /
          (((Median - aMin) / (aMax - Median)) * ((Median - aMin) / (aMax - Median)))
      ) / denom2) *
      (u - 0.5) *
      logitU;
    const E = Math.exp(A + B + C);
    return (aMin + aMax * E) / (1 + E);
  }
  return NaN;
}

function makeSampler(v) {
  const hasMinMax = v.min !== '' && v.max !== '';
  const hasP10P90 = v.p10 !== '' && v.p90 !== '';
  const hasP10P50P90 = v.p10 !== '' && v.p50 !== '' && v.p90 !== '';

  if (hasP10P50P90) {
    const Low = toNum(v.p10);
    const Median = toNum(v.p50);
    const High = toNum(v.p90);
    if ([Low, Median, High].some((x) => x === undefined) || !(Low <= Median && Median <= High)) return null;
    const Min = toNum(v.min);
    const Max = toNum(v.max);
    const L = 0.1;
    return () => {
      let u = Math.random();
      if (u <= 0) u = Number.MIN_VALUE;
      if (u >= 1) u = 1 - Number.EPSILON;
      return metalogSPTSample(L, Min, Low, Median, High, Max, u);
    };
  }

  if (hasP10P90) {
    const p10 = toNum(v.p10);
    const p90 = toNum(v.p90);
    if (p10 === undefined || p90 === undefined || p90 < p10) return null;
    const mu = (p10 + p90) / 2;
    const sd = (p90 - p10) / (2 * z90);
    return () => sampleNormal(mu, sd);
  }

  if (hasMinMax) {
    const a = toNum(v.min);
    const b = toNum(v.max);
    if (a === undefined || b === undefined || b < a) return null;
    return () => a + Math.random() * (b - a);
  }

  return null;
}

function slugify(text) {
  return String(text)
    .trim()
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_|_$/g, '')
    .replace(/_+/g, '_');
}

function inferVariablesFromText(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const candidates = new Map();
  const keywords = ['cost', 'price', 'revenue', 'sales', 'volume', 'demand', 'profit', 'investment', 'expense', 'income', 'margin', 'growth', 'rate'];

  const lower = clean.toLowerCase();
  keywords.forEach((keyword) => {
    if (lower.includes(keyword)) {
      const name = slugify(keyword.charAt(0).toUpperCase() + keyword.slice(1));
      if (!candidates.has(name)) {
        candidates.set(name, { name, min: '', max: '', p10: '', p50: '', p90: '' });
      }
    }
  });

  const rangePattern = /([A-Za-zÀ-ÖØ-öø-ÿ ]+?)\s+(?:between|from)\s+([0-9.,]+)\s+(?:and|to)\s+([0-9.,]+)/gi;
  let match;
  while ((match = rangePattern.exec(text)) !== null) {
    const label = match[1].trim().replace(/\b(the|a|an|approx\.?|about|around)\b/gi, '').trim();
    const firstWord = label.split(/\s+/).pop() || 'Value';
    const name = slugify(firstWord.charAt(0).toUpperCase() + firstWord.slice(1));
    const min = match[2];
    const max = match[3];
    if (!candidates.has(name)) {
      candidates.set(name, { name, min, max, p10: '', p50: '', p90: '' });
    } else {
      const entry = candidates.get(name);
      entry.min = entry.min || min;
      entry.max = entry.max || max;
    }
  }

  return Array.from(candidates.values()).slice(0, 8);
}

function createVariableNode(def = { name: 'X', min: '', max: '', p10: '', p50: '', p90: '' }) {
  const node = $tplVar.content.firstElementChild.cloneNode(true);
  const name = node.querySelector('.v-name');
  const min = node.querySelector('.v-min');
  const max = node.querySelector('.v-max');
  const p10 = node.querySelector('.v-p10');
  const p50 = node.querySelector('.v-p50');
  const p90 = node.querySelector('.v-p90');
  const del = node.querySelector('.v-del');
  const badge = node.querySelector('.v-badge');

  name.value = def.name || 'X';
  min.value = def.min || '';
  max.value = def.max || '';
  p10.value = def.p10 || '';
  p50.value = def.p50 || '';
  p90.value = def.p90 || '';

  function refresh() {
    const hasRange = min.value !== '' && max.value !== '';
    const hasP10P90 = p10.value !== '' && p90.value !== '';
    const hasMeta = p10.value !== '' && p50.value !== '' && p90.value !== '';
    if (hasMeta) {
      badge.textContent = 'Metalog SPT';
      badge.className = 'badge ok';
    } else if (hasP10P90) {
      badge.textContent = 'Normale (p10/p90)';
      badge.className = 'badge ok';
    } else if (hasRange) {
      badge.textContent = 'Uniforme (min/max)';
      badge.className = 'badge ok';
    } else {
      badge.textContent = 'Incomplète';
      badge.className = 'badge warn';
    }
    saveStateFromDOM();
  }

  [name, min, max, p10, p50, p90].forEach((input) => input.addEventListener('input', refresh));
  del.addEventListener('click', () => {
    node.remove();
    saveStateFromDOM();
    renderVariables();
  });

  $vars.appendChild(node);
  return node;
}

function createAlternativeNode(def = { name: 'Option A', formula: '' }) {
  const node = $tplAlt.content.firstElementChild.cloneNode(true);
  const name = node.querySelector('.a-name');
  const formula = node.querySelector('.a-formula');
  const del = node.querySelector('.a-del');

  name.value = def.name || 'Option A';
  formula.value = def.formula || '';

  [name, formula].forEach((input) => input.addEventListener('input', saveStateFromDOM));
  del.addEventListener('click', () => {
    node.remove();
    saveStateFromDOM();
    renderAlternatives();
  });

  $alts.appendChild(node);
  return node;
}

function saveStateFromDOM() {
  const varRows = $vars.querySelectorAll('.var');
  state.variables = Array.from(varRows).map((row) => ({
    name: row.querySelector('.v-name').value.trim() || 'X',
    min: row.querySelector('.v-min').value.trim(),
    max: row.querySelector('.v-max').value.trim(),
    p10: row.querySelector('.v-p10').value.trim(),
    p50: row.querySelector('.v-p50').value.trim(),
    p90: row.querySelector('.v-p90').value.trim(),
  }));
  const altRows = $alts.querySelectorAll('.alt');
  state.alternatives = Array.from(altRows).map((row) => ({
    name: row.querySelector('.a-name').value.trim() || 'Option',
    formula: row.querySelector('.a-formula').value.trim() || '0',
  }));
  state.description = $description.value.trim();
  state.samples = Math.max(1000, Number($samples.value) || 50000);
  state.decimals = Math.max(0, Math.min(6, Number($decimals.value) || 0));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  let initial = null;
  if (saved) {
    try {
      initial = JSON.parse(saved);
    } catch (e) {
      initial = null;
    }
  }

  if (initial && Array.isArray(initial.variables) && Array.isArray(initial.alternatives)) {
    state.description = initial.description || '';
    state.variables = initial.variables;
    state.alternatives = initial.alternatives;
    state.samples = initial.samples || 50000;
    state.decimals = initial.decimals || 0;
    $description.value = state.description;
    $samples.value = state.samples;
    $decimals.value = state.decimals;
    state.variables.forEach(createVariableNode);
    state.alternatives.forEach(createAlternativeNode);
    return;
  }

  state.description = 'I need to decide whether to launch a new service or keep the existing product line. The revenue per customer is likely between 3000 and 5000, cost per customer is between 700 and 1100, and the total market size could be 200 to 450 customers.';
  state.samples = 50000;
  state.decimals = 0;
  $description.value = state.description;
  $samples.value = state.samples;
  $decimals.value = state.decimals;
  createVariableNode({ name: 'RevenuePerCustomer', min: '3000', max: '5000' });
  createVariableNode({ name: 'CostPerCustomer', min: '700', max: '1100' });
  createVariableNode({ name: 'CustomerCount', min: '200', max: '450' });
  createAlternativeNode({ name: 'Launch service', formula: 'CustomerCount * (RevenuePerCustomer - CostPerCustomer)' });
  createAlternativeNode({ name: 'Keep product line', formula: 'CustomerCount * (RevenuePerCustomer - CostPerCustomer) * 0.8' });
}

function renderVariables() {
  saveStateFromDOM();
}

function renderAlternatives() {
  saveStateFromDOM();
}

function compileExpression(expression) {
  try {
    return math.compile(expression);
  } catch (e) {
    return null;
  }
}

function showError(message) {
  $err.textContent = message;
  $err.style.display = 'block';
}

function hideError() {
  $err.style.display = 'none';
}

function formatNumber(value) {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: state.decimals,
    maximumFractionDigits: state.decimals,
  }).format(value);
}

function buildSamplers() {
  const samplers = {};
  for (const variable of state.variables) {
    const sampler = makeSampler(variable);
    if (sampler) {
      samplers[variable.name] = sampler;
    }
  }
  return samplers;
}

function validateModel(samplers) {
  if (!state.alternatives.length) {
    showError('Ajoutez au moins une alternative avant de lancer la simulation.');
    return false;
  }
  const usedNames = new Set();
  for (const variable of state.variables) {
    usedNames.add(variable.name);
  }
  const allExprIdentifiers = new Set();
  const exprs = state.alternatives.map((alt) => alt.formula);
  for (const expr of exprs) {
    const tokens = expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
    tokens.forEach((token) => allExprIdentifiers.add(token));
  }
  for (const token of allExprIdentifiers) {
    if (!usedNames.has(token) && isNaN(Number(token)) && math[token] === undefined) {
      showError(`La variable « ${token} » n'est pas définie ou est incomplète.`);
      return false;
    }
  }
  return true;
}

function runSimulation() {
  saveStateFromDOM();
  hideError();
  state.results = null;
  state.draws = [];
  state.insights = [];

  const samplers = buildSamplers();
  if (!validateModel(samplers)) return;

  const compiledAlts = state.alternatives.map((alt) => {
    const compiled = compileExpression(alt.formula);
    if (!compiled) {
      showError(`Expression invalide pour « ${alt.name} ».`);
    }
    return { name: alt.name, compiled };
  });
  if (compiledAlts.some((alt) => alt.compiled === null)) return;

  const N = state.samples | 0;
  const altDraws = state.alternatives.map(() => new Float64Array(N));
  const varDraws = {};
  Object.keys(samplers).forEach((name) => {
    varDraws[name] = new Float64Array(N);
  });

  for (let i = 0; i < N; i += 1) {
    const scope = {};
    for (const [name, sampler] of Object.entries(samplers)) {
      const value = sampler();
      scope[name] = value;
      varDraws[name][i] = value;
    }
    compiledAlts.forEach((alt, index) => {
      const value = alt.compiled.evaluate(scope);
      if (!Number.isFinite(value)) {
        showError(`L'expression de « ${alt.name} » a produit une valeur non finie.`);
      }
      altDraws[index][i] = value;
    });
  }

  const results = compiledAlts.map((alt, index) => {
    const arr = Array.from(altDraws[index]).sort((a, b) => a - b);
    return {
      name: alt.name,
      mean: mean(arr),
      p10: percentile(arr, 0.1),
      p50: percentile(arr, 0.5),
      p90: percentile(arr, 0.9),
      sorted: arr,
      raw: altDraws[index],
    };
  });

  const bestAlt = results.reduce((best, alt) => (alt.mean > best.mean ? alt : best), results[0]);
  const choiceCounts = results.map(() => 0);
  const regretSums = results.map(() => 0);

  for (let i = 0; i < N; i += 1) {
    const values = results.map((alt) => alt.raw[i]);
    const maxValue = Math.max(...values);
    values.forEach((value, index) => {
      if (value === maxValue) choiceCounts[index] += 1;
      regretSums[index] += maxValue - value;
    });
  }

  const scored = results.map((alt, index) => ({
    ...alt,
    winProbability: choiceCounts[index] / N,
    averageRegret: regretSums[index] / N,
  }));

  state.results = scored;
  state.bestAlt = bestAlt.name;
  state.draws = altDraws;
  state.varDraws = varDraws;
  state.summary = computeSummary(state.results);
  state.voi = computeVoI(state.results, varDraws);
  state.insights = buildInsights(state.results, state.voi);

  renderResults();
  drawHistogram(bestAlt.sorted);
}

function computeSummary(results) {
  return results.map((alt) => ({
    name: alt.name,
    mean: alt.mean,
    p10: alt.p10,
    p50: alt.p50,
    p90: alt.p90,
    winProbability: alt.winProbability,
    averageRegret: alt.averageRegret,
  }));
}

function computeVoI(results, varDraws) {
  const baseline = Math.max(...results.map((alt) => alt.mean));
  const variables = Object.keys(varDraws);
  return variables.map((varName) => {
    const draws = Array.from(varDraws[varName]);
    const indices = draws.map((value, index) => ({ value, index }));
    indices.sort((a, b) => a.value - b.value);
    const binCount = 8;
    const chunkSize = Math.max(1, Math.floor(indices.length / binCount));
    let conditionalValue = 0;
    let weight = 0;

    for (let bin = 0; bin < binCount; bin += 1) {
      const start = bin * chunkSize;
      const end = bin === binCount - 1 ? indices.length : start + chunkSize;
      const sampleIndices = indices.slice(start, end).map((item) => item.index);
      if (!sampleIndices.length) continue;

      const means = results.map((alt) => {
        const values = sampleIndices.map((idx) => alt.raw[idx]);
        return mean(values);
      });
      conditionalValue += Math.max(...means) * sampleIndices.length;
      weight += sampleIndices.length;
    }

    const conditionalBest = weight ? conditionalValue / weight : baseline;
    return {
      name: varName,
      voi: Math.max(0, conditionalBest - baseline),
    };
  });
}

function buildInsights(results, voi) {
  const sortedVoi = [...voi].sort((a, b) => b.voi - a.voi);
  const top = sortedVoi[0];
  const lines = [];
  lines.push(`La meilleure alternative est « ${state.bestAlt} » avec une valeur moyenne attendue de ${formatNumber(results.find((r) => r.name === state.bestAlt).mean)}.`);
  if (top && top.voi > 0) {
    lines.push(`Le paramètre le plus précieux à clarifier est « ${top.name} », avec une valeur approximative de l'information de ${formatNumber(top.voi)}.`);
  } else {
    lines.push('Aucun paramètre n’ajoute actuellement de valeur d’information significative selon ce modèle.');
  }
  const weak = results
    .filter((alt) => alt.name !== state.bestAlt)
    .sort((a, b) => a.mean - b.mean)
    .slice(0, 1)[0];
  if (weak) {
    lines.push(`Le second choix le plus risqué est « ${weak.name} » et il affiche un regret moyen de ${formatNumber(weak.averageRegret)}.`);
  }
  return lines;
}

function renderResults() {
  if (!state.results) return;

  $recommend.textContent = `Choix recommandé : ${state.bestAlt}`;
  $recommend.className = 'section-title';
  $summaryGrid.innerHTML = '';
  state.summary.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'stat';
    card.innerHTML = `
      <div class="label">${item.name}</div>
      <div class="value">${formatNumber(item.mean)}</div>
      <div class="small muted">p10 ${formatNumber(item.p10)} / p50 ${formatNumber(item.p50)} / p90 ${formatNumber(item.p90)}</div>
      <div class="small muted">Probabilité de meilleur choix: ${formatNumber(item.winProbability)}</div>
      <div class="small muted">Regret moyen: ${formatNumber(item.averageRegret)}</div>
    `;
    $summaryGrid.appendChild(card);
  });

  $voigrid.innerHTML = '';
  state.voi.sort((a, b) => b.voi - a.voi).forEach((item) => {
    const card = document.createElement('div');
    card.className = 'stat';
    card.innerHTML = `
      <div class="label">${item.name}</div>
      <div class="value">${formatNumber(item.voi)}</div>
      <div class="small muted">Approx. valeur de l'information</div>
    `;
    $voigrid.appendChild(card);
  });

  $insights.innerHTML = state.insights.map((line) => `<li>${line}</li>`).join('');
}

function drawHistogram(sorted) {
  const ctx = $hist.getContext('2d');
  ctx.clearRect(0, 0, $hist.width, $hist.height);
  if (!sorted.length) return;
  const w = $hist.width;
  const h = $hist.height;
  const pad = 32;
  const bins = 40;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const width = max - min || 1;
  const binSize = width / bins;
  const counts = new Array(bins).fill(0);
  sorted.forEach((value) => {
    let index = Math.floor((value - min) / binSize);
    if (index >= bins) index = bins - 1;
    if (index < 0) index = 0;
    counts[index] += 1;
  });
  const maxCount = Math.max(...counts);
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  ctx.strokeStyle = '#2a2f3a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h - pad);
  ctx.stroke();

  const barW = innerW / bins;
  ctx.fillStyle = 'rgba(79, 140, 255, 0.7)';
  counts.forEach((count, idx) => {
    const x = pad + idx * barW;
    const y = h - pad - (count / maxCount) * innerH;
    ctx.fillRect(x, y, Math.max(1, barW - 1), h - pad - y);
  });

  const quantiles = [0.1, 0.5, 0.9].map((p) => ({
    value: percentile(sorted, p),
    label: `p${Math.round(p * 100)}`,
  }));
  ctx.fillStyle = '#cdd9e5';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';
  quantiles.forEach((tick) => {
    const x = pad + ((tick.value - min) / width) * innerW;
    ctx.fillRect(x, h - pad, 2, 8);
    ctx.fillText(`${formatNumber(tick.value)} ${tick.label}`, x, h - 8);
  });
}

function exportCSV() {
  if (!state.results || !state.draws.length) {
    alert('Pas de résultats à exporter.');
    return;
  }

  const header = ['sample'];
  Object.keys(state.varDraws || {}).forEach((name) => header.push(name));
  state.results.forEach((alt) => header.push(alt.name));
  const rows = [header.join(';')];
  const N = state.samples | 0;

  for (let i = 0; i < N; i += 1) {
    const cells = [i + 1];
    Object.values(state.varDraws || {}).forEach((arr) => cells.push(arr[i]));
    state.results.forEach((alt) => cells.push(alt.raw[i]));
    rows.push(cells.join(';'));
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'decision-simulation.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function suggestVariables() {
  const inferred = inferVariablesFromText(state.description);
  inferred.forEach((variable) => createVariableNode(variable));
  renderVariables();
}

function addVariable() {
  createVariableNode({ name: `Variable${$vars.children.length + 1}` });
}

function addAlternative() {
  createAlternativeNode({ name: `Option ${$alts.children.length + 1}`, formula: '' });
}

$run.addEventListener('click', runSimulation);
$reset.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});
$export.addEventListener('click', exportCSV);
$describeBtn.addEventListener('click', () => {
  if (!$description.value.trim()) {
    showError('Décrivez votre décision avant de continuer.');
    return;
  }
  saveStateFromDOM();
  hideError();
});
$suggestBtn.addEventListener('click', () => {
  saveStateFromDOM();
  suggestVariables();
});
$description.addEventListener('input', saveStateFromDOM);
$samples.addEventListener('input', saveStateFromDOM);
$decimals.addEventListener('input', () => {
  state.decimals = Math.max(0, Math.min(6, Number($decimals.value) || 0));
  renderResults();
  saveStateFromDOM();
});

document.getElementById('addVar').addEventListener('click', addVariable);
document.getElementById('addAlt').addEventListener('click', addAlternative);

loadState();
renderResults();
