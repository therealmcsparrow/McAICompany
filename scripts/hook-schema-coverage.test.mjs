// qa-owned
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'hooks', 'lib', 'event.mjs'), 'utf8');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'schema', 'hook-fields.json'), 'utf8'));

const collect = (text, re) => new Set([...text.matchAll(re)].map((m) => m[1]));
const union = (...sets) => new Set(sets.flatMap((s) => [...s]));

// Top-level payload fields: reads inside normalize(), where `raw` is the payload.
const normalizeBody = src.slice(src.indexOf('export async function normalize('));
const payloadFields = union(
  collect(normalizeBody, /\braw\.([A-Za-z_]\w*)/g),
  collect(normalizeBody, /\b(?:str|own)\(raw,\s*'([^']+)'/g)
);

// tool_input fields: reads inside toolOf() and the FILE_FIELDS list.
const toolStart = src.indexOf('function toolOf(');
const toolBody = src.slice(toolStart, src.indexOf('\n}\n', toolStart));
const fileFields = (/const FILE_FIELDS = \[([^\]]*)\]/.exec(src)?.[1] ?? '').match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
const inputFields = union(collect(toolBody, /\b(?:str|own)\(input,\s*'([^']+)'/g), new Set(fileFields));

const eventNames = ['SessionStart', 'PreToolUse', 'SubagentStart', 'SubagentStop'];
const schemaPayload = new Set(eventNames.flatMap((e) => [...Object.keys(schema[e]?.required ?? {}), ...Object.keys(schema[e]?.optional ?? {})]));
const schemaInput = new Set(Object.keys(schema.PreToolUse?.tool_input ?? {}));

test('event.mjs payload field derivation finds the known reads', () => {
  for (const f of ['hook_event_name', 'session_id', 'cwd', 'agent_id', 'agent_type', 'tool_name', 'tool_input', 'transcript_path', 'agent_transcript_path', 'stop_hook_active']) {
    assert.ok(payloadFields.has(f), `derivation missed ${f}`);
  }
  for (const f of ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'glob', 'model', 'subagent_type', 'prompt']) {
    assert.ok(inputFields.has(f), `derivation missed tool_input.${f}`);
  }
});

test('every raw payload field event.mjs reads has a row in hook-fields.json', () => {
  const missing = [...payloadFields].filter((f) => !schemaPayload.has(f));
  assert.deepEqual(missing, [], `payload fields read but absent from schema: ${missing.join(', ')}`);
});

test('every tool_input field event.mjs reads has a row in hook-fields.json', () => {
  const missing = [...inputFields].filter((f) => !schemaInput.has(f));
  assert.deepEqual(missing, [], `tool_input fields read but absent from schema: ${missing.join(', ')}`);
});
