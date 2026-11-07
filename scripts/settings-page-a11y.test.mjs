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

function loadPage(initialState, fetchImpl) {
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
  const names = ['roles', 'skills', 'personality', 'language', 'pipeline', 'gates', 'scan', 'mods'];
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
  const fakeFetch = fetchImpl ?? (async () => ({ status: 200, json: async () => structuredClone(initialState) }));
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

async function open(overrides, fetchImpl) {
  const page = loadPage(pageState(overrides), fetchImpl);
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

// ---------- Skills tab ----------
const skill = (name, extra = {}) => ({
  name, category: 'quality', kind: 'repo', layer: 'user', roles: ['qa'], selectable: true, status: 'missing', place: null,
  license: 'MIT, as stated, not checked', vetted: null, commit: 'a'.repeat(40), ...extra
});
const SIX = ['s1', 's2', 's3', 's4', 's5', 's6'].map((n) => skill(n));
function skillsState(entries, over = {}) {
  const base = pageState();
  base.resolved.roles.architect.protected = true;
  base.resolved.settings_folder_moved = false;
  return { ...base, catalog: { entries, errors: [], clashes: [] }, ...over };
}
const box = (page, id) => page.find((n) => n.tagName === 'INPUT' && n.type === 'checkbox' && n.id === id);
const ticked = async (cb, on = true) => { cb.checked = on; await cb.fire('change'); };
const unsaved = (page) => page.ids.count.textContent;

test('each skill row is a checkbox with a label, a fieldset legend and status as words', async () => {
  const entries = [skill('qa-helper', { status: 'folder not recognized', place: 'project', vetted: '2026-01-02', skillrepo: 'owner/name' }), skill('cmd', { kind: 'command', commit: undefined })];
  const page = loadPage(skillsState(entries));
  await settle();
  const cb = box(page, 'sk-qa-user-qa-helper');
  assert.equal(cb.type, 'checkbox');
  assert.ok(page.find((n) => n.tagName === 'LABEL' && n.getAttribute('for') === cb.id && n.textContent === 'qa-helper'));
  const legend = page.find((n) => n.tagName === 'LEGEND' && n.textContent.includes('qa') && n.textContent.includes('User level'));
  assert.equal(legend.parentNode.tagName, 'FIELDSET');
  const text = describedBy(cb).map((id) => byId(page, id).textContent);
  assert.deepEqual(text, ['quality, repo owner/name at aaaaaaa', 'Status: folder not recognized, project', 'MIT, as stated, not checked, vetted 2026-01-02']);
  const cmd = describedBy(box(page, 'sk-qa-user-cmd')).map((id) => byId(page, id).textContent);
  assert.equal(cmd[0], 'quality, command (manual)');
  assert.equal(cmd[2], 'MIT, as stated, not checked, not vetted');
});

test('a vetted text from the server is shown as sent', async () => {
  const text = 'vetted 2026-01-02, from the old list, not scanned here';
  const page = loadPage(skillsState([skill('old', { vetted: '2026-01-02', vetted_text: text })]));
  await settle();
  assert.equal(describedBy(box(page, 'sk-qa-user-old')).map((id) => byId(page, id).textContent)[2], `MIT, as stated, not checked, ${text}`);
});

test('hostile entry text reaches the page as text only', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const entries = [skill(evil, { license: '<b>x</b>', status: '<script>', commit: '<i>' })];
  const page = loadPage(skillsState(entries));
  await settle();
  const panel = page.panel('skills');
  assert.ok(panel.textContent.includes(evil));
  assert.equal(walk(panel, (n) => ['IMG', 'B', 'SCRIPT', 'I'].includes(n.tagName)), null);
});

test('the sixth pick stays unchecked, says why in the live region and the list, and the field is described by it', async () => {
  const page = loadPage(skillsState(SIX));
  await settle();
  for (const n of ['s1', 's2', 's3', 's4', 's5']) await ticked(box(page, `sk-qa-user-${n}`));
  assert.equal(textOf(page, 'sk-qa-user-count'), '5 of 5 selected');
  const sixth = box(page, 'sk-qa-user-s6');
  assert.equal(sixth.disabled, false);
  await ticked(sixth);
  assert.equal(sixth.checked, false);
  const reason = 'Limit reached: a Role can have 5 skills. Clear one first.';
  assert.equal(textOf(page, 'sk-qa-user-err'), reason);
  assert.equal(page.ids['field-live'].textContent, reason);
  assert.ok(describedBy(sixth).includes('sk-qa-user-err'));
  assert.equal(sixth.getAttribute('aria-invalid'), 'true');
  assert.equal(textOf(page, 'sk-qa-user-count'), '5 of 5 selected');
  assert.equal(unsaved(page), '1 unsaved change');
  await ticked(box(page, 'sk-qa-user-s1'), false);
  assert.equal(byId(page, 'sk-qa-user-err').hidden, true);
});

test('a wildcard entry is a disabled checkbox with its reason as text', async () => {
  const page = loadPage(skillsState([skill('golang-*', { selectable: false, reason: 'pattern entry' })]));
  await settle();
  const cb = box(page, 'sk-qa-user-golang-*');
  assert.equal(cb.disabled, true);
  assert.ok(describedBy(cb).some((id) => byId(page, id).textContent === 'Not selectable: a wildcard names no one skill.'));
});

test('a protected Role has no project controls and says so', async () => {
  const entries = [skill('shared', { roles: ['architect', 'qa'] })];
  const state = skillsState(entries);
  state.project = { version: 1, roles: { architect: { skills: [{ name: 'shared' }] } } };
  const page = loadPage(state);
  await settle();
  assert.ok(box(page, 'sk-architect-user-shared'));
  assert.equal(box(page, 'sk-architect-project-shared'), null);
  assert.ok(page.panel('skills').textContent.includes('Protected Role: skills are chosen at User level only. A project value is ignored.'));
  assert.ok(page.panel('skills').textContent.includes('Ignored: this stored skill'));
});

test('an eligible name in a protected Role project list is not part of the draft', async () => {
  const initial = skillsState([skill('shared', { roles: ['architect', 'qa'] })]);
  initial.project = { version: 1, roles: { architect: { skills: [{ name: 'shared' }] }, qa: { model: 'opus' } } };
  let posted = null;
  const fetchImpl = async (url, init) => {
    if (init?.method === 'POST') { posted = JSON.parse(init.body); return { status: 200, json: async () => ({ state: initial }) }; }
    return { status: 200, json: async () => structuredClone(initial) };
  };
  const page = loadPage(initial, fetchImpl);
  await settle();
  assert.equal(unsaved(page), '0 unsaved changes');
  assert.ok(page.panel('skills').textContent.includes('Ignored: this stored skill'));
  await ticked(box(page, 'sk-qa-project-shared'));
  await page.ids.save.fire('click');
  await settle();
  assert.ok(posted.project, 'the project layer is posted');
  assert.equal(posted.project.roles?.architect?.skills, undefined);
});

test('while the user layer is unread its stored names are kept, not listed as ignored', async () => {
  const state = skillsState([skill('qa-helper')]);
  state.user = { version: 1, roles: { qa: { skills: [{ name: 'my-own' }, { name: 'qa-helper' }] } } };
  state.catalog.errors = ['ERROR user catalog: not valid JSON'];
  const page = loadPage(state);
  await settle();
  const text = page.panel('skills').textContent;
  assert.ok(!text.includes('Ignored: this stored skill'));
  assert.ok(text.includes('2 selected (user)'));
  assert.equal(unsaved(page), '0 unsaved changes');
});

test('a clash that is not a pin is named in the list problems', async () => {
  const state = skillsState([skill('b')]);
  state.catalog.clashes = [{ name: 'hallmark', pinned: false }, { name: 'pinned-one', pinned: true }];
  const page = loadPage(state);
  await settle();
  const text = page.panel('skills').textContent;
  assert.ok(text.includes('Skill list problems') && text.includes('skill hallmark:'));
  assert.ok(!text.includes('pinned-one'));
});

test('a stale stored name shows as ignored without its value, and is no unsaved change', async () => {
  const state = skillsState([skill('qa-helper')]);
  state.user = { version: 1, roles: { qa: { skills: [{ name: 'qa-helper' }, { name: 'GONE value' }] } } };
  const page = loadPage(state);
  await settle();
  const text = page.panel('skills').textContent;
  assert.ok(text.includes('stored value 2') && !text.includes('GONE value'));
  assert.equal(unsaved(page), '0 unsaved changes');
  assert.equal(box(page, 'sk-qa-user-qa-helper').checked, true);
});

test('save keeps focus on the same checkbox and shows the saved notice', async () => {
  const initial = skillsState([skill('qa-helper')]);
  const after = structuredClone(initial);
  after.user = { version: 1, roles: { qa: { skills: [{ name: 'qa-helper', approved: '2026-11-06' }] } } };
  let posted = null;
  const fetchImpl = async (url, init) => {
    if (init?.method === 'POST') { posted = JSON.parse(init.body); return { status: 200, json: async () => ({ state: after }) }; }
    return { status: 200, json: async () => structuredClone(initial) };
  };
  const page = loadPage(initial, fetchImpl);
  await settle();
  let card = box(page, 'sk-qa-user-qa-helper');
  while (card.tagName !== 'DETAILS') card = card.parentNode;
  card.open = true;
  await card.fire('toggle');
  await ticked(box(page, 'sk-qa-user-qa-helper'));
  box(page, 'sk-qa-user-qa-helper').focus();
  await page.ids.save.fire('click');
  await settle();
  assert.deepEqual(posted.user.roles.qa.skills, [{ name: 'qa-helper' }]);
  const now = box(page, 'sk-qa-user-qa-helper');
  assert.equal(now.ownerDoc.activeElement, now);
  assert.ok(page.ids.status.textContent.startsWith('Saved.'));
});

test('a server refusal of the list names the field in the summary and under the list', async () => {
  const initial = skillsState(SIX);
  const fetchImpl = async (url, init) => (init?.method === 'POST'
    ? { status: 400, json: async () => ({ refused: ['user roles.qa.skills: must be at most 5 skills'] }) }
    : { status: 200, json: async () => structuredClone(initial) });
  const page = loadPage(initial, fetchImpl);
  await settle();
  await ticked(box(page, 'sk-qa-user-s1'));
  await page.ids.save.fire('click');
  await settle();
  assert.match(page.ids.status.textContent, /^Nothing was saved\. Fix 1 field:/);
  assert.ok(page.ids.status.textContent.includes('Ava (qa), user level, Skills'));
  assert.ok(textOf(page, 'sk-qa-user-err').startsWith('Error: Skills for qa, user level'));
});

test('Clear on the Skills tab removes skill selections only', async () => {
  const state = skillsState([skill('qa-helper')]);
  state.user = { version: 1, roles: { qa: { model: 'opus', skills: [{ name: 'qa-helper' }] } } };
  const page = loadPage(state);
  await settle();
  await page.ids['tab-skills'].fire('click');
  await page.ids['clear-user'].fire('click');
  assert.equal(unsaved(page), '1 unsaved change');
  assert.equal(box(page, 'sk-qa-user-qa-helper').checked, false);
});

test('the Roles tab Clear leaves skill selections alone', async () => {
  const state = skillsState([skill('qa-helper')]);
  state.user = { version: 1, roles: { qa: { model: 'opus', skills: [{ name: 'qa-helper' }] } } };
  const page = loadPage(state);
  await settle();
  await page.ids['clear-user'].fire('click');
  assert.equal(unsaved(page), '1 unsaved change');
  assert.equal(box(page, 'sk-qa-user-qa-helper').checked, true);
});

test('a missing catalog, an empty user list, a moved folder and a bad list each say what they mean', async () => {
  const none = loadPage(pageState());
  await settle();
  assert.ok(none.panel('skills').textContent.includes('The settings server sent no skill data.'));
  const base = loadPage(skillsState([skill('b', { layer: 'baseline' })]));
  await settle();
  assert.ok(textOf(base, 'skills-info').includes('You have not added skills of your own. Add one with /aico:add-skill'));
  const moved = skillsState([skill('b')]);
  moved.resolved.settings_folder_moved = true;
  const page = loadPage(moved);
  await settle();
  const text = page.panel('skills').textContent;
  assert.ok(text.includes('role skills: MCSPARROW_HOME is set, the user catalog is not read'));
  assert.equal(box(page, 'sk-qa-user-b'), null);
  assert.ok(box(page, 'sk-qa-project-b'));
  const bad = skillsState([]);
  bad.catalog.errors = ['ERROR user catalog: entry 3: category'];
  const errs = loadPage(bad);
  await settle();
  assert.ok(errs.panel('skills').textContent.includes('Skill list problems'));
  assert.ok(errs.panel('skills').textContent.includes('entry 3: category'));
});

test('the category select filters rows but never hides a selected one', async () => {
  const page = loadPage(skillsState([skill('q1'), skill('d1', { category: 'design' })]));
  await settle();
  await ticked(box(page, 'sk-qa-user-d1'));
  const select = byId(page, 'sk-qa-user-cat');
  select.value = 'quality';
  await select.fire('change');
  const row = (id) => box(page, id).parentNode;
  assert.equal(row('sk-qa-user-d1').hidden, false);
  assert.match(textOf(page, 'sk-qa-user-count'), /1 of 5 selected, 1 selected entry shown outside this category/);
  await ticked(box(page, 'sk-qa-user-d1'), false);
  assert.equal(row('sk-qa-user-d1').hidden, true);
});

test('the Skills tab sits after Roles, wraps long text and adds no colour or fixed width', () => {
  const html = fs.readFileSync(PAGE_FILE, 'utf8');
  assert.ok(html.indexOf('id="tab-roles"') < html.indexOf('id="tab-skills"') && html.indexOf('id="tab-skills"') < html.indexOf('id="tab-personality"'));
  assert.ok(html.includes("const TAB_NAMES = ['roles', 'skills', 'personality'"));
  const css = html.split('\n').filter((l) => l.startsWith('.sk-')).join('\n');
  assert.ok(css.includes('overflow-wrap: anywhere'));
  assert.ok(!/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(css));
  assert.ok(!/(^|[^-])width: \d+(px|rem)/.test(css.replace('width: 24px; height: 24px', '')));
  assert.ok(/min-height: 44px/.test(css));
  assert.ok(/@media \(max-width: 600px\)[^}]*\n\s*\.pgrid \{ grid-template-columns: 1fr; \}/.test(html));
});
