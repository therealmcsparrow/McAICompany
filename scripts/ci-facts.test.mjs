// Static reads of .github/workflows/ci.yml for the docs-only skip and the a11y job
// (test-run v1.2 `## CI jobs`, diff-facts v1.0 `show --github-output`).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

const jobsAt = ci.indexOf('\njobs:\n');
const jobsText = jobsAt < 0 ? '' : ci.slice(jobsAt + 1);
const jobs = new Map();
{
  const parts = jobsText.split(/\n(?=  [A-Za-z0-9_-]+:\n)/).slice(1);
  for (const p of parts) jobs.set(p.match(/^ {2}([A-Za-z0-9_-]+):/)[1], p);
}
const jobOf = (name) => jobs.get(name) ?? '';
const check = jobOf('check');
const win = jobOf('windows-test');
const agg = jobOf('windows-check');
const a11yKey = [...jobs.keys()].find((k) => /a11y/i.test(k));
const a11y = a11yKey ? jobs.get(a11yKey) : '';

const stepsOf = (job) => job.split(/\n {6}- /).slice(1).map((s) => `- ${s}`);
const stepWith = (job, needle) => stepsOf(job).find((s) => s.includes(needle)) ?? '';
const ifOf = (text) => (text.match(/^\s*(?:- )?if:\s*(.+)$/m) ?? [, ''])[1];
const jobIf = (job) => (job.match(/^ {4}if:\s*(.+)$/m) ?? [, ''])[1];
// Text of every `run:` value (single line or block scalar), without the `run:` key.
function runBodies(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:- )?run:\s*(.*)$/);
    if (!m) continue;
    if (/^[|>][+-]?$/.test(m[2])) {
      const base = m[1].length;
      const body = [];
      for (let j = i + 1; j < lines.length; j++) {
        const ind = lines[j].match(/^(\s*)/)[1].length;
        if (lines[j].trim() !== '' && ind <= base) break;
        body.push(lines[j]);
      }
      out.push(body.join('\n'));
    } else out.push(m[2]);
  }
  return out;
}

describe('no workflow paths-ignore (AC2)', () => {
  test('ci.yml has no paths-ignore and no paths filter', () => {
    assert.doesNotMatch(ci, /paths-ignore/);
    assert.doesNotMatch(ci, /^\s+paths:/m);
  });
  test('permissions are set at the top (gha.M1)', () => {
    assert.match(ci, /^permissions:\n {2}contents: read\n/m);
  });
});

describe('triggers keep tags, nightly and push to main (AC2, AC7)', () => {
  const on = ci.slice(0, jobsAt < 0 ? ci.length : jobsAt);
  test('pull_request and push to main stay', () => {
    assert.match(on, /^ {2}pull_request:/m);
    assert.match(on, /^ {2}push:/m);
    assert.match(on, /branches: \[main\]/);
  });
  test('a tag trigger exists', () => {
    assert.match(on, /tags:/);
  });
  test('a nightly schedule with a cron exists', () => {
    assert.match(on, /^ {2}schedule:/m);
    assert.match(on, /- cron: ['"]?[0-9*\/, -]+ [0-9*\/, -]+ [0-9*\/, ?-]+ [0-9*\/, A-Za-z-]+ [0-9*\/, A-Za-z-]+['"]?/);
  });
});

describe('facts step reads the diff through env only (AC2, git.M-SEC4 CI reading)', () => {
  const facts = stepWith(ci, 'diff-facts.mjs');
  test('a step runs diff-facts show with --github-output and --base', () => {
    assert.ok(facts, 'no step calls scripts/diff-facts.mjs');
    assert.match(facts, /diff-facts\.mjs show\b/);
    assert.match(facts, /--github-output/);
    assert.match(facts, /--base\b/);
  });
  test('base and head sha come from the pull_request event via env:', () => {
    const env = facts.slice(facts.indexOf('env:'));
    assert.ok(facts.includes('env:'), 'facts step has no env: block');
    assert.match(env, /\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/);
    assert.match(env, /\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/);
  });
  test('the run text has no ${{ expression (gha.M-SEC3)', () => {
    const bodies = runBodies(facts).join('\n');
    assert.ok(bodies.length > 0);
    assert.doesNotMatch(bodies, /\$\{\{/);
  });
  test('the run text names no HEAD, GITHUB_SHA, merge ref or head.ref endpoint', () => {
    const bodies = runBodies(facts).join('\n');
    assert.doesNotMatch(bodies, /(?<![A-Za-z_])HEAD(?![A-Za-z_])/);
    assert.doesNotMatch(bodies, /GITHUB_SHA|GITHUB_REF|github\.sha|refs\/pull|head\.ref|merge_commit_sha/);
    assert.doesNotMatch(facts, /GITHUB_SHA|github\.sha|refs\/pull|head\.ref|merge_commit_sha/);
  });
  test('the checkout feeding the facts step keeps persist-credentials false', () => {
    const co = stepsOf(ci).filter((s) => s.includes('actions/checkout@'));
    assert.ok(co.length > 0);
    for (const s of co) assert.match(s, /persist-credentials: false/);
  });
  test('no run line anywhere uses a ${{ expression (gha.M-SEC3)', () => {
    for (const b of runBodies(ci)) assert.doesNotMatch(b, /\$\{\{/, b);
  });
});

describe('docs-only skip is step level, so required names report success (AC2)', () => {
  test('check, windows-test and windows-check keep their required names', () => {
    assert.match(check, /name: check \(\$\{\{ matrix\.os \}\}\)/);
    assert.match(win, /name: windows-test \(shard \$\{\{ matrix\.shard \}\}\/4\)/);
    assert.match(agg, /name: check \(windows-latest\)/);
  });
  test('no job-level if on check or windows-test mentions docs_only', () => {
    assert.doesNotMatch(jobIf(check), /docs_only/);
    assert.doesNotMatch(jobIf(win), /docs_only/);
    assert.doesNotMatch(jobIf(agg), /docs_only/);
  });
  test('windows-check keeps its job-level if: always()', () => {
    assert.match(jobIf(agg), /\balways\(\)/);
  });
  for (const [label, job] of [['check', check], ['windows-test', win]]) {
    test(`${label}: every npm test and npm run check step is skipped on docs_only`, () => {
      const targets = stepsOf(job).filter((s) => /npm test|npm run check/.test(runBodies(s).join('\n')));
      assert.ok(targets.length > 0, 'no test step found');
      for (const s of targets) assert.match(ifOf(s), /docs_only/, s);
    });
  }
  test('windows-check cover step is skipped on docs_only and still runs after a red shard', () => {
    const cover = stepWith(agg, '--aico-cover');
    assert.ok(cover, 'cover step missing');
    assert.match(ifOf(cover), /docs_only/);
    assert.match(ifOf(cover), /\balways\(\)/);
  });
  test('windows-check Shard result step stays unconditional on the shard result', () => {
    const res = stepWith(agg, 'SHARDS_RESULT');
    assert.match(res, /needs\.windows-test\.result/);
    assert.match(res, /test "\$SHARDS_RESULT" = success/);
  });
});

describe('a docs_only skip never applies to tag, schedule or push events (AC2, AC7)', () => {
  const gated = stepsOf(ci).filter((s) => /docs_only/.test(ifOf(s)));
  test('there are gated steps', () => {
    assert.ok(gated.length >= 3, `found ${gated.length}`);
  });
  test('every docs_only condition also requires a pull_request event', () => {
    for (const s of gated) assert.match(ifOf(s), /github\.event_name\s*==\s*'pull_request'/, ifOf(s));
  });
  test('no docs_only condition is negated into an event skip', () => {
    for (const s of gated) assert.doesNotMatch(ifOf(s), /event_name\s*!=\s*'(push|schedule)'/, ifOf(s));
  });
});

describe('a11y job is gated on ui_changed except tag, nightly and cold (AC5, AC7)', () => {
  const gate = `${jobIf(a11y)}\n${stepsOf(a11y).map(ifOf).join('\n')}`;
  test('a job whose key names a11y exists', () => {
    assert.ok(a11yKey, 'no a11y job');
  });
  test('it runs scripts/a11y-smoke.mjs', () => {
    assert.match(runBodies(a11y).join('\n'), /node scripts\/a11y-smoke\.mjs/);
  });
  test('its condition names ui_changed, tags, schedule and cold', () => {
    assert.match(gate, /ui_changed/);
    assert.match(gate, /refs\/tags\//);
    assert.match(gate, /schedule/);
    assert.match(gate, /cold/i);
  });
  test('ui_changed is read as the string true, never negated into a skip on a missing value', () => {
    assert.match(gate, /ui_changed\s*==\s*'true'/);
    assert.doesNotMatch(gate, /ui_changed\s*!=\s*'false'/);
  });
  test('it has read-only permissions of its own (gha.M-SEC2)', () => {
    assert.match(a11y, /^ {4}permissions:\n {6}contents: read\n/m);
    assert.doesNotMatch(a11y, /: write/);
  });
  test('every action is pinned to a full commit with a version comment (gha.M-SEC1)', () => {
    const uses = a11y.split('\n').filter((l) => /^\s*(- )?uses:/.test(l));
    assert.ok(uses.length > 0);
    for (const l of uses) assert.match(l, /@[0-9a-f]{40} # v\d+\.\d+\.\d+/, l);
  });
  test('checkout does not persist credentials', () => {
    const co = stepWith(a11y, 'actions/checkout@');
    assert.ok(co, 'a11y job has no checkout');
    assert.match(co, /persist-credentials: false/);
  });
  test('it has a timeout and no secrets or continue-on-error', () => {
    assert.match(a11y, /timeout-minutes: \d+/);
    assert.doesNotMatch(a11y, /secrets\./);
    assert.doesNotMatch(a11y, /continue-on-error/);
  });
});

describe('red results are never hidden (AC18)', () => {
  test('no continue-on-error on a test or check step', () => {
    for (const job of [check, win, agg]) {
      for (const s of stepsOf(job)) {
        if (/npm test|npm run check/.test(runBodies(s).join('\n'))) assert.doesNotMatch(s, /continue-on-error/, s);
      }
      assert.doesNotMatch(job.split('\n    steps:')[0], /continue-on-error/);
    }
  });
});
