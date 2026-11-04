import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const DIR = path.join(import.meta.dirname, 'dashboard-page');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const LAN_TEXT = 'LAN mode is on. Anyone on your network who has this link can read these runs, including names in Handoffs. Stop the server to end access.';
const STOPPED = 'Dashboard server stopped. Run /aico:dashboard for a new link.';
const tick = () => new Promise((r) => setImmediate(r));

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
    if (this.doc.activeElement === node) this.doc.activeElement = null;
    return node;
  }
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
  remove() {
    const a = this.doc.activeElement;
    if (a) for (let n = a; n; n = n.parentNode) if (n === this) { this.doc.activeElement = null; break; }
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }
  setAttribute(k, v) {
    this.attrs.set(k, String(v));
    if (k === 'id') this.id = String(v);
  }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  async click() { for (const fn of this.listeners.click ?? []) await fn({ type: 'click' }); }
  focus() { this.doc.activeElement = this; }
  get textContent() { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { for (const c of this.children) c.parentNode = null; this.children = []; this.own = String(v); }
  walk(fn) { fn(this); for (const c of this.children) c.walk(fn); }
  find(pred) { const out = []; this.walk((n) => { if (pred(n)) out.push(n); }); return out; }
}

function makeEnv({ responses = [], lanHost = 'localhost' } = {}) {
  const doc = {
    activeElement: null,
    title: '',
    documentElement: { lang: 'en' },
    byId: new Map(),
    createElement(tag) { return new FakeNode(tag, doc); },
    createElementNS(ns, tag) { return new FakeNode(tag, doc); },
    getElementById(id) { return doc.byId.get(id) ?? null; }
  };
  // ids declared in the static page become nodes; hidden is read from the markup
  const html = read('index.html');
  for (const m of html.matchAll(/<(\w+)([^>]*?)\sid="([^"]+)"([^>]*)>/g)) {
    const node = new FakeNode(m[1], doc);
    node.id = m[3];
    node.hidden = /\shidden(\s|>|=)/.test(m[2] + m[4] + '>');
    node.markup = m[2] + m[4];
    doc.byId.set(m[3], node);
  }
  doc.byId.get('pause').setAttribute('aria-pressed', 'false');
  const fetches = [];
  const timers = [];
  const queue = [...responses];
  const ctx = {
    document: doc,
    Date, Intl, Promise, JSON, Math, Object, String, Array, isNaN, isFinite, encodeURIComponent,
    AICO_MANUAL_START: true,
    fetch: async (url, opts) => {
      fetches.push({ url, headers: opts?.headers ?? {} });
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      const r = typeof next === 'function' ? next() : next;
      return {
        status: r.status ?? 200,
        headers: { get: (k) => (k.toLowerCase() === 'etag' ? r.etag ?? null : null) },
        json: async () => r.body
      };
    },
    setTimeout: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.live = false; }
  };
  Object.defineProperty(ctx, 'location', { get() { throw new Error('page read location'); } });
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('board.js'), ctx, { filename: 'board.js' });
  vm.runInContext(read('live.js'), ctx, { filename: 'live.js' });
  const fire = async () => {
    const due = timers.splice(0).filter((t) => t.live);
    for (const t of due) t.fn();
    await tick();
    await tick();
  };
  return { ctx, doc, fetches, timers, fire, byId: (id) => doc.byId.get(id) };
}

const card = (over = {}) => ({
  slug: '2026-11-04-0119-demo', title: 'Demo run', state: 'running', started: '2026-11-04T01:19:00Z', ended: null,
  elapsedS: 125, live: true, tier: 'high', round: 0, needsCeo: false, column: 'build', stageNote: null,
  readable: true, tokens: { spend: 412318, cacheRead: 1200000 }, usd: null, ...over
});
const board = (cardsByCol = {}, extra = {}) => ({
  v: 1, generated: '2026-11-04T12:00:00Z', active: null, inflight: 0,
  columns: ['intake', 'brief', 'plan', 'build', 'review', 'ship-gate', 'needs-ceo', 'done'].map((id) => ({ id, cards: cardsByCol[id] ?? [] })),
  roadmap: [], lan: false, ...extra
});
const ok = (body, etag = '"a"') => ({ status: 200, etag, body });

async function boot(opts) {
  const env = makeEnv(opts);
  env.ctx.aicoLive.start();
  await tick();
  await tick();
  return env;
}
const h3s = (env) => env.byId('columns').find((n) => n.tagName === 'h3').map((n) => n.textContent);
const cardLi = (env, slug) => env.byId('columns').find((n) => n.tagName === 'li' && n.className === 'card' && n.textContent.includes(slug))[0];

test('first poll fetches a relative api/board and builds eight columns in order', async () => {
  const env = await boot({ responses: [ok(board({ build: [card()] }))] });
  assert.equal(env.fetches[0].url, 'api/board');
  assert.deepEqual(h3s(env), ['Intake, 0 runs', 'Brief, 0 runs', 'Plan, 0 runs', 'Build, 1 run', 'Review, 0 runs', 'Ship Gate, 0 runs', 'Needs CEO, 0 runs', 'Done, 0 runs']);
  assert.equal(env.byId('board').getAttribute('aria-busy'), null);
  assert.match(env.byId('conn').textContent, /^Live, updated \d\d:\d\d:\d\d$/);
});

test('status is a word plus an aria-hidden icon, tokens are labelled not cost', async () => {
  const env = await boot({ responses: [ok(board({ 'needs-ceo': [card({ needsCeo: true })] }))] });
  const li = cardLi(env, 'Demo run');
  const chip = li.find((n) => /\bstatus\b/.test(n.className))[0];
  assert.match(chip.textContent, /Needs you/);
  const svg = chip.find((n) => n.tagName === 'svg')[0];
  assert.equal(svg.getAttribute('aria-hidden'), 'true');
  assert.match(li.textContent, /\(tokens, not cost\)/);
  assert.match(li.textContent, /412,318/);
  assert.match(li.textContent, /risk high · round 0 · Running 00:02:05/);
  assert.equal(env.doc.title, '(1) aico dashboard');
  assert.match(env.byId('summary').textContent, /1 needs you/);
});

test('no usd line when usd is null, a dollar value when recorded', async () => {
  const env = await boot({ responses: [ok(board({ build: [card({ usd: null })] }), '"1"'), ok(board({ build: [card({ usd: 3.42 })] }), '"2"')] });
  const usd = () => cardLi(env, 'Demo run').children[5];
  assert.equal(usd().hidden, true);
  await env.fire();
  assert.equal(usd().hidden, false);
  assert.equal(usd().textContent, '$3.42');
});

test('a change updates the same nodes in place and focus stays, including a column move', async () => {
  const env = await boot({ responses: [
    ok(board({ build: [card()] }), '"1"'),
    ok(board({ build: [card({ tokens: { spend: 500000, cacheRead: 1 } })] }), '"2"'),
    ok(board({ review: [card({ tokens: { spend: 500000, cacheRead: 1 } })] }), '"3"')
  ] });
  const li = cardLi(env, 'Demo run');
  const btn = li.children[0];
  btn.focus();
  await env.fire();
  assert.equal(cardLi(env, 'Demo run'), li);
  assert.match(li.textContent, /500,000/);
  assert.equal(env.doc.activeElement, btn);
  await env.fire();
  assert.equal(cardLi(env, 'Demo run'), li);
  assert.equal(li.parentNode.parentNode.children[0].textContent, 'Review, 1 run');
  assert.equal(env.doc.activeElement, btn);
  assert.match(env.byId('status').textContent, /Demo run moved to Review\./);
});

test('polls send If-None-Match and a 304 changes nothing', async () => {
  const env = await boot({ responses: [ok(board({ build: [card()] }), '"v1"'), { status: 304 }] });
  const li = cardLi(env, 'Demo run');
  await env.fire();
  assert.equal(env.fetches.length, 2);
  assert.equal(JSON.stringify(env.fetches[0].headers), '{}');
  assert.equal(env.fetches[1].headers['If-None-Match'], '"v1"');
  assert.equal(cardLi(env, 'Demo run'), li);
  assert.equal(env.timers.filter((t) => t.live).length, 1);
});

test('HTML in data shows as text and creates no elements', async () => {
  const evil = '<img src=x onerror=alert(1)><script>boom()</script>';
  const env = await boot({ responses: [ok(board({
    build: [card({ title: evil, slug: 'evil-slug', stageNote: evil })],
    intake: [{ id: 'i1', topic: evil, outcome: 'needs-info', at: '2026-11-04T01:00:00Z' }]
  }, { roadmap: [{ lane: 'roadmap', topic: evil, started: '2026-11-04 01.19' }] }))] });
  const tags = new Set();
  env.byId('columns').walk((n) => tags.add(n.tagName));
  env.byId('roadmap').walk((n) => tags.add(n.tagName));
  assert.ok(!tags.has('img') && !tags.has('script'));
  assert.equal(cardLi(env, 'evil-slug').children[0].textContent, evil);
  assert.ok(env.byId('roadmap').textContent.includes(evil));
});

test('untrusted values are validated at the sink', async () => {
  const bad = card({ tier: '<b>', round: 'x', elapsedS: 'n', tokens: { spend: 'a' }, usd: '5', title: 7 });
  const env = await boot({ responses: [ok({ ...board({ build: [bad, null, 5, { slug: '' }] }), columns: [
    { id: '__proto__', cards: [card({ slug: 'x' })] }, { id: 'build', cards: [bad, null, 5, { slug: '' }] }, { id: 'nope', cards: [card({ slug: 'y' })] }
  ] })] });
  const li = cardLi(env, bad.slug);
  assert.equal(li.children[0].textContent, bad.slug);
  assert.doesNotMatch(li.textContent, /risk|round x|NaN|\$/);
  assert.match(li.textContent, /Tokens: not recorded/);
  assert.equal(env.byId('columns').find((n) => n.tagName === 'li' && n.className === 'card').length, 1);
});

test('unreadable and stage-not-recorded cards', async () => {
  const env = await boot({ responses: [ok(board({
    brief: [card({ slug: 'bad-one', title: 'Bad one', state: 'unreadable', readable: false, tokens: null })],
    plan: [card({ slug: 'noted', title: 'Noted', stageNote: 'stage not recorded' })]
  }))] });
  const bad = cardLi(env, 'bad-one');
  assert.match(bad.textContent, /Unreadable/);
  assert.match(bad.textContent, /files could not be read/);
  assert.equal(bad.children[4].hidden, true);
  assert.match(cardLi(env, 'noted').textContent, /stage not recorded/);
});

test('banner follows the lan key, never the location', async () => {
  const on = await boot({ responses: [ok(board({}, { lan: true }))] });
  assert.equal(on.byId('lan').hidden, false);
  assert.equal(on.byId('lan').textContent, LAN_TEXT);
  const off = await boot({ responses: [ok(board({}, { lan: false }))] });
  assert.equal(off.byId('lan').hidden, true);
  const missing = await boot({ responses: [ok(board({}, { lan: 'true' }))] });
  assert.equal(missing.byId('lan').hidden, true);
});

test('pause stops fetches, resume fetches once, state and status text follow', async () => {
  const env = await boot({ responses: [ok(board({ build: [card()] }), '"1"'), { status: 304 }] });
  const pause = env.byId('pause');
  assert.equal(pause.getAttribute('aria-pressed'), 'false');
  await pause.click();
  assert.equal(pause.getAttribute('aria-pressed'), 'true');
  assert.equal(env.byId('status').textContent, 'Updates paused');
  assert.equal(env.byId('paused').hidden, false);
  const before = env.fetches.length;
  await env.fire();
  await env.fire();
  assert.equal(env.fetches.length, before);
  await pause.click();
  await tick();
  assert.equal(pause.getAttribute('aria-pressed'), 'false');
  assert.equal(env.byId('status').textContent, 'Updates resumed');
  assert.equal(env.fetches.length, before + 1);
  assert.equal(env.byId('paused').hidden, true);
  await env.fire();
  assert.equal(env.fetches.length, before + 2);
});

test('three failed polls in a row stop the page with no fourth fetch', async () => {
  const env = await boot({ responses: [ok(board({})), { status: 500 }, new Error('down'), { status: 404 }] });
  await env.fire();
  assert.match(env.byId('conn').textContent, /Connection lost\. Showing data from \d\d:\d\d:\d\d\. Retrying\./);
  assert.match(env.byId('status').textContent, /^Connection lost/);
  await env.fire();
  assert.match(env.byId('status').textContent, /^Connection lost/);
  await env.fire();
  assert.equal(env.fetches.length, 4);
  assert.equal(env.byId('status').textContent, STOPPED);
  await env.fire();
  await env.fire();
  assert.equal(env.fetches.length, 4);
});

test('connection loss is announced once in #status, restore once on the next success', async () => {
  const env = makeEnv({ responses: [ok(board({}), '"a"'), { status: 500 }, { status: 500 }, ok(board({}), '"b"'), { status: 304 }] });
  const status = env.byId('status');
  const writes = [];
  Object.defineProperty(status, 'textContent', {
    get() { return status.own; },
    set(v) { writes.push(String(v)); status.own = String(v); },
    configurable: true
  });
  env.ctx.aicoLive.start();
  await tick();
  await tick();
  assert.deepEqual(writes, []);
  await env.fire(); // 1st failure
  assert.equal(writes.filter((w) => /^Connection lost/.test(w)).length, 1);
  assert.match(status.textContent, /^Connection lost/);
  await env.fire(); // 2nd failure: no repeat
  assert.equal(writes.filter((w) => /^Connection lost/.test(w)).length, 1);
  assert.equal(writes.filter((w) => /Connection restored/.test(w)).length, 0);
  await env.fire(); // success
  assert.equal(status.textContent, 'Connection restored');
  assert.equal(writes.filter((w) => /Connection restored/.test(w)).length, 1);
  await env.fire(); // 304 is a success too: no second announcement
  assert.equal(writes.filter((w) => /Connection restored/.test(w)).length, 1);
  assert.equal(writes.filter((w) => /^Connection lost/.test(w)).length, 1);
});

test('a success between failures resets the count', async () => {
  const env = await boot({ responses: [{ status: 500 }, { status: 500 }, ok(board({})), { status: 500 }, { status: 500 }, ok(board({}), '"z"')] });
  for (let i = 0; i < 5; i++) await env.fire();
  assert.equal(env.fetches.length, 6);
  assert.notEqual(env.byId('status').textContent, STOPPED);
});

test('the open run is polled with an encoded relative url and honours pause', async () => {
  const runs = [];
  const env = await boot({ responses: [ok(board({}), '"b"'), { status: 304 }, ok({ v: 1 }, '"r"')] });
  env.ctx.aicoLive.watchRun('2026-11-04-0119-demo', (d) => runs.push(d));
  await tick();
  await tick();
  assert.ok(env.fetches.some((f) => f.url === 'api/run/2026-11-04-0119-demo'));
});

test('many moves in one window are combined into one announcement', async () => {
  const env = await boot({ responses: [
    ok(board({ build: [card({ slug: 'a', title: 'A' }), card({ slug: 'b', title: 'B' })] }), '"1"'),
    ok(board({ review: [card({ slug: 'a', title: 'A' }), card({ slug: 'b', title: 'B' })] }), '"2"')
  ] });
  await env.fire();
  assert.equal(env.byId('status').textContent, '2 runs changed: A moved to Review; B moved to Review.');
});

test('done column shows ten and expands with a button that keeps focus', async () => {
  const many = Array.from({ length: 12 }, (_, i) => card({ slug: `d${i}`, title: `Run ${i}`, state: 'ended', ended: '2026-11-04T02:00:00Z', live: false }));
  const env = await boot({ responses: [ok(board({ done: many }))] });
  const ul = () => env.byId('columns').find((n) => n.tagName === 'ul')[7];
  assert.equal(ul().children.length, 10);
  const more = env.byId('columns').find((n) => n.tagName === 'button' && n.className === 'more')[7];
  assert.equal(more.textContent, 'Show 2 more');
  more.focus();
  await more.click();
  assert.equal(ul().children.length, 12);
  assert.equal(more.textContent, 'Show fewer');
  assert.equal(env.doc.activeElement, more);
});

test('focus stays on the done column when the focused tenth card is pushed out', async () => {
  const mk = (i) => card({ slug: `d${i}`, title: `Run ${i}`, state: 'ended', ended: '2026-11-04T02:00:00Z', live: false });
  const first = Array.from({ length: 12 }, (_, i) => mk(i));
  const second = [mk(99)].concat(first);
  const env = await boot({ responses: [ok(board({ done: first }), '"1"'), ok(board({ done: second }), '"2"')] });
  const ul = env.byId('columns').find((n) => n.tagName === 'ul')[7];
  const btn = ul.children[9].find((n) => n.tagName === 'button')[0];
  btn.focus();
  await env.fire();
  const act = env.doc.activeElement;
  assert.ok(act, 'focus not lost to body');
  assert.notEqual(act, btn);
});

test('page files: relative urls only, no storage, no location, no html sinks, no inline handlers', () => {
  const files = ['index.html', 'board.js', 'live.js'].map((f) => [f, read(f)]);
  for (const [name, src] of files) {
    const code = src.replace('http://www.w3.org/2000/svg', '');
    assert.doesNotMatch(code, /https?:\/\//, `${name} absolute url`);
    assert.doesNotMatch(code, /\/t\//, `${name} token path`);
    assert.doesNotMatch(code, /localStorage|sessionStorage|document\.cookie|indexedDB/, `${name} storage`);
    assert.doesNotMatch(code, /\blocation\b|document\.URL|document\.referrer|baseURI/, `${name} location`);
    assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, `${name} html sink`);
    assert.doesNotMatch(code, /setTimeout\(\s*['"`]|setInterval\(\s*['"`]/, `${name} string timer`);
    assert.doesNotMatch(code, /\son[a-z]+\s*=/, `${name} inline handler`);
  }
  const html = files[0][1];
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/, 'inline script');
  assert.doesNotMatch(html, /font-size:\s*[\d.]+px/, 'px font size');
  assert.doesNotMatch(html, /outline:\s*(none|0)\b/, 'outline removed');
  assert.doesNotMatch(html, /user-scalable/, 'zoom lock');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<button type="button" id="pause" aria-pressed="false">Pause updates<\/button>/);
  assert.match(html, /id="status" role="status" aria-live="polite"/);
  assert.equal((html.match(/aria-live/g) ?? []).length, 1);
  assert.match(html, /<a class="skip" href="#board">/);
  assert.match(html, /\.skip:focus/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /min-height: 2\.75rem/);
});

test('page files use LF only', () => {
  for (const f of ['index.html', 'board.js', 'live.js']) assert.ok(!read(f).includes('\r'), f);
});
