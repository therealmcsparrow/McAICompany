import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
  has(research, 'in parallel, in one message', '`.company/work/<name>/NN-<role>.md`', 'git status --porcelain',
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
  has(research, 'Start the main work / Brainstorm / Roadmap / Park', 'Nothing starts without the pick',
    'Commit **only the report**', 'Never `git add -A`', 'Never push');
  has(research, "git add '<report path>' && git commit -m 'docs: research <Short Topic>'", 'RR `## Short Topic` rule', 'in single quotes');
  assert.ok(!research.includes('git commit -m "'), 'the commit summary is never double-quoted');
  assert.ok(idx(research, '## 6. Pick') < idx(research, '## 8. Commit'));
});

test('AC6 quick caps fetches at 10; deep needs 3 independent primary sources', () => {
  has(research, 'at most 10 web fetches per researcher', 'at least 3 independent primary sources');
  has(skill('sourcing'), 'at most 10 web fetches', 'at least 3 independent primary sources');
});

test('AC7 research group holds find-skills with license and vetted, core includes it; no mattpocock plugin', () => {
  const b = JSON.parse(read('deps/3rdpartyskills.json'));
  assert.ok(b.groups.core.some((e) => e.include === 'research'));
  assert.ok(Array.isArray(b.groups.research) && b.groups.research.length >= 1);
  for (const n of b.groups.research) {
    const e = b.entries.find((x) => x.skillname === n);
    assert.ok(e && e.license && e.vetted, `research entry ${n} needs license and vetted`);
    assert.ok(!/api[-_ ]?key/i.test(JSON.stringify(e)));
  }
  assert.ok(b.groups.research.includes('find-skills'));
  has(research, 'anthropic-skills:deep-research', 'optional, never shown');
});

test('aico depends on no mattpocock-skills plugin and no skill or agent names it', () => {
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.ok(!plugin.dependencies.some((d) => d.startsWith('mattpocock-skills')));
  for (const dir of ['skills', 'agents']) {
    for (const f of readdirSync(join(root, dir), { recursive: true })) {
      if (!/.(md|sh)$/.test(f)) continue;
      assert.ok(!read(join(dir, f)).includes('mattpocock'), `${dir}/${f} names mattpocock`);
    }
  }
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
    '`## Rejected`', 'Every candidate appears in the set or in `## Rejected`', 'Last commit within 12 months');
  has(a, '`Area:` line', '`missing area`', '`skill-recommendation` v2 line', '`area: design`', 'full 40-hex commit');
  assert.ok(!a.includes('## Design skills'), 'the Role no longer reads the old section');
});

test('AC21 design run triggers: inside research, directly, and in feature only for UI and stale/empty', () => {
  has(research, 'design-researcher', 'topic is about UI/UX or design skills');
  has(skill('lead'), '`aico:design-researcher`');
  const f = skill('feature');
  has(f, 'only when the product has UI', '`tier-sets` v1.6', 'role-skills stale', 'none with a valid `approved` date', 'newest valid `approved` over 180 days old', 'Otherwise skip silently');
  assert.ok(!f.includes('## Design skills'), 'the old section is no longer the condition');
  assert.ok(f.indexOf('1a. Design skills') > 0);
});

test('AC22 approved picks go to the user catalog and Role selections (not project.md or standards), install via the shared form', () => {
  has(research, 'skill-picks.md` §3 and §4', '`role-skills record`', 'Install / Skip form of `aico:pipeline` §1.19 b', 'Installs happen only in this step', 'Goal line `Area: design`');
  assert.ok(!research.includes('## Design skills`'), 'research writes no old section');
  has(read('skills/feature/SKILL.md'), 'then run §1.19 d of `aico:pipeline` again and use the new `Role skills:` lines for every later dispatch');
  assert.ok(!/standards\.md/.test(research.slice(research.indexOf('## 7. Design skills'), research.indexOf('## 8.'))));
  has(skill('feature'), 'Goal line `Area: design`', '`role-skills record`', 'the form of `aico:pipeline` §1.19 b', '`install-skills --selected --dry-run`', 'Install artifacts', 'never committed');
  for (const t of [research, skill('feature'), read('skills/lead/references/skill-picks.md')]) assert.ok(!t.includes('install-skills design --project'), 'no call with the removed flag');
  for (const t of [skill('feature'), read('skills/lead/references/skill-picks.md')]) has(t, 'only when', '`settings_folder_moved` in the settings `get` output is `false`');
  has(read('docs/contracts/design-skills-section.md'), 'approved');
});

test('AC22 skill-picks asks each new entry\'s license, then records one pick per call on stdin', () => {
  const p = read('skills/lead/references/skill-picks.md');
  const order = ['**Approve form**', '**License questions**', '**Record**', '**Install / Skip form**'];
  order.forEach((s, i) => { if (i) assert.ok(p.indexOf(order[i - 1]) < p.indexOf(s), s); });
  has(p, '`picks[].stated_license`', '`No license, skip this skill`', '`Cancel` runs no `record` for any pick and stops before the Install / Skip form', 'Other = the value',
    'refused and asked again before any command', 'only after every license question is answered', 'one call per approved pick',
    "role-skills record <<'AICO_JSON'", '{ entry, license, roles }', 'send no `license`', 'prints `no license stated: <name>`', 'name each such entry');
  assert.deepEqual([...p.matchAll(/^(\d)\. \*\*/gm)].map((m) => m[1]), ['1', '2', '3', '4', '5'], 'section 3 steps are numbered in order');
});

test('skill-picks: post-install reads --selected and scans catalog scope user as global', () => {
  const p = read('skills/lead/references/skill-picks.md');
  has(p, 'the form of `aico:pipeline` §1.19 b', 'each approved repo pick that got Install', 'A pick that got Skip has no install line and no checks', '`install-skills --selected` output', '`scan failed after install`', 'stores no hash for a skill that failed either check', 'run §1.19 d of `aico:pipeline` again and use the new `Role skills:` lines for every later dispatch');
  assert.ok(!p.includes('skillspector scan --scope'), 'the Lead runs no scan after install');
  assert.ok(!p.includes('check-install'), 'Role skill installs have no lock file to check');
  assert.ok(!p.includes('--scope project --skill'), 'a user scope skill is not scanned at project scope');
  assert.ok(!/## (Design skills|Skills)`/.test(p), 'no old section is written');
});

test('setup runs the migration form before step 1 and stack text points to /aico:add-skill', () => {
  const s = skill('setup');
  has(s, 'role-skills pending', 'migration form of `aico:pipeline` §1.19 a', 'They are not used until you migrate them', 'role-skills migrate --apply',
    'Later, Cancel or a printed `ERROR`', 'go on with setup', 'any argument but `help`', '/aico:add-skill');
  has(s, '`role-skills migrate` (writes nothing) and show the `stays` lines it prints as the reasons');
  assert.ok(s.indexOf('role-skills pending') < s.indexOf('\n1. Groups ='), 'before step 1');
  assert.ok(s.indexOf('**Help:**') < s.indexOf('role-skills pending'), 'help stops first');
  const d = skill('stack-detect');
  has(d, '/aico:add-skill');
  assert.ok(!d.includes('deps/skills.json') && !/npx|skills add/.test(d), 'stack-detect names no install command of its own');
});

test('research dispatch and setup skill-researcher dispatch carry a built Role skills line', () => {
  has(research, 'the `Role skills:` build of §1.19 d (`install-skills --status`, no forms)', "Role skills: <names | none>   # that Role's lines of --status, built per aico:pipeline §1.19 d");
  assert.ok(research.indexOf('Context cap: <cap>') < research.indexOf('Role skills: <names | none>'), 'Role skills: follows Context cap:');
  has(research, 'npx -y skills@1.7.4 remove <name> -g -a claude-code -y', 'only from the home folder', 'by hand, with no command');
  assert.ok(!research.includes('install-skills --remove'), 'the removal flag answers nothing for a skill just installed');
  has(skill('setup'), 'its `Role skills:` built as §1.19 d says (`install-skills --status` once, no Install form; `none` when no name is left)');
});

test('AC23 the five UI Roles load Role skills and name a missing one under ## Next', () => {
  for (const r of ['ui-ux-designer', 'frontend-engineer', 'desktop-engineer', 'game-engineer', 'brand-artist']) {
    has(read(`agents/${r}.md`), 'Role skills:', 'missing role skill: <name>', '## Next');
  }
  has(skill('pipeline'), 'Role skills: <names | none>');
  has(skill('handoff'), 'missing role skill: <name>', 'never skip silently');
});

test('AC10 docs agree: GLOSSARY terms, README department, commands entries, spec mentions research', () => {
  const g = read('GLOSSARY.md');
  for (const t of ['Research run', 'Feasibility verdict', 'Low-hanging fruit', 'aico language', 'Design skills']) has(g, `**${t}**`);
  has(read('README.md'), 'Market & tech research', 'User research & testing', '/aico:research', '/aico:language');
  assert.ok(existsSync(join(root, 'documentation/commands/research.md')) && existsSync(join(root, 'documentation/commands/language.md')), 'research and language command pages');
  const spec = read('docs/spec.md');
  has(spec, 'market-researcher', 'tech-researcher', 'design-researcher', 'sourcing');
  has(read('CHANGELOG.md'), '0.9.0');
  const v = JSON.parse(read('.claude-plugin/plugin.json')).version;
  assert.match(v, /^\d+\.\d+\.\d+$/);
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

test('type gating: research picks its Roles through the company type and checks each before dispatch', () => {
  has(research, 'run.mjs" company-type pick --max 2 market-researcher tech-researcher ux-researcher',
    'pick design-researcher', 'check-role <role>', 'check-role product-manager', 'first Playbook of the `work:` type line');
  assert.ok(!/aico:feature/.test(research), 'research names no Playbook outside the type');
  assert.ok(!/pick --max 2[^`]*design-researcher/.test(research), 'design-researcher is not a default pick');
});

test('type gating: default research picks per type (design-researcher never default)', () => {
  const want = { software: ['market-researcher', 'tech-researcher'], marketing: ['market-researcher'], design: ['ux-researcher'], research: ['market-researcher', 'tech-researcher'] };
  for (const [type, expected] of Object.entries(want)) {
    const roles = JSON.parse(read(`company/types/${type}.json`)).roles;
    const picked = ['market-researcher', 'tech-researcher', 'ux-researcher'].filter((r) => roles.includes(r)).slice(0, 2);
    assert.deepEqual(picked, expected, type);
    assert.ok(!picked.includes('design-researcher'), type);
  }
  has(research, 'The design-researcher is never a default pick', 'skipped when already chosen');
});

test('type gating: feedback and client reach missing Roles through pick', () => {
  const feedback = skill('feedback');
  const client = skill('client');
  has(feedback, 'pick support account-manager product-manager', 'check-role', '`work:` type line');
  has(client, 'pick architect product-manager', 'pick devops', 'check-role', '`work:` type line');
  for (const [n, t] of [['feedback', feedback], ['client', client]])
    assert.ok(!/aico:(support|architect|devops|fix|feature|incident)\b/.test(t), `${n} names no Role or Playbook outside the types`);
});
