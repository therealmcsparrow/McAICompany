// Evasion tests for hooks/rules/dotenv.mjs#judge: over-long commands, glob worst cases,
// brace globs, bracket classes and ANSI-C quoting. Every unsure case denies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { judge } = await import(pathToFileURL(path.join(root, 'hooks', 'rules', 'dotenv.mjs')).href);

const P = (raw) => ({ raw, expanded: null, real: null, exists: false, dir: false });
const ev = (name, { paths = [], command = null } = {}) => ({ tool: { name, command, paths } });
const denies = (e, label) => assert.equal(judge(e).v, 'deny', label);
const allows = (e, label) => assert.deepEqual(judge(e), { v: 'allow' }, label);
const bash = (command) => ev('Bash', { command });
const ps = (command) => ev('PowerShell', { command });

test('over-long command denies even when the secret path is at the tail', () => {
  denies(bash(`echo ${'a '.repeat(40000)} cat .env`), 'tail past 65536');
  denies(bash(`${'x'.repeat(70000)}`), 'over-long benign command');
  allows(bash(`echo ${'a '.repeat(1000)}`), 'long but within bound');
});

test('glob worst case runs in linear time', () => {
  const nasty = '.' + '*a'.repeat(100) + 'b';
  const start = process.hrtime.bigint();
  for (let i = 0; i < 50; i += 1) {
    judge(ev('Glob', { paths: [P(nasty)] }));
    judge(bash(`cat ${nasty}`));
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 500, `took ${ms}ms`);
});

test('collapsed and long star runs still decide', () => {
  denies(ev('Glob', { paths: [P('.***env***')] }), 'star run');
  denies(ev('Glob', { paths: [P('.' + '*'.repeat(200))] }), 'all stars after dot');
  denies(ev('Glob', { paths: [P('.' + '[a-z]'.repeat(60) + '*')] }), 'over-long glob fails closed');
});

test('brace globs in a Grep glob deny', () => {
  denies(ev('Grep', { paths: [P('{.env,x}')] }), '{.env,x}');
  denies(ev('Grep', { paths: [P('.{env,x}')] }), '.{env,x}');
  denies(ev('Grep', { paths: [P('src/{a,.env}')] }), 'dir prefix');
  denies(ev('Grep', { paths: [P('{a/b,.env}')] }), 'slash inside group');
  denies(ev('Grep', { paths: [P('.{e,x}nv')] }), 'split name');
  denies(ev('Grep', { paths: [P('{,.}{env,x}')] }), 'nested alternatives');
  allows(ev('Grep', { paths: [P('{a,b}')] }), 'harmless braces');
  allows(ev('Grep', { paths: [P('{.env.example,x}')] }), 'template braces');
  allows(ev('Grep', { paths: [P('*.{ts,js}')] }), 'ordinary braces');
});

test('brace explosion denies quickly', () => {
  const start = process.hrtime.bigint();
  denies(bash(`cat ${'{a,b}'.repeat(30)}`), 'explosion');
  assert.ok(Number(process.hrtime.bigint() - start) / 1e6 < 1000);
});

test('bash spellings of .env deny', () => {
  denies(bash('cat .{e,x}nv'), 'brace');
  denies(bash('cat .e[[:alpha:]]v'), 'posix class');
  denies(bash("cat $'.e\\x6ev'"), 'ansi hex');
  denies(bash("cat $'.e\\156v'"), 'ansi octal');
  denies(bash("cat $'\\x2eenv'"), 'ansi dot');
  denies(bash("cat $'.e\\u006ev'"), 'ansi unicode');
  denies(bash('cat .e[nz-a]v'), 'reversed range');
  denies(bash('cat .e[!x]v'), 'negated set');
  denies(bash('cat .e[[:nosuch:]]v'), 'unknown class');
  denies(bash('cat .e{n,z}v'), 'brace pair');
});

test('sequence braces and empty expansions that spell .env deny', () => {
  denies(bash('cat .e{m..n}v'), 'sequence brace');
  denies(bash('cat .{e..e}nv'), 'sequence brace head');
  denies(bash('cat .e${x}nv'), 'empty parameter');
  denies(bash('cat .e$x'), 'bare parameter at the tail');
  denies(bash('cat .e$(:)nv'), 'empty command substitution');
  denies(bash('cat .e`:`nv'), 'empty backtick');
  denies(bash('cat ".e${x}nv"'), 'expansion inside double quotes');
  denies(bash('cat src/.e$(:)nv'), 'expansion after a directory');
  denies(bash('(cat .e${x}nv)'), 'subshell');
  denies(bash('cat .e$(echo $(:))nv'), 'nested substitution');
  denies(bash('cat .e${x:-}nv'), 'default expansion');
});

test('an unclosed sequence brace over long dotted words stays linear', () => {
  const time = (parts) => {
    const command = `echo {${parts}`;
    const start = process.hrtime.bigint();
    judge(bash(command));
    return Number(process.hrtime.bigint() - start) / 1e6;
  };
  const unit = `${'.'.repeat(4000)}=`;
  time(unit);
  const small = Math.max(time(unit.repeat(2)), 1);
  const large = time(unit.repeat(16));
  assert.ok(large < small * 40 + 100, `small ${small}ms, large ${large}ms`);
  assert.ok(large < 500, `took ${large}ms`);
  denies(bash(`echo {${unit.repeat(16)} cat .e{m..n}v`), 'sequence brace after a long word');
  denies(bash('cat .{m..n}{m..n}nv'), 'two sequence braces in one word');
  allows(bash('echo {a,b..c}'), 'comma inside the braces is not a sequence');
});

test('powershell wildcards that match a leading dot deny', () => {
  denies(ps('Get-Content *env'), 'star env');
  denies(ps('Get-Content *nv'), 'star nv');
  denies(ps('Get-Content ?env'), 'question env');
  denies(ps('Get-Content src\\*env'), 'after a directory');
  denies(ps('cat *.env'), 'star dot env');
});

test('typed non-dot wildcards deny in powershell when they match a dotenv sample', () => {
  denies(ps('Get-Content *'), 'bare star');
  denies(ps('cat *'), 'cat star');
  denies(ps('Get-Content *.local'), 'star dot local');
  denies(ps('Get-Content *nv.local'), 'star nv dot local');
  denies(ps('Get-Content ?env.production'), 'question env production');
  allows(ps('ls *.mjs *.md'), 'extension globs');
  allows(ps('Get-Content *.json'), 'json glob');
});

test('bash star and question wildcards skip dotfiles and allow', () => {
  allows(bash('cat *'), 'cat star');
  allows(bash('cat *.local'), 'star dot local');
  allows(bash('ls *.mjs *.md'), 'extension globs');
  denies(bash('cat .e*'), 'dot-led star');
  denies(bash('cat .*'), 'dot star');
});

test('an over-long token denies', () => {
  denies(bash('cat ' + './'.repeat(2100) + '.env'), 'padded dot path');
  denies(bash('cat ' + 'a/'.repeat(2100) + '.e{n,x}v'), 'padded brace');
  denies(bash('cat ' + 'a'.repeat(5000)), 'long plain word');
  allows(bash('git commit -m "' + 'word '.repeat(1200) + '"'), 'long message made of short words');
});

test('expansions that cannot reach a dotenv name pass', () => {
  allows(bash('echo $HOME'), 'plain parameter');
  allows(bash('cat $dir/$name'), 'parameters only');
  allows(bash('cat ${HOME}/notes.txt'), 'braced parameter');
  allows(bash('echo $(date) `date`'), 'substitutions');
  allows(bash('echo file{1..3}.txt'), 'sequence in a plain name');
  allows(bash('echo $?'), 'status parameter alone');
  allows(bash('ls *.mjs *.md'), 'extension globs');
  allows(bash('node --test scripts/*.test.mjs'), 'test glob');
  allows(bash('echo $?'), 'status parameter');
});

test('similar but harmless commands pass', () => {
  allows(bash("cat $'.e\\x6ev.example'"), 'ansi template');
  allows(bash('echo {a,b}'), 'echo braces');
  allows(bash('ls -la src/*.mjs'), 'ordinary glob');
  allows(bash('cat .e[x]v'), 'set without n');
  allows(bash('cat .e[[:digit:]]v'), 'digit class');
});

test('a malformed event or throwing input denies instead of allowing', () => {
  const hostile = { tool: { name: 'Bash', command: 'cat x', get paths() { throw new Error('boom'); } } };
  assert.equal(judge(hostile).v, 'deny');
});

test('a Grep glob with braces is judged through the normalized event', async () => {
  const { normalize } = await import(pathToFileURL(path.join(root, 'hooks', 'lib', 'event.mjs')).href);
  const ctx = { env: {}, schema: null, pluginRoot: root, mcsHome: path.join(root, '.mcs-none'), resolveRun: null };
  const verdict = async (glob) => {
    const r = await normalize({ hook_event_name: 'PreToolUse', session_id: 's', cwd: root, tool_name: 'Grep', tool_input: { glob } }, ctx);
    assert.ok(r.ok, 'normalize ok');
    return judge(r.event);
  };
  assert.equal((await verdict('{.env,x}')).v, 'deny', 'brace glob naming .env');
  assert.equal((await verdict('x{a,.env}')).v, 'allow', 'brace glob with no dotenv name');
  assert.deepEqual(await verdict('*.{mjs,json}'), { v: 'allow' }, 'ordinary brace glob');
  denies(ev('Grep', { paths: [P('{.env,x}')] }), 'brace path entry');
});

test('path globs that open with a wildcard deny', () => {
  for (const glob of ['*env', '?env', '**/*env', '*nv.local', '*nv.production']) {
    denies(ev('Grep', { paths: [P(glob)] }), `Grep glob ${glob}`);
    denies(ev('Glob', { paths: [P(glob)] }), `Glob pattern ${glob}`);
  }
  allows(ev('Glob', { paths: [P('**/*.mjs')] }), 'ordinary glob pattern');
});

test('PowerShell started from Bash keeps leading wildcards denied', () => {
  denies(bash('powershell -c "Get-Content *env"'), 'powershell -c');
  denies(bash('pwsh -Command "gc ?env"'), 'pwsh');
  denies(bash('powershell.exe -c "gc *nv.local"'), 'sample other than .env');
  denies(ps('Get-Content *env'), 'PowerShell tool');
});

test('expansion words are tested against every sample', () => {
  denies(bash('x=.e; cat ${x}nv.local'), 'bash expansion');
  denies(bash('powershell -c \'$x=".e"; Get-Content "${x}nv.local"\''), 'powershell expansion');
  denies(ps('$x=\'.e\'; Get-Content "${x}nv.local"'), 'PowerShell tool expansion');
});

test('a bare Bash star stays allowed', () => {
  allows(bash('cat *'), 'cat star');
  allows(bash('ls ?'), 'ls question mark');
});

test('nothing the earlier dotenv rule denied is allowed now', async () => {
  const { execFileSync } = await import('node:child_process');
  const source = execFileSync('git', ['show', '2471098:hooks/rules/dotenv.mjs'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24 });
  const pathsUrl = pathToFileURL(path.join(root, 'hooks', 'lib', 'paths.mjs')).href;
  const patched = source.replace("'../lib/paths.mjs'", JSON.stringify(pathsUrl));
  const old = await import(`data:text/javascript;base64,${Buffer.from(patched).toString('base64')}`);
  const bases = ['.env', '.env.local', 'env', '*env', '?env', '*nv.local', '*', '*.mjs', 'e*v', '.e*', '.?nv', '[.]env', '{.env,x}',
    '**/*env', '$x', '${x}nv.local', '$x.env', 'a$x', '.e$x', 'env~1', '*~1', '.env.example', 'x/.env', 'x/*env', '$(echo .env)'];
  const names = ['Bash', 'PowerShell', 'Grep', 'Glob', 'Read'];
  const wrappers = [(b) => b, (b) => `cat ${b}`, (b) => `powershell -c "gc ${b}"`, (b) => `x='.e'; cat "${b}"`, (b) => `echo ${b} | cat`];
  let checked = 0;
  for (const base of bases) {
    for (const name of names) {
      const events = name === 'Bash' || name === 'PowerShell'
        ? wrappers.map((w) => ev(name, { command: w(base) }))
        : [ev(name, { paths: [P(base)] })];
      for (const e of events) {
        checked += 1;
        if (old.judge(e).v === 'deny') assert.equal(judge(e).v, 'deny', `${name}: ${JSON.stringify(e.tool)}`);
      }
    }
  }
  assert.ok(checked > 100);
});
