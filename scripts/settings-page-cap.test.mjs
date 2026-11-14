import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { pluginDefaults } from './settings.mjs';

// A small DOM, enough to run the page script and drive its controls.
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
      add: (name) => self.classList.toggle(name, true),
      remove: (name) => self.classList.toggle(name, false),
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
  scrollIntoView(options) { (this.ownerDoc.scrolled ??= []).push({ node: this, options }); }
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

function loadPage(initialState, { saveReply } = {}) {
  const ids = {};
  const doc = { activeElement: null };
  const make = (tag, props = {}) => {
    const n = new FakeNode(tag, doc);
    for (const [k, v] of Object.entries(props)) n.setAttribute(k, v);
    return n;
  };
  doc.documentElement = make('html');
  for (const id of ['notices', 'field-live', 'status', 'count', 'clear-user', 'clear-project', 'save', 'done', 'unlock', 'unlock-title', 'unlock-text', 'unlock-cancel', 'unlock-ok']) ids[id] = make('div', { id });
  ids.save.setAttribute('aria-disabled', 'true');
  const names = ['roles', 'skills', 'personality', 'language', 'pipeline', 'gates', 'scan', 'mods'];
  const tabs = names.map((name) => {
    ids[`panel-${name}`] = make('section', { id: `panel-${name}`, role: 'tabpanel' });
    ids[`tab-${name}`] = make('button', { role: 'tab', id: `tab-${name}`, 'aria-controls': `panel-${name}` });
    return ids[`tab-${name}`];
  });
  // The header level switch, the lamps and the per-tab dirty lamps the console shell adds.
  const radios = ['user', 'project'].map((v) => { const r = make('input', { id: `lvl-${v}`, name: 'lvl' }); r.value = v; r.checked = v === 'user'; ids[`lvl-${v}`] = r; return r; });
  for (const name of names) ids[`dirty-${name}`] = make('span');
  ids.lamps = make('div', { id: 'lamps' });
  ids['annun-list'] = make('div', { id: 'annun-list' });
  doc.body = { dataset: {} };
  const footer = make('footer');
  const main = make('main');
  const calls = [];
  Object.assign(doc, {
    createElement: (tag) => make(tag),
    createTextNode: (text) => new FakeText(text),
    getElementById: (id) => ids[id] ?? names.map((n) => walk(ids[`panel-${n}`], (x) => x.id === id)).find(Boolean) ?? walk(ids.status, (x) => x.id === id),
    querySelector: (sel) => (sel === 'meta[name="aico-token"]' ? { content: 'tok' } : sel === 'main' ? main : sel === 'footer' ? footer : sel === 'input[name="lvl"]:checked' ? radios.find((r) => r.checked) : null),
    querySelectorAll: (sel) => (sel === '[role="tab"]' ? tabs : sel === 'input[name="lvl"]' ? radios : [])
  });
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
    if (url === '/api/save') {
      const reply = saveReply ?? { status: 200, body: { state: initialState } };
      return { status: reply.status, json: async () => structuredClone(reply.body) };
    }
    return { status: 200, json: async () => structuredClone(initialState) };
  };
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
  const NodeLike = class { static [Symbol.hasInstance](v) { return v instanceof FakeNode || v instanceof FakeText; } };
  const context = vm.createContext({ document: doc, window: { addEventListener() {}, confirm: () => true }, fetch: fakeFetch, Node: NodeLike });
  vm.runInContext(script, context);
  const panels = names.map((n) => ids[`panel-${n}`]);
  const levelNow = () => radios.find((r) => r.checked).value;
  const findHere = (pred) => panels.map((p) => walk(p, pred)).find(Boolean) ?? null;
  const useLevel = (level) => {
    if (levelNow() === level) return;
    for (const r of radios) r.checked = r.value === level;
    ids[`lvl-${level}`].fire('change');
  };
  return {
    setLevel: async (level) => { for (const r of radios) r.checked = r.value === level; await ids[`lvl-${level}`].fire('change'); await new Promise((resolve) => setImmediate(resolve)); },
    document: doc, ids, calls,
    // The page builds controls for one level at a time; find() looks at the shown level first, then at the other one.
    useLevel,
    find: (pred) => {
      const first = levelNow();
      let hit = findHere(pred);
      if (hit) return hit;
      useLevel(first === 'user' ? 'project' : 'user');
      hit = findHere(pred);
      if (!hit) useLevel(first);
      return hit;
    },
    panel: (name) => ids[`panel-${name}`]
  };
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
const settle = () => new Promise((resolve) => setImmediate(resolve));

const RANGE = 'a whole number from 60000 to 1000000';
const NOT_WHOLE = `Error: Context cap must be ${RANGE}.`;
const OUT_OF_RANGE = `Error: Context cap is out of range. Use ${RANGE}.`;
// The server's line for a bad context_cap has no `pipeline.` path (the rule is shared with the stored Role value).
const REFUSAL_LINE = (level) => `${level} context_cap must be ${RANGE}`;

// Resolved values as the server reports them: one cap, its handover and its source.
function capState({ user, project, plugin = 180000, roleStored } = {}) {
  const cap = project ?? user ?? plugin;
  const source = project !== undefined ? 'project' : user !== undefined ? 'user' : 'plugin';
  const roles = ['architect', 'qa'];
  const defaults = pluginDefaults();
  const layer = (v, extra = {}) => ({ version: 1, ...(v === undefined ? {} : { pipeline: { context_cap: v } }), ...extra });
  return {
    plugin: { ...defaults, pipeline: { ...defaults.pipeline, context_cap: plugin }, roles: Object.fromEntries(roles.map((r) => [r, { name: r, model: 'sonnet', effort: 'medium' }])) },
    user: layer(user),
    project: layer(project, roleStored === undefined ? {} : { roles: { qa: { context_cap: roleStored } } }),
    hasProject: true,
    language: { user: null, project: null },
    resolved: {
      revision: 'r1',
      roles: Object.fromEntries(roles.map((r) => [r, { name: r, model: 'sonnet', effort: 'medium', context_cap: cap, source: { context_cap: source } }])),
      pipeline: { context_cap: cap, context_handover: Math.floor(cap * 9 / 10), source: { context_cap: source } },
      ignored: [], warnings: [], language: { tag: 'en', source: 'default' }, profile: { hasProject: true, fields: {}, options: {} }
    },
    personalities: { rule: { text_re: '^.*$', flags: '', max: 80, levels: ['low', 'medium', 'high'], phrases: {} }, roles: {}, ignored: [] }
  };
}
async function openCap(state = capState(), opts) {
  const page = loadPage(state, opts);
  await settle();
  return page;
}
function capRow(page) {
  const label = page.find((n) => n.tagName === 'LABEL' && n.textContent.startsWith('Context cap'));
  assert.ok(label, 'a visible label starting with Context cap');
  const input = page.find((n) => n.tagName === 'INPUT' && n.id === label.getAttribute('for'));
  assert.ok(input, 'the label is tied to an input');
  const box = input.parentNode;
  const readout = walk(box, (n) => typeof n.className === 'string' && n.className.split(' ').includes('readout'));
  assert.ok(readout, 'the row ends in the In effect readout');
  const err = walk(box, (n) => n.id === `${input.id}-err`);
  assert.ok(err, 'the row has its own error text');
  return { label, input, box, readout, err };
}
const typeCap = async (input, text) => { input.value = text; await input.fire('input'); await input.fire('change'); await settle(); };
const live = (page) => page.ids['field-live'].textContent;
const describedBy = (node) => (node.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
const saves = (page) => page.calls.filter((c) => c.url === '/api/save');
const rolesReadouts = (page) => walkAll(page.panel('roles'), (n) => typeof n.className === 'string' && n.className === 'readout');

test('AC5: the Pipeline tab Context cap row is a labelled numeric text input and the fixed badge and old hint are gone', async () => {
  const page = await openCap();
  const { label, input, box } = capRow(page);
  assert.equal(input.tagName, 'INPUT');
  assert.equal(input.getAttribute('type'), 'text', 'text, not type=number: no spinner, no scroll-wheel change');
  assert.equal(input.getAttribute('inputmode'), 'numeric');
  assert.equal(input.getAttribute('autocomplete'), 'off');
  assert.equal(input.maxLength, undefined, 'no silent maxLength truncation');
  assert.ok(label.textContent.includes(', user level'), label.textContent);
  assert.equal(walk(page.panel('pipeline'), (n) => n.id === 'context-cap-fixed'), null);
  assert.equal(walkAll(box, (n) => typeof n.className === 'string' && n.className.split(' ').includes('lockcap')).length, 0, 'no lock badge');
  assert.ok(!/fixed/i.test(box.textContent), box.textContent);
  assert.ok(!page.panel('pipeline').textContent.includes('A context_cap value in an old settings file is kept but has no effect'));
});

test('AC5: the hint states the range and the 90 percent hand-over and is tied to the input', async () => {
  const page = await openCap();
  const { input } = capRow(page);
  const hint = page.find((n) => n.id === 'context-cap-hint');
  assert.ok(hint, 'hint id context-cap-hint');
  assert.ok(hint.textContent.includes('60000') && hint.textContent.includes('1000000'), hint.textContent);
  assert.ok(hint.textContent.includes('90%'), hint.textContent);
  assert.ok(hint.textContent.includes('162000'), 'names the default hand-over');
  assert.ok(!/fixed/i.test(hint.textContent));
  assert.ok(describedBy(input).includes('context-cap-hint'));
  assert.equal(hint.getAttribute('aria-live'), null, 'a static hint is never live');
});

test('AC5: the In effect readout is polite and shows the cap, its source and the handover', async () => {
  const page = await openCap();
  const { readout } = capRow(page);
  assert.equal(readout.getAttribute('aria-live'), 'polite');
  assert.ok(readout.textContent.startsWith('In effect'), readout.textContent);
  assert.ok(readout.textContent.includes('180000'), readout.textContent);
  assert.ok(readout.textContent.includes('plugin'), readout.textContent);
  assert.ok(readout.textContent.includes('handover 162000'), readout.textContent);
});

test('slice: typing 120000 at user level shows cap 120000 handover 108000 and saves the number', async () => {
  const saved = capState({ user: 120000 });
  const page = await openCap(capState(), { saveReply: { status: 200, body: { state: saved } } });
  const { input, readout } = capRow(page);
  await typeCap(input, '120000');
  assert.ok(readout.textContent.includes('120000') && readout.textContent.includes('user') && readout.textContent.includes('handover 108000'), readout.textContent);
  assert.equal(input.getAttribute('aria-invalid'), null);
  await page.ids.save.fire('click');
  await settle();
  assert.equal(saves(page).length, 1);
  assert.strictEqual(saves(page)[0].body.user.pipeline.context_cap, 120000);
  assert.equal(saves(page)[0].body.project, undefined);
  const after = capRow(page);
  assert.ok(after.readout.textContent.includes('120000') && after.readout.textContent.includes('handover 108000'), after.readout.textContent);
  assert.match(page.ids.status.textContent, /Saved/);
});

test('AC2 on the page: the handover is floor(cap x 0.9), integer math', async () => {
  const page = await openCap();
  const { input, readout } = capRow(page);
  for (const [cap, handover] of [['60000', 54000], ['123457', 111111], ['1000000', 900000], [' 120000 ', 108000]]) {
    await typeCap(input, cap);
    assert.equal(input.getAttribute('aria-invalid'), null, cap);
    assert.ok(readout.textContent.includes(`handover ${handover}`), `${cap}: ${readout.textContent}`);
  }
});

test('AC4 on the page: project over user, and an empty project field falls back to the user cap', async () => {
  const page = await openCap(capState({ user: 150000, project: 120000 }));
  await page.setLevel('project');
  const { input, readout } = capRow(page);
  assert.equal(input.value, '120000');
  assert.ok(readout.textContent.includes('120000') && readout.textContent.includes('project') && readout.textContent.includes('handover 108000'), readout.textContent);
  await typeCap(input, '');
  assert.equal(input.getAttribute('aria-invalid'), null, 'empty means inherit, never an error');
  assert.ok(readout.textContent.includes('150000') && readout.textContent.includes('user') && readout.textContent.includes('handover 135000'), readout.textContent);
});

test('AC3 on the page: not a whole number gets the whole-number text and is marked, tied and announced', async () => {
  const bad = ['abc', '12e4', '120000abc', '-120000', '1.5', '180,000', '120 000', '١٢٠٠٠٠', '1e5', '+120000'];
  for (const text of bad) {
    const page = await openCap();
    const { input, err } = capRow(page);
    await typeCap(input, text);
    assert.equal(err.textContent, NOT_WHOLE, JSON.stringify(text));
    assert.equal(err.hidden, false);
    assert.equal(input.getAttribute('aria-invalid'), 'true', JSON.stringify(text));
    assert.deepEqual(describedBy(input), ['context-cap-hint', err.id], 'hint and error both describe the input');
    assert.equal(live(page), `Context cap, user level: must be ${RANGE}.`, 'announced without Save');
    assert.ok(!err.textContent.includes(text.trim()), 'the error never echoes the value');
  }
});

test('AC3 on the page: all-digit values outside the range get the out-of-range text, whatever their length', async () => {
  for (const text of ['0', '50000', '59999', '1000001', '12345678', '9'.repeat(10000)]) {
    const page = await openCap();
    const { input, err } = capRow(page);
    await typeCap(input, text);
    assert.equal(input.value.length, text.length, 'no silent truncation');
    assert.equal(err.textContent, OUT_OF_RANGE, text.slice(0, 12));
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.ok(live(page).startsWith('Context cap, user level: ') && live(page).includes('60000 to 1000000'), live(page));
    assert.ok(live(page).length < 200 && err.textContent.length < 200, 'no value echo');
  }
});

test('AC3 on the page: a valid value after an error clears the mark, the error text and the announcement', async () => {
  const page = await openCap();
  const { input, err } = capRow(page);
  await typeCap(input, '50000');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  await typeCap(input, '60000');
  assert.equal(input.getAttribute('aria-invalid'), null);
  assert.equal(err.hidden, true);
  assert.equal(err.textContent, '');
  assert.deepEqual(describedBy(input), ['context-cap-hint']);
  assert.ok(!live(page).startsWith('Context cap, user level:'), live(page));
});

test('AC3 on the page: the readout keeps the value in effect while the draft is refused', async () => {
  const page = await openCap(capState({ user: 150000 }));
  const { input, readout } = capRow(page);
  for (const text of ['abc', '50000', '1000001']) {
    await typeCap(input, text);
    assert.ok(readout.textContent.includes('150000') && readout.textContent.includes('handover 135000'), `${text}: ${readout.textContent}`);
    assert.ok(!readout.textContent.includes(text), 'a refused number is never displayed as in effect');
  }
});

test('AC3 on the page: Save with a refused value sends nothing, lists the field and writes nothing', async () => {
  const page = await openCap();
  const { input } = capRow(page);
  await typeCap(input, '50000');
  await page.ids.save.fire('click');
  await settle();
  assert.equal(saves(page).length, 0);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.match(page.ids.status.textContent, /Nothing was saved/);
  assert.ok(page.ids.status.textContent.includes('Context cap, user level'), page.ids.status.textContent);
  const link = walk(page.ids.status, (n) => n.tagName === 'A' && n.getAttribute('href') === `#${input.id}`);
  assert.ok(link, 'the refusal list links back to the input');
});

test('AC3 on the page: an empty value is not an error and sends no cap', async () => {
  const page = await openCap();
  const { input, err } = capRow(page);
  await typeCap(input, '');
  assert.equal(input.getAttribute('aria-invalid'), null);
  assert.equal(err.hidden, true);
  assert.equal(saves(page).length, 0);
  assert.equal(page.ids.save.getAttribute('aria-disabled'), 'true', 'nothing changed, nothing to save');
});

test('AC5: a server refusal is shown under the field, announced, sticky until the value changes, and listed', async () => {
  const page = await openCap(capState(), { saveReply: { status: 400, body: { refused: [REFUSAL_LINE('user')] } } });
  const { input, err } = capRow(page);
  await typeCap(input, '120000');
  await page.ids.save.fire('click');
  await settle();
  assert.equal(saves(page).length, 1);
  assert.equal(err.textContent, NOT_WHOLE);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.equal(live(page), `Context cap, user level: must be ${RANGE}.`);
  assert.ok(describedBy(input).includes(err.id) && describedBy(input).includes('context-cap-hint'));
  assert.ok(page.ids.status.textContent.includes(`Context cap, user level: must be ${RANGE}.`), page.ids.status.textContent);
  assert.ok(!page.ids.status.textContent.includes(REFUSAL_LINE('user')), 'the mapped line is not repeated raw');
  await typeCap(input, '130000');
  assert.equal(input.getAttribute('aria-invalid'), null, 'the sticky refusal ends when the value changes');
  assert.equal(err.hidden, true);
  assert.ok(!live(page).startsWith('Context cap, user level:'), live(page));
});

test('AC5: a refusal for the hidden project level is listed with its level word and the line is not repeated raw', async () => {
  const page = await openCap(capState(), { saveReply: { status: 400, body: { refused: [REFUSAL_LINE('project')] } } });
  const { input } = capRow(page);
  await typeCap(input, '120000');
  await page.ids.save.fire('click');
  await settle();
  const text = page.ids.status.textContent;
  assert.ok(text.includes(`Context cap, project level: must be ${RANGE}.`), text);
  assert.ok(!text.includes(REFUSAL_LINE('project')), text);
});

test('AC5 keyboard and screen reader: one tab stop, label before input before readout, no tabindex, level spoken', async () => {
  const page = await openCap();
  const { label, input, box, readout } = capRow(page);
  assert.equal(input.disabled, false);
  assert.equal(input.getAttribute('tabindex'), null);
  assert.equal(walkAll(box, (n) => ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(n.tagName)).length, 1, 'one control in the row');
  assert.equal(walkAll(box, (n) => n.tagName && n.getAttribute('tabindex') !== null).length, 0, 'no tabindex on hint, error or readout');
  const at = (node) => box.children.indexOf(node);
  assert.ok(at(label) < at(input) && at(input) < at(readout), 'reading order: label, input, readout');
  assert.equal(label.getAttribute('for'), input.id);
  assert.equal(walkAll(label, (n) => n.className === 'vh' && n.textContent === ', user level').length, 1, 'the level is spoken, not only seen');
  await page.setLevel('project');
  const projectRow = capRow(page);
  assert.ok(projectRow.label.textContent.includes(', project level'));
  assert.notEqual(projectRow.input.id, input.id, 'each level has its own id');
  assert.equal(projectRow.input.disabled, false);
});

test('AC5: with no .company folder the project level input is disabled', async () => {
  const page = await openCap({ ...capState(), hasProject: false });
  await page.setLevel('project');
  const { input } = capRow(page);
  assert.equal(input.disabled, true);
});

test('AC6: every Role readout on the Roles tab shows the one resolved cap and handover', async () => {
  const page = await openCap(capState({ user: 120000 }));
  const readouts = rolesReadouts(page);
  assert.equal(readouts.length, 2);
  for (const r of readouts) {
    assert.ok(r.textContent.includes('cap 120000 handover 108000'), r.textContent);
    assert.ok(!r.textContent.includes('95000'), r.textContent);
  }
});

test('AC6: a stored Role cap and a stale per-Role value change nothing; the readout follows the pipeline value', async () => {
  const st = capState({ user: 150000, roleStored: 80000 });
  st.resolved.roles.qa.context_cap = 80000;
  const page = await openCap(st);
  const readouts = rolesReadouts(page);
  assert.equal(readouts.length, 2);
  for (const r of readouts) {
    assert.ok(r.textContent.includes('cap 150000 handover 135000'), r.textContent);
    assert.ok(!r.textContent.includes('80000'), r.textContent);
  }
});

test('AC6: the default Roles readout reads cap 180000 handover 162000', async () => {
  const page = await openCap();
  const readouts = rolesReadouts(page);
  assert.equal(readouts.length, 2);
  for (const r of readouts) assert.ok(r.textContent.includes('cap 180000 handover 162000'), r.textContent);
});

test('AC5: the page source has no number input for the cap, no innerHTML and no fixed cell or hint', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
  assert.ok(!html.includes('innerHTML'));
  assert.ok(!/type:\s*'number'/.test(html) && !/type="number"/.test(html));
  assert.ok(!html.includes('context-cap-fixed'), 'the fixed cell is gone');
  assert.ok(!html.includes('The context cap is fixed'), 'the old hint is gone');
  assert.ok(!/A context_cap value in an old settings file/.test(html));
});
