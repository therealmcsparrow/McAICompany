import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run, KEYS } from './project-init.mjs';
import { run as typeRun } from './company-type.mjs';
import { resolve as langResolve } from './language.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const SCRIPT = path.join(import.meta.dirname, 'project-init.mjs');
const TEMPLATE = path.join(ROOT, 'skills', 'lead', 'references', 'project-template.md');

const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'project-init-'));
  temps.push(d);
  return d;
}

const GOOD = () => ({
  product_type: 'web',
  engagement: 'own',
  client: 'none',
  audience: 'Small shop owners who sell online',
  goal: 'A shop owner lists a product in under two minutes',
  stack: 'unknown',
  languages: 'en',
  voice: 'clear',
  license: 'proprietary',
  jurisdiction: 'Netherlands/EU',
  personas: ['Mia: shop owner, lists products, beginner, phone']
});

function setup(answers) {
  const cwd = tmp();
  const file = path.join(cwd, 'answers.json');
  fs.writeFileSync(file, typeof answers === 'string' ? answers : JSON.stringify(answers));
  return { cwd, file };
}
const go = (answers, extra = {}) => {
  const s = setup(answers);
  return { ...s, res: run(['write', 'answers.json'], { cwd: s.cwd, pluginRoot: ROOT, ...extra }) };
};
const projectFile = cwd => path.join(cwd, '.company', 'project.md');
const refusedClean = (r, cwd) => {
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /^refused: /);
  assert.equal(fs.existsSync(projectFile(cwd)), false);
  assert.deepEqual(fs.existsSync(path.join(cwd, '.company')) ? fs.readdirSync(path.join(cwd, '.company')) : [], []);
};

function templateKeys() {
  const text = fs.readFileSync(TEMPLATE, 'utf8');
  const head = text.split('\n## ')[0].replace(/<!--[\s\S]*?-->/g, '');
  return head.split('\n').map(l => /^([a-z_]+):/.exec(l)?.[1]).filter(Boolean);
}

test('KEYS equal the template one-line keys, minus the fixed standards line', () => {
  const expected = templateKeys().filter(k => k !== 'standards');
  assert.deepEqual([...KEYS], expected);
});

test('empty folder plus answers: writes project.md with the template keys, LF only', () => {
  const { cwd, res } = go(GOOD());
  assert.equal(res.code, 0, res.out);
  assert.equal(res.out, 'wrote .company/project.md');
  const text = fs.readFileSync(projectFile(cwd), 'utf8');
  assert.equal(text.includes('\r'), false);
  assert.ok(text.endsWith('\n'));
  const lines = text.split('\n');
  const keys = lines.map(l => /^([a-z_]+): /.exec(l)?.[1]).filter(Boolean);
  assert.deepEqual(keys, templateKeys());
  assert.ok(lines.includes('audience: Small shop owners who sell online'));
  assert.ok(lines.includes('- Mia: shop owner, lists products, beginner, phone'));
  assert.ok(text.includes('## Core'));
  assert.ok(text.includes('## Modules'));
  assert.equal(fs.readdirSync(path.join(cwd, '.company')).join(), 'project.md');
});

test('passes the Setup readers: company type and language', () => {
  const { cwd } = go({ ...GOOD(), company_type: 'research', languages: 'nl' });
  assert.equal(fs.existsSync(projectFile(cwd)), true);
  const t = typeRun(['resolve', '--json'], { cwd, pluginRoot: ROOT });
  assert.equal(t.code, 0, t.out);
  assert.equal(JSON.parse(t.out).id, 'research');
  assert.equal(JSON.parse(t.out).source, 'project');
  const l = langResolve({ cwd, home: tmp() });
  assert.equal(l.tag, 'en');
});

test('no company_type given: the type stays the default', () => {
  const { cwd } = go(GOOD());
  const t = typeRun(['resolve', '--json'], { cwd, pluginRoot: ROOT });
  assert.equal(JSON.parse(t.out).source, 'default');
});

test('personas: none keeps the template placeholder line', () => {
  const { cwd, res } = go({ ...GOOD(), personas: [] });
  assert.equal(res.code, 0, res.out);
  assert.match(fs.readFileSync(projectFile(cwd), 'utf8'), /## Personas\n<!--[^\n]*-->\n- \(none yet;/);
});

test('existing project.md: refused, file untouched, nothing else written', () => {
  const s = setup(GOOD());
  fs.mkdirSync(path.join(s.cwd, '.company'));
  fs.writeFileSync(projectFile(s.cwd), 'mine\n');
  const r = run(['write', 'answers.json'], { cwd: s.cwd, pluginRoot: ROOT });
  assert.equal(r.code, 3);
  assert.match(r.out, /already exists/);
  assert.equal(fs.readFileSync(projectFile(s.cwd), 'utf8'), 'mine\n');
  assert.deepEqual(fs.readdirSync(path.join(s.cwd, '.company')), ['project.md']);
});

test('a link at the project.md path is refused', t => {
  const s = setup(GOOD());
  fs.mkdirSync(path.join(s.cwd, '.company'));
  const target = path.join(s.cwd, 'elsewhere.md');
  fs.writeFileSync(target, 'x\n');
  try {
    fs.symlinkSync(target, projectFile(s.cwd));
  } catch {
    t.skip('no symlink right');
    return;
  }
  const r = run(['write', 'answers.json'], { cwd: s.cwd, pluginRoot: ROOT });
  assert.equal(r.code, 3);
  assert.equal(fs.readFileSync(target, 'utf8'), 'x\n');
});

test('.company as a link is refused', t => {
  const s = setup(GOOD());
  const real = tmp();
  try {
    fs.symlinkSync(real, path.join(s.cwd, '.company'), 'junction');
  } catch {
    t.skip('no symlink right');
    return;
  }
  const r = run(['write', 'answers.json'], { cwd: s.cwd, pluginRoot: ROOT });
  assert.equal(r.code, 3);
  assert.deepEqual(fs.readdirSync(real), []);
});

const HOSTILE = [
  ['control byte', 'audience', 'a\u0000b'],
  ['escape', 'goal', 'a\u001bb'],
  ['tab', 'goal', 'a\tb'],
  ['C1 control', 'goal', 'a\u0085b'],
  ['DEL', 'goal', 'a\u007fb'],
  ['newline', 'goal', 'one\ntwo'],
  ['carriage return', 'goal', 'one\rtwo'],
  ['line separator', 'goal', 'one two'],
  ['paragraph separator', 'goal', 'one two'],
  ['bidi override', 'goal', 'a‮b'],
  ['bidi isolate', 'goal', 'a⁦b'],
  ['bidi mark', 'goal', 'a‏b'],
  ['lone surrogate', 'goal', 'a\ud800b'],
  ['too long', 'audience', 'x'.repeat(201)],
  ['empty', 'audience', ''],
  ['comment open', 'goal', 'hide <!-- the rest'],
  ['comment close', 'goal', 'x --> y'],
  ['not a string', 'goal', 5],
  ['bad product_type', 'product_type', 'web | desktop'],
  ['bad engagement', 'engagement', 'both'],
  ['bad voice', 'voice', 'loud'],
  ['bad language', 'languages', 'en\nstandards: x'],
  ['bad language tag', 'languages', 'zz-'],
  ['company_type not a type', 'company_type', 'pirate'],
  ['company_type proto', 'company_type', '__proto__'],
  ['company_type line break', 'company_type', 'software\nproduct_type: game']
];
for (const [name, key, value] of HOSTILE) {
  test(`hostile value refused (${name}), the value is not echoed`, () => {
    const { cwd, res } = go({ ...GOOD(), [key]: value });
    refusedClean(res, cwd);
    assert.ok(res.out.includes(key), res.out);
    if (typeof value === 'string' && value.length > 3) assert.equal(res.out.includes(value), false);
  });
}

test('over-long value: exactly 200 is accepted, 201 refused', () => {
  const { cwd, res } = go({ ...GOOD(), goal: 'g'.repeat(200) });
  assert.equal(res.code, 0, res.out);
  assert.ok(fs.readFileSync(projectFile(cwd), 'utf8').includes(`goal: ${'g'.repeat(200)}\n`));
});

test('hostile personas refused', () => {
  for (const personas of [
    ['a', 'b', 'c', 'd', 'e', 'f'],
    ['one\ntwo'],
    ['x'.repeat(201)],
    [''],
    'Mia',
    [5],
    ['ok', '<!-- x']
  ]) {
    const { cwd, res } = go({ ...GOOD(), personas });
    refusedClean(res, cwd);
    assert.ok(res.out.includes('personas'), res.out);
  }
});

test('missing, unknown and inherited keys are refused', () => {
  for (const key of KEYS) {
    const a = GOOD();
    delete a[key];
    const { cwd, res } = go(a);
    refusedClean(res, cwd);
    assert.ok(res.out.includes(key), res.out);
  }
  let r = go({ ...GOOD(), extra: 'x' });
  refusedClean(r.res, r.cwd);
  r = go({ ...GOOD(), standards: 'x' });
  refusedClean(r.res, r.cwd);
  r = go('{"__proto__":{"goal":"x"},' + JSON.stringify(GOOD()).slice(1));
  refusedClean(r.res, r.cwd);
});

test('answers file: not JSON, not an object, too large, missing, a link, a directory', t => {
  for (const body of ['nope', '[]', 'null', '"x"', '{', ' '.repeat(40 * 1024) + '{}']) {
    const { cwd, res } = go(body);
    refusedClean(res, cwd);
  }
  const s = tmp();
  assert.equal(run(['write', 'none.json'], { cwd: s, pluginRoot: ROOT }).code, 3);
  fs.mkdirSync(path.join(s, 'd.json'));
  assert.equal(run(['write', 'd.json'], { cwd: s, pluginRoot: ROOT }).code, 3);
  const real = path.join(s, 'real.json');
  fs.writeFileSync(real, JSON.stringify(GOOD()));
  try {
    fs.symlinkSync(real, path.join(s, 'link.json'));
    assert.equal(run(['write', 'link.json'], { cwd: s, pluginRoot: ROOT }).code, 3);
  } catch {
    t.diagnostic('no symlink right');
  }
});

test('argument shapes', () => {
  const s = tmp();
  for (const args of [[], ['write'], ['write', 'a', 'b'], ['nope', 'a'], ['write', '']]) {
    const r = run(args, { cwd: s, pluginRoot: ROOT });
    assert.equal(r.code, 3);
    assert.match(r.out, /^refused: usage: project-init\.mjs write <answers\.json>$/);
  }
});

test('command line: writes and exits 0, a refusal exits 3', () => {
  const s = setup(GOOD());
  const env = { ...process.env, MCSPARROW_HOME: tmp() };
  const ok = spawnSync(process.execPath, [SCRIPT, 'write', 'answers.json'], { cwd: s.cwd, env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, 'wrote .company/project.md\n');
  const again = spawnSync(process.execPath, [SCRIPT, 'write', 'answers.json'], { cwd: s.cwd, env, encoding: 'utf8' });
  assert.equal(again.status, 3);
  assert.match(again.stdout, /^refused: /);
});

test('the lead skill names every form and ends at the Brief Gate', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills', 'lead', 'SKILL.md'), 'utf8');
  const guide = fs.readFileSync(path.join(ROOT, 'skills', 'lead', 'references', 'first-product.md'), 'utf8');
  assert.ok(skill.split('\n').length <= 125);
  assert.ok(skill.includes('references/first-product.md'));
  for (const form of ['Form 1 Company', 'Form 2 Product', 'Form 3 Voice and terms']) assert.ok(guide.includes(form), form);
  for (const key of [...KEYS, 'personas', 'company_type']) assert.ok(guide.includes(`\`${key}\``), key);
  assert.ok(guide.includes('project-init.mjs'));
  const tail = guide.trimEnd().split('\n').at(-1);
  assert.match(tail, /stops at the \*\*Brief Gate\*\*|stop[s]? at the \*\*Brief Gate\*\*|\*\*Brief Gate\*\*/);
  assert.equal(guide.includes('\r'), false);
});
