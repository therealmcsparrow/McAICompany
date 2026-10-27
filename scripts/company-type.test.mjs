import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ALWAYS, CEO_ONLY, loadRegistry, run } from './company-type.mjs';

const REAL_ROOT = path.join(import.meta.dirname, '..');
const SCRIPT = path.join(import.meta.dirname, 'company-type.mjs');
const ALLOWED = 'software, research, marketing, design';
const bad = n => `refused: company_type on line ${n} of .company/project.md is not valid; allowed: ${ALLOWED}`;
const lookalike = n => `refused: line ${n} of .company/project.md looks like a company_type line but is not "company_type: <id>" at the start of the line; allowed: ${ALLOWED}`;
const cannot = why => `refused: cannot read .company/project.md (${why}), so the company type is unknown; fix the file and run again`;
const USAGE_TEXT = 'usage: company-type.mjs resolve | check-playbook <name> | check-role <role> | roles | pick [--max <n>] <role>... | list | set <id> [--json]';
const USAGE = `refused: ${USAGE_TEXT}`;
const NAME_RULE = 'use a-z, 0-9 and -, start with a letter, at most 32 characters';

const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'company-type-'));
  temps.push(d);
  return d;
}

const PLAYBOOK_FM = '---\nname: x\ndescription: Use when testing.\nargument-hint: (no arguments)\n---\nBody.\n';
const SKILL_FM = '---\nname: x\ndescription: Use when testing.\n---\nBody.\n';

function manifest(over = {}) {
  return {
    v: 1,
    id: 'software',
    label: 'Software company',
    roles: ['skill-researcher', 'qa'],
    playbooks: ['fix', 'audit'],
    ship: { kind: 'release', meaning: 'Push, merge, release or deploy.', lanes: [], checks: [] },
    work: ['fix'],
    skill_search: { hints: [] },
    ...over
  };
}

// A small plugin root: agents qa and skill-researcher, Playbooks fix, audit and report, a plain skill tdd.
function pluginRoot(types = { software: manifest() }) {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'agents'));
  for (const a of ['qa', 'skill-researcher', 'editor']) fs.writeFileSync(path.join(root, 'agents', `${a}.md`), '---\nname: a\n---\n');
  for (const [name, text] of Object.entries({ fix: PLAYBOOK_FM, audit: PLAYBOOK_FM, report: PLAYBOOK_FM, tdd: SKILL_FM })) {
    fs.mkdirSync(path.join(root, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', name, 'SKILL.md'), text);
  }
  fs.mkdirSync(path.join(root, 'company', 'types'), { recursive: true });
  for (const [id, m] of Object.entries(types)) {
    fs.writeFileSync(path.join(root, 'company', 'types', `${id}.json`), typeof m === 'string' ? m : JSON.stringify(m));
  }
  return root;
}

function project(text) {
  const cwd = tmp();
  if (text !== null) {
    fs.mkdirSync(path.join(cwd, '.company'));
    fs.writeFileSync(path.join(cwd, '.company', 'project.md'), text, 'latin1');
  }
  return cwd;
}
const projectFile = cwd => path.join(cwd, '.company', 'project.md');
const readProject = cwd => fs.readFileSync(projectFile(cwd), 'latin1');

function exec(args, cwd, root = REAL_ROOT) {
  return run(args, { cwd, pluginRoot: root });
}
const json = (args, cwd, root) => exec([...args, '--json'], cwd, root);

// Hostile inputs first.

test('hostile company_type values are refused and nothing is echoed', () => {
  const hostile = [
    '../../etc/passwd', '..\\..\\x', '/etc/passwd', 'C:\\Windows', 'software/../research', 'research.json', 'Research', 'RESEARCH',
    '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', ' ', 'a'.repeat(33), 'a'.repeat(5000), 'soft ware',
    'software;rm -rf', 'software\u0000', 'software\u202e', '$(id)', '`id`', '<script>', 'unknown', 'software,research', '-software', '1software'
  ];
  for (const value of hostile) {
    const cwd = project(`# Project profile\n\ncompany_type: ${value}\nproduct_type: web\n`);
    const before = readProject(cwd);
    for (const args of [['resolve'], ['roles'], ['check-playbook', 'fix'], ['check-role', 'qa'], ['pick', 'qa'], ['resolve', '--json']]) {
      const r = exec(args, cwd);
      assert.equal(r.code, 2, `${JSON.stringify(value)} ${args[0]}`);
      assert.equal(r.out, bad(3));
      if (value.trim().length > 3) assert.ok(!r.out.includes(value), 'the project value is not echoed');
    }
    assert.equal(readProject(cwd), before);
  }
});

test('a duplicate company_type line is refused with the line numbers, even when both are valid', () => {
  const cases = [
    ['company_type: software\ncompany_type: software\n', 'lines 1, 2'],
    ['company_type: software\nproduct_type: web\ncompany_type: research\n', 'lines 1, 3'],
    ['a\ncompany_type: software\n\ncompany_type: x\ncompany_type: y\n', 'lines 2, 4, 5']
  ];
  for (const [text, lines] of cases) {
    const cwd = project(text);
    const k = text.split('\n').filter(l => l.startsWith('company_type:')).length;
    const r = exec(['resolve'], cwd);
    assert.deepEqual(r, { code: 2, out: `refused: .company/project.md has ${k} company_type lines (${lines}); keep one; allowed: ${ALLOWED}` });
    assert.equal(exec(['set', 'software'], cwd).code, 2);
    assert.equal(readProject(cwd), text);
  }
});

test('company_type inside an HTML comment or with another prefix is not a line', () => {
  const text = '<!-- company_type: bogus -->\n<!--\ncompany_type: bogus\n-->\nxcompany_type: bogus\nmy_company_type: bogus\ncompany_types: bogus\nproduct_type: web\n';
  const r = json(['resolve'], project(text));
  assert.equal(r.code, 0);
  const out = JSON.parse(r.out);
  assert.equal(out.id, 'software');
  assert.equal(out.source, 'default');
});

test('look-alike company_type lines are refused, never ignored', () => {
  const cases = [
    '  company_type: research', '\tcompany_type: research', 'Company_Type: research', 'COMPANY_TYPE: research', 'company_type : research',
    'company_type\t: research', 'company_type :research', '\u00ef\u00bb\u00bfcompany_type: research', ' \u00ef\u00bb\u00bfcompany_type: research', 'company_type :'
  ];
  for (const line of cases) {
    const text = `# P\n${line}\nproduct_type: web\n`;
    const cwd = project(text);
    for (const args of [['resolve'], ['check-role', 'qa'], ['roles']]) assert.deepEqual(exec(args, cwd), { code: 2, out: lookalike(2) }, JSON.stringify(line));
    assert.deepEqual(exec(['set', 'software'], cwd), { code: 2, out: 'refused: company_type already set; switching types is not supported' });
    assert.equal(readProject(cwd), text);
  }
  // a look-alike on the first line, and one next to a good line
  assert.deepEqual(exec(['resolve'], project('  company_type: software\n')), { code: 2, out: lookalike(1) });
  assert.deepEqual(exec(['resolve'], project('company_type: software\nCompany_type: software\n')), { code: 2, out: lookalike(2) });
  // inside a comment it is not a line
  assert.equal(json(['resolve'], project('<!--\n  company_type: x\n-->\n')).code, 0);
});

test('an unterminated comment hides the rest of the file like the markdown reader does', () => {
  const r = json(['resolve'], project('<!-- never closed\ncompany_type: bogus\n'));
  assert.equal(JSON.parse(r.out).source, 'default');
});

test('a CR before the line end is tolerated, other control bytes are not', () => {
  assert.equal(JSON.parse(json(['resolve'], project('company_type: software\r\nproduct_type: web\r\n')).out).source, 'project');
  assert.deepEqual(exec(['resolve'], project('company_type: soft\u000bware\n')), { code: 2, out: bad(1) });
  assert.deepEqual(exec(['resolve'], project('company_type: software\r\r\n')), { code: 2, out: bad(1) });
});

test('spaces and tabs around the value are trimmed', () => {
  assert.equal(JSON.parse(json(['resolve'], project('company_type: \t software \t \n')).out).source, 'project');
});

test('an oversize or non-regular project.md gets the cannot-read refusal, not the invalid-value one', () => {
  const big = project(`company_type: software\n${'x'.repeat(300 * 1024)}\n`);
  assert.deepEqual(exec(['resolve'], big), { code: 2, out: cannot('larger than 256 KiB') });
  const edge = project(`company_type: software\n${'x'.repeat(256 * 1024 - 23)}`);
  assert.equal(readProject(edge).length, 256 * 1024);
  assert.equal(exec(['resolve'], edge).code, 0, 'exactly 256 KiB is read');
  const over = project(`company_type: software\n${'x'.repeat(256 * 1024 - 22)}`);
  assert.deepEqual(exec(['resolve'], over), { code: 2, out: cannot('larger than 256 KiB') });
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, '.company', 'project.md'), { recursive: true });
  assert.deepEqual(exec(['resolve'], cwd), { code: 2, out: cannot('not a regular file') });
  assert.equal(exec(['set', 'software'], cwd).code, 2);
  const file = tmp();
  fs.writeFileSync(path.join(file, '.company'), 'x');
  assert.deepEqual(exec(['resolve'], file), { code: 2, out: 'refused: .company is not a folder, so the company type is unknown' });
});

test('an unreadable project.md gets the cannot-read refusal', t => {
  const cwd = project('company_type: software\n');
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    t.skip('file modes are not enforced here');
    return;
  }
  fs.chmodSync(projectFile(cwd), 0);
  assert.deepEqual(exec(['resolve'], cwd), { code: 2, out: cannot('no permission') });
});

test('a symlinked project.md and a symlinked .company are read; set never writes through a link', t => {
  const root = pluginRoot({ software: manifest(), research: manifest({ id: 'research' }) });
  const cwd = tmp();
  const target = path.join(cwd, 'real.md');
  fs.writeFileSync(target, 'company_type: research\n');
  fs.mkdirSync(path.join(cwd, '.company'));
  try {
    fs.symlinkSync(target, projectFile(cwd));
  } catch {
    t.skip('symlinks are not available');
    return;
  }
  assert.equal(JSON.parse(json(['resolve'], cwd, root).out).id, 'research');
  const linkRefusal = { code: 2, out: 'refused: .company/project.md is a link; set writes only a regular file in a real .company folder' };
  assert.deepEqual(exec(['set', 'software'], cwd, root), linkRefusal);
  assert.equal(fs.readFileSync(target, 'utf8'), 'company_type: research\n');
});

test('a linked .company folder is read, and set never writes through it', t => {
  const root = pluginRoot({ software: manifest(), research: manifest({ id: 'research' }) });
  const other = tmp();
  fs.mkdirSync(path.join(other, 'store'));
  const stored = path.join(other, 'store', 'project.md');
  fs.writeFileSync(stored, 'product_type: web\n');
  try {
    fs.symlinkSync(path.join(other, 'store'), path.join(other, '.company'), 'junction');
  } catch {
    t.skip('directory links are not available');
    return;
  }
  assert.equal(JSON.parse(json(['resolve'], other, root).out).source, 'default');
  fs.writeFileSync(stored, 'company_type: research\n');
  assert.equal(JSON.parse(json(['resolve'], other, root).out).id, 'research');
  fs.writeFileSync(stored, 'product_type: web\n');
  assert.deepEqual(exec(['set', 'software'], other, root), { code: 2, out: 'refused: .company/project.md is a link; set writes only a regular file in a real .company folder' });
  assert.equal(fs.readFileSync(stored, 'utf8'), 'product_type: web\n');
});

test('a link that leads nowhere is no file, and set refuses it', t => {
  const dangling = tmp();
  fs.mkdirSync(path.join(dangling, '.company'));
  try {
    fs.symlinkSync(path.join(dangling, 'gone.md'), projectFile(dangling));
  } catch {
    t.skip('symlinks are not available');
    return;
  }
  assert.equal(JSON.parse(json(['resolve'], dangling).out).source, 'default');
  assert.equal(exec(['set', 'software'], dangling).code, 2);
});

test('a .company link that leads nowhere means the default type', t => {
  const cwd = tmp();
  try {
    fs.symlinkSync(path.join(cwd, 'gone'), path.join(cwd, '.company'), 'junction');
  } catch {
    t.skip('directory links are not available');
    return;
  }
  assert.equal(JSON.parse(json(['resolve'], cwd).out).source, 'default');
});

test('hostile names for check-playbook and check-role are refused and named safely', () => {
  const hostile = ['../fix', 'fix/..', 'FIX', '__proto__x_', '', 'a'.repeat(33), 'fix\u0000', 'fix extra', '-fix', '..', 'C:\\x', 'say"hi"', 'tick`x', 'a'.repeat(41), '\u202efix', '$(id)'];
  for (const [cmd, kind] of [['check-playbook', 'Playbook'], ['check-role', 'Role']]) {
    for (const name of hostile) {
      const r = exec([cmd, name], project(null));
      const safe = /^[\x21-\x7E]{1,40}$/.test(name) && !/["`]/.test(name);
      const shownName = safe ? `"${name}"` : `(${[...name].length} characters, not shown)`;
      assert.deepEqual(r, { code: 2, out: `refused: ${kind} name ${shownName} is not valid: ${NAME_RULE}` }, `${cmd} ${JSON.stringify(name)}`);
      if (!safe) assert.ok(!r.out.includes(name) || name === '', 'an unsafe argument is not printed');
    }
  }
});

test('wrong argument counts, unknown commands and doubled flags are refused', () => {
  const none = project(null);
  assert.deepEqual(exec(['check-playbook'], none), { code: 2, out: `refused: check-playbook needs one Playbook name; ${USAGE_TEXT}` });
  assert.deepEqual(exec(['check-playbook', 'fix', 'x'], none), { code: 2, out: `refused: check-playbook needs one Playbook name; ${USAGE_TEXT}` });
  assert.deepEqual(exec(['check-role'], none), { code: 2, out: `refused: check-role needs one Role name; ${USAGE_TEXT}` });
  assert.deepEqual(exec(['resolve', 'x'], none), { code: 2, out: `refused: resolve needs no arguments; ${USAGE_TEXT}` });
  assert.deepEqual(exec(['roles', 'x'], none), { code: 2, out: `refused: roles needs no arguments; ${USAGE_TEXT}` });
  assert.deepEqual(exec(['list', 'x'], none), { code: 2, out: `refused: list needs no arguments; ${USAGE_TEXT}` });
  assert.deepEqual(exec(['set'], none), { code: 2, out: `refused: set needs one company type; ${USAGE_TEXT}` });
  assert.deepEqual(exec(['pick'], none), { code: 2, out: `refused: pick needs 1 to 8 Role names; ${USAGE_TEXT}` });
  assert.deepEqual(exec(['pick', ...'abcdefghi'.split('').map(c => `r-${c}`)], none), { code: 2, out: `refused: pick needs 1 to 8 Role names; ${USAGE_TEXT}` });
  assert.deepEqual(exec([], none), { code: 2, out: `refused: no command; ${USAGE_TEXT}` });
  assert.deepEqual(exec(['nope'], none), { code: 2, out: `refused: unknown command "nope"; ${USAGE_TEXT}` });
  assert.deepEqual(exec(['toString'], none), { code: 2, out: `refused: unknown command "toString"; ${USAGE_TEXT}` });
  assert.deepEqual(exec(['__proto__'], none), { code: 2, out: `refused: unknown command "__proto__"; ${USAGE_TEXT}` });
  assert.deepEqual(exec(['--json'], none), { code: 2, out: `refused: unknown command "--json"; ${USAGE_TEXT}` });
  assert.deepEqual(exec(['x\u0000y'], none), { code: 2, out: `refused: unknown command (3 characters, not shown); ${USAGE_TEXT}` });
  assert.deepEqual(exec(['resolve', '--json', '--json'], none), { code: 2, out: 'refused: "--json" is given twice' });
  assert.deepEqual(exec(['--json', 'resolve'], none).code, 2);
});

test('set with a hostile id writes nothing and names it safely', () => {
  const text = '# P\n\nproduct_type: web\n';
  for (const id of ['../x', '__proto__', 'Software', 'software\n', 'unknown', 'a'.repeat(100), 'software\nproduct_type: x', '', 'say"hi"']) {
    const cwd = project(text);
    const safe = /^[\x21-\x7E]{1,40}$/.test(id) && !/["`]/.test(id);
    const shownId = safe ? `"${id}"` : `(${[...id].length} characters, not shown)`;
    assert.deepEqual(exec(['set', id], cwd), { code: 2, out: `refused: ${shownId} is not a company type; allowed: ${ALLOWED}` });
    assert.equal(readProject(cwd), text);
  }
});

test('pick returns the first n candidates that are in the type, in the given order', () => {
  const cwd = project(null);
  const root = pluginRoot();
  assert.deepEqual(exec(['pick', 'ghost', 'qa', 'skill-researcher'], cwd, root), { code: 0, out: 'qa' });
  assert.deepEqual(exec(['pick', '--max', '2', 'ghost', 'skill-researcher', 'qa'], cwd, root), { code: 0, out: 'skill-researcher\nqa' });
  assert.deepEqual(exec(['pick', 'qa', 'skill-researcher', '--max', '1'], cwd, root), { code: 0, out: 'qa' });
  assert.deepEqual(exec(['pick', '--max', '4', 'qa', '--json'], cwd, root), { code: 0, out: '["qa"]' });
  assert.deepEqual(exec(['pick', 'qa', 'skill-researcher', '--json', '--max', '2'], cwd, root), { code: 0, out: '["qa","skill-researcher"]' });
  assert.deepEqual(exec(['pick', 'ghost', 'phantom'], cwd, root), { code: 2, out: 'refused: none of ghost, phantom is part of the software company; allowed: skill-researcher, qa' });
  const real = exec(['pick', '--max', '2', 'architect', 'product-manager'], cwd);
  assert.deepEqual(real, { code: 0, out: 'architect\nproduct-manager' });
});

test('pick refuses a bad --max, bad or repeated candidates, and too many or too few', () => {
  const cwd = project(null);
  const root = pluginRoot();
  for (const max of ['0', '5', '-1', '1.5', 'x', '01', '', '2 ', '1e0', '٢', '__proto__']) {
    assert.deepEqual(exec(['pick', '--max', max, 'qa'], cwd, root), { code: 2, out: 'refused: --max must be a whole number from 1 to 4' }, JSON.stringify(max));
  }
  assert.deepEqual(exec(['pick', 'qa', '--max'], cwd, root), { code: 2, out: 'refused: --max must be a whole number from 1 to 4' });
  assert.deepEqual(exec(['pick', '--max', '1', '--max', '2', 'qa'], cwd, root), { code: 2, out: 'refused: "--max" is given twice' });
  assert.deepEqual(exec(['pick', 'qa', 'qa'], cwd, root), { code: 2, out: 'refused: "qa" is given twice' });
  assert.deepEqual(exec(['pick', 'qa', '../x'], cwd, root), { code: 2, out: `refused: Role name "../x" is not valid: ${NAME_RULE}` });
  assert.deepEqual(exec(['pick', 'QA'], cwd, root), { code: 2, out: `refused: Role name "QA" is not valid: ${NAME_RULE}` });
  assert.deepEqual(exec(['pick', '--max=2', 'qa'], cwd, root), { code: 2, out: `refused: Role name "--max=2" is not valid: ${NAME_RULE}` });
  assert.deepEqual(exec(['pick', 'a\u202eb'], cwd, root), { code: 2, out: `refused: Role name (3 characters, not shown) is not valid: ${NAME_RULE}` });
  assert.deepEqual(exec(['pick', '--max', '2'], cwd, root), { code: 2, out: `refused: pick needs 1 to 8 Role names; ${USAGE_TEXT}` });
  const eight = Array.from({ length: 8 }, (_, i) => `r-${i}`);
  assert.deepEqual(exec(['pick', ...eight], cwd, root).code, 2);
  assert.match(exec(['pick', ...eight], cwd, root).out, /^refused: none of r-0, /, 'eight is allowed');
});

test('a registry id is never used as a path: a link or odd name in company/types is refused', t => {
  const root = pluginRoot();
  fs.writeFileSync(path.join(root, 'company', 'types', 'notes.txt'), 'x');
  assert.deepEqual(exec(['resolve'], project(null), root), { code: 3, out: 'refused: type manifest ? invalid: file name' });
  fs.rmSync(path.join(root, 'company', 'types', 'notes.txt'));
  fs.mkdirSync(path.join(root, 'company', 'types', 'research.json'));
  assert.deepEqual(exec(['resolve'], project(null), root), { code: 3, out: 'refused: type manifest research invalid: not a regular file' });
  fs.rmdirSync(path.join(root, 'company', 'types', 'research.json'));
  const target = path.join(root, 'elsewhere.json');
  fs.writeFileSync(target, JSON.stringify(manifest({ id: 'research' })));
  try {
    fs.symlinkSync(target, path.join(root, 'company', 'types', 'research.json'));
  } catch {
    t.skip('symlinks are not available');
    return;
  }
  assert.deepEqual(exec(['resolve'], project(null), root), { code: 3, out: 'refused: type manifest research invalid: not a regular file' });
});

test('manifest rules refuse with exit 3 and name the rule', () => {
  const cases = [
    ['{not json', 'not JSON'],
    ['[]', 'not an object'],
    ['null', 'not an object'],
    [manifest({ v: 2 }), 'v must be 1'],
    [manifest({ id: 'other' }), 'id must equal the file name'],
    [manifest({ extra: 1 }), 'unknown key'],
    [manifest({ ship: { ...manifest().ship, extra: 1 } }), 'unknown key'],
    [manifest({ skill_search: { hints: [], extra: 1 } }), 'unknown key'],
    [manifest({ label: '' }), 'label'],
    [manifest({ label: 'a'.repeat(41) }), 'label'],
    [manifest({ label: 'bad<label>' }), 'label'],
    [manifest({ label: 'two\nlines' }), 'label'],
    [manifest({ roles: [] }), 'roles'],
    [manifest({ roles: ['skill-researcher', 'skill-researcher'] }), 'roles'],
    [manifest({ roles: ['skill-researcher', 'ghost'] }), 'roles'],
    [manifest({ roles: ['skill-researcher', '../agents/qa'] }), 'roles'],
    [manifest({ roles: ['qa'] }), 'roles must include skill-researcher'],
    [manifest({ roles: 'qa' }), 'roles'],
    [manifest({ playbooks: [] }), 'playbooks'],
    [manifest({ playbooks: ['fix', 'fix'] }), 'playbooks'],
    [manifest({ playbooks: ['ghost'] }), 'playbooks'],
    [manifest({ playbooks: ['tdd'] }), 'playbooks'],
    [manifest({ playbooks: ['help'] }), 'playbooks'],
    [manifest({ playbooks: ['version'] }), 'playbooks'],
    [manifest({ playbooks: ['../fix'] }), 'playbooks'],
    [manifest({ ship: { ...manifest().ship, kind: 'ship-it' } }), 'ship.kind'],
    [manifest({ ship: { ...manifest().ship, meaning: '' } }), 'ship.meaning'],
    [manifest({ ship: { ...manifest().ship, meaning: 'a'.repeat(241) } }), 'ship.meaning'],
    [manifest({ ship: { ...manifest().ship, meaning: 'has `tick`' } }), 'ship.meaning'],
    [manifest({ ship: { ...manifest().ship, meaning: 'has <tag>' } }), 'ship.meaning'],
    [manifest({ ship: { ...manifest().ship, meaning: 'two\nlines' } }), 'ship.meaning'],
    [manifest({ ship: { ...manifest().ship, lanes: ['nope'] } }), 'ship.lanes'],
    [manifest({ ship: { ...manifest().ship, lanes: ['legal', 'legal'] } }), 'ship.lanes'],
    [manifest({ ship: { ...manifest().ship, lanes: ['security', 'compliance', 'legal', 'persona', 'hands_on', 'accessibility', 'legal'] } }), 'ship.lanes'],
    [manifest({ ship: { ...manifest().ship, checks: ['nope'] } }), 'ship.checks'],
    [manifest({ ship: { ...manifest().ship, checks: ['claims-cited', 'ai-disclosure', 'asset-licences', 'handoff-package', 'claims-cited'] } }), 'ship.checks'],
    [manifest({ skill_search: { hints: ['Upper Case'] } }), 'skill_search.hints'],
    [manifest({ skill_search: { hints: ['a', 'b', 'c', 'd', 'e', 'f'] } }), 'skill_search.hints'],
    [manifest({ skill_search: { hints: ['a', 'a'] } }), 'skill_search.hints'],
    [manifest({ skill_search: { hints: ['x'.repeat(61)] } }), 'skill_search.hints'],
    [manifest({ work: [] }), 'work'],
    [manifest({ work: ['audit', 'audit'] }), 'work'],
    [manifest({ work: ['report'] }), 'work'],
    [manifest({ work: 'fix' }), 'work'],
    [manifest({ work: ['fix', 'audit', 'fix', 'audit'] }), 'work'],
    [manifest({ work: [1] }), 'work'],
    [{ ...manifest(), work: undefined }, 'work missing'],
    ['{"v":1,"id":"software","__proto__":{"x":1}}', 'unknown key'],
    [' '.repeat(65 * 1024) + '{}', 'too large']
  ];
  for (const [m, rule] of cases) {
    const r = exec(['resolve'], project(null), pluginRoot({ software: m }));
    assert.deepEqual(r, { code: 3, out: `refused: type manifest software invalid: ${rule}` }, rule);
  }
});

test('a registry without software is refused', () => {
  const root = pluginRoot({ research: manifest({ id: 'research' }) });
  assert.deepEqual(exec(['resolve'], project(null), root), { code: 3, out: 'refused: type manifest software invalid: missing' });
  const empty = pluginRoot({});
  assert.deepEqual(exec(['list'], project(null), empty), { code: 3, out: 'refused: type manifest software invalid: missing' });
});

test('a missing company/types folder is refused', () => {
  const root = pluginRoot();
  fs.rmSync(path.join(root, 'company', 'types'), { recursive: true });
  assert.deepEqual(exec(['resolve'], project(null), root), { code: 3, out: 'refused: type manifest software invalid: missing' });
});

test('registry lookup never touches the file system with the project value', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(source.includes('readdirSync'));
  assert.ok(source.includes('Object.hasOwn'));
  assert.doesNotMatch(source, /path\.join\([^)]*\b(id|value|name|type)\b[^)]*\.json/);
});

// Behaviour.

test('software is the v0.12.0 company: 33 Roles, 16 Playbooks, 24 commands with ALWAYS', () => {
  const r = json(['resolve'], project(null));
  assert.equal(r.code, 0);
  const out = JSON.parse(r.out);
  assert.equal(out.v, 1);
  assert.equal(out.id, 'software');
  assert.equal(out.source, 'default');
  assert.equal(out.label, 'Software company');
  assert.equal(out.roles.length, 33);
  assert.ok(!out.roles.includes('editor'));
  const agents = fs.readdirSync(path.join(REAL_ROOT, 'agents')).map(f => f.slice(0, -3));
  assert.deepEqual([...out.roles].sort(), agents.filter(a => a !== 'editor').sort());
  assert.equal(ALWAYS.length, 8);
  assert.equal(out.playbooks.length, 24);
  assert.deepEqual(out.playbooks.slice(16), ALWAYS);
  assert.deepEqual(out.playbooks.slice(0, 16), ['audit', 'brainstorm', 'client', 'cooler', 'feature', 'feedback', 'fix', 'incident', 'launch', 'maintain', 'pentest', 'refactor', 'research', 'standards', 'usability-test', 'vulnscan']);
  assert.deepEqual(out.ship, { kind: 'release', meaning: 'Push, merge, release or deploy.', lanes: [], checks: [] });
  assert.deepEqual(out.skill_search, { hints: [] });
  assert.deepEqual(out.work, ['feature', 'fix']);
  assert.deepEqual(Object.keys(out), ['v', 'id', 'source', 'label', 'roles', 'playbooks', 'work', 'ship', 'skill_search']);
});

test('every shipped type names its work Playbooks', () => {
  const want = { software: ['feature', 'fix'], research: ['report'], marketing: ['content', 'campaign'], design: ['design'] };
  const reg = loadRegistry(REAL_ROOT);
  for (const [id, work] of Object.entries(want)) assert.deepEqual(reg[id].work, work, id);
});

test("all manifests' playbooks plus ALWAYS are exactly the Playbooks (skills with an argument-hint) of the plugin", () => {
  const union = new Set([...ALWAYS, ...Object.values(loadRegistry(REAL_ROOT)).flatMap(m => m.playbooks)]);
  const hidden = fs.readdirSync(path.join(REAL_ROOT, 'skills')).filter(d => /^argument-hint:[ \t]*\S/m.test(fs.readFileSync(path.join(REAL_ROOT, 'skills', d, 'SKILL.md'), 'utf8')));
  assert.deepEqual([...union].sort(), hidden.sort());
});

test('an explicit company_type: software line resolves from the project', () => {
  const out = JSON.parse(json(['resolve'], project('# P\n\ncompany_type: software\nproduct_type: web\n')).out);
  assert.equal(out.id, 'software');
  assert.equal(out.source, 'project');
});

test('a missing .company/project.md means software by default', () => {
  assert.equal(JSON.parse(json(['resolve'], project(null)).out).source, 'default');
});

test('check-playbook and check-role pass inside the type and refuse outside', () => {
  const cwd = project(null);
  const ok = json(['check-playbook', 'fix'], cwd);
  assert.equal(ok.code, 0);
  assert.equal(JSON.parse(ok.out).id, 'software');
  assert.equal(exec(['check-playbook', 'help'], cwd).code, 0);
  assert.equal(exec(['check-role', 'qa'], cwd).code, 0);
  const root = pluginRoot();
  const no = exec(['check-playbook', 'report'], cwd, root);
  assert.deepEqual(no, { code: 2, out: 'refused: report is not part of the software company; allowed: fix, audit, help, version, language, settings, setup, lead, triage, skillspector' });
  assert.deepEqual(exec(['check-role', 'editor'], cwd, root), { code: 2, out: 'refused: editor is not part of the software company; allowed: skill-researcher, qa' });
});

test('roles prints one slug per line, and a JSON array with --json', () => {
  assert.deepEqual(exec(['roles'], project(null), pluginRoot()), { code: 0, out: 'skill-researcher\nqa' });
  assert.deepEqual(json(['roles'], project(null), pluginRoot()), { code: 0, out: '["skill-researcher","qa"]' });
});

test('the default output is the type lines, and the check commands put an ok line first', () => {
  const ship = { kind: 'release', meaning: 'Push, merge, release or deploy.', lanes: ['legal', 'security'], checks: [] };
  const root = pluginRoot({ software: manifest({ ship, skill_search: { hints: ['alpha beta', 'gamma'] } }), research: manifest({ id: 'research', label: 'Research firm' }) });
  const rest = [
    'roles: skill-researcher, qa',
    'playbooks: fix, audit, help, version, language, settings, setup, lead, triage, skillspector',
    'work: fix',
    'ship: release. Push, merge, release or deploy.',
    'ship lanes: legal, security',
    'ship checks: none',
    'skill search hints: alpha beta; gamma'
  ];
  const def = ['company type: software (Software company), default: no company_type line', ...rest];
  assert.deepEqual(exec(['resolve'], project(null), root), { code: 0, out: def.join('\n') });
  assert.deepEqual(exec(['check-playbook', 'fix'], project(null), root), { code: 0, out: ['ok: fix is part of the software company', ...def].join('\n') });
  assert.deepEqual(exec(['check-role', 'qa'], project(null), root), { code: 0, out: ['ok: qa is part of the software company', ...def].join('\n') });
  const fromProject = exec(['resolve'], project('company_type: research\n'), root).out.split('\n');
  assert.equal(fromProject[0], 'company type: research (Research firm), from .company/project.md');
  assert.equal(fromProject.length, 8);
  assert.ok(json(['check-role', 'qa'], project(null), root).out.startsWith('{"v":1,'));
});

test('list shows the shipped types in the fixed order', () => {
  const root = pluginRoot({
    design: manifest({ id: 'design', label: 'Design studio' }),
    software: manifest(),
    research: manifest({ id: 'research', label: 'Research consultancy', ship: { ...manifest().ship, kind: 'deliver-report', meaning: 'The report goes out.' } })
  });
  assert.deepEqual(exec(['list'], project(null), root), {
    code: 0,
    out: 'software: Software company. Ship means: Push, merge, release or deploy.\nresearch: Research consultancy. Ship means: The report goes out.\ndesign: Design studio. Ship means: Push, merge, release or deploy.'
  });
  const r = json(['list'], project(null), root);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.out), [
    { id: 'software', label: 'Software company', ship_meaning: 'Push, merge, release or deploy.' },
    { id: 'research', label: 'Research consultancy', ship_meaning: 'The report goes out.' },
    { id: 'design', label: 'Design studio', ship_meaning: 'Push, merge, release or deploy.' }
  ]);
});

test('a project that names a type outside the registry is refused even if another file exists for it', () => {
  const root = pluginRoot({ software: manifest(), research: manifest({ id: 'research' }) });
  const cwd = project('company_type: marketing\n');
  assert.equal(json(['resolve'], cwd, root).code, 2);
  assert.equal(JSON.parse(json(['resolve'], project('company_type: research\n'), root).out).id, 'research');
});

test('loadRegistry returns a null-prototype lookup keyed by id', () => {
  const reg = loadRegistry(REAL_ROOT);
  assert.ok(Object.hasOwn(reg, 'software'));
  assert.ok(!Object.hasOwn(reg, '__proto__'));
  assert.ok(!Object.hasOwn(reg, 'constructor'));
});

test('set inserts the line before product_type and keeps every other byte', () => {
  const text = '# Project profile\n\n<!-- note -->\n\nproduct_type: web\nengagement: own\n\u00e9\u00ff \t\n\n\nlast line without eol';
  const cwd = project(text);
  const r = exec(['set', 'research'], cwd, pluginRoot({ software: manifest(), research: manifest({ id: 'research' }) }));
  assert.deepEqual(r, { code: 0, out: 'set research' });
  assert.equal(readProject(cwd), text.replace('product_type:', 'company_type: research\nproduct_type:'));
  assert.deepEqual(fs.readdirSync(path.join(cwd, '.company')), ['project.md']);
});

test('set skips a product_type line inside a comment', () => {
  const text = '<!--\nproduct_type: x\n-->\nproduct_type: web\n';
  const cwd = project(text);
  assert.equal(exec(['set', 'software'], cwd).code, 0);
  assert.equal(readProject(cwd), '<!--\nproduct_type: x\n-->\ncompany_type: software\nproduct_type: web\n');
});

test('set without a product_type line goes after the first comment line, else at the top', () => {
  const a = project('# P\n<!-- one -->\n<!-- two -->\nstack: x\n');
  assert.equal(exec(['set', 'software'], a).code, 0);
  assert.equal(readProject(a), '# P\n<!-- one -->\ncompany_type: software\n<!-- two -->\nstack: x\n');
  const b = project('# P\nstack: x\n');
  assert.equal(exec(['set', 'software'], b).code, 0);
  assert.equal(readProject(b), 'company_type: software\n# P\nstack: x\n');
  const c = project('');
  assert.equal(exec(['set', 'software'], c).code, 0);
  assert.equal(readProject(c), 'company_type: software\n');
});

test('set keeps CRLF line ends of a CRLF file', () => {
  const cwd = project('# P\r\nproduct_type: web\r\n');
  assert.equal(exec(['set', 'software'], cwd).code, 0);
  assert.equal(readProject(cwd), '# P\r\ncompany_type: software\r\nproduct_type: web\r\n');
});

test('set prints a line, or JSON with --json', () => {
  assert.deepEqual(exec(['set', 'software'], project('product_type: web\n')), { code: 0, out: 'set software' });
  assert.deepEqual(json(['set', 'software'], project('product_type: web\n')), { code: 0, out: '{"v":1,"set":"software"}' });
});

test('set round trips through resolve', () => {
  const cwd = project('# P\n\nproduct_type: web\n');
  exec(['set', 'software'], cwd);
  const out = JSON.parse(json(['resolve'], cwd).out);
  assert.equal(out.id, 'software');
  assert.equal(out.source, 'project');
});

test('set refuses when a line exists and when there is no project.md', () => {
  const text = 'company_type: software\nproduct_type: web\n';
  const cwd = project(text);
  assert.deepEqual(exec(['set', 'software'], cwd), { code: 2, out: 'refused: company_type already set; switching types is not supported' });
  assert.equal(readProject(cwd), text);
  assert.deepEqual(exec(['set', 'software'], project(null)), { code: 2, out: 'refused: no .company/project.md' });
});

test('set leaves no temp file behind and the original intact when the rename cannot happen', () => {
  const cwd = project('product_type: web\n');
  assert.equal(exec(['set', 'software'], cwd).code, 0);
  assert.deepEqual(fs.readdirSync(path.join(cwd, '.company')), ['project.md']);
});

test('the command line prints the refusal line and exits with its code', () => {
  const cwd = project('company_type: ../../x\n');
  const r = spawnSync(process.execPath, [SCRIPT, 'resolve'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.equal(r.stdout, `${bad(1)}\n`);
  const ok = spawnSync(process.execPath, [SCRIPT, 'resolve', '--json'], { cwd: project(null), encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).id, 'software');
  const plain = spawnSync(process.execPath, [SCRIPT, 'resolve'], { cwd: project(null), encoding: 'utf8' });
  assert.match(plain.stdout, /^company type: software \(Software company\), default: no company_type line\nroles: /);
  const unknown = spawnSync(process.execPath, [SCRIPT, 'nope'], { cwd: project(null), encoding: 'utf8' });
  assert.equal(unknown.status, 2);
  assert.equal(unknown.stdout, `refused: unknown command "nope"; ${USAGE_TEXT}\n`);
});

test('the manifest files and script use LF only', () => {
  for (const file of [SCRIPT, path.join(REAL_ROOT, 'company', 'types', 'software.json')]) {
    assert.ok(!fs.readFileSync(file).includes(13), file);
  }
});

test('CEO_ONLY is frozen and equals the contract list', () => {
  assert.ok(Object.isFrozen(CEO_ONLY));
  assert.deepEqual([...CEO_ONLY], ['help', 'version', 'language', 'settings', 'setup', 'skillspector', 'pentest']);
  const contract = fs.readFileSync(path.join(REAL_ROOT, 'docs', 'contracts', 'company-type.md'), 'utf8');
  const line = contract.split('\n').find(l => l.startsWith('- **`CEO_ONLY`**'));
  assert.deepEqual([...line.matchAll(/`([a-z]+)`/g)].map(m => m[1]).slice(0, 7), [...CEO_ONLY]);
});

test('a skill is a Playbook by an argument-hint line inside its frontmatter, not by the flag', () => {
  const variants = {
    flagOnly: '---\nname: x\ndescription: d\ndisable-model-invocation: true\n---\nBody.\n',
    emptyHint: '---\nname: x\ndescription: d\nargument-hint:\n---\nBody.\n',
    hintInBody: '---\nname: x\ndescription: d\n---\nargument-hint: [file]\n',
    indented: '---\nname: x\ndescription: d\n  argument-hint: [file]\n---\nBody.\n',
    noFrontmatter: 'argument-hint: [file]\n',
    hintAndFlag: '---\nname: x\ndescription: d\nargument-hint: [file]\ndisable-model-invocation: true\n---\nBody.\n'
  };
  for (const [label, text] of Object.entries(variants)) {
    const root = pluginRoot({ software: manifest({ playbooks: ['fix'] }) });
    fs.writeFileSync(path.join(root, 'skills', 'fix', 'SKILL.md'), text);
    const r = exec(['list'], project(null), root);
    assert.equal(r.code === 0, label === 'hintAndFlag', label);
  }
});

test('a manifest naming a library skill (no argument-hint) is refused as playbooks', () => {
  const root = pluginRoot({ software: manifest({ playbooks: ['fix', 'tdd'] }) });
  const r = exec(['list'], project(null), root);
  assert.equal(r.code, 3);
  assert.equal(r.out, 'refused: type manifest software invalid: playbooks');
});
