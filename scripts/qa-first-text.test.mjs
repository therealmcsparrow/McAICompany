import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
const has = (rel, phrase) => read(rel).toLowerCase().includes(phrase.toLowerCase());

const PARALLEL = 'skills/pipeline/references/parallel.md';
const FEATURE = 'skills/feature/SKILL.md';
const TDD = 'skills/tdd/SKILL.md';
const PLANNING = 'skills/planning/SKILL.md';
const QA = 'agents/qa.md';
const CHANGELOG = 'CHANGELOG.md';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

// Pinned release: the entry sits in [Unreleased] until 0.30.0 ships, then in the 0.30.0 section for good.
function section(text, heading) {
  const start = text.indexOf(heading);
  if (start === -1) return '';
  const next = text.indexOf('\n## [', start + 5);
  return text.slice(start, next === -1 ? undefined : next);
}
function unreleased() {
  const text = read(CHANGELOG);
  const u = section(text, '## [Unreleased]');
  const r = section(text, '## [0.30.0]');
  assert.ok(u || r, 'CHANGELOG has an Unreleased or 0.30.0 section');
  return `${u}\n${r}`;
}

describe('Lead text in parallel.md', () => {
  it('names --qa-first for feature runs', () => {
    const t = read(PARALLEL);
    assert.match(t, /--qa-first/);
    assert.match(t, /feature/i);
  });
  it('says fix runs never pass the flag', () => {
    assert.match(read(PARALLEL), /fix[^.\n]*never[^.\n]*--qa-first|never[^.\n]*--qa-first[^.\n]*fix/i);
  });
  it('cites plan-tasks v1.7', () => {
    assert.ok(has(PARALLEL, 'plan-tasks v1.7'));
  });
  it('covers a qa-owned path that is never committed', () => {
    assert.ok(has(PARALLEL, 'qa-owned'));
  });
  it('covers the red command for waves mode', () => {
    assert.match(read(PARALLEL), /plan-tasks[^\n]*\bred\b|`red`/);
  });
});

describe('feature Playbook text', () => {
  it('mentions QA-first and cites plan-tasks v1.7', () => {
    assert.ok(has(FEATURE, 'qa-first'));
    assert.ok(has(FEATURE, 'plan-tasks v1.7'));
  });
});

describe('aico:tdd text', () => {
  it('cites plan-tasks v1.7 and the QA-owned test rule', () => {
    assert.ok(has(TDD, 'plan-tasks v1.7'));
    assert.ok(has(TDD, 'qa-owned'));
  });
  it('allows builder unit tests that are not verification', () => {
    assert.match(read(TDD), /not (counted as )?verification/i);
  });
});

describe('aico:planning text', () => {
  it('cites plan-tasks v1.7 and the QA task shape', () => {
    assert.ok(has(PLANNING, 'plan-tasks v1.7'));
    assert.match(read(PLANNING), /role: qa/);
    assert.match(read(PLANNING), /depends-on/);
  });
});

describe('qa agent text', () => {
  it('cites plan-tasks v1.7 and the red-first duty', () => {
    assert.ok(has(QA, 'plan-tasks v1.7'));
    assert.match(read(QA), /\bred\b/i);
    assert.ok(has(QA, 'qa-owned'));
  });
  it('lists the files it owns in its Handoff', () => {
    assert.match(read(QA), /own(s|ed)?\b[^\n]*(test )?files|files[^\n]*\bown/i);
  });
});

describe('CHANGELOG Unreleased or 0.30.0', () => {
  it('describes QA-first with both Contract bumps', () => {
    const u = unreleased();
    assert.match(u, /QA-first|QA writes/i);
    assert.match(u, /plan-tasks[` ]*v1\.7/);
    assert.match(u, /token-ledger[` ]*v1\.10/);
  });
});

describe('repo-wide pin search', () => {
  it('has ADR 0064', () => {
    assert.ok(fs.existsSync(path.join(root, 'docs', 'adr', '0064-qa-writes-tests-first.md')));
  });
  it('no QA-first line in the changed files cites plan-tasks v1.6', () => {
    for (const rel of [PARALLEL, FEATURE, TDD, PLANNING, QA]) {
      for (const line of read(rel).split('\n')) {
        if (/qa-first|qa-owned/i.test(line)) {
          assert.doesNotMatch(line, /plan-tasks v1\.6/, `${rel}: ${line.slice(0, 60)}`);
        }
      }
    }
  });
  it('no skill or agent file offers --qa-first as a CEO flag', () => {
    const files = [...walk('skills'), ...walk('agents')];
    for (const rel of files) {
      const text = read(rel);
      const hint = /^argument-hint:.*$/m.exec(text);
      if (hint) assert.doesNotMatch(hint[0], /--qa-first/, rel);
      for (const line of text.split('\n')) {
        if (/--qa-first/.test(line) && /\bCEO\b/.test(line)) {
          assert.match(line, /\b(never|no|not)\b/i, `${rel}: ${line.slice(0, 60)}`);
        }
      }
    }
  });
  it('keeps size limits and LF endings', () => {
    assert.ok(read(QA).split('\n').length <= 51);
    for (const rel of [FEATURE, TDD, PLANNING]) assert.ok(read(rel).split('\n').length <= 126, rel);
    for (const rel of [PARALLEL, FEATURE, TDD, PLANNING, QA, CHANGELOG]) {
      assert.ok(!read(rel).includes('\r'), rel);
    }
  });
});

describe('builder Never line (AC8)', () => {
  const BUILDERS = ['backend', 'frontend', 'desktop', 'game', 'ai-data'].map((n) => `agents/${n}-engineer.md`);
  it('every builder forbids editing a QA-owned test file and cites plan-tasks v1.7', () => {
    for (const rel of BUILDERS) {
      const line = read(rel).split('\n').find((l) => /^\*\*Never:\*\*/.test(l) && /qa-owned/i.test(l));
      assert.ok(line, `${rel}: Never line with qa-owned`);
      assert.match(line, /edit a QA-owned test file/i, rel);
      assert.match(line, /plan-tasks v1\.7/, rel);
      assert.match(line, /QA-first run/i, rel);
    }
  });
});

describe('review skill [test] rule (AC3)', () => {
  it('makes a builder edit to a QA-owned file Blocking [test], citing plan-tasks v1.7', () => {
    const line = read('skills/review/SKILL.md').split('\n').find((l) => /qa-owned/i.test(l));
    assert.ok(line, 'review has a QA-owned line');
    assert.match(line, /plan-tasks v1\.7/);
    assert.match(line, /builder edit to a QA-owned file/i);
    assert.match(line, /proven only by builder tests/i);
    assert.match(line, /## Blocking` `\[test\]`/);
  });
});

describe('qa-first-report lines (AC7)', () => {
  for (const rel of ['skills/feedback/SKILL.md', 'skills/feature/references/intake-and-ship.md']) {
    it(`${rel} runs ledger qa-first-report with no arguments`, () => {
      const line = read(rel).split('\n').find((l) => /ledger qa-first-report/.test(l));
      assert.ok(line, `${rel}: qa-first-report line`);
      assert.match(line, /ledger qa-first-report`/);
    });
  }
  it('feedback puts the three lines under ## QA first, unchanged', () => {
    const line = read('skills/feedback/SKILL.md').split('\n').find((l) => /ledger qa-first-report/.test(l));
    assert.ok(line, 'feedback qa-first-report line');
    assert.match(line, /## QA first/);
    assert.match(line, /unchanged/);
  });
  it('intake-and-ship names before, after, excluded', () => {
    const line = read('skills/feature/references/intake-and-ship.md').split('\n').find((l) => /qa-first-report/.test(l));
    for (const w of ['before', 'after', 'excluded']) assert.match(line, new RegExp(`\`${w}\``));
    assert.match(line, /token-ledger`? v1\.10/);
  });
});

describe('worktrees.md plan-tasks red (T10)', () => {
  it('runs plan-tasks red before the full suite and cites plan-tasks v1.7', () => {
    const line = read('skills/pipeline/references/worktrees.md').split('\n').find((l) => /plan-tasks red/.test(l));
    assert.ok(line, 'worktrees has a plan-tasks red line');
    assert.match(line, /`?plan-tasks`? v1\.7/);
    assert.match(line, /QA-first/);
    assert.match(line, /expected/);
    assert.ok(line.indexOf('plan-tasks red') < line.indexOf('plan-tasks merged'));
  });
});
