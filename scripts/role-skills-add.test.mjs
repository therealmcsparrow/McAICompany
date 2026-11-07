import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from './role-skills.mjs';

const TODAY = '2026-11-07';
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const SCRIPT = path.join(import.meta.dirname, 'role-skills.mjs');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-skills-add-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function setup(t) {
  const cwd = tmp(t);
  const home = tmp(t);
  fs.mkdirSync(path.join(cwd, '.company'));
  return { cwd, home };
}

function run(p, args, payload) {
  const out = [];
  const stdin = payload === undefined ? '' : typeof payload === 'string' ? payload : `${JSON.stringify(payload)}\n`;
  const code = main(args, { cwd: p.cwd, home: p.home, today: TODAY, stdin, log: (s) => out.push(s) });
  return { code, out };
}

const userFile = (p) => path.join(p.home, '.mcsparrow', '3rdpartyskills.json');
const entries = (p) => (fs.existsSync(userFile(p)) ? JSON.parse(fs.readFileSync(userFile(p), 'utf8')).entries : []);
const settings = (p) => JSON.parse(fs.readFileSync(path.join(p.cwd, '.company', 'settings.json'), 'utf8'));

const FULL = { name: 'my-skill', repo: 'octo/thing', commit: A, category: 'engineering', license: 'MIT' };

test('help prints usage and takes no input', (t) => {
  const p = setup(t);
  const r = run(p, ['help']);
  assert.equal(r.code, 0);
  assert.ok(r.out.some((l) => l.includes('role-skills add')));
});

test('add and record refuse any value argument', (t) => {
  const p = setup(t);
  for (const cmd of ['add', 'record']) {
    const r = run(p, [cmd, 'name=x'], FULL);
    assert.equal(r.code, 1);
    assert.match(r.out[0], /one line of JSON on stdin/);
  }
  assert.deepEqual(entries(p), []);
});

test('a value argument with a command substitution never runs', (t) => {
  const dir = tmp(t);
  const marker = path.join(dir, 'ran');
  const r = spawnSync(process.execPath, [SCRIPT, 'add', `$(node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}','x')")`], { input: '', encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: dir } });
  assert.equal(r.status, 1);
  assert.equal(fs.existsSync(marker), false);
});

test('a second non-empty line and oversize input are refused before any check', (t) => {
  const p = setup(t);
  const two = run(p, ['add'], `${JSON.stringify(FULL)}\n${JSON.stringify(FULL)}\n`);
  assert.deepEqual(two, { code: 1, out: ['ERROR input has more than one line'] });
  const big = run(p, ['add'], `${JSON.stringify({ ...FULL, license: 'x'.repeat(70000) })}\n`);
  assert.deepEqual(big, { code: 1, out: ['ERROR input is too large'] });
  assert.equal(run(p, ['add'], '').out[0], 'ERROR input is empty');
  assert.equal(run(p, ['add'], 'not json\n').out[0], 'ERROR input is not valid JSON');
  assert.equal(run(p, ['add'], '[1]\n').out[0], 'ERROR input is not a JSON object');
  assert.deepEqual(entries(p), []);
});

test('a trailing blank line is allowed on stdin', (t) => {
  const p = setup(t);
  const r = run(p, ['add'], `${JSON.stringify({ name: 'ok-name' })}\n\n`);
  assert.equal(r.code, 0);
});

test('a command substitution in a value reaches validation as text and stays inert', (t) => {
  const p = setup(t);
  const dir = tmp(t);
  const marker = path.join(dir, 'ran').replace(/\\/g, '/');
  const bad = `$(touch ${marker})`;
  for (const [field, payload] of [
    ['name', { name: bad }],
    ['repo', { repo: bad }],
    ['command', { command: bad }],
    ['commit', { repo: 'octo/x', commit: bad }],
    ['category', { category: bad }],
    ['license', { license: `MIT${String.fromCharCode(10)}x` }]
  ]) {
    const r = run(p, ['add'], payload);
    assert.equal(r.code, 1, field);
    assert.match(r.out[0], new RegExp(`^ERROR ${field}: `));
    assert.ok(!r.out.join('\n').includes('touch'), field);
  }
  assert.equal(fs.existsSync(marker), false);
  assert.deepEqual(entries(p), []);
});

test('hostile values name the field and never echo the value', (t) => {
  const p = setup(t);
  const cases = [
    [{ name: 'Bad Name' }, 'name'],
    [{ name: 'a:b' }, 'name'],
    [{ name: 'wild*' }, 'name'],
    [{ name: '../x' }, 'name'],
    [{ repo: 'no-slash' }, 'repo'],
    [{ command: 'npx -y thing skills install' }, 'command'],
    [{ command: 'npx -y thing@1.0.0 && rm' }, 'command'],
    [{ commit: 'abc' }, 'commit'],
    [{ category: 'plugins' }, 'category'],
    [{ license: 'MIT‮' }, 'license'],
    [{ license: 'MIT​' }, 'license'],
    [{ license: 'MITㅤ' }, 'license'],
    [{ license: 'x'.repeat(65) }, 'license']
  ];
  for (const [payload, field] of cases) {
    const r = run(p, ['add'], payload);
    assert.equal(r.code, 1, JSON.stringify(payload));
    assert.match(r.out[0], new RegExp(`^ERROR ${field}: `));
    for (const v of Object.values(payload)) assert.ok(!r.out.join('\n').includes(v), field);
  }
  assert.equal(run(p, ['add'], { repo: 'octo/x', command: 'npx -y a@1.0.0 i' }).out[0], 'ERROR command: a skill has one source, a repo or a command');
  assert.equal(run(p, ['add'], { name: 'x1', unknown: 'y' }).out[0], 'ERROR input: unknown field');
  assert.equal(run(p, ['add'], { name: 7 }).out[0], 'ERROR name: bad value');
  assert.equal(run(p, ['add'], { save: 'yes' }).out[0], 'ERROR save: bad value');
  assert.deepEqual(entries(p), []);
});

test('a license with a space passes and one line break is refused', (t) => {
  const p = setup(t);
  assert.equal(run(p, ['add'], { license: 'MIT License' }).code, 0);
  assert.equal(run(p, ['add'], { license: 'MIT\nLicense' }).out[0], 'ERROR license: line break');
});

test('add previews with no write, then Save writes one entry with the license and no vetted', (t) => {
  const p = setup(t);
  const pre = run(p, ['add'], FULL);
  assert.equal(pre.code, 0);
  assert.ok(pre.out.includes('Name: my-skill'));
  assert.ok(pre.out.includes('License: MIT, as you stated it; nothing checks it.'));
  assert.ok(pre.out.some((l) => l.startsWith('Roles that can select it: architect')));
  assert.ok(pre.out.includes('The scan runs when you install it. It stays not vetted until an install scans it clean.'));
  assert.equal(fs.existsSync(userFile(p)), false);
  const saved = run(p, ['add'], { ...FULL, save: true });
  assert.deepEqual(saved, { code: 0, out: ['saved: my-skill'] });
  assert.deepEqual(entries(p), [{ skillname: 'my-skill', skillcategory: 'engineering', skillrepo: 'octo/thing', skillcommit: A, license: 'MIT' }]);
  const names = fs.readdirSync(path.dirname(userFile(p)));
  assert.deepEqual(names, ['3rdpartyskills.json']);
});

test('a command entry is stored as text and the preview says it is never run or scanned', (t) => {
  const p = setup(t);
  const payload = { name: 'cmd-skill', command: 'npx -y thing@1.2.3 skills install', category: 'design', license: 'ISC' };
  const pre = run(p, ['add'], payload);
  assert.ok(pre.out.includes('Command: npx -y thing@1.2.3 skills install (stored text, aico never runs it)'));
  assert.ok(pre.out.includes('A skill added as a command is never scanned and shows as not vetted.'));
  assert.equal(run(p, ['add'], { ...payload, save: true }).code, 0);
  assert.equal(entries(p)[0].skillinstaller, 'npx -y thing@1.2.3 skills install');
});

test('Save with a missing field writes nothing', (t) => {
  const p = setup(t);
  const r = run(p, ['add'], { name: 'x1', repo: 'octo/x', save: true });
  assert.equal(r.code, 1);
  assert.match(r.out[0], /^ERROR input: missing commit, category, license$/);
  assert.equal(fs.existsSync(userFile(p)), false);
});

test('a taken name is refused once the source decides it', (t) => {
  const p = setup(t);
  assert.equal(run(p, ['add'], { ...FULL, save: true }).code, 0);
  assert.equal(run(p, ['add'], { name: 'my-skill' }).code, 0);
  assert.equal(run(p, ['add'], { name: 'my-skill', repo: 'other/repo' }).out[0], 'ERROR name: taken');
  assert.equal(run(p, ['add'], { name: 'my-skill', command: 'npx -y x@1.0.0 i' }).out[0], 'ERROR name: taken');
  assert.equal(run(p, ['add'], FULL).out[0], 'ERROR name: taken');
  assert.equal(run(p, ['add'], { name: 'hallmark', repo: 'someone/else' }).out[0], 'ERROR name: taken');
  assert.equal(entries(p).length, 1);
});

test('a baseline name with the same repo and a commit is a pin, not a duplicate', (t) => {
  const p = setup(t);
  const pin = { name: 'hallmark', repo: 'nutlope/hallmark', commit: A, category: 'quality', license: 'MIT' };
  const pre = run(p, ['add'], pin);
  assert.ok(pre.out.includes('Category: design'), 'the preview shows the baseline category, not the typed one');
  assert.ok(!pre.out.includes('Category: quality'));
  const r = run(p, ['add'], { ...pin, save: true });
  assert.deepEqual(r, { code: 0, out: ['saved: hallmark'] });
  assert.equal(entries(p)[0].skillcommit, A);
});

test('another commit in your list needs the move, keeps the category and clears hash and vetted', (t) => {
  const p = setup(t);
  fs.mkdirSync(path.dirname(userFile(p)), { recursive: true });
  fs.writeFileSync(userFile(p), JSON.stringify({ schema: 1, entries: [{ skillname: 'my-skill', skillcategory: 'design', skillrepo: 'octo/thing', skillcommit: A, license: 'MIT', vetted: '2026-11-01', hash: 'f'.repeat(64) }] }));
  const pre = run(p, ['add'], { ...FULL, commit: B, license: 'Apache-2.0' });
  assert.equal(pre.code, 0);
  assert.ok(pre.out.includes(`pin: ${A.slice(0, 7)} -> ${B.slice(0, 7)}`));
  assert.ok(pre.out.includes('Category: design'));
  assert.ok(pre.out.some((l) => l.includes('clears its hash and vetted date')));
  const noMove = run(p, ['add'], { ...FULL, commit: B, license: 'Apache-2.0', save: true });
  assert.equal(noMove.code, 1);
  assert.equal(entries(p)[0].skillcommit, A);
  const moved = run(p, ['add'], { ...FULL, commit: B, license: 'Apache-2.0', save: true, move: true });
  assert.equal(moved.code, 0);
  assert.deepEqual(entries(p)[0], { skillname: 'my-skill', skillcategory: 'design', skillrepo: 'octo/thing', skillcommit: B, license: 'Apache-2.0' });
  assert.equal(run(p, ['add'], { ...FULL, commit: B, move: true }).out[0], 'ERROR name: taken');
  assert.equal(run(p, ['add'], { name: 'fresh1', repo: 'octo/z', commit: A, category: 'design', license: 'MIT', move: true }).out[0], 'ERROR move: no other commit in your list');
});

test('MCSPARROW_HOME set elsewhere stops before any check', (t) => {
  const p = setup(t);
  const old = process.env.MCSPARROW_HOME;
  process.env.MCSPARROW_HOME = tmp(t);
  t.after(() => { if (old === undefined) delete process.env.MCSPARROW_HOME; else process.env.MCSPARROW_HOME = old; });
  const out = [];
  const code = main(['add'], { cwd: p.cwd, stdin: `${JSON.stringify(FULL)}\n`, log: (s) => out.push(s) });
  assert.equal(code, 1);
  assert.deepEqual(out, ['role skills: MCSPARROW_HOME is set, the user catalog is not read']);
});

test('a broken user file stops add and is not replaced', (t) => {
  const p = setup(t);
  fs.mkdirSync(path.dirname(userFile(p)), { recursive: true });
  fs.writeFileSync(userFile(p), '{nope');
  const r = run(p, ['add'], { ...FULL, save: true });
  assert.equal(r.code, 1);
  assert.equal(fs.readFileSync(userFile(p), 'utf8'), '{nope');
});

// ---------- record ----------

const PICK = { skillname: 'pick-one', skillcategory: 'engineering', skillrepo: 'octo/pick', skillcommit: A };

test('record writes the entry with the stated license, no vetted, and the selections dated today', (t) => {
  const p = setup(t);
  const r = run(p, ['record'], { entry: PICK, license: 'MIT', roles: ['backend-engineer', 'frontend-engineer'] });
  assert.equal(r.code, 0, r.out.join('|'));
  assert.deepEqual(r.out, ['entry added: pick-one', 'recorded: pick-one, Roles backend-engineer, frontend-engineer']);
  assert.deepEqual(entries(p), [{ ...PICK, license: 'MIT' }]);
  const s = settings(p).aico_settings.roles;
  assert.deepEqual(s['backend-engineer'].skills, [{ name: 'pick-one', approved: TODAY }]);
  assert.deepEqual(s['frontend-engineer'].skills, [{ name: 'pick-one', approved: TODAY }]);
});

test('record with no license writes nothing for that pick', (t) => {
  const p = setup(t);
  for (const license of [undefined, '', '-', '   ']) {
    const payload = { entry: PICK, roles: ['backend-engineer'] };
    if (license !== undefined) payload.license = license;
    assert.deepEqual(run(p, ['record'], payload), { code: 0, out: ['no license stated: pick-one'] });
  }
  assert.equal(fs.existsSync(userFile(p)), false);
  assert.equal(fs.existsSync(path.join(p.cwd, '.company', 'settings.json')), false);
});

test('record of an equal entry writes no entry and sets approved to today even when unchanged', (t) => {
  const p = setup(t);
  assert.equal(run(p, ['record'], { entry: PICK, license: 'MIT', roles: ['backend-engineer'] }).code, 0);
  const before = fs.readFileSync(userFile(p), 'utf8');
  fs.writeFileSync(path.join(p.cwd, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1, roles: { 'backend-engineer': { skills: [{ name: 'pick-one', approved: '2026-01-01' }] } } } }));
  const r = run(p, ['record'], { entry: PICK, roles: ['backend-engineer'] });
  assert.deepEqual(r.out, ['recorded: pick-one, Roles backend-engineer']);
  assert.equal(fs.readFileSync(userFile(p), 'utf8'), before);
  assert.deepEqual(settings(p).aico_settings.roles['backend-engineer'].skills, [{ name: 'pick-one', approved: TODAY }]);
});

test('record of a baseline selection needs no license', (t) => {
  const p = setup(t);
  const base = { skillname: 'hallmark', skillcategory: 'design', skillrepo: 'nutlope/hallmark' };
  const r = run(p, ['record'], { entry: base, roles: ['ui-ux-designer'] });
  assert.equal(r.code, 0, r.out.join('|'));
  assert.deepEqual(r.out, ['recorded: hallmark, Roles ui-ux-designer']);
  assert.equal(fs.existsSync(userFile(p)), false);
});

test('record checks Roles against the category, protected Roles and the cap, and writes nothing on a stop', (t) => {
  const p = setup(t);
  for (const roles of [['qa'], ['architect'], ['not-a-role'], ['Bad Role']]) {
    const r = run(p, ['record'], { entry: PICK, license: 'MIT', roles });
    assert.equal(r.code, 1, roles.join());
    assert.match(r.out[0], /^ERROR roles: /);
  }
  const five = ['a1', 'a2', 'a3', 'a4', 'a5'].map((n) => ({ name: n, approved: '2026-01-01' }));
  fs.writeFileSync(path.join(p.cwd, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1, roles: { 'backend-engineer': { skills: five } } } }));
  const full = run(p, ['record'], { entry: PICK, license: 'MIT', roles: ['backend-engineer'] });
  assert.deepEqual(full, { code: 1, out: ['ERROR roles: a Role already has 5'] });
  assert.equal(fs.existsSync(userFile(p)), false);
});

test('record refuses a hostile entry, a license inside the entry, unknown keys and a value argument', (t) => {
  const p = setup(t);
  const cases = [
    [{ entry: { ...PICK, license: 'MIT' }, roles: [] }, 'ERROR entry: license not allowed'],
    [{ entry: { ...PICK, vetted: '2026-01-01' }, roles: [] }, 'ERROR entry: vetted not allowed'],
    [{ entry: { ...PICK, hash: 'f'.repeat(64) }, roles: [] }, 'ERROR entry: hash not allowed'],
    [{ entry: { ...PICK, skillname: '$(x)' }, roles: [] }, 'ERROR entry: skillname bad value'],
    [{ entry: PICK, roles: [], extra: 1 }, 'ERROR input: unknown field'],
    [{ entry: PICK }, 'ERROR roles: bad value'],
    [{ entry: PICK, license: 'MIT‮', roles: [] }, 'ERROR license: bad value'],
    [{ entry: 'x', roles: [] }, 'ERROR entry: bad value'],
    [{ entry: { skillname: 'cmd-x', skillcategory: 'engineering', skillinstaller: 'npx -y x@1.0.0 i' }, license: 'MIT', roles: [] }, 'ERROR entry: a command is in no list']
  ];
  for (const [payload, line] of cases) assert.deepEqual(run(p, ['record'], payload), { code: 1, out: [line] }, line);
  assert.equal(fs.existsSync(userFile(p)), false);
});

test('record follows the one-commit rule for a name already in your list', (t) => {
  const p = setup(t);
  assert.equal(run(p, ['record'], { entry: PICK, license: 'MIT', roles: [] }).code, 0);
  const other = run(p, ['record'], { entry: { ...PICK, skillcommit: B }, license: 'MIT', roles: ['backend-engineer'] });
  assert.equal(other.code, 1);
  assert.match(other.out[0], /another commit/);
  assert.equal(entries(p)[0].skillcommit, A);
  assert.equal(fs.existsSync(path.join(p.cwd, '.company', 'settings.json')), false);
});

test('a license is checked as typed: an invisible character at either edge is refused, plain spaces are trimmed', (t) => {
  const p = setup(t);
  const edges = ['MIT\n', '\uFEFFMIT', 'MIT\u2028', 'MIT\u2029', '\tMIT', 'MIT\u200B', '\u3164MIT', 'MIT\u202E'];
  for (const license of edges) {
    const viaAdd = run(p, ['add'], { ...FULL, license, save: true });
    assert.equal(viaAdd.code, 1, JSON.stringify(license));
    assert.match(viaAdd.out[0], /^ERROR license: /, JSON.stringify(license));
    const viaRecord = run(p, ['record'], { entry: { skillname: 'rec-skill', skillcategory: 'engineering', skillrepo: 'octo/rec', skillcommit: A }, license, roles: [] });
    assert.equal(viaRecord.code, 1, JSON.stringify(license));
    assert.match(viaRecord.out[0], /^ERROR license: /, JSON.stringify(license));
  }
  assert.deepEqual(entries(p), []);
  assert.equal(run(p, ['add'], { ...FULL, license: '  MIT\u00A0', save: true }).code, 0);
  assert.equal(entries(p)[0].license, 'MIT');
  const rec = run(p, ['record'], { entry: { skillname: 'rec-skill', skillcategory: 'engineering', skillrepo: 'octo/rec', skillcommit: B }, license: ' ISC ', roles: [] });
  assert.equal(rec.code, 0);
  assert.equal(entries(p).find((e) => e.skillname === 'rec-skill').license, 'ISC');
});
