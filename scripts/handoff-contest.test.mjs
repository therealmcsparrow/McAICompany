import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, contests, parseLocations } from './handoff-lint.mjs';

const SCRIPT = fileURLToPath(new URL('./handoff-lint.mjs', import.meta.url));
const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

// A project root with .company/work/run1; returns { root, run }.
function project() {
  const root = mkdtempSync(join(tmpdir(), 'contest-'));
  roots.push(root);
  const run = join(root, '.company', 'work', 'run1');
  mkdirSync(run, { recursive: true });
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.mjs'), 'one\ntwo\nthree\nfour\nfive\n');
  writeFileSync(join(root, 'src', 'a.test.mjs'), "it('keeps the order', () => {});\n");
  writeFileSync(join(run, 'run-state.jsonl'), '{"v":1,"at":"2026-10-29T08:00:00Z","ev":"start"}\n');
  return { root, run };
}

function handoff({ role, round = 0, status = 'done', blocking = [], contested = [], contests: answers = [], decisions = [] }) {
  const list = (h, a) => `## ${h}\n${a.length ? a.map(l => `- ${l}`).join('\n') : '- none'}\n`;
  return `---\nstep: 05\nrole: ${role}\ntask: run1\nstatus: ${status}\nround: ${round}\nbase-commit: 0123456789abcdef0123456789abcdef01234567\nrisk-tier: medium\ncontracts: [handoff v1.2]\n---\nBy: ${role}\n## Did\n- work\n${list('Decisions', decisions)}${list('Blocking', blocking)}${list('Contested', contested)}${list('Contests', answers)}## Nits\n- none\n## Next\n- go\n`;
}
const put = (run, name, text) => writeFileSync(join(run, name), text);
const state = (r, key) => r.states.get(key);
const row = (tag, n, extra = 'problem') => `[${tag}] R-${n} src/a.mjs:3 — ${extra} — fix it`;
const SEC_LINE = '## Exceptions\n- run1/05-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n';

test('R-2 of code-reviewer and security in one run folder are two keys; accepting one never touches the other', () => {
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 2)] }));
  put(run, '06-security.md', handoff({ role: 'security', blocking: [row('security', 2)] }));
  put(run, '07-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-2 — spec says otherwise — evidence: src/a.mjs:1', '06-security:R-2 — not reachable — evidence: src/a.mjs:1'] }));
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
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-1 — why — evidence: src/a.mjs:1', '05-code-reviewer:R-2 — why — evidence: src/a.mjs:1'] }));
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
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-2 — why — evidence: src/a.mjs:1'], contests: ['05-code-reviewer:R-2 accepted — builder'] }));
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
  put(run, '05-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-1 — same NN — evidence: src/a.mjs:1'] }));
  put(run, '06-code-reviewer.md', handoff({ role: 'code-reviewer', round: 1, blocking: [row('spec', 1), row('spec', 2), row('spec', 3)], contested: ['05-code-reviewer:R-2 — self contest — evidence: src/a.mjs:1'] }));
  put(run, '07-security.md', handoff({ role: 'security', contested: ['05-code-reviewer:R-3 — reviewer contest — evidence: src/a.mjs:1'] }));
  const r = contests(run);
  for (const n of [1, 2, 3]) assert.equal(state(r, `05-code-reviewer:R-${n}`), 'open');
  assert.equal(r.errors.length, 3, r.errors.join('\n'));
});

test('a contest of a key no Handoff holds is an error', () => {
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 1)] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-9 — nope — evidence: src/a.mjs:1', '09-code-reviewer:R-1 — wrong NN — evidence: src/a.mjs:1'] }));
  const r = contests(run);
  assert.equal(r.errors.length, 2);
  assert.equal(state(r, '05-code-reviewer:R-1'), 'open');
});

test('a second contest on one lineage is a lint error', () => {
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 1)] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-1 — first — evidence: src/a.mjs:1'] }));
  put(run, '08-backend-engineer.md', handoff({ role: 'backend-engineer', round: 1, contested: ['05-code-reviewer:R-1 — again — evidence: src/a.mjs:1'] }));
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
    put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: [`${key} — why — evidence: src/a.mjs:1`] }));
    put(run, `07-${h.role}.md`, handoff({ role: h.role, round: 1, blocking: h.blocking, contests: [`${key} accepted — ok`] }));
    const r = contests(run);
    assert.equal(state(r, key), 'contested', name);
    assert.deepEqual(r.unresolved, [key], name);
    assert.equal(r.errors.length, 1, name);
    assert.match(r.errors[0], /security/, name);
  }
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('security', 4)] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-4 — why — evidence: src/a.mjs:1'] }));
  put(run, '07-code-reviewer.md', handoff({ role: 'code-reviewer', round: 1, blocking: [row('spec', 4)], contests: ['05-code-reviewer:R-4 accepted — now only spec'] }));
  const r = contests(run);
  assert.equal(state(r, '05-code-reviewer:R-4'), 'contested');
  assert.equal(r.errors.length, 1);
});

test('proj.M11 is not a security default: only proj.M1 to proj.M4 are', () => {
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 1, 'CR byte, proj.M11')] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-1 — why — evidence: src/a.mjs:1'] }));
  put(run, '07-code-reviewer.md', handoff({ role: 'code-reviewer', round: 1, contests: ['05-code-reviewer:R-1 accepted — ok'] }));
  assert.equal(state(contests(run), '05-code-reviewer:R-1'), 'accepted');
});

test('an accept is not a fix: the accepting Handoff dropping a security row stays contested until a later fix', () => {
  const { run } = project();
  put(run, '05-security.md', handoff({ role: 'security', blocking: [row('security', 1)] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-security:R-1 — why — evidence: src/a.mjs:1'] }));
  put(run, '07-security.md', handoff({ role: 'security', round: 1, contests: ['05-security:R-1 accepted — ok'] }));
  assert.equal(state(contests(run), '05-security:R-1'), 'contested');
  put(run, '09-security.md', handoff({ role: 'security', round: 2 }));
  assert.equal(state(contests(run), '05-security:R-1'), 'fixed');
});

test('CEO approval in Decisions or Contests prose leaves the finding unresolved', () => {
  const { run } = project();
  put(run, '05-security.md', handoff({ role: 'security', blocking: [row('security', 1)] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-security:R-1 — why — evidence: src/a.mjs:1'], decisions: ['The CEO approved closing 05-security:R-1 — approved: 2026-10-29 (CEO)'] }));
  put(run, '07-lead.md', handoff({ role: 'lead', decisions: ['05-security:R-1 — scope — reason — approved: 2026-10-29 (CEO)'], contests: ['05-security:R-1 accepted — CEO approved'] }));
  const r = contests(run);
  assert.equal(state(r, '05-security:R-1'), 'contested');
  assert.deepEqual(r.unresolved, ['05-security:R-1']);
  assert.deepEqual(r.excepted, []);
});

function withStandards(text) {
  const p = project();
  put(p.run, '05-security.md', handoff({ role: 'security', blocking: [row('security', 1)] }));
  put(p.run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-security:R-1 — why — evidence: src/a.mjs:1'] }));
  if (text !== null) writeFileSync(join(p.root, '.company', 'standards.md'), text);
  return p;
}

test('an Exceptions line in standards.md naming the key with approved: <date> (CEO) excepts it', () => {
  const { run } = withStandards('# Standards\n## Exceptions\n- run1/05-security:R-1 — run1 — accepted risk, internal tool — approved: 2026-10-29 (CEO)\n');
  const r = contests(run);
  assert.equal(state(r, '05-security:R-1'), 'excepted');
  assert.deepEqual(r.excepted, ['05-security:R-1']);
  assert.deepEqual(r.unresolved, []);
  assert.deepEqual(r.warnings, []);
});

test('hostile Exceptions lines count for nothing: wrong section, no CEO mark, bad date, other key, fenced', () => {
  for (const text of [
    '## Notes\n- run1/05-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n',
    '## Exceptions\n- run1/05-security:R-1 — s — r — approved: 2026-10-29\n',
    '## Exceptions\n- run1/05-security:R-1 — s — r — approved: 2026-13-45 (CEO)\n',
    '## Exceptions\n- run1/06-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n',
    '## Exceptions\n- run1/05-security:R-10 — s — r — approved: 2026-10-29 (CEO)\n',
    '## Exceptions\n```\n- run1/05-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n```\n',
    '## Exceptions\n- 05-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n',
    '## Exceptions\n- run2/05-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n',
    '## Exceptions\n- RUN1/05-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n',
    '## Exceptions\n- ../run1/05-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n',
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
  put(run, '08-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-2 — why — evidence: src/a.mjs:1'] }));
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
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-1 — why — evidence: src/a.mjs:1'] }));
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

test('contracts: is required under a Role id byline; a v1.1 name byline still lints without it; a [nit] R-<n> row lints', () => {
  const none = handoff({ role: 'backend-engineer' }).replace('contracts: [handoff v1.2]\n', '');
  assert.match(lint(none).errors.join('\n'), /missing contracts/);
  assert.deepEqual(lint(none.replace('By: backend-engineer', 'By: Bo (backend-engineer)')).errors, []);
  assert.deepEqual(lint(none.replace('By: backend-engineer', 'By: Bo')).errors, []);
  const nit = n => handoff({ role: 'code-reviewer' }).replace('## Nits\n- none', `## Nits\n- ${n}`);
  assert.deepEqual(lint(nit('[nit] R-5 src/a.mjs:3 — vague name — rename')).errors, []);
  assert.match(lint(nit('[nit] src/a.mjs:3 — vague name — rename')).errors.join('\n'), /R-<n>/);
  assert.deepEqual(lint(nit('[open-decision] pick one')).errors, []);
});

test('single-file lint: contest lines must have their shape', () => {
  const bad = handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-1', 'R-1 — no NN'], contests: ['05-code-reviewer:R-1 maybe — x', '05-code-reviewer:R-1 accepted'] });
  assert.equal(lint(bad).errors.length, 4, lint(bad).errors.join('\n'));
  const good = handoff({ role: 'backend-engineer', contested: ['05-code-reviewer:R-1 — reason — evidence: src/a.mjs:1'], contests: ['05-code-reviewer:R-1 rejected — reason'] });
  assert.deepEqual(lint(good).errors, []);
});

test('contracts: frontmatter checks every cite against the index', () => {
  const index = new Map([['handoff', { major: 1, minor: 2 }], ['dispatch-prompt', { major: 4, minor: 0 }]]);
  const withContracts = v => handoff({ role: 'backend-engineer' }).replace('contracts: [handoff v1.2]\n', `contracts: ${v}\n`);
  assert.deepEqual(lint(withContracts('[handoff v1.2, dispatch-prompt v4]'), { index }).errors, []);
  assert.deepEqual(lint(withContracts('[handoff v1.1]'), { index }).errors, []);
  for (const v of ['[handoff v1.3]', '[handoff v2]', '[dispatch-prompt v3.6]', '[nosuch v1]', '[handoff]', '[handoff v1.2.3]', 'handoff v1', '[handoff v1,, ]']) {
    assert.ok(lint(withContracts(v), { index }).errors.length >= 1, v);
  }
  assert.deepEqual(lint(withContracts('[handoff v1.2]')).errors, []);
});

test('an unslugged exception line names no run: it closes nothing and prints one warning per key', () => {
  const { run } = withStandards('## Exceptions\n- 05-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n- 05-security:R-1 — again — r — approved: 2026-10-29 (CEO)\n');
  const r = contests(run);
  assert.equal(state(r, '05-security:R-1'), 'contested');
  assert.deepEqual(r.excepted, []);
  assert.deepEqual(r.warnings, ['warning: exception 05-security:R-1 names no run; not applied']);
  const out = spawnSync(process.execPath, [SCRIPT, '--contests', run], { encoding: 'utf8' });
  assert.match(out.stdout, /^warning: exception 05-security:R-1 names no run; not applied$/m);
});

test('an exception for run1 does not close the same key in another run folder', () => {
  const p = withStandards('## Exceptions\n- run1/05-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n');
  const run2 = join(p.root, '.company', 'work', 'run2');
  mkdirSync(run2);
  put(run2, '05-security.md', handoff({ role: 'security', blocking: [row('security', 1)] }));
  put(run2, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: ['05-security:R-1 — why — evidence: src/a.mjs:1'] }));
  assert.equal(state(contests(p.run), '05-security:R-1'), 'excepted');
  const r2 = contests(run2);
  assert.equal(state(r2, '05-security:R-1'), 'contested');
  assert.deepEqual(r2.excepted, []);
});

// ---- handoff v1.3: evidence, escalation, rulings, comprehension, fresh-reviewer lineages ----
const EV = 'src/a.mjs:1';
const key = '05-code-reviewer:R-2';
const NO_EVIDENCE = /has no checkable evidence/;
const ESC = `${key} — escalate — The CEO decided this API shape in the brief.`;

// A run folder where 05-code-reviewer holds R-2 and 06-backend-engineer carries `contested`.
function contested(lines, opts = {}) {
  const p = project();
  put(p.run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row(opts.tag ?? 'spec', 2, opts.extra)] }));
  put(p.run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: lines }));
  return p;
}

test('a contest without checkable evidence is an ERROR and does not count as the contest', () => {
  const bad = [
    `${key} — intentional`,
    `${key} — why — evidence: intentional`,
    `${key} — why — evidence: as designed`,
    `${key} — why — evidence: `,
    `${key} — why — evidence: /etc/passwd`,
    `${key} — why — evidence: C:\\Windows\\win.ini`,
    `${key} — why — evidence: ../outside.mjs`,
    `${key} — why — evidence: src/../src/a.mjs`,
    `${key} — why — evidence: src`,
    `${key} — why — evidence: src/`,
    `${key} — why — evidence: src/missing.mjs`,
    `${key} — why — evidence: src/a.mjs:99`,
    `${key} — why — evidence: src/a.mjs:4-2`,
    `${key} — why — evidence: src/a.mjs:0`,
    `${key} — why — evidence: src/a.test.mjs#no such test`,
    `${key} — why — evidence: src/a.test.mjs#`,
    `${key} — why — evidence: src/a.mjs#a#b`,
    `${key} — why — evidence: https://example.com/a.mjs`,
    `${key} — why — evidence: src/a.mjs:1; src/a.mjs:2; src/a.mjs:3; src/a.mjs:4`,
    `${key} — why — evidence: src/a.mjs;;src/a.mjs`,
    `${key} — why — evidence: src/*.mjs`,
    `${key} — why — evidence: .git/config`,
    `${key} — why — evidence: .env`,
  ];
  for (const line of bad) {
    const { run } = contested([line]);
    const r = contests(run);
    assert.equal(r.errors.length, 1, line);
    assert.match(r.errors[0], NO_EVIDENCE, line);
    assert.match(r.errors[0], /^06-backend-engineer\.md line \d+: contest of 05-code-reviewer:R-2 /, line);
    assert.equal(state(r, key), 'open', line);
  }
});

test('a contest with a real file, a line range or a test name counts as the contest', () => {
  for (const ref of ['src/a.mjs', 'src/a.mjs:3', 'src/a.mjs:2-4', 'src/a.test.mjs#keeps the order', 'src/a.mjs:1; src/a.test.mjs#keeps the order', 'src/a.mjs:5;src/a.mjs:1-5; src/a.mjs']) {
    const { run } = contested([`${key} — the spec allows it — evidence: ${ref}`]);
    const r = contests(run);
    assert.deepEqual(r.errors, [], ref);
    assert.equal(state(r, key), 'contested', ref);
    assert.deepEqual(r.unresolved, [key], ref);
  }
});

test('evidence that is a link, a junction path or a hard link is refused, never read through', async t => {
  await t.test('junction into the run folder', ctx => {
    const { root, run } = contested([`${key} — why — evidence: src/hop/05-code-reviewer.md`]);
    try { symlinkSync(run, join(root, 'src', 'hop'), process.platform === 'win32' ? 'junction' : 'dir'); } catch { return ctx.skip('no links here'); }
    const r = contests(run);
    assert.match(r.errors.join('\n'), NO_EVIDENCE);
    assert.equal(state(r, key), 'open');
  });
  await t.test('file symlink', ctx => {
    const { root, run } = contested([`${key} — why — evidence: src/b.mjs`]);
    try { symlinkSync(join(root, 'src', 'a.mjs'), join(root, 'src', 'b.mjs')); } catch { return ctx.skip('no file symlinks here'); }
    assert.match(contests(run).errors.join('\n'), NO_EVIDENCE);
  });
  await t.test('hard link', () => {
    const { root, run } = contested([`${key} — why — evidence: src/c.mjs`]);
    linkSync(join(root, 'src', 'a.mjs'), join(root, 'src', 'c.mjs'));
    assert.match(contests(run).errors.join('\n'), NO_EVIDENCE);
  });
  await t.test('over 1 MiB', () => {
    const { root, run } = contested([`${key} — why — evidence: src/big.mjs`]);
    writeFileSync(join(root, 'src', 'big.mjs'), 'x'.repeat(1024 * 1024 + 1));
    assert.match(contests(run).errors.join('\n'), NO_EVIDENCE);
  });
  await t.test('a run folder not shaped .company/work/<slug> can check no evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'contest-'));
    roots.push(root);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.mjs'), 'one\n');
    const run = join(root, 'elsewhere');
    mkdirSync(run);
    put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 2)] }));
    put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: [`${key} — why — evidence: src/a.mjs`] }));
    assert.match(contests(run).errors.join('\n'), NO_EVIDENCE);
  });
});

test('escalate: the finding is escalated and blocking, and the raising Role cannot close it', () => {
  const { run } = contested([ESC]);
  let r = contests(run);
  assert.deepEqual(r.errors, []);
  assert.equal(state(r, key), 'escalated');
  put(run, '07-code-reviewer.md', handoff({ role: 'code-reviewer', round: 1, contests: [`${key} accepted — fine`] }));
  r = contests(run);
  assert.equal(r.errors.length, 1);
  assert.equal(state(r, key), 'escalated');
  const out = spawnSync(process.execPath, [SCRIPT, '--contests', run], { encoding: 'utf8' });
  assert.match(out.stdout, /^escalated 05-code-reviewer:R-2$/m);
  assert.ok(out.stdout.indexOf('state ') < out.stdout.indexOf('escalated 05'));
  for (const short of ['no', 'x'.repeat(19), 'x'.repeat(501)]) {
    const s = contested([`${key} — escalate — ${short}`]);
    const sr = contests(s.run);
    assert.equal(sr.errors.length, 1, short);
    assert.equal(state(sr, key), 'open', short);
  }
});

const rulings = lines => `# Rulings\n## Rulings\n${lines.join('\n')}\n`;
const ruling = (verb, date = '2026-10-29', k = key) => `- ${k} — ${verb} — the CEO answered at the Gate — ruled: ${date} (CEO)`;

test('rulings.md: overruled closes, upheld stays blocking and refuses a second contest; the last line counts', () => {
  const { run } = contested([ESC]);
  const file = join(run, 'rulings.md');
  writeFileSync(file, rulings([ruling('overruled')]));
  let r = contests(run);
  assert.equal(state(r, key), 'overruled');
  assert.deepEqual(r.errors, []);
  const out = spawnSync(process.execPath, [SCRIPT, '--contests', run], { encoding: 'utf8' });
  assert.match(out.stdout, /^ruled 05-code-reviewer:R-2 overruled$/m);
  writeFileSync(file, rulings([ruling('overruled'), ruling('upheld')]));
  assert.equal(state(contests(run), key), 'upheld');
  writeFileSync(file, rulings([ruling('upheld'), ruling('overruled')]));
  assert.equal(state(contests(run), key), 'overruled');
  writeFileSync(file, rulings([ruling('upheld')]));
  put(run, '08-backend-engineer.md', handoff({ role: 'backend-engineer', round: 1, contested: [`${key} — again — evidence: ${EV}`] }));
  r = contests(run);
  assert.equal(state(r, key), 'upheld');
  assert.match(r.errors.join('\n'), /second contest/);
});

test('rulings.md: hostile lines count for nothing', () => {
  const lines = [
    ruling('overruled', '2026-13-01'),
    ruling('overruled').replace('(CEO)', '(Lead)'),
    ruling('overruled').replace(' — ruled:', ' — approved:'),
    ruling('overruled', '2026-10-29', '05-code-reviewer:R-20'),
    ruling('closed'),
    `${ruling('overruled')} extra`,
  ];
  for (const l of lines) {
    const { run } = contested([ESC]);
    writeFileSync(join(run, 'rulings.md'), rulings([l]));
    assert.equal(state(contests(run), key), 'escalated', l);
  }
  const wrongSection = contested([ESC]);
  writeFileSync(join(wrongSection.run, 'rulings.md'), `## Notes\n${ruling('overruled')}\n`);
  assert.equal(state(contests(wrongSection.run), key), 'escalated');
  const fenced = contested([ESC]);
  writeFileSync(join(fenced.run, 'rulings.md'), `## Rulings\n\`\`\`\n${ruling('overruled')}\n\`\`\`\n`);
  assert.equal(state(contests(fenced.run), key), 'escalated');
  const notEscalated = contested([`${key} — why — evidence: ${EV}`]);
  writeFileSync(join(notEscalated.run, 'rulings.md'), rulings([ruling('overruled')]));
  assert.equal(state(contests(notEscalated.run), key), 'contested');
});

test('rulings.md: a hard link, a link or an oversize file is not read', async t => {
  const big = contested([ESC]);
  writeFileSync(join(big.run, 'rulings.md'), rulings([ruling('overruled')]) + 'x'.repeat(64 * 1024));
  assert.equal(state(contests(big.run), key), 'escalated');
  const hard = contested([ESC]);
  writeFileSync(join(hard.root, 'real-rulings.md'), rulings([ruling('overruled')]));
  linkSync(join(hard.root, 'real-rulings.md'), join(hard.run, 'rulings.md'));
  const r = contests(hard.run);
  assert.equal(state(r, key), 'escalated');
  assert.equal(r.warnings.length, 1);
  await t.test('symlink', ctx => {
    const p = contested([ESC]);
    writeFileSync(join(p.root, 'real-rulings.md'), rulings([ruling('overruled')]));
    try { symlinkSync(join(p.root, 'real-rulings.md'), join(p.run, 'rulings.md')); } catch { return ctx.skip('no file symlinks here'); }
    assert.equal(state(contests(p.run), key), 'escalated');
  });
  await t.test('the run folder reached through a junction', ctx => {
    const p = contested([ESC]);
    writeFileSync(join(p.run, 'rulings.md'), rulings([ruling('overruled')]));
    const hop = join(p.root, 'hop');
    mkdirSync(hop);
    try { symlinkSync(join(p.root, '.company'), join(hop, '.company'), process.platform === 'win32' ? 'junction' : 'dir'); } catch { return ctx.skip('no links here'); }
    assert.equal(state(contests(join(hop, '.company', 'work', 'run1')), key), 'escalated');
  });
});

test('a ruling on a security lineage is an ERROR and the finding stays blocking', () => {
  const sec = '06-security:R-2';
  const p = project();
  put(p.run, '06-security.md', handoff({ role: 'security', blocking: [row('security', 2)] }));
  put(p.run, '07-backend-engineer.md', handoff({ role: 'backend-engineer', contested: [`${sec} — escalate — The CEO decided this API shape in the brief.`] }));
  writeFileSync(join(p.run, 'rulings.md'), rulings([ruling('overruled', '2026-10-29', sec)]));
  const r = contests(p.run);
  assert.equal(state(r, sec), 'escalated');
  assert.match(r.errors.join('\n'), /security/);

  const rowCite = contested([ESC], { extra: 'breaks node.M-SEC2' });
  writeFileSync(join(rowCite.run, 'rulings.md'), rulings([ruling('overruled')]));
  const r2 = contests(rowCite.run);
  assert.equal(state(r2, key), 'escalated');
  assert.equal(r2.errors.length, 1);
  writeFileSync(join(rowCite.run, 'rulings.md'), rulings([ruling('upheld')]));
  assert.equal(state(contests(rowCite.run), key), 'upheld');
});

const compRow = n => `[comprehension] R-${n} plan.md:3 — the paraphrase differs from the stated intent — change the text`;
function fresh({ mode = 'plan', round = 0, status = 'done', blocking = [], nn = 3 } = {}) {
  const paraphrase = 'The plan adds a lint rule so a contest needs evidence that a reviewer can open, and a ruling file for the CEO answers. It keeps security findings open until a fix.';
  const list = (h, a) => `## ${h}\n${a.length ? a.map(l => `- ${l}`).join('\n') : '- none'}\n`;
  return `---\nstep: ${String(nn).padStart(2, '0')}\nrole: fresh-reviewer\ntask: run1\nstatus: ${status}\nround: ${round}\nbase-commit: 0123456789abcdef0123456789abcdef01234567\nrisk-tier: high\nreview-mode: ${mode}\ncontracts: [handoff v1.3]\n---\nBy: fresh-reviewer\n## Paraphrase\n${paraphrase}\n## First pass\n- none\n## Did\n- read\n${list('Decisions', [])}${list('Blocking', blocking)}${list('Contested', [])}${list('Contests', [])}## Nits\n- none\n## Next\n- go\n`;
}

test('a comprehension finding cannot be contested or escalated; the text changes instead', () => {
  const k = '03-fresh-reviewer:R-1';
  for (const line of [`${k} — why — evidence: ${EV}`, `${k} — escalate — The CEO decided this API shape in the brief.`, `${k} — intentional`]) {
    const { run } = project();
    put(run, '03-fresh-reviewer.md', fresh({ blocking: [compRow(1)] }));
    put(run, '04-architect.md', handoff({ role: 'architect', contested: [line] }));
    const r = contests(run);
    assert.equal(r.errors.length, 1, line);
    assert.match(r.errors[0], /comprehension finding 03-fresh-reviewer:R-1 cannot be contested; change the text/, line);
    assert.equal(state(r, k), 'open', line);
  }
});

test('a comprehension tag from any Role but fresh-reviewer is an ERROR in lint and in the run folder, and it does not make a finding uncontestable', () => {
  const text = handoff({ role: 'code-reviewer', blocking: [compRow(2)] });
  assert.match(lint(text).errors.join('\n'), /line \d+: comprehension tag is for fresh-reviewer only/);
  const { run } = project();
  put(run, '05-code-reviewer.md', text);
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: [`${key} — why — evidence: ${EV}`] }));
  const r = contests(run);
  assert.match(r.errors.join('\n'), /comprehension tag is for fresh-reviewer only/);
  assert.equal(state(r, key), 'contested');
});

test('plan-mode and code-mode R-1 of the fresh reviewer are two lineages', () => {
  const { run } = project();
  put(run, '03-fresh-reviewer.md', fresh({ mode: 'plan', blocking: [row('spec', 1)] }));
  put(run, '09-fresh-reviewer.md', fresh({ mode: 'code', nn: 9, blocking: [row('spec', 1)] }));
  put(run, '10-backend-engineer.md', handoff({ role: 'backend-engineer', contested: [`09-fresh-reviewer:R-1 — why — evidence: ${EV}`] }));
  let r = contests(run);
  assert.deepEqual(r.errors, []);
  assert.deepEqual([...r.states.keys()].sort(), ['03-fresh-reviewer:R-1', '09-fresh-reviewer:R-1']);
  assert.equal(state(r, '03-fresh-reviewer:R-1'), 'open');
  assert.equal(state(r, '09-fresh-reviewer:R-1'), 'contested');
  put(run, '11-fresh-reviewer.md', fresh({ mode: 'code', nn: 11, round: 1 }));
  r = contests(run);
  assert.equal(state(r, '09-fresh-reviewer:R-1'), 'fixed');
  assert.equal(state(r, '03-fresh-reviewer:R-1'), 'open');
  put(run, '12-fresh-reviewer.md', fresh({ mode: 'plan', nn: 12, round: 1 }));
  assert.equal(state(contests(run), '03-fresh-reviewer:R-1'), 'fixed');
});

test('the fresh reviewer is a reviewer Role: it cannot contest and its rows need R-<n>', () => {
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 2)] }));
  put(run, '06-fresh-reviewer.md', fresh({ nn: 6, mode: 'code' }).replace('## Contested\n- none', `## Contested\n- ${key} — why — evidence: ${EV}`));
  const r = contests(run);
  assert.match(r.errors.join('\n'), /contested by a builder, not by a reviewer/);
  assert.equal(state(r, key), 'open');
  const noId = fresh({ mode: 'code' }).replace('## Blocking\n- none', '## Blocking\n- [spec] src/a.mjs:3 — problem — fix');
  assert.match(lint(noId).errors.join('\n'), /R-<n>/);
});

test('exceptions: a slugged line counts only for its run, on or after the run start', () => {
  const sec = date => `## Exceptions\n- run1/05-security:R-1 — s — r — approved: ${date} (CEO)\n`;
  assert.equal(state(contests(withStandards(sec('2026-10-29')).run), '05-security:R-1'), 'excepted');
  assert.equal(state(contests(withStandards(sec('2026-11-02')).run), '05-security:R-1'), 'excepted');
  const old = withStandards(sec('2026-10-28'));
  assert.equal(state(contests(old.run), '05-security:R-1'), 'contested');
  assert.deepEqual(contests(old.run).warnings, []);
  // The slug was used before: only the latest start counts.
  const reuse = withStandards(sec('2026-09-15'));
  writeFileSync(join(reuse.run, 'run-state.jsonl'), [
    '{"v":1,"at":"2026-09-01T08:00:00Z","ev":"start"}',
    '{"v":1,"at":"2026-09-02T08:00:00Z","ev":"end","outcome":"ship"}',
    '{"v":1,"at":"2026-10-29T08:00:00Z","ev":"start"}', ''].join('\n'));
  assert.equal(state(contests(reuse.run), '05-security:R-1'), 'contested');
});

test('exceptions: no record, an unreadable record or no start applies none and warns once', () => {
  const sec = '## Exceptions\n- run1/05-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n';
  for (const rec of [null, 'not json\n', '{"v":1,"at":"2026-10-29T08:00:00Z","ev":"end","outcome":"ship"}\n']) {
    const p = withStandards(sec);
    if (rec === null) rmSync(join(p.run, 'run-state.jsonl')); else writeFileSync(join(p.run, 'run-state.jsonl'), rec);
    const r = contests(p.run);
    assert.equal(state(r, '05-security:R-1'), 'contested', String(rec));
    assert.deepEqual(r.warnings, ['warning: run run1 has no start; no exceptions applied'], String(rec));
  }
});

test('exceptions: a run folder with capitals, or a line with capitals, is not applied', () => {
  const root = mkdtempSync(join(tmpdir(), 'contest-'));
  roots.push(root);
  const run = join(root, '.company', 'work', 'RUN1');
  mkdirSync(run, { recursive: true });
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.mjs'), 'one\n');
  writeFileSync(join(run, 'run-state.jsonl'), '{"v":1,"at":"2026-10-29T08:00:00Z","ev":"start"}\n');
  put(run, '05-security.md', handoff({ role: 'security', blocking: [row('security', 1)] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: [`05-security:R-1 — why — evidence: ${EV}`] }));
  for (const slug of ['RUN1', 'run1']) {
    writeFileSync(join(root, '.company', 'standards.md'), `## Exceptions\n- ${slug}/05-security:R-1 — s — r — approved: 2026-10-29 (CEO)\n`);
    const r = contests(run);
    assert.equal(r.states.get('05-security:R-1'), 'contested', slug);
    assert.deepEqual(r.excepted, [], slug);
  }
});

test('--exceptions-for counts the lines of one slug with any date', () => {
  const p = project();
  const std = [
    '## Exceptions',
    '- run1/05-security:R-1 — s — r — approved: 2020-01-01 (CEO)',
    '- run1/06-security:R-2 — s — r — approved: 2026-10-29 (CEO)',
    '- run2/05-security:R-1 — s — r — approved: 2026-10-29 (CEO)',
    '- 05-security:R-1 — s — r — approved: 2026-10-29 (CEO)',
    '- run1/05-security:R-3 — s — r — approved: 2026-13-01 (CEO)',
    '## Notes',
    '- run1/05-security:R-4 — s — r — approved: 2026-10-29 (CEO)', ''].join('\n');
  const call = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  assert.equal(call(p.root, '--exceptions-for', 'run1').stdout, 'exceptions on file: 0\n');
  writeFileSync(join(p.root, '.company', 'standards.md'), std);
  const r = call(p.root, '--exceptions-for', 'run1');
  assert.equal(r.stdout, 'exceptions on file: 2\n');
  assert.equal(r.status, 0);
  assert.equal(call(p.root, '--exceptions-for', 'run3').stdout, 'exceptions on file: 0\n');
  for (const bad of ['RUN1', '../x', 'a b', '']) assert.equal(call(p.root, '--exceptions-for', bad).status, 2, bad);
  assert.equal(call(p.root, '--exceptions-for').status, 2);
  rmSync(join(p.root, '.company', 'standards.md'));
  mkdirSync(join(p.root, '.company', 'standards.md'));
  assert.equal(call(p.root, '--exceptions-for', 'run1').status, 1);
});

test('parseLocations reads the row shapes of real reviewer rows', () => {
  assert.deepEqual(parseLocations('[spec] R-1 CHANGELOG.md:10-13, documentation/concepts.md:72,78 — problem — fix'), [
    { path: 'CHANGELOG.md', from: 10, to: 13 },
    { path: 'documentation/concepts.md', from: 72, to: 72 },
    { path: 'documentation/concepts.md', from: 78, to: 78 },
  ]);
  assert.deepEqual(parseLocations('[test] R-2 scripts/check.mjs:106 and :808-809 — problem — fix'), [
    { path: 'scripts/check.mjs', from: 106, to: 106 },
    { path: 'scripts/check.mjs', from: 808, to: 809 },
  ]);
  assert.deepEqual(parseLocations('[spec] R-3 docs/contracts/handoff.md — whole file — fix'), [{ path: 'docs/contracts/handoff.md', from: null, to: null }]);
  assert.deepEqual(parseLocations('R-4 | scripts/x.mjs:12-14 | problem | why | fix'), [{ path: 'scripts/x.mjs', from: 12, to: 14 }]);
  assert.deepEqual(parseLocations('[spec] R-5 a.mjs:3, b.mjs:4-5 — x:9 — y'), [
    { path: 'a.mjs', from: 3, to: 3 },
    { path: 'b.mjs', from: 4, to: 5 },
  ]);
  assert.deepEqual(parseLocations('[spec] R-6 no location here — x — y'), []);
  assert.deepEqual(parseLocations(':12 first — x'), []);
  assert.deepEqual(parseLocations(''), []);
});

test('parseLocations stays linear on a 1 MiB hostile line', () => {
  const lines = ['a.mjs:1,'.repeat(131072), ':1-'.repeat(349525), 'a'.repeat(1024 * 1024), `${'x.y,'.repeat(262144)} — z`, 'a.mjs:'.repeat(174762), `${' '.repeat(1024 * 1024)}a.mjs:1`];
  const t0 = process.hrtime.bigint();
  for (const l of lines) assert.ok(Array.isArray(parseLocations(l)));
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 2000);
});

test('a 1 MiB hostile contest line stays linear and is skipped', () => {
  const { run } = project();
  put(run, '05-code-reviewer.md', handoff({ role: 'code-reviewer', blocking: [row('spec', 2)] }));
  put(run, '06-backend-engineer.md', handoff({ role: 'backend-engineer', contested: [`${key} — ${'a — evidence: '.repeat(70000)}`] }));
  const t0 = process.hrtime.bigint();
  const r = contests(run);
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 2000);
  assert.equal(state(r, key), 'open');
});

test('the evidence path rule accepts and refuses exactly what the plan-tasks path rule does', async () => {
  const { normalizePath } = await import('./plan-tasks.mjs');
  const { evidencePath } = await import('./handoff-lint.mjs');
  const long = `${'a'.repeat(100)}/${'b'.repeat(101)}.mjs`;
  for (const p of [
    'src/a.mjs', 'src/', 'src', 'a.b/c-d_e/f+g@h.mjs', 'src\\a.mjs', '/etc/passwd', 'C:/x', 'c:x', '../x', 'a/../b', './a', 'a//b', 'a/*.mjs',
    'a/b?.mjs', 'a/[x].mjs', '{a}', '.git/config', '.GIT./x', '.env', 'a/.env.local', 'con', 'NUL.txt', 'com1.tar.gz', 'a/lpt9', 'a/b.', 'a/b ', '-x',
    'a/-b', 'a b', 'ünï.mjs', '', '.', 'a\u0000b', long, 'x'.repeat(201), 'x'.repeat(200),
  ]) {
    const a = normalizePath(p);
    const b = evidencePath(p);
    assert.equal(b.ok, a.ok, JSON.stringify(p));
    if (a.ok) { assert.equal(b.path, a.path, p); assert.equal(b.dir, a.dir, p); }
  }
  assert.equal(evidencePath(7).ok, false);
});
