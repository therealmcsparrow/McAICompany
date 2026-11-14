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

test('powershell wildcards that match a leading dot deny', () => {
  denies(bash('Get-Content *env'), 'star env');
  denies(bash('Get-Content *nv'), 'star nv');
  denies(bash('Get-Content ?env'), 'question env');
  denies(bash('Get-Content src\\*env'), 'after a directory');
  denies(bash('cat *.env'), 'star dot env');
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
  allows(bash('ls *'), 'bare star');
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
