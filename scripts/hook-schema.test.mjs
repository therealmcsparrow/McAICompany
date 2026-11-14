import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The schema file hooks/schema/hook-fields.json holds field
// names and types only, never a payload value, and names the fields of the
// Lead and the Step session. Source of the field list: hook-event v1
// "Raw input" and the spike answer.
//
// Assumed shape (the contract fixes names, not layout): a JSON object whose event
// rows are keyed by hook_event_name, top level or under `events`; a row maps field
// name -> type word, an object field maps to a nested object of the same kind.

const root = path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'hooks', 'schema', 'hook-fields.json');
const TYPE_WORDS = new Set(['string', 'number', 'boolean', 'object', 'array', 'null', 'integer',
  'str', 'num', 'bool', 'obj', 'arr']);

function load() {
  assert.ok(fs.existsSync(file), 'hooks/schema/hook-fields.json exists');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function row(schema, event) {
  const r = schema[event] ?? schema.events?.[event];
  assert.ok(r && typeof r === 'object', `schema has a row for ${event}`);
  return r;
}
function keys(node, out = new Set()) {
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) { out.add(k); keys(v, out); }
  }
  return out;
}
function leaves(node, out = []) {
  if (Array.isArray(node)) node.forEach((v) => leaves(v, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => leaves(v, out));
  else out.push(node);
  return out;
}
function has(node, names) {
  const k = keys(node);
  return names.filter((n) => !k.has(n));
}

const COMMON = ['hook_event_name', 'session_id', 'transcript_path', 'cwd'];

test('AC1: schema file exists and parses as a JSON object', () => {
  const s = load();
  assert.equal(typeof s, 'object');
  assert.ok(!Array.isArray(s));
});

test('AC1: every leaf is a type word, never a payload value', () => {
  const bad = leaves(load()).filter((v) => typeof v !== 'string' || !TYPE_WORDS.has(v));
  assert.deepEqual(bad, [], 'only type words are leaves');
});

test('AC1: no path, id, uuid, user name or prompt text anywhere in the file', () => {
  load();
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.length < 16 * 1024, 'schema stays small (names and types only)');
  assert.doesNotMatch(text, /[A-Za-z]:[\\/]/, 'no drive path');
  assert.doesNotMatch(text, /\\\\|\/(?:Users|home|tmp)\//, 'no path');
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'no uuid');
  assert.doesNotMatch(text, /CarloHermus|claude-(?:haiku|sonnet|opus)-\d|2\.1\.\d{3}/i, 'no user, model id or version value');
  assert.doesNotMatch(text, /\.jsonl|\.mjs|git add|\.env/, 'no file name or command value');
});

test('AC1: every key is a plain field name, not a value', () => {
  load();
  for (const k of keys(load())) {
    assert.match(k, /^[A-Za-z_][A-Za-z0-9_]*$/, `key "${k}" looks like a field name`);
  }
});

for (const event of ['SessionStart', 'PreToolUse', 'SubagentStart', 'SubagentStop']) {
  test(`AC1: ${event} row lists the common fields`, () => {
    assert.deepEqual(has(row(load(), event), COMMON), []);
  });
}

test('AC1: SessionStart row has source', () => {
  assert.deepEqual(has(row(load(), 'SessionStart'), ['source']), []);
});

test('AC1 + AC28: PreToolUse row has tool fields, and the Lead fields', () => {
  assert.deepEqual(has(row(load(), 'PreToolUse'),
    ['tool_name', 'tool_input', 'permission_mode']), []);
});

test('AC1: PreToolUse tool_input holds the fields hook-event v1 reads', () => {
  const r = row(load(), 'PreToolUse');
  assert.deepEqual(has(r, ['command', 'file_path', 'notebook_path', 'pattern', 'path', 'glob',
    'model', 'subagent_type', 'prompt']), []);
});

test('AC28: PreToolUse row has the Step fields agent_id and agent_type', () => {
  assert.deepEqual(has(row(load(), 'PreToolUse'), ['agent_id', 'agent_type']), []);
});

test('AC28: SubagentStart row has agent_id and agent_type', () => {
  assert.deepEqual(has(row(load(), 'SubagentStart'), ['agent_id', 'agent_type']), []);
});

test('AC28: SubagentStop row has agent_id, agent_type, agent_transcript_path, stop_hook_active', () => {
  assert.deepEqual(has(row(load(), 'SubagentStop'),
    ['agent_id', 'agent_type', 'agent_transcript_path', 'stop_hook_active']), []);
});

test('AC28: the Step-only fields are not required in SessionStart', () => {
  const k = keys(row(load(), 'SessionStart'));
  assert.ok(!k.has('agent_id'), 'a Lead SessionStart has no agent_id');
});

test('AC1 + AC28: transcript row fields of both sessions (tokens and model guards)', () => {
  const k = keys(load());
  for (const n of ['isSidechain', 'message', 'model', 'usage', 'input_tokens', 'output_tokens',
    'cache_creation_input_tokens', 'cache_read_input_tokens']) {
    assert.ok(k.has(n), `schema names transcript field ${n}`);
  }
});

test('AC1: the types of the guard fields are right', () => {
  const r = row(load(), 'PreToolUse');
  const typeOf = (name, node = r) => {
    if (node && typeof node === 'object') {
      if (Object.hasOwn(node, name)) return node[name];
      for (const v of Object.values(node)) { const t = typeOf(name, v); if (t !== undefined) return t; }
    }
    return undefined;
  };
  assert.match(String(typeOf('tool_name')), /^(string|str)$/);
  assert.match(String(typeOf('agent_id')), /^(string|str)$/);
  const stop = row(load(), 'SubagentStop');
  const t = (function f(n) {
    if (n && typeof n === 'object') {
      if (Object.hasOwn(n, 'stop_hook_active')) return n.stop_hook_active;
      for (const v of Object.values(n)) { const x = f(v); if (x !== undefined) return x; }
    }
  })(stop);
  assert.match(String(t), /^(boolean|bool)$/);
});
