import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ALWAYS, loadRegistry, run } from './company-type.mjs';

const REAL_ROOT = path.join(import.meta.dirname, '..');
const SCRIPT = path.join(import.meta.dirname, 'company-type.mjs');
const AC9 = 'refused: company_type is not valid; allowed: software, research, marketing, design';
const USAGE = 'refused: usage: company-type.mjs resolve | check-playbook <name> | check-role <role> | roles | list | set <id>';

const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'company-type-'));
  temps.push(d);
  return d;
}

const PLAYBOOK_FM = '---\nname: x\ndescription: Use when testing.\ndisable-model-invocation: true\n---\nBody.\n';
const SKILL_FM = '---\nname: x\ndescription: Use when testing.\n---\nBody.\n';

function manifest(over = {}) {
  return {
    v: 1,
    id: 'software',
    label: 'Software company',
    roles: ['skill-researcher', 'qa'],
    playbooks: ['fix', 'audit'],
    ship: { kind: 'release', meaning: 'Push, merge, release or deploy.', lanes: [], checks: [] },
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
    for (const args of [['resolve'], ['roles'], ['check-playbook', 'fix'], ['check-role', 'qa']]) {
      const r = exec(args, cwd);
      assert.equal(r.code, 2, `${JSON.stringify(value)} ${args[0]}`);
      assert.equal(r.out, AC9);
    }
    assert.equal(readProject(cwd), before);
  }
});

test('a duplicate company_type line is refused, even when both are valid', () => {
  for (const text of ['company_type: software\ncompany_type: software\n', 'company_type: software\nproduct_type: web\ncompany_type: research\n']) {
    const cwd = project(text);
    const r = exec(['resolve'], cwd);
    assert.deepEqual(r, { code: 2, out: AC9 });
    assert.equal(exec(['set', 'software'], cwd).code, 2);
    assert.equal(readProject(cwd), text);
  }
});

test('company_type inside an HTML comment, indented, or with another prefix is not a line', () => {
  const text = '<!-- company_type: bogus -->\n<!--\ncompany_type: bogus\n-->\n  company_type: bogus\nxcompany_type: bogus\nmy_company_type: bogus\ncompany_types: bogus\nproduct_type: web\n';
  const r = exec(['resolve'], project(text));
  assert.equal(r.code, 0);
  const out = JSON.parse(r.out);
  assert.equal(out.id, 'software');
  assert.equal(out.source, 'default');
});

test('an unterminated comment hides the rest of the file like the markdown reader does', () => {
  const r = exec(['resolve'], project('<!-- never closed\ncompany_type: bogus\n'));
  assert.equal(JSON.parse(r.out).source, 'default');
});

test('a CR before the line end is tolerated, other control bytes are not', () => {
  assert.equal(JSON.parse(exec(['resolve'], project('company_type: software\r\nproduct_type: web\r\n')).out).source, 'project');
  assert.deepEqual(exec(['resolve'], project('company_type: soft\u000bware\n')), { code: 2, out: AC9 });
  assert.deepEqual(exec(['resolve'], project('company_type: software\r\r\n')), { code: 2, out: AC9 });
});

test('spaces and tabs around the value are trimmed', () => {
  assert.equal(JSON.parse(exec(['resolve'], project('company_type: \t software \t \n')).out).source, 'project');
});

test('an oversize or non-regular project.md is refused', () => {
  const big = project(`company_type: software\n${'x'.repeat(300 * 1024)}\n`);
  assert.deepEqual(exec(['resolve'], big), { code: 2, out: AC9 });
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, '.company', 'project.md'), { recursive: true });
  assert.deepEqual(exec(['resolve'], cwd), { code: 2, out: AC9 });
  assert.equal(exec(['set', 'software'], cwd).code, 2);
});

test('a symlinked project.md is refused', t => {
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
  assert.deepEqual(exec(['resolve'], cwd), { code: 2, out: AC9 });
  assert.equal(exec(['set', 'software'], cwd).code, 2);
  assert.equal(fs.readFileSync(target, 'utf8'), 'company_type: research\n');
});

test('hostile names for check-playbook and check-role get the usage refusal', () => {
  const hostile = ['../fix', 'fix/..', 'FIX', '__proto__', '', 'a'.repeat(33), 'fix\u0000', 'fix extra', '-fix', '..', 'C:\\x'];
  for (const name of hostile) {
    for (const cmd of ['check-playbook', 'check-role']) {
      assert.deepEqual(exec([cmd, name], project(null)), { code: 2, out: USAGE }, `${cmd} ${JSON.stringify(name)}`);
    }
  }
  assert.deepEqual(exec(['check-playbook'], project(null)), { code: 2, out: USAGE });
  assert.deepEqual(exec(['check-playbook', 'fix', 'x'], project(null)), { code: 2, out: USAGE });
  assert.deepEqual(exec(['resolve', 'x'], project(null)), { code: 2, out: USAGE });
  assert.deepEqual(exec([], project(null)), { code: 2, out: USAGE });
  assert.deepEqual(exec(['nope'], project(null)), { code: 2, out: USAGE });
  assert.deepEqual(exec(['set'], project(null)), { code: 2, out: USAGE });
  assert.deepEqual(exec(['toString'], project(null)), { code: 2, out: USAGE });
});

test('set with a hostile id writes nothing', () => {
  const text = '# P\n\nproduct_type: web\n';
  for (const id of ['../x', '__proto__', 'Software', 'software\n', 'unknown', 'a'.repeat(100), 'software\nproduct_type: x', '']) {
    const cwd = project(text);
    assert.deepEqual(exec(['set', id], cwd), { code: 2, out: AC9 });
    assert.equal(readProject(cwd), text);
  }
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
  const r = exec(['resolve'], project(null));
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
});

test("all manifests' playbooks plus ALWAYS are exactly the model-hidden commands of the plugin", () => {
  const union = new Set([...ALWAYS, ...Object.values(loadRegistry(REAL_ROOT)).flatMap(m => m.playbooks)]);
  const hidden = fs.readdirSync(path.join(REAL_ROOT, 'skills')).filter(d => /^disable-model-invocation: true$/m.test(fs.readFileSync(path.join(REAL_ROOT, 'skills', d, 'SKILL.md'), 'utf8')));
  assert.deepEqual([...union].sort(), hidden.sort());
});

test('an explicit company_type: software line resolves from the project', () => {
  const out = JSON.parse(exec(['resolve'], project('# P\n\ncompany_type: software\nproduct_type: web\n')).out);
  assert.equal(out.id, 'software');
  assert.equal(out.source, 'project');
});

test('a missing .company/project.md means software by default', () => {
  assert.equal(JSON.parse(exec(['resolve'], project(null)).out).source, 'default');
});

test('check-playbook and check-role pass inside the type and refuse outside', () => {
  const cwd = project(null);
  const ok = exec(['check-playbook', 'fix'], cwd);
  assert.equal(ok.code, 0);
  assert.equal(JSON.parse(ok.out).id, 'software');
  assert.equal(exec(['check-playbook', 'help'], cwd).code, 0);
  assert.equal(exec(['check-role', 'qa'], cwd).code, 0);
  const root = pluginRoot();
  const no = exec(['check-playbook', 'report'], cwd, root);
  assert.deepEqual(no, { code: 2, out: 'refused: report is not part of the software company; allowed: fix, audit, help, version, language, settings, setup, lead, triage, skillspector' });
  assert.deepEqual(exec(['check-role', 'editor'], cwd, root), { code: 2, out: 'refused: editor is not part of the software company; allowed: skill-researcher, qa' });
});

test('roles prints one slug per line', () => {
  const r = exec(['roles'], project(null), pluginRoot());
  assert.deepEqual(r, { code: 0, out: 'skill-researcher\nqa' });
});

test('list shows the shipped types in the fixed order', () => {
  const root = pluginRoot({
    design: manifest({ id: 'design', label: 'Design studio' }),
    software: manifest(),
    research: manifest({ id: 'research', label: 'Research consultancy', ship: { ...manifest().ship, kind: 'deliver-report', meaning: 'The report goes out.' } })
  });
  const r = exec(['list'], project(null), root);
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
  assert.equal(exec(['resolve'], cwd, root).code, 2);
  assert.equal(JSON.parse(exec(['resolve'], project('company_type: research\n'), root).out).id, 'research');
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

test('set round trips through resolve', () => {
  const cwd = project('# P\n\nproduct_type: web\n');
  exec(['set', 'software'], cwd);
  const out = JSON.parse(exec(['resolve'], cwd).out);
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
  assert.equal(r.stdout, `${AC9}\n`);
  const ok = spawnSync(process.execPath, [SCRIPT, 'resolve'], { cwd: project(null), encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).id, 'software');
});

test('the manifest files and script use LF only', () => {
  for (const file of [SCRIPT, path.join(REAL_ROOT, 'company', 'types', 'software.json')]) {
    assert.ok(!fs.readFileSync(file).includes(13), file);
  }
});
