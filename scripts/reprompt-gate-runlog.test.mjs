import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowsTool, cleanPath } from '../mods/lib/reprompt-gate.mjs';

// The run state log of a reprompt run is written only by the Lead's scripts. These tests pin that the
// write gate alone refuses every reprompter call that could write it, in any spelling of the path.

const SLUG = 'reprompt-20260101-0930';
const OTHER_SLUG = 'reprompt-20260101-0931';
const NEW_SLUG = 'bug-20260101-0930-build-draft';
const PLUGIN = '/plug/aico';
const WIN_PLUGIN = 'C:\\Users\\me\\.claude\\plugins\\aico';

const ROOTS = [
  { root: '/work/proj', sep: '/', plugin: PLUGIN },
  { root: 'C:\\Users\\me\\proj', sep: '\\', plugin: WIN_PLUGIN },
  { root: 'C:/Users/me/proj', sep: '/', plugin: WIN_PLUGIN }
];
const PLATFORMS = [undefined, 'linux', 'darwin', 'win32'];

const rec = (root) => ({ slug: SLUG, nn: '01', root });
const join = (sep, ...parts) => parts.join(sep);
const runOf = ({ root, sep }, slug = SLUG) => join(sep, root, '.company', 'work', slug);

// Every spelling of a run state log path a reprompter could send: case, separators, stream suffixes,
// trailing dot or space, 8.3 short names, dot segments, device and UNC prefixes.
function logVariants(env) {
  const { sep } = env;
  const run = runOf(env);
  const log = join(sep, run, 'run-state.jsonl');
  const other = join(sep, runOf(env, OTHER_SLUG), 'run-state.jsonl');
  const newForm = join(sep, runOf(env, NEW_SLUG), 'run-state.jsonl');
  const flip = (p) => (sep === '/' ? p.replace(/\//g, '\\') : p.replace(/\\/g, '/'));
  const drive = /^[A-Za-z]:/.test(env.root);
  const bare = drive ? log.slice(2) : log;
  return [
    log, other, newForm,
    join(sep, run, 'RUN-STATE.JSONL'), join(sep, run, 'Run-State.jsonl'), join(sep, run, 'run-state.JSONL'),
    log.toUpperCase(), other.toUpperCase(),
    flip(log), flip(other), log.replace(/[\\/](run-state)/, (_, n) => (sep === '/' ? `\\${n}` : `/${n}`)),
    `${log}::$DATA`, `${log}:$DATA`, `${log}:x`, `${log}:prompt.md`, join(sep, run, 'prompt.md:run-state.jsonl'),
    join(sep, run, 'prompt.md::$DATA'), `${other}::$DATA`,
    `${log}.`, `${log} `, `${log}. `, `${log}...`, `${log} .`, `${other}.`,
    join(sep, run, 'RUN-ST~1.JSO'), join(sep, run, 'RUNSTA~1.JSO'), join(sep, run, 'run-st~1.jso'),
    join(sep, env.root, '.company', 'work', 'REPROM~1', 'run-state.jsonl'),
    join(sep, env.root, 'COMPAN~1', 'work', SLUG, 'run-state.jsonl'),
    join(sep, run, 'x', '..', 'run-state.jsonl'), join(sep, run, 'prompt.md', '..', 'run-state.jsonl'),
    join(sep, run, '01-reprompter.md', '..', 'run-state.jsonl'), join(sep, run, '..', SLUG, 'run-state.jsonl'),
    join(sep, run, '.', 'run-state.jsonl'), join(sep, run, '', 'run-state.jsonl'),
    join(sep, runOf(env, OTHER_SLUG), '..', SLUG, 'prompt.md', '..', 'run-state.jsonl'),
    join(sep, run, 'prompt.md', 'run-state.jsonl'), join(sep, run, 'run-state.jsonl', 'prompt.md'),
    `\\\\?\\${log}`, `\\\\.\\${log}`, `//?/${flip(log).replace(/\\/g, '/')}`, `\\\\localhost\\C$${bare.replace(/\//g, '\\')}`,
    `/${log}`, drive ? log.slice(0, 2) + log.slice(3) : `.${log}`, bare,
    'run-state.jsonl', `.company/work/${SLUG}/run-state.jsonl`, `.company\\work\\${SLUG}\\run-state.jsonl`
  ];
}

// The tools a reprompter could try a write with, each with the input shape that tool takes.
function writeCalls(path) {
  return [
    ['Write', { file_path: path, content: '{"ev":"end"}\n' }],
    ['Edit', { file_path: path, old_string: 'a', new_string: '{"ev":"end"}' }],
    ['MultiEdit', { file_path: path, edits: [{ old_string: 'a', new_string: '{"ev":"end"}' }] }],
    ['NotebookEdit', { notebook_path: path, file_path: path, new_source: '{"ev":"end"}' }],
    ['Bash', { command: `echo '{"ev":"end"}' >> '${path}'`, file_path: path }],
    ['PowerShell', { command: `Add-Content -LiteralPath '${path}' '{"ev":"end"}'`, file_path: path }],
    ['Agent', { subagent_type: 'general-purpose', prompt: `append {"ev":"end"} to ${path}`, file_path: path }],
    ['Task', { subagent_type: 'general-purpose', prompt: `append {"ev":"end"} to ${path}`, file_path: path }],
    ['Skill', { skill: 'aico:reprompt', args: path, file_path: path }],
    ['Skill', { skill: 'update-config', args: path }],
    ['mcp__filesystem__write_file', { path, file_path: path, content: '{"ev":"end"}' }],
    ['write', { file_path: path, content: 'x' }],
    ['WRITE', { file_path: path, content: 'x' }],
    ['Write ', { file_path: path, content: 'x' }],
    ['Read', { file_path: path }]
  ];
}

test('the gate alone denies reprompter writes to the run state log', () => {
  let checked = 0;
  for (const env of ROOTS) {
    for (const platform of PLATFORMS) {
      for (const path of logVariants(env)) {
        for (const [tool, input] of writeCalls(path)) {
          assert.equal(allowsTool(tool, input, rec(env.root), env.plugin, platform), false,
            `${tool} ${JSON.stringify(path)} root=${env.root} platform=${platform}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 2000);
});

test('the allowed writes still pass, so the denials above are not vacuous', () => {
  for (const env of ROOTS) {
    for (const platform of PLATFORMS) {
      const run = runOf(env);
      for (const name of ['prompt.md', '01-reprompter.md']) {
        const input = { file_path: join(env.sep, run, name), content: 'x' };
        assert.equal(allowsTool('Write', input, rec(env.root), env.plugin, platform), true, `${name} ${env.root} ${platform}`);
      }
    }
  }
});

test('no tool but Write and Read takes a path, even the allowed prompt path', () => {
  for (const env of ROOTS) {
    const prompt = join(env.sep, runOf(env), 'prompt.md');
    for (const [tool, input] of writeCalls(prompt)) {
      if (tool === 'Write' || tool === 'Read') continue;
      assert.equal(allowsTool(tool, input, rec(env.root), env.plugin), false, `${tool} ${env.root}`);
    }
    assert.equal(allowsTool('Skill', { skill: 'aico:handoff' }, rec(env.root), env.plugin), true);
  }
});

test('no clean spelling of a log path equals an allowed Write target', () => {
  for (const env of ROOTS) {
    for (const ci of [false, true]) {
      const run = cleanPath(runOf(env), ci);
      const allowed = new Set([`${run}/prompt.md`, `${run}/01-reprompter.md`]);
      for (const path of logVariants(env)) {
        const clean = cleanPath(path, ci);
        assert.ok(clean === null || !allowed.has(clean), `${JSON.stringify(path)} -> ${clean}`);
      }
    }
  }
});

test('a Write whose target is not a string or not an own key is refused', () => {
  const env = ROOTS[0];
  const log = join(env.sep, runOf(env), 'run-state.jsonl');
  const prompt = join(env.sep, runOf(env), 'prompt.md');
  for (const value of [[log], { toString: () => prompt }, [prompt], null, 1, undefined]) {
    assert.equal(allowsTool('Write', { file_path: value, content: 'x' }, rec(env.root), env.plugin), false, String(value));
  }
  assert.equal(allowsTool('Write', Object.create({ file_path: prompt }), rec(env.root), env.plugin), false);
});
