// Tests for the dotenv.M-SEC1 guard, hooks/rules/dotenv.mjs#judge.
// Read, Edit, Write, Grep, Glob, cat, type, gc, Get-Content, cp, symlink on `.env` / `.env.<x>` deny;
// `.env.example`, `.env.sample`, `.env.template` pass; case, backslash, relative, drive letter, UNC, 8.3.
// Pinned: judge(event) reads only the frozen hook-event v1 object (tool.paths[].raw|expanded|real,
// tool.command as fallback), never a verb: any path naming a denied .env file denies, for every tool.
// Deny = { v:'deny', rule:'dotenv.M-SEC1', message } (1-300 printable chars, never echoing a path or the command);
// pass = { v:'allow' }. Names decided: `.env`, `.env.<x>` deny except .example/.sample/.template (any case).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const ruleFile = path.join(root, 'hooks', 'rules', 'dotenv.mjs');
const fixDir = path.join(root, 'hooks', 'fixtures', 'dotenv.M-SEC1');
const RULE = 'dotenv.M-SEC1';
const SECRET = 'secretdir-q7x'; // unique marker: a deny message must never echo it

async function judge() {
  assert.ok(fs.existsSync(ruleFile), `${ruleFile} missing`);
  const m = await import(pathToFileURL(ruleFile).href);
  assert.equal(typeof m.judge, 'function', 'hooks/rules/dotenv.mjs must export judge');
  return m.judge;
}
const P = (raw, extra = {}) => ({ raw, expanded: null, real: null, exists: false, dir: false, ...extra });
function ev(name, { paths = [], command = null } = {}) {
  const e = { v: 1, event: 'PreToolUse', session: 'lead', sessionKey: 'a'.repeat(12), agentKey: null, agentType: null,
    tool: { name, command, paths, model: null, subagentType: null, outputRole: null },
    tokens: { state: 'none', total: 0 }, mainModel: null, env: { guardsOff: false, subagentModel: null, subagentModelForce: null },
    protected: [], run: null, drift: [], stopHookActive: null };
  return Object.freeze({ ...e, tool: Object.freeze({ ...e.tool, paths: Object.freeze(paths.map(Object.freeze)) }) });
}
async function expectDeny(e, label) {
  const v = await (await judge())(e, {});
  assert.equal(v.v, 'deny', `${label}: expected deny, got ${JSON.stringify(v)}`);
  assert.equal(v.rule, RULE, label);
  assert.match(v.message, /^[\x20-\x7e]{1,300}$/, `${label}: message 1-300 printable`);
  assert.ok(!v.message.includes(SECRET), `${label}: message must not echo the path`);
  assert.deepEqual(Object.keys(v).sort(), ['message', 'rule', 'v'], label);
}
async function expectAllow(e, label) {
  const v = await (await judge())(e, {});
  assert.deepEqual(v, { v: 'allow' }, `${label}: expected allow, got ${JSON.stringify(v)}`);
}

// file tools: each tool, one path that names .env
for (const tool of ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep']) {
  test(`AC6: ${tool} on .env denies`, async () => { await expectDeny(ev(tool, { paths: [P('/proj/.env')] }), tool); });
  test(`AC6: ${tool} on .env.example passes`, async () => { await expectAllow(ev(tool, { paths: [P('/proj/.env.example')] }), tool); });
}
for (const pat of ['.env', '**/.env', '.env.*', '.env*', 'src/.env.local']) {
  test(`AC6: Glob pattern ${pat} denies`, async () => { await expectDeny(ev('Glob', { paths: [P(pat)] }), pat); });
}
test('AC6: Glob of ordinary sources passes', async () => {
  await expectAllow(ev('Glob', { paths: [P('**/*.ts'), P('src')] }), 'glob ts');
});

// hostile spellings of the path (file tool and shell share the path list)
const deny = [
  ['plain', '.env'], ['absolute', `/proj/${SECRET}/.env`], ['upper', '.ENV'], ['mixed', 'Sub/.Env'],
  ['backslash', `sub\\${SECRET}\\.env`], ['double backslash', 'sub\\\\.env'], ['double slash', 'sub//.env'],
  ['relative dot', './.env'], ['relative parent', '../app/.env'], ['dot-dot inside', 'a/../.env'], ['dot-dot back', 'a/b/../../.env'],
  ['drive letter', `C:\\proj\\${SECRET}\\.env`], ['drive lower fwd', 'c:/proj/.env'], ['drive relative', 'C:.env'],
  ['UNC backslash', `\\\\server\\share\\${SECRET}\\.env`], ['UNC fwd', '//server/share/.env'],
  ['extended prefix', '\\\\?\\C:\\proj\\.env'], ['device prefix', '\\\\.\\C:\\proj\\.env'],
  ['trailing dot', '.env.'], ['trailing space', '.env '], ['trailing dots+spaces', '.env. . '],
  ['stream data', '.env::$DATA'], ['named stream', '.env:secret'],
  ['variant local', '.env.local'], ['variant production', '.env.production'], ['variant upper', '.ENV.LOCAL'],
  ['variant dot-ending', '.env.local.'], ['variant example-like', '.env.example.bak'], ['variant dev backslash', 'cfg\\.env.dev'],
];
for (const [label, raw] of deny) {
  test(`AC6: path spelling denies: ${label}`, async () => {
    await expectDeny(ev('Read', { paths: [P(raw)] }), label);
    await expectDeny(ev('Bash', { command: `cat ${raw}`, paths: [P(raw)] }), `bash ${label}`);
  });
}
test('AC6: 8.3 short name resolved by the host (real) denies', async () => {
  await expectDeny(ev('Read', { paths: [P('C:\\proj\\ENV~1', { real: 'c:/proj/.env', exists: true })] }), '8.3 real');
  await expectDeny(ev('Bash', { command: 'type ENV~1', paths: [P('ENV~1', { real: 'c:/proj/.env', exists: true })] }), '8.3 bash');
});
test('AC6: symlink whose real path is .env denies, also in a variant', async () => {
  await expectDeny(ev('Read', { paths: [P('notes/link.txt', { real: '/proj/.env', exists: true })] }), 'link real');
  await expectDeny(ev('Read', { paths: [P('notes/link.txt', { real: '/proj/.env.production', exists: true })] }), 'link real prod');
});
test('AC6: expanded home form denies (raw is a variable)', async () => {
  for (const raw of ['~/.env', '$HOME/.env', '${HOME}/.env', '$env:USERPROFILE\\.env', '%USERPROFILE%\\.env'])
    await expectDeny(ev('Read', { paths: [P(raw, { expanded: '/home/u/.env' })] }), raw);
});
test('AC6: a link whose real name is a template passes', async () => {
  await expectAllow(ev('Read', { paths: [P('notes/link.txt', { real: '/proj/.env.example', exists: true })] }), 'link to example');
});

// pass: the template names, any case, any spelling, and names that merely look alike
const pass = [
  ['example', '.env.example'], ['sample', '.env.sample'], ['template', '.env.template'],
  ['example upper', '.ENV.EXAMPLE'], ['example backslash', 'cfg\\.env.example'], ['example drive', 'C:\\proj\\.env.template'],
  ['example UNC', '\\\\server\\share\\.env.sample'], ['example relative', './../x/.env.example'], ['example trailing dot', '.env.example.'],
  ['example stream', '.env.example::$DATA'],
  ['env word', 'environment.ts'], ['no dot', 'env'], ['envrc', '.envrc'], ['dotenv lib', 'node_modules/dotenv/lib/main.js'],
  ['suffix env', 'config.env'], ['readme', 'README.md'], ['dir named like env word', 'src/env/index.ts'],
];
for (const [label, raw] of pass) {
  test(`AC6: path spelling passes: ${label}`, async () => {
    await expectAllow(ev('Read', { paths: [P(raw)] }), label);
    await expectAllow(ev('Bash', { command: `cat ${raw}`, paths: [P(raw)] }), `bash ${label}`);
  });
}

// shell verbs
const verbs = ['cat .env', 'type .env', 'type .\\.env', 'gc .env', 'Get-Content .env', 'Get-Content -Path C:\\proj\\.env',
  'get-content .ENV -Raw', 'cp .env /tmp/x', 'cp .env.production /tmp/x', 'copy .env x.txt', 'Copy-Item .env x', 'cat .env.example .env',
  'cat < .env', 'head -n1 .env', 'ln -s .env link', 'ln -s ../.env.local link', 'mklink link .env',
  'New-Item -ItemType SymbolicLink -Path link -Target .env', 'cp x .env', 'mv x .env', 'sed -n 1p .env', 'cat .env | head',
  'echo hi; cat .env', 'cd sub && cat .env', 'cat "./.env"', "cat '.env'"];
const envTokens = (command) => command.split(/\s+/).map(t => t.replace(/^["']|["']$/g, '')).filter(t => /env/i.test(t)).map(t => P(t));
for (const command of verbs) {
  test(`AC6: shell denies: ${command}`, async () => {
    await expectDeny(ev('Bash', { command, paths: envTokens(command) }), command);
    await expectDeny(ev('PowerShell', { command, paths: envTokens(command) }), `ps ${command}`);
  });
}
test('AC6: shell denies from the command text when the host path list is empty', async () => {
  for (const command of ['cat .env', 'type .\\.ENV', 'Get-Content "C:\\proj\\.env"', "gc '.env.local'"])
    await expectDeny(ev('Bash', { command, paths: [] }), command);
});
const shellPass = ['cat README.md', 'cat .env.example', 'type .env.sample', 'gc .env.template',
  'ls -la', 'git status', 'npm test', 'grep FOO src/app.ts', 'Get-Content package.json'];
for (const command of shellPass) {
  test(`AC6: shell passes: ${command}`, async () => {
    const tok = command.split(/\s+/).filter(t => /[./\\]/.test(t));
    await expectAllow(ev('Bash', { command, paths: tok.map(t => P(t)) }), command);
  });
}

// Edges of the rule function (mod-hook v1 Rule function)
test('AC6: events without a tool, or with no path, allow', async () => {
  const none = Object.freeze({ ...ev('Read'), tool: null, event: 'SubagentStart' });
  await expectAllow(none, 'tool null');
  await expectAllow(ev('Read', { paths: [] }), 'no paths');
  await expectAllow(ev('Bash', { command: null, paths: [] }), 'null command');
});
test('AC6: one denied path among many denies; 64 clean paths pass', async () => {
  const many = Array.from({ length: 63 }, (_, i) => P(`src/f${i}.ts`));
  await expectDeny(ev('Bash', { command: 'cat a b', paths: [...many, P('.env')] }), 'last of 64');
  await expectAllow(ev('Bash', { command: 'cat a', paths: [...many, P('src/last.ts')] }), '64 clean');
});
test('AC6: a Step session is judged the same as the Lead', async () => {
  const e = ev('Read', { paths: [P('.env')] });
  await expectDeny(Object.freeze({ ...e, session: 'step', agentKey: 'b'.repeat(12), agentType: 'qa' }), 'step');
});
test('AC6: odd tool.paths entries never throw and never produce a note', async () => {
  const j = await judge();
  for (const paths of [[{ raw: null }], [{}], [null], 'x']) {
    const e = Object.freeze({ ...ev('Read'), tool: Object.freeze({ name: 'Read', command: 'cat .env', paths, model: null, subagentType: null, outputRole: null }) });
    let v; try { v = await j(e, {}); } catch { v = { v: 'threw' }; }
    assert.notEqual(v.v, 'threw', 'must not throw on odd paths');
    assert.notEqual(v.v, 'note', 'a guard never notes');
  }
});
test('AC6/AC21: the rule is pure and does not mutate the event', async () => {
  const src = fs.readFileSync(ruleFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\b(?:fs|child_process|process|fetch|XMLHttpRequest)\b|\bimport\(|\brequire\(/, 'no fs, process, net or dynamic import');
  const e = ev('Read', { paths: [P('.env')] });
  const before = JSON.stringify(e);
  await judge().then(j => j(e, {}));
  assert.equal(JSON.stringify(e), before);
});

// Fixtures: hooks/fixtures/dotenv.M-SEC1/{pass,block}-*.json are raw hook payloads (hook-event v1 Raw input)
const toEvent = (raw) => {
  const ti = raw.tool_input || {};
  const paths = [ti.file_path, ti.notebook_path, ti.path, ti.pattern].filter(x => typeof x === 'string').map(x => P(x));
  if (typeof ti.command === 'string') for (const t of ti.command.split(/\s+/)) if (/[.\\/]/.test(t)) paths.push(P(t));
  return ev(raw.tool_name, { paths, command: typeof ti.command === 'string' ? ti.command : null });
};
test('AC4: fixtures hold at least one pass-*.json and one block-*.json of raw payloads', () => {
  assert.ok(fs.existsSync(fixDir), 'fixture folder missing');
  const files = fs.readdirSync(fixDir);
  assert.ok(files.some(f => /^pass-.+\.json$/.test(f)), 'no pass fixture');
  assert.ok(files.some(f => /^block-.+\.json$/.test(f)), 'no block fixture');
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(fixDir, f), 'utf8'));
    assert.equal(j.hook_event_name, 'PreToolUse', f);
    assert.equal(typeof j.tool_name, 'string', f);
    assert.equal(typeof j.tool_input, 'object', f);
  }
});
test('AC4/AC6: every pass fixture allows and every block fixture denies', async () => {
  for (const f of fs.readdirSync(fixDir).filter(n => n.endsWith('.json'))) {
    const e = toEvent(JSON.parse(fs.readFileSync(path.join(fixDir, f), 'utf8')));
    if (f.startsWith('pass-')) await expectAllow(e, f);
    else if (f.startsWith('block-')) await expectDeny(e, f);
    else assert.fail(`fixture ${f} must be pass-* or block-*`);
  }
});
