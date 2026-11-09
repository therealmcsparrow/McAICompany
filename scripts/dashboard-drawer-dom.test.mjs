import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const SRC = fs.readFileSync(path.join(import.meta.dirname, 'dashboard-page', 'drawer.js'), 'utf8');

// Mimics a real DOM: upper-case tagName, and `children` is an array-like
// collection that has no forEach (like HTMLCollection).
class RealisticNode {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.doc = doc;
    this.kids = [];
    this.attrs = new Map();
    this.listeners = {};
    this.parentNode = null;
    this.dataset = {};
    this.own = '';
    this.hidden = false;
    this.className = '';
    this.id = '';
  }
  get children() {
    const c = { length: this.kids.length };
    this.kids.forEach((k, i) => { c[i] = k; });
    return c;
  }
  append(...kids) {
    for (const k of kids) {
      if (k.parentNode) k.parentNode.kids = k.parentNode.kids.filter((x) => x !== k);
      k.parentNode = this;
      this.kids.push(k);
    }
  }
  replaceChildren(...kids) { for (const c of this.kids) c.parentNode = null; this.kids = []; this.append(...kids); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  focus() { this.doc.activeElement = this; }
  get textContent() { return this.own + this.kids.map((c) => c.textContent).join(''); }
  set textContent(v) { for (const c of this.kids) c.parentNode = null; this.kids = []; this.own = String(v); }
  key(key, extra = {}) {
    let prevented = false;
    for (let n = this; n; n = n.parentNode) for (const fn of n.listeners.keydown ?? []) fn({ key, preventDefault() { prevented = true; }, ...extra });
    return prevented;
  }
  find(pred) { const out = []; const w = (n) => { if (pred(n)) out.push(n); n.kids.forEach(w); }; w(this); return out; }
}

function makeEnv() {
  const doc = { activeElement: null, createElement: (t) => new RealisticNode(t, doc), createElementNS: (n, t) => new RealisticNode(t, doc) };
  doc.body = new RealisticNode('body', doc);
  Object.defineProperty(doc.body, 'children', { get() { const c = { length: this.kids.length }; this.kids.forEach((k, i) => { c[i] = k; }); return c; } });
  const skip = new RealisticNode('a', doc);
  skip.className = 'skip';
  const header = new RealisticNode('header', doc);
  const main = new RealisticNode('main', doc);
  const opener = new RealisticNode('button', doc);
  opener.own = 'Demo project';
  main.append(opener);
  doc.body.append(skip, header, main);
  const ctx = {
    document: doc, Date, URL, JSON, Math, Object, String, Array, isNaN, isFinite, encodeURIComponent,
    fetch: async () => ({ status: 200, json: async () => ({ state: 'none' }) }),
    aicoLive: { watchRun: () => {}, announce: () => {} },
    aicoBoard: { onOpen: null }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'drawer.js' });
  return { ctx, doc, opener, header, main, skip };
}

const dlg = (env) => env.doc.body.kids.find((n) => n.id === 'drawer');
const buttons = (env, label) => dlg(env).find((n) => n.tagName === 'BUTTON' && n.textContent === label);

function openProject(env) {
  env.ctx.aicoBoard.onOpen('P20261109.000009-15.52.35', env.opener, ['P1/run-a', 'P1/run-b']);
}

test('fake collection has no forEach and tags are upper case', () => {
  const env = makeEnv();
  assert.equal(typeof env.doc.body.children.forEach, 'undefined');
  assert.equal(env.main.tagName, 'MAIN');
});

test('opening a project drawer does not throw and makes the page behind inert', () => {
  const env = makeEnv();
  openProject(env);
  assert.equal(env.header.getAttribute('inert'), '');
  assert.equal(env.main.getAttribute('inert'), '');
  assert.equal(env.skip.getAttribute('inert'), '');
});

test('closing removes inert from the page behind', () => {
  const env = makeEnv();
  openProject(env);
  buttons(env, 'Close')[1].listeners.click[0]({ type: 'click' });
  assert.equal(env.header.getAttribute('inert'), null);
  assert.equal(env.main.getAttribute('inert'), null);
  assert.equal(env.skip.getAttribute('inert'), null);
});

test('Tab on the last control wraps to the first', () => {
  const env = makeEnv();
  openProject(env);
  const [top, bottom] = buttons(env, 'Close');
  bottom.focus();
  assert.equal(bottom.key('Tab'), true);
  assert.equal(env.doc.activeElement, top);
});

test('Shift+Tab on the first control wraps to the last', () => {
  const env = makeEnv();
  openProject(env);
  const [top, bottom] = buttons(env, 'Close');
  top.focus();
  assert.equal(top.key('Tab', { shiftKey: true }), true);
  assert.equal(env.doc.activeElement, bottom);
});

test('run buttons in the list are in the focus cycle: Tab from the last run button goes on, not wraps', () => {
  const env = makeEnv();
  openProject(env);
  const rows = buttons(env, 'run-a').concat(buttons(env, 'run-b'));
  assert.equal(rows.length, 2);
  rows[1].focus();
  assert.equal(rows[1].key('Tab'), false);
  assert.equal(env.doc.activeElement, rows[1]);
});

test('Escape closes the drawer', () => {
  const env = makeEnv();
  openProject(env);
  assert.equal(dlg(env).kids.length > 0, true);
  dlg(env).key('Escape');
  assert.equal(dlg(env).hidden, true);
});

test('opening a project drawer moves focus to the title heading', () => {
  const env = makeEnv();
  openProject(env);
  assert.equal(env.doc.activeElement.id, 'drawer-title');
});
