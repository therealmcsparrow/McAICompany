// Static reads of .github/workflows/ci.yml for the faster-CI shape: PR concurrency,
// npm cache, one Windows cell on PRs, a cold full matrix on tags, a cold nightly.
// The workflow is parsed as text and never run.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

// Full text with comment-only lines and trailing comments removed (a pin comment is read from `ci`).
const code = ci
  .split('\n')
  .map((l) => (/^\s*#/.test(l) ? '' : l.replace(/\s+#\s.*$/, '')))
  .join('\n');

const jobsText = code.slice(code.indexOf('\njobs:\n') + 1);
const jobs = new Map();
for (const part of jobsText.split(/\n(?=  [A-Za-z0-9_-]+:\n)/).slice(1)) {
  const name = part.match(/^\s*([A-Za-z0-9_-]+):/)[1];
  jobs.set(name, part);
}
const stepsOf = (job) => job.split(/\n      - /).slice(1);
const stepsWith = (job, needle) => stepsOf(job).filter((s) => s.includes(needle));
const jobsWith = (re) => [...jobs].filter(([, t]) => re.test(t));

// Every run: body (single line or block scalar).
function runBodies(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:- )?run:\s*(.*)$/);
    if (!m) continue;
    if (/^[|>][-+]?$/.test(m[2])) {
      const indent = m[1].length;
      const body = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== '' && lines[j].search(/\S/) <= indent) break;
        body.push(lines[j]);
      }
      out.push(body.join('\n'));
    } else out.push(m[2]);
  }
  return out;
}

const onBlock = code.match(/\non:\n((?:[ \t]+[^\n]*\n|\n)+)/)?.[1] ?? '';

describe('hardening kept across the CI speed changes', () => {
  test('hostile: pull_request is the first trigger and no privileged trigger exists', () => {
    assert.ok(onBlock, 'on: block missing');
    const first = onBlock.split('\n').find((l) => /^  [a-z_]+:/.test(l));
    assert.match(first, /^  pull_request:/);
    assert.doesNotMatch(code, /pull_request_target|workflow_run/);
  });
  test('hostile: every uses: is a full commit with a version comment', () => {
    const uses = ci.split('\n').filter((l) => /^\s*(- )?uses:/.test(l));
    assert.ok(uses.length > 0);
    for (const l of uses) assert.match(l, /uses: [^\s@]+@[0-9a-f]{40} # v\d+(\.\d+){0,2}\s*$/, l);
  });
  test('hostile: top-level token is read only and no job asks for a write scope', () => {
    assert.match(code, /\npermissions:\n  contents: read\n/);
    assert.doesNotMatch(code, /:\s*write\b/);
    assert.doesNotMatch(code, /permissions:\s*write-all/);
  });
  test('hostile: no ${{ }} expression inside any run: body, single line or block', () => {
    const bodies = runBodies(code);
    assert.ok(bodies.length > 3);
    for (const b of bodies) assert.doesNotMatch(b, /\$\{\{/, b);
  });
  test('every checkout drops its credentials', () => {
    assert.equal((code.match(/persist-credentials: false/g) ?? []).length, (code.match(/actions\/checkout@/g) ?? []).length);
  });
  test('hostile: no secret is read into a test or check step', () => {
    for (const [name, t] of jobs) {
      for (const s of stepsOf(t).filter((x) => /npm test|npm run check/.test(x))) {
        assert.doesNotMatch(s, /secrets\./, `${name} test step reads a secret`);
      }
    }
  });
});

describe('triggers (AC1, AC4, AC18)', () => {
  test('pull_request, push to main, push of v* tags and a nightly schedule all start CI', () => {
    assert.match(onBlock, /^  pull_request:/m);
    assert.match(onBlock, /^  push:\n(?:[ \t]+[^\n]*\n)*?[ \t]+branches: \[main\]/m);
    assert.match(onBlock, /^  push:\n(?:[ \t]+[^\n]*\n)*?[ \t]+tags:\s*(?:\[\s*['"]?v\*['"]?\s*\]|\n[ \t]+- ['"]?v\*['"]?)/m);
    assert.match(onBlock, /^  schedule:\n[ \t]+- cron: ['"]?[^\n'"]+['"]?\s*$/m);
  });
  test('the nightly cron fires once a day', () => {
    const cron = onBlock.match(/cron: ['"]?([^\n'"]+?)['"]?\s*$/m)?.[1];
    assert.ok(cron, 'no cron');
    const f = cron.trim().split(/\s+/);
    assert.equal(f.length, 5, cron);
    assert.match(f[0], /^\d{1,2}$/, 'minute is one fixed value');
    assert.match(f[1], /^\d{1,2}$/, 'hour is one fixed value');
    assert.deepEqual(f.slice(2), ['*', '*', '*'], 'every day');
  });
});

describe('AC1 concurrency cancels superseded PR runs and nothing else', () => {
  const block = code.match(/\nconcurrency:\n((?:  [^\n]*\n)+)/)?.[1] ?? '';
  test('one workflow-level concurrency group per workflow and ref', () => {
    assert.ok(block, 'no top-level concurrency block');
    const group = block.match(/^  group: (.+)$/m)?.[1] ?? '';
    assert.match(group, /github\.workflow/);
    assert.match(group, /github\.ref\b/);
    assert.doesNotMatch(group, /github\.head_ref|github\.event\./, 'group must not read event text');
  });
  test('cancel-in-progress is true only for pull_request: tags, main and the nightly finish', () => {
    const v = block.match(/^  cancel-in-progress: (.+)$/m)?.[1]?.trim() ?? '';
    assert.match(v, /^\$\{\{\s*github\.event_name == 'pull_request'\s*\}\}$/, v);
    assert.doesNotMatch(code, /cancel-in-progress:\s*true/);
    assert.equal((code.match(/cancel-in-progress:/g) ?? []).length, 1);
  });
  test('hostile: the supersede fallback is not used, so no write scope exists', () => {
    assert.doesNotMatch(code, /actions:\s*write/);
    assert.doesNotMatch(code, /gh run cancel|gh run rerun/);
  });
});

describe('AC3 setup-node uses the npm cache and a miss never fails', () => {
  test('a warm job caches npm from a checked-out lockfile', () => {
    const warm = jobsWith(/cache: npm/).filter(([, t]) => !/AICO_COLD/.test(t));
    assert.ok(warm.length >= 1, 'no warm job sets cache: npm');
    for (const [name, t] of warm) {
      const p = t.match(/cache-dependency-path: ([^\n]+)/)?.[1]?.trim();
      assert.ok(p, `${name}: cache-dependency-path missing`);
      assert.match(p, /package-lock\.json$/, p);
      assert.doesNotMatch(p, /\$\{\{|\.\.|^\/|^[A-Za-z]:/, p);
    }
  });
  test('every cache: value is the literal npm, never an expression', () => {
    const vals = [...code.matchAll(/^\s+cache: (.+)$/gm)].map((m) => m[1].trim());
    assert.ok(vals.length >= 1, 'no cache: key');
    for (const v of vals) assert.equal(v, 'npm');
  });
  test('a cache miss is normal: no fail-on-cache-miss, no hand-made cache action', () => {
    assert.doesNotMatch(code, /fail-on-cache-miss/);
    assert.doesNotMatch(code, /actions\/cache@/);
  });
  test('installs stay npm ci on a cached run', () => {
    assert.doesNotMatch(code, /npm install\b/);
  });
});

describe('AC4 a PR runs one Windows cell; a tag runs the full matrix', () => {
  const check = jobs.get('check') ?? '';
  const win = jobs.get('windows-test') ?? '';
  const agg = jobs.get('windows-check') ?? '';
  const testSteps = (job) => stepsOf(job).filter((s) => /run: npm test|run: npm run check/.test(s));

  test('required check names stay and no matrix job is skipped at job level', () => {
    assert.match(check, /name: check \(\$\{\{ matrix\.os \}\}\)/);
    assert.match(agg, /name: check \(windows-latest\)/);
    for (const [name, t] of [['check', check], ['windows-test', win]]) {
      const head = t.split(/\n    steps:/)[0];
      assert.doesNotMatch(head, /\n    if:/, `${name}: a job-level if leaves the required name pending`);
    }
    assert.match(check, /os: \[ubuntu-latest, macos-latest\]/);
  });
  test('the ubuntu and macos steps are skipped at step level on a PR and run on tags', () => {
    const steps = testSteps(check);
    assert.ok(steps.length >= 2, 'check job lost its test steps');
    for (const s of steps) {
      const cond = s.match(/\n\s+if: ([^\n]+)/)?.[1] ?? '';
      assert.ok(cond, `unguarded: ${s.split('\n')[0]}`);
      assert.match(cond, /refs\/tags\/|ref_type == 'tag'/, 'tags must run the full matrix');
    }
  });
  test('the nightly runs Linux but not macOS', () => {
    const cond = testSteps(check).map((s) => s.match(/\n\s+if: ([^\n]+)/)?.[1] ?? '').join('\n');
    assert.match(cond, /schedule/);
    assert.match(cond, /matrix\.os == 'ubuntu-latest'|matrix\.os != 'macos-latest'/);
  });
  test('the Windows cell has no step guard that drops it on PRs, main, tags or the nightly', () => {
    const t = testSteps(win).filter((s) => /npm test/.test(s));
    assert.ok(t.length >= 1, 'windows-test lost its test step');
    for (const s of t) assert.doesNotMatch(s, /\n\s+if:/, 'the Windows test step must always run');
    assert.match(win, /runs-on: windows-latest/);
    assert.match(agg, /needs: windows-test/);
  });
});

describe('AC14 tags and the nightly run cold, so setting the env alone rolls the cache back', () => {
  test('a cold job sets AICO_COLD to 1 in job env and never caches npm', () => {
    const cold = jobsWith(/AICO_COLD/);
    assert.ok(cold.length >= 1, 'no job sets AICO_COLD');
    for (const [name, t] of cold) {
      assert.doesNotMatch(t, /cache: npm|cache-dependency-path/, `${name} caches while cold`);
      assert.match(t, /\n {6}AICO_COLD: ['"]?1['"]?\s*\n/, `${name} sets AICO_COLD to something other than 1`);
    }
  });
  test('cold applies to tags and to the schedule', () => {
    const cold = jobsWith(/AICO_COLD/).map(([, t]) => t).join('\n');
    assert.match(cold, /refs\/tags\/|ref_type == 'tag'/);
    assert.match(cold, /github\.event_name == 'schedule'/);
  });
  test('hostile: no job mixes a warm cache with AICO_COLD and the value is a literal', () => {
    for (const m of code.matchAll(/AICO_COLD: ([^\n]+)/g)) assert.match(m[1].trim(), /^['"]?1['"]?$/, m[0]);
  });
  test('a PR run is warm: no PR-only job sets AICO_COLD', () => {
    const warm = jobsWith(/cache: npm/);
    assert.ok(warm.length >= 1);
    for (const [name, t] of warm) assert.doesNotMatch(t, /AICO_COLD/, name);
  });
});

describe('AC18 a red nightly is reported and never retried', () => {
  test('hostile: no retry, rerun or loop around a test or check step', () => {
    assert.doesNotMatch(code, /nick-fields\/retry|retry-action|wretry|\bretry\b|\brerun\b|re-run|max_attempts|attempt/i);
    for (const b of runBodies(code)) assert.doesNotMatch(b, /\bfor [a-z]+ in 1 2|\bwhile\b|\buntil\b/, b);
  });
  test('hostile: no continue-on-error on a test or check step, and none on a job that has one', () => {
    for (const [name, t] of jobs) {
      const hasTest = /npm test|npm run check|--aico-cover/.test(t);
      if (!hasTest) continue;
      const head = t.split(/\n    steps:/)[0];
      assert.doesNotMatch(head, /continue-on-error/, `${name}: job-level continue-on-error hides a red`);
      for (const s of stepsOf(t).filter((x) => /npm test|npm run check|--aico-cover/.test(x))) {
        assert.doesNotMatch(s, /continue-on-error/, `${name}: ${s.split('\n')[0]}`);
      }
    }
  });
  test('a red nightly writes a line to the step summary, only on failure and only on schedule', () => {
    const sum = [...jobs.values()].flatMap((t) => stepsWith(t, 'GITHUB_STEP_SUMMARY'));
    assert.ok(sum.length >= 1, 'no GITHUB_STEP_SUMMARY step');
    const s = sum.find((x) => /github\.event_name == 'schedule'/.test(x));
    assert.ok(s, 'summary step is not scoped to the schedule');
    assert.match(s, /\n\s+if: [^\n]*failure\(\)/);
    for (const b of runBodies(s)) assert.doesNotMatch(b, /\$\{\{/);
  });
});
