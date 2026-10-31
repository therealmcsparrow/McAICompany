import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, contests, exceptionsFor } from './handoff-lint.mjs';

const SCRIPT = fileURLToPath(new URL('./handoff-lint.mjs', import.meta.url));
const NAME = '2026-10-30 22.42 - Cache Warmup';
const OTHER = '2026-10-30 22.42 - Other Topic';
const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function project(name) {
  const root = mkdtempSync(join(tmpdir(), 'wf-handoff-'));
  roots.push(root);
  const run = join(root, '.company', 'work', name);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'run-state.jsonl'), '{"v":1,"at":"2026-10-30T08:00:00Z","ev":"start"}\n');
  return { root, run };
}

function handoff(role, { task = NAME, blocking = [], contested = [], contests: answers = [] } = {}) {
  const list = (h, a) => `## ${h}\n${a.length ? a.map(l => `- ${l}`).join('\n') : '- none'}\n`;
  return `---\nstep: 05\nrole: ${role}\ntask: ${task}\nstatus: done\nround: 0\nbase-commit: 0123456789abcdef0123456789abcdef01234567\nrisk-tier: medium\ncontracts: [handoff v2.0]\n---\nBy: ${role}\n## Did\n- work\n${list('Blocking', blocking)}${list('Contested', contested)}${list('Contests', answers)}## Nits\n- none\n## Next\n- go\n`;
}

const lintTask = task => lint(handoff('backend-engineer', { task })).errors;

test('task: takes a new name, a legacy slug and a plan task id', () => {
  for (const t of [NAME, `${NAME} Draft`, `${NAME} Draft 2`, 'demo', 'run-1', 'T15', 'U1', 'T2c']) {
    assert.deepEqual(lintTask(t), [], t);
  }
});

test('task: refuses forged and malformed names', () => {
  const bad = [
    '../x', 'a/b', 'a\\b', 'a..b', "it's", '$(touch x)', 'a`b`', 'run.', 'a'.repeat(200),
    '2026-10-30 22.42 - cache warmup', '2026-13-30 22.42 - Cache Warmup',
    '2026-10-30 22.42 - Cache Warmup/..', '2026-10-30 22.42 - Cache‮Warmup', 'Demo Run',
  ];
  for (const t of bad) {
    const e = lintTask(t.replace(/\n/g, ' '));
    assert.ok(e.some(x => /^line \d+: task must be/.test(x)), `${JSON.stringify(t)}: ${e}`);
  }
});

test('--contests takes a new-name run folder and a legacy one', () => {
  for (const name of [NAME, 'run1']) {
    const { root, run } = project(name);
    writeFileSync(join(run, '05-code-reviewer.md'), handoff('code-reviewer', { task: name, blocking: ['[spec] R-1 src/a.mjs:3 — problem — fix it'] }));
    const r = spawnSync(process.execPath, [SCRIPT, '--contests', run], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /state 05-code-reviewer:R-1 open/);
  }
});

const KEY = '05-security:R-1';
const exc = (name, key = KEY, date = '2026-10-30') => `## Exceptions\n- ${name}/${key} — s — r — approved: ${date} (CEO)\n`;

function secRun(name, standards) {
  const { root, run } = project(name);
  writeFileSync(join(run, '05-security.md'), handoff('security', { task: name, blocking: ['[security] R-1 src/a.mjs:3 — problem — fix it'] }));
  writeFileSync(join(root, '.company', 'standards.md'), standards);
  return run;
}

test('an exception line for this run, byte for byte, closes the finding', () => {
  const run = secRun(NAME, exc(NAME));
  assert.equal(contests(run).states.get(KEY), 'excepted');
});

test('an exception line for another run never applies', () => {
  const run = secRun(NAME, exc(OTHER));
  const r = contests(run);
  assert.equal(r.states.get(KEY), 'open');
  assert.deepEqual(r.excepted, []);
});

test('an exception line differing in case, spacing or look-alike characters never applies', () => {
  const forged = [
    NAME.toLowerCase(),
    NAME.toUpperCase(),
    '2026-10-30 22.42 - cache warmup',
    `${NAME} `,
    ` ${NAME}`,
    NAME.replace('Cache', 'Cachе'),
    NAME.replace(' - ', ' – '),
    NAME.replace('22.42', '22·42'),
    NAME.replace('Cache', 'Cache​'),
    '2026-10-30-2242-cache-warmup',
    `${NAME} Draft`,
    `../${NAME}`,
    `${NAME}/..`,
    'a'.repeat(300),
  ];
  for (const f of forged) {
    const run = secRun(NAME, exc(f));
    const r = contests(run);
    assert.equal(r.states.get(KEY), 'open', JSON.stringify(f));
    assert.deepEqual(r.excepted, [], JSON.stringify(f));
  }
});

test('an exception dated before the run start never applies, and an unslugged line counts for nothing', () => {
  assert.equal(contests(secRun(NAME, exc(NAME, KEY, '2026-10-29'))).states.get(KEY), 'open');
  assert.equal(contests(secRun(NAME, `## Exceptions\n- ${KEY} — s — r — approved: 2026-10-30 (CEO)\n`)).states.get(KEY), 'open');
});

test('a legacy run keeps its exception, and a new-name line does not cross over', () => {
  const legacy = secRun('run1', exc('run1'));
  assert.equal(contests(legacy).states.get(KEY), 'excepted');
  const cross = secRun('run1', exc(NAME));
  assert.equal(contests(cross).states.get(KEY), 'open');
});

test('exception keys stay untouched: a key with another shape is no key', () => {
  for (const key of ['05-security:R-', '5-security:R-1x', '05-Security:R-1', '05-security:r-1']) {
    assert.equal(contests(secRun(NAME, exc(NAME, key))).states.get(KEY), 'open', key);
  }
});

test('a long run part is bounded and cannot stall the lint', () => {
  const started = Date.now();
  const run = secRun(NAME, `## Exceptions\n- ${'a b'.repeat(300)}/${KEY} — s — r — approved: 2026-10-30 (CEO)\n- ${'a'.repeat(100000)}\n`);
  contests(run);
  assert.ok(Date.now() - started < 2000);
});

test('--exceptions-for counts lines for a new name and refuses a forged one', () => {
  const { root } = project(NAME);
  writeFileSync(join(root, '.company', 'standards.md'), exc(NAME) + exc(OTHER));
  assert.equal(exceptionsFor(root, NAME).line, 'exceptions on file: 1');
  assert.equal(exceptionsFor(root, NAME.toLowerCase()).code, 2);
  for (const s of ['../x', `${NAME}/..`, "a'b", '$(x)', 'a`b']) assert.equal(exceptionsFor(root, s).code, 2, s);
  assert.equal(exceptionsFor(root, 'run1').code, 0);
});

test('--applied lists the exception of a new-name run', () => {
  const run = secRun(NAME, exc(NAME));
  const r = spawnSync(process.execPath, [SCRIPT, '--applied', run], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /exceptions on file for .*: confirm each is yours \(1\)/);
});
