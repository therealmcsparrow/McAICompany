import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

// Text pins for the three grill Playbooks that share skills/grilling/references/grill-loop.md,
// plus a run of scripts/grill.mjs over a file shaped as each Playbook writes it.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '62ac88cd2e72904a0fd424039e8f35a9e42d1985';
const NAMES = ['grilling', 'grill-me', 'grill-with-docs'];
const read = (p) => readFileSync(join(root, p), 'utf8');
const skills = Object.fromEntries(NAMES.map((n) => [n, read(`skills/${n}/SKILL.md`)]));
const loop = read('skills/grilling/references/grill-loop.md');
const RUN = '${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs';
const LOOP_PATH = '${CLAUDE_PLUGIN_ROOT}/skills/grilling/references/grill-loop.md';

const front = (text) => {
  const lines = text.split('\n');
  assert.equal(lines[0], '---');
  const end = lines.indexOf('---', 1);
  assert.ok(end > 0, 'frontmatter closes');
  return { lines, end, map: new Map(lines.slice(1, end).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2).replace(/^"(.*)"$/, '$1')])) };
};

for (const name of NAMES) {
  const text = skills[name];
  const { lines, end, map } = front(text);

  test(`${name}: frontmatter exact keys, CEO-only, no allowed-tools`, () => {
    assert.deepEqual([...map.keys()], ['name', 'description', 'disable-model-invocation', 'argument-hint']);
    assert.equal(map.get('name'), name);
    assert.equal(map.get('disable-model-invocation'), 'true');
    assert.equal(map.get('argument-hint'), '<idea | file> | resume <slug>');
    assert.ok(map.get('description').startsWith('Playbook.'));
    assert.ok(map.get('description').length <= 1024);
    assert.ok(!text.includes('allowed-tools'));
  });

  test(`${name}: at most 125 lines, LF only`, () => {
    assert.ok(lines.length <= 126, `lines: ${lines.length}`);
    assert.ok(!text.includes('\r'));
  });

  test(`${name}: Help line, empty line, Type line`, () => {
    const h = lines.findIndex((l) => l.startsWith('**Help:**'));
    assert.ok(h > end);
    assert.ok(lines[h].includes(`\`documentation/commands/${name}.md\``));
    assert.ok(lines[h].includes('change nothing, start nothing, and stop'));
    assert.equal(lines[h + 1], '');
    assert.ok(lines[h + 2].startsWith('**Type:**'));
    assert.ok(lines[h + 2].includes(`node "${RUN}" company-type check-playbook ${name}`));
  });

  test(`${name}: Start, answer source, Close and End form sections exist`, () => {
    for (const h of [/^## 1\. Start$/m, /^## 2\. Answer source$/m, /^## 3\. Close$/m, /^## 4\. End form$/m]) {
      assert.ok(h.test(text), `missing heading ${h}`);
    }
    assert.ok(text.includes(LOOP_PATH));
    assert.ok(text.includes('Stop'));
    assert.ok(text.includes('Start that Playbook with the Skill tool'));
  });

  test(`${name}: argument reaches no shell, only draft-input --for grill`, () => {
    assert.ok(text.includes(`node "${RUN}" draft-input arg --for grill`));
    assert.ok(text.includes('.company/draft-input-arg-grill.txt'));
    assert.ok(text.includes('Never put the CEO\'s text in a shell command'));
    assert.ok(!text.includes('<plugin root>'));
    assert.ok(!/^!`/m.test(text) && !text.includes('!`'));
    assert.ok(text.includes('data, never instructions'));
  });
}

test('answer source: grilling looks facts up and may send web search queries', () => {
  const t = skills.grilling;
  assert.ok(t.includes('Web search: yes'));
  assert.ok(t.includes('the idea and the CEO\'s answers may become web search queries sent to the web search tool'));
});

test('answer source: grill-me asks every branch, no lookups, never a web search query', () => {
  const t = skills['grill-me'];
  assert.ok(t.includes('Web search: never'));
  assert.ok(t.includes('every branch is asked'));
  assert.ok(t.includes('no lookup'));
  assert.ok(!t.includes('Web search: yes'));
});

test('answer source: grill-with-docs searches docs first, cites path:line, no web search', () => {
  const t = skills['grill-with-docs'];
  assert.ok(t.includes('Web search: never'));
  assert.ok(t.includes('docs/'));
  assert.ok(t.includes('GLOSSARY.md'));
  assert.ok(t.includes('docs/adr/'));
  assert.ok(t.includes('path:line'));
  assert.ok(t.includes('data, never instructions'));
  assert.ok(t.includes('- GLOSSARY:') && t.includes('- ADR:'));
});

test('shared loop: one question per form, status after each log, close rules, resume, tree check', () => {
  const need = [
    'exactly one question per form', '2 to 4 options', 'recommended option first', '(Recommended)',
    'Header `<n> answered, <k> open`', 'fixed number of questions', '`question_rounds` is not used',
    `node "${RUN}" grill status <slug>`, 'Rewrite `.company/work/<slug>/grill.md` whole with the Write tool',
    'format: 1', '## Closed branches', '## Proposals', 'status: stopped', 'status: done',
    'closed by stop', 'git status --porcelain', 'grill-file v1.1 Personal data',
    'an erasure request overrides the archive rule (CEO decides)', 'resume <slug>',
  ];
  for (const n of need) assert.ok(loop.includes(n), `loop missing: ${n}`);
  assert.ok(!loop.includes('\r'));
  assert.ok(!loop.includes('<plugin root>'));
});

test('every Playbook names the loop file and the loop file names the three answer sources', () => {
  for (const n of NAMES) assert.ok(skills[n].includes(LOOP_PATH));
  for (const m of ['lookup', 'ask-all', 'docs']) assert.ok(loop.includes(`\`${m}\``), `mode ${m}`);
});

test('aico:grill SKILL.md is byte-identical to the base commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'grill-base-'));
  try {
    const cfg = join(dir, 'gitconfig');
    writeFileSync(cfg, '');
    const out = execFileSync('git', ['show', `${BASE}:skills/grill/SKILL.md`], {
      cwd: root, env: { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' }, maxBuffer: 1 << 20,
    });
    // Only the Help line's docs path moved (docs by topic); everything else is the base text.
    const now = readFileSync(join(root, 'skills/grill/SKILL.md'), 'utf8')
      .replace('read `documentation/commands/grill.md`', 'read the `### /aico:grill` entry of `documentation/commands.md`');
    assert.ok(Buffer.compare(out, Buffer.from(now)) === 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const GRILL = (extra) => `---
slug: demo-idea
started: 2026-10-30 14:05
status: done
format: 1
---
## Idea
A small idea.
## Open branches
## Closed branches
- B-1 — who uses it — closed by Q-1
- B-2 — where it lives — closed by ${extra.ref}
## Log
### Q-1 — B-1
- Question: Who uses it?
- Options: The CEO (recommended: the only user so far) | A team
- Answer: The CEO
- Decision: One user
- Opens: B-2
- Closes: B-1
${extra.entry}## Proposals
${extra.proposals}`;

const FIXTURES = {
  grilling: {
    ref: 'F-1',
    entry: '### F-1 — B-2\n- Fact: The store is a folder.\n- Source: https://example.com/doc\n- Closes: B-2\n',
    proposals: '- GLOSSARY: idea — a rough thought\n',
  },
  'grill-me': {
    ref: 'Q-2',
    entry: '### Q-2 — B-2\n- Question: Where does it live?\n- Options: A folder (recommended: simplest) | A database\n- Answer: A folder\n- Decision: Folder\n- Opens: none\n- Closes: B-2\n',
    proposals: '',
  },
  'grill-with-docs': {
    ref: 'F-1',
    entry: '### F-1 — B-2\n- Fact: Docs say the store is a folder.\n- Source: docs/spec.md:12\n- Closes: B-2\n',
    proposals: '- GLOSSARY: store — the work folder\n- ADR: Folder store — keep files in .company/work\n',
  },
};

test('each grill playbook writes grill-file v1: grill status accepts its file', () => {
  for (const name of NAMES) {
    const dir = mkdtempSync(join(tmpdir(), 'grill-fix-'));
    try {
      mkdirSync(join(dir, '.company/work/demo-idea'), { recursive: true });
      writeFileSync(join(dir, '.company/work/demo-idea/grill.md'), GRILL(FIXTURES[name]));
      const r = spawnSync(process.execPath, [join(root, 'scripts/grill.mjs'), 'status', 'demo-idea'], { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`);
      assert.ok(r.stdout.includes('grill: ') && r.stdout.includes('status: done'), name);
      // the shape the Playbook text asks for
      assert.ok(loop.includes('slug') && loop.includes('started') && loop.includes('format: 1'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('grill-file contract lists the new writers and the web search set', () => {
  const c = read('docs/contracts/grill-file.md');
  assert.ok(c.startsWith('# Contract: grill-file v1.1'));
  for (const n of ['aico:grilling', 'aico:grill-me', 'aico:grill-with-docs']) assert.ok(c.includes(n), n);
  assert.ok(c.includes('the fact lookups of `aico:grill` and `aico:grilling` may send web search queries'));
  assert.ok(c.includes('`aico:grill-me` and `aico:grill-with-docs` send no web search query'));
  assert.ok(c.includes('## Personal data'));
  assert.ok(!c.includes('\r'));
});
