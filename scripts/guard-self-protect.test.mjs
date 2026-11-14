import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

// ---------- shell denies ----------
const SET_MOD = [
  `node "${PLUGIN}/scripts/settings.mjs" set-mod switchboard enabled false`,
  'node scripts/settings.mjs set-mod cache_tax enabled false', 'node settings.mjs set-mod switchboard seen',
  'node "$CLAUDE_PLUGIN_ROOT/scripts/settings.mjs" set-mod x y z', 'node ${CLAUDE_PLUGIN_ROOT}/scripts/settings.mjs set-mod x y',
  'node C:\\p\\scripts\\settings.mjs set-mod a b', 'FOO=1 node scripts/settings.mjs set-mod a b',
  'cd scripts && node settings.mjs set-mod a b', 'node scripts/settings.mjs get cap; node scripts/settings.mjs set-mod a b',
  'echo ok && node scripts/settings.mjs set-mod a b',
];
for (const c of SET_MOD) for (const tool of SH) test(`AC8 deny ${tool}: set-mod: ${c}`, async () => { await denies(c, { tool }); });
const PINS = [
  `node "${PLUGIN}/scripts/hook-pins.mjs" write`, 'node scripts/hook-pins.mjs check', 'node scripts/hook-pins.mjs',
  'node "$CLAUDE_PLUGIN_ROOT/scripts/hook-pins.mjs" write', 'node scripts/hook-pins.mjs --help', 'node hook-pins.mjs write; echo done',
  'git status && node scripts/hook-pins.mjs verify',
];
for (const c of PINS) for (const tool of SH) test(`AC8 deny ${tool}: hook-pins: ${c}`, async () => { await denies(c, { tool }); });

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
  'echo x > C:/proj/.company/work/p1/guard.jsonl', 'cat a.json > ~/.mcsparrow/config.json',
  'echo x > "C:/Users/test/.mcsparrow/config.json"', "echo x > 'C:/Users/test/.mcsparrow/config.json'",
  'echo x > C:\\USERS\\TEST\\.MCSPARROW\\CONFIG.JSON', 'echo x > ~/.mcsparrow/config.json.',
  'true && echo x > ~/.mcsparrow/config.json', 'echo hi; rm ~/.mcsparrow/config.json', 'git status | tee ~/.mcsparrow/config.json',
];
for (const c of WRITES) for (const tool of SH) test(`AC8 deny ${tool}: write form: ${c}`, async () => { await denies(c, { tool }); });
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
for (const c of PS_WRITES) test(`AC8 deny PowerShell: write form: ${c}`, async () => { await denies(c, { tool: 'PowerShell' }); });

test('AC8 deny: a copy whose target is protected only through a junction (real)', async () => {
  const links = { 'C:/proj/link': MSH };
  await denies('cp a.json link/config.json', { links });
  await denies('echo x > link/config.json', { links });
  await denies('echo x > C:/proj/link/config.json', { links });
  await denies('Set-Content link\\config.json x', { links, tool: 'PowerShell' });
  await denies('rm link/config.json', { links });
});
test('AC8 deny: a new file in the snapshot folder from a shell (nearest existing ancestor)', async () => {
  await denies('echo x > ~/.mcsparrow/hook-snapshots/newroot/steps/new.json', { exists: false });
  await denies('cp a.json $HOME/.mcsparrow/hook-snapshots/n/steps/s.json', { exists: false });
  await denies('Set-Content $env:USERPROFILE\\.mcsparrow\\hook-snapshots\\n\\x.json x', { exists: false, tool: 'PowerShell' });
});

// ---------- evasion: inline interpreters ----------
const INLINE = [
  `node -e "require('fs').writeFileSync(process.env.HOME+'/.mcsparrow/config.json','{}')"`,
  `node --eval "fs.writeFileSync('config.json','{}')"`, `node -p "fs.writeFileSync('config.json','{}')"`, `node --print "'config.json'"`,
  `node -e "fs.writeFileSync('settings.json','{}')"`, `node -e "fs.writeFileSync('settings.local.json','{}')"`,
  `node -e "x('.mcsparrow')"`, `node -e "process.env.MCSPARROW_HOME"`, `node -e "x('hook-snapshots')"`, `node -e "x('pins.json')"`,
  `node -e "x('rules.json')"`, `node -e "x('guard.jsonl')"`, `node -e "process.env.CLAUDE_PLUGIN_ROOT"`, `node -e "x('.claude')"`,
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
for (const c of INLINE) for (const tool of SH) test(`evasion deny ${tool}: inline interpreter: ${c}`, async () => { await denies(c, { tool }); });

test('evasion deny: -EncodedCommand always, whatever the text or the interpreter', async () => {
  for (const c of ['powershell -EncodedCommand SQBFAFgA', 'pwsh -EncodedCommand ZQBjAGgAbwA=', 'powershell.exe -NoProfile -EncodedCommand AAAA',
    'powershell -encodedcommand AAAA', 'pwsh -enc AAAA -NoProfile', 'powershell -e AAAA', 'pwsh -ec AAAA'])
    for (const tool of SH) await denies(c, { tool });
});
test('evasion deny: inline text naming a settings word hides in a longer command', async () => {
  await denies('echo start; node -e "x(\'config.json\')"; echo end');
  await denies('cd src && python -c "open(\'.mcsparrow/config.json\',\'w\')"');
  await denies('npm test && node -e "x(\'config.json\')"');
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
for (const c of CD) for (const tool of SH) test(`evasion deny ${tool}: cd plus relative write: ${c}`, async () => { await denies(c, { tool }); });
const PS_CD = [
  'Set-Location $env:USERPROFILE\\.mcsparrow; Set-Content config.json x', 'Set-Location $env:USERPROFILE\\.mcsparrow; "x" | Out-File config.json',
  'sl ~\\.mcsparrow; Set-Content config.json x', 'Push-Location $env:MCSPARROW_HOME; Add-Content config.json x',
  'cd $env:USERPROFILE\\.claude; Set-Content settings.json x', 'Set-Location $env:USERPROFILE\\.mcsparrow; echo x > config.json',
  'Set-Location $env:USERPROFILE\\.mcsparrow; Remove-Item config.json', 'chdir ~\\.mcsparrow; Set-Content config.json x',
];
for (const c of PS_CD) test(`evasion deny PowerShell: Set-Location plus relative write: ${c}`, async () => { await denies(c, { tool: 'PowerShell' }); });

// ---------- evasion: path spelling in a shell ----------
test('evasion deny: protected target behind dot segments, redundant slashes and case', async () => {
  for (const c of ['echo x > ~/.mcsparrow/./config.json', 'echo x > ~/.mcsparrow/../.mcsparrow/config.json',
    'echo x > ~//.mcsparrow//config.json', 'echo x > C:/Users/test/.MCSPARROW/Config.Json', 'echo x > c:\\users\\test\\.mcsparrow\\config.json',
    'echo x > C:/Users/test/.mcsparrow/config.json:stream', 'echo x > C:/Users/test/.mcsparrow/config.json ', 'echo x > C:/Users/test/.mcsparrow/config.json...'])
    for (const tool of SH) await denies(c, { tool });
});

// ---------- a hand-written guard key changes nothing ----------
test('AC15: the verdict ignores any snapshot key that tries to switch the guard off', async () => {
  const hand = deepFreeze({ ...SNAP, guards: { 'self-protect': false }, guardsOff: true, selfProtect: 'off', savers: { 'self-protect': { enabled: false } },
    settingsWarnings: ['self-protect off'], 'self-protect': { enabled: false } });
  await denies('~/.mcsparrow/config.json', { tool: 'Write' }, hand);
  await denies('echo x > ~/.mcsparrow/config.json', {}, hand);
  await denies('node scripts/settings.mjs set-mod switchboard enabled false', {}, hand);
  await allows('src/a.js', { tool: 'Write' }, hand);
});
test('AC15: a Write that would hand-edit a switch or the threshold into settings is denied, whatever it says', async () => {
  for (const p of ['~/.mcsparrow/config.json', 'C:/proj/.company/settings.json', 'C:/proj/.claude/settings.json', `${HOME}/.claude/settings.local.json`])
    for (const tool of FILE_TOOLS) await denies(p, { tool });
  await denies('echo {"guards":{"cap":false},"mods":{"switchboard":{"enabled":false}}} > ~/.mcsparrow/config.json');
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
test('an empty protected list: set-mod and hook-pins still deny, a path write has nothing to match', async () => {
  const judge = await load();
  const e = evRaw('node scripts/settings.mjs set-mod a b');
  e.protected = [];
  assert.equal((await judge(deepFreeze(e), SNAP)).v, 'deny');
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
test('fixtures cover the Decided forms: file tool, redirect, PowerShell variable, set-mod, hook-pins, inline interpreter, -EncodedCommand, cd plus write, new snapshot file; passes cover the R-1 verbs', () => {
  const all = fixtures().map((f) => ({ f, j: readFx(f) }));
  const block = all.filter((x) => x.f.startsWith('block-')).map((x) => x.j);
  const pass = all.filter((x) => x.f.startsWith('pass-')).map((x) => x.j);
  const has = (list, re, tool) => list.some((j) => re.test(specOf(j)) && (!tool || j.tool_name === tool));
  assert.ok(block.some((j) => ['Write', 'Edit'].includes(j.tool_name)), 'a Write or Edit block');
  assert.ok(has(block, />\s*~\/\.mcsparrow\/config\.json/), 'redirect with ~');
  assert.ok(has(block, /\$env:USERPROFILE/, 'PowerShell'), 'PowerShell $env:USERPROFILE');
  assert.ok(has(block, /set-mod/), 'set-mod');
  assert.ok(has(block, /hook-pins/), 'hook-pins');
  assert.ok(has(block, /node -e|python -c/), 'inline interpreter');
  assert.ok(has(block, /-EncodedCommand/i), '-EncodedCommand');
  assert.ok(has(block, /^cd .*; .*> config\.json/), 'cd plus relative write');
  assert.ok(has(block, /hook-snapshots/), 'a new file in the snapshot folder');
  for (const re of [/settings\.mjs"? get/, /settings\.mjs"? serve/, /run-state triage/, /ledger\.mjs/, /handoff-lint/, /rule-check/, /hook-check\.mjs"? setup/])
    assert.ok(has(pass, re), `pass fixture ${re}`);
  assert.ok(pass.some((j) => j.tool_name === 'Read'), 'a Read of a protected file passes');
});
