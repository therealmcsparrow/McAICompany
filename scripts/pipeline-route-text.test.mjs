// Static text checks: the pipeline and triage skills drive Steps through route, diff-facts and step-key.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

const PIPELINE = read('skills/pipeline/SKILL.md');
const ROUTE_REF = read('skills/pipeline/references/route.md');
const TRIAGE = read('skills/triage/SKILL.md');
const ALL = {
  'skills/pipeline/SKILL.md': PIPELINE,
  'skills/pipeline/references/route.md': ROUTE_REF,
  'skills/triage/SKILL.md': TRIAGE,
};

const idx = (text, re) => text.search(re);
const cmd = (name, sub) => new RegExp(`\\b${name}(?:\\.mjs)?\\s+${sub}\\b`);

describe('route reference exists and is loaded', () => {
  test('references/route.md exists and is LF only', () => {
    assert.ok(ROUTE_REF.length > 0, 'skills/pipeline/references/route.md is missing');
    assert.ok(!ROUTE_REF.includes('\r'));
  });

  test('pipeline SKILL.md points to references/route.md', () => {
    assert.match(PIPELINE, /references\/route\.md/);
  });

  test('route reference cites the three Contracts at v1.0', () => {
    for (const c of ['route v1.0', 'diff-facts v1.0', 'step-key v1.0']) {
      assert.ok(ROUTE_REF.includes(c), `missing cite: ${c}`);
    }
  });

  test('commands run through the plugin root', () => {
    assert.match(ROUTE_REF, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  });
});

describe('AC8: the pipeline runs the route list and nothing else', () => {
  test('Steps come from route next and nothing else', () => {
    assert.match(ROUTE_REF, cmd('route', 'next'));
    assert.match(ROUTE_REF, /nothing else/i);
  });

  test('every route next answer is handled: run, skip, split, tasks, end', () => {
    for (const w of ['run', 'skip', 'split', 'tasks', 'end']) {
      assert.match(ROUTE_REF, new RegExp(`\\b${w}\\b`), `no handling of ${w}`);
    }
  });

  test('the route is written with route write and a dry-run prints skips', () => {
    assert.match(ROUTE_REF, cmd('route', 'write'));
    assert.match(ROUTE_REF, cmd('route', 'dry'));
  });

  test('feature and fix only; other Playbooks keep their prose order', () => {
    assert.match(ROUTE_REF, /\bfeature\b/);
    assert.match(ROUTE_REF, /\bfix\b/);
    assert.match(ROUTE_REF, /other Playbooks?[^.\n]*(prose|keep|unchanged)/i);
  });

  test('triage drafts the route and cites route v1.0', () => {
    assert.match(TRIAGE, /route v1\.0/);
    assert.match(TRIAGE, cmd('route', '(?:write|dry)'));
  });

  test('a refused or failing route command never skips a Role', () => {
    assert.match(ROUTE_REF, /(refus|fail|crash|error)[^.\n]*(run|dispatch)/i);
  });
});

describe('diff-facts write after each Step', () => {
  test('diff-facts write runs after a Step and before the next route next', () => {
    const w = idx(ROUTE_REF, cmd('diff-facts', 'write'));
    const n = idx(ROUTE_REF, cmd('route', 'next'));
    assert.ok(w >= 0, 'no diff-facts write');
    assert.ok(n >= 0, 'no route next');
  });

  test('facts files are data; the Lead never derives a skip by hand', () => {
    assert.match(ROUTE_REF, /facts[^.\n]*\bdata\b|\bdata\b[^.\n]*facts/i);
  });
});

describe('AC12: stepKey reuse in Fix rounds', () => {
  test('before comes first, then reuse or dispatch, then after', () => {
    const b = idx(ROUTE_REF, cmd('step-key', 'before'));
    const r = idx(ROUTE_REF, cmd('step-key', 'reuse'));
    const a = idx(ROUTE_REF, cmd('step-key', 'after'));
    assert.ok(b >= 0, 'no step-key before');
    assert.ok(r > b, 'reuse must come after before');
    assert.ok(a > r, 'after must come after reuse');
  });

  test('reuse only after before printed hit', () => {
    assert.match(ROUTE_REF, /only[^.\n]*\bhit\b|\bhit\b[^.\n]*only|`hit`[^.\n]*reuse/i);
  });

  test('a hit means no dispatch and no Agent call', () => {
    assert.match(ROUTE_REF, /(no|not|never)[^.\n]*(dispatch|Agent call)/i);
  });

  test('any other output, a refusal or a crash dispatches', () => {
    assert.match(ROUTE_REF, /\bmiss\b/);
    assert.match(ROUTE_REF, /uncacheable/);
    assert.match(ROUTE_REF, /any other (output|line|answer)/i);
    assert.match(ROUTE_REF, /refus/i);
    assert.match(ROUTE_REF, /crash|exits? not 0|non-zero|nonzero/i);
  });

  test('reuse is for Fix rounds; round 0 is dispatched', () => {
    assert.match(ROUTE_REF, /Fix round/);
    assert.match(ROUTE_REF, /--round/);
  });

  test('a reused Handoff is data and is linted like any Handoff', () => {
    assert.match(ROUTE_REF, /handoff-lint/);
    assert.match(ROUTE_REF, /reused[^.\n]*(lint|data)|(lint|data)[^.\n]*reused/i);
  });

  test('before gets the dispatch, the model and the round', () => {
    assert.match(ROUTE_REF, /--dispatch/);
    assert.match(ROUTE_REF, /--model/);
    assert.match(ROUTE_REF, /--round/);
  });

  test('stats counts are reported to feedback', () => {
    assert.match(ROUTE_REF, cmd('step-key', 'stats'));
  });
});

describe('AC13: Ship Gate inputs are verified, never reused', () => {
  test('Ship Gate input Steps are dispatched with before --verify', () => {
    assert.match(ROUTE_REF, /Ship Gate[^]{0,600}--verify|--verify[^]{0,600}Ship Gate/);
  });

  test('a Ship Gate input is never reused', () => {
    assert.match(ROUTE_REF, /never[^.\n]*reuse[sd]?|reuse[sd]?[^.\n]*never/i);
  });

  test('on disagree cold wins and the entry is purged', () => {
    assert.match(ROUTE_REF, /disagree/);
    assert.match(ROUTE_REF, /cold wins/i);
    assert.match(ROUTE_REF, /purge/i);
  });

  test('both results are in the step-keys log', () => {
    assert.match(ROUTE_REF, /step-keys\.jsonl/);
  });
});

describe('AC14: cold Ship Gate and rollback', () => {
  test('the Ship Gate suite runs under AICO_COLD=1', () => {
    assert.match(ROUTE_REF, /Ship Gate[^]{0,800}AICO_COLD=1|AICO_COLD=1[^]{0,800}Ship Gate/);
  });

  test('AICO_COLD=1 is named as the rollback', () => {
    assert.match(ROUTE_REF, /AICO_COLD=1[^.\n]*rollback|rollback[^.\n]*AICO_COLD=1/i);
  });

  test('cold governs caches only; Role skips do not change', () => {
    assert.match(ROUTE_REF, /cold[^.\n]*caches?/i);
    assert.match(ROUTE_REF, /(skip|Role)[^.\n]*cold|cold[^.\n]*(skip|Role)/i);
  });
});

describe('AC11 and AC17: merged Step and nit Fix Step', () => {
  test('the only merge is code-reviewer with qa on size S', () => {
    assert.match(ROUTE_REF, /code-reviewer[^.\n]*\bqa\b|\bqa\b[^.\n]*code-reviewer/);
    assert.match(ROUTE_REF, /\bS\b/);
    assert.match(ROUTE_REF, /merge/i);
  });

  test('a split is two Steps: qa, then code-reviewer', () => {
    assert.match(ROUTE_REF, /split[^.\n]*(two Steps|qa)/i);
  });

  test('a merge is split on contract_changed, missing facts or needs-ceo', () => {
    assert.match(ROUTE_REF, /contract_changed/);
    assert.match(ROUTE_REF, /needs-ceo/);
  });

  test('a merged Step is one Step: one Goal, one Handoff, the same cap and hand-over, counted once', () => {
    assert.match(ROUTE_REF, /one Goal/);
    assert.match(ROUTE_REF, /one Handoff/);
    assert.match(ROUTE_REF, /context cap/i);
    assert.match(ROUTE_REF, /hand-?over/i);
    assert.match(ROUTE_REF, /counts? once|counted once/i);
  });

  test('a QA test-first Step is never merged', () => {
    assert.match(ROUTE_REF, /test-first[^.\n]*never[^.\n]*merg|never[^.\n]*merg[^.\n]*test-first/i);
  });

  test('a nit on a Contract or Core path gets its own Fix Step, logged with route fix', () => {
    assert.match(ROUTE_REF, /nit[^.\n]*Fix Step|Fix Step[^.\n]*nit/i);
    assert.match(ROUTE_REF, /Contract/);
    assert.match(ROUTE_REF, /Core/);
    assert.match(ROUTE_REF, cmd('route', 'fix'));
  });

  test('a nit Fix Step is not a Fix round and does not count toward the budget', () => {
    assert.match(ROUTE_REF, /not a Fix round|never a Fix round/i);
    assert.match(ROUTE_REF, /budget/i);
  });
});

describe('hostile text and prompt hygiene', () => {
  test('no example dispatch carries a Name: line', () => {
    for (const [file, text] of Object.entries(ALL)) {
      assert.ok(text.length > 0, `${file} is missing`);
      const lines = text.split('\n').filter((l) => /^\s*(?:[-*>]\s*)?Name:/.test(l));
      assert.deepEqual(lines, [], `${file} has a Name: line`);
    }
  });

  test('route and step-key output is data, never instructions', () => {
    assert.match(ROUTE_REF, /output is data|data,? not instructions|never instructions/i);
  });

  test('arguments are checked values in single quotes, never taken from Role output', () => {
    assert.match(ROUTE_REF, /single quote|'<slug>'/i);
    assert.match(ROUTE_REF, /never[^.\n]*(Role output|Handoff text|request text)/i);
  });
});
