// route v1.0: draft lint, data lint, `next` decisions, `dry`, ledger limits.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadGolden } from './contract-fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTE = path.join(HERE, 'route.mjs');
const PROTECTED = ['architect', 'code-reviewer', 'fresh-reviewer', 'pentester', 'security', 'vuln-scanner'];
const SLUG = 'P20261116.000003/01-feature';
const BASE40 = 'a'.repeat(40);

const sandboxes = [];
const REPO = path.join(HERE, '..');
// root is the product (cwd, no plugin data). plugin is a fake plugin root: a copy of route.mjs and the
// two files it imports, so the script's own folder decides where company/ and agents/ are read.
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'route-test-'));
  const plugin = fs.mkdtempSync(path.join(os.tmpdir(), 'route-plugin-'));
  sandboxes.push(root, plugin);
  fs.mkdirSync(path.join(plugin, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'mods', 'lib'), { recursive: true });
  // diff-facts imports tier-set, which reaches more scripts: copy the non-test scripts and mods/lib.
  const keep = (src) => !/\.test\.mjs$/.test(src);
  fs.cpSync(HERE, path.join(plugin, 'scripts'), { recursive: true, filter: (src) => (fs.statSync(src).isDirectory() ? src === HERE : keep(src)) });
  for (const d of ['mods', 'hooks']) fs.cpSync(path.join(REPO, d), path.join(plugin, d), { recursive: true, filter: keep });
  fs.mkdirSync(path.join(plugin, 'company'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(root, '.company'), { recursive: true });
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  return { root, plugin, home, run: path.join(root, '.company', 'work', ...SLUG.split('/')) };
}
after(() => { for (const r of sandboxes) fs.rmSync(r, { recursive: true, force: true }); });

const AGENTS = ['qa', 'security', 'architect', 'code-reviewer', 'fresh-reviewer', 'pentester', 'vuln-scanner',
  'product-manager', 'backend-engineer', 'senior-engineer', 'accessibility-tester', 'ui-ux-designer',
  'hands-on-tester', 'persona-tester', 'localizer', 'writer', 'devops'];
const WHEN = {
  'accessibility-tester': ['ui_changed'], 'ui-ux-designer': ['ui_changed'],
  'hands-on-tester': ['ui_changed'], 'persona-tester': ['ui_changed'],
  localizer: ['strings_changed', 'languages>1'],
};

function seed(sb, { budgets = { feature: 10, fix: 6 }, when = WHEN, languages = 'en' } = {}) {
  for (const a of AGENTS) fs.writeFileSync(path.join(sb.plugin, 'agents', `${a}.md`), `---\nname: ${a}\n---\n`);
  fs.writeFileSync(path.join(sb.plugin, 'company', 'model-floor.json'), JSON.stringify({ v: 1, protected: PROTECTED }));
  fs.writeFileSync(path.join(sb.plugin, 'company', 'step-budgets.json'), JSON.stringify({ v: 1, budgets, source: 'test fixture' }));
  fs.writeFileSync(path.join(sb.plugin, 'company', 'role-when.json'), JSON.stringify({ v: 1, when }));
  fs.writeFileSync(path.join(sb.root, '.company', 'project.md'), `# Project\nlanguages: ${languages}\n`);
  fs.mkdirSync(sb.run, { recursive: true });
}

function cli(sb, args) {
  const r = spawnSync(process.execPath, [path.join(sb.plugin, 'scripts', 'route.mjs'), ...args], {
    cwd: sb.root, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, HOME: sb.home, USERPROFILE: sb.home, MCSPARROW_HOME: path.join(sb.home, '.mcsparrow'), AICO_COLD: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function draft(sb, obj, name = 'draft.json') {
  const p = path.join(sb.root, name);
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return p;
}

// A directory link works without privilege on every platform; lstat sees a link either way.
function linkTo(dir, at) { fs.symlinkSync(dir, at, 'junction'); }

const step = (role, why = 'planned') => ({ role, why });
function baseDraft(extra = {}) {
  return {
    playbook: 'feature', size: 'M',
    steps: [step('product-manager'), step('backend-engineer'), step('accessibility-tester', 'ui check'), step('qa'), step('security')],
    skips: [],
    ...extra,
  };
}

function facts(sb, flags = {}, kinds = ['code'], name = '05-backend-engineer') {
  const f = {
    v: 1, step: name, base: BASE40, head: sb.head || 'b'.repeat(40),
    paths: kinds.map((k, i) => ({ path: `p${i}.${k}`, from: null, status: 'M', kind: k })),
    truncated: false, ui_changed: true, strings_changed: true, contract_changed: false, docs_only: false,
    ...flags,
  };
  fs.mkdirSync(path.join(sb.run, 'facts'), { recursive: true });
  fs.writeFileSync(path.join(sb.run, 'facts', `${name}.json`), JSON.stringify(f));
  return `${name}.json`;
}

function handoff(sb, name, status) {
  fs.writeFileSync(path.join(sb.run, `${name}.md`), `---\nstep: ${name.slice(0, 2)}\nrole: ${name.slice(3)}\nstatus: ${status}\n---\nBy: x\n`);
}

function written(sb, d) {
  const w = cli(sb, ['write', SLUG, draft(sb, d)]);
  assert.equal(w.code, 0, `write failed: ${w.out}${w.err}`);
}

function next(sb, n = 1) {
  const res = [];
  for (let i = 0; i < n; i++) {
    const r = cli(sb, ['next', SLUG]);
    assert.equal(r.code, 0, `next failed: ${r.out}${r.err}`);
    res.push(JSON.parse(r.out.trim().split('\n').pop()));
  }
  return res;
}

function ledger(sb) {
  const p = path.join(sb.run, 'route.jsonl');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}
const lines = (x) => (Array.isArray(x) ? x : String(x ?? '').split('\n')).filter(Boolean);

describe('route module surface', () => {
  test('exports lintRoute and lintData', async () => {
    const m = await import(pathToFileURL(ROUTE).href);
    assert.equal(typeof m.lintRoute, 'function');
    assert.equal(typeof m.lintData, 'function');
  });
});

describe('hostile drafts are refused and write nothing (AC8, AC9)', () => {
  const cases = {
    'unknown role': (d) => { d.steps[1] = step('no-such-role'); },
    '__proto__ role': (d) => { d.steps[1] = step('__proto__'); },
    'constructor role': (d) => { d.steps[1] = step('constructor'); },
    'path-like role': (d) => { d.steps[1] = step('../qa'); },
    'missing why': (d) => { d.steps[1] = { role: 'backend-engineer' }; },
    'empty why': (d) => { d.steps[1] = step('backend-engineer', ''); },
    'over-long why': (d) => { d.steps[1] = step('backend-engineer', 'x'.repeat(121)); },
    'control char in why': (d) => { d.steps[1] = step('backend-engineer', 'bad\u0007why'); },
    'newline in why': (d) => { d.steps[1] = step('backend-engineer', 'a\nb'); },
    'skip qa': (d) => { d.skips.push(step('qa', 'not needed')); },
    'skip security': (d) => { d.skips.push(step('security', 'not needed')); },
    'skip code-reviewer': (d) => { d.skips.push(step('code-reviewer', 'not needed')); },
    'skip architect': (d) => { d.skips.push(step('architect', 'not needed')); },
    'skip fresh-reviewer': (d) => { d.skips.push(step('fresh-reviewer', 'not needed')); },
    'skip pentester': (d) => { d.skips.push(step('pentester', 'not needed')); },
    'skip vuln-scanner': (d) => { d.skips.push(step('vuln-scanner', 'not needed')); },
    'bad playbook': (d) => { d.playbook = 'brainstorm'; },
  };
  for (const [label, mutate] of Object.entries(cases)) {
    test(`refuses: ${label}`, () => {
      const sb = sandbox(); seed(sb);
      const d = baseDraft(); mutate(d);
      const r = cli(sb, ['write', SLUG, draft(sb, d)]);
      assert.equal(r.code, 2, r.out + r.err);
      assert.match(r.out, /^refused: /m);
      assert.equal(ledger(sb), '');
    });
  }

  test('accepts a repeated Role (route contract: never a lint error)', () => {
    const sb = sandbox(); seed(sb);
    const d = baseDraft(); d.steps.push(step('backend-engineer'));
    const r = cli(sb, ['write', SLUG, draft(sb, d)]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.doesNotMatch(r.out + r.err, /duplicate/);
    assert.notEqual(ledger(sb), '');
  });

  test('refuses a draft with a __proto__ key and does not pollute', () => {
    const sb = sandbox(); seed(sb);
    const text = JSON.stringify(baseDraft()).replace('{', '{"__proto__":{"polluted":true},');
    const r = cli(sb, ['write', SLUG, draft(sb, text)]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.equal(ledger(sb), '');
  });

  test('refuses bad slugs and unreadable drafts', () => {
    const sb = sandbox(); seed(sb);
    for (const slug of ['../escape', 'P20261116.000003/../x', 'not a slug', '']) {
      const r = cli(sb, ['write', slug, draft(sb, baseDraft())]);
      assert.equal(r.code, 2, `${slug}: ${r.out}${r.err}`);
    }
    assert.equal(cli(sb, ['write', SLUG, path.join(sb.root, 'missing.json')]).code, 2);
    assert.equal(cli(sb, ['write', SLUG, draft(sb, '{not json')]).code, 2);
    assert.equal(ledger(sb), '');
  });

  test('a second route event is refused', () => {
    const sb = sandbox(); seed(sb);
    written(sb, baseDraft());
    const before = ledger(sb);
    const r = cli(sb, ['write', SLUG, draft(sb, baseDraft())]);
    assert.equal(r.code, 2);
    assert.equal(ledger(sb), before);
  });

  test('a clean draft is appended as one LF route line (AC8)', () => {
    const sb = sandbox(); seed(sb);
    written(sb, baseDraft({ skips: [step('localizer', 'no string change')] }));
    const l = lines(ledger(sb));
    assert.equal(l.length, 1);
    assert.ok(!ledger(sb).includes('\r'));
    const ev = JSON.parse(l[0]);
    assert.equal(ev.v, 1);
    assert.equal(ev.ev, 'route');
    assert.equal(ev.playbook, 'feature');
    assert.equal(ev.steps.length, 5);
    assert.equal(ev.skips[0].role, 'localizer');
  });
});

describe('Step budget lint (AC10)', () => {
  test('write refuses an over-budget draft naming Playbook, budget and count', () => {
    const sb = sandbox(); seed(sb, { budgets: { feature: 3, fix: 6 } });
    const r = cli(sb, ['write', SLUG, draft(sb, baseDraft())]);
    assert.equal(r.code, 2);
    assert.match(r.out, /feature over budget: budget 3, count 5/);
    assert.equal(ledger(sb), '');
  });

  test('check lints a draft file, prints the lines and exits 1', () => {
    const sb = sandbox(); seed(sb, { budgets: { feature: 3, fix: 6 } });
    const r = cli(sb, ['check', draft(sb, baseDraft())]);
    assert.equal(r.code, 1);
    assert.match(r.out, /ERROR route: feature over budget: budget 3, count 5/);
    assert.match(r.out, /1 error\(s\)/);
  });

  test('check lists every error, not just the first', () => {
    const sb = sandbox(); seed(sb, { budgets: { feature: 3, fix: 6 } });
    const d = baseDraft(); d.steps[1] = step('no-such-role'); d.skips.push(step('qa', 'x'));
    const r = cli(sb, ['check', draft(sb, d)]);
    assert.equal(r.code, 1);
    assert.match(r.out, /over budget/);
    assert.match(r.out, /unknown role no-such-role/);
    assert.match(r.out, /qa may not be skipped/);
    assert.match(r.out, /3 error\(s\)/);
  });

  test('a draft within budget passes check with exit 0', () => {
    const sb = sandbox(); seed(sb);
    const r = cli(sb, ['check', draft(sb, baseDraft())]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /0 error\(s\)/);
  });

  test('no budget for the Playbook is an error', () => {
    const sb = sandbox(); seed(sb, { budgets: { feature: 10 } });
    const r = cli(sb, ['check', draft(sb, baseDraft({ playbook: 'fix' }))]);
    assert.equal(r.code, 1);
    assert.match(r.out, /no budget for fix/);
  });

  test('tasks adds the plan task count and is refused over budget', () => {
    const sb = sandbox(); seed(sb, { budgets: { feature: 6, fix: 6 } });
    written(sb, baseDraft());
    const over = cli(sb, ['tasks', SLUG, '2']);
    assert.equal(over.code, 2);
    assert.match(over.out, /feature over budget: budget 6, count 7/);
    assert.ok(!ledger(sb).includes('"ev":"tasks"'));
    const ok = cli(sb, ['tasks', SLUG, '1']);
    assert.equal(ok.code, 0, ok.out);
    assert.ok(ledger(sb).includes('"ev":"tasks"'));
    assert.equal(cli(sb, ['tasks', SLUG, '1']).code, 2, 'tasks only once');
  });

  test('tasks refuses non-integers and out-of-range counts', () => {
    const sb = sandbox(); seed(sb);
    written(sb, baseDraft());
    for (const n of ['0', '201', '-1', '1.5', 'x', '1e2', '']) {
      assert.equal(cli(sb, ['tasks', SLUG, n]).code, 2, `n=${n}`);
    }
    assert.ok(!ledger(sb).includes('"ev":"tasks"'));
  });
});

describe('merge lint and merged pair count (AC11, AC17)', () => {
  const merged = (extra = {}) => baseDraft({
    size: 'S',
    steps: [step('product-manager'), step('backend-engineer'), { role: 'code-reviewer', merge: 'qa', why: 'S verify plus review' }],
    ...extra,
  });

  test('a merge on size S passes lint', () => {
    const sb = sandbox(); seed(sb);
    assert.equal(cli(sb, ['check', draft(sb, merged())]).code, 0);
  });

  for (const size of ['XS', 'M', 'L']) {
    test(`merge on size ${size} is an error`, () => {
      const sb = sandbox(); seed(sb);
      const r = cli(sb, ['check', draft(sb, merged({ size }))]);
      assert.equal(r.code, 1);
      assert.match(r.out, /ERROR route: merge needs size S/);
    });
  }

  test('merge must be code-reviewer with qa', () => {
    const sb = sandbox(); seed(sb);
    const wrongRole = merged(); wrongRole.steps[2] = { role: 'writer', merge: 'qa', why: 'x' };
    const wrongPeer = merged(); wrongPeer.steps[2] = { role: 'code-reviewer', merge: 'security', why: 'x' };
    const qaFirst = merged(); qaFirst.steps[2] = { role: 'qa', merge: 'code-reviewer', why: 'x' };
    for (const d of [wrongRole, wrongPeer, qaFirst]) {
      const r = cli(sb, ['check', draft(sb, d)]);
      assert.equal(r.code, 1, JSON.stringify(d.steps[2]));
      assert.match(r.out, /ERROR route: merge must be code-reviewer with qa/);
    }
  });

  test('a merged pair counts once toward the budget', () => {
    const sb = sandbox(); seed(sb, { budgets: { feature: 3, fix: 6 } });
    const d = baseDraft({ size: 'S', steps: [step('product-manager'), { role: 'code-reviewer', merge: 'qa', why: 'pair' }, step('security')] });
    written(sb, d);
    const r = cli(sb, ['tasks', SLUG, '1']);
    assert.equal(r.code, 2);
    assert.match(r.out, /budget 3, count 4/);
  });

  test('the same two Steps unmerged count twice', () => {
    const sb = sandbox(); seed(sb, { budgets: { feature: 3, fix: 6 } });
    const d = baseDraft({ size: 'S', steps: [step('product-manager'), step('qa'), step('code-reviewer'), step('security')] });
    const r = cli(sb, ['check', draft(sb, d)]);
    assert.equal(r.code, 1);
    assert.match(r.out, /budget 3, count 4/);
  });
});

describe('next: Role skips from facts (AC8, AC9)', () => {
  function routeWith(sb, roles) {
    written(sb, baseDraft({ steps: roles.map((r) => step(r)) }));
  }

  test('a Role with no when entry runs', () => {
    const sb = sandbox(); seed(sb);
    facts(sb, { ui_changed: false, strings_changed: false }, ['docs']);
    routeWith(sb, ['writer']);
    const [d] = next(sb);
    assert.equal(d.do, 'run');
    assert.equal(d.role, 'writer');
  });

  test('no facts file runs every Role', () => {
    const sb = sandbox(); seed(sb);
    routeWith(sb, ['accessibility-tester', 'localizer']);
    const out = next(sb, 2);
    assert.deepEqual(out.map((o) => o.do), ['run', 'run']);
  });

  test('a bad facts file runs the Role', () => {
    const sb = sandbox(); seed(sb);
    fs.mkdirSync(path.join(sb.run, 'facts'));
    fs.writeFileSync(path.join(sb.run, 'facts', '05-backend-engineer.json'), '{broken');
    routeWith(sb, ['accessibility-tester']);
    assert.equal(next(sb)[0].do, 'run');
  });

  test('facts with v other than 1 run the Role', () => {
    const sb = sandbox(); seed(sb);
    facts(sb, { v: 2, ui_changed: false }, ['docs']);
    routeWith(sb, ['accessibility-tester']);
    assert.equal(next(sb)[0].do, 'run');
  });

  test('ui_changed false skips the a11y Role and names condition and facts file', () => {
    const sb = sandbox(); seed(sb);
    const f = facts(sb, { ui_changed: false }, ['docs', 'test']);
    routeWith(sb, ['accessibility-tester']);
    const [d] = next(sb);
    assert.equal(d.do, 'skip');
    assert.match(d.why, /ui_changed/);
    assert.ok(d.why.includes(f.replace(/\.json$/, '')), d.why);
    assert.ok(lines(ledger(sb)).some((l) => l.includes('"ev":"step"') && l.includes('"do":"skip"')));
  });

  test('ui_changed true runs the a11y Role', () => {
    const sb = sandbox(); seed(sb);
    facts(sb, { ui_changed: true }, ['ui']);
    routeWith(sb, ['accessibility-tester']);
    assert.equal(next(sb)[0].do, 'run');
  });

  test('a path of kind unknown runs the Role even when the flag says false', () => {
    const sb = sandbox(); seed(sb);
    facts(sb, { ui_changed: false }, ['unknown']);
    routeWith(sb, ['accessibility-tester']);
    assert.equal(next(sb)[0].do, 'run');
  });

  test('languages: en skips the localizer', () => {
    const sb = sandbox(); seed(sb, { languages: 'en' });
    facts(sb, { strings_changed: true }, ['code']);
    routeWith(sb, ['localizer']);
    const [d] = next(sb);
    assert.equal(d.do, 'skip');
    assert.match(d.why, /languages/);
  });

  test('two languages and strings changed runs the localizer', () => {
    const sb = sandbox(); seed(sb, { languages: 'en, nl' });
    facts(sb, { strings_changed: true }, ['code']);
    routeWith(sb, ['localizer']);
    assert.equal(next(sb)[0].do, 'run');
  });

  test('two languages but no string change skips the localizer', () => {
    const sb = sandbox(); seed(sb, { languages: 'en, nl' });
    facts(sb, { strings_changed: false }, ['docs']);
    routeWith(sb, ['localizer']);
    assert.equal(next(sb)[0].do, 'skip');
  });

  test('an unreadable languages line runs the localizer', () => {
    const sb = sandbox(); seed(sb);
    fs.writeFileSync(path.join(sb.root, '.company', 'project.md'), '# Project\nno such line\n');
    facts(sb, { strings_changed: false }, ['docs']);
    routeWith(sb, ['localizer']);
    assert.equal(next(sb)[0].do, 'run');
  });

  test('the newest facts file wins', () => {
    const sb = sandbox(); seed(sb);
    facts(sb, { ui_changed: false }, ['docs'], '05-backend-engineer');
    facts(sb, { ui_changed: true }, ['ui'], '07-backend-engineer');
    routeWith(sb, ['accessibility-tester']);
    assert.equal(next(sb)[0].do, 'run');
  });

  test('qa and security run even when every flag is false', () => {
    const sb = sandbox(); seed(sb);
    facts(sb, { ui_changed: false, strings_changed: false, contract_changed: false, docs_only: true }, ['docs']);
    routeWith(sb, ['qa', 'security', 'architect']);
    assert.deepEqual(next(sb, 3).map((o) => o.do), ['run', 'run', 'run']);
  });

  test('every protected Role runs even when every flag is false', () => {
    const sb = sandbox(); seed(sb);
    facts(sb, { ui_changed: false, strings_changed: false }, ['docs']);
    routeWith(sb, PROTECTED);
    assert.deepEqual(next(sb, PROTECTED.length).map((o) => o.do), PROTECTED.map(() => 'run'));
  });

  test('every next appends exactly one step event and the list ends with do: end', () => {
    const sb = sandbox(); seed(sb);
    routeWith(sb, ['writer', 'qa']);
    next(sb, 2);
    const steps = lines(ledger(sb)).filter((l) => l.includes('"ev":"step"'));
    assert.equal(steps.length, 2);
    const last = cli(sb, ['next', SLUG]);
    assert.equal(last.code, 0);
    assert.deepEqual(JSON.parse(last.out.trim()), { do: 'end' });
  });
});

describe('next: merged pair decision (AC11, AC17)', () => {
  const pair = () => baseDraft({ size: 'S', steps: [{ role: 'code-reviewer', merge: 'qa', why: 'S verify plus review' }] });

  test('size S, no contract change, no needs-ceo: one run Step', () => {
    const sb = sandbox(); seed(sb);
    facts(sb, { contract_changed: false }, ['code']);
    handoff(sb, '01-product-manager', 'done');
    written(sb, pair());
    const out = next(sb);
    assert.equal(out[0].do, 'run');
    assert.equal(out[0].role, 'code-reviewer');
  });

  test('contract_changed true splits into qa then code-reviewer', () => {
    const sb = sandbox(); seed(sb);
    facts(sb, { contract_changed: true }, ['contract']);
    written(sb, pair());
    const [d] = next(sb);
    assert.equal(d.do, 'split');
    assert.match(d.why, /contract_changed/);
    assert.ok(JSON.stringify(d).includes('qa'));
  });

  test('missing facts split', () => {
    const sb = sandbox(); seed(sb);
    written(sb, pair());
    assert.equal(next(sb)[0].do, 'split');
  });

  test('a needs-ceo Handoff in the run splits', () => {
    const sb = sandbox(); seed(sb);
    facts(sb, { contract_changed: false }, ['code']);
    handoff(sb, '02-architect', 'needs-ceo');
    written(sb, pair());
    const [d] = next(sb);
    assert.equal(d.do, 'split');
    assert.match(d.why, /needs-ceo/);
  });

  describe('needs-ceo status read from a bounded frontmatter block', () => {
    const put = (sb, text) => fs.writeFileSync(path.join(sb.run, '02-architect.md'), text);
    const setup = (text) => {
      const sb = sandbox(); seed(sb);
      facts(sb, { contract_changed: false }, ['code']);
      put(sb, text);
      written(sb, pair());
      return next(sb)[0];
    };

    test('frontmatter over 2048 bytes with status after byte 2048 splits', () => {
      const pad = `note: ${'x'.repeat(2100)}\n`;
      const d = setup(`---\nstep: 02\n${pad}status: needs-ceo\n---\nBy: x\n`);
      assert.equal(d.do, 'split');
      assert.match(d.why, /frontmatter unreadable/);
    });

    test('a Handoff with no frontmatter splits', () => {
      const d = setup('By: x\nno frontmatter here\n');
      assert.equal(d.do, 'split');
      assert.match(d.why, /frontmatter unreadable/);
    });

    test('a Handoff with an unclosed --- splits', () => {
      const d = setup('---\nstep: 02\nstatus: done\nBy: x\n');
      assert.equal(d.do, 'split');
      assert.match(d.why, /frontmatter unreadable/);
    });

    test('a valid short Handoff still merges', () => {
      const d = setup('---\nstep: 02\nstatus: done\n---\nBy: x\n');
      assert.equal(d.do, 'run');
      assert.equal(d.role, 'code-reviewer');
    });
  });

  describe('only <NN>-<agents slug>.md files count as Handoffs', () => {
    const noFm = 'By: x\nno frontmatter here\n';
    const good = '---\nstep: 01\nstatus: done\n---\nBy: x\n';
    const merged = (files) => {
      const sb = sandbox(); seed(sb);
      facts(sb, { contract_changed: false }, ['code']);
      for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(sb.run, name), text);
      written(sb, pair());
      return next(sb)[0];
    };

    test('a real run folder (00-summary.md, 00-project.md, plan.md, spec.md, architect plan, findings) still merges', () => {
      const d = merged({
        '00-summary.md': noFm, '00-project.md': noFm, 'plan.md': noFm, 'spec.md': noFm,
        '03-architect-plan.md': noFm, '02-architect.findings.md': noFm, '01-product-manager.md': good,
      });
      assert.equal(d.do, 'run', JSON.stringify(d));
      assert.equal(d.role, 'code-reviewer');
    });

    test('00-summary.md alone does not split', () => {
      assert.equal(merged({ '00-summary.md': noFm }).do, 'run');
    });

    test('a name that is not an agents slug is ignored', () => {
      assert.equal(merged({ '04-ghost-role.md': noFm }).do, 'run');
    });

    test('NN of all zeros is ignored, even for an agents slug', () => {
      assert.equal(merged({ '00-qa.md': noFm, '000-qa.md': noFm }).do, 'run');
    });

    test('four digits or one digit is not a Handoff name', () => {
      assert.equal(merged({ '0001-qa.md': noFm, '1-qa.md': noFm }).do, 'run');
    });

    test('a directory named like a Handoff is not read', () => {
      const sb = sandbox(); seed(sb);
      facts(sb, { contract_changed: false }, ['code']);
      fs.mkdirSync(path.join(sb.run, '03-qa.md'));
      written(sb, pair());
      assert.equal(next(sb)[0].do, 'run');
    });

    test('a matching file with bad frontmatter splits, beside a no-frontmatter 00-summary.md', () => {
      const d = merged({ '00-summary.md': noFm, '03-qa.md': noFm });
      assert.equal(d.do, 'split');
      assert.match(d.why, /frontmatter unreadable/);
    });

    test('a 3-digit matching file with needs-ceo splits', () => {
      const d = merged({ '00-summary.md': noFm, '101-architect.md': '---\nstep: 101\nstatus: needs-ceo\n---\nBy: x\n' });
      assert.equal(d.do, 'split');
      assert.match(d.why, /needs-ceo/);
    });

    test('an architect-plan file claiming needs-ceo is not a Handoff', () => {
      const d = merged({ '03-architect-plan.md': '---\nstep: 03\nstatus: needs-ceo\n---\nBy: x\n' });
      assert.equal(d.do, 'run');
    });
  });

  test('a bad facts file splits', () => {
    const sb = sandbox(); seed(sb);
    fs.mkdirSync(path.join(sb.run, 'facts'));
    fs.writeFileSync(path.join(sb.run, 'facts', '05-backend-engineer.json'), '[]');
    written(sb, pair());
    assert.equal(next(sb)[0].do, 'split');
  });

  test('a size other than S never reaches a run: the draft is refused', () => {
    const sb = sandbox(); seed(sb);
    const d = pair(); d.size = 'M';
    assert.equal(cli(sb, ['write', SLUG, draft(sb, d)]).code, 2);
  });
});

describe('dry prints the decision per entry and writes nothing', () => {
  function tree(dir) {
    const out = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); out.push(p + (e.isFile() ? `:${fs.statSync(p).size}` : '')); if (e.isDirectory()) walk(p); } };
    walk(dir);
    return out.sort();
  }

  test('a refused dry (bad base) writes nothing', () => {
    const sb = sandbox(); seed(sb);
    const d = draft(sb, baseDraft());
    const snap = tree(sb.root);
    const r = cli(sb, ['dry', d, '--base', '--oops', '--head', 'HEAD']);
    assert.equal(r.code, 2, r.out + r.err);
    assert.deepEqual(tree(sb.root), snap);
  });

  test('dry without --head is refused and writes nothing', () => {
    const sb = sandbox(); seed(sb);
    const d = draft(sb, baseDraft());
    const snap = tree(sb.root);
    const r = cli(sb, ['dry', d, '--base', 'HEAD']);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out + r.err, /--head is required/);
    assert.deepEqual(tree(sb.root), snap);
  });

  test('dry on a docs-only commit range prints skips and writes nothing (AC8)', () => {
    const sb = sandbox(); seed(sb);
    const git = (...a) => spawnSync('git', a, {
      cwd: sb.root, encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(sb.home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    });
    assert.equal(git('init', '-q').status, 0);
    fs.writeFileSync(path.join(sb.root, 'README.md'), 'one\n');
    git('add', '-A'); assert.equal(git('commit', '-q', '-m', 'base').status, 0);
    const base = git('rev-parse', 'HEAD').stdout.trim();
    fs.writeFileSync(path.join(sb.root, 'README.md'), 'two\n');
    git('add', 'README.md'); assert.equal(git('commit', '-q', '-m', 'docs').status, 0);
    const d = draft(sb, baseDraft({ steps: [step('writer'), step('accessibility-tester'), step('qa')] }));
    const snap = tree(sb.root);
    const head = git('rev-parse', 'HEAD').stdout.trim();
    const r = cli(sb, ['dry', d, '--base', base, '--head', head]);
    assert.equal(r.code, 0, r.out + r.err);
    const rows = lines(r.out);
    assert.equal(rows.length, 3, r.out);
    assert.match(rows[0], /^0 writer run /);
    assert.match(rows[1], /^1 accessibility-tester skip .*ui_changed/);
    assert.match(rows[2], /^2 qa run /);
    assert.deepEqual(tree(sb.root).filter((p) => !p.includes(`${path.sep}.git${path.sep}`)), snap.filter((p) => !p.includes(`${path.sep}.git${path.sep}`)));
  });
});

describe('ledger limits and links (proj.M-SEC7)', () => {
  test('a route.jsonl over 64 KiB is refused and left unchanged', () => {
    const sb = sandbox(); seed(sb);
    written(sb, baseDraft());
    const p = path.join(sb.run, 'route.jsonl');
    fs.appendFileSync(p, `${JSON.stringify({ v: 1, ev: 'fix', role: 'qa', why: 'pad' })}\n`.repeat(2000));
    assert.ok(fs.statSync(p).size > 64 * 1024);
    const before = fs.readFileSync(p);
    for (const args of [['next', SLUG], ['fix', SLUG, 'qa', 'again'], ['tasks', SLUG, '1']]) {
      const r = cli(sb, args);
      assert.equal(r.code, 2, args.join(' ') + r.out + r.err);
    }
    assert.deepEqual(fs.readFileSync(p), before);
  });

  test('a line over 4096 bytes in the ledger is refused', () => {
    const sb = sandbox(); seed(sb);
    fs.writeFileSync(path.join(sb.run, 'route.jsonl'), `${JSON.stringify({ v: 1, ev: 'fix', role: 'qa', why: 'x'.repeat(5000) })}\n`);
    const r = cli(sb, ['next', SLUG]);
    assert.equal(r.code, 2, r.out + r.err);
  });

  test('a linked route.jsonl is refused and its target is not written', () => {
    const sb = sandbox(); seed(sb);
    const target = path.join(sb.root, 'elsewhere');
    fs.mkdirSync(target);
    linkTo(target, path.join(sb.run, 'route.jsonl'));
    const r = cli(sb, ['write', SLUG, draft(sb, baseDraft())]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.deepEqual(fs.readdirSync(target), []);
  });

  test('a run folder that is a link out of .company/work is refused', () => {
    const sb = sandbox(); seed(sb);
    fs.rmSync(sb.run, { recursive: true, force: true });
    const outside = path.join(sb.root, 'outside');
    fs.mkdirSync(outside);
    linkTo(outside, sb.run);
    const r = cli(sb, ['write', SLUG, draft(sb, baseDraft())]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.deepEqual(fs.readdirSync(outside), []);
  });

  test('fix appends a fix event and never counts toward the budget', () => {
    const sb = sandbox(); seed(sb, { budgets: { feature: 5, fix: 6 } });
    written(sb, baseDraft());
    assert.equal(cli(sb, ['fix', SLUG, 'backend-engineer', 'round 1 fixes']).code, 0);
    assert.ok(ledger(sb).includes('"ev":"fix"'));
    assert.equal(cli(sb, ['check', path.join(sb.run, 'route.jsonl')]).code, 0);
  });

  test('fix refuses an unknown role and a control-char reason', () => {
    const sb = sandbox(); seed(sb);
    written(sb, baseDraft());
    const before = ledger(sb);
    assert.equal(cli(sb, ['fix', SLUG, '__proto__', 'x']).code, 2);
    assert.equal(cli(sb, ['fix', SLUG, 'qa', 'bad\u0001reason']).code, 2);
    assert.equal(ledger(sb), before);
  });
});

describe('plugin data comes from the plugin root, never from cwd', () => {
  const nonQa = () => Array.from({ length: 5 }, () => step('qa'));

  test('a product folder with no company/ or agents/ routes: check, write, next, fix, tasks', () => {
    const sb = sandbox(); seed(sb);
    assert.equal(fs.existsSync(path.join(sb.root, 'company')), false);
    assert.equal(fs.existsSync(path.join(sb.root, 'agents')), false);
    const d = draft(sb, baseDraft());
    assert.equal(cli(sb, ['check', d]).code, 0);
    written(sb, baseDraft());
    assert.equal(next(sb)[0].do, 'run');
    assert.equal(cli(sb, ['fix', SLUG, 'qa', 'round 1']).code, 0);
    assert.equal(cli(sb, ['tasks', SLUG, '2']).code, 0);
  });

  test('the repo route.mjs routes in a product folder that holds no plugin data', () => {
    const sb = sandbox(); seed(sb);
    const d = draft(sb, baseDraft({ steps: [step('qa')] }));
    const r = spawnSync(process.execPath, [ROUTE, 'check', d], { cwd: sb.root, encoding: 'utf8', timeout: 20000 });
    assert.doesNotMatch(r.stdout, /model floor unreadable/);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test('a company/step-budgets.json in the product folder does not raise the budget', () => {
    const sb = sandbox(); seed(sb, { budgets: { feature: 3, fix: 3 } });
    fs.mkdirSync(path.join(sb.root, 'company'));
    fs.writeFileSync(path.join(sb.root, 'company', 'step-budgets.json'), JSON.stringify({ v: 1, budgets: { feature: 200, fix: 200 }, source: 'decoy' }));
    const r = cli(sb, ['write', SLUG, draft(sb, baseDraft())]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out, /over budget: budget 3/);
  });

  test('a company/role-when.json in the product folder does not remove a skip', () => {
    const sb = sandbox(); seed(sb);
    fs.mkdirSync(path.join(sb.root, 'company'));
    fs.writeFileSync(path.join(sb.root, 'company', 'role-when.json'), JSON.stringify({ v: 1, when: {} }));
    facts(sb, { ui_changed: false }, ['docs']);
    written(sb, baseDraft({ steps: [step('accessibility-tester', 'ui check'), step('qa')] }));
    assert.equal(next(sb)[0].do, 'skip');
  });

  test('an agents/ folder in the product folder does not make a slug known', () => {
    const sb = sandbox(); seed(sb);
    fs.mkdirSync(path.join(sb.root, 'agents'));
    fs.writeFileSync(path.join(sb.root, 'agents', 'ghost-role.md'), '---\nname: ghost-role\n---\n');
    const r = cli(sb, ['write', SLUG, draft(sb, baseDraft({ steps: [step('ghost-role'), step('qa')] }))]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.equal(ledger(sb), '');
  });

  test('a plugin root with no model-floor.json refuses "model floor unreadable" and writes nothing', () => {
    const sb = sandbox(); seed(sb);
    fs.rmSync(path.join(sb.plugin, 'company', 'model-floor.json'));
    const r = cli(sb, ['write', SLUG, draft(sb, baseDraft())]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out, /^refused: model floor unreadable$/m);
    assert.equal(ledger(sb), '');
  });

  test('main takes the plugin root as its third argument', async () => {
    const { main } = await import(pathToFileURL(ROUTE).href);
    const sb = sandbox(); seed(sb, { budgets: { feature: 3, fix: 3 } });
    const d = draft(sb, baseDraft());
    const r = await main(['check', d], sb.root, sb.plugin);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /over budget: budget 3/);
  });

  test('CLAUDE_PLUGIN_ROOT is not read: it cannot point route at another budget', () => {
    const sb = sandbox(); seed(sb, { budgets: { feature: 3, fix: 3 } });
    const other = sandbox(); seed(other, { budgets: { feature: 200, fix: 200 } });
    const d = draft(sb, baseDraft({ steps: nonQa() }));
    const r = spawnSync(process.execPath, [path.join(sb.plugin, 'scripts', 'route.mjs'), 'check', d], {
      cwd: sb.root, encoding: 'utf8', timeout: 20000, env: { ...process.env, CLAUDE_PLUGIN_ROOT: other.plugin },
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /over budget: budget 3/);
  });
});

describe('lintData: tracked data files (AC9)', () => {
  async function lint(sb) {
    const { lintData } = await import(pathToFileURL(ROUTE).href);
    return lines(lintData(sb.plugin, PROTECTED));
  }
  const putWhen = (sb, when) => fs.writeFileSync(path.join(sb.plugin, 'company', 'role-when.json'), JSON.stringify({ v: 1, when }));

  test('valid data gives no errors', async () => {
    const sb = sandbox(); seed(sb);
    assert.deepEqual(await lint(sb), []);
  });

  for (const role of ['qa', 'security', ...PROTECTED]) {
    test(`a when entry for ${role} is refused`, async () => {
      const sb = sandbox(); seed(sb);
      putWhen(sb, { ...WHEN, [role]: ['ui_changed'] });
      const out = await lint(sb);
      assert.ok(out.length > 0);
      assert.ok(out.some((l) => l.includes(role)), out.join('\n'));
    });
  }

  test('a when entry for a slug with no agents file is refused', async () => {
    const sb = sandbox(); seed(sb);
    putWhen(sb, { ...WHEN, 'ghost-role': ['ui_changed'] });
    assert.ok((await lint(sb)).some((l) => l.includes('ghost-role')));
  });

  test('hostile keys are refused', async () => {
    const sb = sandbox(); seed(sb);
    fs.writeFileSync(path.join(sb.plugin, 'company', 'role-when.json'), '{"v":1,"when":{"__proto__":["ui_changed"],"constructor":["ui_changed"]}}');
    assert.ok((await lint(sb)).length > 0);
  });

  test('an unknown condition is refused', async () => {
    const sb = sandbox(); seed(sb);
    putWhen(sb, { ...WHEN, writer: ['always'] });
    assert.ok((await lint(sb)).length > 0);
  });

  test('a bad budget is refused', async () => {
    for (const b of [0, 201, 1.5, '5', null]) {
      const sb = sandbox(); seed(sb, { budgets: { feature: b, fix: 6 } });
      assert.ok((await lint(sb)).length > 0, `budget ${JSON.stringify(b)}`);
    }
  });

  test('a data file over 16 KiB is refused', async () => {
    const sb = sandbox(); seed(sb);
    fs.writeFileSync(path.join(sb.plugin, 'company', 'step-budgets.json'), JSON.stringify({ v: 1, budgets: { feature: 5 }, source: 'x'.repeat(20000) }));
    assert.ok((await lint(sb)).length > 0);
  });

  test('a source line over 200 characters is refused', async () => {
    const sb = sandbox(); seed(sb);
    fs.writeFileSync(path.join(sb.plugin, 'company', 'step-budgets.json'), JSON.stringify({ v: 1, budgets: { feature: 5, fix: 5 }, source: 'x'.repeat(201) }));
    assert.ok((await lint(sb)).length > 0);
  });

  test('a linked data file is refused', async () => {
    const sb = sandbox(); seed(sb);
    const real = path.join(sb.plugin, 'real-when');
    fs.mkdirSync(real);
    fs.rmSync(path.join(sb.plugin, 'company', 'role-when.json'));
    linkTo(real, path.join(sb.plugin, 'company', 'role-when.json'));
    assert.ok((await lint(sb)).length > 0);
  });

  test('bad JSON and wrong v are refused', async () => {
    const sb = sandbox(); seed(sb);
    fs.writeFileSync(path.join(sb.plugin, 'company', 'role-when.json'), '{nope');
    assert.ok((await lint(sb)).length > 0);
    fs.writeFileSync(path.join(sb.plugin, 'company', 'role-when.json'), JSON.stringify({ v: 2, when: WHEN }));
    assert.ok((await lint(sb)).length > 0);
  });
});

describe('a data entry cannot make write skip a protected Role', () => {
  test('write refuses when role-when.json lists qa', () => {
    const sb = sandbox(); seed(sb, { when: { ...WHEN, qa: ['ui_changed'] } });
    facts(sb, { ui_changed: false }, ['docs']);
    const r = cli(sb, ['write', SLUG, draft(sb, baseDraft())]);
    if (r.code === 0) {
      const decisions = next(sb, 5);
      assert.ok(decisions.filter((d) => d.role === 'qa').every((d) => d.do === 'run'));
    } else {
      assert.equal(r.code, 2);
    }
  });
});

describe('route v1.0 golden fixtures (public interface only)', () => {
  const g = loadGolden('route');

  test('draft-ok passes check', () => {
    const sb = sandbox(); seed(sb);
    const r = cli(sb, ['check', draft(sb, g.text('draft-ok.json'))]);
    assert.equal(r.code, 0, r.out);
  });

  test('draft-over-budget prints the golden lines', () => {
    const sb = sandbox(); seed(sb, { budgets: { feature: 3, fix: 6 } });
    const r = cli(sb, ['check', draft(sb, g.text('draft-over-budget.json'))]);
    assert.equal(r.code, 1);
    assert.equal(r.out, g.text('expected-over-budget.txt'));
  });

  test('draft-skip-qa prints the golden lines', () => {
    const sb = sandbox(); seed(sb);
    const r = cli(sb, ['check', draft(sb, g.text('draft-skip-qa.json'))]);
    assert.equal(r.code, 1);
    assert.equal(r.out, g.text('expected-skip-qa.txt'));
  });
});

// route v2.0: security skippable below high on security_changed false; `owed` after a late raise.
describe('next and owed: conditional security (route v2.0)', () => {
  const SEC_WHEN = { ...WHEN, security: ['security_changed'] };
  const SEC_STEPS = [step('backend-engineer'), step('security', 'audit'), step('qa')];
  const secDraft = () => baseDraft({ steps: SEC_STEPS });
  // A real tier-path.jsonl record in the run folder, read by the copied tier-set.mjs.
  const REC = (o) => JSON.stringify({ v: 1, at: '2026-11-21T00:00:00Z', ...o });
  function setTier(sb, view) {
    fs.mkdirSync(sb.run, { recursive: true });
    const f = path.join(sb.run, 'tier-path.jsonl');
    if (view === null) { fs.rmSync(f, { force: true }); return; }
    const rows = [REC({ ev: 'begin', pb: 'feature', tier: 'medium', path: 'full', why: 'tier', rev: 3, base: BASE40, skip: ['senior-engineer-compliance'] })];
    if (view.tier === 'high') rows.push(REC({ ev: 'raise', tier: 'high', cause: 'diff' }));
    if (view.tier === 'low') rows[0] = REC({ ev: 'begin', pb: 'feature', tier: 'low', path: 'full', why: 'tier', rev: 3, base: BASE40, skip: [] });
    if (view.broken) rows.push('{nope');
    fs.writeFileSync(f, rows.join('\n') + '\n');
  }
  const tier = (t) => ({ v: 1, state: 'on', tier: t });
  // route v2.1 reads security facts only at the current HEAD: the product root is a real repo with one commit.
  const gitEnv = () => Object.fromEntries(Object.entries(process['env']).filter(([k]) => !/^GIT_/i.test(k)));
  const gitIn = (root, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: root, env: gitEnv(), encoding: 'utf8' });
  function gitRoot(sb) {
    assert.equal(gitIn(sb.root, 'init', '-q').status, 0);
    fs.writeFileSync(path.join(sb.root, 'f.txt'), 'x');
    assert.equal(gitIn(sb.root, 'add', 'f.txt').status, 0);
    assert.equal(gitIn(sb.root, 'commit', '-q', '-m', 'init').status, 0);
    sb.head = gitIn(sb.root, 'rev-parse', 'HEAD').stdout.trim();
    assert.match(sb.head, /^[0-9a-f]{40}$/);
  }
  function setup(t, flags = { security_changed: false }, kinds = ['code']) {
    const sb = sandbox(); seed(sb, { when: SEC_WHEN }); gitRoot(sb);
    if (t !== undefined && t !== 'none') setTier(sb, tier(t));
    if (flags !== null) facts(sb, flags, kinds);
    written(sb, secDraft());
    return sb;
  }
  const secDecision = (sb) => next(sb, 2)[1];

  test('medium with security_changed false skips security and says why', () => {
    const d = secDecision(setup('medium'));
    assert.equal(d.do, 'skip');
    assert.match(d.why, /security_changed false in facts 05-backend-engineer/);
  });
  test('low with security_changed false skips too', () => {
    assert.equal(secDecision(setup('low')).do, 'skip');
  });
  test('high runs security', () => {
    assert.equal(secDecision(setup('high')).do, 'run');
  });
  test('no tier record runs security', () => {
    assert.equal(secDecision(setup(undefined)).do, 'run');
    assert.equal(secDecision(setup('none')).do, 'run');
  });
  test('a broken tier record runs security', () => {
    const sb = setup('medium');
    setTier(sb, { broken: true, tier: 'medium' });
    assert.equal(secDecision(sb).do, 'run');
  });
  test('security_changed true, a missing key, missing facts and an unknown path run security', () => {
    assert.equal(secDecision(setup('medium', { security_changed: true })).do, 'run');
    assert.equal(secDecision(setup('medium', {})).do, 'run');
    assert.equal(secDecision(setup('medium', null)).do, 'run');
    assert.equal(secDecision(setup('medium', { security_changed: false }, ['unknown'])).do, 'run');
  });
  test('draft skips may still not list security', () => {
    const sb = sandbox(); seed(sb, { when: SEC_WHEN });
    const r = cli(sb, ['write', SLUG, draft(sb, baseDraft({ skips: [step('security', 'not needed')] }))]);
    assert.equal(r.code, 2);
    assert.match(r.out, /security may not be skipped/);
  });

  test('owed: none without a skip, and after a skip while still safe', () => {
    const sb = setup('medium');
    assert.equal(cli(sb, ['owed', SLUG]).out, 'owed: none\n');
    secDecision(sb);
    assert.equal(cli(sb, ['owed', SLUG]).out, 'owed: none\n');
  });
  test('owed: security after a skip then a raise to high; a fix event clears it', () => {
    const sb = setup('medium');
    secDecision(sb);
    setTier(sb, tier('high'));
    const o = cli(sb, ['owed', SLUG]);
    assert.equal(o.code, 0);
    assert.equal(o.out, 'owed: security\n');
    assert.equal(cli(sb, ['fix', SLUG, 'security', 'ran late']).code, 0);
    assert.equal(cli(sb, ['owed', SLUG]).out, 'owed: none\n');
  });
  test('owed: security after a later facts file with security_changed true', () => {
    const sb = setup('medium');
    secDecision(sb);
    facts(sb, { security_changed: true }, ['code'], '09-backend-engineer');
    assert.equal(cli(sb, ['owed', SLUG]).out, 'owed: security\n');
  });
  test('owed fails closed on an unreadable tier after a skip', () => {
    const sb = setup('medium');
    secDecision(sb);
    setTier(sb, { broken: true, tier: 'medium' });
    assert.equal(cli(sb, ['owed', SLUG]).out, 'owed: security\n');
  });
  test('facts at an old HEAD run security; a new commit makes a skip owed (route v2.1)', () => {
    const stale = setup('medium', null);
    stale.head = 'c'.repeat(40);
    facts(stale, { security_changed: false });
    assert.equal(secDecision(stale).do, 'run');
    const ok = setup('medium');
    secDecision(ok);
    assert.equal(cli(ok, ['owed', SLUG]).out, 'owed: none\n');
    fs.writeFileSync(path.join(ok.root, 'f.txt'), 'y');
    assert.equal(gitIn(ok.root, 'commit', '-qam', 'more').status, 0);
    assert.equal(cli(ok, ['owed', SLUG]).out, 'owed: security\n');
  });
  test('facts against another base run security (route v2.1)', () => {
    const sb = setup('medium', null);
    facts(sb, { security_changed: false, base: 'd'.repeat(40) });
    assert.equal(secDecision(sb).do, 'run');
  });
  test('owed: none for a run with no route record (route v2.1)', () => {
    const sb = sandbox(); seed(sb, { when: SEC_WHEN });
    assert.equal(cli(sb, ['owed', SLUG]).out, 'owed: none\n');
  });
  test('owed writes nothing and needs a route and a slug', () => {
    const sb = setup('medium');
    const before = ledger(sb);
    cli(sb, ['owed', SLUG]);
    assert.equal(ledger(sb), before);
    assert.equal(cli(sb, ['owed']).code, 2);
  });
});

describe('lintData: the one protected when entry (route v2.0)', () => {
  const putWhen = (sb, when) => fs.writeFileSync(path.join(sb.plugin, 'company', 'role-when.json'), JSON.stringify({ v: 1, when }));
  async function lint(sb) {
    const { lintData } = await import(pathToFileURL(ROUTE).href);
    return lines(lintData(sb.plugin, PROTECTED));
  }
  test('security with ["security_changed"] is accepted', async () => {
    const sb = sandbox(); seed(sb, { when: { ...WHEN, security: ['security_changed'] } });
    assert.deepEqual(await lint(sb), []);
  });
  for (const [name, when] of [
    ['security with another condition', { security: ['ui_changed'] }],
    ['security with two conditions', { security: ['security_changed', 'ui_changed'] }],
    ['architect on security_changed', { architect: ['security_changed'] }],
    ['code-reviewer on security_changed', { 'code-reviewer': ['security_changed'] }],
    ['a plain Role on security_changed', { writer: ['security_changed'] }],
  ]) {
    test(`${name} is refused`, async () => {
      const sb = sandbox(); seed(sb, { when: { ...WHEN, ...when } });
      assert.ok((await lint(sb)).length > 0);
    });
  }
  test('the shipped role-when.json lints clean against the shipped data', async () => {
    const { lintData } = await import(pathToFileURL(ROUTE).href);
    const prot = JSON.parse(fs.readFileSync(path.join(REPO, 'company', 'model-floor.json'), 'utf8')).protected;
    assert.deepEqual(lintData(REPO, prot), []);
  });
});
