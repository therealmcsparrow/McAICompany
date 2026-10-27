// Contract suites for role-names v1.1, aico-settings v1.3, dispatch-prompt v3.2, brainstorm-file v2.1
// and company-type v1. Each test reads what the Contract promises and drives the shipped scripts,
// the settings server and the shipped files through their public interface only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NAME_RE, PERSONALITY_TEXT_RE, PERSONALITY_LEVELS, check } from './check.mjs';
import { run as runCompanyType, loadRegistry } from './company-type.mjs';
import { renderPersonality, personalityBlock } from './personality.mjs';
import { resolvePersonalities, validateLayer } from './settings.mjs';
import { startServer } from './settings-server.mjs';
import { stageFiles } from './brainstorm.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const json = f => JSON.parse(read(f));
const exists = f => fs.existsSync(path.join(root, f));
const REPLIES = path.join(root, 'tests', 'fixtures', 'brainstorm', 'replies');

const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = prefix => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(d);
  return d;
};

// A throwaway user home and product repo, with the shipped scripts run as a CLI.
function sandbox({ projectMd = null } = {}) {
  const dir = tmp('contract-');
  const home = path.join(dir, 'home');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(repo, '.company'), { recursive: true });
  if (projectMd !== null) fs.writeFileSync(path.join(repo, '.company', 'project.md'), projectMd);
  return {
    dir, home, repo,
    userFile: path.join(home, 'config.json'),
    projectFile: path.join(repo, '.company', 'settings.json'),
    profile: path.join(repo, '.company', 'project.md'),
    user: layer => fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ aico_settings: { version: 1, ...layer } })),
    project: layer => fs.writeFileSync(path.join(repo, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1, ...layer } })),
    run(script, args, input) {
      const r = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
        cwd: repo, input, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home, HOME: home, USERPROFILE: home }
      });
      return { code: r.status, out: r.stdout, err: r.stderr };
    }
  };
}

const AGENTS = fs.readdirSync(path.join(root, 'agents')).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort();
const frontmatter = text => Object.fromEntries((/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '').split('\n').map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
const PLAYBOOKS = fs.readdirSync(path.join(root, 'skills'))
  .filter(n => exists(`skills/${n}/SKILL.md`) && frontmatter(read(`skills/${n}/SKILL.md`))['disable-model-invocation'] === 'true').sort();
const ALWAYS = ['help', 'version', 'language', 'settings', 'setup', 'lead', 'triage', 'skillspector'];
const TYPES = ['software', 'research', 'marketing', 'design'];
const manifest = id => json(`company/types/${id}.json`);

// A private copy of the plugin, to change a shipped file and see what the static check says.
let copyDir = null;
function pluginCopy() {
  if (copyDir) return copyDir;
  copyDir = tmp('contract-copy-');
  const skip = new Set(['.git', 'node_modules', '.company', '.superpowers', '.claude']);
  fs.cpSync(root, copyDir, { recursive: true, filter: src => !skip.has(path.basename(src)) });
  return copyDir;
}
// Errors of the static check with one shipped file changed (or created), then the file is put back.
function checkWith(rel, mutate) {
  const file = path.join(pluginCopy(), rel);
  const had = fs.existsSync(file);
  const original = had ? fs.readFileSync(file, 'utf8') : null;
  try {
    if (!had) fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, mutate(original));
    return check(pluginCopy()).errors;
  } finally {
    if (had) fs.writeFileSync(file, original); else fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

// ================= role-names v1.1 ==========================================================

const roleDoc = read('docs/contracts/role-names.md');
const [NAME_SRC, TEXT_SRC] = [...roleDoc.matchAll(/matching `([^`]+)`u/g)].map(m => m[1]);
const DOC_NAME_RE = new RegExp(NAME_SRC, 'u');
const DOC_TEXT_RE = new RegExp(TEXT_SRC, 'u');
const PHRASES = { intelligence: {}, creativity: {} };
for (const m of roleDoc.matchAll(/^\| `(low|medium|high)` \| ([^|]+?) \| ([^|]+?) \|$/gm)) {
  PHRASES.intelligence[m[1]] = m[2];
  PHRASES.creativity[m[1]] = m[3];
}
const TEMPLATE = /```\n(Personality:\n[\s\S]*?)```/.exec(roleDoc)[1];
function blockFromContract(v) {
  return TEMPLATE
    .replace('<temperament>', v.temperament).replace('<talk>', v.talk).replace('<topic>', v.topic)
    .replace('<level>, <intelligence phrase>', `${v.intelligence}, ${PHRASES.intelligence[v.intelligence]}`)
    .replace('<level>, <creativity phrase>', `${v.creativity}, ${PHRASES.creativity[v.creativity]}`);
}
const DEFAULTS = json('company/personalities.json');

test('role-names: the code rules are the rules the Contract prints', () => {
  assert.equal(NAME_RE.source, DOC_NAME_RE.source);
  assert.equal(PERSONALITY_TEXT_RE.source, DOC_TEXT_RE.source);
  assert.equal(PERSONALITY_TEXT_RE.flags, 'u');
  assert.deepEqual(PERSONALITY_LEVELS, ['low', 'medium', 'high']);
  for (const ok of ['calm and patient', "it's fine, really!", 'Zażółć gęślą 42', 'a'.repeat(80), 'x']) assert.ok(DOC_TEXT_RE.test(ok), ok);
  for (const bad of ['', 'a'.repeat(81), ' lead', 'trail ', 'two  spaces', 'new\nline', 'tab\tx', 'say "hi"', 'a: b', '<b>', '`x`', 'a;b', 'a/b', '​x'])
    assert.ok(!DOC_TEXT_RE.test(bad), JSON.stringify(bad));
});

test('role-names: one name per Role, valid and unique, and the editor is Role 34', () => {
  const names = json('company/names.json');
  assert.deepEqual(Object.keys(names).sort(), AGENTS);
  assert.equal(AGENTS.length, 34);
  assert.ok(AGENTS.includes('editor'));
  for (const [role, name] of Object.entries(names)) assert.ok(DOC_NAME_RE.test(name), `${role}: ${name}`);
  const lower = Object.values(names).map(n => n.toLowerCase());
  assert.equal(new Set(lower).size, lower.length);
  assert.match(roleDoc, /`editor`/);
});

test('role-names: the shipped personalities have one entry per Role, five valid keys each, nothing else', () => {
  assert.deepEqual(Object.keys(DEFAULTS).sort(), AGENTS);
  for (const [role, p] of Object.entries(DEFAULTS)) {
    assert.deepEqual(Object.keys(p).sort(), ['creativity', 'intelligence', 'talk', 'temperament', 'topic'], role);
    for (const key of ['temperament', 'talk', 'topic']) assert.ok(DOC_TEXT_RE.test(p[key]), `${role}.${key}`);
    for (const key of ['intelligence', 'creativity']) assert.ok(PERSONALITY_LEVELS.includes(p[key]), `${role}.${key}`);
  }
});

test('role-names: the rendered block is the Contract block byte for byte, for every pair of levels', () => {
  const values = { temperament: 'calm and patient', talk: 'short sentences, dry jokes', topic: 'clean interfaces' };
  let seen = 0;
  for (const intelligence of PERSONALITY_LEVELS) {
    for (const creativity of PERSONALITY_LEVELS) {
      const v = { ...values, intelligence, creativity };
      const block = renderPersonality(v);
      assert.equal(block, blockFromContract(v), `${intelligence} / ${creativity}`);
      assert.ok(block.endsWith('\n') && !block.endsWith('\n\n') && !block.includes('\r'));
      seen += 1;
    }
  }
  assert.equal(seen, 9);
  for (const role of AGENTS) assert.equal(renderPersonality(DEFAULTS[role]), blockFromContract(DEFAULTS[role]), role);
});

test('role-names: rendering refuses a value that breaks a rule and never repeats it', () => {
  const good = DEFAULTS.architect;
  for (const [key, value] of [['temperament', 'say "hi"'], ['talk', 'a\nb'], ['topic', '<x>'], ['intelligence', 'extreme'], ['creativity', 'HIGH']]) {
    assert.throws(() => renderPersonality({ ...good, [key]: value }), e => !e.message.includes(value) || value.length < 3);
  }
  assert.throws(() => renderPersonality({ ...good, topic: undefined }));
});

test('role-names: project beats user beats plugin per key, and a bad stored value falls to the level below with a warning that omits it', () => {
  const sb = sandbox();
  const d = DEFAULTS.qa;
  sb.user({ roles: { qa: { personality: { temperament: 'user mood', talk: 'user talk', topic: 'user topic' } } } });
  sb.project({ roles: { qa: { personality: { talk: 'project talk', topic: 'bad "topic"', creativity: 'high' } } } });
  const r = resolvePersonalities({ home: sb.home, cwd: sb.repo });
  assert.deepEqual(r.roles.qa.temperament, { value: 'user mood', source: 'user' });
  assert.deepEqual(r.roles.qa.talk, { value: 'project talk', source: 'project' });
  assert.deepEqual(r.roles.qa.topic, { value: 'user topic', source: 'user' }, 'the bad project value is skipped');
  assert.deepEqual(r.roles.qa.intelligence, { value: d.intelligence, source: 'plugin' });
  assert.deepEqual(r.roles.qa.creativity, { value: 'high', source: 'project' });
  assert.ok(r.warnings.some(w => w.startsWith('roles.qa.personality.topic: ignored, ')), JSON.stringify(r.warnings));
  assert.ok(!JSON.stringify(r.warnings).includes('bad "topic"'));
});

test('role-names: personalities exist only on the three social surfaces', () => {
  assert.match(read('skills/cooler/SKILL.md'), /^Personality:/m);
  assert.match(read('skills/brainstorm/references/format-1.md'), /^Personality:/m);
  assert.match(read('scripts/brainstorm.mjs'), /personalityBlock/);
  for (const rel of ['skills/pipeline/SKILL.md', 'skills/research/SKILL.md', 'skills/brainstorm/SKILL.md', 'skills/brainstorm/references/format-2.md']) {
    assert.doesNotMatch(read(rel), /^Personality:/m, rel);
  }
});

test('role-names: a personalities file with a missing key or a bad value fails the static check, naming the field and not the value', () => {
  const missing = checkWith('company/personalities.json', t => {
    const o = JSON.parse(t);
    delete o.architect.topic;
    return JSON.stringify(o);
  });
  assert.ok(missing.some(e => e.includes('architect.topic')), String(missing));
  const bad = checkWith('company/personalities.json', t => {
    const o = JSON.parse(t);
    o.qa.talk = 'say "ZQXvalueZQX"';
    return JSON.stringify(o);
  });
  assert.ok(bad.some(e => e.includes('qa.talk')), String(bad));
  assert.ok(!bad.join('\n').includes('ZQXvalueZQX'));
  const extra = checkWith('company/personalities.json', t => JSON.stringify({ ...JSON.parse(t), ghost: DEFAULTS.qa }));
  assert.ok(extra.length > 0);
});

// ================= aico-settings v1.3 =======================================================

test('aico-settings: get has the documented keys, no personality, and refuses the personality paths', () => {
  const sb = sandbox();
  sb.user({ roles: { qa: { personality: { talk: 'ZQXuserZQX' } } } });
  const got = sb.run('settings.mjs', ['get']);
  assert.equal(got.code, 0, got.err);
  const data = JSON.parse(got.out);
  assert.deepEqual(Object.keys(data).sort(), ['brainstorm', 'gates', 'ignored', 'language', 'mods', 'pipeline', 'profile', 'revision', 'roles', 'skillspector', 'unlocked', 'warnings']);
  for (const entry of Object.values(data.roles)) assert.deepEqual(Object.keys(entry).sort(), ['context_cap', 'effort', 'model', 'name', 'source']);
  assert.doesNotMatch(got.out, /ZQX|personalit/i);
  for (const key of ['roles.qa.personality', 'roles.qa.personality.talk']) {
    const one = sb.run('settings.mjs', ['get', key]);
    assert.equal(one.code, 2);
    assert.equal(one.out.trim(), `refused: no setting ${key}`);
  }
});

test('aico-settings: the refusal lines are the Contract lines, path first, and the value is never echoed', () => {
  const roles = new Set(AGENTS);
  const lines = (personality) => validateLayer({ version: 1, roles: { qa: { personality } } }, roles);
  assert.deepEqual(lines('text'), ['roles.qa.personality: must be an object']);
  assert.deepEqual(lines({ bogus: 'x' }), ['roles.qa.personality.bogus: unknown key']);
  assert.deepEqual(lines({ 'Bad Key!': 'x' }), ['roles.qa.personality.?: unknown key']);
  for (const key of ['temperament', 'talk', 'topic']) {
    assert.deepEqual(lines({ [key]: 'a'.repeat(81) }), [`roles.qa.personality.${key}: must be 1 to 80 characters`]);
    assert.deepEqual(lines({ [key]: '' }), [`roles.qa.personality.${key}: must be 1 to 80 characters`]);
    assert.deepEqual(lines({ [key]: 'two\nlines' }), [`roles.qa.personality.${key}: must be one line of letters, digits, single spaces and , . ' - ! ?`]);
  }
  for (const key of ['intelligence', 'creativity']) assert.deepEqual(lines({ [key]: 'huge' }), [`roles.qa.personality.${key}: must be low, medium or high`]);
  assert.deepEqual(lines({ temperament: 'ok', talk: 'fine', topic: 'tea', intelligence: 'low', creativity: 'high' }), []);
});

test('aico-settings: the page payload carries the rule, the per-level values and the ignored entries; a save is all or nothing and stores version 1', async () => {
  const sb = sandbox({ projectMd: '# P\nproduct_type: web\n' });
  sb.project({ roles: { qa: { personality: { topic: 'bad:value' } } } });
  const server = await startServer({ home: sb.home, cwd: sb.repo, open: false, log: () => {} });
  const origin = `http://127.0.0.1:${server.port}`;
  const api = (p, init = {}) => fetch(`${origin}${p}`, { ...init, headers: { 'X-Aico-Token': server.token, ...init.headers } });
  const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body), headers: { Origin: origin, 'Content-Type': 'application/json' } });
  try {
    const state = await (await api('/api/state')).json();
    const p = state.personalities;
    assert.deepEqual(Object.keys(p).sort(), ['ignored', 'roles', 'rule']);
    assert.deepEqual(Object.keys(p.rule).sort(), ['flags', 'levels', 'max', 'phrases', 'text_re']);
    assert.equal(p.rule.text_re, PERSONALITY_TEXT_RE.source);
    assert.equal(p.rule.max, 80);
    assert.deepEqual(p.rule.phrases, PHRASES);
    assert.deepEqual(Object.keys(p.roles.qa).sort(), ['effective', 'plugin', 'project', 'user']);
    assert.deepEqual(p.ignored.map(e => [e.level, e.path]), [['project', 'roles.qa.personality.topic']]);
    assert.ok(!JSON.stringify(p).includes('bad:value'), 'the stored bad value is not in the personality payload');
    // A stored bad value in the project layer never blocks a Save that carries only the user layer.
    const unrelated = await post('/api/save', { revision: state.resolved.revision, user: { version: 1, gates: { brief: 'auto' } } });
    assert.equal(unrelated.status, 200, await unrelated.clone().text());
    // One bad value refuses the whole save.
    const next = (await (await api('/api/state')).json()).resolved.revision;
    const mixed = await post('/api/save', { revision: next, user: { version: 1, roles: { qa: { personality: { talk: 'fine words', creativity: 'wild' } } } } });
    assert.equal(mixed.status, 400);
    assert.deepEqual((await mixed.json()).refused, ['user roles.qa.personality.creativity: must be low, medium or high']);
    assert.ok(!JSON.parse(fs.readFileSync(sb.userFile, 'utf8')).aico_settings.roles, 'nothing of the refused save was stored');
    const ok = await post('/api/save', { revision: next, user: { version: 1, gates: { brief: 'auto' }, roles: { qa: { personality: { talk: 'fine words' } } } } });
    assert.equal(ok.status, 200);
    const stored = JSON.parse(fs.readFileSync(sb.userFile, 'utf8')).aico_settings;
    assert.equal(stored.version, 1);
    assert.equal(stored.roles.qa.personality.talk, 'fine words');
  } finally {
    await server.close();
  }
});

test('aico-settings: a broken project personality layer holds the locks closed, and a broken plugin file renders nothing', () => {
  const sb = sandbox();
  sb.user({ gates: { ship: 'auto', installs: 'auto' }, unlocked: ['ship', 'installs'] });
  const gate = key => sb.run('settings.mjs', ['get', key]).out.trim();
  assert.deepEqual([gate('gates.ship'), gate('gates.installs')], ['auto', 'auto']);
  sb.project({ roles: { qa: { personality: { talk: 'x\ny' } } } });
  assert.deepEqual([gate('gates.ship'), gate('gates.installs')], ['ask', 'ask']);
  // A plugin whose defaults file cannot be read: no personality, a warning, no throw.
  const plugin = tmp('contract-plugin-');
  fs.mkdirSync(path.join(plugin, 'agents'));
  fs.mkdirSync(path.join(plugin, 'company'));
  fs.writeFileSync(path.join(plugin, 'agents', 'qa.md'), '---\nname: qa\ndescription: x\ntools: Read\nmodel: sonnet\neffort: low\n---\n');
  fs.writeFileSync(path.join(plugin, 'company', 'names.json'), '{"qa":"Quinn"}');
  fs.writeFileSync(path.join(plugin, 'company', 'personalities.json'), '{not json');
  const fresh = sandbox();
  const r = resolvePersonalities({ home: fresh.home, cwd: fresh.repo, pluginRoot: plugin });
  assert.equal(personalityBlock('qa', { home: fresh.home, cwd: fresh.repo, pluginRoot: plugin }), '');
  assert.ok(Array.isArray(r.warnings));
});

// ================= dispatch-prompt v3.2 =====================================================

const promptDoc = read('docs/contracts/dispatch-prompt.md');
const dispatchBlocks = rel => {
  const out = [];
  let open = null;
  read(rel).split('\n').forEach((line, i) => {
    const m = /^\s*(`{3,})/.exec(line);
    if (!open) { if (m) open = { size: m[1].length, start: i + 1, lines: [] }; }
    else if (m && m[1].length >= open.size && /^\s*`+\s*$/.test(line)) { out.push(open); open = null; }
    else open.lines.push(line);
  });
  return out.filter(b => b.lines.some(l => /^Name:/.test(l)));
};

test('dispatch-prompt: the Personality line is the last line of a cooler turn and a format 1 round and appears in no other dispatch', () => {
  assert.match(promptDoc, /^# Contract: dispatch-prompt v3\.2/);
  for (const rel of ['skills/cooler/SKILL.md', 'skills/brainstorm/references/format-1.md']) {
    const withLine = dispatchBlocks(rel).filter(b => b.lines.some(l => /^Personality:/.test(l)));
    assert.ok(withLine.length >= 1, rel);
    for (const b of withLine) {
      const lines = b.lines.filter(l => l.trim());
      assert.match(lines.at(-1), /^Personality:/, `${rel}:${b.start}`);
      const order = ['Project profile', 'Company profile', 'Language', 'Name'].map(k => lines.findIndex(l => l.startsWith(`${k}:`)));
      assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the earlier lines keep their order');
      assert.ok(!lines.some(l => /^Output: \.company\/work\//.test(l)), 'a social turn writes no Handoff');
    }
  }
  for (const rel of ['skills/pipeline/SKILL.md', 'skills/research/SKILL.md', 'skills/brainstorm/SKILL.md', 'skills/brainstorm/references/format-2.md']) {
    for (const b of dispatchBlocks(rel)) assert.ok(!b.lines.some(l => /^Personality:/.test(l)), `${rel}:${b.start}`);
  }
  assert.match(promptDoc, /Never `Personality:`\./);
});

test('dispatch-prompt: stage writes one file per Role and prints paths only; the folder ignores itself', () => {
  const sb = sandbox();
  const r = sb.run('personality.mjs', ['stage', 'brainstorm-20261027-1200', 'architect,writer,architect']);
  assert.equal(r.code, 0, r.out);
  const out = JSON.parse(r.out);
  assert.deepEqual(Object.keys(out).sort(), ['files', 'run']);
  assert.equal(out.run, 'brainstorm-20261027-1200');
  assert.deepEqual(Object.keys(out.files).sort(), ['architect', 'writer']);
  const dir = path.join(sb.repo, '.company', 'personality-input', out.run);
  for (const role of ['architect', 'writer']) {
    assert.equal(path.resolve(out.files[role]), path.join(dir, `${role}.md`));
    assert.equal(fs.readFileSync(out.files[role], 'utf8'), blockFromContract(DEFAULTS[role]));
  }
  assert.equal(fs.readFileSync(path.join(sb.repo, '.company', 'personality-input', '.gitignore'), 'utf8').trim(), '*');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['architect.md', 'writer.md'], 'no temp files stay');
  assert.doesNotMatch(r.out + r.err, /Style data|temperament|pet topic/);
});

test('dispatch-prompt: bad run names, unknown Roles and foreign entries are refused on stdout with exit 2 and write nothing', () => {
  const sb = sandbox();
  const folder = path.join(sb.repo, '.company', 'personality-input');
  const refusals = [
    ['stage', 'cooler-2026102-1200', 'qa'], ['stage', '../cooler-20261027-1200', 'qa'], ['stage', 'research-20261027-1200', 'qa'],
    ['stage', 'cooler-20261027-1200', 'ghost'], ['stage', 'cooler-20261027-1200', '../agents/qa'], ['stage', 'cooler-20261027-1200', ''],
    ['stage', 'cooler-20261027-1200'], ['clean', 'nope'], ['print', 'cooler-20261027-1200', 'qa'], ['show'], []
  ];
  for (const args of refusals) {
    const r = sb.run('personality.mjs', args);
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.match(r.out, /^refused: /, JSON.stringify(args));
  }
  assert.equal(fs.existsSync(folder), false, 'nothing was written by any refusal');
  // A foreign entry in the run folder refuses the whole stage and keeps what was there.
  const run = 'cooler-20261027-1300';
  assert.equal(sb.run('personality.mjs', ['stage', run, 'qa']).code, 0);
  fs.writeFileSync(path.join(folder, run, 'notes.txt'), 'mine');
  const blocked = sb.run('personality.mjs', ['stage', run, 'qa,writer']);
  assert.equal(blocked.code, 2);
  assert.equal(blocked.out.trim(), `refused: unexpected entry in ${run}`);
  assert.equal(fs.existsSync(path.join(folder, run, 'writer.md')), false);
  assert.equal(sb.run('personality.mjs', ['clean', run]).code, 2);
  assert.equal(fs.readFileSync(path.join(folder, run, 'notes.txt'), 'utf8'), 'mine');
});

test('dispatch-prompt: clean removes that run only', () => {
  const sb = sandbox();
  sb.run('personality.mjs', ['stage', 'cooler-20261027-1200', 'qa']);
  sb.run('personality.mjs', ['stage', 'cooler-20261027-1201', 'qa']);
  const r = sb.run('personality.mjs', ['clean', 'cooler-20261027-1200']);
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), 'cleaned cooler-20261027-1200');
  const left = fs.readdirSync(path.join(sb.repo, '.company', 'personality-input')).sort();
  assert.deepEqual(left, ['.gitignore', 'cooler-20261027-1201']);
});

test('dispatch-prompt: the exports give the block, or nothing for a Role without one', () => {
  const sb = sandbox();
  const ctx = { home: sb.home, cwd: sb.repo };
  assert.equal(personalityBlock('architect', ctx), blockFromContract(DEFAULTS.architect));
  for (const role of ['ghost', '../architect', '__proto__', 'constructor', '']) assert.equal(personalityBlock(role, ctx), '', JSON.stringify(role));
});

test('dispatch-prompt: the v3.1 Context cap rule still holds under v3.2', () => {
  assert.deepEqual(check(pluginCopy()).errors, [], 'the copy starts clean');
  const errors = checkWith('skills/pipeline/SKILL.md', t => t.replace(/^Context cap: .*\n/m, ''));
  assert.ok(errors.some(e => /skills\/pipeline\/SKILL\.md/.test(e) && /no Context cap:/.test(e)), String(errors));
  assert.match(promptDoc, /\| `Context cap: <cap> handover <n>` \|/);
  assert.match(promptDoc, /\*\*Pipeline Step:\*\* `Project profile:`, `Company profile:`, `Language:`, `Name:`, `Settings:` \(optional\), `Context cap:`/);
});

// ================= brainstorm-file v2.1 =====================================================

const NAMES = { architect: 'Ava (architect)', writer: 'Ren (writer)', 'product-manager': 'Pat (product-manager)' };
const reply = n => fs.readFileSync(path.join(REPLIES, n), 'utf8');
const repliesOf = map => Object.fromEntries(Object.entries(map).map(([role, f]) => [NAMES[role], reply(f)]));

function brainstormRun(sb, name = '2026-10-27 09.00 - Tea.md', roles = 'architect,writer,product-manager') {
  const folder = path.join(sb.repo, '.company', 'brainstorms');
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, name);
  assert.equal(sb.run('brainstorm.mjs', ['new', file], JSON.stringify({ topic: 'Tea', roles, mode: 'debate' })).code, 0);
  const inputDir = path.join(sb.repo, '.company', 'brainstorm-input', `brainstorm-${name.slice(0, 10).replaceAll('-', '')}-${name.slice(11, 16).replace('.', '')}`);
  return { file, inputDir, stage: (...args) => sb.run('brainstorm.mjs', ['stage', file, ...args]) };
}

test('brainstorm-file: every pass and a re-ask hold the block between Pass and Topic, in the Role\'s own file', () => {
  const sb = sandbox();
  const bs = brainstormRun(sb);
  const startsRight = (role, n, pass) => {
    const input = fs.readFileSync(path.join(bs.inputDir, `${role}.md`), 'utf8');
    assert.ok(input.startsWith(`Round: ${n}\nPass: ${pass}\n${blockFromContract(DEFAULTS[role])}Topic:\n`), `${role} round ${n} ${pass}:\n${input.slice(0, 200)}`);
  };
  const s1 = bs.stage('1');
  assert.equal(s1.code, 0, s1.err);
  assert.deepEqual(Object.keys(JSON.parse(s1.out)).sort(), ['files', 'run']);
  for (const role of Object.keys(NAMES)) startsRight(role, 1, 'ideas');
  const a1 = sb.run('brainstorm.mjs', ['apply', bs.file, '1'], JSON.stringify({ replies: repliesOf({ architect: 'r1-architect.txt', writer: 'r1-writer.txt', 'product-manager': 'r1-pm.txt' }), lead: 'Local first.' }));
  assert.equal(a1.code, 0, a1.err);
  assert.equal(bs.stage('2').code, 0);
  for (const role of Object.keys(NAMES)) startsRight(role, 2, 'ideas');
  const a2 = sb.run('brainstorm.mjs', ['apply', bs.file, '2', '--mode', 'debate:full_pass'], JSON.stringify({ replies: repliesOf({ architect: 'r2-architect.txt', writer: 'r2-writer.txt', 'product-manager': 'r2-pm.txt' }), lead: '' }));
  assert.equal(a2.code, 0, a2.err);
  assert.equal(bs.stage('2', '--pass', 'full').code, 0);
  for (const role of Object.keys(NAMES)) startsRight(role, 2, 'full');
  const pair = JSON.parse(sb.run('brainstorm.mjs', ['crossfire', bs.file, '2']).out);
  assert.equal(pair.length, 2);
  assert.equal(bs.stage('2', '--pass', 'crossfire').code, 0);
  assert.deepEqual(fs.readdirSync(bs.inputDir).sort(), pair.map(r => `${r}.md`).sort(), 'a Role not staged has no file');
  for (const role of pair) startsRight(role, 2, 'crossfire');
  // A re-ask goes to one Role, with the block in the same place.
  const q = brainstormRun(sb, '2026-10-27 10.00 - Re ask.md', 'architect,writer');
  const bad = sb.run('brainstorm.mjs', ['apply', q.file, '1'], JSON.stringify({ replies: { 'Ava (architect)': 'I: only an idea, no risk line' }, lead: '' }));
  assert.equal(bad.code, 0, bad.err);
  const re = q.stage('1', '--reask', 'architect');
  assert.equal(re.code, 0, re.err);
  const input = fs.readFileSync(path.join(q.inputDir, 'architect.md'), 'utf8');
  assert.ok(input.startsWith(`Round: 1\nPass: ideas\n${blockFromContract(DEFAULTS.architect)}Topic:\n`));
  assert.match(input, /\nRe-ask:\n/);
});

test('brainstorm-file: the block appears nowhere else, and the file still passes its own check', () => {
  const sb = sandbox();
  const bs = brainstormRun(sb);
  const seen = [];
  const take = r => { assert.equal(r.code, 0, r.err); seen.push(r.out, r.err); };
  take(bs.stage('1'));
  take(sb.run('brainstorm.mjs', ['apply', bs.file, '1'], JSON.stringify({ replies: repliesOf({ architect: 'r1-architect.txt', writer: 'r1-writer.txt', 'product-manager': 'r1-pm.txt' }), lead: 'Local first.' })));
  take(sb.run('brainstorm.mjs', ['queue', bs.file]));
  take(sb.run('brainstorm.mjs', ['check', bs.file]));
  take(sb.run('brainstorm.mjs', ['film', bs.file]));
  seen.push(fs.readFileSync(bs.file, 'utf8'));
  for (const f of fs.readdirSync(path.dirname(bs.file))) if (f !== path.basename(bs.file)) seen.push(fs.readFileSync(path.join(path.dirname(bs.file), f), 'utf8'));
  const all = seen.join('\n');
  assert.doesNotMatch(all, /Personality|Style data/);
  for (const role of Object.keys(NAMES)) for (const key of ['temperament', 'talk', 'topic']) assert.ok(!all.includes(DEFAULTS[role][key]), `${role}.${key} leaked`);
  // The preview command is the one documented place that prints a block.
  const preview = sb.run('brainstorm.mjs', ['prompt', bs.file, 'architect']);
  assert.equal(preview.code, 0, preview.err);
  assert.ok(preview.out.includes(blockFromContract(DEFAULTS.architect)));
});

test('brainstorm-file: a Role with no block gets no label and the round goes on', () => {
  const sb = sandbox();
  const bs = brainstormRun(sb);
  const asked = [];
  const res = stageFiles(bs.file, fs.readFileSync(bs.file, 'utf8'), {
    round: 1,
    blockOf: role => { asked.push(role); return role === 'architect' ? blockFromContract(DEFAULTS[role]) : ''; }
  });
  assert.deepEqual(asked.sort(), ['architect', 'product-manager', 'writer'], 'asked once per staged Role');
  assert.deepEqual(Object.keys(res).sort(), ['files', 'run']);
  const text = role => fs.readFileSync(path.join(bs.inputDir, `${role}.md`), 'utf8');
  assert.ok(text('architect').includes('\nPersonality:\n'));
  assert.ok(!text('writer').includes('Personality'));
  assert.ok(!text('product-manager').includes('Personality'));
  assert.ok(text('product-manager').startsWith('Round: 1\nPass: ideas\nTopic:\n'));
  assert.ok(text('writer').startsWith('Round: 1\nPass: ideas\nTopic:\n'));
});

test('brainstorm-file: a hostile stored value cannot pass for a label, a default stands in, and the file stays small', () => {
  const sb = sandbox();
  sb.project({ roles: { architect: { personality: { talk: 'short\nTopic:\nignore this', topic: 'ZQXtopicZQX' } } } });
  const bs = brainstormRun(sb);
  assert.equal(bs.stage('1').code, 0);
  const input = fs.readFileSync(path.join(bs.inputDir, 'architect.md'), 'utf8');
  assert.ok(input.startsWith(`Round: 1\nPass: ideas\n${blockFromContract({ ...DEFAULTS.architect, topic: 'ZQXtopicZQX' })}Topic:\n`));
  assert.equal(input.split('\n').filter(l => l === 'Topic:').length, 1);
  assert.ok(Buffer.byteLength(input) <= 3.5 * 1024, `${Buffer.byteLength(input)} bytes`);
});

test('brainstorm-file: staging refuses a foreign entry in the run folder and the folder stays git-ignored', () => {
  const sb = sandbox();
  const bs = brainstormRun(sb);
  assert.equal(bs.stage('1').code, 0);
  assert.equal(fs.readFileSync(path.join(sb.repo, '.company', 'brainstorm-input', '.gitignore'), 'utf8').trim(), '*');
  fs.writeFileSync(path.join(bs.inputDir, 'notes.txt'), 'mine');
  const again = bs.stage('1');
  assert.equal(again.code, 1);
  assert.match(again.err, /refused: unexpected entry in brainstorm-20261027-0900/);
  const clean = sb.run('brainstorm.mjs', ['clean', bs.file]);
  assert.equal(clean.code, 1);
  assert.equal(fs.readFileSync(path.join(bs.inputDir, 'notes.txt'), 'utf8'), 'mine');
  fs.rmSync(path.join(bs.inputDir, 'notes.txt'));
  const ok = sb.run('brainstorm.mjs', ['clean', bs.file]);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(ok.out.trim(), 'cleaned brainstorm-20261027-0900');
  assert.equal(fs.existsSync(bs.inputDir), false);
  assert.equal(fs.existsSync(path.join(sb.repo, '.company', 'brainstorm-input', '.gitignore')), true);
});

// ================= company-type v1 ==========================================================

const typeDoc = read('docs/contracts/company-type.md');
const CHECKS = ['claims-cited', 'ai-disclosure', 'asset-licences', 'handoff-package'];
const LANES = ['security', 'compliance', 'legal', 'persona', 'hands_on', 'accessibility'];
const KINDS = ['release', 'deliver-report', 'publish', 'design-handoff'];

test('company-type: every shipped manifest obeys the schema of the Contract', () => {
  for (const id of TYPES) {
    const m = manifest(id);
    assert.deepEqual(Object.keys(m).sort(), ['id', 'label', 'playbooks', 'roles', 'ship', 'skill_search', 'v'], id);
    assert.equal(m.v, 1);
    assert.equal(m.id, id);
    assert.match(m.id, /^[a-z][a-z0-9-]{0,31}$/);
    assert.match(m.label, /^[A-Za-z0-9 -]{1,40}$/);
    assert.ok(m.roles.length >= 1 && m.roles.length <= 40 && new Set(m.roles).size === m.roles.length);
    for (const r of m.roles) assert.ok(AGENTS.includes(r), `${id} role ${r}`);
    assert.ok(m.roles.includes('skill-researcher'), id);
    assert.ok(m.playbooks.length >= 1 && m.playbooks.length <= 40 && new Set(m.playbooks).size === m.playbooks.length);
    for (const p of m.playbooks) {
      assert.ok(PLAYBOOKS.includes(p), `${id} playbook ${p}`);
      assert.ok(!ALWAYS.includes(p), `${id} lists the always-on ${p}`);
    }
    assert.deepEqual(Object.keys(m.ship).sort(), ['checks', 'kind', 'lanes', 'meaning']);
    assert.ok(KINDS.includes(m.ship.kind));
    assert.ok(m.ship.meaning.length >= 1 && m.ship.meaning.length <= 240 && !/[`<>\n]/.test(m.ship.meaning));
    assert.ok(m.ship.lanes.length <= 6 && new Set(m.ship.lanes).size === m.ship.lanes.length && m.ship.lanes.every(l => LANES.includes(l)));
    assert.ok(m.ship.checks.length <= 4 && new Set(m.ship.checks).size === m.ship.checks.length && m.ship.checks.every(c => CHECKS.includes(c)));
    assert.deepEqual(Object.keys(m.skill_search), ['hints']);
    assert.ok(m.skill_search.hints.length <= 5 && new Set(m.skill_search.hints).size === m.skill_search.hints.length);
    for (const h of m.skill_search.hints) assert.match(h, /^[a-z0-9][a-z0-9 -]{0,59}$/);
    assert.ok(fs.statSync(path.join(root, 'company', 'types', `${id}.json`)).size <= 64 * 1024);
  }
});

test('company-type: the four shipped types are the table of the Contract', () => {
  const table = {
    software: { kind: 'release', lanes: [], checks: [], playbooks: 'audit, brainstorm, client, cooler, feature, feedback, fix, incident, launch, maintain, pentest, refactor, research, standards, usability-test, vulnscan' },
    research: { kind: 'deliver-report', lanes: ['legal'], checks: ['claims-cited'], playbooks: 'research, client, report, feedback, brainstorm, cooler' },
    marketing: { kind: 'publish', lanes: ['legal', 'accessibility'], checks: ['claims-cited', 'ai-disclosure', 'asset-licences'], playbooks: 'campaign, content, research, client, feedback, brainstorm, cooler' },
    design: { kind: 'design-handoff', lanes: ['legal', 'accessibility', 'security'], checks: ['ai-disclosure', 'asset-licences', 'handoff-package'], playbooks: 'design, research, client, feedback, brainstorm, cooler' }
  };
  const roles = {
    marketing: 'product-manager, account-manager, marketer, writer, brand-artist, prompt-artist, motion-artist, localizer, market-researcher, persona-tester, accessibility-tester, legal, editor, skill-researcher',
    design: 'product-manager, account-manager, ui-ux-designer, design-researcher, ux-researcher, brand-artist, motion-artist, prompt-artist, game-artist, persona-tester, hands-on-tester, accessibility-tester, frontend-engineer, code-reviewer, security, writer, legal, skill-researcher',
    research: 'product-manager, account-manager, market-researcher, tech-researcher, ux-researcher, writer, legal, localizer, editor, skill-researcher'
  };
  const sorted = a => [...a].sort();
  for (const id of TYPES) {
    const m = manifest(id);
    assert.equal(m.ship.kind, table[id].kind, id);
    assert.deepEqual(sorted(m.ship.lanes), sorted(table[id].lanes), id);
    assert.deepEqual(sorted(m.ship.checks), sorted(table[id].checks), id);
    assert.deepEqual(sorted(m.playbooks), sorted(table[id].playbooks.split(', ')), id);
    if (roles[id]) assert.deepEqual(sorted(m.roles), sorted(roles[id].split(', ')), id);
    assert.ok(typeDoc.includes(`| \`${id}\` |`), `${id} is in the Contract table`);
  }
  assert.deepEqual(sorted(manifest('software').roles), AGENTS.filter(a => a !== 'editor'));
  // The research example printed in the Contract is the shipped research manifest.
  const example = JSON.parse(/```json\n([\s\S]*?)```/.exec(typeDoc)[1]);
  const research = manifest('research');
  assert.deepEqual(sorted(example.roles), sorted(research.roles));
  assert.deepEqual(sorted(example.playbooks), sorted(research.playbooks));
  assert.deepEqual(example.ship.kind, research.ship.kind);
});

test('company-type: the manifests and the always-on commands cover every Playbook exactly', () => {
  const union = new Set(TYPES.flatMap(id => manifest(id).playbooks));
  assert.deepEqual([...PLAYBOOKS].sort(), [...new Set([...union, ...ALWAYS])].sort());
  const t = JSON.parse(runCompanyType(['resolve'], { cwd: sandbox().repo }).out);
  assert.equal(t.playbooks.length, 24);
  assert.deepEqual(t.playbooks.slice(-8), ALWAYS);
  // A Playbook that no manifest lists is an error for the static check.
  const orphan = checkWith('skills/zz-orphan/SKILL.md', () => '---\nname: zz-orphan\ndescription: Use when testing the orphan rule.\ndisable-model-invocation: true\n---\n# Orphan\n');
  assert.ok(orphan.some(e => e.includes('zz-orphan')), String(orphan));
});

test('company-type: every Playbook has the Type line after its Help line, with one empty line between', () => {
  const listed = PLAYBOOKS.filter(n => !ALWAYS.includes(n));
  assert.equal(listed.length, 20);
  for (const name of listed) {
    const lines = read(`skills/${name}/SKILL.md`).split('\n');
    const help = lines.findIndex(l => l.startsWith('**Help:**'));
    assert.ok(help > 0, name);
    assert.equal(lines[help + 1], '', name);
    assert.equal(lines[help + 2], `**Type:** run \`node "\${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" check-playbook ${name}\` first; exit not 0 → show its output line and stop.`, name);
    assert.equal(lines.filter(l => l.startsWith('**Type:**')).length, 1, name);
  }
  for (const name of ALWAYS) assert.doesNotMatch(read(`skills/${name}/SKILL.md`), /^\*\*Type:\*\*/m, name);
  const noGap = checkWith('skills/fix/SKILL.md', t => t.replace(/(\*\*Help:\*\*[^\n]*\n)\n(\*\*Type:\*\*)/, '$1$2'));
  assert.ok(noGap.some(e => e.includes('skills/fix/SKILL.md')), String(noGap));
  const wrongName = checkWith('skills/fix/SKILL.md', t => t.replace('check-playbook fix', 'check-playbook feature'));
  assert.ok(wrongName.some(e => e.includes('skills/fix/SKILL.md')), String(wrongName));
});

test('company-type: a shipped manifest that breaks a rule refuses with exit 3 and the rule name; a registry without software too', () => {
  const plugin = tmp('contract-types-');
  fs.cpSync(path.join(root, 'agents'), path.join(plugin, 'agents'), { recursive: true });
  fs.cpSync(path.join(root, 'skills'), path.join(plugin, 'skills'), { recursive: true });
  fs.cpSync(path.join(root, 'company'), path.join(plugin, 'company'), { recursive: true });
  const cwd = sandbox().repo;
  const resolve = () => runCompanyType(['resolve'], { cwd, pluginRoot: plugin });
  assert.equal(resolve().code, 0);
  const file = path.join(plugin, 'company', 'types', 'research.json');
  const good = fs.readFileSync(file, 'utf8');
  const cases = [
    [m => ({ ...m, extra: 1 }), 'unknown key'],
    [m => ({ ...m, v: 2 }), 'v must be 1'],
    [m => ({ ...m, roles: m.roles.filter(r => r !== 'skill-researcher') }), 'roles must include skill-researcher'],
    [m => ({ ...m, playbooks: [...m.playbooks, 'help'] }), 'playbooks'],
    [m => ({ ...m, ship: { ...m.ship, kind: 'ship-it' } }), 'ship.kind']
  ];
  for (const [change, rule] of cases) {
    fs.writeFileSync(file, JSON.stringify(change(JSON.parse(good))));
    assert.deepEqual(resolve(), { code: 3, out: `refused: type manifest research invalid: ${rule}` }, rule);
  }
  fs.writeFileSync(file, good);
  assert.equal(resolve().code, 0);
  fs.rmSync(path.join(plugin, 'company', 'types', 'software.json'));
  assert.deepEqual(resolve(), { code: 3, out: 'refused: type manifest software invalid: missing' });
  assert.equal(Object.keys(loadRegistry(root)).length, 4);
});

test('company-type: the project field is read as the Contract says', () => {
  const resolveWith = text => {
    const sb = sandbox({ projectMd: text });
    return sb.run('company-type.mjs', ['resolve']);
  };
  const id = r => { const j = JSON.parse(r.out); return [j.id, j.source]; };
  assert.deepEqual(id(resolveWith('# P\nproduct_type: web\n')), ['software', 'default']);
  assert.deepEqual(id(resolveWith('company_type: design\n')), ['design', 'project']);
  assert.deepEqual(id(resolveWith('company_type: \t marketing \t\n')), ['marketing', 'project'], 'spaces and tabs are trimmed');
  assert.deepEqual(id(resolveWith('<!-- company_type: design -->\nproduct_type: web\n')), ['software', 'default'], 'a comment is not a line');
  assert.deepEqual(id(resolveWith('  company_type: design\n')), ['software', 'default'], 'an indented line is not a line');
  assert.deepEqual(id({ out: JSON.stringify(JSON.parse(runCompanyType(['resolve'], { cwd: sandbox().repo }).out)) }), ['software', 'default'], 'no project file');
  const hostile = resolveWith('company_type: <script>ZQX</script>\n');
  assert.equal(hostile.code, 2);
  assert.equal(hostile.out.trim(), 'refused: company_type is not valid; allowed: software, research, marketing, design');
  assert.doesNotMatch(hostile.out + hostile.err, /ZQX|script/);
  assert.equal(resolveWith('company_type: research\ncompany_type: research\n').code, 2);
});

test('company-type: the commands print what the Contract table says', () => {
  const sb = sandbox({ projectMd: '# P\n\ncompany_type: marketing\nproduct_type: web\n' });
  const m = manifest('marketing');
  const resolved = JSON.parse(sb.run('company-type.mjs', ['resolve']).out);
  assert.deepEqual(Object.keys(resolved), ['v', 'id', 'source', 'label', 'roles', 'playbooks', 'ship', 'skill_search']);
  assert.deepEqual(resolved.playbooks, [...m.playbooks, ...ALWAYS]);
  assert.deepEqual(resolved.roles, m.roles);
  assert.deepEqual(resolved.ship, m.ship);
  assert.deepEqual(JSON.parse(sb.run('company-type.mjs', ['check-playbook', 'campaign']).out), resolved);
  assert.deepEqual(JSON.parse(sb.run('company-type.mjs', ['check-role', 'editor']).out), resolved);
  assert.equal(sb.run('company-type.mjs', ['roles']).out, `${m.roles.join('\n')}\n`);
  const list = JSON.parse(sb.run('company-type.mjs', ['list']).out);
  assert.deepEqual(list.map(e => e.id), TYPES);
  for (const e of list) assert.deepEqual(Object.keys(e), ['id', 'label', 'ship_meaning']);
  assert.equal(list[2].ship_meaning, m.ship.meaning);
  // Outside the type: the exact refusal and exit 2.
  const out = sb.run('company-type.mjs', ['check-playbook', 'feature']);
  assert.equal(out.code, 2);
  assert.equal(out.out.trim(), `refused: feature is not part of the marketing company; allowed: ${[...m.playbooks, ...ALWAYS].join(', ')}`);
  const role = sb.run('company-type.mjs', ['check-role', 'architect']);
  assert.equal(role.out.trim(), `refused: architect is not part of the marketing company; allowed: ${m.roles.join(', ')}`);
  // Names that are not slugs get the usage line.
  const usage = 'refused: usage: company-type.mjs resolve | check-playbook <name> | check-role <role> | roles | list | set <id>';
  for (const args of [['check-playbook', 'Feature'], ['check-playbook', '../x'], ['check-role', ''], ['check-playbook'], ['list', 'x'], ['nope']]) {
    const r = sb.run('company-type.mjs', args);
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.equal(r.out.trim(), usage, JSON.stringify(args));
  }
});

test('company-type: set writes one line before product_type, keeps every other byte, and refuses a second choice', () => {
  const original = '# Project profile\n\n<!-- note -->\n\nproduct_type: web\nengagement: own\né trailing \t\n\nlast line';
  const sb = sandbox({ projectMd: original });
  const r = sb.run('company-type.mjs', ['set', 'design']);
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), 'set design');
  assert.equal(fs.readFileSync(sb.profile, 'utf8'), original.replace('product_type:', 'company_type: design\nproduct_type:'));
  assert.deepEqual(fs.readdirSync(path.join(sb.repo, '.company')), ['project.md'], 'no temp file stays');
  const again = sb.run('company-type.mjs', ['set', 'research']);
  assert.equal(again.code, 2);
  assert.equal(again.out.trim(), 'refused: company_type already set; switching types is not supported');
  const none = sandbox();
  const missing = none.run('company-type.mjs', ['set', 'research']);
  assert.equal(missing.code, 2);
  assert.equal(missing.out.trim(), 'refused: no .company/project.md');
  const unknown = sandbox({ projectMd: 'product_type: web\n' }).run('company-type.mjs', ['set', 'bakery']);
  assert.equal(unknown.code, 2);
  assert.equal(unknown.out.trim(), 'refused: company_type is not valid; allowed: software, research, marketing, design');
  // Without a product_type line the line goes after the first comment line.
  const b = sandbox({ projectMd: '# P\n<!-- one -->\n<!-- two -->\nstack: x\n' });
  assert.equal(b.run('company-type.mjs', ['set', 'software']).code, 0);
  assert.equal(fs.readFileSync(b.profile, 'utf8'), '# P\n<!-- one -->\ncompany_type: software\n<!-- two -->\nstack: x\n');
});

test('company-type: the consumers named in the Contract do what it says', () => {
  const pipeline = read('skills/pipeline/SKILL.md');
  assert.match(pipeline, /\*\*Company type \(§1\.0\)\*\*, before every other Setup step/);
  assert.match(pipeline, /check-role <role>/);
  assert.match(pipeline, /the summary's first line is `Ship means: <ship\.meaning>`/);
  assert.match(pipeline, /each item in `ship\.checks` without its satisfying Handoff/);
  const help = read('skills/help/SKILL.md');
  assert.match(help, /list and explain only commands in `playbooks`/);
  const setup = read('skills/setup/SKILL.md');
  assert.match(setup, /company-type\.mjs" list/);
  assert.match(setup, /company-type\.mjs" set <id>/);
  assert.match(setup, /`Area: company-type`/);
  assert.match(read('skills/lead/references/project-template.md'), /^<!-- company_type: .*-->$/m);
  assert.match(typeDoc, /\| `claims-cited` \| an `editor` Handoff in the run, `status: done`, no `## Blocking`/);
  assert.match(typeDoc, /\| `handoff-package` \| a `ui-ux-designer` Handoff listing files, specs, tokens and the asset licence record/);
});
