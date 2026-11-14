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
