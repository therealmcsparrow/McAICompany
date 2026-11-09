// Tests for tier-sets v1.8, review-loop v1.3, rule-check v1.6 and review-depth v1.4 on a v3 slug.
// A v3 run slug `<ID>/<NN>-<pb>` is accepted by tier-set, review-loop, rule-check and review-depth. The run ref is
// `refs/heads/aico/<ID>` (no run part). Each scenario runs once on a v3 slug and once on a v2 slug of the same project
// and the two outputs must match once the slug text is swapped (v2 stays byte-identical).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { main as tierMain, readTierPath } from './tier-set.mjs';
import { main as loopMain, readReviewLoop, bothReviewersRan } from './review-loop.mjs';
import { main as ruleMain, runRef as ruleRunRef } from './rule-check.mjs';

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const REPO = path.resolve(import.meta.dirname, '..');
const ID = 'P20261109.000009';
const V3 = `${ID}/01-feature`;
const V2 = `${ID}-10.00.00`;
const BAD = [`${ID}/../x`, `${ID}\\01-feature`, `${ID}/01-feature/`, `${ID}/01-feature/extra`, `${ID}/1-feature`];

const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

const GIT_ENV = () => {
  const e = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(os.tmpdir(), 'review-v3-none'), GIT_TERMINAL_PROMPT: '0' };
  delete e.NODE_TEST_CONTEXT;
  return e;
};
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, env: GIT_ENV(), encoding: 'utf8' }).trim();

// A product repo: the base commit holds project.md (Core) and .gitignore; branch aico/<ID> holds one more commit and is checked out.
// `slugs` are run folders made under .company/work (a v3 slug makes `<ID>/` with 00-project.md and the run folder).
function fixture(slugs, { change = 'src/a.mjs' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-v3-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, '.company'), { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'project.md'), '## Core\n- skills/pipeline: run setup\n- scripts/check.mjs: gate\n\n## Modules\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.company/work/\n');
  fs.writeFileSync(path.join(root, 'src', 'keep.mjs'), 'export {};\n');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A', '-f');
  git(root, 'commit', '-q', '-m', 'base');
  const base = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', '-q', '-b', `aico/${ID}`);
  fs.writeFileSync(path.join(root, change), 'export const x = 1;\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'work');
  for (const s of slugs) {
    fs.mkdirSync(path.join(root, '.company', 'work', ...s.split('/')), { recursive: true });
    if (s.includes('/')) fs.writeFileSync(path.join(root, '.company', 'work', s.split('/')[0], '00-project.md'), 'demo project\n');
  }
  return { root, base };
}
const swap = (text, from, to) => String(text).split(from).join(to);
const folder = (root, slug) => path.join(root, '.company', 'work', ...slug.split('/'));
// Run one scenario on both slugs (two repos); the v3 result must equal the v2 result with the slug text swapped.
function same(scenario) {
  const a = fixture([V3]);
  const b = fixture([V2]);
  const r3 = scenario(a, V3);
  const r2 = scenario(b, V2);
  return { r3, r2 };
}
const BEGIN = ['--playbook', 'feature', '--triage', 'low', '--short', 'off'];
const tier = (ctx, ...args) => tierMain(args, { root: ctx.root, now: NOW, pluginRoot: REPO });
// review-depth reads its repo and profile from the working directory, so it runs as a child process there.
const DEPTH = path.join(import.meta.dirname, 'review-depth.mjs');
const depth = (ctx, ...args) => {
  const r = spawnSync(process.execPath, [DEPTH, ...args], { cwd: ctx.root, env: GIT_ENV(), encoding: 'utf8' });
  return { code: r.status, out: r.stdout };
};
const loop = (ctx, ...args) => loopMain(args, { root: ctx.root, now: NOW });

describe('tier-sets v1.8: tier-set on a v3 slug', () => {
  test('begin then read keep the record in the v3 run folder', () => {
    const ctx = fixture([V3]);
    const r = tier(ctx, 'begin', V3, ...BEGIN, '--base', ctx.base);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.ok(fs.existsSync(path.join(folder(ctx.root, V3), 'tier-path.jsonl')), 'record is in <ID>/<NN>-<pb>/');
    assert.ok(!fs.existsSync(path.join(ctx.root, '.company', 'work', 'tier-path.jsonl')));
    const read = tier(ctx, 'read', V3);
    assert.equal(read.code, 0);
    const view = JSON.parse(read.lines[0]);
    assert.equal(view.slug, V3);
    assert.equal(view.state, 'on');
    assert.equal(readTierPath(ctx.root, V3).slug, V3);
  });

  test('preview, begin, raise and read give the v2 output with the slug swapped', () => {
    const { r3, r2 } = same((ctx, slug) => [
      tier(ctx, 'preview', slug, ...BEGIN),
      tier(ctx, 'begin', slug, ...BEGIN, '--base', ctx.base),
      tier(ctx, 'raise', slug, 'high'),
      tier(ctx, 'read', slug)
    ]);
    assert.equal(r3[0].code, 0, r3[0].lines.join('\n'));
    assert.deepEqual(r3.map((x) => x.code), r2.map((x) => x.code));
    const blank = (x, s) => swap(JSON.stringify(x), s, 'SLUG').replace(/[0-9a-f]{40}/g, 'SHA');
    assert.equal(blank(r3, V3), blank(r2, V2));
  });

  test('sync --diff reads the diff of refs/heads/aico/<ID>', () => {
    const { r3, r2 } = same((ctx, slug) => {
      tier(ctx, 'begin', slug, ...BEGIN, '--base', ctx.base);
      return tier(ctx, 'sync', slug, '--diff', '--base', ctx.base);
    });
    assert.equal(r3.code, r2.code);
    assert.ok(!r3.lines.some((l) => /diff unknown/.test(l)), r3.lines.join('\n'));
    assert.equal(swap(JSON.stringify(r3), V3, V2), JSON.stringify(r2));
  });

  test('a malformed v3 slug is refused (code 3), a good one is not', () => {
    const ctx = fixture([V3]);
    assert.equal(tier(ctx, 'read', V3).code, 0);
    for (const bad of BAD) {
      const r = tier(ctx, 'read', bad);
      assert.equal(r.code, 3, `${bad}: ${r.lines.join('\n')}`);
      assert.match(r.lines[0], /^refused: /);
    }
  });

  test('begin on a v3 slug with no run folder writes nothing', () => {
    const ctx = fixture([V3]);
    const missing = `${ID}/02-fix`;
    const r = tier(ctx, 'begin', missing, ...BEGIN, '--base', ctx.base);
    assert.notEqual(r.code, 0);
    assert.ok(!fs.existsSync(folder(ctx.root, missing)));
    // the same call on the existing run folder works, so the refusal above was about the folder
    assert.equal(tier(ctx, 'begin', V3, ...BEGIN, '--base', ctx.base).code, 0);
  });
});

describe('review-loop v1.3 on a v3 slug', () => {
  test('attempt twice writes review-loop.jsonl in the v3 run folder', () => {
    const ctx = fixture([V3]);
    const a = loop(ctx, 'attempt', V3, '03', 'code-reviewer', '0', 'crash');
    assert.equal(a.code, 0, a.lines.join('\n'));
    assert.deepEqual(a.lines, ['retry code-reviewer']);
    const b = loop(ctx, 'attempt', V3, '03', 'code-reviewer', '0', 'crash');
    assert.deepEqual(b.lines, ['not run code-reviewer round 0']);
    assert.ok(fs.existsSync(path.join(folder(ctx.root, V3), 'review-loop.jsonl')));
    assert.deepEqual(readReviewLoop(ctx.root, V3).map((e) => e.ev), ['attempt', 'notrun']);
  });

  test('mark checks HEAD against refs/heads/aico/<ID>, then churn and gate answer like v2', () => {
    const { r3, r2 } = same((ctx, slug) => [
      loop(ctx, 'mark', slug, '0', '--base', ctx.base),
      loop(ctx, 'churn', slug, '0', '--base', ctx.base),
      loop(ctx, 'attempt', slug, '03', 'security-reviewer', '0', 'crash'),
      loop(ctx, 'attempt', slug, '03', 'security-reviewer', '0', 'crash'),
      loop(ctx, 'gate', slug, '--base', ctx.base)
    ]);
    assert.equal(r3[0].code, 0, r3[0].lines.join('\n'));
    assert.match(r3[0].lines[0], /^marked round 0 [0-9a-f]{40}$/);
    assert.deepEqual(r3.map((x) => x.code), r2.map((x) => x.code));
    // the two repos have different commit ids: blank them
    const blank = (x, s) => swap(JSON.stringify(x), s, 'SLUG').replace(/[0-9a-f]{40}/g, 'SHA');
    assert.equal(blank(r3, V3), blank(r2, V2));
  });

  test('mark refuses when HEAD is on another branch', () => {
    const ctx = fixture([V3]);
    git(ctx.root, 'checkout', '-q', '-b', 'aico/other');
    const r = loop(ctx, 'mark', V3, '0', '--base', ctx.base);
    assert.equal(r.code, 3);
    assert.equal(r.lines[0], `refused: HEAD is not refs/heads/aico/${ID}`);
  });

  test('bothReviewersRan and gate read the reviewer Handoffs of the v3 run folder', () => {
    const ctx = fixture([V3]);
    const dir = folder(ctx.root, V3);
    fs.writeFileSync(path.join(dir, '05-code-reviewer.md'), '---\nstep: 05\nrole: code-reviewer\n---\nBy: code-reviewer\n');
    fs.writeFileSync(path.join(dir, '06-fresh-reviewer.md'), '---\nstep: 06\nrole: fresh-reviewer\nreview-mode: code\n---\nBy: fresh-reviewer\n');
    assert.equal(bothReviewersRan(ctx.root, V3, dir), true);
    const g = loop(ctx, 'gate', V3);
    assert.equal(g.code, 0, g.lines.join('\n'));
  });

  test('a malformed v3 slug is refused (code 3), a good one is not', () => {
    const ctx = fixture([V3]);
    assert.equal(loop(ctx, 'gate', V3).code, 0);
    for (const bad of BAD) {
      const r = loop(ctx, 'gate', bad);
      assert.equal(r.code, 3, `${bad}: ${r.lines.join('\n')}`);
      assert.match(r.lines[0], /^refused: /);
    }
  });
});

describe('rule-check v1.6 on a v3 slug', () => {
  test('runRef maps a v3 slug to the project run ref', () => {
    assert.equal(ruleRunRef(V3), `refs/heads/aico/${ID}`);
    assert.equal(ruleRunRef(V2), `refs/heads/aico/${ID}`);
    for (const bad of BAD) assert.equal(ruleRunRef(bad), null, bad);
  });

  test('run judges the v3 run like the v2 run', () => {
    const { r3, r2 } = same((ctx, slug) => ['run'].map((cmd) => ruleMain([cmd, '--base', ctx.base, '--run', slug, '--root', ctx.root])));
    assert.ok(!r3.some((x) => x.lines.some((l) => /refused: bad run/.test(l))), JSON.stringify(r3));
    assert.deepEqual(r3.map((x) => x.code), r2.map((x) => x.code));
    assert.equal(swap(JSON.stringify(r3), V3, V2), JSON.stringify(r2));
  });

  test('a malformed v3 slug is refused as bad run, a good one is not', () => {
    const ctx = fixture([V3]);
    assert.ok(!/bad run/.test(ruleMain(['run', '--base', ctx.base, '--run', V3, '--root', ctx.root]).lines.join('\n')));
    for (const bad of BAD) {
      const r = ruleMain(['run', '--base', ctx.base, '--run', bad, '--root', ctx.root]);
      assert.equal(r.code, 3, `${bad}: ${r.lines.join('\n')}`);
      assert.equal(r.lines[0], 'refused: bad run', bad);
    }
  });
});

describe('review-depth v1.4 on a v3 slug', () => {
  test('--run <v3 slug> reads the diff of refs/heads/aico/<ID>', () => {
    const ctx = fixture([V3], { change: 'src/auth.mjs' });
    const r = depth(ctx, ctx.base, '--run', V3, '--json');
    assert.equal(r.code, 0, r.out);
    const v = JSON.parse(r.out);
    assert.equal(v.source, 'base');
    assert.equal(v.depth, 'full');
    assert.deepEqual(v.paths.map((p) => p.path ?? p), ['src/auth.mjs']);
    assert.ok(!/no run ref|head not on run branch/.test(JSON.stringify(v.reasons)), r.out);
  });

  test('v3 and v2 slugs of one project give the same answer', () => {
    const a = fixture([V3]);
    const b = fixture([V2]);
    const r3 = depth(a, a.base, '--run', V3);
    const r2 = depth(b, b.base, '--run', V2);
    assert.equal(r3.code, 0, r3.out);
    assert.equal(r3.out, r2.out);
    assert.equal(r3.out, 'standard\n');
  });

  test('a malformed v3 slug is refused (code 2), a good one is not', () => {
    const ctx = fixture([V3]);
    assert.equal(depth(ctx, ctx.base, '--run', V3).code, 0);
    for (const bad of BAD) {
      const r = depth(ctx, ctx.base, '--run', bad);
      assert.equal(r.code, 2, `${bad}: ${r.out}`);
      assert.match(r.out, /^refused: /);
    }
  });
});
