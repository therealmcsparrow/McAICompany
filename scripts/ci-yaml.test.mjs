// ci.yml must load as YAML. No YAML library is a dependency of this repo, so this is a
// scalar-level lint of the two failure classes that broke the workflow before (code-reviewer R-1):
// a plain scalar holding `: ` (or ending in `:`) and a plain scalar starting with a YAML
// indicator such as `!`. The lint is proven against the old broken forms below.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

export function yamlScalarProblems(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let skipAbove = -1; // inside a block scalar body: lines indented deeper than this are text
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    const indent = l.search(/\S/);
    if (skipAbove >= 0) {
      if (indent > skipAbove) continue;
      skipAbove = -1;
    }
    if (/^\s*#/.test(l)) continue;
    if (/^\s*\t|^ *\t/.test(l)) out.push(`${i + 1}: tab in indentation`);
    const m = l.match(/^(\s*)(?:- )?([A-Za-z0-9_.-]+):(?:\s+(.*))?$/);
    if (!m) continue;
    const v = (m[3] ?? '').trim();
    if (v === '') continue;
    if (/^[|>][-+0-9]*(\s+#.*)?$/.test(v)) {
      skipAbove = m[1].length;
      continue;
    }
    if (v[0] === "'") {
      if (!/^'(?:[^']|'')*'\s*(#.*)?$/.test(v)) out.push(`${i + 1}: bad single-quoted scalar: ${v}`);
      continue;
    }
    if (v[0] === '"') {
      if (!/^"(?:[^"\\]|\\.)*"\s*(#.*)?$/.test(v)) out.push(`${i + 1}: bad double-quoted scalar: ${v}`);
      continue;
    }
    if (v[0] === '[' || v[0] === '{') continue; // flow collection
    const plain = v.replace(/\s+#.*$/, '');
    if (/^[!&*%@`|>,\]}]/.test(plain)) out.push(`${i + 1}: plain scalar starts with an indicator: ${plain}`);
    if (/:(\s|$)/.test(plain)) out.push(`${i + 1}: plain scalar holds ': ': ${plain}`);
  }
  return out;
}

describe('ci.yml loads as YAML (code-reviewer R-1, R-2)', () => {
  test('no plain scalar holds ": " or starts with a YAML indicator, no tab indent', () => {
    assert.deepEqual(yamlScalarProblems(ci), []);
  });
  test('the lint catches the old broken forms (so a regression goes red)', () => {
    const colon = '    steps:\n      - name: x\n        run: echo "nightly red: check ($OS)" >> "$F"\n';
    assert.equal(yamlScalarProblems(colon).length, 1, 'plain run with ": "');
    const bang = '    steps:\n      - if: !(github.event_name == \'pull_request\')\n        name: y\n';
    assert.equal(yamlScalarProblems(bang).length, 1, 'plain if starting with !');
    const ok = '      - if: ${{ !(a == b) }}\n        run: |\n          echo "red: x"\n      - name: z\n';
    assert.deepEqual(yamlScalarProblems(ok), []);
  });
  test('the file is LF text with a top-level name, on, permissions and jobs', () => {
    assert.doesNotMatch(ci, /\r/);
    for (const k of ['name', 'on', 'permissions', 'jobs']) assert.match(ci, new RegExp(`^${k}:`, 'm'), k);
  });
});
