import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { manifestFromBaseline } from './install-skills.mjs';
import { readBaseline } from './skill-catalog.mjs';

// Tests for what the wizard template's env and secret helpers do when run with bash in temporary folders,
// and the install pins.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const section = (t, from, to) => {
  const a = t.indexOf(from);
  assert.ok(a >= 0, `missing marker ${from}`);
  const b = to ? t.indexOf(to, a + from.length) : -1;
  return t.slice(a, b < 0 ? undefined : b);
};

test('B2 wizard template: set_secret does not pass --body - (gh reads stdin only when --body is absent)', () => {
  const t = read('skills/wizard/template.sh');
  const fn = section(t, 'set_secret() {', '\n}\n');
  assert.doesNotMatch(fn, /--body\s+-(?![\w-])/, 'gh secret set --body - may store a literal "-" (gh help: --body "reads from standard input if not specified")');
  assert.match(fn, /gh secret set "\$1"/, 'still sets the secret named by $1');
  assert.match(fn, /"\$2"/, 'still passes the value $2');
});

test('B2b wizard template: write_env checks that git ignores the env file before writing a value', () => {
  const t = read('skills/wizard/template.sh');
  const fn = section(t, 'write_env() {', '\n}\n');
  assert.match(fn, /git[^\n]*check-ignore/, 'write_env has no gitignore check');
});

// Runs the helper functions of skills/wizard/template.sh (everything above the STAGES marker) with bash in a temp
// folder. Home points at the temp folder, git config files are off, and PATH starts with stub tools.
const bashOk = spawnSync('bash', ['-c', 'true']).status === 0 && spawnSync('git', ['--version']).status === 0;
const lib = () => { const t = read('skills/wizard/template.sh'); return t.slice(0, t.indexOf('# ---- STAGES')); };
function wizardRun(body, { stubs = {}, late = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wiz-'));
  try {
    for (const [sub, set] of [['bin', stubs], ['late', late]]) {
      mkdirSync(join(dir, sub));
      for (const [name, text] of Object.entries(set)) { writeFileSync(join(dir, sub, name), '#!/bin/sh\n' + text + '\n'); chmodSync(join(dir, sub, name), 0o755); }
    }
    writeFileSync(join(dir, 'lib.sh'), lib());
    writeFileSync(join(dir, 'run.sh'), body);
    const r = spawnSync('bash', [join(dir, 'run.sh')], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, W: dir, HOME: dir, USERPROFILE: dir, XDG_CONFIG_HOME: dir, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: dir, TMP: dir },
    });
    return { out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const prelude = `set +e
W="$(cygpath -u "$W" 2>/dev/null || printf '%s' "$W")"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_CEILING_DIRECTORIES="$W/.."
export PATH="$W/bin:$PATH"
. "$W/lib.sh"
set +e
mkdir -p "$W/repo" && cd "$W/repo" && git init -q . >/dev/null 2>&1
`;
const envCase = (setup, call, opts) => {
  const r = wizardRun(prelude + setup + '\n' + call + '\necho "rc=$?"\nif [ -f "$W/repo/.env" ]; then echo "FILE:$(tr "\\n" "|" < "$W/repo/.env")"; else echo "FILE:none"; fi\n', opts);
  return { rc: (r.out.match(/rc=(\d+)/) || [])[1], file: (r.out.match(/FILE:(.*)/) || [])[1], out: r.out };
};
const ign = 'printf ".env\\n" > .gitignore';

test('B2c write_env writes only when git says the file is ignored; every other answer refuses and writes nothing', { skip: !bashOk }, () => {
  const call = 'ENV_FILE=.env write_env KEY dummy-value';
  const ignored = envCase(ign, call);
  assert.equal(ignored.rc, '0', ignored.out);
  assert.equal(ignored.file, 'KEY=dummy-value|', 'an ignored file is written');
  const cases = {
    'not ignored': 'true',
    'tracked and ignored': ign + '; : > .env; git add -f .env >/dev/null 2>&1',
    'negated': 'printf ".env*\\n!.env\\n" > .gitignore',
    'ignored only by a pattern for another name': 'printf ".env.local\\n" > .gitignore',
  };
  for (const [name, setup] of Object.entries(cases)) {
    const r = envCase(setup, call);
    assert.equal(r.rc, '1', name + ': ' + r.out);
    assert.match(r.out, /Refusing to write KEY/, name);
    assert.ok(!r.file.includes('dummy-value'), name + ': value written: ' + r.file);
  }
});

test('B2c write_env refuses when git itself fails (stub git exits 128, as with dubious ownership)', { skip: !bashOk }, () => {
  const r = envCase(ign, 'export PATH="$W/late:$PATH"; ENV_FILE=.env write_env KEY dummy-value', { late: { git:'echo "fatal: detected dubious ownership in repository" >&2; exit 128' } });
  assert.equal(r.rc, '1', r.out);
  assert.match(r.out, /Refusing to write KEY/);
  assert.ok(!r.file.includes('dummy-value'), r.file);
});

test('B2c write_env judges the file by its real repo, from outside the repo and for a folder that does not exist', { skip: !bashOk }, () => {
  const out = 'mkdir -p "$W/elsewhere" && cd "$W/elsewhere"';
  const outside = envCase(out, 'ENV_FILE="$W/repo/.env" write_env KEY dummy-value');
  assert.equal(outside.rc, '1', outside.out);
  assert.ok(!outside.file.includes('dummy-value'), outside.file);
  const ignoredOutside = envCase(ign + '; ' + out, 'ENV_FILE="$W/repo/.env" write_env KEY dummy-value');
  assert.equal(ignoredOutside.rc, '0', ignoredOutside.out);
  assert.equal(ignoredOutside.file, 'KEY=dummy-value|');
  const missing = envCase('true', 'ENV_FILE="$W/nope/.env" write_env KEY dummy-value');
  assert.equal(missing.rc, '1', missing.out);
  assert.match(missing.out, /does not exist/);
});

test('B2c write_env cannot be steered by an exported CDPATH, GIT_DIR or GIT_WORK_TREE (hostile environment)', { skip: !bashOk }, () => {
  const call = 'ENV_FILE=config/.env write_env KEY dummy-value';
  const cdpath = envCase('mkdir -p config "$W/other/config"; export CDPATH="$W/other"', call + '; r=$?; test -f config/.env && echo "WROTE:yes" || echo "WROTE:no"; (exit $r)');
  assert.equal(cdpath.rc, '1', 'CDPATH: ' + cdpath.out);
  assert.match(cdpath.out, /Refusing to write KEY/);
  assert.match(cdpath.out, /WROTE:no/, 'CDPATH: file exists: ' + cdpath.out);
  const gitVars = 'mkdir -p "$W/tree/config" "$W/bare" && git init -q --bare "$W/bare" >/dev/null 2>&1; cd "$W/tree"; export GIT_DIR="$W/bare" GIT_WORK_TREE="$W/tree"';
  const hostile = envCase(gitVars, call + '; r=$?; test -f "$W/tree/config/.env" && echo "WROTE:yes" || echo "WROTE:no"; (exit $r)');
  assert.equal(hostile.rc, '1', 'GIT_DIR: ' + hostile.out);
  assert.match(hostile.out, /WROTE:no/, 'GIT_DIR: file exists: ' + hostile.out);
  // The repo does not ignore config/.env; a decoy repo ignores everything and is named through the environment.
  const decoy = 'mkdir -p config "$W/decoy" && git init -q "$W/decoy" >/dev/null 2>&1; printf "*\n" > "$W/decoy/.git/info/exclude"';
  const wrote = call + '; r=$?; test -f config/.env && echo "WROTE:yes" || echo "WROTE:no"; (exit $r)';
  const steer = {
    'GIT_DIR alone (decoy ignores all)': decoy + '; export GIT_DIR="$W/decoy/.git"',
    'GIT_DIR with GIT_WORK_TREE': decoy + '; export GIT_DIR="$W/decoy/.git" GIT_WORK_TREE="$W/repo"',
    'non-bare GIT_DIR in another repo': decoy + '; export GIT_DIR="$W/decoy/.git" GIT_WORK_TREE="$W/decoy"',
    'GIT_CONFIG_COUNT with core.excludesFile': 'mkdir -p config; printf "*\n" > "$W/all-ignored"; export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.excludesFile GIT_CONFIG_VALUE_0="$W/all-ignored"',
  };
  for (const [name, setup] of Object.entries(steer)) {
    const r = envCase(setup, wrote);
    assert.equal(r.rc, '1', name + ': ' + r.out);
    assert.match(r.out, /WROTE:no/, name + ': file exists: ' + r.out);
    assert.match(r.out, /Refusing to write KEY/, name);
  }
  // Global and system config, HOME and XDG sources must not decide the answer. Paths inside config files use pwd -W (native form): git cannot resolve /p/... there.
  const nat = 'WN="$(cd "$W" && (pwd -W 2>/dev/null || pwd))"; mkdir -p config; printf "*\\n" > "$W/all-ignored"; printf "[core]\\n\\texcludesFile = %s/all-ignored\\n" "$WN" > "$W/ign.cfg"; unset GIT_CONFIG_GLOBAL GIT_CONFIG_NOSYSTEM';
  const cfg = {
    'GIT_CONFIG_GLOBAL': nat + '; export GIT_CONFIG_GLOBAL="$WN/ign.cfg"',
    'GIT_CONFIG_SYSTEM': nat + '; export GIT_CONFIG_SYSTEM="$WN/ign.cfg"',
    'HOME with .gitconfig': nat + '; mkdir -p "$W/home"; cp "$W/ign.cfg" "$W/home/.gitconfig"; export HOME="$W/home" USERPROFILE="$W/home"; unset XDG_CONFIG_HOME',
    'XDG_CONFIG_HOME with git/config': nat + '; mkdir -p "$W/xdg/git" "$W/nohome"; cp "$W/ign.cfg" "$W/xdg/git/config"; export XDG_CONFIG_HOME="$W/xdg" HOME="$W/nohome" USERPROFILE="$W/nohome"',
    'XDG_CONFIG_HOME with default git/ignore': nat + '; mkdir -p "$W/xdg/git" "$W/nohome"; cp "$W/all-ignored" "$W/xdg/git/ignore"; export XDG_CONFIG_HOME="$W/xdg" HOME="$W/nohome" USERPROFILE="$W/nohome"',
  };
  for (const [name, setup] of Object.entries(cfg)) {
    const r = envCase(setup, wrote);
    assert.equal(r.rc, '1', name + ': ' + r.out);
    assert.match(r.out, /WROTE:no/, name + ': file exists: ' + r.out);
    assert.match(r.out, /Refusing to write KEY/, name);
  }
  // A tracked, ignored file stays refused when GIT_INDEX_FILE points at a missing index.
  const idx = envCase(ign + '; mkdir -p config; printf "config/.env\n" > .gitignore; : > config/.env; git add -f config/.env >/dev/null 2>&1; export GIT_INDEX_FILE="$W/no-such-index"', call + '; r=$?; echo "CONTENT:$(cat config/.env)"; (exit $r)');
  assert.equal(idx.rc, '1', 'GIT_INDEX_FILE: ' + idx.out);
  assert.doesNotMatch(idx.out, /dummy-value/, 'GIT_INDEX_FILE: tracked file overwritten: ' + idx.out);
});

test('B2c set_secret pipes the value to gh on stdin and keeps it out of argv (stub gh)', { skip: !bashOk }, () => {
  const stub = 'printf "%s\\n" "$@" > "$W_REC/argv"; cat > "$W_REC/stdin"';
  const body = prelude + 'REC="$W/rec"; mkdir -p "$REC"; export W_REC="$REC"\n'
    + '[ "$(command -v gh)" = "$W/bin/gh" ] || { echo "REAL-GH"; exit 9; }\n'
    + 'set_secret MY_NAME dummy-value >/dev/null\n'
    + 'echo "ARGV:$(tr "\\n" "|" < "$REC/argv")"\necho "STDIN:$(cat "$REC/stdin")"\n';
  const r = wizardRun(body, { stubs: { gh: stub } });
  assert.doesNotMatch(r.out, /REAL-GH/, 'the stub gh is not first on PATH');
  assert.match(r.out, /ARGV:secret\|set\|MY_NAME\|/, r.out);
  assert.doesNotMatch(r.out, /ARGV:[^\n]*dummy-value/, 'the value is in argv');
  assert.match(r.out, /STDIN:dummy-value/, r.out);
});

test('B4 impeccable is never run by setup at any scope: pinned command, manual line, WARNING (deps/3rdpartyskills.json)', async () => {
  const groups = manifestFromBaseline(readBaseline());
  const imp = groups.core.find(e => e.name === 'impeccable');
  assert.equal(imp.install, 'npx -y impeccable@4.8.0 skills install');
  const { main } = await import('./install-skills.mjs');
  const out = [], calls = [];
  const code = main(['core'], { manifest: { core: [imp] }, home: '/h', cwd: '/repo', platform: 'linux', color: false, log: x => out.push(x), exec: c => { calls.push(c); } });
  assert.equal(code, 0, out.join('|'));
  assert.deepEqual(calls, [], 'nothing ran');
  assert.ok(out.includes(`manual ${imp.install}`), out.join('|'));
  assert.ok(out.some(l => /^WARNING: /.test(l) && l.includes(imp.install)), out.join('|'));
});

test('B4 no auto-installed skill runs an unpinned npx package (deps/3rdpartyskills.json)', () => {
  const groups = manifestFromBaseline(readBaseline());
  const installs = [];
  for (const [g, entries] of Object.entries(groups)) for (const e of entries) if (e.install) installs.push([g, e.name, e.install]);
  for (const [g, name, cmd] of installs) {
    assert.match(cmd, /^npx -y [\w.@/-]+@\d+\.\d+\.\d+(\s|$)/, `${g}/${name}: "${cmd}" pulls whatever npm serves today (pin the version, or take it off the list)`);
  }
});
