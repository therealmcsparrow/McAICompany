import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// Regression: the Skill tool refuses a skill that carries `disable-model-invocation: true`
// ("cannot be used with Skill tool ... Ask the user to run /aico:<name> themselves ... Do not
// replicate this skill's workflow by other means"). A Playbook that tells the Lead to "follow" or
// "run" another model-hidden Playbook in place therefore dead-ends. The Lead can only tell the
// CEO the exact slash command to run. Source: CEO report "aico:research cannot be invoked via
// skill tool" (task playbook-chain-handoff). Public interface under test: the text of
// skills/**/*.md and the `disable-model-invocation` frontmatter key.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(root, 'skills');
const read = (p) => readFileSync(join(root, p), 'utf8');
const lines = (text) => text.split(/\r?\n/);

// ---- the hidden set: read from frontmatter, never hard-coded ----
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return m ? m[1] : '';
}
const skillNames = readdirSync(skillsDir).filter((n) => existsSync(join(skillsDir, n, 'SKILL.md')));
const hidden = new Set(
  skillNames.filter((n) => /^disable-model-invocation:\s*true\s*$/m.test(frontmatter(read(`skills/${n}/SKILL.md`)))),
);

function mdFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...mdFiles(p));
    else if (e.endsWith('.md')) out.push(p);
  }
  return out;
}
const files = mdFiles(skillsDir).map((p) => relative(root, p).split('\\').join('/'));

// ---- the detector ----
// A chain is: a chain verb, then within 40 characters a bare `aico:<hidden>` (no leading slash, so
// `/aico:research` is the CEO-facing form and is fine); or one of the stock phrases that name a
// hidden Playbook without its token ("follow ... in place", "hand straight to the chosen Playbook").
const VERB = /\b(follows?|following|runs?|starts?|invokes?|hands?(?:\s+straight)?(?:\s+over)?\s+to|via)\b/gi;
const MENTION = /(^|[^/\w-])aico:([a-z][a-z-]*)(?![\w-])/g;
const PHRASES = [
  /\bfollow[^.\n]{0,80}\bin place\b/i,
  /\bhands?\s+(?:straight\s+)?to\s+the\s+chosen\s+Playbook\b/i,
];

export function chains(line) {
  const hits = [];
  for (const m of line.matchAll(MENTION)) {
    const name = m[2];
    if (!hidden.has(name)) continue;
    const at = m.index + m[1].length;
    // only the current clause counts: cut at the last sentence break or arrow before the mention
    const before = line.slice(0, at);
    const cut = Math.max(before.lastIndexOf('. '), before.lastIndexOf('; '), before.lastIndexOf('→'), before.lastIndexOf('|'));
    const clause = before.slice(cut + 1);
    let verb = null;
    for (const v of clause.matchAll(VERB)) verb = v;
    // a mention the CEO starts themselves is not an in-place chain (Nit: should still show the slash form)
    const after = line.slice(at + 5 + name.length, at + 5 + name.length + 80);
    if (/the CEO starts|started by the CEO/i.test(after)) continue;
    if (verb && clause.length - verb.index <= 40) hits.push(`${verb[0]} aico:${name}`);
  }
  for (const p of PHRASES) {
    const m = p.exec(line);
    if (m) hits.push(m[0]);
  }
  return hits;
}

const isHelpLine = (l) => /^\*\*Help:\*\*/.test(l);

function sites(filter) {
  const out = [];
  for (const f of files) {
    lines(read(f)).forEach((l, i) => {
      if (!filter(l)) return;
      const h = chains(l);
      if (h.length) out.push(`${f}:${i + 1} [${h.join(' | ')}]`);
    });
  }
  return out;
}

// ---- the detector itself is not vacuous ----
test('detector: the hidden set is read from frontmatter and matches the known shape', () => {
  for (const n of ['research', 'feature', 'fix', 'brainstorm', 'help', 'lead', 'triage', 'audit']) {
    assert.ok(hidden.has(n), `${n} should be model-hidden`);
  }
  for (const n of ['pipeline', 'handoff', 'security-check', 'sourcing', 'ruleset', 'design-researcher']) {
    assert.ok(!hidden.has(n), `${n} must not be model-hidden`);
  }
});

test('detector: flags in-place chains, ignores CEO-facing slash commands and non-hidden skills', () => {
  const bad = [
    'Follow `aico:research` in place with the brainstorm file as its argument',
    'Then follow the first Playbook of the `work:` type line (`feature` for software) in place with the file',
    'say so in one line and follow that Playbook\'s skill file in place: feature → `aico:feature`',
    '**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `x` and stop.',
    '4. Fix via the `aico:fix` route (follow `aico:fix` steps 1-3)',
    'otherwise run `aico:audit` steps 1-2 first',
    'Run `aico:triage` first',
    'On approve, hand straight to the chosen Playbook or `aico:lead` route',
  ];
  for (const l of bad) assert.ok(chains(l).length > 0, `should flag: ${l}`);
  const good = [
    'Tell the CEO to run `/aico:research "<path>"`, then stop',
    'Run with `aico:pipeline`, read-only',
    'Findings follow `aico:sourcing`',
    'ask which items become `aico:fix` or `aico:feature` runs',
    'as in `aico:feature` 2c-2d',
    'Dispatch `aico:design-researcher` with the goal',
    'suggest `/aico:incident`',
  ];
  for (const l of good) assert.deepEqual(chains(l), [], `should not flag: ${l}`);
});

// ---- AC-chain-1: no Playbook text chains to a hidden Playbook in place ----
test('AC-chain-1: no Playbook tells the Lead to follow or run another model-hidden Playbook in place (routing hand-offs)', () => {
  const found = sites((l) => !isHelpLine(l));
  assert.equal(
    found.length, 0,
    `${found.length} in-place chain(s) to a disable-model-invocation Playbook; the Lead must tell the CEO the command instead:\n  ${found.join('\n  ')}`,
  );
});

test('AC-chain-2: no Help line follows the model-hidden aico:help in place', () => {
  const found = sites((l) => isHelpLine(l));
  assert.equal(
    found.length, 0,
    `${found.length} Help line(s) chain to the hidden aico:help:\n  ${found.join('\n  ')}`,
  );
});

// ---- AC-chain-3: each hand-off tells the CEO the exact command ----
// Wording is not pinned beyond: addressed to the CEO, a backticked slash command with its
// argument, and (for "the main work") the Playbook still resolved from the type's `work:` line.
const CMD = /`\/aico:[a-z<][^`\n]*`/;
const CEO = /\bCEO\b/;
const lineStarting = (text, re, what) => {
  const l = lines(text).find((x) => re.test(x));
  assert.ok(l, `missing hand-off line: ${what}`);
  return l;
};
const cmdOf = (l) => CMD.exec(l)?.[0];

test('AC-chain-3a: brainstorm close option 2 (Research it first) tells the CEO the /aico:research command with the file', () => {
  const l = lineStarting(read('skills/brainstorm/SKILL.md'), /^\s*- \*\*2\*\* →/, 'brainstorm option 2');
  assert.ok(CEO.test(l), `option 2 must address the CEO: ${l}`);
  const cmds = [...l.matchAll(/`\/aico:research\b[^`\n]*`/g)].map((m) => m[0]);
  assert.ok(cmds.length > 0, `option 2 must give the exact command /aico:research ...: ${l}`);
  assert.ok(cmds.some((c) => /<[^>]*(path|file)[^>]*>|"[^"]*"/.test(c)), `the command must carry the brainstorm file as its argument: ${cmds.join(' ')}`);
  assert.ok(/status: open/.test(l), 'option 2 keeps status: open');
});

test('AC-chain-3b: brainstorm close option 1 (Build it) tells the CEO the main-work command with the file', () => {
  const l = lineStarting(read('skills/brainstorm/SKILL.md'), /^\s*- \*\*1\*\* →/, 'brainstorm option 1');
  assert.ok(CEO.test(l), `option 1 must address the CEO: ${l}`);
  assert.ok(cmdOf(l), `option 1 must give a backticked /aico:<Playbook> command: ${l}`);
  assert.ok(/`work:`/.test(l), 'the Playbook is still the first of the type\'s `work:` line');
  assert.ok(/status: built/.test(l), 'option 1 keeps status: built');
});

test('AC-chain-3c: research pick Start tells the CEO the main-work command with the report', () => {
  const l = lineStarting(read('skills/research/SKILL.md'), /^- \*\*Start\*\* →/, 'research Start');
  assert.ok(CEO.test(l), `Start must address the CEO: ${l}`);
  assert.ok(cmdOf(l), `Start must give a backticked /aico:<Playbook> command: ${l}`);
  assert.ok(/`work:`/.test(l), 'the Playbook is still the first of the type\'s `work:` line');
});

test('AC-chain-3d: research pick Brainstorm tells the CEO the /aico:brainstorm command with the report path', () => {
  const l = lineStarting(read('skills/research/SKILL.md'), /^- \*\*Brainstorm\*\* →/, 'research Brainstorm');
  assert.ok(CEO.test(l), `Brainstorm must address the CEO: ${l}`);
  const cmds = [...l.matchAll(/`\/aico:brainstorm\b[^`\n]*`/g)].map((m) => m[0]);
  assert.ok(cmds.length > 0, `Brainstorm must give the exact command /aico:brainstorm ...: ${l}`);
  assert.ok(cmds.some((c) => /<[^>]*(path|file|report)[^>]*>|"[^"]*"/.test(c)), `the command must carry the report path: ${cmds.join(' ')}`);
});

test('AC-chain-3e: the research type-gating rule survives: research text names no Playbook outside the type', () => {
  // research-playbook.test.mjs pins this too; repeated here because the obvious fix
  // ("tell the CEO to run /aico:feature") would break it for non-software types.
  assert.ok(!/aico:feature/.test(read('skills/research/SKILL.md')), 'research names no hard-coded aico:feature');
});

test('AC-chain-3f: lead routing tells the CEO the slash command of the Playbook it picked', () => {
  const l = lineStarting(read('skills/lead/SKILL.md'), /^Unsure of the size or risk/, 'lead section 1 routing line');
  assert.ok(!/\bin place\b/.test(l), 'lead must not follow a Playbook in place');
  assert.ok(CEO.test(l), 'lead must address the CEO');
  const named = [...l.matchAll(/(^|[^/\w-])aico:([a-z][a-z-]*)(?![\w-])/g)].map((m) => m[2]).filter((n) => hidden.has(n));
  assert.ok(named.length >= 10, `the routing line should still name the Playbooks (found ${named.length})`);
  const text = read('skills/lead/SKILL.md');
  for (const n of new Set(named)) {
    assert.ok(text.includes(`/aico:${n}`), `lead must give the CEO the command /aico:${n}`);
  }
});

test('AC-chain-3g: triage hands the CEO the command of the recommended route', () => {
  const t = read('skills/triage/SKILL.md');
  const l = lineStarting(t, /^3\. Present one line to the CEO/, 'triage step 3');
  assert.ok(cmdOf(l), `triage step 3 must show the exact /aico:<route> command: ${l}`);
  assert.ok(!/hand straight to/i.test(l), 'triage does not hand to a Playbook itself');
});

test('AC-chain-3h: refactor without an audit report tells the CEO to run /aico:audit first', () => {
  const l = lineStarting(read('skills/refactor/SKILL.md'), /^Run with `aico:pipeline`\. No Brief Gate/, 'refactor start line');
  assert.ok(/`\/aico:audit[^`\n]*`/.test(l), `refactor must name the command /aico:audit: ${l}`);
  assert.ok(CEO.test(l), 'refactor must address the CEO');
});

test('AC-chain-3i: incident does not delegate its fix step to the hidden aico:fix', () => {
  const l = lineStarting(read('skills/incident/SKILL.md'), /^4\. /, 'incident step 4');
  assert.deepEqual(chains(l), [], `incident step 4 still chains: ${l}`);
});

test('AC-chain-3j: every Help line names how the CEO gets help for that command', () => {
  const bad = [];
  for (const n of skillNames) {
    if (n === 'help') continue;
    const l = lines(read(`skills/${n}/SKILL.md`)).find(isHelpLine);
    if (!l) continue;
    // either the CEO is told `/aico:help <n>`, or the Playbook answers itself from commands.md
    if (!(l.includes('`/aico:help') || l.includes('commands.md'))) bad.push(`skills/${n}/SKILL.md: ${l}`);
  }
  assert.equal(bad.length, 0, `Help lines that neither give /aico:help nor answer from commands.md:\n  ${bad.join('\n  ')}`);
});

// ---- guard: a hidden Playbook stays hidden and stays reachable by the CEO ----
test('guard: every model-hidden skill is listed as /aico:<name> in documentation/commands.md (the CEO can find the command)', () => {
  const helpText = read('skills/help/SKILL.md');
  assert.ok(/commands\.md/.test(helpText), 'help reads commands.md');
  const cmdFile = 'documentation/commands.md';
  assert.ok(existsSync(join(root, cmdFile)), 'documentation/commands.md exists');
  const cmds = read(cmdFile);
  const missing = [...hidden].filter((n) => n !== 'help' && !cmds.includes(`/aico:${n}`));
  assert.deepEqual(missing, [], `hidden skills the CEO cannot find in commands.md: ${missing.join(', ')}`);
});
