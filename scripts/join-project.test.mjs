import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// qa-owned (P20261109.000009-T5). Pins skills/pipeline/references/join-project.md.
// Red until T6 writes the file. AC1, AC6, AC10, AC11.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = 'skills/pipeline/references/join-project.md';
const text = () => readFileSync(join(root, REF), 'utf8');
const has = (t, ...needles) => {
  for (const n of needles) assert.ok(n instanceof RegExp ? n.test(t) : t.includes(n), `missing: ${n}`);
};

test('AC1: the file exists and states the `project: <ProjectID>` line rule', () => {
  const t = text();
  has(t, 'project: <ProjectID>', /hand-over|handover/i, /route/i, /id:/);
  has(t, /never (the )?CEO text|CEO text/i);
});

test('AC1: join only when `run-state projects --json` lists the ID, else act as hand-typed', () => {
  const t = text();
  has(t, 'run-state projects --json', '--layout v3', '--project', /hand-typed/i, /never guess/i);
});

test('AC10: hand-typed Playbook with an active project gets one form before any folder or ID', () => {
  const t = text();
  has(t, /form/i, /join/i, /start new/i, /before any (folder|ID)/i);
});

test('AC10: join is the recommended pick and the form shows at most 3 project IDs', () => {
  const t = text();
  has(t, /recommended/i, /(up to|at most|max(imum)?) 3/i);
});

test('AC11: start new makes a new ID and top-level folder, project untouched; join applies AC1', () => {
  const t = text();
  has(t, /new ID/i, /top-level/i, /untouched/i);
});

test('AC6: no active project means no form and a new project as today', () => {
  const t = text();
  has(t, /no active project/i, /no form|asks? no|never (show|ask)/i);
});

test('AFK: start new, no form', () => {
  const t = text();
  has(t, /AFK/, /start new/i);
});

test('dormant in run 1: no file under skills/ cites join-project', () => {
  const hits = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/join-project/.test(readFileSync(p, 'utf8'))) hits.push(p);
    }
  };
  walk(join(root, 'skills'));
  assert.deepEqual(hits, []);
});
