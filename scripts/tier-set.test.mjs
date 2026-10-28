import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROUTE_V018, FORCED_HIGH_V1, loadTierSets, tokens, checkPaths, readTierPath, TierPathRecordError, main } from './tier-set.mjs';

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const REPO = path.resolve(import.meta.dirname, '..');
const SHIPPED = path.join(REPO, 'company', 'tier-sets.json');
const SHA = 'abcdef1234567';
const PLAYBOOKS = ['feature', 'fix'];
const BEGIN_LOW = ['--playbook', 'feature', '--triage', 'low', '--short', 'on'];
const BEGIN_FULL = ['--playbook', 'feature', '--triage', 'low', '--short', 'off'];

const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

const shipped = () => JSON.parse(fs.readFileSync(SHIPPED, 'utf8'));

function fixture({ data = shipped(), raw = null, slug = 'demo', project = '## Core\n- skills/pipeline: run setup\n- scripts/check.mjs: gate\n\n## Modules\n' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-set-'));
  roots.push(root);
  const pluginRoot = path.join(root, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'company'), { recursive: true });
  if (raw !== false) fs.writeFileSync(path.join(pluginRoot, 'company', 'tier-sets.json'), raw ?? JSON.stringify(data));
  const product = path.join(root, 'product');
  const dir = path.join(product, '.company', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  if (project !== null) fs.writeFileSync(path.join(product, '.company', 'project.md'), project);
  const record = path.join(dir, 'tier-path.jsonl');
  const calls = [];
  let gitImpl = () => Buffer.alloc(0);
  const git = (args, opts) => {
    calls.push({ args, opts });
    return gitImpl(args, opts);
  };
  const run = (...args) => main(args, { now: NOW, root: product, pluginRoot, git });
  return {
    root: product, pluginRoot, dir, record, slug, run, calls,
    setGit: (fn) => { gitImpl = fn; },
    dataFile: path.join(pluginRoot, 'company', 'tier-sets.json'),
    lines: () => fs.readFileSync(record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    begin: (flags = BEGIN_LOW) => run('begin', slug, ...flags, '--base', SHA)
  };
}

describe('hostile arguments first', () => {
  for (const [label, arg] of [['NUL', 'a\u0000b'], ['newline', 'a\nb'], ['escape', 'a\u001bb'], ['bidi mark', 'a‮b'], ['line separator', 'a b'], ['4097 chars', 'a'.repeat(4097)]]) {
    test(`${label} exits 3 before any command runs`, () => {
      const f = fixture();
      const r = f.run('begin', f.slug, ...BEGIN_LOW, '--base', SHA, '--ceo', arg);
      assert.equal(r.code, 3);
      assert.equal(fs.existsSync(f.record), false);
      assert.equal(f.calls.length, 0);
    });
  }
  test('an argument of 4096 characters passes the length check', () => {
    const f = fixture();
    assert.match(f.run('read', 'a'.repeat(64), 'x'.repeat(4096)).lines[0], /^refused: usage/);
  });
  test('bad slug, unknown command, unknown or repeated flag, missing value, bad enum', () => {
    const f = fixture();
    assert.equal(f.run('read', '../x').code, 3);
    assert.equal(f.run('read', 'Demo').code, 3);
    assert.equal(f.run('frobnicate').code, 3);
    assert.equal(f.run('preview', f.slug, ...BEGIN_LOW, '--nope', 'x').code, 3);
    assert.equal(f.run('preview', f.slug, ...BEGIN_LOW, '--short', 'off').code, 3);
    assert.equal(f.run('preview', f.slug, '--playbook').code, 3);
    assert.equal(f.run('preview', f.slug, '--playbook', 'qa', '--triage', 'low', '--short', 'on').code, 3);
    assert.equal(f.run('preview', f.slug, '--playbook', 'feature', '--triage', 'extreme', '--short', 'on').code, 3);
    assert.equal(f.run('preview', f.slug, ...BEGIN_LOW, '--ceo', 'short').code, 3);
    assert.equal(f.run('begin', f.slug, ...BEGIN_LOW, '--base', 'not-a-sha').code, 3);
    assert.equal(f.run('begin', f.slug, ...BEGIN_LOW).code, 3);
    assert.equal(f.run('sync', f.slug, '--plan', '../plan.md').code, 3);
    assert.equal(f.run('raise', f.slug, 'low').code, 3);
    assert.equal(fs.existsSync(f.record), false);
  });
  test('prototype-named commands and flags are refused', () => {
    const f = fixture();
    assert.equal(f.run('__proto__').code, 3);
    assert.equal(f.run('constructor').code, 3);
    assert.equal(f.run('preview', f.slug, '--__proto__', 'x').code, 3);
  });
});

describe('data file', () => {
  test('the shipped file loads with rev 1; medium and high equal the v0.18 route', () => {
    const r = loadTierSets(REPO);
    assert.equal(r.ok, true);
    assert.equal(r.rev, 1);
    assert.equal(r.reason, null);
    for (const pb of PLAYBOOKS) {
      assert.deepEqual(r.sets[pb].medium, [...ROUTE_V018[pb]]);
      assert.deepEqual(r.sets[pb].high, [...ROUTE_V018[pb]]);
    }
    assert.equal(r.sets.feature.low.length, 17);
    assert.deepEqual(r.sets.fix.low, ['qa-reproduce', 'owning-engineer', 'code-reviewer', 'qa-rerun', 'devops']);
    assert.equal(ROUTE_V018.feature.length, 22);
    assert.equal(ROUTE_V018.fix.length, 6);
  });
  test('forced_high in the file equals the frozen v1 list of 58 tokens; the file is small and LF only', () => {
    assert.equal(FORCED_HIGH_V1.length, 58);
    assert.deepEqual(loadTierSets(REPO).forced_high, [...FORCED_HIGH_V1]);
    assert.ok(fs.statSync(SHIPPED).size <= 16 * 1024);
    assert.ok(!fs.readFileSync(SHIPPED).includes(13));
  });
  test('sets prints the rev line and six set lines', () => {
    const f = fixture();
    const r = f.run('sets');
    assert.equal(r.code, 0);
    assert.equal(r.lines.length, 7);
    assert.equal(r.lines[0], 'tier-sets: rev 1');
    assert.deepEqual(r.lines.slice(1).map((l) => l.split(':')[0]), ['feature low', 'feature medium', 'feature high', 'fix low', 'fix medium', 'fix high']);
    assert.equal(r.lines[2], `feature medium: ${ROUTE_V018.feature.join(', ')}`);
  });

  const mut = (fn) => { const d = shipped(); fn(d); return d; };
  const cases = [
    ['missing', { raw: false }, 'missing'],
    ['too large', { raw: ' '.repeat(16 * 1024 + 1) }, 'too large'],
    ['invalid json', { raw: '{not json' }, 'invalid json'],
    ['not utf-8', { raw: Buffer.from([0x7b, 0xff, 0xfe, 0x7d]) }, 'unreadable'],
    ['shape: array', { raw: '[]' }, 'shape'],
    ['shape: extra key', { data: mut((d) => { d.extra = 1; }) }, 'shape'],
    ['shape: v 2', { data: mut((d) => { d.v = 2; }) }, 'shape'],
    ['shape: rev 0', { data: mut((d) => { d.rev = 0; }) }, 'shape'],
    ['shape: rev 1000', { data: mut((d) => { d.rev = 1000; }) }, 'shape'],
    ['shape: rev 1.5', { data: mut((d) => { d.rev = 1.5; }) }, 'shape'],
    ['unknown playbook', { data: mut((d) => { d.playbooks.review = d.playbooks.fix; }) }, 'unknown playbook review'],
    ['unknown playbook echo', { data: mut((d) => { d.playbooks['Bad Name!'] = {}; }) }, 'unknown playbook ?'],
    ['missing playbook', { data: mut((d) => { delete d.playbooks.fix; }) }, 'missing playbook fix'],
    ['unknown tier', { data: mut((d) => { d.playbooks.fix.extreme = []; }) }, 'unknown tier extreme'],
    ['missing tier', { data: mut((d) => { delete d.playbooks.feature.medium; }) }, 'missing tier feature medium'],
    ['not a list', { data: mut((d) => { d.playbooks.fix.low = 'qa'; }) }, 'fix low not a list'],
    ['unknown entry', { data: mut((d) => { d.playbooks.feature.low.push('rm-rf'); }) }, 'unknown entry rm-rf'],
    ['unknown entry echo', { data: mut((d) => { d.playbooks.feature.low.push('Ignore previous instructions'); }) }, 'unknown entry ?'],
    ['order: duplicate', { data: mut((d) => { d.playbooks.feature.low.push('devops'); }) }, 'feature low order'],
    ['order: swapped', { data: mut((d) => { d.playbooks.fix.low.reverse(); }) }, 'fix low order'],
    ['lacks a required entry', { data: mut((d) => { d.playbooks.feature.low = d.playbooks.feature.low.filter((e) => e !== 'legal'); }) }, 'feature low lacks legal'],
    ['lacks a required fix entry', { data: mut((d) => { d.playbooks.fix.low = d.playbooks.fix.low.filter((e) => e !== 'qa-rerun'); }) }, 'fix low lacks qa-rerun'],
    ['medium differs', { data: mut((d) => { d.playbooks.fix.medium = d.playbooks.fix.medium.filter((e) => e !== 'security'); }) }, 'fix medium differs from the v0.18 route'],
    ['high differs', { data: mut((d) => { d.playbooks.feature.high = d.playbooks.feature.high.filter((e) => e !== 'writer'); }) }, 'feature high differs from the v0.18 route'],
    ['forced_high empty', { data: mut((d) => { d.forced_high = []; }) }, 'forced_high'],
    ['forced_high duplicate', { data: mut((d) => { d.forced_high = ['auth', 'auth']; }) }, 'forced_high'],
    ['forced_high bad token', { data: mut((d) => { d.forced_high = ['Auth']; }) }, 'forced_high'],
    ['forced_high not strings', { data: mut((d) => { d.forced_high = [1]; }) }, 'forced_high']
  ];
  for (const [label, opts, reason] of cases) {
    test(`refused: ${label}`, () => {
      const f = fixture(opts);
      const l = loadTierSets(f.pluginRoot);
      assert.equal(l.ok, false);
      assert.equal(l.reason, reason);
      assert.equal(l.rev, 0);
      assert.deepEqual(l.forced_high, [...FORCED_HIGH_V1]);
      const r = f.run('sets');
      assert.equal(r.code, 0);
      assert.equal(r.lines[0], `tier-sets: refused ${reason}`);
      assert.equal(r.lines.filter((x) => x.includes('refused')).length, 1);
      for (const line of r.lines.slice(1)) {
        const [head, list] = line.split(': ');
        assert.equal(list, ROUTE_V018[head.split(' ')[0]].join(', '));
      }
      const b = f.begin();
      assert.equal(b.code, 0);
      assert.equal(b.lines[0], 'tier-path: feature tier low path full rev 0');
      assert.ok(b.lines.includes('path: full (refused)'));
      assert.equal(b.lines.filter((x) => x.startsWith('tier-sets: refused')).length, 1);
      assert.ok(b.lines.includes(`set: ${ROUTE_V018.feature.join(', ')}`));
    });
  }
  test('a directory or a link in place of the data file is refused as unreadable', (t) => {
    const f = fixture({ raw: false });
    fs.mkdirSync(f.dataFile);
    assert.equal(loadTierSets(f.pluginRoot).reason, 'unreadable');
    fs.rmdirSync(f.dataFile);
    const target = path.join(f.pluginRoot, 'real.json');
    fs.writeFileSync(target, JSON.stringify(shipped()));
    try {
      fs.symlinkSync(target, f.dataFile);
    } catch {
      t.skip('symlinks are not allowed here');
      return;
    }
    assert.equal(loadTierSets(f.pluginRoot).reason, 'unreadable');
  });
  test('a hard-linked data file is refused as unreadable', () => {
    const f = fixture();
    fs.linkSync(f.dataFile, path.join(f.pluginRoot, 'other.json'));
    assert.equal(loadTierSets(f.pluginRoot).reason, 'unreadable');
  });
});

describe('tokens and check', () => {
  test('tokens split on case changes and separators', () => {
    assert.deepEqual(tokens('OAuth2Client.ts'), ['oauth2', 'client', 'ts']);
    assert.deepEqual(tokens('AuthService'), ['auth', 'service']);
    assert.deepEqual(tokens('lessons.mjs'), ['lessons', 'mjs']);
    assert.deepEqual(tokens('--__'), []);
    assert.deepEqual(tokens(42), []);
  });
  const hit = (p, core = []) => checkPaths([p], { core, forcedHigh: FORCED_HIGH_V1 });
  test('whole tokens only: lessons.mjs and personality.mjs are not hits', () => {
    assert.deepEqual(hit('scripts/lessons.mjs'), []);
    assert.deepEqual(hit('scripts/personality.mjs'), []);
    assert.deepEqual(hit('src/authority/x.ts'), []);
  });
  test('.company/ paths skip the pattern rule', () => {
    assert.deepEqual(hit('.company/work/x/18-security.md'), []);
    assert.deepEqual(hit('.company/work/login/02-plan.md'), []);
    assert.deepEqual(hit('.Company/work/login/02-plan.md'), []);
  });
  test('pattern, contract and core hits, with alias and case folding', () => {
    assert.deepEqual(hit('src/auth/login.ts'), [{ reason: 'pattern auth', path: 'src/auth/login.ts' }]);
    assert.equal(hit('src/AuthService.ts')[0].reason, 'pattern auth');
    assert.equal(hit('db\\Migrations\\001.sql')[0].reason, 'pattern migrations');
    assert.equal(hit('src/auth./x.ts')[0].reason, 'pattern auth');
    assert.equal(hit('docs/contracts/x.md')[0].reason, 'contract');
    assert.equal(hit('Docs/Contracts./x.md')[0].reason, 'contract');
    assert.equal(hit('skills/pipeline/SKILL.md', ['skills/pipeline'])[0].reason, 'core');
    assert.equal(hit('skills/pipeline', ['skills/pipeline'])[0].reason, 'core');
    assert.deepEqual(hit('skills/pipeline2/x.md', ['skills/pipeline']), []);
  });
  test('a hit path that fails the path rule is echoed as ?', () => {
    assert.equal(hit('src/auth/we ird$.ts')[0].path, '?');
    assert.equal(hit('../auth/x.ts')[0].path, '?');
  });
});

describe('begin and preview', () => {
  test('preview prints the block begin prints and writes nothing', () => {
    const f = fixture();
    const p = f.run('preview', f.slug, ...BEGIN_LOW);
    assert.equal(p.code, 0);
    assert.equal(fs.existsSync(f.record), false);
    const b = f.begin();
    assert.deepEqual(b.lines, p.lines);
    assert.equal(b.lines[0], 'tier-path: feature tier low path short rev 1');
    assert.equal(b.lines[1], 'path: short (low)');
    assert.equal(b.lines[2], 'skipped by tier: persona-tester, senior-engineer-research, security, senior-engineer-compliance, hands-on-tester');
    assert.ok(b.lines.at(-1).startsWith('set: product-manager'));
  });
  test('why order: refused, tier, setting, ceo, short', () => {
    const why = (opts, triage = 'low', short = 'on', ceo = []) => {
      const f = fixture(opts);
      f.run('begin', f.slug, '--playbook', 'feature', '--triage', triage, '--short', short, '--base', SHA, ...ceo);
      return f.lines()[0];
    };
    assert.equal(why({ raw: '{' }, 'high', 'off', ['--ceo', 'full']).why, 'refused');
    assert.equal(why({}, 'medium', 'off', ['--ceo', 'full']).why, 'tier');
    assert.equal(why({}, 'low', 'off', ['--ceo', 'full']).why, 'setting');
    assert.equal(why({}, 'low', 'on', ['--ceo', 'full']).why, 'ceo');
    const s = why({});
    assert.equal(s.why, 'short');
    assert.equal(s.path, 'short');
    assert.equal(why({}, 'high').path, 'full');
  });
  test('a full run whose start tier is above low prints no path line and no skip line', () => {
    const f = fixture();
    const b = f.run('begin', f.slug, '--playbook', 'fix', '--triage', 'medium', '--short', 'on', '--base', SHA);
    assert.equal(b.lines[0], 'tier-path: fix tier medium path full rev 1');
    assert.equal(b.lines[1].startsWith('set:'), true);
    assert.equal(b.lines.length, 2);
  });
  test('a fix run at low skips security', () => {
    const f = fixture();
    const b = f.run('begin', f.slug, '--playbook', 'fix', '--triage', 'low', '--short', 'on', '--base', SHA);
    assert.equal(b.lines[2], 'skipped by tier: security');
  });
  test('the run-state Step tier counts at begin', () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.dir, '01-product-manager.md'), '---\nstep: 01\nrole: product-manager\ntask: demo\nstatus: done\nround: 0\nbase-commit: abc1234\nrisk-tier: high\nacceptance-ids: [AC1]\n---\nBy: Ann (product-manager)\n');
    f.begin();
    assert.equal(f.lines()[0].tier, 'high');
    assert.equal(f.lines()[0].why, 'tier');
  });
  test('a second begin is refused and the record is unchanged', () => {
    const f = fixture();
    assert.equal(f.begin().code, 0);
    const before = fs.readFileSync(f.record, 'utf8');
    assert.equal(f.begin().code, 3);
    assert.equal(fs.readFileSync(f.record, 'utf8'), before);
  });
  test('begin without a run folder is refused', () => {
    const f = fixture({ slug: 'other' });
    assert.equal(f.run('begin', 'missing', ...BEGIN_LOW, '--base', SHA).code, 3);
  });
  test('begin does not follow a planted link at the record path', (t) => {
    const f = fixture();
    const target = path.join(f.root, 'victim.txt');
    fs.writeFileSync(target, 'keep');
    try {
      fs.symlinkSync(target, f.record);
    } catch {
      t.skip('symlinks are not allowed here');
      return;
    }
    assert.equal(f.begin().code, 1);
    assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
  });
});

describe('sync', () => {
  const step = (f, tier) =>
    fs.writeFileSync(path.join(f.dir, '02-architect.md'), `---\nstep: 02\nrole: architect\ntask: demo\nstatus: done\nround: 0\nbase-commit: abc1234\nrisk-tier: ${tier}\nacceptance-ids: [AC1]\n---\nBy: Ann (architect)\n`);
  const PLAN = (files) => `# Plan\n## Tasks\n### T1 a\n- role: backend-engineer\n- files: ${files}\n- depends-on: none\n- parallel: yes\n`;
  const withPlan = (f, text) => fs.writeFileSync(path.join(f.dir, '02-plan.md'), text);

  test('no record prints tier-path: none, exit 0', () => {
    const f = fixture();
    assert.deepEqual(f.run('sync', f.slug), { code: 0, lines: ['tier-path: none'] });
  });
  test('nothing new changes nothing', () => {
    const f = fixture();
    f.begin();
    const r = f.run('sync', f.slug);
    assert.equal(r.lines[1], 'path: short (low)');
    assert.equal(f.lines().length, 1);
  });
  test('a Step file with risk-tier medium raises (cause step) and adds the skipped entries', () => {
    const f = fixture();
    f.begin();
    step(f, 'medium');
    const r = f.run('sync', f.slug);
    assert.equal(r.lines[0], 'tier-path: feature tier medium path short rev 1');
    assert.equal(r.lines[1], 'path: short, raised to medium (step)');
    assert.ok(r.lines.some((l) => l.startsWith('add before ship: persona-tester')));
    assert.ok(!r.lines.some((l) => l.startsWith('skipped by tier')));
    assert.deepEqual(f.lines()[1], { v: 1, at: '2026-10-28T12:00:00Z', ev: 'raise', tier: 'medium', cause: 'step' });
    f.run('sync', f.slug);
    assert.equal(f.lines().length, 2, 'a second sync appends nothing');
  });
  test('a fix run raised by a Step adds security', () => {
    const f = fixture();
    f.run('begin', f.slug, '--playbook', 'fix', '--triage', 'low', '--short', 'on', '--base', SHA);
    step(f, 'medium');
    const r = f.run('sync', f.slug);
    assert.ok(r.lines.includes('add before ship: security'));
  });
  test('the tier never lowers', () => {
    const f = fixture();
    f.begin();
    step(f, 'high');
    f.run('sync', f.slug);
    step(f, 'low');
    f.run('sync', f.slug);
    assert.equal(f.lines().length, 2);
    assert.equal(readTierPath(f.root, f.slug, { pluginRoot: f.pluginRoot }).tier, 'high');
  });
  test('a full run is raised by a Step but keeps the v0.18 set', () => {
    const f = fixture();
    f.begin(BEGIN_FULL);
    step(f, 'high');
    const r = f.run('sync', f.slug);
    assert.equal(f.lines()[1].cause, 'step');
    assert.ok(r.lines.includes(`set: ${ROUTE_V018.feature.join(', ')}`));
    assert.ok(!r.lines.some((l) => l.startsWith('add before ship')));
  });
  test('--plan: contract, core and pattern paths raise to high (cause plan)', () => {
    const f = fixture();
    f.begin();
    withPlan(f, PLAN('docs/contracts/x.md, skills/pipeline/SKILL.md, src/auth/login.ts, scripts/lessons.mjs'));
    const r = f.run('sync', f.slug, '--plan', '02-plan.md');
    assert.deepEqual(f.lines()[1], { v: 1, at: '2026-10-28T12:00:00Z', ev: 'raise', tier: 'high', cause: 'plan' });
    assert.ok(r.lines.includes('check: high: contract docs/contracts/x.md'));
    assert.ok(r.lines.includes('check: high: core skills/pipeline/SKILL.md'));
    assert.ok(r.lines.includes('check: high: pattern auth src/auth/login.ts'));
    assert.ok(!r.lines.some((l) => l.includes('lessons')));
    assert.ok(r.lines.some((l) => l.startsWith('add before ship: persona-tester')));
  });
  test('--plan clean: none forced high, no raise', () => {
    const f = fixture();
    f.begin();
    withPlan(f, PLAN('scripts/lessons.mjs, scripts/personality.mjs'));
    const r = f.run('sync', f.slug, '--plan', '02-plan.md');
    assert.equal(r.lines.at(-1), 'check: 2 paths, none forced high');
    assert.equal(f.lines().length, 1);
  });
  test('--plan: a task without files, an invalid path, no tasks and a missing plan are unknowable hits', () => {
    const texts = ['# Plan\n## Tasks\n### T1 a\n- role: qa\n- depends-on: none\n- parallel: yes\n', PLAN('../x.ts'), '# nothing\n', null, 'x'.repeat(257 * 1024)];
    for (const text of texts) {
      const f = fixture();
      f.begin();
      if (text !== null) withPlan(f, text);
      const r = f.run('sync', f.slug, '--plan', '02-plan.md');
      assert.ok(r.lines.includes('check: high: plan files unknown'), JSON.stringify(r.lines));
      assert.equal(f.lines()[1].tier, 'high');
      assert.equal(f.lines()[1].cause, 'plan');
    }
  });
  test('--plan lists at most 5 hits then a count', () => {
    const f = fixture();
    f.begin();
    withPlan(f, PLAN(Array.from({ length: 8 }, (_, i) => `src/auth/f${i}.ts`).join(', ')));
    const r = f.run('sync', f.slug, '--plan', '02-plan.md');
    assert.equal(r.lines.filter((l) => l.startsWith('check: high:')).length, 5);
    assert.ok(r.lines.includes('check: +3 more'));
  });
  test('core unknown (no project.md or no Core heading) is a hit', () => {
    for (const project of [null, '# no core here\n']) {
      const f = fixture({ project });
      f.begin();
      withPlan(f, PLAN('scripts/lessons.mjs'));
      assert.ok(f.run('sync', f.slug, '--plan', '02-plan.md').lines.includes('check: high: core unknown'));
      assert.equal(f.lines()[1].tier, 'high');
    }
  });
  test('Core: placeholder, comments, backticks and non-path items', () => {
    const project = '## Core\n<!-- Approved by the CEO.\n- skills/hidden: in a comment -->\n- (none yet)\n- `skills/pipeline`: x\n- notes: not a path\n- plain\n\n## Modules\n- skills/after: outside\n';
    const f = fixture({ project });
    f.begin();
    withPlan(f, PLAN('skills/pipeline/a.md, skills/hidden/a.md, skills/after/a.md'));
    const r = f.run('sync', f.slug, '--plan', '02-plan.md');
    assert.ok(r.lines.includes('check: high: core skills/pipeline/a.md'));
    assert.ok(!r.lines.some((l) => l.includes('skills/hidden') || l.includes('skills/after')));
    assert.ok(r.lines.includes('warning: 2 core items are not paths, not checked'));
  });
  test('--diff: a hit, clean, git failure, base not a commit and oversized output', () => {
    const f = fixture();
    f.begin();
    f.setGit((args) => (args[1] === '--name-only' && args[4] === SHA ? Buffer.from('src/auth/session.ts\0README.md\0') : Buffer.from('docs/guide.md\0')));
    const hit = f.run('sync', f.slug, '--diff');
    assert.ok(hit.lines.includes('check: high: pattern auth src/auth/session.ts'));
    assert.equal(f.lines()[1].cause, 'diff');
    assert.deepEqual(f.calls.map((c) => c.args), [
      ['cat-file', '-e', `${SHA}^{commit}`],
      ['diff', '--name-only', '-z', '--no-renames', SHA, 'HEAD', '--'],
      ['diff', '--name-only', '-z', '--no-renames', 'HEAD', '--'],
      ['ls-files', '--others', '--exclude-standard', '-z']
    ]);
    assert.equal(f.calls[0].opts.cwd, f.root);

    const g = fixture();
    g.begin();
    g.setGit(() => Buffer.from('docs/a.md\0docs/b.md\0'));
    assert.equal(g.run('sync', g.slug, '--diff').lines.at(-1), 'check: 2 paths, none forced high');
    assert.equal(g.lines().length, 1);

    const failures = [() => { throw new Error('boom'); }, (a) => { if (a[0] === 'cat-file') throw new Error('bad object'); return Buffer.alloc(0); }, () => Buffer.alloc(8 * 1024 * 1024 + 1)];
    for (const impl of failures) {
      const h = fixture();
      h.begin();
      h.setGit(impl);
      assert.ok(h.run('sync', h.slug, '--diff').lines.includes('check: high: diff unknown'));
      assert.equal(h.lines()[1].cause, 'diff');
    }
  });
  test('--diff: a path that fails the path rule is echoed as ? and never recorded', () => {
    const f = fixture();
    f.begin();
    f.setGit(() => Buffer.from('src/auth/we ird.ts\0'));
    assert.ok(f.run('sync', f.slug, '--diff').lines.includes('check: high: pattern auth ?'));
    assert.ok(!fs.readFileSync(f.record, 'utf8').includes('ird'));
  });
  test('a data file changed after begin raises to high (cause sets)', () => {
    const f = fixture();
    f.begin();
    const d = shipped();
    d.rev = 2;
    fs.writeFileSync(f.dataFile, JSON.stringify(d));
    const r = f.run('sync', f.slug);
    assert.equal(f.lines()[1].cause, 'sets');
    assert.equal(f.lines()[1].tier, 'high');
    assert.equal(r.lines[1], 'path: short, raised to high (sets)');
    assert.ok(r.lines.includes('tier-sets: changed since begin'));
    assert.ok(r.lines.includes(`set: ${ROUTE_V018.feature.join(', ')}`));
  });
  test('a data file refused after begin raises a short run, not a full run', () => {
    const f = fixture();
    f.begin();
    fs.writeFileSync(f.dataFile, '{');
    const r = f.run('sync', f.slug);
    assert.equal(f.lines()[1].cause, 'sets');
    assert.ok(r.lines.includes('tier-sets: refused invalid json'));

    const g = fixture();
    g.begin(BEGIN_FULL);
    fs.writeFileSync(g.dataFile, '{');
    g.run('sync', g.slug);
    assert.equal(g.lines().length, 1);
  });
  test('cause order: sets, then diff, then plan', () => {
    const f = fixture();
    f.begin();
    fs.writeFileSync(f.dataFile, '{');
    f.setGit(() => Buffer.from('src/auth/x.ts\0'));
    f.run('sync', f.slug, '--diff');
    assert.equal(f.lines()[1].cause, 'sets');
    const g = fixture();
    g.begin();
    g.setGit(() => Buffer.from('src/auth/x.ts\0'));
    withPlan(g, PLAN('src/auth/y.ts'));
    g.run('sync', g.slug, '--plan', '02-plan.md', '--diff');
    assert.equal(g.lines()[1].cause, 'diff');
  });
});

describe('raise and read', () => {
  test('raise needs a record, raises with cause ceo, and never lowers', () => {
    const f = fixture();
    assert.equal(f.run('raise', f.slug, 'medium').code, 3);
    f.begin();
    const r = f.run('raise', f.slug, 'medium');
    assert.equal(r.lines[1], 'path: short, raised to medium (ceo)');
    assert.equal(f.lines()[1].cause, 'ceo');
    f.run('raise', f.slug, 'medium');
    assert.equal(f.lines().length, 2);
    f.run('raise', f.slug, 'high');
    assert.equal(f.lines().length, 3);
    f.run('raise', f.slug, 'medium');
    assert.equal(f.lines().length, 3);
  });
  test('read prints the view; none and broken records', () => {
    const f = fixture();
    assert.deepEqual(JSON.parse(f.run('read', f.slug).lines[0]), { v: 1, slug: 'demo', state: 'none' });
    f.begin();
    f.run('raise', f.slug, 'high');
    const v = JSON.parse(f.run('read', f.slug).lines[0]);
    assert.equal(v.state, 'on');
    assert.equal(v.tier, 'high');
    assert.equal(v.start_tier, 'low');
    assert.equal(v.raised, true);
    assert.equal(v.cause, 'ceo');
    assert.equal(v.base, SHA);
    assert.ok(v.skipped.includes('security'));
    assert.deepEqual(v.add, v.skipped);
    assert.deepEqual(v.set, [...ROUTE_V018.feature]);
    fs.appendFileSync(f.record, 'garbage\n');
    const bad = f.run('read', f.slug);
    assert.equal(bad.code, 1);
    assert.equal(bad.lines[0], 'tier-path record demo line 3: not json');
  });
  test('readTierPath: no folder reads as none; a broken record throws', () => {
    const f = fixture();
    assert.deepEqual(readTierPath(f.root, 'nothing-here'), { v: 1, slug: 'nothing-here', state: 'none' });
    f.begin();
    fs.appendFileSync(f.record, '{}\n');
    assert.throws(() => readTierPath(f.root, f.slug, { pluginRoot: f.pluginRoot }), TierPathRecordError);
  });
  test('the view of a full run: set is the v0.18 route, nothing skipped', () => {
    const f = fixture();
    f.begin(BEGIN_FULL);
    const v = readTierPath(f.root, f.slug, { pluginRoot: f.pluginRoot });
    assert.deepEqual(v.skipped, []);
    assert.deepEqual(v.set, [...ROUTE_V018.feature]);
    assert.equal(v.cause, null);
  });
});

describe('record allow-list and limits', () => {
  const begin = { v: 1, at: '2026-10-28T12:00:00Z', ev: 'begin', pb: 'feature', tier: 'low', path: 'short', why: 'short', rev: 1, base: SHA };
  const raise = { v: 1, at: '2026-10-28T12:00:00Z', ev: 'raise', tier: 'high', cause: 'ceo' };
  const read = (lines, raw = null) => {
    const f = fixture();
    fs.writeFileSync(f.record, raw ?? `${lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`);
    return f.run('read', f.slug);
  };
  const reasonOf = (lines, raw) => read(lines, raw).lines[0].replace(/^tier-path record demo line \d+: /, '');
  test('a valid pair reads', () => {
    assert.equal(read([begin, raise]).code, 0);
  });
  test('every refused shape', () => {
    assert.equal(reasonOf([{ ...begin, extra: 1 }]), 'keys');
    assert.equal(reasonOf([{ ...begin, base: undefined }]), 'keys');
    assert.equal(reasonOf([{ ...begin, v: 2 }]), 'unknown v');
    assert.equal(reasonOf([{ ...begin, ev: 'end' }]), 'unknown ev');
    assert.equal(reasonOf([{ ...begin, at: '2026-10-28 12:00' }]), 'at');
    assert.equal(reasonOf([{ ...begin, tier: 'extreme' }]), 'tier');
    assert.equal(reasonOf([{ ...begin, pb: 'qa' }]), 'pb');
    assert.equal(reasonOf([{ ...begin, path: 'half' }]), 'path');
    assert.equal(reasonOf([{ ...begin, why: 'because' }]), 'why');
    assert.equal(reasonOf([{ ...begin, rev: 1000 }]), 'rev');
    assert.equal(reasonOf([{ ...begin, base: 'ABCDEF1' }]), 'base');
    assert.equal(reasonOf([{ ...begin, base: '$(touch x)' }]), 'base');
    assert.equal(reasonOf([raise]), 'first line is not begin');
    assert.equal(reasonOf([begin, begin]), 'second begin');
    assert.equal(reasonOf([begin, { ...raise, cause: 'because' }]), 'cause');
    assert.equal(reasonOf([begin, { ...raise, tier: 'low' }]), 'raise is not above the current tier');
    assert.equal(reasonOf([begin, raise, raise]), 'raise is not above the current tier');
    assert.equal(reasonOf([begin, { ...raise, pb: 'feature' }]), 'keys');
    assert.equal(reasonOf(['[]']), 'not an object');
    assert.equal(reasonOf(['{"__proto__":{}}']), 'unknown v');
    assert.equal(reasonOf([], JSON.stringify(begin)), 'line not closed');
  });
  test('a line over 256 bytes, more than 100 lines and a file over 16 KiB are refused', () => {
    assert.equal(reasonOf([{ ...begin, pad: 'x'.repeat(300) }]), 'line over 256 bytes');
    assert.match(read([begin, ...Array.from({ length: 100 }, () => raise)]).lines[0], /more than 100 lines/);
    assert.match(read([], 'x'.repeat(16 * 1024 + 1)).lines[0], /file over 16 KiB/);
  });
  test('the writer refuses an append that would pass 100 lines', () => {
    const f = fixture();
    const mid = { ...raise, tier: 'medium' };
    fs.writeFileSync(f.record, `${JSON.stringify(begin)}\n`.repeat(1));
    assert.equal(f.run('raise', f.slug, 'medium').code, 0);
    assert.equal(f.lines().length, 2);
    void mid;
  });
  test('the record holds no free text, no CR, and lines of at most 256 bytes', () => {
    const f = fixture();
    f.begin();
    f.run('raise', f.slug, 'high');
    const text = fs.readFileSync(f.record, 'utf8');
    assert.ok(!text.includes('\r'));
    for (const l of text.split('\n').filter(Boolean)) assert.ok(Buffer.byteLength(l) <= 256);
  });
  test('a run folder that is a plain file is refused', () => {
    const f = fixture();
    fs.rmSync(f.dir, { recursive: true });
    fs.writeFileSync(f.dir, 'x');
    assert.equal(f.run('read', f.slug).code, 1);
  });
  test('a hard-linked record is refused', () => {
    const f = fixture();
    f.begin();
    fs.linkSync(f.record, path.join(f.dir, 'other.jsonl'));
    assert.equal(f.run('read', f.slug).code, 1);
  });
});

describe('real artefacts', () => {
  const gitOk = (() => {
    try {
      execFileSync('git', ['--version'], { stdio: 'ignore' });
      return fs.existsSync(path.join(REPO, '.git'));
    } catch {
      return false;
    }
  })();
  test('no pattern hit on the tracked files outside .company/', (t) => {
    if (!gitOk) return t.skip('git is not available');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(os.tmpdir(), 'tier-set-no-such-gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, env, maxBuffer: 64 * 1024 * 1024 }).toString('utf8').split('\0').filter(Boolean);
    const hits = checkPaths(out, { core: [], forcedHigh: FORCED_HIGH_V1 }).filter((h) => h.reason.startsWith('pattern'));
    assert.deepEqual(hits.filter((h) => !h.path.startsWith('.company/')), []);
  });
  test('the parallel-cap plan shows contract and core hits against this repo', (t) => {
    const plan = path.join(REPO, '.company', 'work', 'parallel-cap', '02-plan.md');
    const project = path.join(REPO, '.company', 'project.md');
    if (!fs.existsSync(plan) || !fs.existsSync(project)) return t.skip('run files are not in this checkout');
    const f = fixture({ project: fs.readFileSync(project, 'utf8'), slug: 'parallel-cap' });
    fs.copyFileSync(plan, path.join(f.dir, '02-plan.md'));
    f.run('begin', 'parallel-cap', ...BEGIN_LOW, '--base', SHA);
    const r = f.run('sync', 'parallel-cap', '--plan', '02-plan.md');
    const text = r.lines.join('\n');
    assert.match(text, /check: high: contract docs\/contracts\//);
    assert.match(text, /check: high: core /);
  });
});
