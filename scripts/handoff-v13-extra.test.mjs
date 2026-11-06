import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from './handoff-lint.mjs';

const SCRIPT = fileURLToPath(new URL('./handoff-lint.mjs', import.meta.url));
const read = rel => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const PARAPHRASE = 'The plan adds a lint rule so a contest needs evidence that a reviewer can open, and a ruling file for the CEO answers. It keeps security findings open until a fix. A comprehension gap is a Blocking row.';

// A Handoff of any Role; `fm` adds frontmatter lines, `head` goes right after the By line, `body` between Did and Next.
function handoff({ role = 'backend-engineer', fm = '', head = '', sections = {}, blocking = '- none' } = {}) {
  const extra = Object.entries(sections).map(([h, lines]) => `## ${h}\n${lines.join('\n')}\n`).join('');
  return `---\nstep: 05\nrole: ${role}\ntask: t\nstatus: done\nround: 0\nbase-commit: 0123456789abcdef0123456789abcdef01234567\nrisk-tier: high\ncontracts: [handoff v2.0]\n${fm}---\nBy: ${role}\n${head}## Did\n- work\n## Decisions\n- none\n## Blocking\n${blocking}\n## Nits\n- none\n${extra}## Next\n- go\n`;
}
const fresh = ({ mode = 'code', model, blocking } = {}) => handoff({
  role: 'fresh-reviewer',
  fm: `review-mode: ${mode}\n${model === undefined ? '' : `model: ${model}\n`}`,
  head: `## Paraphrase\n${PARAPHRASE}\n## First pass\n- none\n`,
  blocking,
});
const errs = (text, opts) => lint(text, opts).errors.join('\n');

test('model: is required on a code-mode fresh-reviewer Handoff and refused everywhere else', () => {
  assert.match(errs(fresh({ mode: 'code' })), /missing model/);
  assert.deepEqual(lint(fresh({ mode: 'code', model: 'opus' })).errors, []);
  assert.match(errs(fresh({ mode: 'code', model: 'gpt-5' })), /line 11: model must be opus\|sonnet\|haiku\|fable/);
  assert.match(errs(fresh({ mode: 'plan', model: 'opus' })), /line 11: model key is for fresh-reviewer code mode only/);
  assert.match(errs(handoff({ role: 'code-reviewer', fm: 'model: opus\n' })), /line 10: model key is for fresh-reviewer code mode only/);
  assert.match(errs(handoff({ fm: 'model: sonnet\n' })), /model key is for fresh-reviewer code mode only/);
  assert.deepEqual(lint(handoff()).errors, []);
});

test('model: below the code-reviewer floor, or unranked, warns and never errors', () => {
  assert.deepEqual(lint(fresh({ model: 'opus' })).warnings, []);
  for (const m of ['sonnet', 'haiku', 'fable']) {
    const r = lint(fresh({ model: m }));
    assert.deepEqual(r.errors, [], m);
    assert.deepEqual(r.warnings, [`warning line 11: model ${m} below the code-reviewer floor`], m);
  }
});

test('the command line prints the warning and still exits 0 with the routing JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v13-'));
  try {
    const file = join(dir, '05-fresh-reviewer.md');
    writeFileSync(file, fresh({ model: 'haiku' }));
    const out = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stdout);
    const lines = out.stdout.trim().split('\n');
    assert.equal(lines[0], 'warning line 11: model haiku below the code-reviewer floor');
    assert.equal(JSON.parse(lines[1]).status, 'done');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const SRC = {
  report: '- [S1] .company/research/market.md — report 2026-09-30 — research-report',
  undated: '- [S2] .company/research/old.md — report undated — research-report',
  web: '- [S3] Node docs — https://nodejs.org/api/fs.html — checked 2026-10-29 — primary',
};

test('a research-report source needs its date, or the word undated', () => {
  const sources = lines => handoff({ sections: { Sources: lines } });
  assert.deepEqual(lint(sources([SRC.report, SRC.undated, SRC.web])).errors, []);
  for (const bad of [
    '- [S1] .company/research/market.md — research-report',
    '- [S1] .company/research/market.md — report — research-report',
    '- [S1] .company/research/market.md — report 2026-13-45 — research-report',
    '- [S1] .company/research/market.md — report 30-09-2026 — research-report',
  ]) assert.match(errs(sources([bad])), /line \d+: research report source needs its date/, bad);
});

test('a claim that rests only on a research report ends with (unverified)', () => {
  const only = 'The market is closed [S1] — fix the brief';
  const rule = /claim rests only on an earlier research report; re-check it or mark \(unverified\)/;
  const row = text => handoff({ sections: { Sources: [SRC.report, SRC.undated, SRC.web] }, blocking: `- [spec] ${text}` });
  assert.match(errs(row(only)), rule);
  assert.deepEqual(lint(row(`${only} (unverified)`)).errors, []);
  assert.deepEqual(lint(row('The market is closed [S1][S3] — fix the brief')).errors, []);
  assert.deepEqual(lint(row('The market is closed [S3] — fix the brief')).errors, []);
  assert.match(errs(row('Both are old [S1][S2] — fix the brief')), rule);
  const decision = text => handoff({ sections: { Sources: [SRC.report], Decisions: [`- ${text}`] } }).replace('## Decisions\n- none\n', '');
  assert.match(errs(decision('Ship it [S1]')), rule);
  assert.deepEqual(lint(decision('Ship it [S1] (unverified)')).errors, []);
  assert.deepEqual(lint(handoff({ blocking: `- [spec] ${only}` })).errors, []);
  assert.deepEqual(lint(handoff({ sections: { Sources: [SRC.web] }, blocking: `- [spec] ${only}` })).errors, []);
});

const pm = sections => handoff({ role: 'product-manager', sections });
const GL = '- Run folder — the folder under .company/work that holds the Handoffs of one run';
const ADR = '- contest-evidence — a contest needs evidence a reviewer can open — why: a bare assertion closed findings';

test('product-manager ## Glossary and ## ADR drafts have a line shape', () => {
  assert.deepEqual(lint(pm({ Glossary: [GL], 'ADR drafts': [ADR] })).errors, []);
  for (const bad of ['- Run folder without a definition', '- Run folder — short', `- ${'t'.repeat(61)} — a definition that is long enough`, '- — a definition that is long enough', 'prose line', `- Run — ${'d'.repeat(301)}`]) {
    assert.match(errs(pm({ Glossary: [bad] })), /line \d+: Glossary line shape/, bad);
  }
  for (const bad of [
    '- Contest-Evidence — a contest needs evidence a reviewer can open — why: a bare assertion closed findings',
    '- contest-evidence — short — why: a bare assertion closed findings',
    '- contest-evidence — a contest needs evidence a reviewer can open',
    '- contest-evidence — a contest needs evidence a reviewer can open — why: short',
    `- ${'s'.repeat(52)} — a contest needs evidence a reviewer can open — why: a bare assertion closed findings`,
    'prose line',
  ]) assert.match(errs(pm({ 'ADR drafts': [bad] })), /line \d+: ADR drafts line shape/, bad);
});

test('## Glossary, ## ADR drafts and ## Prototype question are for the product manager and come before ## Next', () => {
  for (const role of ['architect', 'backend-engineer', 'code-reviewer']) {
    const text = handoff({ role, sections: { Glossary: [GL], 'ADR drafts': [ADR] } });
    assert.match(errs(text), /ADR drafts is for product-manager only/, role);
    assert.match(errs(text), /Glossary is for product-manager only/, role);
  }
  const late = pm({ Glossary: [GL] }).replace('## Next\n- go\n', '').replace('## Glossary', '## Next\n- go\n## Glossary');
  assert.match(errs(late), /Glossary must come before ## Next/);
  assert.deepEqual(lint(pm({ 'Prototype question': ['Does a worktree per task keep sibling files intact?'] })).errors, []);
  assert.match(errs(pm({ 'Prototype question': ['too short'] })), /Prototype question line shape/);
  assert.match(errs(pm({ 'Prototype question': ['Does a worktree per task keep sibling files intact?', 'And a second line?'] })), /Prototype question line shape/);
  assert.match(errs(handoff({ sections: { 'Prototype question': ['Does a worktree per task keep sibling files intact?'] } })), /Prototype question is for product-manager only/);
});

test('the Handoff skill states the Worktree rule in the Task and Files step', () => {
  const skill = read('skills/handoff/SKILL.md');
  const rule = skill.split('\n').find(l => l.startsWith('6. '));
  assert.ok(rule, 'rule 6 exists');
  assert.match(rule, /`Worktree: <path>`/);
  assert.match(rule, /git -C <path>/);
  assert.match(rule, /absolute paths/);
  assert.match(rule, /never `cd`/);
  assert.match(rule, /Set-Location/);
  assert.match(rule, /never `git stash`/);
  assert.match(rule, /main tree/);
  assert.ok(skill.split('\n').length <= 125);
  assert.ok(!/^Name:/m.test(skill));
});

test('the Contract and the skill texts name the v2.0 parts', () => {
  const contract = read('docs/contracts/handoff.md');
  assert.match(contract, /^# Contract: handoff v2.3$/m);
  for (const part of ['[comprehension]', '## Paraphrase', '## First pass', 'evidence:', 'rulings.md', 'escalated', 'upheld', 'overruled', 'parseLocations', '--exceptions-for', 'review-mode', 'real-path read rule']) {
    assert.ok(contract.includes(part), part);
  }
  const lead = read('skills/pipeline/references/contest.md');
  assert.ok(lead.includes('rulings on file: confirm each is yours'));
  assert.match(lead, /not mine/i);
  const ruleset = read('skills/ruleset/SKILL.md');
  assert.ok(ruleset.includes('<slug>/<NN>-<role>:R-<n> — <scope> — <reason> — approved: <date> (CEO)'));
  for (const f of ['skills/handoff/references/contest.md', 'skills/pipeline/references/contest.md', 'skills/handoff/SKILL.md', 'skills/ruleset/SKILL.md']) {
    assert.ok(!/^Name:/m.test(read(f)), f);
    assert.ok(!read(f).includes('\r'), f);
  }
});
