import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { pluginDefaults } from './settings.mjs';

const PAGE_FILE = path.join(import.meta.dirname, 'settings-page.html');
const NOTICE = "Use a pseudonym, never a real person's name. Names are shown only to you; Roles get their Role id, not your name, in prompts.";

// A small DOM, enough to run the page script and read what it builds.
class FakeText {
  constructor(text) { this.textContent = text; this.parentNode = null; }
}
class FakeNode {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDoc = doc;
    this.children = [];
    this.attrs = new Map();
    this.listeners = {};
    this.parentNode = null;
    this.dataset = {};
    this.style = { setProperty() {} };
    this.own = '';
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.id = '';
    this.className = '';
    this.selected = '';
    const self = this;
    this.classList = {
      toggle(name, on) {
        const set = new Set(self.className.split(/\s+/).filter(Boolean));
        if (on === undefined ? !set.has(name) : on) set.add(name); else set.delete(name);
        self.className = [...set].join(' ');
      },
      contains: (name) => self.className.split(/\s+/).includes(name)
    };
    if (tag === 'option') {
      let optionValue = '';
      Object.defineProperty(this, 'value', { get: () => optionValue, set: (v) => { optionValue = String(v); } });
    }
  }
  append(...kids) { for (const k of kids) { const n = typeof k === 'string' ? new FakeText(k) : k; n.parentNode = this; this.children.push(n); } }
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'id') this.id = String(v); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  async fire(type) { for (const fn of this.listeners[type] ?? []) await fn({ type, key: '', preventDefault() {} }); }
  focus() { this.ownerDoc.activeElement = this; }
  getBoundingClientRect() { return { height: 0 }; }
  get textContent() { return this.children.map((c) => c.textContent).join('') + this.own; }
  set textContent(v) { this.children = []; this.own = String(v); }
  get options() { return this.children.filter((c) => c.tagName === 'OPTION'); }
  get value() { return this.selected; }
  set value(v) {
    v = String(v);
    if (this.tagName !== 'SELECT') { this.selected = v; return; }
    this.selected = this.options.some((o) => o.value === v) ? v : (this.options[0]?.value ?? '');
  }
  set tabIndex(v) { this.attrs.set('tabindex', String(v)); }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
function walk(node, pred) {
  for (const c of node.children ?? []) {
    if (pred(c)) return c;
    const r = walk(c, pred);
    if (r) return r;
  }
  return null;
}
function walkAll(node, pred, out = []) {
  for (const c of node.children ?? []) { if (pred(c)) out.push(c); walkAll(c, pred, out); }
  return out;
}

function loadPage(initialState) {
  const ids = {};
  const doc = { activeElement: null };
  const make = (tag, props = {}) => {
    const n = new FakeNode(tag, doc);
    for (const [k, v] of Object.entries(props)) n.setAttribute(k, v);
    return n;
  };
  doc.documentElement = make('html');
  for (const id of ['notices', 'field-live', 'lock-live', 'status', 'count', 'clear-user', 'clear-project', 'save', 'done', 'unlock', 'unlock-title', 'unlock-text', 'unlock-cancel', 'unlock-ok']) ids[id] = make('div', { id });
  ids.save.disabled = true;
  const names = ['roles', 'personality', 'language', 'pipeline', 'gates', 'scan', 'mods'];
  const tabs = names.map((name) => {
    ids[`panel-${name}`] = make('section', { id: `panel-${name}`, role: 'tabpanel' });
    ids[`tab-${name}`] = make('button', { role: 'tab', id: `tab-${name}`, 'aria-controls': `panel-${name}` });
    return ids[`tab-${name}`];
  });
  const footer = make('footer');
  const main = make('main');
  Object.assign(doc, {
    createElement: (tag) => make(tag),
    createTextNode: (text) => new FakeText(text),
    getElementById: (id) => ids[id] ?? names.map((n) => walk(ids[`panel-${n}`], (x) => x.id === id)).find(Boolean) ?? walk(ids.status, (x) => x.id === id),
    querySelector: (sel) => (sel === 'meta[name="aico-token"]' ? { content: 'tok' } : sel === 'main' ? main : sel === 'footer' ? footer : null),
    querySelectorAll: (sel) => (sel === '[role="tab"]' ? tabs : [])
  });
  const fakeFetch = async () => ({ status: 200, json: async () => structuredClone(initialState) });
  const script = /<script>([\s\S]*)<\/script>/.exec(fs.readFileSync(PAGE_FILE, 'utf8'))[1];
  const NodeLike = class { static [Symbol.hasInstance](v) { return v instanceof FakeNode || v instanceof FakeText; } };
  const context = vm.createContext({ document: doc, window: { addEventListener() {}, confirm: () => true }, fetch: fakeFetch, Node: NodeLike });
  vm.runInContext(script, context);
  const panels = names.map((n) => ids[`panel-${n}`]);
  return {
    ids,
    find: (pred) => panels.map((p) => walk(p, pred)).find(Boolean) ?? null,
    panel: (name) => ids[`panel-${name}`]
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

function pageState(overrides = {}) {
  const roles = ['architect', 'qa'];
  const plugin = { ...pluginDefaults(), roles: Object.fromEntries(roles.map((r) => [r, { name: 'Ava', model: 'sonnet', effort: 'medium' }])) };
  return {
    plugin, user: { version: 1 }, project: { version: 1 }, hasProject: true,
    language: { user: null, project: null },
    resolved: {
      revision: 'r1', roles: Object.fromEntries(roles.map((r) => [r, { name: 'Ava', model: 'sonnet', effort: 'medium', context_cap: 95000, source: {} }])),
      ignored: [], warnings: [], language: { tag: 'en', source: 'default' }, profile: { hasProject: true, fields: {}, options: {} }
    },
    personalities: { rule: { text_re: '^.*$', flags: '', max: 80, levels: ['low', 'medium', 'high'], phrases: {} }, roles: {}, ignored: [] },
    ...overrides
  };
}
const byId = (page, id) => page.find((n) => n.id === id);
const describedBy = (node) => (node.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
const textOf = (page, id) => byId(page, id)?.textContent;

async function open(overrides) {
  const page = loadPage(pageState(overrides));
  await settle();
  return page;
}
function rowSelect(page, label, level) {
  return page.find((n) => n.tagName === 'SELECT' && n.getAttribute('aria-label') === `${label}, ${level}`);
}

test('the Roles tab shows the pseudonym notice as text, and the old claim is gone', async () => {
  const page = await open();
  const notice = byId(page, 'roles-names-notice');
  assert.ok(notice);
  assert.equal(notice.textContent, NOTICE);
  assert.ok(!page.panel('roles').textContent.includes('Names are for display only'));
  assert.notEqual(notice.getAttribute('aria-live'), 'polite');
  assert.equal(notice.getAttribute('role'), null);
});

test('each Name field is described by its hint and the notice, and the ids resolve', async () => {
  const page = await open();
  for (const level of ['user', 'project']) {
    const input = byId(page, `rf-architect-${level}-name`);
    const ids = describedBy(input);
    assert.deepEqual(ids, [`rf-architect-${level}-name-hint`, 'roles-names-notice']);
    for (const id of ids) assert.ok(byId(page, id), id);
  }
  assert.equal(textOf(page, 'rf-architect-user-name-hint'), 'Use a pseudonym, not a real name.');
  assert.equal(textOf(page, 'rf-architect-project-name-hint'), 'Saved in .company/. Use a pseudonym, not a real name.');
});

test('a name error is listed first and the hint and notice stay tied to the field', async () => {
  const page = await open();
  const input = byId(page, 'rf-architect-user-name');
  input.value = 'x'.repeat(40);
  await input.fire('input');
  await settle();
  const ids = describedBy(input);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.match(byId(page, ids[0]).textContent, /^Error: Name/);
  assert.deepEqual(ids.slice(1), ['rf-architect-user-name-hint', 'roles-names-notice']);
  input.value = 'Ava';
  await input.fire('input');
  await settle();
  assert.deepEqual(describedBy(input), ['rf-architect-user-name-hint', 'roles-names-notice']);
});

test('without a .company/ folder the project Name hint says what is needed', async () => {
  const page = await open({ hasProject: false });
  assert.equal(textOf(page, 'rf-architect-project-name-hint'), 'Needs a .company/ folder.');
  assert.equal(byId(page, 'rf-architect-project-name').disabled, true);
});

test('the notice comes before the Roles table and no hint or reason takes a tab stop', async () => {
  const page = await open();
  const kids = page.panel('roles').children;
  const at = (pred) => kids.findIndex(pred);
  assert.ok(at((n) => n.id === 'roles-names-notice') < at((n) => n.children?.some?.((c) => c.tagName === 'TABLE') || n.tagName === 'TABLE'));
  const stops = [];
  const scan = (node) => { for (const c of node.children ?? []) { if (c.tagName && c.getAttribute('tabindex') !== null) stops.push(c); scan(c); } };
  scan(page.panel('roles'));
  scan(page.panel('gates'));
  assert.deepEqual(stops, []);
  const html = fs.readFileSync(PAGE_FILE, 'utf8');
  assert.ok(!/tabindex="[1-9]/i.test(html));
  assert.ok(!/\btabIndex\s*[:=]\s*[1-9]/.test(html));
});

const LOCKED_ROWS = [
  ['Ship', 'ship', 'Locked. auto needs your Ship unlock.'],
  ['Installs', 'installs', 'Locked. auto needs your Installs unlock.']
];

test('every locked Gate row shows its reason as text, tied to both controls', async () => {
  const page = await open();
  const reasons = page.panel('gates').children;
  assert.ok(reasons);
  for (const [label, , text] of LOCKED_ROWS) {
    const user = rowSelect(page, label, 'user');
    const project = rowSelect(page, label, 'project');
    assert.ok(user && project, label);
    const id = describedBy(user)[0];
    assert.match(id, /^lock-/);
    assert.equal(describedBy(project)[0], id);
    assert.equal(textOf(page, id), text);
  }
});

test('lane and Blast Radius rows carry the security reason', async () => {
  const page = await open();
  const rows = [
    ['pipeline', 'Security', 'Locked. Off needs your security unlock.'],
    ['pipeline', 'Compliance', 'Locked. Off needs your security unlock.']
  ];
  for (const [, label, text] of rows) {
    const control = page.find((n) => n.tagName === 'SELECT' && n.getAttribute('aria-label')?.startsWith(label) && n.getAttribute('aria-label').endsWith(', user'));
    assert.ok(control, label);
    assert.equal(textOf(page, describedBy(control)[0]), text);
  }
  const blastOn = page.find((n) => n.tagName === 'SELECT' && n.getAttribute('aria-label')?.includes('on/off, user') && /blast/i.test(n.getAttribute('aria-label')));
  assert.equal(textOf(page, describedBy(blastOn)[0]), 'Locked. Off needs your security unlock.');
  const blastSec = page.find((n) => n.tagName === 'SELECT' && /blast.* security, user/i.test(n.getAttribute('aria-label') ?? ''));
  assert.equal(textOf(page, describedBy(blastSec)[0]), 'Locked. warn needs your security unlock.');
});

test('rows without a lock keep no lock reason', async () => {
  const page = await open();
  const control = page.find((n) => n.tagName === 'SELECT' && n.getAttribute('aria-label') === 'Legal, user') ?? rowSelect(page, 'Plan', 'user');
  assert.ok(control);
  assert.ok(!describedBy(control).some((id) => id.startsWith('lock-')));
});

test('the unlocked state replaces the reason text', async () => {
  const page = await open({ user: { version: 1, unlocked: ['ship'] } });
  const id = describedBy(rowSelect(page, 'Ship', 'user'))[0];
  assert.equal(textOf(page, id), 'Unlocked by you.');
  assert.equal(textOf(page, describedBy(rowSelect(page, 'Installs', 'user'))[0]), 'Locked. auto needs your Installs unlock.');
});

test('the lock reason changes with the unlock and the change is announced, not the load', async () => {
  const page = await open();
  assert.equal(page.ids['lock-live'].textContent, '');
  const unlocks = page.find((n) => n.tagName === 'SELECT' && n.getAttribute('aria-label') === 'Ship unlock, user');
  unlocks.value = 'on';
  const pending = unlocks.fire('change');
  await settle();
  assert.equal(page.ids.unlock.open, true);
  await page.ids['unlock-ok'].fire('click');
  await pending;
  await settle();
  assert.equal(textOf(page, describedBy(rowSelect(page, 'Ship', 'user'))[0]), 'Unlocked by you.');
  assert.equal(page.ids['lock-live'].textContent, 'Ship unlocked. auto now applies.');
  const again = page.find((n) => n.tagName === 'SELECT' && n.getAttribute('aria-label') === 'Ship unlock, user');
  again.value = '';
  await again.fire('change');
  await settle();
  assert.equal(page.ids['lock-live'].textContent, 'Ship locked again. auto is held until you unlock it.');
  assert.equal(textOf(page, describedBy(rowSelect(page, 'Ship', 'user'))[0]), 'Locked. auto needs your Ship unlock.');
});

test('cancelling the dialog keeps the lock and says so', async () => {
  const page = await open();
  const ship = rowSelect(page, 'Ship', 'user');
  ship.value = 'auto';
  const pending = ship.fire('change');
  await settle();
  assert.equal(page.ids.unlock.open, true);
  await page.ids['unlock-cancel'].fire('click');
  await pending;
  await settle();
  assert.equal(page.ids['lock-live'].textContent, 'Kept locked. Your choice was not applied.');
  assert.equal(textOf(page, describedBy(rowSelect(page, 'Ship', 'user'))[0]), 'Locked. auto needs your Ship unlock.');
});

test('the page keeps the dialog and a separate polite live region for locks, and sets text without innerHTML', () => {
  const html = fs.readFileSync(PAGE_FILE, 'utf8');
  assert.match(html, /<div id="lock-live"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /<div id="field-live"/);
  assert.match(html, /<dialog id="unlock" aria-labelledby="unlock-title">/);
  assert.ok(!/\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML/.test(html));
  assert.ok(!html.includes('content: "needs unlock"'));
});
