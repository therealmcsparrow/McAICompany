import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

// Automated half of the WCAG 2.2 AA check for the dashboard page. It proves what markup text,
// CSS text and the script-built tree can prove. Layout, zoom, real focus order and screen reader
// output stay manual.

const DIR = path.join(import.meta.dirname, 'dashboard-page');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const HTML = read('index.html');
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };

// ---- fake DOM -------------------------------------------------------------------------------

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
  }
  get id() { return this.attrs.get('id') ?? ''; }
  set id(v) { this.attrs.set('id', String(v)); }
  get className() { return this.attrs.get('class') ?? ''; }
  set className(v) { this.attrs.set('class', String(v)); }
  get hidden() { return this.attrs.has('hidden'); }
  set hidden(v) { if (v) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }
  get lang() { return this.attrs.get('lang') ?? ''; }
  get type() { return this.attrs.get('type') ?? ''; }
  set type(v) { this.attrs.set('type', String(v)); }
  get disabled() { return this.attrs.has('disabled'); }
  set disabled(v) { if (v) this.attrs.set('disabled', ''); else this.attrs.delete('disabled'); }
  get tabIndex() { return this.attrs.has('tabindex') ? Number(this.attrs.get('tabindex')) : (this.tagName === 'button' ? 0 : -1); }
  set tabIndex(v) { this.attrs.set('tabindex', String(v)); }
  append(...kids) {
    for (const k of kids) {
      if (typeof k === 'string') { const t = new FakeNode('#text', this.doc); t.own = k; this.insertBefore(t, null); } else this.insertBefore(k, null);
    }
  }
  insertBefore(node, ref) {
    if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((c) => c !== node);
    node.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(node); else this.children.splice(i, 0, node);
    if (this.doc.activeElement === node) this.doc.activeElement = null;
    return node;
  }
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  async click() { for (const fn of this.listeners.click ?? []) await fn({ type: 'click' }); }
  key(key, extra = {}) {
    let prevented = false;
    for (let n = this; n; n = n.parentNode) for (const fn of n.listeners.keydown ?? []) fn({ key, preventDefault() { prevented = true; }, ...extra });
    return prevented;
  }
  focus() { this.doc.activeElement = this; }
  get textContent() { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { for (const c of this.children) c.parentNode = null; this.children = []; this.own = String(v); }
}

const VOID = new Set(['meta', 'link', 'br', 'img', 'input', 'hr']);
function parseAttrs(src) {
  const out = [];
  for (const m of src.matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) out.push([m[1], m[2] ?? m[3] ?? m[4] ?? '']);
  return out;
}
function parseHtml(html, doc) {
  const root = new FakeNode('#root', doc);
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      if (m[4].trim()) { const t = new FakeNode('#text', doc); t.own = m[4].replace(/\s+/g, ' '); stack.at(-1).insertBefore(t, null); }
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === tag) { stack.length = i; break; }
      continue;
    }
    const node = new FakeNode(tag, doc);
    for (const [k, v] of parseAttrs(m[3].replace(/\/\s*$/, ''))) node.attrs.set(k, v);
    stack.at(-1).insertBefore(node, null);
    if (tag === 'style' || tag === 'script') {
      const end = html.indexOf('</' + tag, re.lastIndex);
      node.raw = html.slice(re.lastIndex, end);
      re.lastIndex = html.indexOf('>', end) + 1;
    } else if (!VOID.has(tag)) {
      stack.push(node);
    }
  }
  return root;
}

const all = (n, pred = () => true, out = []) => { for (const c of n.children) { if (pred(c)) out.push(c); all(c, pred, out); } return out; };
const tags = (n, ...names) => all(n, (x) => names.includes(x.tagName));
const shown = (n) => { for (let p = n; p; p = p.parentNode) if (p.hidden) return false; return true; };
const inert = (n) => { for (let p = n; p; p = p.parentNode) if (p.attrs?.has('inert')) return true; return false; };
const spoken = (n) => (n.tagName === '#text' ? n.own : n.getAttribute('aria-hidden') === 'true' || n.tagName === 'svg' ? '' : n.own + n.children.map(spoken).join(''));
function nameOf(n) {
  const by = n.getAttribute('aria-labelledby');
  if (by) {
    const root = (function top(x) { return x.parentNode ? top(x.parentNode) : x; })(n);
    return by.split(/\s+/).map((id) => all(root, (x) => x.id === id)[0]).filter(Boolean).map((x) => x.textContent).join(' ').trim();
  }
  return (n.getAttribute('aria-label') ?? spoken(n)).replace(/\s+/g, ' ').trim();
}
const focusables = (root) => all(root, (n) => (
  (n.tagName === 'button' && !n.disabled) || (n.tagName === 'a' && n.getAttribute('href') !== null) || (n.attrs.has('tabindex') && n.tabIndex >= 0)
) && shown(n) && !inert(n));

// ---- running page ----------------------------------------------------------------------------

const card = (slug, over = {}) => ({
  slug, title: 'Run ' + slug, state: 'running', started: '2026-11-04T01:19:00Z', ended: null, elapsedS: 125, live: true,
  tier: 'high', round: 0, needsCeo: false, stageNote: null, readable: true, tokens: { spend: 412318, cacheRead: 1200000 }, usd: 1.5, ...over
});
const COLS = ['intake', 'brief', 'plan', 'build', 'review', 'ship-gate', 'needs-ceo', 'done'];
const board = (by, extra = {}) => ({
  v: 1, generated: '2026-11-04T12:00:00Z', active: null, inflight: 0,
  columns: COLS.map((id) => ({ id, cards: by[id] ?? [] })),
  roadmap: [{ lane: 'roadmap', topic: 'Idea', started: '2026-10-01' }, { lane: 'not-now', topic: 'Later' }], lan: true, ...extra
});
const BOARD = board({
  intake: [{ id: 'i1', topic: 'Add export', outcome: 'needs-info', at: '2026-11-04T01:00:00Z' }, { id: 'i2', topic: 'Rename tool', outcome: 'rejected', at: '2026-11-04T01:01:00Z' }],
  brief: [card('2026-11-04-0001-none', { state: 'none', elapsedS: null, tokens: null, usd: null })],
  plan: [card('2026-11-04-0002-unreadable', { readable: false, state: 'unreadable' })],
  build: [card('2026-11-04-0119-demo')],
  review: [card('2026-11-04-0003-stale', { state: 'stale', stageNote: 'stage not recorded' })],
  'needs-ceo': [card('2026-11-04-0004-ask', { needsCeo: true }), card('2026-11-04-0005-ask', { needsCeo: true })],
  done: Array.from({ length: 12 }, (_, i) => card('2026-11-03-00' + String(10 + i) + '-old', { state: 'ended', ended: '2026-11-03T10:00:00Z', live: false }))
});
const MOVED = board({ ...Object.fromEntries(BOARD.columns.map((c) => [c.id, c.cards])), build: [], review: [BOARD.columns[3].cards[0], ...BOARD.columns[4].cards] });
const NO_ASK = board({ build: [card('2026-11-04-0119-demo')] }, { lan: false });
const RUN = {
  v: 1, slug: '2026-11-04-0119-demo',
  steps: ['done', 'blocked', 'needs-ceo', 'handover', 'running', 'odd'].map((status, i) => ({ step: String(i + 1).padStart(2, '0'), role: 'qa', status, round: 0, summary: i === 5 ? null : 'Did a thing' })),
  rounds: [{ round: 0, gate: 'pass', review: 'approve' }, { round: 1, gate: 'fail', review: 'changes' }, { round: 2, gate: null, review: 'blocked' }],
  routing: ['code-reviewer'],
  active: { gates: [{ gate: 'brief', result: 'pass', waitS: 30 }], waves: [{ wave: 1, at: '2026-11-04T01:20:00Z' }], roleTimes: [{ role: 'qa', ms: 61000, steps: 2 }], overCap: [{ step: '05', role: 'qa', ctxEnd: 98000 }], fixRounds: 1 }
};
const LINKS = { state: 'found', prs: [{ url: 'https://github.com/a/b/pull/7', number: 7, state: 'open' }], issues: [{ url: 'https://github.com/a/b/issues/3', number: 3 }] };

async function boot(boards = [BOARD]) {
  const doc = {
    activeElement: null, title: '', handlers: [],
    createElement: (t) => new FakeNode(t, doc),
    createElementNS: (ns, t) => new FakeNode(t, doc),
    getElementById: (id) => all(doc.root, (n) => n.id === id)[0] ?? null,
    addEventListener: (t) => doc.handlers.push(t)
  };
  doc.root = parseHtml(HTML, doc);
  doc.documentElement = all(doc.root, (n) => n.tagName === 'html')[0];
  doc.body = all(doc.root, (n) => n.tagName === 'body')[0];
  const fetches = [];
  const timers = [];
  const queue = [...boards];
  const ctx = {
    document: doc, Date, Intl, URL, Promise, JSON, Math, Object, String, Array, isNaN, isFinite, encodeURIComponent, structuredClone,
    AICO_MANUAL_START: true, windowHandlers: [],
    addEventListener(t) { ctx.windowHandlers.push(t); },
    fetch: async (url) => {
      fetches.push(url);
      const body = /\/links$/.test(url) ? LINKS : url.startsWith('api/run/') ? RUN : (queue.length > 1 ? queue.shift() : queue[0]);
      return { status: 200, headers: { get: () => null }, json: async () => structuredClone(body) };
    },
    setTimeout: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.live = false; }
  };
  Object.defineProperty(ctx, 'location', { get() { throw new Error('page read location'); } });
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['board.js', 'drawer.js', 'live.js']) vm.runInContext(read(f), ctx, { filename: f });
  const fire = async () => { for (const t of timers.splice(0).filter((x) => x.live)) t.fn(); await settle(); };
  const env = { doc, ctx, fetches, timers, fire, byId: (id) => doc.getElementById(id) };
  ctx.aicoLive.start();
  await settle();
  return env;
}
const openDrawer = async (env) => {
  const btn = all(env.doc.body, (n) => n.tagName === 'button' && n.textContent === 'Run 2026-11-04-0119-demo')[0];
  env.opener = btn;
  btn.focus();
  await btn.click();
  await settle();
  return env.byId('drawer');
};

// ---- CSS --------------------------------------------------------------------------------------

const CSS = all(parseHtml(HTML, { }), (n) => n.tagName === 'style')[0].raw.replace(/\/\*[\s\S]*?\*\//g, '');
function rulesOf(text, media = []) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
    const sel = text.slice(i, open).trim();
    const inner = text.slice(open + 1, j - 1);
    if (sel.startsWith('@media') || sel.startsWith('@supports')) out.push(...rulesOf(inner, [...media, sel.replace(/^@\w+\s*/, '')]));
    else if (sel.startsWith('@')) out.push({ sel, body: inner, media, decls: [] });
    else out.push({ sel, media, body: inner, decls: inner.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]) });
    i = j;
  }
  return out;
}
const RULES = rulesOf(CSS);
const rulesFor = (sel) => RULES.filter((r) => r.sel.split(',').map((s) => s.trim()).includes(sel));
const declOf = (sel, prop, pick = (r) => !r.media.length) => rulesFor(sel).filter(pick).flatMap((r) => r.decls).filter((d) => d[0] === prop).at(-1)?.[1];
const px = (v) => (v === undefined ? NaN : /rem$/.test(v) ? parseFloat(v) * 16 : /px$/.test(v) ? parseFloat(v) : NaN);
const tokens = (rules) => Object.fromEntries(rules.flatMap((r) => r.decls).filter((d) => d[0].startsWith('--') && /^#[0-9a-f]{6}$/i.test(d[1])).map((d) => [d[0].slice(2), d[1]]));
const LIGHT = tokens(RULES.filter((r) => r.sel === ':root' && !r.media.length));
const DARK = tokens(RULES.filter((r) => r.sel === ':root' && r.media.some((m) => m.includes('prefers-color-scheme: dark'))));

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ---- markup -----------------------------------------------------------------------------------

test('document language, title, zoom and orientation are not blocked (3.1.1, 2.4.2, 1.4.4, 1.3.4)', () => {
  const doc = { };
  const root = parseHtml(HTML, doc);
  const htmlEl = tags(root, 'html')[0];
  assert.match(htmlEl.getAttribute('lang') ?? '', /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/);
  assert.ok(tags(root, 'title')[0].textContent.trim().length > 0);
  const viewport = tags(root, 'meta').find((m) => m.getAttribute('name') === 'viewport').getAttribute('content');
  assert.doesNotMatch(viewport, /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*[0-4](\.\d+)?(,|$)/);
  assert.doesNotMatch(CSS, /orientation\s*:/);
  assert.equal(tags(root, 'input', 'select', 'textarea', 'form').length, 0);
  assert.equal(tags(root, 'img', 'audio', 'video', 'canvas').length, 0);
});

test('static structure: skip link first, one main, banner first in main, one h1 (2.4.1, 1.3.1)', () => {
  const root = parseHtml(HTML, {});
  const body = tags(root, 'body')[0];
  const first = focusables(body)[0];
  assert.equal(first.tagName, 'a');
  assert.equal(first.getAttribute('href'), '#board');
  assert.ok(nameOf(first).length > 0);
  const target = tags(root, 'main')[0];
  assert.equal(target.id, 'board');
  assert.equal(tags(root, 'main').length, 1);
  assert.equal(tags(root, 'header').length, 1);
  assert.equal(tags(root, 'h1').length, 1);
  assert.equal(target.children[0].id, 'lan');
  assert.ok(target.tabIndex === -1 && target.attrs.has('tabindex'));
  assert.equal(all(root, (n) => n.attrs.has('autofocus')).length, 0);
  assert.equal(all(root, (n) => n.attrs.has('title')).filter((n) => n.tagName !== 'title').length, 0);
  assert.equal(all(root, (n) => [...n.attrs.keys()].some((k) => /^on/.test(k) || k === 'draggable')).length, 0);
  assert.equal(all(root, (n) => n.attrs.has('tabindex') && Number(n.attrs.get('tabindex')) > 0).length, 0);
});

test('one polite status region, empty at load; no other live region (4.1.3)', () => {
  const root = parseHtml(HTML, {});
  const lives = all(root, (n) => n.attrs.has('aria-live') || n.attrs.has('role') && /^(status|alert|log)$/.test(n.getAttribute('role')));
  assert.deepEqual(lives.map((n) => n.id), ['status']);
  const status = lives[0];
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(status.textContent.trim(), '');
});

test('pause control is a native button with a fixed label and aria-pressed (4.1.2, 2.5.3, 2.2.2)', () => {
  const root = parseHtml(HTML, {});
  const pause = all(root, (n) => n.id === 'pause')[0];
  assert.equal(pause.tagName, 'button');
  assert.equal(pause.getAttribute('type'), 'button');
  assert.equal(pause.getAttribute('aria-pressed'), 'false');
  assert.equal(nameOf(pause), 'Pause updates');
  assert.equal(pause.attrs.has('aria-label'), false);
  assert.deepEqual(all(root, (n) => n.attrs.has('aria-pressed')).map((n) => n.id), ['pause']);
});

// ---- CSS rules --------------------------------------------------------------------------------

test('every colour token exists in light and dark, so no pair is left unresolved', () => {
  const names = Object.keys(LIGHT).sort();
  for (const must of ['bg', 'surface', 'head', 'text', 'muted', 'accent', 'accent-text', 'focus', 'control-border', 'line', 'ok', 'warn', 'err', 'info', 'unknown', 'warn-bg', 'err-bg', 'ok-bg', 'info-bg']) {
    assert.ok(LIGHT[must], 'light token --' + must);
  }
  assert.deepEqual(Object.keys(DARK).sort(), names);
});

test('text contrast is 4.5:1 or better in both modes (1.4.3)', () => {
  for (const [mode, t] of [['light', LIGHT], ['dark', DARK]]) {
    const pairs = [
      ['text', ['surface', 'bg', 'head', 'warn-bg', 'err-bg', 'ok-bg', 'info-bg']],
      ['muted', ['surface', 'bg', 'head']],
      ['accent', ['surface', 'bg']]
    ];
    for (const [fg, bgs] of pairs) for (const bg of bgs) assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${mode} ${fg} on ${bg}: ${ratio(t[fg], t[bg]).toFixed(2)}`);
    for (const k of ['ok', 'warn', 'err', 'info', 'unknown']) {
      for (const bg of ['surface', 'bg']) assert.ok(ratio(t[k], t[bg]) >= 4.5, `${mode} ${k} on ${bg}: ${ratio(t[k], t[bg]).toFixed(2)}`);
    }
    assert.ok(ratio(t['accent-text'], t.accent) >= 4.5, `${mode} pressed pause label on accent`);
  }
});

test('icons, control edges and the focus ring are 3:1 or better in both modes (1.4.11, 2.4.7)', () => {
  const tint = { ok: 'ok-bg', warn: 'warn-bg', err: 'err-bg', info: 'info-bg' };
  for (const [mode, t] of [['light', LIGHT], ['dark', DARK]]) {
    for (const k of ['ok', 'warn', 'err', 'info', 'unknown', 'control-border', 'focus', 'accent']) {
      for (const bg of ['surface', 'bg']) assert.ok(ratio(t[k], t[bg]) >= 3, `${mode} ${k} on ${bg}: ${ratio(t[k], t[bg]).toFixed(2)}`);
    }
    for (const k of ['control-border', 'focus']) assert.ok(ratio(t[k], t.head) >= 3, `${mode} ${k} on head`);
    for (const [k, bg] of Object.entries(tint)) assert.ok(ratio(t[k], t[bg]) >= 3, `${mode} ${k} on ${bg}`);
    assert.ok(ratio(t['control-border'], t['warn-bg']) >= 3, `${mode} LAN banner edge on its tint`);
  }
});

test('the decorative --line colour is only used on top or bottom separators (1.4.11)', () => {
  for (const r of RULES) {
    for (const [prop, val] of r.decls) {
      if (!/var\(--line\)/.test(val)) continue;
      assert.match(prop, /^border-(top|bottom)(-color)?$/, `${r.sel} uses --line in ${prop}`);
    }
    for (const [prop, val] of r.decls) {
      if (/^(border|border-color|outline)$/.test(prop)) {
        for (const m of val.matchAll(/var\(--([\w-]+)\)/g)) assert.ok(['control-border', 'accent', 'focus'].includes(m[1]), `${r.sel} ${prop} uses --${m[1]}`);
      }
    }
  }
});

test('status words use the text colour, only the icon takes the status colour (1.4.1)', () => {
  assert.equal(declOf('.status span', 'color'), 'var(--text)');
  for (const k of ['ok', 'warn', 'error', 'info', 'pending', 'unknown', 'skipped']) assert.ok(declOf('.s-' + k, 'color'), 's-' + k);
});

test('focus ring: 2 px solid --focus, offset 2 px, never removed (2.4.7, 2.4.11, 2.4.13)', () => {
  assert.equal(declOf(':focus-visible', 'outline'), '2px solid var(--focus)');
  assert.equal(declOf(':focus-visible', 'outline-offset'), '2px');
  for (const r of RULES) for (const [prop, val] of r.decls) {
    if (prop === 'outline') assert.doesNotMatch(val, /^(none|0)\b/, r.sel);
    if (prop === 'position') assert.ok(!/sticky|fixed/.test(val) || r.sel === '.drawer', `${r.sel} position ${val}`);
  }
  assert.ok(RULES.some((r) => r.media.some((m) => m.includes('forced-colors: active'))));
});

test('no motion, no hover-only reveal, no important, no px type (2.3.3, 1.4.13, 1.4.12, 1.4.4)', () => {
  assert.doesNotMatch(CSS, /@keyframes/);
  assert.doesNotMatch(CSS, /!important/);
  for (const r of RULES) for (const [prop, val] of r.decls) {
    if (/^(animation|transition)/.test(prop)) assert.ok(r.media.some((m) => m.includes('prefers-reduced-motion: no-preference')), r.sel);
    if (prop === 'font-size') assert.doesNotMatch(val, /px/, r.sel);
    if (prop === 'font') assert.doesNotMatch(val, /\d(px)\b/, r.sel);
    if (prop === 'height') assert.ok(r.sel === '.sr-only', r.sel + ' has a fixed height');
  }
  assert.ok(!RULES.some((r) => /:hover/.test(r.sel) && r.decls.some((d) => /^(display|visibility|opacity)$/.test(d[0]))));
  assert.equal(declOf('[hidden]', 'display'), 'none');
});

test('reflow: one column by default, wide layouts only in min-width queries, wrapping text (1.4.10)', () => {
  assert.equal(declOf('#columns', 'grid-template-columns'), '1fr');
  for (const r of RULES) for (const [prop, val] of r.decls) {
    if (prop === 'grid-template-columns' && r.sel === '#columns') continue;
    if (prop === 'min-width' && !r.media.length) assert.ok(px(val) <= 320 || val === '0', `${r.sel} min-width ${val}`);
    if (prop === 'white-space') assert.ok(!/nowrap/.test(val) || r.sel === '.sr-only', r.sel);
  }
  for (const r of rulesFor('#columns').filter((x) => x.media.length)) {
    assert.ok(r.media.every((m) => /min-width:\s*(4\d|9\d)rem/.test(m)), r.media.join());
  }
  assert.equal(declOf('.card', 'overflow-wrap'), 'anywhere');
});

test('buttons and the skip link are at least 44 px (2.5.8)', () => {
  assert.ok(px(declOf('button', 'min-height')) >= 44);
  assert.ok(px(declOf('button', 'min-width')) >= 44);
  assert.ok(px(declOf('.skip', 'min-height')) >= 44);
});

test('drawer panel is styled and fits 320 px (1.4.10, 1.4.4)', () => {
  const rule = rulesFor('.drawer').filter((r) => !r.media.length)[0];
  assert.ok(rule, 'no .drawer rule: the dialog renders unstyled below the page');
  const d = Object.fromEntries(rule.decls);
  assert.ok(/fixed|absolute/.test(d.position ?? ''), 'panel position');
  assert.ok(/auto|scroll/.test(d['overflow-y'] ?? d.overflow ?? ''), 'panel scrolls');
  assert.ok(/min\(|100vw|100%|inset/.test(rule.body), 'panel width bounded by the viewport');
  assert.equal(d['overflow-wrap'], 'anywhere', 'long slug wraps');
  assert.ok(!px(d['min-width']) || px(d['min-width']) <= 320);
});

test('drawer links and close buttons are 44 px targets (2.5.8)', () => {
  const sel = '.links a';
  assert.ok(rulesFor(sel).length, 'no ' + sel + ' rule');
  assert.ok(px(declOf(sel, 'min-height')) >= 44);
  assert.match(declOf(sel, 'display') ?? '', /^(inline-flex|flex|block|inline-block|grid)$/);
});

// ---- rendered board and drawer ----------------------------------------------------------------

test('board: landmarks, heading order, names, ids (1.3.1, 4.1.2, 2.4.6)', async () => {
  const env = await boot();
  const body = env.doc.body;
  const heads = all(body, (n) => /^h[1-6]$/.test(n.tagName) && shown(n));
  assert.equal(heads[0].tagName, 'h1');
  let prev = 0;
  for (const h of heads) {
    const lvl = Number(h.tagName[1]);
    assert.ok(lvl <= prev + 1, `heading ${h.textContent} jumps from h${prev} to h${lvl}`);
    assert.ok(h.textContent.trim().length > 0);
    prev = lvl;
  }
  assert.equal(tags(body, 'h1').length, 1);
  assert.deepEqual(heads.filter((h) => h.tagName === 'h3' && h.id.startsWith('col-')).map((h) => h.id), COLS.map((c) => 'col-' + c));
  for (const s of tags(body, 'section')) {
    assert.ok(nameOf(s).length > 0, 'section without a name');
    assert.ok(all(body, (n) => n.id === s.getAttribute('aria-labelledby')).length === 1);
  }
  const ids = all(body, (n) => n.id).map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
  for (const n of all(body, (x) => x.attrs.has('aria-describedby'))) {
    assert.ok(all(body, (x) => x.id === n.getAttribute('aria-describedby')).length === 1);
  }
  for (const n of tags(body, 'button', 'a')) {
    if (n.tagName === 'a' && n.getAttribute('href') === null) continue;
    if (!shown(n)) continue;
    const name = nameOf(n);
    assert.ok(name.length > 0, n.className + ' has no name');
    const label = n.getAttribute('aria-label');
    if (label) assert.ok(label.toLowerCase().includes(spoken(n).trim().toLowerCase()), 'label in name: ' + label);
  }
  assert.equal(env.byId('board').getAttribute('aria-busy'), null);
  assert.equal(env.byId('status').textContent, '');
});

test('board: every status is a word plus an aria-hidden icon (1.1.1, 1.4.1)', async () => {
  const env = await boot();
  const chips = all(env.doc.body, (n) => /\bstatus\b/.test(n.className) && n.tagName === 'span' && shown(n));
  const words = new Set(chips.map((c) => c.children.find((x) => x.tagName === 'span')?.textContent));
  for (const w of ['Needs you', 'Live', 'Stale', 'Done', 'Not recorded', 'Unreadable', 'Needs info', 'Declined']) assert.ok(words.has(w), 'no chip for ' + w);
  for (const c of chips) {
    const svgs = tags(c, 'svg');
    assert.equal(svgs.length, 1);
    assert.equal(svgs[0].getAttribute('aria-hidden'), 'true');
    assert.equal(svgs[0].getAttribute('focusable'), 'false');
    assert.ok(spoken(c).trim().length > 0, 'icon without a word');
  }
  for (const s of tags(env.doc.body, 'svg')) assert.equal(s.getAttribute('aria-hidden'), 'true');
  const lan = env.byId('lan');
  assert.equal(lan.hidden, false);
  assert.ok(tags(lan, 'svg').length === 1 && spoken(lan).trim().length > 0);
});

test('board: only native controls act, no key, drag or focus handlers on the page (2.1.1, 2.1.4, 2.5.7, 3.2.1)', async () => {
  const env = await boot();
  await openDrawer(env);
  assert.deepEqual(env.doc.handlers, []);
  assert.deepEqual(env.ctx.windowHandlers, []);
  for (const n of all(env.doc.root)) {
    for (const type of Object.keys(n.listeners)) {
      if (type === 'click') assert.ok(['button', 'a'].includes(n.tagName), `click on ${n.tagName}`);
      else if (type === 'keydown') assert.equal(n.id, 'drawer');
      else assert.fail(`${type} listener on ${n.tagName}`);
    }
  }
  const buttons = all(env.doc.body, (n) => n.tagName === 'button' && shown(n));
  for (const b of buttons) assert.equal(b.type, 'button');
});

test('board: tab order is skip link, header, then the board; needs-you link reaches its column (1.3.2, 2.4.3, 2.4.4)', async () => {
  const env = await boot();
  const order = focusables(env.doc.body);
  assert.equal(order[0].getAttribute('href'), '#board');
  const link = order.find((n) => n.tagName === 'a' && n.getAttribute('href') === '#col-needs-ceo');
  const pause = env.byId('pause');
  assert.ok(order.indexOf(link) > 0 && order.indexOf(link) < order.indexOf(pause));
  const firstCard = order.findIndex((n) => n.className === 'title');
  assert.ok(order.indexOf(pause) < firstCard);
  assert.match(spoken(link), /^2 needs you$/);
  const target = env.byId('col-needs-ceo');
  assert.equal(target.getAttribute('tabindex'), '-1');
  await link.click();
  assert.equal(env.doc.activeElement, target);
  assert.ok(order.every((n) => n.tabIndex <= 0));
});

test('board: title carries the needs-you count and moves are announced once (2.4.2, 4.1.3)', async () => {
  const env = await boot([BOARD, MOVED, NO_ASK]);
  assert.equal(env.doc.title, '(2) aico dashboard');
  assert.equal(env.byId('status').textContent, '');
  await env.fire();
  assert.match(env.byId('status').textContent, /moved to Review/);
  await env.fire();
  assert.equal(env.doc.title, 'aico dashboard');
  assert.equal(env.byId('lan').hidden, true);
});

test('pause: state, label, status text, no fetch while paused, focus kept (2.2.2, 4.1.2, 4.1.3)', async () => {
  const env = await boot();
  const pause = env.byId('pause');
  pause.focus();
  assert.equal(pause.getAttribute('aria-pressed'), 'false');
  assert.equal(env.byId('paused').hidden, true);
  await pause.click();
  assert.equal(pause.getAttribute('aria-pressed'), 'true');
  assert.equal(nameOf(pause), 'Pause updates');
  assert.equal(env.byId('paused').hidden, false);
  assert.equal(env.byId('paused').textContent, 'Paused');
  assert.equal(env.byId('status').textContent, 'Updates paused');
  const before = env.fetches.length;
  await env.fire();
  await env.fire();
  assert.equal(env.fetches.length, before);
  await pause.click();
  await settle();
  assert.equal(pause.getAttribute('aria-pressed'), 'false');
  assert.equal(env.byId('status').textContent, 'Updates resumed');
  assert.ok(env.fetches.length > before, 'resume fetches at once');
  assert.equal(env.doc.activeElement, pause);
  assert.equal(pause.listeners.keydown, undefined, 'Enter and Space use the native click');
  assert.equal(env.byId('paused').hidden, true);
});

test('drawer: named modal dialog, title focus, background inert, headings in order (4.1.2, 1.3.1, 3.2.2)', async () => {
  const env = await boot();
  const d = await openDrawer(env);
  assert.equal(d.getAttribute('role'), 'dialog');
  assert.equal(d.getAttribute('aria-modal'), 'true');
  assert.ok(nameOf(d).startsWith('Run: Run 2026-11-04-0119-demo'));
  assert.equal(env.doc.activeElement.id, 'drawer-title');
  assert.equal(env.doc.activeElement.getAttribute('tabindex'), '-1');
  for (const n of [env.byId('board'), tags(env.doc.body, 'header')[0], tags(env.doc.body, 'a')[0]]) assert.equal(n.getAttribute('inert'), '');
  const heads = all(d, (n) => /^h[1-6]$/.test(n.tagName) && shown(n));
  assert.equal(heads[0].tagName, 'h2');
  let prev = 2;
  for (const h of heads.slice(1)) {
    assert.ok(Number(h.tagName[1]) <= prev + 1 && h.textContent.trim(), h.textContent);
    prev = Number(h.tagName[1]);
  }
  assert.ok(heads.some((h) => h.textContent === 'Steps') && heads.some((h) => h.textContent === 'Role times'));
  assert.equal(all(env.doc.body, (n) => n.attrs.has('aria-pressed') && n.id !== 'pause').length, 0);
});

test('drawer: statuses are word plus aria-hidden icon, tables and lists are real elements (1.4.1, 1.3.1)', async () => {
  const env = await boot();
  const d = await openDrawer(env);
  const chips = all(d, (n) => /\bstatus\b/.test(n.className) && shown(n));
  const words = chips.map((c) => spoken(c).trim());
  for (const w of ['done', 'blocked', 'needs-ceo', 'handover', 'running', 'odd', 'Gate pass', 'Gate fail', 'Review approve', 'Review changes', 'Review blocked', 'Gate: verdict not recorded', 'over cap']) assert.ok(words.includes(w), 'no chip ' + w);
  for (const c of chips) {
    assert.equal(tags(c, 'svg')[0]?.getAttribute('aria-hidden'), 'true');
    assert.ok(spoken(c).trim().length > 0);
  }
  for (const s of tags(d, 'svg')) assert.equal(s.getAttribute('aria-hidden'), 'true');
  const table = tags(d, 'table')[0];
  assert.ok(tags(table, 'caption')[0].textContent.length > 0);
  assert.ok(tags(table, 'th').length > 0 && tags(table, 'th').every((t) => t.getAttribute('scope') === 'col'));
  assert.equal(tags(d, 'ol').length, 1);
  assert.equal(tags(d, 'li').filter((l) => l.className === 'step').length, 6);
  assert.equal(all(d, (n) => ['script', 'img', 'iframe'].includes(n.tagName)).length, 0);
});

test('drawer: links are real anchors with names and safe rel (2.4.4, 4.1.2)', async () => {
  const env = await boot();
  const d = await openDrawer(env);
  const links = tags(d, 'a');
  assert.deepEqual(links.map((a) => spoken(a)), ['PR #7 (open)', 'Issue #3']);
  for (const a of links) {
    assert.match(a.getAttribute('href'), /^https:\/\/github\.com\//);
    assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
  }
});

test('drawer: Tab stays inside, printable keys do nothing, Escape closes and focus returns (2.1.1, 2.1.2, 2.1.4, 2.4.3)', async () => {
  const env = await boot();
  const d = await openDrawer(env);
  const order = focusables(d);
  const first = order[0];
  const last = order.at(-1);
  assert.equal(nameOf(first), 'Close');
  assert.equal(nameOf(last), 'Close');
  assert.equal(order.length, 2 + 2, 'two Close buttons and two links');
  last.focus();
  assert.equal(last.key('Tab'), true);
  assert.equal(env.doc.activeElement, first);
  assert.equal(first.key('Tab', { shiftKey: true }), true);
  assert.equal(env.doc.activeElement, last);
  assert.equal(first.key('a'), false);
  assert.equal(first.key('x', { shiftKey: true }), false);
  assert.equal(d.hidden, false);
  first.key('Escape');
  assert.equal(d.hidden, true);
  assert.equal(env.doc.activeElement, env.opener);
  assert.equal(env.byId('board').getAttribute('inert'), null);
  assert.equal(tags(env.doc.body, 'header')[0].getAttribute('inert'), null);
});

test('drawer: Close button returns focus to the card that opened it (2.4.3)', async () => {
  const env = await boot();
  const d = await openDrawer(env);
  await focusables(d)[0].click();
  assert.equal(d.hidden, true);
  assert.equal(env.doc.activeElement, env.opener);
});
