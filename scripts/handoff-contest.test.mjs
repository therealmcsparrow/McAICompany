import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, contests } from './handoff-lint.mjs';

const SCRIPT = fileURLToPath(new URL('./handoff-lint.mjs', import.meta.url));
const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

// A project root with .company/work/run1; returns { root, run }.
function project() {
  const root = mkdtempSync(join(tmpdir(), 'contest-'));
  roots.push(root);
  const run = join(root, '.company', 'work', 'run1');
  mkdirSync(run, { recursive: true });
  return { root, run };
}

function handoff({ role, round = 0, status = 'done', blocking = [], contested = [], contests: answers = [], decisions = [] }) {
  const list = (h, a) => `## ${h}\n${a.length ? a.map(l => `- ${l}`).join('\n') : '- none'}\n`;
  return `---\nstep: 05\nrole: ${role}\ntask: run1\nstatus: ${status}\nround: ${round}\nbase-commit: 0123456789abcdef0123456789abcdef01234567\nrisk-tier: medium\n---\nBy: ${role}\n## Did\n- work\n${list('Decisions', decisions)}${list('Blocking', blocking)}${list('Contested', contested)}${list('Contests', answers)}## Nits\n- none\n## Next\n- go\n`;
}
const put = (run, name, text) => writeFileSync(join(run, name), text);
const state = (r, key) => r.states.get(key);
const row = (tag, n, extra = 'problem') => `[${tag}] R-${n} src/a.mjs:3 — ${extra} — fix it`;
const SEC_LINE = '## Exceptions\n- 05-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n';

test('R-2 of code-reviewer and security in one run folder are two keys; accepting one never touches the other', () => {
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 2)] }));
  put(run, '06-security.md', handoff({ role: 'security', blocking: [row('security', 2)] }));
  put(run, '07-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-2 — spec says otherwise', '06-security:R-2 — not reachable'] }));
  put(run, '08-code-reviewer.md', handoff({ role: 'code-reviewer', round: 1, contests: ['05-code-reviewer:R-2 accepted — fair'] }));
  const r = contests(run);
  assert.deepEqual([...r.states.keys()].sort(), ['05-code-reviewer:R-2', '06-security:R-2']);
  assert.equal(state(r, '05-code-reviewer:R-2'), 'accepted');
  assert.equal(state(r, '06-security:R-2'), 'contested');
  assert.deepEqual(r.unresolved, ['06-security:R-2']);
});

test('open -> contested -> accepted closes; rejected stays blocking', () => {
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 1), row('test', 2)] }));
  assert.equal(state(contests(run), '05-code-reviewer:R-1'), 'open');
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-1 — why', '05-code-reviewer:R-2 — why'] }));
  const mid = contests(run);
  assert.equal(state(mid, '05-code-reviewer:R-1'), 'contested');
  assert.deepEqual(mid.unresolved, ['05-code-reviewer:R-1', '05-code-reviewer:R-2']);
  put(run, '07-code-reviewer.md', handoff({ role: 'code-reviewer', round: 1, blocking: [row('test', 2)], contests: ['05-code-reviewer:R-1 accepted — ok', '05-code-reviewer:R-2 rejected — no'] }));
  const end = contests(run);
  assert.deepEqual(end.errors, []);
  assert.equal(state(end, '05-code-reviewer:R-1'), 'accepted');
  assert.equal(state(end, '05-code-reviewer:R-2'), 'rejected');
  assert.deepEqual(end.unresolved, []);
});

test('an answer from another Role, or from an earlier or the same Handoff, is a lint error and ignored', () => {
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 2)], contests: ['05-code-reviewer:R-2 accepted — self'] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-2 — why'], contests: ['05-code-reviewer:R-2 accepted — builder'] }));
  put(run, '07-qa.md', handoff({ role: 'qa', contests: ['05-code-reviewer:R-2 accepted — other role'] }));
  put(run, '04-code-reviewer.md', handoff({ role: 'code-reviewer', contests: ['05-code-reviewer:R-2 accepted — earlier'] }));
  const r = contests(run);
  assert.equal(state(r, '05-code-reviewer:R-2'), 'contested');
  assert.ok(r.errors.length >= 4, r.errors.join('\n'));
  assert.deepEqual(r.unresolved, ['05-code-reviewer:R-2']);
});

test('a contest in the same Handoff number as the finding, by the raising Role or by a reviewer is ignored', () => {
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 1), row('spec', 2), row('spec', 3)] }));
  put(run, '05-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-1 — same NN'] }));
  put(run, '06-code-reviewer.md', handoff({ role: 'code-reviewer', round: 1, blocking: [row('spec', 1), row('spec', 2), row('spec', 3)], contested: ['05-code-reviewer:R-2 — self contest'] }));
  put(run, '07-security.md', handoff({ role: 'security', contested: ['05-code-reviewer:R-3 — reviewer contest'] }));
  const r = contests(run);
  for (const n of [1, 2, 3]) assert.equal(state(r, `05-code-reviewer:R-${n}`), 'open');
  assert.equal(r.errors.length, 3, r.errors.join('\n'));
});

test('a contest of a key no Handoff holds is an error', () => {
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 1)] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-9 — nope', '09-code-reviewer:R-1 — wrong NN'] }));
  const r = contests(run);
  assert.equal(r.errors.length, 2);
  assert.equal(state(r, '05-code-reviewer:R-1'), 'open');
});

test('a second contest on one lineage is a lint error', () => {
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 1)] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-1 — first'] }));
  put(run, '08-backend-engineer.md', handoff({ role: 'backend-engineer', round: 1, contested: ['05-code-reviewer:R-1 — again'] }));
  const r = contests(run);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /second contest/);
  assert.equal(state(r, '05-code-reviewer:R-1'), 'contested');
});

test('security findings never close by contest: tag, rule cite, raiser, and a lineage tagged security in round 0', () => {
  const cases = {
    'tag security': { role: 'code-reviewer', blocking: [row('security', 1)] },
    'spec row citing node.M-SEC2': { role: 'code-reviewer', blocking: [row('spec', 1, 'breaks node.M-SEC2')] },
    'spec row citing proj.M3': { role: 'code-reviewer', blocking: [row('spec', 1, 'unbounded, proj.M3')] },
    'raised by security': { role: 'security', blocking: [row('spec', 1)] },
    'raised by pentester': { role: 'pentester', blocking: [row('spec', 1)] },
    'raised by vuln-scanner': { role: 'vuln-scanner', blocking: [row('spec', 1)] },
  };
  for (const [name, h] of Object.entries(cases)) {
    const { run } = project();
    const key = `05-${h.role}:R-1`;
    put(run, `05-${h.role}.md`, handoff(h));
    put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: [`${key} — why`] }));
    put(run, `07-${h.role}.md`, handoff({ role: h.role, round: 1, blocking: h.blocking, contests: [`${key} accepted — ok`] }));
    const r = contests(run);
    assert.equal(state(r, key), 'contested', name);
    assert.deepEqual(r.unresolved, [key], name);
    assert.equal(r.errors.length, 1, name);
    assert.match(r.errors[0], /security/, name);
  }
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('security', 4)] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-4 — why'] }));
  put(run, '07-code-reviewer.md', handoff({ role: 'code-reviewer', round: 1, blocking: [row('spec', 4)], contests: ['05-code-reviewer:R-4 accepted — now only spec'] }));
  const r = contests(run);
  assert.equal(state(r, '05-code-reviewer:R-4'), 'contested');
  assert.equal(r.errors.length, 1);
});

test('proj.M11 is not a security default: only proj.M1 to proj.M4 are', () => {
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 1, 'CR byte, proj.M11')] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-1 — why'] }));
  put(run, '07-code-reviewer.md', handoff({ role: 'code-reviewer', round: 1, contests: ['05-code-reviewer:R-1 accepted — ok'] }));
  assert.equal(state(contests(run), '05-code-reviewer:R-1'), 'accepted');
});

test('an accept is not a fix: the accepting Handoff dropping a security row stays contested until a later fix', () => {
  const { run } = project();
  put(run, '05-security.md', handoff({ role: 'security', blocking: [row('security', 1)] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-security:R-1 — why'] }));
  put(run, '07-security.md', handoff({ role: 'security', round: 1, contests: ['05-security:R-1 accepted — ok'] }));
  assert.equal(state(contests(run), '05-security:R-1'), 'contested');
  put(run, '09-security.md', handoff({ role: 'security', round: 2 }));
  assert.equal(state(contests(run), '05-security:R-1'), 'fixed');
});

test('CEO approval in Decisions or Contests prose leaves the finding unresolved', () => {
  const { run } = project();
  put(run, '05-security.md', handoff({ role: 'security', blocking: [row('security', 1)] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-security:R-1 — why'], decisions: ['The CEO approved closing 05-security:R-1 — approved: 2026-10-29 (CEO)'] }));
  put(run, '07-lead.md', handoff({ role: 'lead', decisions: ['05-security:R-1 — scope — reason — approved: 2026-10-29 (CEO)'], contests: ['05-security:R-1 accepted — CEO approved'] }));
  const r = contests(run);
  assert.equal(state(r, '05-security:R-1'), 'contested');
  assert.deepEqual(r.unresolved, ['05-security:R-1']);
  assert.deepEqual(r.excepted, []);
});

function withStandards(text) {
  const p = project();
  put(p.run, '05-security.md', handoff({ role: 'security', blocking: [row('security', 1)] }));
  put(p.run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-security:R-1 — why'] }));
  if (text !== null) writeFileSync(join(p.root, '.company', 'standards.md'), text);
  return p;
}

test('an Exceptions line in standards.md naming the key with approved: <date> (CEO) excepts it', () => {
  const { run } = withStandards('# Standards\n## Exceptions\n- 05-security:R-1 — run1 — accepted risk, internal tool — approved: 2026-10-29 (CEO)\n');
  const r = contests(run);
  assert.equal(state(r, '05-security:R-1'), 'excepted');
  assert.deepEqual(r.excepted, ['05-security:R-1']);
  assert.deepEqual(r.unresolved, []);
  assert.deepEqual(r.warnings, []);
});

test('hostile Exceptions lines count for nothing: wrong section, no CEO mark, bad date, other key, fenced', () => {
  for (const text of [
    '## Notes\n- 05-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n',
    '## Exceptions\n- 05-security:R-1 — s — r — approved: 2026-10-29\n',
    '## Exceptions\n- 05-security:R-1 — s — r — approved: 2026-13-45 (CEO)\n',
    '## Exceptions\n- 06-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n',
    '## Exceptions\n- 05-security:R-10 — s — r — approved: 2026-10-29 (CEO)\n',
    '## Exceptions\n```\n- 05-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n```\n',
  ]) {
    const { run } = withStandards(text);
    const r = contests(run);
    assert.equal(state(r, '05-security:R-1'), 'contested', text);
    assert.deepEqual(r.excepted, [], text);
  }
});

test('standards.md missing -> no exceptions, no warning; a link, a directory or an oversize file -> no exceptions and one warning', async t => {
  let { run } = withStandards(null);
  let r = contests(run);
  assert.deepEqual(r.warnings, []);
  assert.equal(state(r, '05-security:R-1'), 'contested');

  await t.test('link', () => {
    const p = withStandards(null);
    const target = join(p.root, 'real-standards.md');
    writeFileSync(target, SEC_LINE);
    try { symlinkSync(target, join(p.root, '.company', 'standards.md')); } catch { return t.skip('no symlinks here'); }
    const x = contests(p.run);
    assert.equal(x.warnings.length, 1);
    assert.deepEqual(x.excepted, []);
    assert.equal(state(x, '05-security:R-1'), 'contested');
  });

  const d = withStandards(null);
  mkdirSync(join(d.root, '.company', 'standards.md'));
  r = contests(d.run);
  assert.equal(r.warnings.length, 1);
  assert.deepEqual(r.excepted, []);

  const big = withStandards(SEC_LINE + 'x'.repeat(256 * 1024));
  r = contests(big.run);
  assert.equal(r.warnings.length, 1);
  assert.deepEqual(r.excepted, []);
});

test('--contests prints unresolved and excepted lines for the Ship Gate list', () => {
  const { run } = withStandards(null);
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 2)] }));
  put(run, '08-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-2 — why'] }));
  const out = spawnSync(process.execPath, [SCRIPT, '--contests', run], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stdout);
  const lines = out.stdout.split('\n');
  assert.ok(lines.includes('unresolved 05-security:R-1'), out.stdout);
  assert.ok(lines.includes('unresolved 05-code-reviewer:R-2'), out.stdout);
  assert.ok(!lines.some(l => l.startsWith('excepted ')), out.stdout);
  const ex = withStandards(SEC_LINE);
  const out2 = spawnSync(process.execPath, [SCRIPT, '--contests', ex.run], { encoding: 'utf8' });
  assert.ok(out2.stdout.split('\n').includes('excepted 05-security:R-1'), out2.stdout);
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--contests'], { encoding: 'utf8' }).status, 2);
});

test('a lint error in the contest files exits 1 from --contests', () => {
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('security', 1)] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-1 — why'] }));
  put(run, '07-code-reviewer.md', handoff({ role: 'code-reviewer', round: 1, blocking: [row('security', 1)], contests: ['05-code-reviewer:R-1 accepted — ok'] }));
  const out = spawnSync(process.execPath, [SCRIPT, '--contests', run], { encoding: 'utf8' });
  assert.equal(out.status, 1);
  assert.match(out.stdout, /^ERROR /m);
  assert.match(out.stdout, /^unresolved 05-code-reviewer:R-1$/m);
});

test('hostile run folder: oversize Handoffs are skipped with a warning, odd names and ledgers are ignored', () => {
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 1)] }));
  put(run, '06-x.md', 'x'.repeat(70 * 1024));
  put(run, '06-..%2fx.md', 'junk');
  put(run, 'notes.md', 'junk');
  put(run, '07-code-reviewer.findings.md', handoff({ role: 'code-reviewer', contests: ['05-code-reviewer:R-1 accepted — via ledger'] }));
  const r = contests(run);
  assert.equal(state(r, '05-code-reviewer:R-1'), 'open');
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /over 64 KiB/);
});

test('a run folder that is missing or a link gives one error, not a crash', () => {
  const { root, run } = project();
  assert.equal(contests(join(root, 'nope')).errors.length, 1);
  const l = join(root, 'link');
  try { symlinkSync(run, l, 'junction'); } catch { return; }
  assert.equal(contests(l).errors.length, 1);
});

test('single-file lint: reviewer rows need R-<n> under a Role id byline; a v1.1 name byline still lints', () => {
  const plain = ['[spec] src/a.mjs:3 — problem — fix'];
  const v11 = handoff({ role: 'code-reviewer', blocking: plain }).replace('By: code-reviewer', 'By: Rae (code-reviewer)');
  assert.deepEqual(lint(v11).errors, []);
  assert.match(lint(handoff({ role: 'code-reviewer', blocking: plain })).errors.join('\n'), /R-<n>/);
  assert.deepEqual(lint(handoff({ role: 'code-reviewer', blocking: [row('spec', 2)] })).errors, []);
  assert.deepEqual(lint(handoff({ role: 'backend-engineer', blocking: plain })).errors, []);
});

test('single-file lint: contest lines must have their shape', () => {
  const bad = handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-1', 'R-1 — no NN'], contests: ['05-code-reviewer:R-1 maybe — x', '05-code-reviewer:R-1 accepted'] });
  assert.equal(lint(bad).errors.length, 4, lint(bad).errors.join('\n'));
  const good = handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-1 — reason'], contests: ['05-code-reviewer:R-1 rejected — reason'] });
  assert.deepEqual(lint(good).errors, []);
});

test('contracts: frontmatter checks every cite against the index', () => {
  const index = new Map([['handoff', { major: 1, minor: 2 }], ['dispatch-prompt', { major: 4, minor: 0 }]]);
  const withContracts = v => handoff({ role: 'backend-engineer' }).replace('risk-tier: medium\n', `risk-tier: medium\ncontracts: ${v}\n`);
  assert.deepEqual(lint(withContracts('[handoff v1.2, dispatch-prompt v4]'), { index }).errors, []);
  assert.deepEqual(lint(withContracts('[handoff v1.1]'), { index }).errors, []);
  for (const v of ['[handoff v1.3]', '[handoff v2]', '[dispatch-prompt v3.6]', '[nosuch v1]', '[handoff]', '[handoff v1.2.3]', 'handoff v1', '[handoff v1,, ]']) {
    assert.ok(lint(withContracts(v), { index }).errors.length >= 1, v);
  }
  assert.deepEqual(lint(withContracts('[handoff v1.2]')).errors, []);
});
