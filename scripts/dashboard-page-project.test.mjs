// Tests for the dashboard v2.0 page: a v3 project is one board card, its drawer lists its runs,
// a run opens through `api/run/<ID>%2F<NN>-<pb>`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const DIR = path.join(import.meta.dirname, 'dashboard-page');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

class FakeNode {
  constructor(tag, doc) {
    this.tagName = tag.toLowerCase();
    this.doc = doc;
    this.children = [];
    this.attrs = new Map();
    this.listeners = {};
    this.parentNode = null;
    this.dataset = {};
    this.own = '';
    this.hidden = false;
    this.className = '';
    this.id = '';
    this.disabled = false;
    this.tabIndex = 0;
  }
  append(...kids) { for (const k of kids) this.insertBefore(typeof k === 'string' ? Object.assign(new FakeNode('#text', this.doc), { own: k }) : k, null); }
  insertBefore(node, ref) {
    if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((c) => c !== node);
    node.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(node); else this.children.splice(i, 0, node);
    return node;
  }
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }
  setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'id') this.id = String(v); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  async click() { for (const fn of this.listeners.click ?? []) await fn({ type: 'click' }); await settle(); }
  focus() { this.doc.activeElement = this; }
  get textContent() { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { for (const c of this.children) c.parentNode = null; this.children = []; this.own = String(v); }
  walk(fn) { fn(this); for (const c of this.children) c.walk(fn); }
  find(pred) { const out = []; this.walk((n) => { if (pred(n)) out.push(n); }); return out; }
}

const PID = 'P20261109.000009';
const RUNS = [`${PID}/03-fix`, `${PID}/02-build`, `${PID}/01-plan`];
const V2 = '2026-11-04-0119-demo';

function makeEnv({ runBody = null } = {}) {
  const doc = {
    activeElement: null, title: '', documentElement: { lang: 'en' }, byId: new Map(),
    createElement(tag) { return new FakeNode(tag, doc); },
    createElementNS(ns, tag) { return new FakeNode(tag, doc); },
    getElementById(id) { return doc.byId.get(id) ?? null; }
  };
  doc.body = new FakeNode('body', doc);
  const html = read('index.html');
  for (const m of html.matchAll(/<(\w+)([^>]*?)\sid="([^"]+)"([^>]*)>/g)) {
    const node = new FakeNode(m[1], doc);
    node.id = m[3];
    node.hidden = /\shidden(\s|>|=)/.test(m[2] + m[4] + '>');
    doc.byId.set(m[3], node);
    if (m[3] !== 'drawer') doc.body.append(node);
  }
  doc.byId.get('pause').setAttribute('aria-pressed', 'false');
  const fetches = [];
  const ctx = {
    document: doc, Date, Intl, Promise, JSON, Math, Object, String, Array, isNaN, isFinite, encodeURIComponent,
    AICO_MANUAL_START: true,
    fetch: async (url) => {
      fetches.push(url);
      const body = String(url).endsWith('/links') ? { state: 'none' } : runBody;
      if (body === null) return { status: 404, headers: { get: () => null }, json: async () => ({}) };
      return { status: 200, headers: { get: () => null }, json: async () => body };
    },
    setTimeout: () => ({}), clearTimeout: () => {}
  };
  Object.defineProperty(ctx, 'location', { get() { throw new Error('page read location'); } });
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['board.js', 'live.js', 'drawer.js']) vm.runInContext(read(f), ctx, { filename: f });
  return { ctx, doc, fetches };
}

const runCard = (over = {}) => ({
  slug: V2, title: 'Demo run', state: 'running', started: '2026-11-04T01:19:00Z', ended: null,
  elapsedS: 125, live: true, tier: 'high', round: 0, needsCeo: false, column: 'build', stageNote: null,
  readable: true, tokens: { spend: 412318, cacheRead: 1200000 }, usd: null, ...over
});
const projectCard = (over = {}) => ({
  kind: 'project', id: PID, title: 'One project one folder', description: 'One project one folder',
  state: 'running', started: '2026-11-09T15:52:35Z', ended: null, elapsedS: 60, live: true, tier: 'high',
  round: 0, needsCeo: false, column: 'build', stageNote: null, readable: true,
  tokens: { spend: 1000, cacheRead: 2000 }, usd: null, runs: [...RUNS], ...over
});
const board = (cards, col = 'build') => ({
  v: 1, generated: '2026-11-09T12:00:00Z', active: null, inflight: 0,
  columns: ['intake', 'brief', 'plan', 'build', 'review', 'ship-gate', 'needs-ceo', 'done']
    .map((id) => ({ id, cards: id === col ? cards : [] })),
  roadmap: [], lan: false
});
const cardsOf = (env) => env.doc.byId.get('columns').find((n) => n.tagName === 'li' && n.className === 'card');
const titleButtons = (env) => env.doc.byId.get('columns').find((n) => n.tagName === 'button' && n.className === 'title');
const dlg = (env) => env.doc.body.children.find((n) => n.id === 'drawer');
const runRows = (env, name) => dlg(env).find((n) => n.tagName === 'button' && n.textContent !== 'Close' && n.textContent.includes(name));

test('a v3 project with three runs is one card, its runs get no card', () => {
  const env = makeEnv();
  assert.ok(env.ctx.aicoBoard.render(board([projectCard()])));
  assert.equal(cardsOf(env).length, 1);
  const text = cardsOf(env)[0].textContent;
  assert.match(text, new RegExp(PID.replace('.', '\\.')));
  for (const s of RUNS) assert.equal(text.includes(s), false, `run ${s} shown as a card`);
  assert.equal(titleButtons(env).length, 1);
});

test('project card says it holds 3 runs', () => {
  const env = makeEnv();
  env.ctx.aicoBoard.render(board([projectCard()]));
  assert.match(cardsOf(env)[0].textContent, /Project\b.*\b3 runs/);
});

test('v2 run card (no kind) beside a project card stays its own card, with no project line', () => {
  const env = makeEnv();
  env.ctx.aicoBoard.render(board([projectCard(), runCard()]));
  const cards = cardsOf(env);
  assert.equal(cards.length, 2);
  const v2 = cards.find((c) => c.textContent.includes(V2));
  assert.ok(v2);
  assert.doesNotMatch(v2.textContent, /Project\b.*\bruns?\b/);
});

test('project card with an empty runs list is still one card and says 0 runs', () => {
  const env = makeEnv();
  env.ctx.aicoBoard.render(board([projectCard({ runs: [] })]));
  assert.equal(cardsOf(env).length, 1);
  assert.match(cardsOf(env)[0].textContent, /0 runs/);
});

test('opening the project card shows a drawer listing its runs newest first', async () => {
  const env = makeEnv();
  env.ctx.aicoBoard.render(board([projectCard()]));
  await titleButtons(env)[0].click();
  const d = dlg(env);
  assert.ok(d && d.hidden === false, 'drawer open');
  const text = d.textContent;
  const at = ['03-fix', '02-build', '01-plan'].map((n) => text.indexOf(n));
  assert.ok(at.every((i) => i >= 0), `all three runs listed: ${text}`);
  assert.ok(at[0] < at[1] && at[1] < at[2], 'newest first');
});

test('opening a run from the project drawer requests api/run/<ID>%2F<NN>-<pb>', async () => {
  const env = makeEnv();
  env.ctx.aicoBoard.render(board([projectCard()]));
  await titleButtons(env)[0].click();
  const row = runRows(env, '02-build');
  assert.ok(row.length >= 1, 'a button for the run');
  await row[0].click();
  await settle();
  assert.ok(env.fetches.includes(`api/run/${PID}%2F02-build`), `fetches: ${env.fetches}`);
  assert.equal(env.fetches.some((u) => String(u).startsWith(`api/run/${PID}/`)), false, 'raw slash never sent');
});

test('the run links request keeps the slash encoded as %2F', async () => {
  const env = makeEnv();
  env.ctx.aicoBoard.render(board([projectCard()]));
  await titleButtons(env)[0].click();
  await runRows(env, '03-fix')[0].click();
  await settle();
  assert.ok(env.fetches.includes(`api/run/${PID}%2F03-fix/links`), `fetches: ${env.fetches}`);
});

test('a v2 run card still opens the single-run drawer, with no runs list', async () => {
  const env = makeEnv();
  env.ctx.aicoBoard.render(board([projectCard(), runCard()]));
  assert.equal(cardsOf(env).length, 2, 'project and v2 cards both shown');
  const btn = titleButtons(env).find((b) => b.textContent.includes('Demo run'));
  await btn.click();
  assert.ok(env.fetches.includes(`api/run/${encodeURIComponent(V2)}/links`), `fetches: ${env.fetches}`);
  assert.doesNotMatch(dlg(env).textContent, /Runs \(\d+\)/);
  assert.equal(env.fetches.some((u) => /%2F/i.test(String(u))), false);
});

test('hostile run entries in a project card are never listed or fetched', async () => {
  const env = makeEnv();
  const evil = [`${PID}/../x`, `${PID}/a/b`, '..\\x', 7, null, `${PID}/<script>boom()</script>`];
  env.ctx.aicoBoard.render(board([projectCard({ runs: [...evil, `${PID}/01-plan`] })]));
  await titleButtons(env)[0].click();
  const d = dlg(env);
  assert.ok(d.textContent.includes('01-plan'));
  assert.equal(d.find((n) => n.tagName === 'script').length, 0);
  assert.equal(d.textContent.includes('..'), false);
  assert.equal(d.textContent.includes('boom'), false);
  for (const row of d.find((n) => n.tagName === 'button' && n.textContent !== 'Close')) await row.click();
  assert.equal(env.fetches.some((u) => /\.\.|%5C|%2F[^/]*%2F|boom/i.test(String(u).replace(/\/links$/, ''))), false, `fetches: ${env.fetches}`);
});

test('project card removal on the next board drops the card', () => {
  const env = makeEnv();
  env.ctx.aicoBoard.render(board([projectCard()]));
  assert.equal(cardsOf(env).length, 1);
  env.ctx.aicoBoard.render(board([], 'build'));
  assert.equal(cardsOf(env).length, 0);
});
