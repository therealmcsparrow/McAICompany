import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeEnv, startLead, cleanup } from '../hooks/fixtures/engine/harness.mjs';

// Tests for the self-protect guard (rule self-protect.M-SEC1): file tools, shell, guard keys and evasion.
// Seam: hooks/rules/self-protect.mjs#judge(event, snapshot) -> verdict (mod-hook v1, hook-event v1). Every
// pass and deny form. The tests build normalized events by
// hand, with tool.paths filled the way the host does (expanded, real, junction), and never
// touch the engine, so they hold the rule alone.

const root = path.resolve(import.meta.dirname, '..');
const RULE = 'self-protect.M-SEC1';
const FIX = path.join(root, 'hooks', 'fixtures', RULE);

const HOME = 'C:/Users/test';
const MSH = `${HOME}/.mcsparrow`;
const PLUGIN = `${HOME}/.claude/plugins/cache/aico/aico/0.39.0`;
const PROJ = 'C:/proj';
const protectedFor = (msh = MSH) => [
  `${msh}/config.json`, `${msh}/hook-snapshots`, PLUGIN, `${HOME}/.claude/settings.json`,
  `${HOME}/.claude/settings.local.json`, `${PROJ}/.claude/settings.json`, `${PROJ}/.claude/settings.local.json`,
  `${PROJ}/.company/settings.json`, `${PROJ}/.company/work/p1/guard.jsonl`,
  `${PROJ}/.company/work/p1/01-feature/guard.jsonl`,
].map((p) => p.toLowerCase());

async function load() {
  const file = path.join(root, 'hooks', 'rules', 'self-protect.mjs');
  assert.ok(fs.existsSync(file), 'hooks/rules/self-protect.mjs exists');
  const mod = await import(pathToFileURL(file).href);
  assert.equal(typeof mod.judge, 'function', 'self-protect.mjs exports judge');
  return mod.judge;
}

// Host simulation (hook-event v1 tool.paths): expanded = raw with a leading home or aico
// variable replaced; real = the real path of expanded-or-raw against cwd, junctions followed.
function expand(raw, msh) {
  const forms = [
    [/^(?:~|\$HOME|\$\{HOME\}|\$env:HOME|\$env:USERPROFILE|%USERPROFILE%|%HOMEDRIVE%%HOMEPATH%)(?=[\\/]|$)/i, HOME],
    [/^(?:\$MCSPARROW_HOME|\$\{MCSPARROW_HOME\}|\$env:MCSPARROW_HOME|%MCSPARROW_HOME%)(?=[\\/]|$)/i, msh],
    [/^(?:\$CLAUDE_PLUGIN_ROOT|\$\{CLAUDE_PLUGIN_ROOT\}|\$env:CLAUDE_PLUGIN_ROOT|%CLAUDE_PLUGIN_ROOT%)(?=[\\/]|$)/i, PLUGIN],
  ];
  for (const [re, val] of forms) if (re.test(raw)) return raw.replace(re, val);
  return null;
}
function realOf(raw, { msh, cwd, links }) {
  const base = expand(raw, msh) ?? raw;
  let p = base.replaceAll('\\', '/');
  if (!/^[A-Za-z]:\//.test(p) && !p.startsWith('/')) p = `${cwd}/${p}`;
  p = path.posix.normalize(p);
  for (const [from, to] of Object.entries(links)) {
    if (p.toLowerCase() === from.toLowerCase() || p.toLowerCase().startsWith(`${from.toLowerCase()}/`)) p = to + p.slice(from.length);
  }
  return p;
}
function entry(raw, o) {
  return { raw, expanded: expand(raw, o.msh), real: realOf(raw, o), exists: o.exists, dir: false };
}
function pathsOfCommand(command, o) {
  const toks = command.match(/"[^"]*"|'[^']*'|[^\s;&|(){}<>]+/g) ?? [];
  return toks.map((t) => t.replace(/^["']|["']$/g, ''))
    .filter((t) => t && !t.startsWith('-') && /[\\/~$%.]/.test(t))
    .slice(0, 64).map((t) => entry(t, o));
}
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}
const FILE_ONLY = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Read', 'Grep', 'Glob'];
function evRaw(spec, opts = {}) {
  const o = { msh: MSH, cwd: PROJ, links: {}, exists: true, session: 'lead', tool: 'Bash', ...opts };
  const isFile = FILE_ONLY.includes(o.tool);
  return {
    v: 1, event: 'PreToolUse', session: o.session, sessionKey: 'aaaaaaaaaaaa', agentKey: o.session === 'step' ? 'bbbbbbbbbbbb' : null,
    agentType: null,
    tool: { name: o.tool, command: isFile ? null : spec, paths: isFile ? [entry(spec, o)] : pathsOfCommand(spec, o), model: null, subagentType: null, outputRole: null },
    tokens: { state: 'none', total: 0 }, mainModel: null,
    env: { guardsOff: false, subagentModel: null, subagentModelForce: null },
    protected: protectedFor(o.msh), run: null, drift: [], stopHookActive: null,
  };
}
const ev = (spec, opts) => deepFreeze(evRaw(spec, opts));
const SNAP = deepFreeze({ v: 1, at: 'x', threshold: 100000, savers: {}, floor: {}, drift: false, settingsWarnings: [] });

async function verdict(spec, opts, snap = SNAP) {
  const judge = await load();
  const v = await judge(ev(spec, opts), snap);
  assert.ok(v && typeof v === 'object', 'judge returns a verdict object');
  return v;
}
async function denies(spec, opts, snap) {
  const v = await verdict(spec, opts, snap);
  assert.equal(v.v, 'deny', `deny: ${spec} (got ${JSON.stringify(v)})`);
  assert.equal(v.rule, RULE);
  assert.ok(typeof v.message === 'string' && v.message.length >= 1 && v.message.length <= 300, 'message 1-300 chars');
  assert.ok(!v.message.includes(spec), 'the deny message never echoes the input');
  assert.ok(!/AICO_GUARDS/.test(v.message), 'the off switch is never named in deny text');
}
async function allows(spec, opts, snap) {
  const v = await verdict(spec, opts, snap);
  assert.deepEqual(v, { v: 'allow' }, `allow: ${spec}`);
}
const SH = ['Bash', 'PowerShell'];

// ---------- file tools ----------
const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const PROTECTED_TARGETS = [
  `${MSH}/config.json`, '~/.mcsparrow/config.json', '$HOME/.mcsparrow/config.json', '${HOME}/.mcsparrow/config.json',
  '$env:USERPROFILE\\.mcsparrow\\config.json', '%USERPROFILE%\\.mcsparrow\\config.json', '$env:MCSPARROW_HOME/config.json',
  `${HOME}/.claude/settings.json`, `${HOME}/.claude/settings.local.json`, '~/.claude/settings.json',
  'C:/proj/.claude/settings.json', 'C:/proj/.claude/settings.local.json', 'C:/proj/.company/settings.json',
  '.claude/settings.json', '.company/settings.json', 'C:/proj/.company/work/p1/guard.jsonl',
  `${PLUGIN}/hooks/rules/cap.mjs`, `${PLUGIN}/hooks/pins.json`, `${PLUGIN}/hooks/hooks.json`, `${PLUGIN}/hooks/manifests/cache-tax.json`,
  '$CLAUDE_PLUGIN_ROOT/hooks/rules.json', '${CLAUDE_PLUGIN_ROOT}/hooks/rules/cap.mjs', '$env:CLAUDE_PLUGIN_ROOT\\hooks\\hooks.json',
  `${MSH}/hook-snapshots/abc123/denies.jsonl`,
  // path spelling tricks: backslashes, case, dot segments, trailing dot, stream suffix
  'C:\\Users\\test\\.mcsparrow\\config.json', 'C:/USERS/TEST/.MCSPARROW/CONFIG.JSON',
  'C:/Users/test/.mcsparrow/./x/../config.json', 'C:/Users/test/.mcsparrow/config.json.', 'C:/Users/test/.mcsparrow/config.json::$DATA',
  'C:/Users/test/.mcsparrow//config.json',
];
for (const tool of FILE_TOOLS) for (const p of PROTECTED_TARGETS) {
  test(`AC8 deny ${tool}: ${p}`, async () => { await denies(p, { tool }); });
}
test('AC8 deny: a Write to a protected path in a Step session too', async () => {
  await denies('~/.mcsparrow/config.json', { tool: 'Write', session: 'step' });
  await denies('.company/settings.json', { tool: 'Edit', session: 'step' });
});
test('AC8 deny: a new file in the snapshot folder (real of the nearest existing ancestor)', async () => {
  for (const tool of FILE_TOOLS) {
    await denies(`${MSH}/hook-snapshots/newroot/steps/new.json`, { tool, exists: false });
    await denies('~/.mcsparrow/hook-snapshots/newroot/denies.jsonl', { tool, exists: false });
    await denies(`${PLUGIN}/hooks/rules/brand-new.mjs`, { tool, exists: false });
  }
});
test('AC8 deny: a Write through a junction whose real path is protected', async () => {
  const links = { 'C:/proj/link': MSH, 'C:/proj/pl': PLUGIN };
  for (const tool of FILE_TOOLS) {
    await denies('C:/proj/link/config.json', { tool, links });
    await denies('link/config.json', { tool, links });
    await denies('C:/proj/pl/hooks/rules/cap.mjs', { tool, links });
  }
});
test('AC8 deny: a MCSPARROW_HOME elsewhere is protected through its variable and its real path', async () => {
  const msh = 'D:/data/mcs';
  await denies('$env:MCSPARROW_HOME/config.json', { tool: 'Write', msh });
  await denies('D:/data/mcs/config.json', { tool: 'Edit', msh });
  await denies('$MCSPARROW_HOME/hook-snapshots/r/steps/s.json', { tool: 'Write', msh, exists: false });
});
test('AC8 pass: file tools on ordinary paths', async () => {
  for (const tool of FILE_TOOLS) {
    for (const p of ['src/a.js', 'C:/proj/src/a.js', 'C:/proj/.company/work/p1/01-x.md', 'C:/proj/.company/project.md',
      'C:/proj/.claude/CLAUDE.md', `${HOME}/.mcsparrow-other/config.json`, `${HOME}/.mcsparrow/other.json`,
      'config.json', 'C:/proj/config.json', 'C:/proj/.claude/settings.json.bak', 'C:/proj/.claude2/settings.json',
      `${PLUGIN}-copy/hooks/rules/cap.mjs`, `${HOME}/.claude/projects/x/memory.md`, 'hooks/rules/cap.mjs'])
      await allows(p, { tool });
  }
});
test('AC8 pass: read tools on protected paths (R-1: read verbs pass)', async () => {
  for (const tool of ['Read', 'Grep', 'Glob']) {
    for (const p of ['~/.mcsparrow/config.json', `${PLUGIN}/hooks/rules/cap.mjs`, 'C:/proj/.claude/settings.json', `${MSH}/hook-snapshots`])
      await allows(p, { tool });
  }
});
test('AC8 pass: an empty path list and an absent tool', async () => {
  const judge = await load();
  const a = evRaw('x', { tool: 'Write' });
  a.tool.paths = [];
  assert.deepEqual(await judge(deepFreeze(a), SNAP), { v: 'allow' });
  const b = evRaw('x', { tool: 'Write' });
  b.tool = null;
  assert.deepEqual(await judge(deepFreeze(b), SNAP), { v: 'allow' });
});

// ---------- shell passes (running a plugin script is not a write) ----------
const NODE = `node "${PLUGIN}/scripts`;
const SH_PASS = [
  `node "${PLUGIN}/scripts/run.mjs" run-state triage issue`,
  `node "$CLAUDE_PLUGIN_ROOT/scripts/run.mjs" run-state triage issue`,
  `${NODE}/ledger.mjs" status`, `${NODE}/handoff-lint.mjs" x.md`, `${NODE}/rule-check.mjs" src`,
  `${NODE}/hook-check.mjs" setup`, `${NODE}/hook-check.mjs" denies --session aaaaaaaaaaaa --json`,
  `${NODE}/settings.mjs" get cap`, `${NODE}/settings.mjs" get`, `${NODE}/settings.mjs" serve`,
  `${NODE}/settings.mjs" model-env`,
  'node scripts/settings.mjs get mods', 'node scripts/ledger.mjs baseline --before 0.40.0 --json',
  'cat ~/.mcsparrow/config.json', 'type %USERPROFILE%\\.mcsparrow\\config.json', 'ls ~/.mcsparrow', 'ls -la $HOME/.mcsparrow/hook-snapshots',
  'head -5 .claude/settings.json', 'grep -r guard "$CLAUDE_PLUGIN_ROOT/hooks"', 'diff ~/.mcsparrow/config.json x.json',
  'cp ~/.mcsparrow/config.json /tmp/backup.json', 'cp $CLAUDE_PLUGIN_ROOT/hooks/rules.json ./copy.json',
  'git status', 'git diff', 'echo hi', 'node --test scripts/a.test.mjs', 'npm test', 'echo x > out.txt', 'echo x >> notes/log.md',
  'rm tmp/a.txt', 'mv a.txt b.txt', 'sed -i s/a/b/ src/a.js', 'tee out.txt < in.txt',
  'node -e "console.log(1)"', 'python -c "print(1)"', 'python3 -c "import sys; print(sys.argv)"', 'perl -e "print 1"',
  'cd src && echo x > out.txt', 'cd ~/.mcsparrow; cat config.json', 'cd ~/.mcsparrow && ls', 'pushd src; cat config.json',
  'cd sub; echo x > a.json',
];
for (const c of SH_PASS) for (const tool of SH) {
  test(`AC8 pass ${tool}: ${c}`, async () => { await allows(c, { tool }); });
}
const PS_PASS = [
  'Get-Content $env:USERPROFILE\\.mcsparrow\\config.json', 'Get-ChildItem $env:MCSPARROW_HOME',
  'Set-Content out.txt x', 'Out-File notes.md', 'Add-Content log.md x', 'Remove-Item tmp\\a.txt',
  'Copy-Item $env:USERPROFILE\\.mcsparrow\\config.json .\\backup.json', 'Set-Location src; Set-Content out.txt x',
  'Set-Location $env:USERPROFILE\\.mcsparrow; Get-Content config.json',
];
for (const c of PS_PASS) test(`AC8 pass PowerShell: ${c}`, async () => { await allows(c, { tool: 'PowerShell' }); });

// ---------- shell passes: ADR 0079, the guard judges a shell command only for a run-record write ----------
const SET_MOD = [
  `node "${PLUGIN}/scripts/settings.mjs" set-mod switchboard enabled false`,
  'node scripts/settings.mjs set-mod cache_tax enabled false', 'node settings.mjs set-mod switchboard seen',
  'node "$CLAUDE_PLUGIN_ROOT/scripts/settings.mjs" set-mod x y z', 'node ${CLAUDE_PLUGIN_ROOT}/scripts/settings.mjs set-mod x y',
  'node C:\\p\\scripts\\settings.mjs set-mod a b', 'FOO=1 node scripts/settings.mjs set-mod a b',
  'cd scripts && node settings.mjs set-mod a b', 'node scripts/settings.mjs get cap; node scripts/settings.mjs set-mod a b',
  'echo ok && node scripts/settings.mjs set-mod a b',
];
for (const c of SET_MOD) for (const tool of SH) test(`AC8 pass ${tool}: set-mod: ${c}`, async () => { await allows(c, { tool }); });
const PINS = [
  `node "${PLUGIN}/scripts/hook-pins.mjs" write`, 'node scripts/hook-pins.mjs check', 'node scripts/hook-pins.mjs',
  'node "$CLAUDE_PLUGIN_ROOT/scripts/hook-pins.mjs" write', 'node scripts/hook-pins.mjs --help', 'node hook-pins.mjs write; echo done',
  'git status && node scripts/hook-pins.mjs verify',
];
for (const c of PINS) for (const tool of SH) test(`AC8 pass ${tool}: hook-pins: ${c}`, async () => { await allows(c, { tool }); });

const WRITES = [
  'echo x > ~/.mcsparrow/config.json', 'echo x >> ~/.mcsparrow/config.json', 'echo x>~/.mcsparrow/config.json',
  'echo x > $HOME/.mcsparrow/config.json', 'echo x > ${HOME}/.mcsparrow/config.json', 'echo x > "$HOME/.mcsparrow/config.json"',
  'echo x > $env:USERPROFILE\\.mcsparrow\\config.json', 'echo x > %USERPROFILE%\\.mcsparrow\\config.json',
  'echo x > %HOMEDRIVE%%HOMEPATH%\\.mcsparrow\\config.json', 'echo x > $env:HOME/.mcsparrow/config.json',
  'echo x > $env:MCSPARROW_HOME/config.json', 'echo x > $MCSPARROW_HOME/config.json', 'echo x > ${MCSPARROW_HOME}/config.json',
  'echo x > %MCSPARROW_HOME%\\config.json', 'echo x > C:\\Users\\test\\.mcsparrow\\config.json',
  'echo x | tee ~/.mcsparrow/config.json', 'echo x | tee -a $HOME/.mcsparrow/config.json',
  'cp a.json ~/.mcsparrow/config.json', 'cp -f a.json $HOME/.mcsparrow/config.json', 'mv a.json ~/.mcsparrow/config.json',
  'ln -s a.json ~/.mcsparrow/config.json', 'rm ~/.mcsparrow/config.json', 'rm -f $HOME/.claude/settings.json',
  'del %USERPROFILE%\\.claude\\settings.json', 'copy a.json %USERPROFILE%\\.mcsparrow\\config.json', 'move a.json %USERPROFILE%\\.mcsparrow\\config.json',
  'mklink %USERPROFILE%\\.mcsparrow\\config.json a.json',
  'sed -i s/a/b/ ~/.mcsparrow/config.json', 'sed -i "s/a/b/" $HOME/.claude/settings.json',
  'git checkout -- .claude/settings.json', 'git restore .company/settings.json', 'git checkout HEAD -- .claude/settings.local.json',
  'echo x > .claude/settings.json', 'echo x > .company/settings.json', 'echo x >> .claude/settings.local.json',
  'echo x > $CLAUDE_PLUGIN_ROOT/hooks/rules.json', 'rm -rf $CLAUDE_PLUGIN_ROOT/hooks/rules', 'rm -rf ~/.mcsparrow/hook-snapshots',
  'cp x.mjs $CLAUDE_PLUGIN_ROOT/hooks/rules/cap.mjs', 'echo x > ~/.mcsparrow/hook-snapshots/r/denies.jsonl',
  'cat a.json > ~/.mcsparrow/config.json',
  'echo x > "C:/Users/test/.mcsparrow/config.json"', "echo x > 'C:/Users/test/.mcsparrow/config.json'",
  'echo x > C:\\USERS\\TEST\\.MCSPARROW\\CONFIG.JSON', 'echo x > ~/.mcsparrow/config.json.',
  'true && echo x > ~/.mcsparrow/config.json', 'echo hi; rm ~/.mcsparrow/config.json', 'git status | tee ~/.mcsparrow/config.json',
];
for (const c of WRITES) for (const tool of SH) test(`AC8 pass ${tool}: write form: ${c}`, async () => { await allows(c, { tool }); });
const PS_WRITES = [
  'Set-Content $env:USERPROFILE\\.mcsparrow\\config.json x', 'Set-Content -Path $env:USERPROFILE\\.mcsparrow\\config.json -Value x',
  'Add-Content $env:USERPROFILE\\.mcsparrow\\config.json x', '"x" | Out-File $env:USERPROFILE\\.mcsparrow\\config.json',
  'Out-File -FilePath $env:MCSPARROW_HOME\\config.json', 'Set-Content ~\\.mcsparrow\\config.json x', 'Set-Content $HOME\\.mcsparrow\\config.json x',
  'Copy-Item a.json $env:USERPROFILE\\.mcsparrow\\config.json', 'Move-Item a.json $env:MCSPARROW_HOME\\config.json',
  'Remove-Item $env:USERPROFILE\\.mcsparrow\\config.json', 'Remove-Item -Force $env:USERPROFILE\\.claude\\settings.json',
  'New-Item -ItemType SymbolicLink -Path $env:USERPROFILE\\.mcsparrow\\config.json -Target a.json',
  'New-Item -ItemType Junction -Path $env:USERPROFILE\\.mcsparrow\\hook-snapshots -Target x',
  'New-Item -ItemType HardLink -Path $env:USERPROFILE\\.mcsparrow\\config.json -Target a.json',
  'Set-Content $env:CLAUDE_PLUGIN_ROOT\\hooks\\hooks.json x', 'Remove-Item -Recurse $env:CLAUDE_PLUGIN_ROOT\\hooks',
  'Set-Content .claude\\settings.json x', 'Set-Content .company\\settings.json x', 'Set-Content %USERPROFILE%\\.mcsparrow\\config.json x',
  'Get-Date; Set-Content $env:USERPROFILE\\.mcsparrow\\config.json x', 'echo x > $env:USERPROFILE\\.mcsparrow\\config.json',
];
for (const c of PS_WRITES) test(`AC8 pass PowerShell: write form: ${c}`, async () => { await allows(c, { tool: 'PowerShell' }); });

test('AC8 pass: a shell copy whose target is protected only through a junction (real) is not judged', async () => {
  const links = { 'C:/proj/link': MSH };
  await allows('cp a.json link/config.json', { links });
  await allows('echo x > link/config.json', { links });
  await allows('echo x > C:/proj/link/config.json', { links });
  await allows('Set-Content link\\config.json x', { links, tool: 'PowerShell' });
  await allows('rm link/config.json', { links });
});
test('AC8 pass: a new file in the snapshot folder from a shell is not judged', async () => {
  await allows('echo x > ~/.mcsparrow/hook-snapshots/newroot/steps/new.json', { exists: false });
  await allows('cp a.json $HOME/.mcsparrow/hook-snapshots/n/steps/s.json', { exists: false });
  await allows('Set-Content $env:USERPROFILE\\.mcsparrow\\hook-snapshots\\n\\x.json x', { exists: false, tool: 'PowerShell' });
});

// ---------- evasion: inline interpreters ----------
const INLINE = [
  `node -e "require('fs').writeFileSync(process.env.HOME+'/.mcsparrow/config.json','{}')"`,
  `node --eval "fs.writeFileSync('config.json','{}')"`, `node -p "fs.writeFileSync('config.json','{}')"`, `node --print "'config.json'"`,
  `node -e "fs.writeFileSync('settings.json','{}')"`, `node -e "fs.writeFileSync('settings.local.json','{}')"`,
  `node -e "x('.mcsparrow')"`, `node -e "process.env.MCSPARROW_HOME"`, `node -e "x('hook-snapshots')"`, `node -e "x('pins.json')"`,
  `node -e "x('rules.json')"`, `node -e "process.env.CLAUDE_PLUGIN_ROOT"`, `node -e "x('.claude')"`,
  `node -e "x('plugins/cache')"`,
  `python -c "open('config.json','w').write('{}')"`, `python3 -c "open('config.json','w')"`, `py -c "open('config.json','w')"`,
  `python -c "import os; open(os.environ['MCSPARROW_HOME']+'/x','w')"`,
  `pwsh -c "Set-Content config.json x"`, `powershell -c "Set-Content config.json x"`, `pwsh -Command "Set-Content config.json x"`,
  `powershell -Command "Set-Content settings.json x"`, `powershell.exe -NoProfile -Command "x .mcsparrow"`,
  `bash -c "echo x > config.json"`, `sh -c 'echo x > ~/.mcsparrow/config.json'`, `cmd /c "echo x > config.json"`,
  `perl -e "open F, '>config.json'"`, `ruby -e "File.write('config.json','x')"`,
  `iex "Set-Content config.json x"`, `Invoke-Expression "Set-Content config.json x"`, `& iex 'x .mcsparrow'`,
  `node -e "x('CONFIG.JSON')"`,
];
for (const c of INLINE) for (const tool of SH) test(`evasion pass ${tool}: inline interpreter: ${c}`, async () => { await allows(c, { tool }); });

test('evasion pass: -EncodedCommand that decodes to no record path (ADR 0079)', async () => {
  for (const c of ['powershell -EncodedCommand SQBFAFgA', 'pwsh -EncodedCommand ZQBjAGgAbwA=', 'powershell.exe -NoProfile -EncodedCommand AAAA',
    'powershell -encodedcommand AAAA', 'pwsh -enc AAAA -NoProfile', 'powershell -e AAAA', 'pwsh -ec AAAA'])
    for (const tool of SH) await allows(c, { tool });
});
test('evasion pass: inline text naming a settings word hides in a longer command', async () => {
  await allows('echo start; node -e "x(\'config.json\')"; echo end');
  await allows('cd src && python -c "open(\'.mcsparrow/config.json\',\'w\')"');
  await allows('npm test && node -e "x(\'config.json\')"');
});

// ---------- evasion: directory change plus a relative write ----------
const CD = [
  'cd ~/.mcsparrow; echo x > config.json', 'cd ~/.mcsparrow && echo x > config.json', 'cd $HOME/.mcsparrow; echo x >> config.json',
  'cd %USERPROFILE%\\.mcsparrow && echo x > config.json', 'cd "$HOME/.mcsparrow" && sed -i s/a/b/ config.json',
  'pushd ~/.mcsparrow && echo x > config.json', 'chdir ~/.mcsparrow && echo x > config.json',
  'cd ~/.mcsparrow; cp ../a.json config.json', 'cd ~/.mcsparrow; rm config.json', 'cd ~/.mcsparrow; mv a.json config.json',
  'cd ~/.claude; echo x > settings.json', 'cd ~/.claude && echo x > settings.local.json', 'cd .claude; echo x > settings.json',
  'cd .company && echo x > settings.json', 'cd $CLAUDE_PLUGIN_ROOT/hooks; echo x > rules.json', 'cd $CLAUDE_PLUGIN_ROOT/hooks && echo x > pins.json',
  'cd $CLAUDE_PLUGIN_ROOT/hooks && echo x > hooks.json', 'cd ~/.mcsparrow && echo x | tee config.json',
  'cd ~/.mcsparrow/hook-snapshots/r && echo x > denies.jsonl', 'cd /somewhere && echo x > config.json',
];
for (const c of CD) for (const tool of SH) test(`evasion pass ${tool}: cd plus relative write: ${c}`, async () => { await allows(c, { tool }); });
const PS_CD = [
  'Set-Location $env:USERPROFILE\\.mcsparrow; Set-Content config.json x', 'Set-Location $env:USERPROFILE\\.mcsparrow; "x" | Out-File config.json',
  'sl ~\\.mcsparrow; Set-Content config.json x', 'Push-Location $env:MCSPARROW_HOME; Add-Content config.json x',
  'cd $env:USERPROFILE\\.claude; Set-Content settings.json x', 'Set-Location $env:USERPROFILE\\.mcsparrow; echo x > config.json',
  'Set-Location $env:USERPROFILE\\.mcsparrow; Remove-Item config.json', 'chdir ~\\.mcsparrow; Set-Content config.json x',
];
for (const c of PS_CD) test(`evasion pass PowerShell: Set-Location plus relative write: ${c}`, async () => { await allows(c, { tool: 'PowerShell' }); });

// ---------- evasion: path spelling in a shell ----------
test('evasion pass: shell write to a settings target behind dot segments, redundant slashes and case', async () => {
  for (const c of ['echo x > ~/.mcsparrow/./config.json', 'echo x > ~/.mcsparrow/../.mcsparrow/config.json',
    'echo x > ~//.mcsparrow//config.json', 'echo x > C:/Users/test/.MCSPARROW/Config.Json', 'echo x > c:\\users\\test\\.mcsparrow\\config.json',
    'echo x > C:/Users/test/.mcsparrow/config.json:stream', 'echo x > C:/Users/test/.mcsparrow/config.json ', 'echo x > C:/Users/test/.mcsparrow/config.json...'])
    for (const tool of SH) await allows(c, { tool });
});

// ---------- a hand-written guard key changes nothing ----------
test('AC15: the verdict ignores any snapshot key that tries to switch the guard off', async () => {
  const hand = deepFreeze({ ...SNAP, guards: { 'self-protect': false }, guardsOff: true, selfProtect: 'off', savers: { 'self-protect': { enabled: false } },
    settingsWarnings: ['self-protect off'], 'self-protect': { enabled: false } });
  await denies('~/.mcsparrow/config.json', { tool: 'Write' }, hand);
  await allows('echo x > ~/.mcsparrow/config.json', {}, hand);
  await allows('node scripts/settings.mjs set-mod switchboard enabled false', {}, hand);
  await allows('src/a.js', { tool: 'Write' }, hand);
});
test('AC15: a Write that would hand-edit a switch or the threshold into settings is denied, whatever it says; the same text from a shell passes', async () => {
  for (const p of ['~/.mcsparrow/config.json', 'C:/proj/.company/settings.json', 'C:/proj/.claude/settings.json', `${HOME}/.claude/settings.local.json`])
    for (const tool of FILE_TOOLS) await denies(p, { tool });
  await allows('echo {"guards":{"cap":false},"mods":{"switchboard":{"enabled":false}}} > ~/.mcsparrow/config.json');
});
test('AC15: the event env switch does not weaken the judge (the engine handles the Lead off switch, the rule never reads it)', async () => {
  const judge = await load();
  const e = evRaw('~/.mcsparrow/config.json', { tool: 'Write', session: 'step' });
  e.env.guardsOff = true;
  const v = await judge(deepFreeze(e), SNAP);
  assert.equal(v.v, 'deny');
  assert.equal(v.rule, RULE);
});

// ---------- scope and shape ----------
test('an empty protected list: set-mod and hook-pins pass, a path write has nothing to match', async () => {
  const judge = await load();
  const e = evRaw('node scripts/settings.mjs set-mod a b');
  e.protected = [];
  assert.deepEqual(await judge(deepFreeze(e), SNAP), { v: 'allow' });
  const e2 = evRaw('node scripts/hook-pins.mjs write');
  e2.protected = [];
  assert.deepEqual(await judge(deepFreeze(e2), SNAP), { v: 'allow' });
  const f = evRaw('~/.mcsparrow/config.json', { tool: 'Write' });
  f.protected = [];
  assert.deepEqual(await judge(deepFreeze(f), SNAP), { v: 'allow' });
});
test('other tools and an absent command pass', async () => {
  const judge = await load();
  for (const tool of ['Task', 'Agent', 'WebFetch', 'TodoWrite']) {
    const e = evRaw('node scripts/settings.mjs set-mod a b');
    e.tool.name = tool;
    assert.deepEqual(await judge(deepFreeze(e), SNAP), { v: 'allow' }, tool);
  }
  const n = evRaw('x');
  n.tool.command = null; n.tool.paths = [];
  assert.deepEqual(await judge(deepFreeze(n), SNAP), { v: 'allow' });
});
test('the verdict is a plain allow-list object, the frozen event is left unchanged, no promise leak', async () => {
  const judge = await load();
  const e = ev('~/.mcsparrow/config.json', { tool: 'Write' });
  const before = JSON.stringify(e);
  const v = await judge(e, SNAP);
  assert.deepEqual(Object.keys(v).sort(), ['message', 'rule', 'v']);
  assert.equal(JSON.stringify(e), before);
  assert.equal(typeof v.then, 'undefined');
});
test('judge is deterministic: the same event twice gives the same verdict', async () => {
  const judge = await load();
  assert.deepEqual(await judge(ev('echo x > ~/.mcsparrow/config.json'), SNAP), await judge(ev('echo x > ~/.mcsparrow/config.json'), SNAP));
});
test('the deny message names no path or value from the input', async () => {
  const v = await verdict('~/.mcsparrow/config.json', { tool: 'Write' });
  assert.ok(!/config\.json|\.mcsparrow|C:/i.test(v.message), `message leaks a path: ${v.message}`);
});

// ---------- fixtures: per-rule folder, one pass and one block at least ----------
function fixtures() {
  assert.ok(fs.existsSync(FIX), 'hooks/fixtures/self-protect.M-SEC1/ exists');
  return fs.readdirSync(FIX).filter((f) => f.endsWith('.json'));
}
const readFx = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
const specOf = (j) => (SH.includes(j.tool_name) ? j.tool_input.command : (j.tool_input.file_path ?? j.tool_input.notebook_path));
test('AC4 fixtures: at least one pass-*.json and one block-*.json, names only pass-/block-', () => {
  const files = fixtures();
  assert.ok(files.some((f) => f.startsWith('pass-')), 'a pass fixture');
  assert.ok(files.some((f) => f.startsWith('block-')), 'a block fixture');
  for (const f of files) assert.match(f, /^(pass|block)-[a-z0-9-]+\.json$/);
});
test('AC4 fixtures: synthetic PreToolUse payloads of the allow-list, no real session values', () => {
  for (const f of fixtures()) {
    const j = readFx(f);
    assert.equal(j.hook_event_name, 'PreToolUse');
    assert.ok(['Bash', 'PowerShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Read'].includes(j.tool_name), `${f} tool_name`);
    assert.equal(j.session_id, 'fixture');
    assert.equal(typeof specOf(j), 'string', f);
    assert.ok(!('agent_id' in j) || /^[A-Za-z0-9_-]+$/.test(j.agent_id));
    assert.ok(!/[A-Za-z]:[\\/]Users[\\/](?!test)/i.test(JSON.stringify(j)), `${f} holds no real user path`);
  }
});
test('AC4 fixtures: judge allows each pass-* and denies each block-* with rule self-protect.M-SEC1', async () => {
  const judge = await load();
  for (const f of fixtures()) {
    const j = readFx(f);
    const v = await judge(ev(specOf(j), { tool: j.tool_name, exists: !/hook-snapshots/.test(specOf(j)), session: j.agent_id ? 'step' : 'lead' }), SNAP);
    if (f.startsWith('pass-')) assert.deepEqual(v, { v: 'allow' }, f);
    else { assert.equal(v.v, 'deny', f); assert.equal(v.rule, RULE, f); }
  }
});
test('fixtures cover the Decided forms: file tool and run-record shell writes block; settings, set-mod, hook-pins, home, inline interpreter, -EncodedCommand and snapshot shell forms pass; passes cover the R-1 verbs', () => {
  const all = fixtures().map((f) => ({ f, j: readFx(f) }));
  const block = all.filter((x) => x.f.startsWith('block-')).map((x) => x.j);
  const pass = all.filter((x) => x.f.startsWith('pass-')).map((x) => x.j);
  const has = (list, re, tool) => list.some((j) => re.test(specOf(j)) && (!tool || j.tool_name === tool));
  assert.ok(block.some((j) => ['Write', 'Edit'].includes(j.tool_name)), 'a Write or Edit block');
  assert.ok(has(block, /(forms|run-state|guard)\.jsonl/, 'Bash'), 'a Bash run-record write');
  assert.ok(has(block, /(forms|run-state|guard)\.jsonl/, 'PowerShell'), 'a PowerShell run-record write');
  assert.ok(block.some((j) => SH.includes(j.tool_name) && /guard\.jsonl/.test(specOf(j))), 'the guard record block stays');
  assert.ok(has(pass, /\.mcsparrow/), 'a home shell write passes');
  assert.ok(has(pass, /\$env:USERPROFILE/, 'PowerShell'), 'PowerShell $env:USERPROFILE passes');
  assert.ok(has(pass, /set-mod/), 'set-mod passes');
  assert.ok(has(pass, /hook-pins/), 'hook-pins passes');
  assert.ok(has(pass, /node -e|python -c/), 'inline interpreter passes');
  assert.ok(has(pass, /-EncodedCommand/i), '-EncodedCommand passes');
  assert.ok(has(pass, /hook-snapshots/), 'a shell write in the snapshot folder passes');
  for (const re of [/settings\.mjs"? get/, /settings\.mjs"? serve/, /run-state triage/, /ledger\.mjs/, /handoff-lint/, /rule-check/, /hook-check\.mjs"? setup/])
    assert.ok(has(pass, re), `pass fixture ${re}`);
  assert.ok(pass.some((j) => j.tool_name === 'Read'), 'a Read of a protected file passes');
});

// ---------- run records: forms.jsonl, run-state.jsonl, guard.jsonl (AC7) ----------
after(cleanup);
const RECORDS = ['forms.jsonl', 'run-state.jsonl', 'guard.jsonl'];
const RECORD_DIRS = ['C:/proj/.company/work/p1', 'C:/proj/.company/work/p1/01-feature'];
const RECORD_REASON = /aico guard self-protect\.M-SEC1: run records are written by aico scripts only/;

// judge level: the host fills event.protected with the record shape paths
function withRecords(spec, opts) {
  const e = evRaw(spec, opts);
  for (const d of RECORD_DIRS) for (const r of RECORDS) {
    const f = `${d}/${r}`.toLowerCase();
    if (!e.protected.includes(f)) e.protected.push(f);
  }
  return deepFreeze(e);
}
async function recordDenies(spec, opts) {
  const judge = await load();
  const v = await judge(withRecords(spec, opts), SNAP);
  assert.equal(v.v, 'deny', `deny: ${spec} ${JSON.stringify(opts)} (got ${JSON.stringify(v)})`);
  assert.equal(v.rule, RULE);
  assert.ok(!v.message.includes(spec), 'the deny message never echoes the input');
}
const REC_TARGETS = RECORD_DIRS.flatMap((d) => RECORDS.map((r) => `${d}/${r}`));
for (const session of ['lead', 'step']) {
  for (const tool of ['Write', 'Edit']) for (const t of REC_TARGETS) {
    test(`AC7 deny ${tool} (${session}): ${t}`, async () => { await recordDenies(t, { tool, session }); });
  }
  for (const t of REC_TARGETS) {
    test(`AC7 deny Bash writes (${session}): ${t}`, async () => {
      await recordDenies(`echo x > ${t}`, { tool: 'Bash', session });
      await recordDenies(`echo x >> ${t}`, { tool: 'Bash', session });
      await recordDenies(`echo x | tee -a ${t}`, { tool: 'Bash', session });
      await recordDenies(`cp a.json ${t}`, { tool: 'Bash', session });
      await recordDenies(`rm ${t}`, { tool: 'Bash', session });
    });
    test(`AC7 deny PowerShell writes (${session}): ${t}`, async () => {
      await recordDenies(`Set-Content ${t} x`, { tool: 'PowerShell', session });
      await recordDenies(`Add-Content -Path ${t} -Value x`, { tool: 'PowerShell', session });
      await recordDenies(`"x" | Out-File ${t}`, { tool: 'PowerShell', session });
      await recordDenies(`echo x > ${t}`, { tool: 'PowerShell', session });
    });
  }
}
test('cch.M17 deny: separator, case and dot-segment variants of a record path', async () => {
  for (const t of ['C:\\proj\\.company\\work\\p1\\forms.jsonl', 'C:/PROJ/.COMPANY/WORK/P1/RUN-STATE.JSONL',
    'C:/proj/.company/work/p1/./01-feature/../forms.jsonl', 'C:/proj/.company//work/p1/forms.jsonl'])
    for (const tool of ['Write', 'Edit']) await recordDenies(t, { tool });
  await recordDenies('echo x > C:\\proj\\.company\\work\\p1\\run-state.jsonl', { tool: 'Bash' });
  await recordDenies('Set-Content C:\\PROJ\\.company\\work\\p1\\FORMS.JSONL x', { tool: 'PowerShell' });
});
test('AC7 pass: other files in a run folder and a record name elsewhere', async () => {
  const judge = await load();
  for (const t of ['C:/proj/.company/work/p1/01-qa.md', 'C:/proj/.company/work/p1/forms.json', 'C:/proj/.company/work/p1/run-state.jsonl.bak',
    'C:/proj/src/forms.jsonl', 'C:/proj/.company/work/p1/xforms.jsonl'])
    for (const tool of ['Write', 'Edit']) assert.deepEqual(await judge(withRecords(t, { tool }), SNAP), { v: 'allow' }, `${tool} ${t}`);
});
test('AC7 pass: reading a run record', async () => {
  const judge = await load();
  for (const t of REC_TARGETS) for (const tool of ['Read', 'Grep']) assert.deepEqual(await judge(withRecords(t, { tool }), SNAP), { v: 'allow' }, `${tool} ${t}`);
  assert.deepEqual(await judge(withRecords('cat C:/proj/.company/work/p1/forms.jsonl', { tool: 'Bash' }), SNAP), { v: 'allow' });
});

test('AC7 deny: a record path bound to a variable in the same command denies; the variable alone passes (Handoff 88)', async () => {
  await recordDenies('p=C:/proj/.company/work/p1/guard.jsonl; echo hi > $p', { tool: 'Bash' });
  await recordDenies('$p = "C:/proj/.company/work/p1/forms.jsonl"; Set-Content $p x', { tool: 'PowerShell' });
  const judge = await load();
  for (const tool of SH) assert.deepEqual(await judge(withRecords('echo hi > $p', { tool }), SNAP), { v: 'allow' }, tool);
});
test('AC7 deny: record write shapes (node -e, cd then relative, redirect) still deny, Lead and Role', async () => {
  for (const session of ['lead', 'step']) {
    await recordDenies("node -e \"require('fs').writeFileSync('C:/proj/.company/work/p1/forms.jsonl','x')\"", { tool: 'Bash', session });
    await recordDenies('cd C:/proj/.company/work/p1 && echo x > run-state.jsonl', { tool: 'Bash', session });
    await recordDenies('echo x > C:/proj/.company/work/p1/guard.jsonl', { tool: 'Bash', session });
    await recordDenies("node -e \"x('guard.jsonl')\"", { tool: 'Bash', session });
  }
});
test('AC7 deny: a command over 200000 chars is denied (fail closed), on both shell tools', async () => {
  const big = `echo ${'a'.repeat(200001)}`;
  for (const tool of SH) await recordDenies(big, { tool });
});

// ---------- run records through the host (AC7: main, Lead, Role; below the fast floor; guards off) ----------
const REPO_RULES = path.join(root, 'hooks', 'rules.json');
const LEAD_ID = 'agent-lead1';
const ROLE_ID = 'agent-role1';
const HOST_REC = ['forms.jsonl', 'run-state.jsonl', 'guard.jsonl'];
const slashOf = (p) => p.replace(/\\/g, '/');

async function hostEnv({ run = false } = {}) {
  const rows = JSON.parse(fs.readFileSync(REPO_RULES, 'utf8')).filter((r) => r.rule === 'self-protect.M-SEC1');
  assert.equal(rows.length, 1, 'hooks/rules.json has the self-protect.M-SEC1 row');
  const env = makeEnv();
  for (const rel of ['hooks/rules/self-protect.mjs', 'hooks/manifests/self-protect.json', 'hooks/rules/dotenv.mjs']) {
    fs.mkdirSync(path.dirname(path.join(env.plugin, rel)), { recursive: true });
    fs.copyFileSync(path.join(root, rel), path.join(env.plugin, rel));
  }
  fs.writeFileSync(path.join(env.plugin, 'hooks', 'rules.json'), JSON.stringify(rows, null, 2));
  env.repin();
  const folder = path.join(env.project, '.company', 'work', 'P20261117.000099', '01-feature');
  if (run) await env.startRun('P20261117.000099/01-feature');
  else fs.mkdirSync(folder, { recursive: true });
  startLead(env);
  for (const [id, type] of [[LEAD_ID, 'aico:project-manager'], [ROLE_ID, 'aico:qa']])
    assert.equal(env.run(env.event('SubagentStart', { agent_id: id, agent_type: type })).code, 0);
  env.recordPath = (name) => path.join(folder, name);
  return env;
}
function callOf(env, who, tool, target) {
  const input = tool === 'Write' ? { file_path: target, content: 'x' }
    : tool === 'Edit' ? { file_path: target, old_string: 'a', new_string: 'b' }
      : tool === 'Bash' ? { command: `echo x > "${slashOf(target)}"` }
        : { command: `Set-Content -Path "${target}" -Value x` };
  const over = { tool_name: tool, tool_input: input };
  if (who === 'lead') Object.assign(over, { agent_id: LEAD_ID, agent_type: 'aico:project-manager' });
  if (who === 'role') Object.assign(over, { agent_id: ROLE_ID, agent_type: 'aico:qa' });
  return env.event('PreToolUse', over);
}
const WHO = ['main', 'lead', 'role'];
const TOOLS = ['Write', 'Edit', 'Bash', 'PowerShell'];
function assertDeny(env, r, re, label) {
  assert.equal(r.code, 0, `${label}: ${r.err}`);
  const reason = env.reason(r);
  assert.ok(reason, `${label}: expected a deny, got ${r.out} ${r.err}`);
  if (re) assert.match(reason, re, label);
  return reason;
}
const OFF = { env: { AICO_GUARDS: 'off' } };

for (const run of [false, true]) {
  test(`AC7 host deny: record write by Write, Edit, Bash, PowerShell for main, Lead and Role (${run ? 'active run' : 'no run, below the fast floor'})`, async () => {
    const env = await hostEnv({ run });
    for (const who of WHO) for (const tool of TOOLS) for (const name of HOST_REC)
      assertDeny(env, env.run(callOf(env, who, tool, env.recordPath(name))), /self-protect\.M-SEC1/, `${who} ${tool} ${name}`);
  });
}
test('AC7 host deny: AICO_GUARDS=off, main and the Lead, with the record reason', async () => {
  const env = await hostEnv();
  for (const who of ['main', 'lead']) for (const tool of TOOLS) for (const name of HOST_REC)
    assertDeny(env, env.run(callOf(env, who, tool, env.recordPath(name)), OFF), RECORD_REASON, `${who} ${tool} ${name} off`);
});
test('AC7 host deny: AICO_GUARDS=off never lets a Role write a record', async () => {
  const env = await hostEnv();
  for (const tool of TOOLS) for (const name of HOST_REC)
    assertDeny(env, env.run(callOf(env, 'role', tool, env.recordPath(name)), OFF), /self-protect\.M-SEC1/, `role ${tool} ${name} off`);
});
test('AC7 host deny: a broken snapshot does not open a record write (with and without off)', async () => {
  const env = await hostEnv();
  fs.writeFileSync(env.leadFile, '{not json');
  fs.writeFileSync(env.stepFile(ROLE_ID), '{not json');
  for (const who of WHO) for (const tool of TOOLS) {
    assertDeny(env, env.run(callOf(env, who, tool, env.recordPath('forms.jsonl'))), null, `${who} ${tool} broken snapshot`);
    if (who !== 'role')
      assertDeny(env, env.run(callOf(env, who, tool, env.recordPath('run-state.jsonl')), OFF), RECORD_REASON, `${who} ${tool} broken snapshot off`);
  }
});
test('AC7 host deny: a missing snapshot does not open a record write under off', async () => {
  const env = await hostEnv();
  fs.rmSync(env.leadFile, { force: true });
  for (const tool of TOOLS)
    assertDeny(env, env.run(callOf(env, 'main', tool, env.recordPath('guard.jsonl')), OFF), RECORD_REASON, `main ${tool} no snapshot off`);
});
test('AC7 host deny: an unreadable rule table does not open a record write (cch.M-SEC3)', async () => {
  const env = await hostEnv();
  fs.writeFileSync(path.join(env.plugin, 'hooks', 'rules.json'), '{not json');
  for (const who of WHO) for (const tool of TOOLS) {
    assertDeny(env, env.run(callOf(env, who, tool, env.recordPath('forms.jsonl'))), null, `${who} ${tool} bad table`);
    if (who !== 'role')
      assertDeny(env, env.run(callOf(env, who, tool, env.recordPath('forms.jsonl')), OFF), null, `${who} ${tool} bad table off`);
  }
});
test('AC7 host deny: the record check needs neither the rule table nor the snapshot under off', async () => {
  const env = await hostEnv();
  fs.rmSync(path.join(env.plugin, 'hooks', 'rules.json'), { force: true });
  fs.rmSync(env.leadFile, { force: true });
  for (const tool of TOOLS)
    assertDeny(env, env.run(callOf(env, 'lead', tool, env.recordPath('run-state.jsonl')), OFF), null, `lead ${tool} nothing readable off`);
});
if (process.platform === 'win32') {
  test('cch.M17 host deny: backslash and upper-case spelling of a record path', async () => {
    const env = await hostEnv();
    const odd = env.recordPath('forms.jsonl').replace(/\//g, '\\').toUpperCase();
    for (const who of WHO) for (const tool of ['Write', 'Edit'])
      assertDeny(env, env.run(callOf(env, who, tool, odd)), /self-protect\.M-SEC1/, `${who} ${tool} upper`);
    for (const tool of ['Write', 'Edit'])
      assertDeny(env, env.run(callOf(env, 'main', tool, odd), OFF), RECORD_REASON, `main ${tool} upper off`);
  });
}
test('AC7 host pass: AICO_GUARDS=off lets main and the Lead write a settings file; the rest of off is unchanged', async () => {
  const env = await hostEnv();
  const settings = path.join(env.project, '.company', 'settings.json');
  for (const who of ['main', 'lead']) for (const tool of ['Write', 'Edit']) {
    const r = env.run(callOf(env, who, tool, settings), OFF);
    assert.equal(r.code, 0, r.err);
    assert.equal(env.reason(r), null, `${who} ${tool} settings under off passes: ${r.out}`);
  }
  assertDeny(env, env.run(callOf(env, 'main', 'Write', settings)), /self-protect\.M-SEC1/, 'settings write with guards on');
  assertDeny(env, env.run(callOf(env, 'role', 'Write', settings), OFF), /self-protect\.M-SEC1/, 'role settings write under off');
});
test('AC7 host pass: an ordinary write in the run folder passes with guards on and off', async () => {
  const env = await hostEnv();
  const note = env.recordPath('01-qa.md');
  for (const extra of [{}, OFF]) {
    const r = env.run(callOf(env, 'main', 'Write', note), extra);
    assert.equal(r.code, 0, r.err);
    assert.equal(env.reason(r), null, r.out);
  }
});
test('AC7 host deny: AICO_GUARDS=off, the answer adapter shell call, main, Lead and Role; open passes (R-21)', async () => {
  const env = await hostEnv();
  const relay = `${slashOf(env.plugin)}/scripts/lead-relay.mjs`;
  const shell = (who, tool, command) => {
    const over = { tool_name: tool, tool_input: { command } };
    if (who === 'lead') Object.assign(over, { agent_id: LEAD_ID, agent_type: 'aico:project-manager' });
    if (who === 'role') Object.assign(over, { agent_id: ROLE_ID, agent_type: 'aico:qa' });
    return env.event('PreToolUse', over);
  };
  const cmds = {
    Bash: [`node "${relay}" answer < f.json`, `cat f.json | node ${relay} answer`],
    PowerShell: [`node "${relay.replace(/\//g, String.fromCharCode(92))}" answer`],
  };
  for (const who of WHO) for (const tool of SH) for (const cmd of cmds[tool]) {
    assertDeny(env, env.run(shell(who, tool, cmd), OFF), /CEO answer/, `${who} ${tool} answer off: ${cmd}`);
    assertDeny(env, env.run(shell(who, tool, cmd)), /CEO answer/, `${who} ${tool} answer on: ${cmd}`);
  }
  for (const who of WHO) for (const tool of SH) {
    const r = env.run(shell(who, tool, `node "${relay}" open 'P1/x' gate:g1 f.json`), OFF);
    assert.equal(r.code, 0, r.err);
    assert.equal(env.reason(r), null, `${who} ${tool} open passes under off: ${r.out}`);
  }
});
test('AC7 host deny: AICO_GUARDS=off, .env Read and `cat .env` denied for main and Lead; .env.example passes; Role denied by the normal guard (R-23)', async () => {
  const env = await hostEnv();
  const rows = JSON.parse(fs.readFileSync(path.join(env.plugin, 'hooks', 'rules.json'), 'utf8'));
  rows.push(...JSON.parse(fs.readFileSync(REPO_RULES, 'utf8')).filter((r) => r.rule === 'dotenv.M-SEC1'));
  fs.mkdirSync(path.join(env.plugin, 'hooks', 'manifests'), { recursive: true });
  fs.copyFileSync(path.join(root, 'hooks', 'manifests', 'dotenv.json'), path.join(env.plugin, 'hooks', 'manifests', 'dotenv.json'));
  fs.writeFileSync(path.join(env.plugin, 'hooks', 'rules.json'), JSON.stringify(rows, null, 2));
  env.repin();
  const dotenv = path.join(env.project, '.env');
  const example = path.join(env.project, '.env.example');
  const call = (who, tool, input) => {
    const over = { tool_name: tool, tool_input: input };
    if (who === 'lead') Object.assign(over, { agent_id: LEAD_ID, agent_type: 'aico:project-manager' });
    if (who === 'role') Object.assign(over, { agent_id: ROLE_ID, agent_type: 'aico:qa' });
    return env.event('PreToolUse', over);
  };
  for (const who of ['main', 'lead']) {
    assertDeny(env, env.run(call(who, 'Read', { file_path: dotenv }), OFF), /dotenv\.M-SEC1/, `${who} Read .env off`);
    assertDeny(env, env.run(call(who, 'Bash', { command: 'cat .env' }), OFF), /dotenv\.M-SEC1/, `${who} cat .env off`);
    for (const [tool, input] of [['Read', { file_path: example }], ['Bash', { command: 'cat .env.example' }]]) {
      const r = env.run(call(who, tool, input), OFF);
      assert.equal(r.code, 0, r.err);
      assert.equal(env.reason(r), null, `${who} ${tool} .env.example passes under off: ${r.out}`);
    }
  }
  assertDeny(env, env.run(call('role', 'Read', { file_path: dotenv }), OFF), /dotenv\.M-SEC1/, 'role Read .env off');
  assertDeny(env, env.run(call('role', 'Bash', { command: 'cat .env' }), OFF), /dotenv\.M-SEC1/, 'role cat .env off');
  assertDeny(env, env.run(call('role', 'Read', { file_path: dotenv })), /dotenv\.M-SEC1/, 'role Read .env on');
});

// ---------- pin mismatch plus AICO_GUARDS=off: the host's text-only deny (214 R-3) ----------
async function mismatchEnv() {
  const env = await hostEnv();
  fs.appendFileSync(path.join(env.plugin, 'hooks', 'rules', 'dotenv.mjs'), '\n// pin drift\n');
  return env;
}
const leadCall = (env, tool, input) => env.event('PreToolUse', { tool_name: tool, tool_input: input });

test('R-3 host deny: pin mismatch + AICO_GUARDS=off, the Lead `cat .env` denies with dotenv.M-SEC1', async () => {
  const env = await mismatchEnv();
  const r = env.run(leadCall(env, 'Bash', { command: 'cat .env' }), OFF);
  assertDeny(env, r, /dotenv\.M-SEC1/, 'cat .env pin mismatch off');
  assert.doesNotMatch(env.reason(r), /pins-mismatch/);
  assertDeny(env, env.run(leadCall(env, 'Bash', { command: 'cat .env.local' }), OFF), /dotenv\.M-SEC1/, 'cat .env.local');
});
test('R-3 host pass: pin mismatch + AICO_GUARDS=off, a .env.example read passes (null output)', async () => {
  const env = await mismatchEnv();
  for (const [tool, input] of [['Bash', { command: 'cat .env.example' }], ['Read', { file_path: path.join(env.project, '.env.sample') }]]) {
    const r = env.run(leadCall(env, tool, input), OFF);
    assert.equal(r.code, 0, r.err);
    assert.equal(env.reason(r), null, `${tool} .env.example under mismatch+off: ${r.out}`);
    assert.equal(r.out.trim(), '', `${tool} output is empty`);
  }
});
test('R-3 host deny: pin mismatch + AICO_GUARDS=off, the answer adapter shell call denies with self-protect.M-SEC1; a harmless call passes', async () => {
  const env = await mismatchEnv();
  for (const command of ['node scripts/lead-relay.mjs answer < f.json', 'cat f.json | node scripts/lead-relay.mjs answer']) {
    const r = env.run(leadCall(env, 'Bash', { command }), OFF);
    assertDeny(env, r, /self-protect\.M-SEC1/, `answer under mismatch+off: ${command}`);
    assert.doesNotMatch(env.reason(r), /pins-mismatch/);
  }
  for (const command of ['echo hello', 'node scripts/lead-relay.mjs open P1/x gate:g1 f.json']) {
    const r = env.run(leadCall(env, 'Bash', { command }), OFF);
    assert.equal(r.code, 0, r.err);
    assert.equal(env.reason(r), null, `harmless passes under mismatch+off: ${command}: ${r.out}`);
  }
});

// 218 R-5: under pin mismatch + guards off the host cannot decode, so an encoded answer fails closed.
test('R-5 host deny: pin mismatch + AICO_GUARDS=off, an encoded answer shell call denies; a plain harmless call passes', async () => {
  const env = await mismatchEnv();
  const b64 = (t) => Buffer.from(t, 'utf16le').toString('base64');
  const answer = 'node scripts/lead-relay.mjs answer < f.json';
  for (const [tool, command] of [
    ['PowerShell', `pwsh -enc ${b64(answer)}`],
    ['Bash', `pwsh -EncodedCommand ${b64(answer)}`],
    ['PowerShell', `powershell -NoProfile -EncodedCommand:${b64(answer)}`],
    ['Bash', `pwsh -c "pwsh -enc ${b64(answer)}"`],
    ['PowerShell', `pwsh -enc ${b64(`pwsh -enc ${b64(answer)}`)}`],
    ['PowerShell', `pwsh -enc ${b64('Set-Content .company/work/p1/01-feature/forms.jsonl x')}`],
  ]) {
    const r = env.run(leadCall(env, tool, { command }), OFF);
    assertDeny(env, r, /self-protect\.M-SEC1|pins-mismatch/, `encoded answer under mismatch+off: ${command}`);
  }
  for (const command of ['echo hello', 'Write-Output ok']) {
    const r = env.run(leadCall(env, 'PowerShell', { command }), OFF);
    assert.equal(r.code, 0, r.err);
    assert.equal(env.reason(r), null, `harmless passes under mismatch+off: ${command}: ${r.out}`);
  }
});
