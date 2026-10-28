import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROUTE_V018, FORCED_HIGH_V1, CORE_FIXED, loadTierSets, tokens, checkPaths, readTierPath, TierPathRecordError, main } from './tier-set.mjs';

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const REPO = path.resolve(import.meta.dirname, '..');
const SHIPPED = path.join(REPO, 'company', 'tier-sets.json');
const SHA = 'abcdef1234567';
const RESOLVED = `${SHA}${'0'.repeat(27)}`;
const GIT_PREFIX = ['--no-optional-locks', '-c', 'core.fsmonitor=false'];
const git = (...sub) => [...GIT_PREFIX, ...sub];
const PLAYBOOKS = ['feature', 'fix'];
const BEGIN_LOW = ['--playbook', 'feature', '--triage', 'low', '--short', 'on', '--ceo', 'short'];
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
  // The default fake git answers what the script asks: one commit for a short base, a commit type, the Core file at the base.
  const defaultImpl = (sub) => {
    if (sub[0] === 'rev-parse') return Buffer.from(`${RESOLVED}\n`);
    if (sub[0] === 'cat-file' && sub[1] === '-t') return Buffer.from('commit\n');
    if (sub[0] === 'cat-file' && sub[1] === 'blob') {
      if (project === null) throw new Error('no such blob');
      return Buffer.from(project);
    }
    return Buffer.alloc(0);
  };
  let gitImpl = () => undefined;
  const fakeGit = (args, opts) => {
    calls.push({ args, opts });
    const sub = args.slice(GIT_PREFIX.length);
    const out = gitImpl(sub, opts);
    return out === undefined ? defaultImpl(sub) : out;
  };
  const run = (...args) => main(args, { now: NOW, root: product, pluginRoot, git: fakeGit });
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
    assert.equal(f.run('preview', f.slug, '--playbook', 'feature', '--triage', 'low', '--short', 'on', '--ceo', 'maybe').code, 3);
    assert.equal(f.run('begin', f.slug, '--playbook', 'feature', '--triage', 'low', '--short', 'on', '--base', SHA, '--ceo', 'maybe').code, 3);
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
    assert.deepEqual(tokens('OAuth2Client.ts').slice(0, 3), ['oauth2', 'client', 'ts']);
    assert.deepEqual(tokens('AuthService'), ['auth', 'service']);
    assert.deepEqual(tokens('JWTValidator'), ['jwtvalidator', 'jwt', 'validator']);
    assert.deepEqual(tokens('getJWTToken'), ['get', 'jwttoken', 'jwt', 'token']);
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
    const s = why({}, 'low', 'on', ['--ceo', 'short']);
    assert.equal(s.why, 'short');
    assert.equal(s.path, 'short');
    assert.equal(why({}, 'high', 'on', ['--ceo', 'short']).path, 'full');
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
    const b = f.run('begin', f.slug, '--playbook', 'fix', '--triage', 'low', '--short', 'on', '--base', SHA, '--ceo', 'short');
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
    f.run('begin', f.slug, '--playbook', 'fix', '--triage', 'low', '--short', 'on', '--base', SHA, '--ceo', 'short');
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
    f.calls.length = 0;
    f.setGit((sub) => {
      if (sub[0] === 'diff') return Buffer.from(sub.includes(RESOLVED) ? 'src/auth/session.ts\0README.md\0' : 'docs/guide.md\0');
      if (sub[0] === 'ls-files') return Buffer.alloc(0);
      return undefined;
    });
    const hit = f.run('sync', f.slug, '--diff');
    assert.ok(hit.lines.includes('check: high: pattern auth src/auth/session.ts'));
    assert.equal(f.lines()[1].cause, 'diff');
    const diffFlags = ['--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--end-of-options'];
    assert.deepEqual(f.calls.map((c) => c.args), [
      git('cat-file', 'blob', '--end-of-options', `${RESOLVED}:.company/project.md`),
      git('cat-file', '-e', '--end-of-options', `${RESOLVED}^{commit}`),
      git('diff', ...diffFlags, RESOLVED, 'HEAD', '--'),
      git('diff', ...diffFlags, 'HEAD', '--'),
      git('ls-files', '--others', '--exclude-standard', '-z')
    ]);
    for (const c of f.calls) {
      assert.equal(c.opts.cwd, f.root);
      assert.equal(c.opts.env.GIT_OPTIONAL_LOCKS, '0');
      assert.equal(c.opts.env.GIT_TERMINAL_PROMPT, '0');
    }

    const g = fixture();
    g.begin();
    g.setGit((sub) => (sub[0] === 'diff' || sub[0] === 'ls-files' ? Buffer.from('docs/a.md\0docs/b.md\0') : undefined));
    assert.equal(g.run('sync', g.slug, '--diff').lines.at(-1), 'check: 2 paths, none forced high');
    assert.equal(g.lines().length, 1);

    const failures = [
      () => { throw new Error('boom'); },
      (sub) => { if (sub[1] === '-e') throw new Error('bad object'); return undefined; },
      (sub) => (sub[0] === 'diff' ? Buffer.alloc(8 * 1024 * 1024 + 1) : undefined)
    ];
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
    f.setGit((sub) => (sub[0] === 'diff' ? Buffer.from('src/auth/we ird.ts\0') : undefined));
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
    assert.equal(r.lines.find((l) => l.startsWith('add before ship: ')), `add before ship: ${f.lines()[0].skip.join(', ')}`);
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
    f.setGit((sub) => (sub[0] === 'diff' ? Buffer.from('src/auth/x.ts\0') : undefined));
    f.run('sync', f.slug, '--diff');
    assert.equal(f.lines()[1].cause, 'sets');
    const g = fixture();
    g.begin();
    g.setGit((sub) => (sub[0] === 'diff' ? Buffer.from('src/auth/x.ts\0') : undefined));
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
    assert.equal(v.base, RESOLVED);
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
  const begin = { v: 1, at: '2026-10-28T12:00:00Z', ev: 'begin', pb: 'feature', tier: 'low', path: 'short', why: 'short', rev: 1, base: RESOLVED, skip: ['security'] };
  const raise = { v: 1, at: '2026-10-28T12:00:00Z', ev: 'raise', tier: 'high', cause: 'ceo' };
  const read = (lines, raw = null) => {
    const f = fixture();
    fs.writeFileSync(f.record, raw ?? `${lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`);
    return f.run('read', f.slug);
  };
  const reasonOf = (lines, raw) => read(lines, raw).lines[0].replace(/^tier-path record demo line \d+: /, '');
  test('a valid pair reads', () => {
    assert.equal(read([begin, raise]).code, 0);
    assert.equal(read([{ ...begin, base: 'f'.repeat(64) }]).code, 0);
    assert.equal(read([{ ...begin, path: 'full', why: 'ceo', skip: [] }]).code, 0);
  });
  test('every refused shape', () => {
    assert.equal(reasonOf([{ ...begin, extra: 1 }]), 'keys');
    assert.equal(reasonOf([{ ...begin, base: undefined }]), 'keys');
    assert.equal(reasonOf([{ ...begin, skip: undefined }]), 'keys');
    assert.equal(reasonOf([{ ...begin, v: 2 }]), 'unknown v');
    assert.equal(reasonOf([{ ...begin, ev: 'end' }]), 'unknown ev');
    assert.equal(reasonOf([{ ...begin, at: '2026-10-28 12:00' }]), 'at');
    assert.equal(reasonOf([{ ...begin, tier: 'extreme' }]), 'tier');
    assert.equal(reasonOf([{ ...begin, pb: 'qa' }]), 'pb');
    assert.equal(reasonOf([{ ...begin, path: 'half' }]), 'path');
    assert.equal(reasonOf([{ ...begin, why: 'because' }]), 'why');
    assert.equal(reasonOf([{ ...begin, rev: 1000 }]), 'rev');
    assert.equal(reasonOf([{ ...begin, base: 'ABCDEF1' }]), 'base');
    assert.equal(reasonOf([{ ...begin, base: SHA }]), 'base');
    assert.equal(reasonOf([{ ...begin, base: RESOLVED.slice(0, 39) }]), 'base');
    assert.equal(reasonOf([{ ...begin, base: `${RESOLVED}0` }]), 'base');
    assert.equal(reasonOf([{ ...begin, skip: 'security' }]), 'skip');
    assert.equal(reasonOf([{ ...begin, skip: ['rm-rf'] }]), 'skip');
    assert.equal(reasonOf([{ ...begin, skip: [7] }]), 'skip');
    assert.equal(reasonOf([{ ...begin, skip: ['legal'] }]), 'skip');
    assert.equal(reasonOf([{ ...begin, skip: ['security', 'persona-tester'] }]), 'skip');
    assert.equal(reasonOf([{ ...begin, skip: ['security', 'security'] }]), 'skip');
    assert.equal(reasonOf([{ ...begin, path: 'full', why: 'ceo' }]), 'skip');
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
  test('a line over 512 bytes, more than 100 lines and a file over 16 KiB are refused', () => {
    const padded = (n) => `${JSON.stringify(begin)}${' '.repeat(n - Buffer.byteLength(JSON.stringify(begin)))}`;
    assert.equal(read([], `${padded(512)}\n`).code, 0);
    assert.equal(reasonOf([], `${padded(513)}\n`), 'line over 512 bytes');
    assert.equal(reasonOf([{ ...begin, pad: 'x'.repeat(600) }]), 'line over 512 bytes');
    assert.match(read([begin, ...Array.from({ length: 100 }, () => raise)]).lines[0], /more than 100 lines/);
    assert.match(read([], 'x'.repeat(16 * 1024 + 1)).lines[0], /file over 16 KiB/);
  });
  test('the writer refuses an append that would pass 100 lines', () => {
    const f = fixture();
    const mid = { ...raise, tier: 'medium' };
    fs.writeFileSync(f.record, `${JSON.stringify(begin)}\n`);
    assert.equal(f.run('raise', f.slug, 'medium').code, 0);
    assert.equal(f.lines().length, 2);
    void mid;
  });
  test('the record holds no free text, no CR, and lines of at most 512 bytes', () => {
    const f = fixture();
    f.begin();
    f.run('raise', f.slug, 'high');
    const text = fs.readFileSync(f.record, 'utf8');
    assert.ok(!text.includes('\r'));
    for (const l of text.split('\n').filter(Boolean)) assert.ok(Buffer.byteLength(l) <= 512);
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

describe('fix round: hostile and contract cases', () => {
  const PLAN = (files) => `# Plan\n## Tasks\n### T1 a\n- role: backend-engineer\n- files: ${files}\n- depends-on: none\n- parallel: yes\n`;
  const noRecord = (f) => assert.equal(fs.existsSync(f.record), false);

  test('begin without --ceo takes the full path with why ceo; --ceo short at low and on gives short', () => {
    const f = fixture();
    const b = f.run('begin', f.slug, '--playbook', 'feature', '--triage', 'low', '--short', 'on', '--base', SHA);
    assert.equal(b.code, 0);
    assert.equal(b.lines[0], 'tier-path: feature tier low path full rev 1');
    assert.ok(b.lines.includes('path: full (ceo)'));
    assert.equal(f.lines()[0].why, 'ceo');
    assert.deepEqual(f.lines()[0].skip, []);
    const g = fixture();
    assert.equal(g.begin().lines[0], 'tier-path: feature tier low path short rev 1');
    assert.equal(g.lines()[0].why, 'short');
    assert.deepEqual(g.lines()[0].skip, ['persona-tester', 'senior-engineer-research', 'security', 'senior-engineer-compliance', 'hands-on-tester']);
  });
  test('preview without --ceo shows the short offer; --ceo full shows the full path', () => {
    const f = fixture();
    const flags = ['--playbook', 'feature', '--triage', 'low', '--short', 'on'];
    assert.equal(f.run('preview', f.slug, ...flags).lines[1], 'path: short (low)');
    assert.equal(f.run('preview', f.slug, ...flags, '--ceo', 'full').lines[1], 'path: full (ceo)');
    assert.equal(f.calls.length, 0);
  });
  test('the record holds the resolved full id', () => {
    const f = fixture();
    f.begin();
    assert.equal(f.lines()[0].base, RESOLVED);
    assert.deepEqual(f.calls.map((c) => c.args), [git('rev-parse', `--disambiguate=${SHA}`), git('cat-file', '-t', '--end-of-options', RESOLVED)]);
  });
  test('a 40 and a 64 hex base are checked as a commit without a lookup', () => {
    for (const base of ['b'.repeat(40), 'c'.repeat(64)]) {
      const f = fixture();
      const r = f.run('begin', f.slug, ...BEGIN_LOW, '--base', base);
      assert.equal(r.code, 0);
      assert.equal(f.lines()[0].base, base);
      assert.deepEqual(f.calls.map((c) => c.args), [git('cat-file', '-t', '--end-of-options', base)]);
    }
  });
  test('a base that is not exactly one commit exits 3 and writes no record', () => {
    const id = (n) => `${SHA}${String(n).padStart(2, '0')}${'0'.repeat(25)}`;
    const cases = {
      'no candidate': (sub) => (sub[0] === 'rev-parse' ? Buffer.alloc(0) : undefined),
      'a tree': (sub) => (sub[1] === '-t' ? Buffer.from('tree\n') : undefined),
      'two commits': (sub) => (sub[0] === 'rev-parse' ? Buffer.from(`${id(1)}\n${id(2)}\n`) : undefined),
      'seventeen candidates': (sub) => (sub[0] === 'rev-parse' ? Buffer.from(Array.from({ length: 17 }, (_, i) => `${id(i)}\n`).join('')) : undefined),
      'a line that is not an id': (sub) => (sub[0] === 'rev-parse' ? Buffer.from('refs/heads/main\n') : undefined),
      'git fails': () => { throw new Error('boom'); },
      'oversized output': (sub) => (sub[0] === 'rev-parse' ? Buffer.alloc(8 * 1024 * 1024 + 1) : undefined)
    };
    for (const [label, impl] of Object.entries(cases)) {
      const f = fixture();
      f.setGit(impl);
      const r = f.begin();
      assert.equal(r.code, 3, label);
      assert.equal(r.lines[0], 'refused: base is not one commit', label);
      noRecord(f);
    }
    const f = fixture();
    f.setGit((sub) => (sub[0] === 'cat-file' ? Buffer.from('tree\n') : undefined));
    assert.equal(f.run('begin', f.slug, ...BEGIN_LOW, '--base', 'd'.repeat(40)).code, 3);
    noRecord(f);
  });
  test('one commit among several candidates is the one recorded', () => {
    const f = fixture();
    const a = `${SHA}${'1'.repeat(27)}`;
    const b = `${SHA}${'2'.repeat(27)}`;
    f.setGit((sub) => {
      if (sub[0] === 'rev-parse') return Buffer.from(`${a}\n${b}\n`);
      if (sub[1] === '-t') return Buffer.from(sub.at(-1) === b ? 'commit\n' : 'tree\n');
      return undefined;
    });
    assert.equal(f.begin().code, 0);
    assert.equal(f.lines()[0].base, b);
  });
  test('a second begin makes no git call', () => {
    const f = fixture();
    f.begin();
    f.calls.length = 0;
    assert.equal(f.begin().code, 3);
    assert.equal(f.calls.length, 0);
  });

  test('a data file with a new rev and another low set, or a refused one: sync raises to high and add equals the recorded skip', () => {
    for (const refuse of [false, true]) {
      const f = fixture();
      f.begin();
      const skip = f.lines()[0].skip;
      if (refuse) fs.writeFileSync(f.dataFile, '{');
      else {
        const d = shipped();
        d.rev = 2;
        d.playbooks.feature.low = d.playbooks.feature.low.filter((e) => e !== 'brand-artist');
        fs.writeFileSync(f.dataFile, JSON.stringify(d));
      }
      const r = f.run('sync', f.slug);
      assert.deepEqual(f.lines()[1], { v: 1, at: '2026-10-28T12:00:00Z', ev: 'raise', tier: 'high', cause: 'sets' });
      assert.equal(r.lines[1], 'path: short, raised to high (sets)');
      assert.equal(r.lines[2], `add before ship: ${skip.join(', ')}`);
      assert.equal(r.lines.at(-1), refuse ? 'tier-sets: refused invalid json' : 'tier-sets: changed since begin');
    }
  });
  test('read, raise and readTierPath give the same view with the data file deleted', () => {
    const f = fixture();
    f.begin();
    const before = JSON.parse(f.run('read', f.slug).lines[0]);
    fs.rmSync(f.dataFile);
    assert.deepEqual(JSON.parse(f.run('read', f.slug).lines[0]), before);
    assert.deepEqual(readTierPath(f.root, f.slug), before);
    assert.deepEqual(readTierPath(f.root, f.slug, { pluginRoot: f.pluginRoot }), before);
    const r = f.run('raise', f.slug, 'medium');
    assert.equal(r.code, 0);
    assert.ok(!r.lines.some((l) => l.startsWith('tier-sets')));
    assert.equal(r.lines[2], `add before ship: ${before.skipped.join(', ')}`);
  });

  test('Core is read at the base commit: a working-copy deletion keeps the core hit', () => {
    const f = fixture();
    f.begin();
    fs.writeFileSync(path.join(f.root, '.company', 'project.md'), '## Core\n');
    fs.writeFileSync(path.join(f.dir, '02-plan.md'), PLAN('skills/pipeline/a.md'));
    const r = f.run('sync', f.slug, '--plan', '02-plan.md');
    assert.ok(r.lines.includes('check: high: core skills/pipeline/a.md'));
  });
  test('project.md absent at the base commit is core unknown', () => {
    const f = fixture({ project: null });
    fs.writeFileSync(path.join(f.root, '.company', 'project.md'), '## Core\n- skills/pipeline: x\n');
    f.begin();
    fs.writeFileSync(path.join(f.dir, '02-plan.md'), PLAN('scripts/lessons.mjs'));
    assert.ok(f.run('sync', f.slug, '--plan', '02-plan.md').lines.includes('check: high: core unknown'));
  });
  test('a Core file over 64 KiB or not UTF-8 is core unknown', () => {
    for (const blob of [Buffer.from(`## Core\n${'x'.repeat(64 * 1024)}`), Buffer.from([0x23, 0xff, 0xfe])]) {
      const f = fixture();
      f.begin();
      f.setGit((sub) => (sub[1] === 'blob' ? blob : undefined));
      fs.writeFileSync(path.join(f.dir, '02-plan.md'), PLAN('scripts/lessons.mjs'));
      assert.ok(f.run('sync', f.slug, '--plan', '02-plan.md').lines.includes('check: high: core unknown'));
    }
  });
  test('each CORE_FIXED path is a core hit in a plan and in a diff, even with an empty Core', () => {
    assert.deepEqual([...CORE_FIXED], ['.company/project.md', '.company/settings.json', '.company/standards.md']);
    for (const p of CORE_FIXED) {
      const f = fixture({ project: '## Core\n' });
      f.begin();
      fs.writeFileSync(path.join(f.dir, '02-plan.md'), PLAN(p));
      assert.ok(f.run('sync', f.slug, '--plan', '02-plan.md').lines.includes(`check: high: core ${p}`), p);
      const g = fixture({ project: '## Core\n' });
      g.begin();
      g.setGit((sub) => (sub[0] === 'diff' && sub.includes(RESOLVED) ? Buffer.from(`${p}\0`) : undefined));
      assert.ok(g.run('sync', g.slug, '--diff').lines.includes(`check: high: core ${p}`), p);
    }
    assert.deepEqual(checkPaths(['.company/work/x/02-plan.md'], { core: [] }), []);
  });

  test('acronym-led names hit; OAuth2Client keeps oauth2; scripts and .company names do not', () => {
    const hit = (p) => checkPaths([p], { core: [], forcedHigh: FORCED_HIGH_V1 }).map((h) => h.reason);
    const names = {
      'src/JWTValidator.ts': 'pattern jwt', 'src/JWTMiddleware.ts': 'pattern jwt', 'src/SSOCallback.ts': 'pattern sso', 'src/SSOConfig.cs': 'pattern sso',
      'src/PIIRedactor.ts': 'pattern pii', 'src/PIIMasker.ts': 'pattern pii', 'src/MFAService.ts': 'pattern mfa', 'src/MFASetup.tsx': 'pattern mfa',
      'src/RBACPolicy.ts': 'pattern rbac', 'src/SAMLProvider.java': 'pattern saml', 'src/OAuth2Client.ts': 'pattern oauth2'
    };
    for (const [p, reason] of Object.entries(names)) assert.deepEqual(hit(p), [reason], p);
    for (const p of ['scripts/lessons.mjs', 'scripts/personality.mjs', '.company/work/x/18-security.md']) assert.deepEqual(hit(p), [], p);
  });
  test('a long upper-case segment is split in linear time', () => {
    const started = Date.now();
    assert.ok(tokens('A'.repeat(4000)).length >= 1);
    assert.ok(Date.now() - started < 1000);
  });

  test('forced_high lacking a v1 token is refused; a superset loads', () => {
    const d = shipped();
    d.forced_high = d.forced_high.filter((x) => x !== 'jwt');
    assert.equal(loadTierSets(fixture({ data: d }).pluginRoot).reason, 'forced_high lacks jwt');
    const e = shipped();
    e.forced_high = [...e.forced_high, 'cookie'];
    const l = loadTierSets(fixture({ data: e }).pluginRoot);
    assert.equal(l.ok, true);
    assert.ok(l.forced_high.includes('cookie'));
    const h = shipped();
    h.forced_high = ['zz', ...FORCED_HIGH_V1.filter((x) => x !== 'auth' && x !== 'mfa')];
    assert.equal(loadTierSets(fixture({ data: h }).pluginRoot).reason, 'forced_high lacks auth');
  });
});

describe('real git, every call form', () => {
  const gitOk = (() => {
    try {
      execFileSync('git', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  function repo(t, objectFormat) {
    const top = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-set-git-'));
    t.after(() => fs.rmSync(top, { recursive: true, force: true }));
    const cfg = path.join(top, 'gitconfig');
    const ignore = path.join(top, 'empty-ignore');
    fs.writeFileSync(ignore, '');
    fs.writeFileSync(cfg, `[core]\n\texcludesFile = ${ignore.replaceAll('\\', '/')}\n`);
    const dir = path.join(top, 'repo');
    fs.mkdirSync(dir);
    const extra = { GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1', HOME: top, USERPROFILE: top, XDG_CONFIG_HOME: top, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
    const g = (...args) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').trim();
    g('init', '--quiet', '--initial-branch=main', ...(objectFormat ? [`--object-format=${objectFormat}`] : []));
    const write = (rel, text) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    };
    const commit = (message) => {
      g('add', '--all');
      g('commit', '--quiet', `--message=${message}`);
      return g('rev-parse', '--verify', 'HEAD');
    };
    const calls = [];
    const spy = (args, opts) => {
      calls.push(args);
      return execFileSync('git', args, { cwd: opts.cwd, env: { ...opts.env, ...extra }, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    };
    const runDir = path.join(dir, '.company', 'work', 'demo');
    fs.mkdirSync(runDir, { recursive: true });
    return { dir, g, write, commit, calls, run: (...args) => main(args, { now: NOW, root: dir, git: spy }), record: path.join(runDir, 'tier-path.jsonl'), runDir };
  }

  const diffFlags = ['--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--end-of-options'];

  test('begin resolves a short base through objects, not a branch of the same name; sync reads Core at the base and the diff', (t) => {
    if (!gitOk) return t.skip('git is not available');
    const r = repo(t);
    r.write('.company/project.md', '## Core\n- skills/pipeline: run setup\n\n## Modules\n');
    r.write('a.txt', 'one');
    const first = r.commit('first');
    r.write('b.txt', 'two');
    const second = r.commit('second');
    const short = first.slice(0, 7);
    r.g('branch', short, second);
    r.calls.length = 0;
    const b = r.run('begin', 'demo', '--playbook', 'feature', '--triage', 'low', '--short', 'on', '--base', short, '--ceo', 'short');
    assert.equal(b.code, 0, b.lines.join('\n'));
    const rec = JSON.parse(fs.readFileSync(r.record, 'utf8').split('\n')[0]);
    assert.equal(rec.base, first);
    assert.deepEqual(r.calls, [git('rev-parse', `--disambiguate=${short}`), git('cat-file', '-t', '--end-of-options', first)]);

    r.write('src/auth/x.ts', 'export {}');
    r.commit('auth');
    r.write('skills/pipeline/new.md', 'x');
    r.write('src/untracked/session.ts', 'x');
    fs.writeFileSync(path.join(r.dir, '.company', 'project.md'), '## Core\n');
    fs.writeFileSync(path.join(r.runDir, '02-plan.md'), '# Plan\n## Tasks\n### T1 a\n- role: backend-engineer\n- files: skills/pipeline/a.md\n- depends-on: none\n- parallel: yes\n');
    r.calls.length = 0;
    const s = r.run('sync', 'demo', '--plan', '02-plan.md', '--diff');
    assert.equal(s.code, 0, s.lines.join('\n'));
    const text = s.lines.join('\n');
    assert.ok(s.lines.includes('check: high: pattern auth src/auth/x.ts'), text);
    assert.ok(s.lines.includes('check: high: pattern session src/untracked/session.ts'), text);
    assert.ok(s.lines.includes('check: high: core skills/pipeline/a.md'), text);
    assert.ok(s.lines.includes('check: high: core skills/pipeline/new.md'), text);
    assert.ok(s.lines.includes('check: high: core .company/project.md'), text);
    assert.ok(!text.includes('core unknown') && !text.includes('diff unknown'), text);
    assert.deepEqual(r.calls, [
      git('cat-file', 'blob', '--end-of-options', `${first}:.company/project.md`),
      git('cat-file', '-e', '--end-of-options', `${first}^{commit}`),
      git('diff', ...diffFlags, first, 'HEAD', '--'),
      git('diff', ...diffFlags, 'HEAD', '--'),
      git('ls-files', '--others', '--exclude-standard', '-z')
    ]);
  });

  test('a full 40 hex id is checked as a commit; a tree id and unknown ids are refused', (t) => {
    if (!gitOk) return t.skip('git is not available');
    const r = repo(t);
    r.write('a.txt', 'one');
    const first = r.commit('first');
    r.calls.length = 0;
    const ok = r.run('begin', 'demo', '--playbook', 'fix', '--triage', 'low', '--short', 'on', '--base', first, '--ceo', 'short');
    assert.equal(ok.code, 0, ok.lines.join('\n'));
    assert.deepEqual(r.calls, [git('cat-file', '-t', '--end-of-options', first)]);
    fs.rmSync(r.record);
    const tree = r.g('rev-parse', 'HEAD^{tree}');
    for (const base of [tree, tree.slice(0, 8), '1234567', 'f'.repeat(40)]) {
      const bad = r.run('begin', 'demo', '--playbook', 'fix', '--triage', 'low', '--short', 'on', '--base', base);
      assert.equal(bad.code, 3, base);
      assert.equal(fs.existsSync(r.record), false, base);
    }
  });

  test('a 64 hex id works in a sha256 repository', (t) => {
    if (!gitOk) return t.skip('git is not available');
    let r;
    try {
      r = repo(t, 'sha256');
    } catch {
      return t.skip('git cannot make a sha256 repository');
    }
    r.write('.company/project.md', '## Core\n- skills/pipeline: x\n');
    const first = r.commit('first');
    assert.equal(first.length, 64);
    for (const base of [first, first.slice(0, 12)]) {
      fs.rmSync(r.record, { force: true });
      const b = r.run('begin', 'demo', '--playbook', 'feature', '--triage', 'low', '--short', 'on', '--base', base, '--ceo', 'short');
      assert.equal(b.code, 0, b.lines.join('\n'));
      assert.equal(JSON.parse(fs.readFileSync(r.record, 'utf8').split('\n')[0]).base, first);
    }
    r.write('src/auth/x.ts', 'x');
    r.commit('auth');
    const s = r.run('sync', 'demo', '--diff');
    assert.ok(s.lines.includes('check: high: pattern auth src/auth/x.ts'), s.lines.join('\n'));
  });
});
