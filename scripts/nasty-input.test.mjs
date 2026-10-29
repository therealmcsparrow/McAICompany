import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NAME_RE, PERSONALITY_KEYS, PERSONALITY_TEXT_RE } from './check.mjs';
import { TYPE_ORDER, run as runCompanyType } from './company-type.mjs';
import { run as runLanguage } from './language.mjs';
import {
  PROFILE_FIELDS, Refusal, readProfile, resolvePersonalities, resolveSettings, templateOptions, writeLayer, writeProfile
} from './settings.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const FIXTURE = path.join(ROOT, 'tests', 'nasty-inputs.json');
const TEMPLATE = path.join(ROOT, 'skills', 'lead', 'references', 'project-template.md');

// Every path the scripts could touch lives under one temp folder; the real user home is never read or written.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'nasty-input-'));
const home = path.join(sandbox, 'home');
const repo = path.join(sandbox, 'repo');
fs.mkdirSync(home);
fs.mkdirSync(path.join(repo, '.company'), { recursive: true });
const pluginRoot = path.join(sandbox, 'plugin');
const SANDBOX_ROLES = ['architect', 'code-reviewer', 'pentester', 'qa', 'security', 'vuln-scanner'];
fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
fs.mkdirSync(path.join(pluginRoot, 'company'));
fs.mkdirSync(path.join(pluginRoot, 'skills', 'lead', 'references'), { recursive: true });
for (const role of SANDBOX_ROLES) fs.copyFileSync(path.join(import.meta.dirname, '..', 'agents', `${role}.md`), path.join(pluginRoot, 'agents', `${role}.md`));
fs.copyFileSync(path.join(import.meta.dirname, '..', 'company', 'model-floor.json'), path.join(pluginRoot, 'company', 'model-floor.json'));
fs.copyFileSync(path.join(import.meta.dirname, '..', 'skills', 'lead', 'references', 'project-template.md'), path.join(pluginRoot, 'skills', 'lead', 'references', 'project-template.md'));
for (const file of ['names.json', 'personalities.json']) {
  const all = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'company', file), 'utf8'));
  fs.writeFileSync(path.join(pluginRoot, 'company', file), JSON.stringify(Object.fromEntries(SANDBOX_ROLES.map((r) => [r, all[r]]))));
}
const saved = {};
for (const key of ['MCSPARROW_HOME', 'HOME', 'USERPROFILE']) {
  saved[key] = process.env[key];
  process.env[key] = home;
}
after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const USER_FILE = path.join(home, 'config.json');
const PROJECT_SETTINGS = path.join(repo, '.company', 'settings.json');
const PROJECT_FILE = path.join(repo, '.company', 'project.md');
const TEMPLATE_TEXT = fs.readFileSync(TEMPLATE, 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- the value set

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

function build(parts) {
  return parts.map((p) => {
    if (Object.hasOwn(p, 't')) return p.t;
    if (Object.hasOwn(p, 'c')) return p.c.map((h) => String.fromCodePoint(parseInt(h, 16))).join('');
    return String.fromCodePoint(parseInt(p.r, 16)).repeat(p.n);
  }).join('');
}

const VALUES = fixture.values.map((v) => ({ id: v.id, kind: v.kind, skip: v.skip ?? [], value: build(v.parts) }));
const forSurface = (surface) => VALUES.filter((v) => !v.skip.includes(surface));
// The read-side checks reuse the write-side validators, so they run on every third value plus every kind that carries a parsing risk.
const ALWAYS_KINDS = new Set(['company-type', 'newline', 'surrogate', 'valid', 'whitespace', 'lookalike-colon']);
const sampled = (list) => list.filter((v, i) => i % 3 === 0 || ALWAYS_KINDS.has(v.kind));

// ---------------------------------------------------------------- the documented rules

const contractText = fs.readFileSync(path.join(ROOT, 'docs', 'contracts', 'role-names.md'), 'utf8');
function contractPattern(marker) {
  const line = contractText.split('\n').find((l) => l.includes(marker));
  const m = line && /matching `(\^[^`]+\$)`u/.exec(line);
  assert.ok(m, `role-names.md has no pattern on the line with ${marker}`);
  return new RegExp(m[1], 'u');
}
const NAME_RULE = contractPattern('A name is 1');
const RULE_T = contractPattern('**Rule T**');

const roster = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'company', 'names.json'), 'utf8'));
const OTHER_NAMES = new Set(Object.entries(roster).filter(([role]) => role !== 'qa').map(([, n]) => n.toLowerCase()));

const cpClass = (...ranges) => new RegExp(`[${ranges.map(([a, b]) => String.fromCodePoint(parseInt(a, 16)) + (b ? `-${String.fromCodePoint(parseInt(b, 16))}` : '')).join('')}]`, 'u');
const PLAIN_ASCII = /^[\x20-\x7E]*$/;
const ZERO_WIDTH_OR_BIDI = cpClass(['061C'], ['180E'], ['200B', '200F'], ['202A', '202E'], ['2060', '2064'], ['2066', '2069'], ['FEFF']);
const CONTROL_OR_SEPARATOR = cpClass(['0000', '001F'], ['007F', '009F'], ['2028', '2029']);

// project-init v1 "Values": the one documented rule for the one-line header values of .company/project.md.
function profileMustRefuse(v) {
  return v === '' || v.length > 200 || !v.isWellFormed() || CONTROL_OR_SEPARATOR.test(v) || ZERO_WIDTH_OR_BIDI.test(v)
    || v !== v.trim() || v.includes('<!--') || v.includes('-->');
}

const TAG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
function canonicalTag(tag) {
  if (typeof tag !== 'string' || tag.length > 35 || !TAG_RE.test(tag)) return null;
  try {
    const c = Intl.getCanonicalLocales(tag)[0];
    return typeof c === 'string' && TAG_RE.test(c) ? c : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- helpers

const OPTIONS = templateOptions(pluginRoot);
const CLOSED_FIELDS = ['product_type', 'engagement', 'voice'];
const TEXT_FIELDS = PROFILE_FIELDS.filter((f) => !CLOSED_FIELDS.includes(f) && f !== 'languages');
const PERSONALITY_TEXT_KEYS = ['temperament', 'talk', 'topic'];

function resetFiles() {
  for (const f of [USER_FILE, PROJECT_SETTINGS, PROJECT_FILE]) fs.rmSync(f, { force: true });
}
const readOrNull = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
const writeTemplate = () => fs.writeFileSync(PROJECT_FILE, TEMPLATE_TEXT);

// The refusal text must name the field, stay plain ASCII and never carry the value.
function refusalProblems(message, v, field) {
  const problems = [];
  if (field !== null && !message.includes(field)) problems.push('refusal does not name the field');
  if (!PLAIN_ASCII.test(message)) problems.push('refusal carries a non-ASCII or control character');
  if (v.length >= 4 && message.includes(v)) problems.push('refusal echoes the value');
  return problems;
}

function grouped(fails) {
  const groups = new Map();
  for (const f of fails) {
    const at = f.indexOf(': ');
    const reason = f.slice(at + 2);
    if (!groups.has(reason)) groups.set(reason, []);
    groups.get(reason).push(f.slice(0, at));
  }
  return [...groups].map(([reason, ids]) => `${reason} (${ids.length}): ${ids.slice(0, 4).join(', ')}${ids.length > 4 ? ', ...' : ''}`);
}

function settle(fails, id, work) {
  try {
    work();
  } catch (error) {
    fails.push(`${id}: threw ${error?.name ?? 'error'}: ${String(error?.message).replace(/[^\x20-\x7E]/g, '?').slice(0, 120)}`);
  }
}

// ---------------------------------------------------------------- the set itself

test('the nasty-input set is plain ASCII with LF endings and covers every required kind', () => {
  const raw = fs.readFileSync(FIXTURE);
  assert.ok(!raw.includes(0x0d), 'the file holds a CR byte');
  assert.ok(raw.every((b) => b === 0x0a || (b >= 0x20 && b <= 0x7e)), 'the file holds a byte outside printable ASCII');
  assert.equal(fixture.version, 1);
  assert.equal(new Set(VALUES.map((v) => v.id)).size, VALUES.length, 'duplicate value ids');
  const kinds = new Set(VALUES.map((v) => v.kind));
  for (const k of ['company-type', 'rtl', 'mixed-script', 'bidi', 'default-ignorable', 'c0', 'c1', 'surrogate', 'length', 'lookalike-quote', 'lookalike-colon', 'newline', 'option', 'language-tag']) {
    assert.ok(kinds.has(k), `no value of kind ${k}`);
  }
  const all = VALUES.map((v) => v.value);
  const has = (re) => all.some((v) => re.test(v));
  assert.ok(has(cpClass(['202E'])), 'no U+202E');
  for (const cp of ['2066', '2067', '2068', '2069']) assert.ok(has(new RegExp(`\\u${cp}`)), `no U+${cp}`);
  assert.ok(has(cpClass(['0590', '05FF'])), 'no Hebrew');
  assert.ok(has(cpClass(['0600', '06FF'])), 'no Arabic');
  assert.ok(has(cpClass(['200B'])) && has(cpClass(['200D'])) && has(cpClass(['FEFF'])), 'zero-width code points missing');
  assert.ok(has(/[\u0000-\u0008]/) && has(/\u007F/), 'C0 controls missing');
  assert.ok(has(/[\u0080-\u009F]/), 'C1 controls missing');
  assert.ok(has(/\r/) && has(/\n/), 'CR or LF missing');
  assert.ok(all.some((v) => !v.isWellFormed()), 'no lone surrogate survived the build');
  assert.ok(all.some((v) => v.length === 81), 'no 81-character value');
  assert.ok(all.some((v) => v.length === 4097), 'no 4097-character value');
  assert.ok(has(cpClass(['2018', '2019'], ['201C', '201D'], ['02BA'], ['FF02'])), 'no lookalike quote');
  assert.ok(has(cpClass(['FF1A'], ['2236'], ['02D0'], ['A789'])), 'no lookalike colon');
  assert.ok(VALUES.some((v) => v.kind === 'company-type' && v.value.includes('company_type')), 'no company-type text with the key');
});

test('the free-text settings are exactly the ones this suite covers', () => {
  const settingsDoc = fs.readFileSync(path.join(ROOT, 'docs', 'contracts', 'aico-settings.md'), 'utf8');
  const schema = settingsDoc.slice(settingsDoc.indexOf('## Schema'), settingsDoc.indexOf('A `context_cap` below'));
  const rows = schema.split('\n').filter((l) => l.startsWith('| `'));
  const textRows = rows.filter((l) => /role-names/.test(l)).map((l) => /^\| `([^`]+)`/.exec(l)[1].replace(/\\\|/g, '|'));
  assert.deepEqual(textRows, ['roles.<role>.name', 'roles.<role>.personality.<temperament|talk|topic>']);
  assert.deepEqual(PERSONALITY_KEYS.filter((k) => !['intelligence', 'creativity'].includes(k)), PERSONALITY_TEXT_KEYS);
  assert.deepEqual(TEXT_FIELDS, ['client', 'audience', 'goal', 'stack', 'license', 'jurisdiction']);
  assert.deepEqual(Object.keys(OPTIONS).sort(), [...CLOSED_FIELDS].sort());
  for (const f of CLOSED_FIELDS) assert.ok(OPTIONS[f].length > 0, `no template options for ${f}`);
  assert.ok(!PROFILE_FIELDS.includes('company_type'), 'company_type became a profile field: add it to the profile suite');
});

test('the patterns in role-names.md are the patterns the code exports', () => {
  assert.equal(NAME_RULE.source, NAME_RE.source);
  assert.equal(RULE_T.source, PERSONALITY_TEXT_RE.source);
});

// ---------------------------------------------------------------- roles.<role>.name and personality text

const LAYER_SURFACES = [
  { label: 'roles.qa.name', field: 'roles.qa.name', layer: (v) => ({ version: 1, roles: { qa: { name: v } } }), valid: (v) => NAME_RULE.test(v) && !OTHER_NAMES.has(v.toLowerCase()) },
  ...PERSONALITY_TEXT_KEYS.map((key) => ({
    label: `roles.qa.personality.${key}`,
    field: `roles.qa.personality.${key}`,
    layer: (v) => ({ version: 1, roles: { qa: { personality: { [key]: v } } } }),
    valid: (v) => RULE_T.test(v)
  }))
];

for (const level of ['user', 'project']) {
  for (const surface of LAYER_SURFACES) {
    test(`${surface.label} at the ${level} level: every nasty value is refused with nothing changed or stored as the documented form`, () => {
      const file = level === 'user' ? USER_FILE : PROJECT_SETTINGS;
      const fails = [];
      for (const { id, value: v } of forSurface('layer')) {
        settle(fails, id, () => {
          resetFiles();
          const layer = surface.layer(v);
          let refused = null;
          try {
            writeLayer(level, layer, { home, cwd: repo, pluginRoot });
          } catch (error) {
            if (!(error instanceof Refusal)) throw error;
            refused = error.message;
          }
          const valid = surface.valid(v);
          const after = readOrNull(file);
          if (refused !== null) {
            if (valid) fails.push(`${id}: a documented-valid value was refused`);
            if (after !== null) fails.push(`${id}: refused but ${path.basename(file)} was written`);
            for (const p of refusalProblems(refused, v, surface.field)) fails.push(`${id}: ${p}`);
            return;
          }
          if (!valid) fails.push(`${id}: accepted a value the documented rule refuses`);
          const expected = `${JSON.stringify({ aico_settings: layer }, null, 2)}\n`;
          if (after !== expected) fails.push(`${id}: stored bytes differ from the canonical form`);
          if (!v.isWellFormed()) fails.push(`${id}: stored a lone surrogate`);
        });
      }
      assert.deepEqual(grouped(fails), []);
    });
  }
}

test('a value that breaks out of the JSON string never adds a key to the stored layer', () => {
  const fails = [];
  for (const { id, value: v } of VALUES.filter((x) => x.id.startsWith('nl-json-break'))) {
    for (const surface of LAYER_SURFACES) {
      resetFiles();
      try {
        writeLayer('user', surface.layer(v), { home, cwd: repo, pluginRoot });
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        continue;
      }
      const stored = JSON.parse(fs.readFileSync(USER_FILE, 'utf8'));
      if (Object.keys(stored.aico_settings).sort().join() !== 'roles,version') fails.push(`${id} ${surface.label}: extra top-level key`);
    }
  }
  assert.deepEqual(grouped(fails), []);
});

// ---------------------------------------------------------------- stored hostile layers

function warningProblems(resolved, v, strip) {
  const problems = [];
  const lines = [...resolved.warnings, ...resolved.ignored.map((i) => `${i.level} ${i.path}: ${i.reason}`)];
  for (const line of lines) {
    let text = line;
    for (const s of strip) text = text.split(s).join('');
    if (!PLAIN_ASCII.test(text)) problems.push('a warning carries a non-ASCII or control character');
    if (v.length >= 4 && line.includes(v)) problems.push('a warning echoes the value');
  }
  return problems;
}

for (const level of ['user', 'project']) {
  test(`a hostile value already stored at the ${level} level is never applied and never echoed`, () => {
    const file = level === 'user' ? USER_FILE : PROJECT_SETTINGS;
    resetFiles();
    const baseline = resolveSettings({ home, cwd: repo, pluginRoot }).roles.qa.name;
    const baselineTalk = resolvePersonalities({ home, cwd: repo, pluginRoot }).roles.qa.talk.value;
    const baselineGet = JSON.stringify(resolveSettings({ home, cwd: repo, pluginRoot }));
    const fails = [];
    for (const { id, value: v } of sampled(VALUES)) {
      settle(fails, id, () => {
        resetFiles();
        fs.writeFileSync(file, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { name: v } } } }));
        const names = resolveSettings({ home, cwd: repo, pluginRoot });
        const nameOk = NAME_RULE.test(v);
        const wantName = nameOk ? v : baseline;
        if (names.roles.qa.name !== wantName && !(nameOk && OTHER_NAMES.has(v.toLowerCase()))) fails.push(`${id}: stored name resolved to the wrong value`);
        if (!nameOk) for (const p of warningProblems(names, v, [USER_FILE, PROJECT_SETTINGS])) fails.push(`${id}: ${p}`);

        fs.writeFileSync(file, JSON.stringify({ aico_settings: { version: 1, roles: { qa: { personality: { talk: v } } } } }));
        const talk = resolvePersonalities({ home, cwd: repo, pluginRoot });
        const resolved = resolveSettings({ home, cwd: repo, pluginRoot });
        const textOk = RULE_T.test(v);
        if (talk.roles.qa.talk.value !== (textOk ? v : baselineTalk)) fails.push(`${id}: stored talk resolved to the wrong value`);
        if (v.length >= 4 && !baselineGet.includes(v) && JSON.stringify(resolved).includes(v)) fails.push(`${id}: get output carries the personality text`);
        if (!textOk) {
          for (const p of warningProblems(talk, v, [USER_FILE, PROJECT_SETTINGS])) fails.push(`${id}: ${p}`);
          for (const p of warningProblems(resolved, v, [USER_FILE, PROJECT_SETTINGS])) fails.push(`${id}: ${p}`);
        }
      });
    }
    assert.deepEqual(grouped(fails), []);
  });
}

// ---------------------------------------------------------------- profile fields in .company/project.md

function expectedProject(field, v) {
  return TEMPLATE_TEXT.split('\n').map((l) => (l.startsWith(`${field}:`) ? `${field}: ${v}` : l)).join('\n');
}

for (const field of TEXT_FIELDS) {
  test(`profile ${field}: every nasty value is refused with nothing changed or stored as one clean line`, () => {
    const fails = [];
    const set = forSurface('profile');
    for (const { id, value: v } of set) {
      settle(fails, id, () => {
        writeTemplate();
        let refused = null;
        try {
          writeProfile({ [field]: v }, { cwd: repo, pluginRoot });
        } catch (error) {
          if (!(error instanceof Refusal)) throw error;
          refused = error.message;
        }
        const after = fs.readFileSync(PROJECT_FILE, 'utf8');
        const mustRefuse = profileMustRefuse(v);
        if (refused !== null) {
          if (!mustRefuse) fails.push(`${id}: a clean one-line value was refused`);
          if (after !== TEMPLATE_TEXT) fails.push(`${id}: refused but project.md changed`);
          for (const p of refusalProblems(refused, v, field)) fails.push(`${id}: ${p}`);
          return;
        }
        if (mustRefuse) fails.push(`${id}: accepted a value the documented rule refuses`);
        if (after !== expectedProject(field, v)) fails.push(`${id}: stored bytes differ from the canonical form`);
        if (readProfile({ cwd: repo }).fields[field] !== v) fails.push(`${id}: the stored line does not read back as the value`);
      });
    }
    assert.deepEqual(grouped(fails), []);
  });
}

test('profile text: an accepted value never adds a company_type line or hides one', () => {
  const fails = [];
  for (const { id, value: v } of forSurface('profile')) {
    settle(fails, id, () => {
      writeTemplate();
      try {
        writeProfile({ goal: v }, { cwd: repo, pluginRoot });
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        return;
      }
      const r = runCompanyType(['resolve', '--json'], { cwd: repo });
      if (r.code !== 0) fails.push(`${id}: the company type reader refused the written file`);
      else if (JSON.parse(r.out).source !== 'default') fails.push(`${id}: the written value changed the company type`);
      const lines = fs.readFileSync(PROJECT_FILE, 'utf8').split('\n');
      if (lines.filter((l) => l.startsWith('goal:')).length !== 1) fails.push(`${id}: the goal line is not exactly one line`);
      if (lines.length !== TEMPLATE_TEXT.split('\n').length) fails.push(`${id}: the written value changed the line count`);
    });
  }
  assert.deepEqual(grouped(fails), []);
});

test('profile languages: every nasty value is refused with nothing changed or stored as canonical tags', () => {
  const fails = [];
  for (const { id, value: v } of forSurface('profile')) {
    settle(fails, id, () => {
      writeTemplate();
      let refused = null;
      try {
        writeProfile({ languages: v }, { cwd: repo, pluginRoot });
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        refused = error.message;
      }
      const after = fs.readFileSync(PROJECT_FILE, 'utf8');
      const tags = v.split(',').map((t) => t.trim());
      const wellFormed = !profileMustRefuse(v) && tags.every((t) => canonicalTag(t) !== null);
      if (refused !== null) {
        if (after !== TEMPLATE_TEXT) fails.push(`${id}: refused but project.md changed`);
        for (const p of refusalProblems(refused, v, 'languages')) fails.push(`${id}: ${p}`);
        return;
      }
      if (!wellFormed) fails.push(`${id}: accepted a value that is not a list of language tags`);
      if (after !== expectedProject('languages', v)) fails.push(`${id}: stored bytes differ from the canonical form`);
      if (wellFormed && !tags.every((t) => t === canonicalTag(t))) fails.push(`${id}: stored a tag that is not in canonical form`);
    });
  }
  assert.deepEqual(grouped(fails), []);
});

for (const field of CLOSED_FIELDS) {
  test(`profile ${field}: only the template's own options are stored`, () => {
    const fails = [];
    const valid = (v) => (field === 'voice' ? v.split(' + ').every((o) => OPTIONS.voice.includes(o)) : OPTIONS[field].includes(v));
    const candidates = [...forSurface('profile'), ...OPTIONS[field].map((o) => ({ id: `option-${o}`, value: o }))];
    for (const { id, value: v } of candidates) {
      settle(fails, id, () => {
        writeTemplate();
        let refused = null;
        try {
          writeProfile({ [field]: v }, { cwd: repo, pluginRoot });
        } catch (error) {
          if (!(error instanceof Refusal)) throw error;
          refused = error.message;
        }
        const after = fs.readFileSync(PROJECT_FILE, 'utf8');
        if (refused !== null) {
          if (valid(v)) fails.push(`${id}: a listed option was refused`);
          if (after !== TEMPLATE_TEXT) fails.push(`${id}: refused but project.md changed`);
          for (const p of refusalProblems(refused, v, field)) fails.push(`${id}: ${p}`);
          return;
        }
        if (!valid(v)) fails.push(`${id}: accepted a value outside the options`);
        if (after !== expectedProject(field, v)) fails.push(`${id}: stored bytes differ from the canonical form`);
      });
    }
    assert.deepEqual(grouped(fails), []);
  });
}

test('company_type is not a profile field: every value is refused and project.md is untouched', () => {
  const fails = [];
  for (const { id, value: v } of [...VALUES, { id: 'registry-id', value: 'research' }]) {
    settle(fails, id, () => {
      writeTemplate();
      let refused = null;
      try {
        writeProfile({ company_type: v }, { cwd: repo, pluginRoot });
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        refused = error.message;
      }
      if (refused === null) fails.push(`${id}: company_type was stored through the profile writer`);
      else for (const p of refusalProblems(refused, v, 'company_type')) fails.push(`${id}: ${p}`);
      if (fs.readFileSync(PROJECT_FILE, 'utf8') !== TEMPLATE_TEXT) fails.push(`${id}: project.md changed`);
    });
  }
  assert.deepEqual(grouped(fails), []);
});

// ---------------------------------------------------------------- aico_language

for (const scope of ['user', 'project']) {
  test(`aico_language at the ${scope} level: every nasty value is refused with nothing changed or stored as the canonical tag`, () => {
    const fails = [];
    for (const { id, value: v } of VALUES) {
      settle(fails, id, () => {
        resetFiles();
        writeTemplate();
        const args = scope === 'user' ? ['set', v] : ['set', v, 'project'];
        const r = runLanguage(args, { home, cwd: repo });
        const canonical = canonicalTag(v);
        const stored = scope === 'user' ? readOrNull(USER_FILE) : fs.readFileSync(PROJECT_FILE, 'utf8');
        const untouched = scope === 'user' ? stored === null : stored === TEMPLATE_TEXT;
        if (r.code !== 0) {
          if (r.code !== 2 || !r.out.startsWith('refused: ')) fails.push(`${id}: not a refusal line`);
          if (!untouched) fails.push(`${id}: refused but the file changed`);
          if (!PLAIN_ASCII.test(r.out)) fails.push(`${id}: refusal carries a non-ASCII or control character`);
          return;
        }
        if (canonical === null) fails.push(`${id}: accepted a value that is not a canonical-able tag`);
        if (r.out !== `set ${scope} ${canonical}`) fails.push(`${id}: the reported tag is not the canonical one`);
        if (scope === 'user') {
          if (stored !== `${JSON.stringify({ aico_language: canonical }, null, 2)}\n`) fails.push(`${id}: stored bytes differ from the canonical form`);
        } else {
          const lines = TEMPLATE_TEXT.split('\n');
          lines.splice(lines.findIndex((l) => l.startsWith('languages:')) + 1, 0, `aico_language: ${canonical}`);
          if (stored !== lines.join('\n')) fails.push(`${id}: stored bytes differ from the canonical form`);
        }
      });
    }
    assert.deepEqual(grouped(fails), []);
  });
}

// ---------------------------------------------------------------- company_type

const readProjectBytes = () => fs.readFileSync(PROJECT_FILE, 'utf8');
const BARE_PROJECT = '# Project profile\n\nproduct_type: web\nengagement: own\n';

test('company-type set: only a registry id is written; every other value is refused with nothing changed', () => {
  const fails = [];
  for (const { id, value: v } of VALUES) {
    settle(fails, id, () => {
      fs.writeFileSync(PROJECT_FILE, BARE_PROJECT);
      const r = runCompanyType(['set', v], { cwd: repo });
      const after = readProjectBytes();
      if (TYPE_ORDER.includes(v)) {
        if (r.code !== 0 || after !== `# Project profile\n\ncompany_type: ${v}\nproduct_type: web\nengagement: own\n`) {
          fails.push(`${id}: a registry id was not stored as the one company_type line`);
        }
        return;
      }
      if (r.code === 0) fails.push(`${id}: accepted a value that is not a registry id`);
      if (after !== BARE_PROJECT) fails.push(`${id}: refused but project.md changed`);
      if (!PLAIN_ASCII.test(r.out) || !r.out.startsWith('refused: ')) fails.push(`${id}: refusal is not one plain ASCII refused line`);
      if (v.length >= 4 && !PLAIN_ASCII.test(v) && r.out.includes(v)) fails.push(`${id}: refusal echoes the value`);
    });
  }
  assert.deepEqual(grouped(fails), []);
});

test('company-type resolve: a nasty value after company_type: is a registry id or a refusal that echoes nothing', () => {
  const fails = [];
  for (const { id, value: v } of sampled(VALUES)) {
    settle(fails, id, () => {
      fs.writeFileSync(PROJECT_FILE, `# Project profile\n\ncompany_type: ${v}\nproduct_type: web\n`);
      const before = readProjectBytes();
      const r = runCompanyType(['resolve', '--json'], { cwd: repo });
      if (readProjectBytes() !== before) fails.push(`${id}: resolve changed project.md`);
      if (r.code === 0) {
        const got = JSON.parse(r.out);
        const asTyped = v.replace(/^[ \t]+|[ \t]+$/g, '');
        if (!TYPE_ORDER.includes(got.id) || got.id !== asTyped || got.source !== 'project') fails.push(`${id}: resolved to a type the line does not say`);
        return;
      }
      if (!PLAIN_ASCII.test(r.out) || !r.out.startsWith('refused: ')) fails.push(`${id}: refusal is not one plain ASCII refused line`);
      if (v.length >= 4 && r.out.includes(v)) fails.push(`${id}: refusal echoes the value`);
    });
  }
  assert.deepEqual(grouped(fails), []);
});

test('company-type resolve: ASCII look-alike key lines are refused, never read as another type', () => {
  const lines = [
    'COMPANY_TYPE: research', ' company_type: research', '\tcompany_type: research', 'company_type : research',
    'Company_Type: research', String.fromCharCode(0xEF, 0xBB, 0xBF) + 'company_type: research'
  ];
  const fails = [];
  for (const line of lines) {
    fs.writeFileSync(PROJECT_FILE, `# Project profile\n\n${line}\nproduct_type: web\n`, 'latin1');
    const r = runCompanyType(['resolve', '--json'], { cwd: repo });
    if (r.code === 0) fails.push(`${JSON.stringify(line)}: read as ${JSON.parse(r.out).id}`);
    else if (!PLAIN_ASCII.test(r.out)) fails.push(`${JSON.stringify(line)}: refusal is not plain ASCII`);
  }
  assert.deepEqual(grouped(fails), []);
});

test('company-type resolve: a second or hidden company_type line never wins over the first', () => {
  const cases = [
    ['company_type: research\ncompany_type: design'],
    ['company_type: research\n<!-- company_type: design -->'],
    ['<!-- company_type: design -->\ncompany_type: research']
  ];
  for (const [body] of cases) {
    fs.writeFileSync(PROJECT_FILE, `# Project profile\n\n${body}\nproduct_type: web\n`);
    const r = runCompanyType(['resolve', '--json'], { cwd: repo });
    if (r.code === 0) assert.equal(JSON.parse(r.out).id, 'research', body);
    else assert.match(r.out, /^refused: [\x20-\x7E]+$/);
  }
});

// ---------------------------------------------------------------- bounded work

test('the 4097-character and other long values are handled in bounded time on every surface', () => {
  const slow = [];
  const long = VALUES.filter((v) => v.kind === 'length' || v.id === 'ignorable-many');
  const timed = (label, fn) => {
    const start = performance.now();
    fn();
    const ms = performance.now() - start;
    if (ms > 1000) slow.push(`${label}: ${Math.round(ms)} ms`);
  };
  for (const { id, value: v } of long) {
    for (const surface of LAYER_SURFACES) {
      timed(`${id} ${surface.label}`, () => {
        resetFiles();
        try {
          writeLayer('user', surface.layer(v), { home, cwd: repo, pluginRoot });
        } catch (error) {
          if (!(error instanceof Refusal)) throw error;
        }
      });
    }
    timed(`${id} goal`, () => {
      writeTemplate();
      try {
        writeProfile({ goal: v }, { cwd: repo, pluginRoot });
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
      }
    });
    timed(`${id} language`, () => runLanguage(['set', v], { home, cwd: repo }));
  }
  assert.deepEqual(slow, []);
});
