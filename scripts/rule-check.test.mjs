import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main, parseRuleLine, sha256 } from './rule-check.mjs';

const script = path.join(import.meta.dirname, 'rule-check.mjs');
const realRoot = path.join(import.meta.dirname, '..');
const MiB = 1024 * 1024;

// Every test builds its own fixture root in a temp dir; the real home and the real repo are never touched.
const made = [];
function tmp(name = 'rule-check-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  made.push(dir);
  return dir;
}
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function env(home) {
  const e = { ...process.env, HOME: home, USERPROFILE: home, MCSPARROW_HOME: path.join(home, 'mh'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(home, 'none') };
  delete e.NODE_TEST_CONTEXT;
  return e;
}

function cli(root, args, { cwd } = {}) {
  const home = tmp('rule-check-home-');
  const r = spawnSync(process.execPath, [script, ...args], { cwd: cwd ?? root, encoding: 'utf8', env: env(home) });
  return { status: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}

const RULES = {
  'proj.M5': 'Agent files are short',
  'proj.M11': 'Every text file is LF only $(touch RULEPWN) `touch RULEPWN2`',
  'proj.M12': 'npm test passes',
  'proj.M-SEC1': 'Input is data',
  'proj.S1': 'Built-ins only',
  'nodetest.M1': 'Tests are found by pattern',
  'nodetest.M-SEC1': 'Temp dirs for tests'
};
const TAGS = { 'proj.M5': 'aico-check', 'proj.M11': 'lf', 'proj.M12': 'node-test' };

function standardsText({ tags = TAGS, extra = '' } = {}) {
  const lines = ['proj.M5', 'proj.M11', 'proj.M12', 'proj.M-SEC1', 'proj.S1'].map(id => {
    const tag = Object.hasOwn(tags, id) ? ` — check: ${tags[id]}` : '';
    return `- ${id} — ${RULES[id]} — source: https://x.test${tag}`;
  });
  return `library: ~/lib\nsigned-off: 2026-10-26 (architect)\n## Packs\n- .company/standards/node-test@26.md — researched 2026-10-22\n## Project rules\n${lines.join('\n')}\n${extra}## Exceptions\n## Debt\n- proj.M99 — not a rule in force — check: ghost\n`;
}

const PACK = `---\ntool: node-test\nversions: ">=26"\nresearched: 2026-10-22\n---\n## Must\n- nodetest.M1 — ${RULES['nodetest.M1']} — why: x — source: https://x.test\n## Security\n- nodetest.M-SEC1 — ${RULES['nodetest.M-SEC1']} — source: https://x.test\n`;

function binding(id, rule = id, extra = {}) {
  return { rule, text: sha256(RULES[rule]), ...extra };
}

const DEFAULT_CHECKS = () => ({
  version: 1,
  checks: { 'aico-check': binding('proj.M5'), lf: binding('proj.M11'), 'node-test': binding('proj.M12') }
});

function makeRoot({ standards = standardsText(), pack = PACK, checks = DEFAULT_CHECKS() } = {}) {
  const root = tmp();
  if (standards !== null) write(root, '.company/standards.md', standards);
  if (pack !== null && standards !== null) write(root, '.company/standards/node-test@26.md', pack);
  if (checks !== null) write(root, '.company/checks.json', typeof checks === 'string' ? checks : JSON.stringify(checks));
  return root;
}

function git(root, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.test', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], {
    cwd: root, encoding: 'utf8', env: env(tmp('rule-check-home-'))
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function gitRoot(files = {}) {
  const root = makeRoot({ checks: { version: 1, checks: { lf: binding('proj.M11') } } });
  write(root, '.gitattributes', '* text=auto eol=lf\n');
  write(root, 'seed.txt', 'seed\n');
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed');
  const base = git(root, 'rev-parse', 'HEAD');
  for (const [rel, content] of Object.entries(files)) write(root, rel, content);
  git(root, 'add', '-A', '-f');
  git(root, 'commit', '-q', '-m', 'change', '--allow-empty');
  return { root, base };
}

// ---------- parsing ----------

test('parseRuleLine splits the rule at the first marker and reads the check tag', () => {
  const r = parseRuleLine('- proj.M11 — LF — only — why: w — source: https://a.test , https://b.test — enforced-by: lint — check: lf');
  assert.equal(r.id, 'proj.M11');
  assert.equal(r.text, 'LF — only');
  assert.equal(r.check, 'lf');
  assert.equal(parseRuleLine('- nsrv.M-SEC4 — x — source: https://a.test').id, 'nsrv.M-SEC4');
  assert.equal(parseRuleLine('- nsrv.M-SEC4 — x — source: https://a.test').check, null);
  assert.equal(parseRuleLine('## Must'), null);
  assert.equal(parseRuleLine('- not a rule — x'), null);
  assert.equal(parseRuleLine('- Proj.M1 — x'), null);
});

// ---------- no ruleset ----------

test('no standards.md and no checks.json: every command says no ruleset and exits 0', () => {
  const root = tmp();
  for (const args of [['run', '--base', 'abcdef1'], ['slices', path.join(root, 'h.md')], ['drift']]) {
    const r = cli(root, [...args, '--root', root]);
    assert.equal(r.status, 0, r.all);
    assert.match(r.out, /^no ruleset$/m);
  }
});

test('standards.md without checks.json: run says no checks bound; drift fails only on a check tag', () => {
  const root = makeRoot({ checks: null });
  const run = cli(root, ['run', '--base', 'abcdef1', '--root', root]);
  assert.equal(run.status, 0);
  assert.match(run.out, /no checks bound/);
  const drift = cli(root, ['drift', '--root', root]);
  assert.equal(drift.status, 1);
  assert.match(drift.out, /proj\.M5.*aico-check/);
  const quiet = makeRoot({ checks: null, standards: standardsText({ tags: {} }) });
  assert.equal(cli(quiet, ['drift', '--root', quiet]).status, 0);
});

test('checks.json without standards.md fails closed', () => {
  const root = makeRoot({ standards: null });
  const run = cli(root, ['run', '--base', 'abcdef1', '--root', root]);
  assert.equal(run.status, 0);
  assert.match(run.out, /^T-0 .*tool config invalid/m);
  const drift = cli(root, ['drift', '--root', root]);
  assert.equal(drift.status, 1);
  assert.match(drift.out, /proj\.M5/);
  const slices = cli(root, ['slices', path.join(root, 'h.md'), '--root', root]);
  assert.equal(slices.status, 0);
  assert.match(slices.out, /no ruleset/);
});

// ---------- argument refusals ----------

test('bad base and bad root are refused with exit 2', () => {
  const root = makeRoot();
  for (const base of ['zzz', '--upload-pack=x', 'abc', 'ABCDEF1', 'abcdef1; touch x', 'a'.repeat(41)]) {
    const r = cli(root, ['run', '--base', base, '--root', root]);
    assert.equal(r.status, 2, base);
    assert.match(r.out, /refused: bad base/);
  }
  const missing = cli(root, ['run', '--root', root]);
  assert.equal(missing.status, 2);
  const noRoot = cli(root, ['list', '--root', path.join(root, 'nope')]);
  assert.equal(noRoot.status, 2);
  assert.match(noRoot.out, /refused: bad root/);
  const aFile = cli(root, ['list', '--root', path.join(root, '.company', 'checks.json')]);
  assert.equal(aFile.status, 2);
  assert.equal(cli(root, ['bogus', '--root', root]).status, 2);
  assert.equal(cli(root, ['list', '--root', root, '--wat', 'x']).status, 2);
});

// ---------- bindings file ----------

test('malformed checks.json exits 2 with the reason', () => {
  const big = JSON.stringify({ version: 1, checks: {}, pad: 'x'.repeat(70 * 1024) });
  const cases = {
    'not json': '{nope',
    'top-level array': '[]',
    'wrong version': { version: 2, checks: {} },
    'unknown top key': { version: 1, checks: {}, extra: 1 },
    'unknown check key': { version: 1, checks: { lf: { ...binding('proj.M11'), shell: 'sh' } } },
    'argv not strings': { version: 1, checks: { eslint: { ...binding('proj.M11'), argv: ['a', 1] } } },
    'argv empty': { version: 1, checks: { eslint: { ...binding('proj.M11'), argv: [] } } },
    'argv not list': { version: 1, checks: { eslint: { ...binding('proj.M11'), argv: 'npx eslint' } } },
    'argv on a built-in': { version: 1, checks: { lf: { ...binding('proj.M11'), argv: ['echo'] } } },
    'unknown id without argv': { version: 1, checks: { mystery: binding('proj.M11') } },
    'bad check id': { version: 1, checks: { 'Bad Id': binding('proj.M11', 'proj.M11', { argv: ['x'] }) } },
    'proto key': '{"version":1,"checks":{"__proto__":{"rule":"proj.M11","text":"x","argv":["x"]}}}',
    'bad rule id': { version: 1, checks: { lf: { rule: 'nope', text: sha256('x') } } },
    'bad hash': { version: 1, checks: { lf: { rule: 'proj.M11', text: 'abc' } } },
    'too big': big
  };
  for (const [name, checks] of Object.entries(cases)) {
    const root = makeRoot({ checks });
    for (const cmd of [['list'], ['drift'], ['run', '--base', 'abcdef1']]) {
      const r = cli(root, [...cmd, '--root', root]);
      assert.equal(r.status, 2, `${name} ${cmd[0]}: ${r.all}`);
      if (cmd[0] === 'run') assert.match(r.out, /^T-0 .*tool config invalid/m, name);
      else assert.match(r.out, /refused: tool config invalid/, name);
    }
  }
});

test('list prints one "<rule-id> <check-id>" per binding', () => {
  const root = makeRoot();
  const r = cli(root, ['list', '--root', root]);
  assert.equal(r.status, 0);
  assert.deepEqual(r.out.trim().split('\n'), ['proj.M5 aico-check', 'proj.M11 lf', 'proj.M12 node-test']);
});

// ---------- drift ----------

test('drift passes on a consistent fixture, including a binding to a pack rule', () => {
  const checks = DEFAULT_CHECKS();
  checks.checks.eslint = binding('x', 'nodetest.M1', { argv: [process.execPath, '-e', ''] });
  const root = makeRoot({ checks });
  const r = cli(root, ['drift', '--root', root]);
  assert.equal(r.status, 0, r.all);
});

test('drift fails on a missing rule, a changed rule text, an unbound tag and a mismatched tag', () => {
  const missing = DEFAULT_CHECKS();
  missing.checks.lf.rule = 'proj.M404';
  let root = makeRoot({ checks: missing });
  let r = cli(root, ['drift', '--root', root]);
  assert.equal(r.status, 1);
  assert.match(r.out, /proj\.M404.*missing/);

  const stale = DEFAULT_CHECKS();
  stale.checks.lf.text = sha256('an older wording');
  root = makeRoot({ checks: stale });
  r = cli(root, ['drift', '--root', root]);
  assert.equal(r.status, 1);
  assert.match(r.out, /proj\.M11.*text changed/);

  const unbound = DEFAULT_CHECKS();
  delete unbound.checks['node-test'];
  root = makeRoot({ checks: unbound });
  r = cli(root, ['drift', '--root', root]);
  assert.equal(r.status, 1);
  assert.match(r.out, /proj\.M12.*node-test.*no binding/);

  const wrongRule = DEFAULT_CHECKS();
  wrongRule.checks.lf = binding('lf', 'proj.S1');
  root = makeRoot({ checks: wrongRule });
  r = cli(root, ['drift', '--root', root]);
  assert.equal(r.status, 1);
  assert.match(r.out, /proj\.S1.*no check tag lf|proj\.M11.*no binding/);
});

test('drift on the real root runs only when .company/standards.md exists', { skip: fs.existsSync(path.join(realRoot, '.company', 'standards.md')) ? false : 'no ruleset' }, () => {
  const r = cli(realRoot, ['drift', '--root', realRoot]);
  assert.equal(r.status, 0, r.all);
});

// ---------- slices ----------

const SLICE_HEAD = '## Did\n- x\n## Rules per task\n| plan task | rule IDs |\n|---|---|\n';

test('slices passes when every task line lists every security Must', () => {
  const root = makeRoot();
  const file = path.join(root, 'h.md');
  fs.writeFileSync(file, `${SLICE_HEAD}| T1 | proj.M11, proj.S1; security: proj.M-SEC1, nodetest.M-SEC1 |\n| T2 | proj.M-SEC1 nodetest.M-SEC1 |\n## Next\n- done\n`);
  const r = cli(root, ['slices', file, '--root', root]);
  assert.equal(r.status, 0, r.all);
});

test('slices prints the gaps and exits 1', () => {
  const root = makeRoot();
  const file = path.join(root, 'h.md');
  fs.writeFileSync(file, `${SLICE_HEAD}| T1 | proj.M11, proj.M-SEC1 |\n| T2 | proj.M-SEC1, nodetest.M-SEC1 |\n## Next\n- done\n`);
  const r = cli(root, ['slices', file, '--root', root]);
  assert.equal(r.status, 1);
  assert.match(r.out, /T1.*nodetest\.M-SEC1/);
  assert.doesNotMatch(r.out, /T2/);
});

test('slices fails when the section or the file is missing', () => {
  const root = makeRoot();
  const file = path.join(root, 'h.md');
  fs.writeFileSync(file, '## Did\n- x\n');
  const r = cli(root, ['slices', file, '--root', root]);
  assert.equal(r.status, 1);
  assert.match(r.out, /Rules per task/);
  const gone = cli(root, ['slices', path.join(root, 'nope.md'), '--root', root]);
  assert.equal(gone.status, 2);
});

// ---------- run: aico-check ----------

test('run aico-check: one row per WARN line, none for a short agent', () => {
  const root = makeRoot({ checks: { version: 1, checks: { 'aico-check': binding('proj.M5') } } });
  const head = '---\nname: long\ndescription: d\nmodel: sonnet\neffort: low\n---\n';
  write(root, 'agents/long.md', `${head}${'line\n'.repeat(60)}`);
  write(root, 'agents/short.md', head.replace('long', 'short') + 'line\n');
  const r = cli(root, ['run', '--base', 'abcdef1', '--root', root]);
  assert.equal(r.status, 0, r.all);
  const rows = r.out.trim().split('\n').filter(l => l.startsWith('T-'));
  assert.equal(rows.length, 1, r.out);
  assert.match(rows[0], /^T-1 \| agents\/long\.md \| agent \d+ > 50 lines \| proj\.M5: Agent files are short \| /);
});

// ---------- run: lf ----------

test('run lf: flags a text file with a CR byte, with its line, and ignores LF files and binaries', () => {
  const { root, base } = gitRoot({
    'src/crlf file.txt': 'one\r\ntwo\r\n',
    'src/ok.txt': 'one\ntwo\n',
    'src/pic.bin': Buffer.from([0, 1, 13, 10, 0, 13])
  });
  const r = cli(root, ['run', '--base', base, '--root', root]);
  assert.equal(r.status, 0, r.all);
  const rows = r.out.trim().split('\n').filter(l => l.startsWith('T-'));
  assert.equal(rows.length, 1, r.out);
  assert.match(rows[0], /^T-1 \| src\/crlf file\.txt:1 \| CR byte in text file \| proj\.M11: /);
});

test('run lf: flags a .gitattributes without the eol line, and passes a clean change', () => {
  const clean = gitRoot({ 'a.txt': 'x\n' });
  assert.equal(cli(clean.root, ['run', '--base', clean.base, '--root', clean.root]).out.trim(), '');
  const { root, base } = gitRoot({ '.gitattributes': '*.png binary\n' });
  const r = cli(root, ['run', '--base', base, '--root', root]);
  assert.match(r.out, /^T-1 \| \.gitattributes \| .*text=auto eol=lf/m);
});

test('run lf: rule text with shell syntax is shown as text and never run', () => {
  const { root, base } = gitRoot({ 'a.txt': 'x\r\n' });
  const r = cli(root, ['run', '--base', base, '--root', root]);
  assert.match(r.out, /proj\.M11: Every text file is LF only \$\(touch RULEPWN\)/);
  assert.equal(fs.existsSync(path.join(root, 'RULEPWN')), false);
  assert.equal(fs.existsSync(path.join(root, 'RULEPWN2')), false);
});

test('run lf: a base git cannot resolve is "tool failed", not silence', () => {
  const { root } = gitRoot({});
  const r = cli(root, ['run', '--base', 'deadbeef', '--root', root]);
  assert.equal(r.status, 0);
  assert.match(r.out, /tool failed: lf/);
});

// ---------- run: node-test ----------

function npmFixture(testScript) {
  const root = makeRoot({ checks: { version: 1, checks: { 'node-test': binding('proj.M12') } } });
  write(root, 'package.json', JSON.stringify({ name: 'fx', private: true, scripts: { test: testScript } }));
  write(root, 'pass.mjs', 'process.exit(0);\n');
  write(root, 'fail.mjs', `console.log('ok 1 - fine');\nconsole.log('not ok 2 - ${'the broken thing '.repeat(12)}');\nprocess.exit(1);\n`);
  return root;
}

test('run node-test: a green fixture suite gives no row, a red one gives one row naming the first failing test', () => {
  const green = cli(npmFixture('node pass.mjs'), ['run', '--base', 'abcdef1', '--root', npmFixture('node pass.mjs')]);
  assert.equal(green.out.trim(), '');
  const root = npmFixture('node fail.mjs');
  const red = cli(root, ['run', '--base', 'abcdef1', '--root', root]);
  assert.equal(red.status, 0, red.all);
  const rows = red.out.trim().split('\n');
  assert.equal(rows.length, 1, red.out);
  assert.match(rows[0], /^T-1 \| package\.json \| npm test failed: the broken thing /);
  assert.match(rows[0], /\| proj\.M12: npm test passes \| /);
  assert.ok(rows[0].split(' | ')[2].length <= 160, rows[0]);
});

// ---------- run: argv checks ----------

function argvRoot(argv, extra = {}) {
  const checks = { version: 1, checks: { probe: binding('probe', 'proj.S1', { argv }) } };
  const root = makeRoot({ checks, ...extra });
  write(root, 'tool.mjs', 'console.log(process.argv.slice(2).join("|"));\nprocess.exit(Number(process.env.TOOL_EXIT ?? 1));\n');
  return root;
}

test('run argv check: arguments reach the tool untouched and no shell is involved', () => {
  const hostile = '"$(touch PWNED)" & touch PWNED2 ; `touch PWNED3`';
  const root = argvRoot([process.execPath, 'tool.mjs', hostile]);
  const r = cli(root, ['run', '--base', 'abcdef1', '--root', root]);
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /^T-1 \| - \| probe exited 1: /m);
  assert.ok(r.out.includes('touch PWNED2'), r.out);
  for (const f of ['PWNED', 'PWNED2', 'PWNED3']) assert.equal(fs.existsSync(path.join(root, f)), false, f);
});

test('run argv check: exit 0 gives no row; a missing program, a timeout and a flood give "tool failed"', () => {
  let root = argvRoot([process.execPath, 'tool.mjs']);
  const ok = spawnSync(process.execPath, [script, 'run', '--base', 'abcdef1', '--root', root], { encoding: 'utf8', env: { ...env(tmp('rule-check-home-')), TOOL_EXIT: '0' } });
  assert.equal(ok.stdout.trim(), '');

  root = argvRoot(['definitely-not-a-program-xyz']);
  assert.match(cli(root, ['run', '--base', 'abcdef1', '--root', root]).out, /tool failed: probe/);

  root = argvRoot([process.execPath, '-e', 'setInterval(() => {}, 1000)']);
  const slow = main(['run', '--base', 'abcdef1', '--root', root], { timeoutMs: 400 });
  assert.equal(slow.code, 0);
  assert.match(slow.lines.join('\n'), /tool failed: probe/);

  root = argvRoot([process.execPath, '-e', `process.stdout.write('x'.repeat(${2 * MiB}))`]);
  assert.match(cli(root, ['run', '--base', 'abcdef1', '--root', root]).out, /tool failed: probe/);
});

test('run: a binding whose rule text changed is reported as T-0, not run', () => {
  const checks = DEFAULT_CHECKS();
  checks.checks.lf.text = sha256('older');
  const { root, base } = gitRoot({ 'a.txt': 'x\r\n' });
  write(root, '.company/checks.json', JSON.stringify(checks));
  const r = cli(root, ['run', '--base', base, '--root', root]);
  assert.match(r.out, /^T-\d+ \| \.company\/checks\.json \| tool config invalid: .*lf/m);
  assert.doesNotMatch(r.out, /CR byte/);
});

// ---------- run: handoff-lint ----------

test('run handoff-lint: rows for a bad Handoff; tool failed without --handoff', () => {
  const checks = { version: 1, checks: { 'handoff-lint': binding('proj.S1') } };
  const root = makeRoot({ checks });
  write(root, 'h.md', 'no frontmatter here\n');
  const bad = cli(root, ['run', '--base', 'abcdef1', '--root', root, '--handoff', 'h.md']);
  assert.match(bad.out, /^T-1 \| h\.md \| /m);
  assert.equal(bad.status, 0);
  const none = cli(root, ['run', '--base', 'abcdef1', '--root', root]);
  assert.match(none.out, /tool failed: handoff-lint/);
  const escape = cli(root, ['run', '--base', 'abcdef1', '--root', root, '--handoff', '../outside.md']);
  assert.equal(escape.status, 2);
});

// ---------- slice files (rule-check v1 "Slice files") ----------

const SF_REL = '.company/work/s/04-senior-engineer.md';
const SF_SEC = 'security: proj.M-SEC1, nodetest.M-SEC1';
const SF_ROW1 = `| T1 | proj.M11, proj.S1, proj.M11; focus: validate the input, then \`cut\` it; ${SF_SEC} |`;
const SF_ROW2 = `| T2c | proj.M5, nodetest.M1; ${SF_SEC} |`;

function sliceRoot(rows = [SF_ROW1, SF_ROW2], { rulesDir = true } = {}) {
  const root = makeRoot();
  write(root, SF_REL, `${SLICE_HEAD}${rows.join('\n')}\n## Next\n- done\n`);
  const rules = path.join(root, '.company/work/s/rules');
  if (rulesDir) fs.mkdirSync(rules, { recursive: true });
  return { root, handoff: path.join(root, SF_REL), rules };
}

const wr = s => cli(s.root, ['slices', s.handoff, '--write', '--root', s.root]);
const chk = s => cli(s.root, ['slices', s.handoff, '--root', s.root]);

const EXPECTED_T1 = `---
task: T1
source: .company/work/s/04-senior-engineer.md
---
## Rules
- proj.M11 — ${RULES['proj.M11']}
- proj.S1 — Built-ins only
## Focus
> validate the input, then \`cut\` it
## Security
proj.M-SEC1, nodetest.M-SEC1
`;

const EXPECTED_T2C = `---
task: T2c
source: .company/work/s/04-senior-engineer.md
---
## Rules
- proj.M5 — Agent files are short
- nodetest.M1 — Tests are found by pattern
## Focus
> (none)
## Security
proj.M-SEC1, nodetest.M-SEC1
`;

test('slices --write renders each row byte for byte, with rule text, and the check passes', () => {
  const s = sliceRoot();
  const r = wr(s);
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /^wrote 2 slices$/m);
  assert.equal(fs.readFileSync(path.join(s.rules, 'T1.md'), 'utf8'), EXPECTED_T1);
  assert.equal(fs.readFileSync(path.join(s.rules, 'T2c.md'), 'utf8'), EXPECTED_T2C);
  assert.deepEqual(fs.readdirSync(s.rules).sort(), ['T1.md', 'T2c.md']);
  assert.equal(chk(s).status, 0);
});

test('slices --write creates rules/ when it is missing and writes only inside it', () => {
  const s = sliceRoot(undefined, { rulesDir: false });
  const r = wr(s);
  assert.equal(r.status, 0, r.all);
  assert.deepEqual(fs.readdirSync(s.rules).sort(), ['T1.md', 'T2c.md']);
  assert.deepEqual(fs.readdirSync(path.dirname(s.handoff)).sort(), ['04-senior-engineer.md', 'rules']);
});

test('a rule text over 200 characters is cut on a word boundary and ends with an ellipsis', () => {
  const s = sliceRoot();
  const long = `${'word '.repeat(60)}end`;
  fs.writeFileSync(path.join(s.root, '.company/standards.md'), standardsText().replace('Built-ins only', long));
  const r = wr(s);
  assert.equal(r.status, 0, r.all);
  const line = fs.readFileSync(path.join(s.rules, 'T1.md'), 'utf8').split('\n').find(l => l.startsWith('- proj.S1'));
  assert.equal(line, `- proj.S1 — ${'word '.repeat(39)}word…`);
});

test('a focus over 1000 characters is cut at 1000', () => {
  const s = sliceRoot([`| T1 | proj.M11; focus: ${'x'.repeat(1500)}; ${SF_SEC} |`]);
  const r = wr(s);
  assert.equal(r.status, 0, r.all);
  const line = fs.readFileSync(path.join(s.rules, 'T1.md'), 'utf8').split('\n').find(l => l.startsWith('> '));
  assert.equal(line, `> ${'x'.repeat(1000)}`);
});

test('a hand-edited slice file shows as slice stale', () => {
  const s = sliceRoot();
  wr(s);
  fs.appendFileSync(path.join(s.rules, 'T1.md'), 'extra\n');
  const r = chk(s);
  assert.equal(r.status, 1);
  assert.match(r.out, /^slice stale: T1$/m);
  assert.doesNotMatch(r.out, /T2c/);
});

test('a row without its file shows as slice missing', () => {
  const s = sliceRoot();
  wr(s);
  fs.rmSync(path.join(s.rules, 'T2c.md'));
  const r = chk(s);
  assert.equal(r.status, 1);
  assert.match(r.out, /^slice missing: T2c$/m);
});

test('a file with no row shows as slice without row', () => {
  const s = sliceRoot();
  wr(s);
  fs.writeFileSync(path.join(s.rules, 'T9.md'), 'x\n');
  const r = chk(s);
  assert.equal(r.status, 1);
  assert.match(r.out, /^slice without row: T9\.md$/m);
});

test('without a rules/ folder the check stays the old one', () => {
  const s = sliceRoot(undefined, { rulesDir: false });
  const r = chk(s);
  assert.equal(r.status, 0, r.all);
  assert.doesNotMatch(r.out, /slice (missing|stale)/);
});

test('--write replaces rules/: a task removed from the table loses its file', () => {
  const s = sliceRoot();
  wr(s);
  write(s.root, SF_REL, `${SLICE_HEAD}${SF_ROW1}\n## Next\n- done\n`);
  const r = wr(s);
  assert.equal(r.status, 0, r.all);
  assert.deepEqual(fs.readdirSync(s.rules), ['T1.md']);
});

test('a bad task ID is refused and nothing is written', () => {
  for (const id of ['../x', 'a/b', '.hidden', 'T'.repeat(17), 'T 1']) {
    const s = sliceRoot([`| ${id} | proj.M11; ${SF_SEC} |`]);
    const r = wr(s);
    assert.equal(r.status, 1, id);
    assert.match(r.out, /^refused: bad task id /m, id);
    assert.deepEqual(fs.readdirSync(s.rules), [], id);
    assert.deepEqual(fs.readdirSync(path.dirname(s.handoff)).sort(), ['04-senior-engineer.md', 'rules'], id);
  }
});

test('an unknown rule is refused and nothing is written', () => {
  const s = sliceRoot([SF_ROW1, `| T2 | proj.M11, proj.M77; ${SF_SEC} |`]);
  const r = wr(s);
  assert.equal(r.status, 1);
  assert.match(r.out, /^refused: unknown rule proj\.M77 in T2$/m);
  assert.deepEqual(fs.readdirSync(s.rules), []);
});

test('a slice over 6 KiB is refused and nothing is written', () => {
  const s = sliceRoot();
  const ids = Array.from({ length: 40 }, (_, i) => `proj.M${100 + i}`);
  const many = ids.map(id => `- ${id} — ${'z'.repeat(190)} — source: https://x.test`).join('\n');
  fs.writeFileSync(path.join(s.root, '.company/standards.md'), standardsText({ extra: `${many}\n` }));
  write(s.root, SF_REL, `${SLICE_HEAD}${SF_ROW1}\n| T3 | ${ids.join(', ')}; ${SF_SEC} |\n## Next\n- done\n`);
  const r = wr(s);
  assert.equal(r.status, 1);
  assert.match(r.out, /^refused: slice T3 over 6 KiB$/m);
  assert.deepEqual(fs.readdirSync(s.rules), []);
});

test('a duplicate task ID is refused', () => {
  const s = sliceRoot([SF_ROW1, SF_ROW1]);
  const r = wr(s);
  assert.equal(r.status, 1);
  assert.match(r.out, /^refused: duplicate task id T1$/m);
  assert.deepEqual(fs.readdirSync(s.rules), []);
});

test('a symlink in rules/ is refused and everything stays untouched', () => {
  const s = sliceRoot();
  wr(s);
  fs.appendFileSync(path.join(s.rules, 'T1.md'), 'hand edit\n');
  const edited = fs.readFileSync(path.join(s.rules, 'T1.md'), 'utf8');
  const secret = path.join(s.root, 'secret.txt');
  fs.writeFileSync(secret, 'secret\n');
  try { fs.symlinkSync(secret, path.join(s.rules, 'link.md')); } catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
    fs.symlinkSync(s.root, path.join(s.rules, 'link.md'), 'junction');
  }
  const r = wr(s);
  assert.equal(r.status, 1);
  assert.match(r.out, /^refused: unexpected entry in rules\/$/m);
  assert.equal(fs.readFileSync(path.join(s.rules, 'T1.md'), 'utf8'), edited);
  assert.equal(fs.readFileSync(secret, 'utf8'), 'secret\n');
  assert.ok(fs.lstatSync(path.join(s.rules, 'link.md')).isSymbolicLink());
});

test('a foreign entry in rules/ is refused and nothing is written', () => {
  const s = sliceRoot();
  fs.writeFileSync(path.join(s.rules, 'notes.txt'), 'mine\n');
  fs.mkdirSync(path.join(s.rules, 'sub'));
  const r = wr(s);
  assert.equal(r.status, 1);
  assert.match(r.out, /^refused: unexpected entry in rules\/$/m);
  assert.deepEqual(fs.readdirSync(s.rules).sort(), ['notes.txt', 'sub']);
});

test('a symlinked rules/ folder is refused', () => {
  const s = sliceRoot(undefined, { rulesDir: false });
  const elsewhere = path.join(s.root, 'elsewhere');
  fs.mkdirSync(elsewhere);
  try { fs.symlinkSync(elsewhere, s.rules, 'junction'); } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES') return;
    throw e;
  }
  const r = wr(s);
  assert.equal(r.status, 1);
  assert.match(r.out, /^refused: unexpected entry in rules\/$/m);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});

test('--write with no ruleset writes nothing', () => {
  const root = tmp();
  write(root, SF_REL, `${SLICE_HEAD}${SF_ROW2}\n## Next\n- done\n`);
  const r = cli(root, ['slices', path.join(root, SF_REL), '--write', '--root', root]);
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /no ruleset/);
  assert.ok(!fs.existsSync(path.join(root, '.company/work/s/rules')));
});

test('--write with a security gap still writes, prints the gap and exits 1', () => {
  const s = sliceRoot([SF_ROW1, '| T2 | proj.M5; security: proj.M-SEC1 |']);
  const r = wr(s);
  assert.equal(r.status, 1);
  assert.match(r.out, /^wrote 2 slices$/m);
  assert.match(r.out, /^T2: missing nodetest\.M-SEC1$/m);
});

test('--write is a flag of slices only, takes no value and cannot repeat', () => {
  const s = sliceRoot();
  assert.equal(cli(s.root, ['drift', '--write', '--root', s.root]).status, 2);
  assert.equal(cli(s.root, ['slices', s.handoff, '--write', '--write', '--root', s.root]).status, 2);
  assert.equal(main(['slices', s.handoff, '--write', '--root', s.root]).lines[0], 'wrote 2 slices');
});
