// Pure logic of the Savings pane: figures from the ledger scripts' JSON, and the lines the pane draws.
// No Node import, no engine handle: the pane reads the scripts and passes their parsed JSON in.

// The first aico release whose runs are guarded. Baseline runs are shipped runs whose last `meta` version is below it.
export const GUARDS_SINCE = '0.40.0';

const MAX_TEXT = 40;
const MAX_BASELINE_RUNS = 10;
const TOKEN_KEYS = ['in', 'cache_write', 'cache_read', 'out'];
const BASELINE_STATES = ['ok', 'no-data', 'unmeasured', 'unknown'];
const LABEL_WIDTH = 30;
const NARROW = 80;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isCount = (x) => Number.isSafeInteger(x) && x >= 0;

// Text that came from a run name or a field: control and escape characters removed, 40 characters at most.
export function safeText(x) {
  if (typeof x !== 'string') return '';
  const clean = x.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  const chars = Array.from(clean);
  return chars.length > MAX_TEXT ? `${chars.slice(0, MAX_TEXT).join('')}...` : clean;
}

// The real tokens of one Step: the sum of the four counts, or null when any count is missing or not a whole number.
function realTokens(tokens) {
  if (!isPlain(tokens)) return null;
  let sum = 0;
  for (const key of TOKEN_KEYS) {
    const n = Object.hasOwn(tokens, key) ? tokens[key] : undefined;
    if (!isCount(n)) return null;
    sum += n;
  }
  return Number.isSafeInteger(sum) ? sum : null;
}

function median(sorted) {
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Median real tokens per Step of `ledger.mjs report <run> --json`. Steps without a usable count are counted apart, never zero-filled.
export function currentFigures(report) {
  const list = isPlain(report) && Array.isArray(report.rows) ? report.rows : [];
  const steps = list.filter((r) => isPlain(r) && r.kind === 'step');
  if (steps.length === 0) return { state: 'no-data', median: null, counted: 0, total: 0, unmeasured: 0 };
  const counts = steps.map((r) => realTokens(r.tokens)).filter((n) => n !== null).sort((a, b) => a - b);
  const unmeasured = steps.length - counts.length;
  if (counts.length === 0) return { state: 'unmeasured', median: null, counted: 0, total: steps.length, unmeasured };
  return { state: 'ok', median: median(counts), counted: counts.length, total: steps.length, unmeasured };
}

// The answer of `ledger.mjs baseline --before <x.y.z> --json`; anything that does not fit is the `error` state.
export function baselineFigures(json) {
  const bad = { state: 'error', median: null, runs: 0 };
  if (!isPlain(json) || !BASELINE_STATES.includes(json.state)) return bad;
  if (json.state === 'ok') {
    if (!isCount(json.median) || !Number.isSafeInteger(json.runs) || json.runs < 1 || json.runs > MAX_BASELINE_RUNS) return bad;
    return { state: 'ok', median: json.median, runs: json.runs };
  }
  if (json.median !== null) return bad;
  return { state: json.state, median: null, runs: isCount(json.runs) && json.runs <= MAX_BASELINE_RUNS ? json.runs : 0 };
}

const STATE_WORD = { 'no-data': 'NO DATA', unmeasured: 'UNMEASURED', unknown: 'UNKNOWN', error: 'UNREADABLE' };

function value(figures) {
  return figures.state === 'ok' ? String(figures.median) : STATE_WORD[figures.state];
}

// `current`: currentFigures(...) or null when no run is active. `baseline`: baselineFigures(...).
// `ledgerError`: a short reason when the run's ledger could not be read, else ''. Returns [{ text, bold }].
export function paneLines({ run, current, baseline, ledgerError, columns }) {
  const out = [];
  const add = (text, bold = false) => out.push({ text, bold });
  const narrow = columns < NARROW;
  const pair = (label, text) => {
    if (narrow) {
      add(label);
      add(text);
    } else {
      add(`${label.padEnd(LABEL_WIDTH)}${text}`);
    }
  };

  add('aico savings', true);
  add('Keys: Esc closes.');
  if (run !== '') add(`Run: ${run}`);
  add(' ');

  if (ledgerError !== '') {
    add(`aico savings cannot read the ledger: ${ledgerError}. Nothing is shown rather than a wrong number.`);
  } else {
    add('MEASURED (real tokens, from the ledger)', true);
    const now = current ?? { state: 'no-data', median: null, counted: 0, total: 0, unmeasured: 0 };
    pair('median tokens per step', value(now));
    if (now.state !== 'no-data') {
      pair('steps counted', `${now.counted} of ${now.total}${now.unmeasured > 0 ? ` (${now.unmeasured} unmeasured)` : ''}`);
    }
    pair('baseline (before guards)', value(baseline));
    if (baseline.state === 'ok') pair('baseline runs', String(baseline.runs));
    add(' ');
    if (current === null) add('No task run is active. Start one, then reopen.');
    else if (now.state === 'no-data') add('The ledger has no steps yet. Run a step, then reopen.');
    else if (now.state === 'unmeasured') add('Steps have no token counts recorded.');
    if (baseline.state === 'no-data') add('No runs from before guards are in the ledger.');
    else if (baseline.state === 'unmeasured') add('Runs from before guards have no token counts.');
    else if (baseline.state === 'unknown') add('The ledger does not mark when guards started.');
    else if (baseline.state === 'error') add('The baseline could not be read.');
    add('Tokens are what the AI reads and writes. Lower costs less.');
    add('The baseline is fixed: the runs before guards were first');
    add('active, at most 10. New runs do not change it.');
  }
  add(' ');
  add('ESTIMATED (not measured)', true);
  add('none, no saver reports an estimate');
  add(' ');
  add('Source: run ledger, read only.');
  return out;
}
