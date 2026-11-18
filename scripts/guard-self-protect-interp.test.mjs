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
