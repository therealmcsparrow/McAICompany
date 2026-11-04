import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const DIR = path.join(import.meta.dirname, 'dashboard-page');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
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
    this.tabIndex = 0;
  }
  append(...kids) {
    for (const k of kids) {
      if (k.parentNode) k.parentNode.children = k.parentNode.children.filter((c) => c !== k);
      k.parentNode = this;
      this.children.push(k);
    }
  }
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
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
  find(pred) { const out = []; const w = (n) => { if (pred(n)) out.push(n); n.children.forEach(w); }; w(this); return out; }
}

function makeEnv({ links = { state: 'none' }, linksStatus = 200 } = {}) {
  const doc = { activeElement: null, byId: new Map(), createElement: (t) => new FakeNode(t, doc), createElementNS: (n, t) => new FakeNode(t, doc), getElementById: (i) => doc.byId.get(i) ?? null };
  doc.body = new FakeNode('body', doc);
  const header = new FakeNode('header', doc);
  const main = new FakeNode('main', doc);
  main.id = 'board';
  doc.byId.set('board', main);
  const skip = new FakeNode('a', doc);
  skip.className = 'skip';
  const opener = new FakeNode('button', doc);
  main.append(opener);
  opener.own = 'Demo run';
  doc.body.append(skip, header, main);
  const fetches = [];
  const watch = [];
  const announced = [];
  const ctx = {
    document: doc, Date, URL, JSON, Math, Object, String, Array, isNaN, isFinite, encodeURIComponent,
    fetch: async (url) => {
      fetches.push(url);
      return { status: linksStatus, json: async () => links };
    },
    aicoLive: { watchRun: (slug, cb) => watch.push({ slug, cb }), announce: (t) => announced.push(t) },
    aicoBoard: { onOpen: null }
  };
  Object.defineProperty(ctx, 'location', { get() { throw new Error('page read location'); } });
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('drawer.js'), ctx, { filename: 'drawer.js' });
  return { ctx, doc, fetches, watch, announced, opener, header, main, skip };
}

const SLUG = '2026-11-04-0119-demo';
const run = (over = {}) => ({
  v: 1, slug: SLUG,
  steps: [{ step: '01', role: 'architect', status: 'done', round: 0, summary: 'Wrote the plan' }],
  rounds: [{ round: 0, gate: 'pass', review: null }], routing: ['code-reviewer'], active: null, ...over
});
const dlg = (env) => env.doc.body.children.find((n) => n.id === 'drawer');
const open = async (env) => { env.ctx.aicoBoard.onOpen(SLUG, env.opener); await tick(); await tick(); };
const lastCb = (env) => env.watch[env.watch.length - 1].cb;
const closeButtons = (env) => dlg(env).find((n) => n.tagName === 'button' && n.textContent === 'Close');

test('onOpen is wired, opens a modal dialog, watches the run and focuses the title', async () => {
  const env = makeEnv();
  await open(env);
  const d = dlg(env);
  assert.equal(d.getAttribute('role'), 'dialog');
  assert.equal(d.getAttribute('aria-modal'), 'true');
  assert.equal(d.hidden, false);
  assert.equal(env.watch[0].slug, SLUG);
  assert.equal(env.doc.activeElement.id, 'drawer-title');
  assert.equal(env.doc.activeElement.tagName, 'h2');
  assert.equal(env.header.getAttribute('inert'), '');
  assert.equal(env.main.getAttribute('inert'), '');
  assert.equal(env.skip.getAttribute('inert'), '');
});

test('links fetch uses a relative encoded path', async () => {
  const env = makeEnv();
  await open(env);
  assert.deepEqual(env.fetches, ['api/run/' + encodeURIComponent(SLUG) + '/links']);
});

test('steps render with plain-text Did, word plus aria-hidden icon', async () => {
  const env = makeEnv();
  await open(env);
  const evil = '<script>boom()</script><img src=x onerror=alert(1)>';
  lastCb(env)(run({ steps: [{ step: '01', role: 'architect', status: 'done', round: 0, summary: evil }, { step: '02', role: 'qa', status: 'needs-ceo', round: 0, summary: null }] }));
  const d = dlg(env);
  const items = d.find((n) => n.tagName === 'li' && n.className === 'step');
  assert.equal(items.length, 2);
  assert.equal(items[0].find((n) => n.className === 'did')[0].textContent, evil);
  assert.equal(d.find((n) => ['script', 'img'].includes(n.tagName)).length, 0);
  assert.match(items[0].textContent, /01 architect/);
  assert.match(items[0].textContent, /done/);
  assert.match(items[1].textContent, /needs-ceo/);
  assert.equal(items[0].find((n) => n.tagName === 'svg')[0].getAttribute('aria-hidden'), 'true');
});

test('round chips show verdicts and "verdict not recorded" when null', async () => {
  const env = makeEnv();
  await open(env);
  lastCb(env)(run({ rounds: [{ round: 0, gate: 'pass', review: 'approve' }, { round: 1, gate: 'fail', review: null }, { round: 2, gate: null, review: null }] }));
  const rounds = dlg(env).find((n) => n.className === 'round');
  assert.match(rounds[0].textContent, /Gate pass/);
  assert.match(rounds[0].textContent, /Review approve/);
  assert.match(rounds[1].textContent, /Gate fail/);
  assert.match(rounds[1].textContent, /Review: verdict not recorded/);
  assert.match(rounds[2].textContent, /Gate: verdict not recorded/);
  assert.doesNotMatch(rounds[2].textContent, /pass|fail|approve/);
});

test('an unknown verdict value is shown as not recorded, never guessed', async () => {
  const env = makeEnv();
  await open(env);
  lastCb(env)(run({ rounds: [{ round: 0, gate: '<b>x</b>', review: 'approved!' }] }));
  assert.match(dlg(env).find((n) => n.className === 'round')[0].textContent, /Gate: verdict not recorded.*Review: verdict not recorded/);
});

test('active sections appear only for an active run', async () => {
  const env = makeEnv();
  await open(env);
  lastCb(env)(run());
  const heads = () => dlg(env).find((n) => n.tagName === 'h3' && !n.parentNode.hidden && !n.parentNode.parentNode.hidden).map((n) => n.textContent);
  assert.ok(!heads().includes('Gates'));
  lastCb(env)(run({ active: { gates: [{ gate: 'plan', result: 'pass', waitS: 250 }], waves: [{ wave: 1, at: '2026-11-04T01:19:00Z' }],
    roleTimes: [{ role: 'qa', ms: 60000, steps: 2 }], overCap: [{ step: '03', role: 'qa', ctxEnd: 98000 }], fixRounds: 1 } }));
  for (const h of ['Gates', 'Waves', 'Role times', 'Over cap', 'Fix rounds']) assert.ok(heads().includes(h), h);
  const d = dlg(env);
  assert.match(d.textContent, /plan: pass, CEO wait 4m 10s/);
  assert.match(d.textContent, /over cap/);
  assert.equal(d.find((n) => n.tagName === 'caption').length, 1);
  assert.ok(d.find((n) => n.tagName === 'th').every((n) => n.getAttribute('scope') === 'col'));
  lastCb(env)(run({ active: null }));
  assert.ok(!heads().includes('Gates'));
});

test('PR links: validated https github urls, rel noopener noreferrer, bad rows dropped', async () => {
  const env = makeEnv({ links: { v: 1, state: 'found',
    prs: [{ number: 53, url: 'https://github.com/o/r/pull/53', state: 'merged' }, { number: 1, url: 'javascript:alert(1)', state: 'open' }, { number: 2, url: 'https://evil.example/o/r/pull/2', state: 'open' }],
    issues: [{ number: 51, url: 'https://github.com/o/r/issues/51' }] } });
  await open(env);
  const links = dlg(env).find((n) => n.tagName === 'a');
  assert.deepEqual(links.map((a) => a.textContent), ['PR #53 (merged)', 'Issue #51']);
  for (const a of links) {
    assert.match(a.getAttribute('href'), /^https:\/\/github\.com\//);
    assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(a.getAttribute('target'), null);
  }
});

test('PR links none shows a note; unavailable or failed omits the block', async () => {
  let env = makeEnv({ links: { state: 'none', prs: [], issues: [] } });
  await open(env);
  assert.match(dlg(env).textContent, /No pull request found for this run\./);
  env = makeEnv({ links: { state: 'unavailable', prs: [], issues: [] } });
  await open(env);
  assert.equal(dlg(env).find((n) => n.tagName === 'h3' && n.textContent === 'Pull requests')[0].parentNode.hidden, true);
  env = makeEnv({ linksStatus: 500 });
  await open(env);
  assert.equal(dlg(env).find((n) => n.tagName === 'h3' && n.textContent === 'Pull requests')[0].parentNode.hidden, true);
});

test('Escape closes, restores focus to the card button, stops watching and lifts inert', async () => {
  const env = makeEnv();
  env.opener.focus();
  await open(env);
  lastCb(env)(run());
  const prevented = env.doc.activeElement.key('Escape');
  assert.equal(prevented, true);
  assert.equal(dlg(env).hidden, true);
  assert.equal(env.doc.activeElement, env.opener);
  assert.equal(env.watch.at(-1).slug, null);
  assert.equal(env.header.getAttribute('inert'), null);
  assert.equal(env.main.getAttribute('inert'), null);
});

test('Close buttons close; Tab wraps from last to first and Shift+Tab from first to last', async () => {
  const env = makeEnv();
  await open(env);
  const [top, bottom] = closeButtons(env);
  assert.ok(top && bottom);
  bottom.focus();
  assert.equal(bottom.key('Tab'), true);
  assert.equal(env.doc.activeElement, top);
  assert.equal(top.key('Tab', { shiftKey: true }), true);
  assert.equal(env.doc.activeElement, bottom);
  await bottom.click();
  assert.equal(dlg(env).hidden, true);
  assert.equal(env.doc.activeElement, env.opener);
});

test('closing when the card is gone puts focus on the board', async () => {
  const env = makeEnv();
  await open(env);
  env.opener.parentNode.children = [];
  env.opener.parentNode = null;
  await closeButtons(env)[0].click();
  assert.equal(env.doc.activeElement, env.main);
});

test('failed run read shows an error and a later good read recovers', async () => {
  const env = makeEnv();
  await open(env);
  lastCb(env)(null);
  assert.match(dlg(env).textContent, /Could not read this run\. Close and try again\./);
  assert.equal(dlg(env).find((n) => n.className === 'drawer-error')[0].hidden, false);
  lastCb(env)(run());
  assert.equal(dlg(env).find((n) => n.className === 'drawer-error')[0].hidden, true);
  assert.match(dlg(env).textContent, /Wrote the plan/);
});

test('updates edit step nodes in place and announce only a new Step', async () => {
  const env = makeEnv();
  await open(env);
  lastCb(env)(run());
  const li = dlg(env).find((n) => n.className === 'step')[0];
  const did = li.find((n) => n.className === 'did')[0];
  did.focus();
  lastCb(env)(run({ steps: [{ step: '01', role: 'architect', status: 'done', round: 0, summary: 'Changed text' }] }));
  assert.equal(dlg(env).find((n) => n.className === 'step')[0], li);
  assert.equal(did.textContent, 'Changed text');
  assert.equal(env.doc.activeElement, did);
  assert.deepEqual(env.announced, []);
  lastCb(env)(run({ steps: [{ step: '01', role: 'architect', status: 'done', round: 0, summary: 'Changed text' }, { step: '04', role: 'qa', status: 'done', round: 0, summary: null }] }));
  assert.deepEqual(env.announced, ['Step 04 added']);
});

test('source has no innerHTML, storage, location, eval or inline handlers', () => {
  const src = read('drawer.js');
  for (const bad of [/innerHTML/, /insertAdjacentHTML/, /localStorage|sessionStorage|document\.cookie/, /\blocation\b/, /\beval\(|new Function/, /setTimeout\(\s*['"]/, /\.onclick|setAttribute\(\s*['"]on/]) {
    assert.doesNotMatch(src, bad);
  }
  assert.match(src, /'api\/run\/' \+ encodeURIComponent\(slug\)/);
});

test('index.html loads drawer.js after board.js and before live.js', () => {
  const html = read('index.html');
  const i = [html.indexOf('board.js'), html.indexOf('drawer.js'), html.indexOf('live.js')];
  assert.ok(i[0] > 0 && i[1] > i[0] && i[2] > i[1]);
});
