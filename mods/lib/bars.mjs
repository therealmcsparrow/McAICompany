// The Gates and Steps progress rows of the Savvy pane.
// Pure: no engine object, no Node import, no npm package. ASCII only.

const MAX_CELLS = 20;
const MIN_CELLS = 4;
const GATES = ['brief', 'plan', 'ship'];
const UNKNOWN_ROWS = ['Gates ?', 'Steps ?'];

function bar(cells, count, total) {
  let done = total === 0 ? 0 : Math.round((cells * count) / total);
  if (count < total) done = Math.min(done, cells - 1);
  if (count > 0) done = Math.max(done, 1);
  return '#'.repeat(done) + '-'.repeat(cells - done);
}

// The longest form that fits: bar, then no bar, then no tail, then the one-letter label.
function row(label, short, count, total, tail, width) {
  const text = `${count}/${total}`;
  const withTail = tail === '' ? text : `${text} ${tail}`;
  const cells = Math.min(MAX_CELLS, width - `${label} [] ${withTail}`.length);
  if (cells >= MIN_CELLS) return `${label} [${bar(cells, count, total)}] ${withTail}`;
  for (const candidate of [`${label} ${withTail}`, `${label} ${text}`]) {
    if (candidate.length <= width) return candidate;
  }
  return `${short} ${text}`;
}

function isKnown(view) {
  return view !== null && typeof view === 'object' && (view.state === 'running' || view.state === 'ended' || view.state === 'stale')
    && Array.isArray(view.gates) && Array.isArray(view.steps);
}

// `view` is the guarded run view or null; `width` the pane width in cells.
export function progressRows(view, width) {
  if (!isKnown(view)) return [...UNKNOWN_ROWS];
  const isShipped = view.state === 'ended' && view.outcome === 'ship';
  const total = view.steps.length;
  let gates = 0;
  let last = 'none';
  if (isShipped) {
    gates = GATES.length;
    last = 'ship';
  } else {
    const seen = new Set();
    let lastAt = '';
    for (const g of view.gates) {
      if (g === null || typeof g !== 'object' || g.result !== 'passed' || !GATES.includes(g.gate)) continue;
      seen.add(g.gate);
      if (typeof g.at === 'string' && g.at >= lastAt) {
        lastAt = g.at;
        last = g.gate;
      }
    }
    gates = seen.size;
    if (gates === 0) last = 'none';
  }
  const done = isShipped ? total : view.steps.filter((s) => s !== null && typeof s === 'object' && s.status === 'done').length;
  return [row('Gates', 'G', gates, GATES.length, last, width), row('Steps', 'S', done, total, '', width)];
}
