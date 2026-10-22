import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Contract tests for the prose Playbooks. A skill file is the public interface of a Playbook,
// so these pin the rules each Playbook states.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const skill = (n) => read(`skills/${n}/SKILL.md`);
const has = (text, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(text) : text.includes(n), `missing: ${n}`);
};
const idx = (text, s) => { const i = text.indexOf(s); assert.ok(i >= 0, `missing: ${s}`); return i; };

const research = skill('research');

test('AC1 research shows one scope form with Approve / Change / Stop before any dispatch', () => {
  has(research, 'Nothing is dispatched before this is approved', 'Approve (Recommended) / Change / Stop');
  assert.ok(idx(research, '## 2. Scope form') < idx(research, '## 3. Researchers'));
});

test('AC2 researchers go out in parallel in one message and the tree is checked afterwards', () => {
  has(research, 'in parallel, in one message', '`.company/work/research-<slug>/NN-<role>.md`', 'git status --porcelain',
    'only under `.company/research/`');
  assert.ok(idx(research, '## 3. Researchers') < idx(research, '## 5. Check the tree'));
});

test('AC3 report contract has the six headings in order and the research Playbook checks them', () => {
  const rr = read('docs/contracts/research-report.md');
  const order = ['## Verdict', '## What to do', '## Low-hanging fruit', '## Risks', '## Open questions', '## Sources'];
  const block = rr.slice(rr.indexOf('```markdown'));
  let last = -1;
  for (const h of order) { const i = block.indexOf(`\n${h}\n`); assert.ok(i > last, `heading order: ${h}`); last = i; }
  has(rr, 'go | go-with-conditions | no-go', 'impact/effort', 'effort: S|M|L');
  has(research, 'six RR headings in order');
});

test('AC4 every claim has a dated source, unverified claims cannot back a verdict, blog/ai never sole blocker source', () => {
  const s = skill('sourcing');
  has(s, 'checked YYYY-MM-DD', '(unverified)', 'may not back a verdict', 'A blocker never rests only on `blog` or `ai`');
  has(read('docs/contracts/research-report.md'), 'may not back the Verdict');
});

test('AC5 pick form offers Start / Brainstorm / Roadmap / Park; only the report is committed, never pushed', () => {
  has(research, 'Start `/aico:feature` / Brainstorm / Roadmap / Park', 'Nothing starts without the pick',
    'Commit **only the report**', 'Never `git add -A`', 'Never push');
  has(research, "git add '<report path>' && git commit -m 'docs: research <Short Topic>'", 'RR `## Short Topic` rule', 'in single quotes');
  assert.ok(!research.includes('git commit -m "'), 'the commit summary is never double-quoted');
  assert.ok(idx(research, '## 6. Pick') < idx(research, '## 8. Commit'));
});

test('AC6 quick caps fetches at 10; deep needs 3 independent primary sources', () => {
  has(research, 'at most 10 web fetches per researcher', 'at least 3 independent primary sources');
  has(skill('sourcing'), 'at most 10 web fetches', 'at least 3 independent primary sources');
});

test('AC7 research group holds find-skills with license and vetted, core includes it; mattpocock research via plugin', () => {
  const m = JSON.parse(read('deps/skills.json'));
  assert.ok(m.core.some((e) => e.include === 'research'));
  assert.ok(Array.isArray(m.research) && m.research.length >= 1);
  for (const e of m.research) {
    assert.ok(e.license && e.vetted, `research entry ${e.name} needs license and vetted`);
    assert.ok(!/api[-_ ]?key/i.test(JSON.stringify(e)));
  }
  assert.ok(m.research.some((e) => e.name === 'find-skills'));
  has(research, 'mattpocock-skills:research', 'anthropic-skills:deep-research', 'optional, never shown');
});

test('AC8 missing skills: dry-run commands, one Install / Skip form, Skip records degraded', () => {
  has(research, '--dry-run', 'Install (Recommended) / Skip', 'degraded: missing', 'Nothing installs without this form',
    'Never run `npx skills find`');
});

test('AC9 lead routes research, triage has type research, brainstorm accepts a research file and closes with "Research it first", feature gets only Step 1a', () => {
  has(skill('lead'), 'research a topic online', '`aico:research`', 'aico:market-researcher', 'aico:tech-researcher', 'aico:design-researcher');
  has(skill('triage'), 'research (find out online first', 'research → `aico:research`');
  const b = skill('brainstorm');
  has(b, '`.company/research/` file', '**Research it first**', 'keep `status: open`', '**Set aside**');
  has(skill('feature'), '1a. Design skills', '180 days');
});

test('AC12/AC13 the /aico:language Playbook only calls the CLI, validates args first, and covers set/clear/project', () => {
  const l = skill('language');
  has(l, 'disable-model-invocation: true', 'Never edit `config.json` or `.company/project.md` yourself',
    '[A-Za-z0-9-]{1,35}', 'set <tag>', 'clear', 'project', 'Exit 2', 'nothing was changed');
});

test('AC14 pipeline resolves the language once and the dispatch block carries Language:', () => {
  const p = skill('pipeline');
  has(p, '**Language (§1.6)**', 'resolve the writing language once per run', 'never re-resolve mid-run', 'Language: <tag from Setup §1.6>',
    '^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$', 'use `en`');
});

test('AC14 every Playbook that skips pipeline setup resolves the language (brainstorm, cooler, research, triage, help, version)', () => {
  for (const n of ['brainstorm', 'cooler', 'research', 'triage', 'help', 'version']) {
    assert.ok(/§1\.6|aico:pipeline/.test(skill(n)) && /language/i.test(skill(n)), `${n} must resolve Language`);
  }
  for (const n of ['brainstorm', 'cooler', 'research']) has(skill(n), 'Language: <tag');
});

test('AC15 handoff Language rule: prose in tag, machine-read parts stay English, invalid falls back to en', () => {
  const h = skill('handoff');
  has(h, 'Language: <tag>', 'Always English', 'frontmatter keys and values', '`##` headings', 'blocking tags', 'AC IDs',
    'Value not a valid tag → `en`', 'invalid Language', '35 characters');
});

test('AC16 commit subject keeps an English <type> and a summary in Language:', () => {
  has(skill('pipeline'), 'The `<type>` stays English; the summary after it is written in `Language:`');
  has(skill('handoff'), 'Commit subjects are `<type>: <summary in tag>`');
  has(research, 'docs` stays English');
});

test('AC17 code comments follow Language: unless the Ruleset or the codebase says otherwise; UI follows languages:', () => {
  has(skill('handoff'), 'Code comments', 'unless the product\'s Ruleset or the existing comments', 'follow `languages:`');
  has(skill('tdd'), 'New comments use the `Language:` of your dispatch unless the codebase');
});

test('AC18 rule packs use the user default language; quotes stay original; bullets are separate lines', () => {
  const r = skill('ruleset');
  has(r, '--default', 'Quotes from sources stay in their original language.');
  assert.ok(!/original language\.- /.test(r), 'two bullets are glued together on one line in skills/ruleset/SKILL.md');
});

test('AC19/AC20 design-researcher inputs, candidate table columns, rejection rules, cap of 5', () => {
  const a = read('agents/design-researcher.md');
  has(a, 'stack', 'product_type', '## Personas', '## Art direction', 'impeccable', 'hallmark', 'frontend-ui-engineering', 'aico:ui-design',
    'unclear license', 'API key needed', 'no commit in 12 months', 'no fit', 'at most 5', 'Name overlap with `aico:ui-design`');
  const s = skill('sourcing');
  has(s, '## Candidates', 'name, source repo, license, last commit, installs/stars, API key y/n', '`## Recommended set` (at most 5 lines',
    '`## Rejected`', 'Every table row appears in the set or in `## Rejected`', 'Last commit within 12 months');
});

test('AC21 design run triggers: inside research, directly, and in feature only for UI and stale/empty', () => {
  has(research, 'design-researcher', 'topic is about UI/UX or design skills');
  has(skill('lead'), '`aico:design-researcher`');
  const f = skill('feature');
  has(f, 'only when the product has UI', 'stale (empty, or newest `approved:` over 180 days old)', 'Otherwise skip silently');
  assert.ok(f.indexOf('1a. Design skills') > 0);
});

test('AC22 approved set goes to project.md ## Design skills (not standards), install via dry-run plus Install / Skip', () => {
  has(research, '`.company/project.md` `## Design skills`', 'approved: <today>', 'at most 5 lines', 'Install (Recommended) / Skip',
    'Installs happen only in this step', 'Skip is recorded and the run continues', 'ERROR design skill line');
  assert.ok(!/standards\.md/.test(research.slice(research.indexOf('## 7. Design skills'), research.indexOf('## 8.'))));
  has(skill('feature'), 'design --project .company/project.md --dry-run', 'Install (Recommended) / Skip', 'Install artifacts', 'never committed');
  has(read('docs/contracts/design-skills-section.md'), 'approved');
});

test('AC23 the five UI Roles load Design skills and name a missing one under ## Next', () => {
  for (const r of ['ui-ux-designer', 'frontend-engineer', 'desktop-engineer', 'game-engineer', 'brand-artist']) {
    has(read(`agents/${r}.md`), 'Design skills:', 'missing design skill: <name>', '## Next');
  }
  has(skill('pipeline'), 'Design skills: <names | none>', 'ui-ux-designer, frontend-engineer, desktop-engineer, game-engineer, brand-artist');
  has(skill('handoff'), 'missing design skill: <name>', 'never skip silently');
});

test('AC10 docs agree: GLOSSARY terms, README department, commands entries, spec mentions research', () => {
  const g = read('GLOSSARY.md');
  for (const t of ['Research run', 'Feasibility verdict', 'Low-hanging fruit', 'aico language', 'Design skills']) has(g, `**${t}**`);
  has(read('README.md'), 'Market & tech research', 'User research & testing', '/aico:research', '/aico:language');
  has(read('documentation/commands.md'), '### `/aico:research`', '### `/aico:language`');
  const spec = read('docs/spec.md');
  has(spec, 'market-researcher', 'tech-researcher', 'design-researcher', 'sourcing');
  has(read('CHANGELOG.md'), '0.9.0');
  const v = JSON.parse(read('.claude-plugin/plugin.json')).version;
  assert.equal(v, '0.9.0');
});

test('AC11 size limits: agents <= 50 lines, skills <= 125 lines', () => {
  for (const f of readdirSync(join(root, 'agents'))) {
    assert.ok(read(`agents/${f}`).split('\n').length <= 51, `agents/${f} > 50 lines`);
  }
  for (const d of readdirSync(join(root, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory())) {
    assert.ok(read(`skills/${d.name}/SKILL.md`).split('\n').length <= 126, `skills/${d.name} > 125 lines`);
  }
});

test('research Playbook never edits product code and writes no lessons', () => {
  has(research, 'Write nothing to `.company/lessons.md`', 'Nothing is built, no Gates, no branch, no push');
});
