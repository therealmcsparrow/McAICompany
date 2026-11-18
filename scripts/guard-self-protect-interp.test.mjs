import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Self-protect: interpreter heredocs, .NET file APIs, and a worktree cwd outside the repo.
// The worktree case drives the real host normalize, then judge, with no hand-built paths.

const root = path.resolve(import.meta.dirname, '..');
const url = (f) => pathToFileURL(path.join(root, f)).href;
const { judge } = await import(url('hooks/rules/self-protect.mjs'));
const { normalize, fold, realOf } = await import(url('hooks/lib/event.mjs'));

const HOME = 'C:/Users/test';
const PROT = [
  `${HOME}/.claude/settings.json`, `${HOME}/.claude/settings.local.json`, `${HOME}/.mcsparrow/config.json`,
  `${HOME}/.mcsparrow/hook-snapshots`, 'c:/proj/.claude/settings.json', 'c:/proj/.company/settings.json',
].map((p) => p.toLowerCase());

const REC = '.company/work/p1/01-feature';
const SESSIONS = ['main', 'lead', 'step'];
function ev(tool, command, session = 'step') {
  return {
    v: 1, event: 'PreToolUse', session, sessionKey: 'aaaaaaaaaaaa', agentKey: session === 'main' ? null : 'bbbbbbbbbbbb', agentType: null,
    tool: { name: tool, command, paths: [], model: null, subagentType: null, outputRole: null },
    tokens: { state: 'none', total: 0 }, mainModel: null,
    env: { guardsOff: false, subagentModel: null, subagentModelForce: null },
    protected: PROT, run: null, drift: [], stopHookActive: null,
  };
}
const denied = (tool, command) => {
  for (const session of SESSIONS) {
    const v = judge(ev(tool, command, session));
    assert.equal(v.v, 'deny', `deny (${session}): ${command}`);
    assert.equal(v.rule, 'self-protect.M-SEC1');
  }
};
const allowed = (tool, command) => {
  for (const session of SESSIONS) assert.deepEqual(judge(ev(tool, command, session)), { v: 'allow' }, `allow (${session}): ${command}`);
};

test('an interpreter heredoc that writes a run record denies', () => {
  denied('Bash', `python3 - <<'EOF'\nopen('${REC}/forms.jsonl','a').write('x')\nEOF`);
  denied('Bash', `python3 - <<EOF\nimport os\nopen(os.path.expanduser('${REC}/run-state.jsonl'),'a').write('x')\nEOF`);
  denied('Bash', `node <<'EOF'\nrequire('fs').appendFileSync('${REC}/guard.jsonl', '{}')\nEOF`);
  denied('Bash', `cat <<'EOF' | python3 -\nopen('${REC}/forms.jsonl','a')\nEOF`);
  denied('Bash', `node --input-type=module <<-'EOF'\n\timport fs from 'fs'; fs.writeFileSync('${REC}/run-state.jsonl','x')\nEOF`);
  denied('PowerShell', `python - <<'EOF'\nopen(r'${REC}/forms.jsonl','a')\nEOF`);
});

test('an interpreter heredoc that builds a record path from pieces and writes denies', () => {
  denied('Bash', `python3 - <<'EOF'\nimport pathlib\np = pathlib.Path('${REC}') / ('forms' + '.jsonl')\np.write_text('{}')\nEOF`);
});

test('an interpreter heredoc that names a settings or plugin file allows in every session', () => {
  allowed('Bash', `python3 - <<'EOF'\nopen('.claude/settings.json','w').write('{}')\nEOF`);
  allowed('Bash', `python3 - <<EOF\nimport os\nopen(os.path.expanduser('~/.claude/settings.json'),'w').write('x')\nEOF`);
  allowed('Bash', `node <<'EOF'\nrequire('fs').writeFileSync(process.env.HOME + '/.claude/settings.json', '{}')\nEOF`);
  allowed('Bash', `cat <<'EOF' | python3 -\nopen('config.json','w')\nEOF`);
  allowed('Bash', `node --input-type=module <<-'EOF'\n\timport fs from 'fs'; fs.writeFileSync('pins.json','x')\nEOF`);
  allowed('Bash', `python3 - <<'EOF'\nimport pathlib\np = pathlib.Path.home() / ('.cl' + 'aude') / 'settings.json'\np.write_text('{}')\nEOF`);
  allowed('PowerShell', `python - <<'EOF'\nopen(r'$HOME\\.claude\\settings.json','w')\nEOF`);
});

test('a heredoc to an interpreter that touches no record allows', () => {
  allowed('Bash', `python3 - <<'EOF'\nprint(1 + 1)\nEOF`);
  allowed('Bash', `node <<'EOF'\nrequire('fs').writeFileSync('out/result.txt', 'x')\nEOF`);
  allowed('Bash', `cat <<'EOF' > notes.txt\nmentions forms.jsonl in prose\nEOF`);
  allowed('Bash', `git commit -F - <<'EOF'\nfix: settings.json wording\nEOF`);
});

test('a heredoc redirected to a run record denies, to a settings file allows', () => {
  denied('Bash', `cat <<'EOF' >> ${REC}/forms.jsonl\n{}\nEOF`);
  allowed('Bash', `cat <<'EOF' > ~/.claude/settings.json\n{}\nEOF`);
});

test('PowerShell .NET file writes to a run record deny', () => {
  denied('PowerShell', `[IO.File]::AppendAllText("${REC}/forms.jsonl", "x")`);
  denied('PowerShell', `[System.IO.File]::WriteAllText('${REC}/run-state.jsonl', "{}")`);
  denied('PowerShell', `[System.IO.File]::AppendAllText('c:/proj/${REC}/guard.jsonl', 'x')`);
  denied('PowerShell', `$s = [IO.StreamWriter]::new("${REC}/forms.jsonl"); $s.Write("x")`);
  denied('PowerShell', `New-Object System.IO.StreamWriter("${REC}/run-state.jsonl")`);
});

test('PowerShell .NET file writes to a settings or home file allow', () => {
  allowed('PowerShell', '[IO.File]::WriteAllText("$HOME\\.claude\\settings.json", "{}")');
  allowed('PowerShell', '[System.IO.File]::WriteAllText("$env:USERPROFILE\\.mcsparrow\\config.json", "{}")');
  allowed('PowerShell', "[System.IO.File]::AppendAllText('c:/proj/.claude/settings.json', 'x')");
  allowed('PowerShell', '$s = [IO.StreamWriter]::new("$HOME\\.claude\\settings.json"); $s.Write("x")');
  allowed('PowerShell', 'New-Object System.IO.StreamWriter("settings.json")');
});

test('PowerShell cmdlets with a variable target deny when the command names a run record', () => {
  denied('PowerShell', `$p = "${REC}/forms.jsonl"; Set-Content $p "{}"`);
  denied('PowerShell', `$p = "${REC}/run-state.jsonl"; "{}" | Out-File -FilePath $p`);
  denied('PowerShell', `Set-Content -Path "${REC}/forms.jsonl" -Value "{}"`);
});

test('PowerShell cmdlets aimed at a settings file allow', () => {
  allowed('PowerShell', '$p = "$HOME\\.claude\\settings.json"; Set-Content $p "{}"');
  allowed('PowerShell', 'Set-Content -Path "$HOME\\.claude\\settings.json" -Value "{}"');
});

test('PowerShell file work that names no record allows', () => {
  allowed('PowerShell', '[IO.File]::WriteAllText("out\\result.txt", "x")');
  allowed('PowerShell', '[IO.File]::ReadAllText("out\\result.txt")');
  allowed('PowerShell', 'Set-Content -Path out\\result.txt -Value hi');
  allowed('PowerShell', '$f = "out\\a.txt"; Set-Content $f hi');
});

// R-2: -EncodedCommand:<b64> (colon form) and /EncodedCommand <b64> (slash form) decode like the plain flag.
const b64 = (s) => Buffer.from(s, 'utf16le').toString('base64');
test('PowerShell -EncodedCommand:<b64> and /EncodedCommand <b64> to a run record deny', () => {
  const payload = b64(`Set-Content "${REC}/forms.jsonl" "{}"`);
  denied('PowerShell', `powershell -EncodedCommand:${payload}`);
  denied('Bash', `pwsh -NoProfile -EncodedCommand:${payload}`);
  denied('PowerShell', `powershell /EncodedCommand ${payload}`);
  denied('Bash', `pwsh /EncodedCommand ${payload}`);
  denied('PowerShell', `powershell -enc:${payload}`);
});

test('PowerShell -EncodedCommand:<b64> and /EncodedCommand <b64> that name no record allow', () => {
  const payload = b64('Write-Output 1');
  allowed('PowerShell', `powershell -EncodedCommand:${payload}`);
  allowed('PowerShell', `powershell /EncodedCommand ${payload}`);
});

// R-5: every dash form of -EncodedCommand and -Command (en dash, em dash, horizontal bar, --, /) to a run record denies.
const DASHES = ['-', '--', '/', '–', '—', '―'];
test('PowerShell -EncodedCommand in every dash form to a run record denies', () => {
  const payload = b64(`Set-Content "${REC}/forms.jsonl" "{}"`);
  for (const d of DASHES) {
    denied('PowerShell', `powershell ${d}EncodedCommand ${payload}`);
    denied('Bash', `pwsh ${d}EncodedCommand ${payload}`);
    denied('PowerShell', `powershell ${d}EncodedCommand:${payload}`);
    denied('PowerShell', `powershell ${d}enc ${payload}`);
  }
});

test('PowerShell -Command in every dash form to a run record denies', () => {
  for (const d of DASHES) {
    denied('PowerShell', `powershell ${d}Command "Set-Content ${REC}/forms.jsonl x"`);
    denied('Bash', `pwsh ${d}Command "Set-Content ${REC}/forms.jsonl x"`);
    denied('Bash', `pwsh ${d}c "Set-Content ${REC}/forms.jsonl x"`);
  }
});

test('PowerShell -EncodedCommand and -Command in every dash form with a harmless payload allow', () => {
  const payload = b64('Write-Output ok');
  for (const d of DASHES) {
    allowed('PowerShell', `powershell ${d}EncodedCommand ${payload}`);
    allowed('Bash', `pwsh ${d}EncodedCommand:${payload}`);
    allowed('PowerShell', `powershell ${d}Command "Write-Output ok"`);
  }
});

test('a command over 200000 chars denies in every session', () => {
  denied('Bash', `echo ${'a'.repeat(200001)}`);
  denied('PowerShell', `Write-Output ${'a'.repeat(200001)}`);
});

// ---- worktree cwd (host level) ----
function makeTree() {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-wt-')));
  const main = path.join(base, 'repo');
  const wt = path.join(base, 'repo.wt', 'run1');
  const gitdir = path.join(main, '.git', 'worktrees', 'run1');
  fs.mkdirSync(path.join(main, '.company', 'work'), { recursive: true });
  fs.mkdirSync(path.join(main, '.claude'), { recursive: true });
  fs.mkdirSync(gitdir, { recursive: true });
  fs.mkdirSync(path.join(wt, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gitdir}\n`);
  fs.writeFileSync(path.join(gitdir, 'gitdir'), `${path.join(wt, '.git')}\n`);
  fs.writeFileSync(path.join(gitdir, 'commondir'), '../..\n');
  return { base, main, wt };
}
const ctxFor = (base) => ({
  env: { USERPROFILE: path.join(base, 'home'), HOME: path.join(base, 'home') },
  schema: null, pluginRoot: path.join(base, 'plugin'), mcsHome: path.join(base, 'msh'), resolveRun: null,
});
async function hostVerdict(raw, base) {
  const r = await normalize(raw, ctxFor(base));
  assert.ok(r.ok, 'normalize ok');
  return { event: r.event, v: judge(r.event) };
}
const pre = (cwd, tool, input) => ({
  hook_event_name: 'PreToolUse', session_id: 's', transcript_path: 'x.jsonl', cwd, agent_id: 'agent1', agent_type: 'aico:backend-engineer',
  tool_name: tool, tool_input: input, permission_mode: 'default',
});

test('a worktree cwd outside the repo still protects the main project files', async () => {
  const { base, main, wt } = makeTree();
  try {
    for (const cwd of [wt, path.join(wt, 'sub')]) {
      const w = await hostVerdict(pre(cwd, 'Write', { file_path: path.join(main, '.claude', 'settings.json'), content: '{}' }), base);
      assert.equal(w.v.v, 'deny', 'Write of the main settings file');
      const c = await hostVerdict(pre(cwd, 'Write', { file_path: path.join(main, '.company', 'settings.json'), content: '{}' }), base);
      assert.equal(c.v.v, 'deny', 'Write of the main company settings');
      const b = await hostVerdict(pre(cwd, 'Bash', { command: `echo {} > ${path.join(main, '.claude', 'settings.local.json').replaceAll('\\', '/')}` }), base);
      assert.equal(b.v.v, 'allow', 'a shell redirect into the main settings is not judged');
      const rec = await hostVerdict(pre(cwd, 'Bash', { command: `echo {} >> ${path.join(main, '.company', 'work', 'p1', '01-feature', 'forms.jsonl').replaceAll('\\', '/')}` }), base);
      assert.equal(rec.v.v, 'deny', 'a shell redirect into a main run record');
    }
    const ok = await hostVerdict(pre(wt, 'Write', { file_path: path.join(wt, 'src.txt'), content: 'x' }), base);
    assert.equal(ok.v.v, 'allow', 'a plain worktree file is still writable');
    const own = await hostVerdict(pre(wt, 'Write', { file_path: path.join(wt, '.claude', 'settings.json'), content: '{}' }), base);
    assert.equal(own.v.v, 'deny', 'the worktree own settings stay protected');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a forged .git pointer in cwd does not widen protection, and a plain repo cwd is unchanged', async () => {
  const { base, main } = makeTree();
  const fake = path.join(base, 'fake');
  fs.mkdirSync(fake, { recursive: true });
  fs.writeFileSync(path.join(fake, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'run1')}\n`);
  try {
    const r = await hostVerdict(pre(fake, 'Write', { file_path: path.join(fake, 'a.txt'), content: 'x' }), base);
    assert.equal(r.v.v, 'allow');
    assert.ok(!r.event.protected.includes(fold(realOf(path.join(main, '.claude', 'settings.json'), base))), 'unconfirmed pointer adds nothing');
    const plain = await hostVerdict(pre(main, 'Write', { file_path: path.join(main, '.claude', 'settings.json'), content: '{}' }), base);
    assert.equal(plain.v.v, 'deny');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// 218 R-3: a run-record write hidden behind a nested or double-encoded PowerShell command denies.
test('nested -c / double-encoded -enc write to forms.jsonl denies (218 R-3)', () => {
  const write = `Set-Content "${REC}/forms.jsonl" "{}"`;
  const inner = b64(write);
  for (const shell of ['PowerShell', 'Bash']) {
    denied(shell, `pwsh -c "pwsh -enc ${inner}"`);
    denied(shell, `pwsh -Command "powershell -EncodedCommand ${inner}"`);
    denied(shell, `pwsh -c "${write}"`);
    denied(shell, `pwsh -enc ${b64(`pwsh -enc ${inner}`)}`);
    denied(shell, `powershell -EncodedCommand ${b64(`pwsh -enc ${b64(`pwsh -enc ${inner}`)}`)}`);
    denied(shell, `pwsh -enc ${b64(`pwsh -c "${write}"`)}`);
  }
});

test('nested -c / double-encoded -enc that name no record allow (218 R-3)', () => {
  const ok = b64('Write-Output 1');
  allowed('PowerShell', `pwsh -c "pwsh -enc ${ok}"`);
  allowed('PowerShell', `pwsh -enc ${b64(`pwsh -enc ${ok}`)}`);
  allowed('Bash', `pwsh -c "Write-Output 1"`);
});

// 229 R-3: nesting past the depth limit, or an inline -c program at the limit, denies a run-record write (fail closed).
const { judgeRecord } = await import(url('hooks/rules/self-protect.mjs'));
const deniedBoth = (tool, command) => {
  denied(tool, command);
  for (const session of SESSIONS) assert.equal(judgeRecord(ev(tool, command, session)).v, 'deny', `judgeRecord deny (${session}): ${command}`);
};
const allowedBoth = (tool, command) => {
  allowed(tool, command);
  for (const session of SESSIONS) assert.equal(judgeRecord(ev(tool, command, session)).v, 'allow', `judgeRecord allow (${session}): ${command}`);
};
const wrapEnc = (n, inner) => { let t = inner; for (let i = 0; i < n; i++) t = `pwsh -enc ${b64(t)}`; return t; };

test('5- and 6-layer pwsh -enc around a forms.jsonl write denies in judge and judgeRecord (229)', () => {
  const write = `Set-Content "${REC}/forms.jsonl" "{}"`;
  for (const shell of ['PowerShell', 'Bash']) for (const n of [4, 5, 6]) deniedBoth(shell, wrapEnc(n, write));
});

test('an inline -c program at the depth limit denies (229, fail closed)', () => {
  for (const shell of ['PowerShell', 'Bash']) {
    deniedBoth(shell, wrapEnc(3, 'pwsh -c "Write-Output 1"'));
    deniedBoth(shell, wrapEnc(3, 'python3 -c "print(1)"'));
  }
});

test('a missing or non-base64 -enc payload denies at any depth (229)', () => {
  for (const shell of ['PowerShell', 'Bash']) {
    for (const cmd of ['pwsh -enc', 'pwsh -enc !!!', 'pwsh -EncodedCommand:***', wrapEnc(1, 'Write-Output 1') + ' ; pwsh -enc']) deniedBoth(shell, cmd);
    deniedBoth(shell, `pwsh -c "pwsh -enc !!!"`);
  }
});

test('shallow harmless nesting and odd-length -EncodedCommand AAAA still allow (229)', () => {
  const ok = b64('Write-Output 1');
  for (const shell of ['PowerShell', 'Bash']) {
    allowedBoth(shell, wrapEnc(2, 'Write-Output 1'));
    allowedBoth(shell, 'pwsh -EncodedCommand AAAA');
    allowedBoth(shell, `pwsh -enc ${ok}`);
  }
});
