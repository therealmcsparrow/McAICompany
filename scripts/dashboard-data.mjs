// Board JSON for the dashboard: one card per run (a v3 project is one card), each in exactly one column, read-only.
import { list as listRuns, show as showRun, active as activeRun } from './run-state.mjs';
import { readStage } from './run-stage.mjs';
import { listIntake } from './intake.mjs';
import { listRoadmap } from './roadmap.mjs';
import { readCost } from './cost-source.mjs';
import { readLedger } from './dashboard-tokens.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { parseName, parseRun, summaryDescription } from '../mods/lib/work-folder.mjs';

const COLUMNS = ['intake', 'brief', 'plan', 'build', 'review', 'ship-gate', 'needs-ceo', 'done'];
const STAGE_COLUMNS = new Set(['brief', 'plan', 'build', 'review', 'ship-gate']);
const STATES = new Set(['running', 'ended', 'stale', 'none', 'unreadable']);
const INTAKE_OUTCOMES = ['needs-info', 'rejected'];
const INFLIGHT_MS = 12 * 3600 * 1000;
const MAX_TEXT = 300;
const MAX_ENDED_CACHE = 1000;
const MAX_PROJECT_FILE = 4096;

const defaults = {
  list: listRuns, active: activeRun, show: showRun, readStage, readCost, readLedger, listIntake, listRoadmap,
};

// Cost of an ended run no longer changes, so it is read once per slug and end time.
const endedUsd = new Map();

const at = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
const text = (v) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const ms = (v) => (typeof v === 'string' ? Date.parse(v) : NaN);

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function titleOf(slug) {
  return parseName(slug) ? slug.slice(19) : slug;
}

function needsCeo(view) {
  if (view.open_ask !== null && view.open_ask !== undefined) return true;
  let top = null;
  for (const s of Array.isArray(view.steps) ? view.steps : []) {
    const n = Number.parseInt(s?.step, 10);
    if (Number.isInteger(n) && (top === null || n >= top.n)) top = { n, status: s.status };
  }
  return top !== null && top.status === 'needs-ceo';
}

function gateColumn(view) {
  const gates = Array.isArray(view.gates) ? view.gates : [];
  if (gates.some((g) => g?.gate === 'ship')) return 'ship-gate';
  if (gates.some((g) => g?.gate === 'plan' && g.result === 'passed')) return 'build';
  if (gates.some((g) => g?.gate === 'brief' && g.result === 'passed')) return 'plan';
  return 'brief';
}

function usdOf(root, slug, ended, deps) {
  const key = ended ? `${slug}\n${ended}` : null;
  if (key && endedUsd.has(key)) return endedUsd.get(key);
  let usd;
  try {
    const cost = deps.readCost(root, slug);
    usd = cost?.state === 'recorded' && num(cost.micros) !== null ? cost.micros / 1000000 : null;
  } catch {
    return null;
  }
  if (key) {
    if (endedUsd.size >= MAX_ENDED_CACHE) endedUsd.clear();
    endedUsd.set(key, usd);
  }
  return usd;
}

async function tokensOf(root, slug, deps) {
  try {
    const led = await deps.readLedger(root, slug);
    if (led?.state !== 'ok' || !led.totals) return null;
    const spend = num(led.totals.spend);
    const cacheRead = num(led.totals.cacheRead);
    return spend === null || cacheRead === null ? null : { spend, cacheRead };
  } catch {
    return null;
  }
}

// `view` is null when the run state could not be read.
async function buildCard(root, entry, view, now, deps) {
  const slug = entry.slug;
  let state = STATES.has(entry.state) ? entry.state : 'unreadable';
  if (view === null) state = 'unreadable';
  const src = view ?? {};
  const started = typeof entry.started === 'string' ? entry.started : null;
  const ended = typeof entry.ended === 'string' ? entry.ended : null;
  const startMs = ms(started);
  const endMs = ended === null ? now : ms(ended);
  const elapsedS = Number.isNaN(startMs) || Number.isNaN(endMs) ? null : Math.max(0, Math.floor((endMs - startMs) / 1000));
  const ask = view !== null && needsCeo(src);
  let column;
  let stageNote = null;
  if (ended !== null) column = 'done';
  else if (ask) column = 'needs-ceo';
  else {
    const st = safe(() => deps.readStage(root, slug), null);
    if (st?.state === 'recorded' && STAGE_COLUMNS.has(st.stage)) column = st.stage;
    else {
      column = gateColumn(src);
      stageNote = 'stage not recorded';
    }
  }
  const [tokens, usd] = await Promise.all([
    state === 'unreadable' ? null : tokensOf(root, slug, deps),
    state === 'unreadable' ? null : usdOf(root, slug, ended, deps),
  ]);
  return {
    slug,
    title: titleOf(slug),
    state,
    started,
    ended,
    elapsedS,
    live: state === 'running',
    tier: typeof src.tier === 'string' ? src.tier : typeof entry.tier === 'string' ? entry.tier : null,
    round: Number.isInteger(src.round) ? src.round : Number.isInteger(entry.round) ? entry.round : null,
    needsCeo: ask,
    column,
    stageNote,
    readable: state === 'unreadable' ? false : state === 'none' ? 'not recorded' : true,
    tokens,
    usd,
  };
}

// First line of `00-project.md` of a v3 project, '' when the file is missing, a link, unreadable or not one clean line.
function projectDescription(root, id) {
  let fd = null;
  try {
    const file = path.join(root, '.company', 'work', id, '00-project.md');
    const st = fs.lstatSync(file, { bigint: true });
    if (st.isSymbolicLink() || !st.isFile() || st.nlink !== 1n) return '';
    const want = path.join(fs.realpathSync.native(root), '.company', 'work', id, '00-project.md');
    if (fs.realpathSync.native(file) !== want) return '';
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const f = fs.fstatSync(fd, { bigint: true });
    if (!f.isFile() || f.dev !== st.dev || f.ino !== st.ino || f.nlink !== 1n) return '';
    const buf = Buffer.alloc(MAX_PROJECT_FILE);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const out = summaryDescription(buf.subarray(0, n).toString('utf8').replace(/\r\n?/g, '\n'));
    return typeof out.description === 'string' ? out.description : '';
  } catch {
    return '';
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function inflightOf(view, now) {
  if (!view || !Array.isArray(view.subs)) return 0;
  return view.subs.filter((s) => {
    if (!s || s.stop !== null) return false;
    const start = ms(s.start);
    return !Number.isNaN(start) && now - start <= INFLIGHT_MS;
  }).length;
}

const order = (a, b) => (a.started === null) - (b.started === null)
  || (a.started === b.started ? 0 : a.started < b.started ? 1 : -1)
  || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

function intakeCards(deps, root, now) {
  const items = safe(() => deps.listIntake(root, { now }).items, []);
  const out = [];
  for (const outcome of INTAKE_OUTCOMES) {
    for (const i of Array.isArray(items) ? items : []) {
      if (i?.outcome === outcome) out.push({ id: text(i.id), topic: text(i.topic), outcome, at: text(i.at) });
    }
  }
  return out;
}

// The board for the product at `root`; every reader failure leaves only its own part empty.
export async function board(root, { now = Date.now(), deps: given = {} } = {}) {
  const deps = { ...defaults, ...given };
  const entries = safe(() => deps.list(root, { now }).runs, []);
  const act = safe(() => deps.active(root, { now }), { slug: null, view: null });
  // A v3 project is one card built from its newest run (first in list order); its other runs get no card.
  const projects = new Map();
  const shown = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const r = parseRun(entry?.slug);
    if (r === null) shown.push({ entry });
    else if (projects.has(r.id)) projects.get(r.id).runs.push(entry.slug);
    else {
      const project = { id: r.id, runs: [entry.slug] };
      projects.set(r.id, project);
      shown.push({ entry, project });
    }
  }
  const cards = await Promise.all(shown.map(async ({ entry, project }) => {
    const view = entry.state === 'unreadable' ? null : safe(() => deps.show(root, entry.slug, { now }), null);
    const card = await buildCard(root, entry, view, now, deps);
    if (project === undefined) return card;
    const description = projectDescription(root, project.id);
    return { ...card, kind: 'project', id: project.id, slug: project.id, title: description || project.id, description, runs: project.runs };
  }));
  const columns = COLUMNS.map((id) => ({ id, cards: id === 'intake' ? intakeCards(deps, root, now) : cards.filter((c) => c.column === id) }));
  const slug = typeof act?.slug === 'string' ? act.slug : null;
  const roadmap = safe(() => deps.listRoadmap(root).items, []);
  return {
    v: 1,
    generated: at(now),
    active: slug,
    inflight: slug === null ? 0 : inflightOf(act.view, now),
    columns,
    roadmap: Array.isArray(roadmap) ? roadmap : [],
  };
}

// A new board equal to `prev` except the card of `prev.active`, `active` and `inflight`.
export async function refreshActive(root, prev, { now = Date.now(), deps: given = {} } = {}) {
  const deps = { ...defaults, ...given };
  const next = { ...prev, generated: at(now), columns: prev.columns.map((c) => ({ id: c.id, cards: [...c.cards] })) };
  const act = safe(() => deps.active(root, { now }), { slug: null, view: null });
  const known = (s) => typeof s === 'string' && next.columns.some((c) => c.cards.some((x) => x.slug === s || (x.kind === 'project' && x.runs.includes(s))));
  if (known(act?.slug)) {
    next.active = act.slug;
    next.inflight = inflightOf(act.view, now);
  } else {
    next.active = null;
    next.inflight = 0;
  }
  const slug = prev.active;
  if (typeof slug !== 'string') return next;
  // A v3 run is shown by its project card, built from the newest run (runs[0]), as in `board`.
  const hit = (x) => (x.kind === 'project' ? x.runs[0] === slug : x.slug === slug);
  const old = next.columns.flatMap((c) => c.cards).find(hit);
  if (old === undefined) return next;
  const view = safe(() => deps.show(root, slug, { now }), null);
  const entry = view === null
    ? { slug, state: 'unreadable', started: old.started, ended: old.ended, tier: old.tier, round: old.round }
    : { slug, state: view.state, started: view.started, ended: view.ended, tier: view.tier, round: view.round };
  let card = await buildCard(root, entry, view, now, deps);
  if (old.kind === 'project') card = { ...card, kind: old.kind, id: old.id, slug: old.slug, title: old.title, description: old.description, runs: old.runs };
  for (const c of next.columns) {
    if (c.id !== 'intake') c.cards = c.cards.filter((x) => x !== old);
  }
  const target = next.columns.find((c) => c.id === card.column);
  target.cards.push(card);
  target.cards.sort(order);
  return next;
}
