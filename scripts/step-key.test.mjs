// step-key v1.0: key table replay, hit and reuse, misses, uncacheable Steps, verify and purge, cold, secrets, hostile paths.
import { test, describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadGolden } from './contract-fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STEPKEY = path.join(HERE, 'step-key.mjs');
const LINT = path.join(HERE, 'handoff-lint.mjs');
const SLUG = 'P20261116.000003/01-feature';
const RUN_REL = '.company/work/P20261116.000003/01-feature';
const BASE40 = 'a'.repeat(40);
const SECRET = 'hunter2-s3cr3t-value-9f8e7d';
const SALT_TEXT = 'saltmarker!'.padEnd(32, '#');
const TIMEOUT = 30000;

const sandboxes = [];
after(() => { for (const r of sandboxes) fs.rmSync(r, { recursive: true, force: true }); });

function cleanEnv(sb, extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith('AICO_') || k.startsWith('GIT_') || ['NODE_OPTIONS', 'NODE_ENV', 'CLAUDE_PLUGIN_ROOT'].includes(k)) delete env[k];
  }
  Object.assign(env, {
    HOME: sb.home, USERPROFILE: sb.home, MCSPARROW_HOME: path.join(sb.home, '.mcsparrow'),
    GIT_CONFIG_GLOBAL: sb.gitconfig, GIT_CONFIG_NOSYSTEM: '1', AICO_COLD: '',
  }, extra);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return env;
}

function git(sb, args) {
  const r = spawnSync('git', args, { cwd: sb.root, encoding: 'utf8', env: cleanEnv(sb), timeout: TIMEOUT });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function sandbox({ commit = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'step-key-test-'));
  sandboxes.push(root);
  const home = path.join(root, '.home');
  fs.mkdirSync(home);
  const gitconfig = path.join(home, 'gitconfig');
  fs.writeFileSync(gitconfig, '[user]\n\tname = t\n\temail = t@example.invalid\n[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n');
  const sb = { root, home, gitconfig, run: path.join(root, ...RUN_REL.split('/')) };
  git(sb, ['init', '-q']);
  fs.appendFileSync(path.join(root, '.git', 'info', 'exclude'), '.company/\n.home/\nprompt*.txt\n');
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'src', 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(root, 'src', 'b.txt'), 'b\n');
  fs.writeFileSync(path.join(root, 'docs', 'in.md'), '# input\n');
  fs.mkdirSync(sb.run, { recursive: true });
  fs.writeFileSync(path.join(root, '.company', 'project.md'), '# Project\n');
  if (commit) {
    git(sb, ['add', '-A']);
    git(sb, ['commit', '-q', '-m', 'init']);
  }
  return sb;
}

function sk(sb, args, { env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [STEPKEY, ...args], {
    cwd: sb.root, encoding: 'utf8', timeout: TIMEOUT, input, env: cleanEnv(sb, env),
  });
  return { code: r.status, out: (r.stdout || '').trim(), err: r.stderr || '', raw: r.stdout || '' };
}

const prompt = (round, output = '12-qa.md', goal = 'Do the thing.') =>
  `Role: qa\nRound: ${round}\nOutput: ${RUN_REL}/${output}\nGoal: ${goal}\nFiles: src/a.txt\nInput Handoffs: docs/in.md\n`;

// A `before` call; `omit` drops --dispatch or --model; `extra` appends raw arguments.
function before(sb, { nn = '05-qa', round = 0, dispatch, model = 'sonnet', files = 'src/a.txt', inputs = ['docs/in.md'],
  task, extra = [], env, omit = [] } = {}) {
  const text = dispatch ?? prompt(round, `${nn}.md`);
  const args = ['before', SLUG, nn, '--round', String(round)];
  if (!omit.includes('dispatch')) args.push('--dispatch', '-');
  if (!omit.includes('model')) args.push('--model', model);
  if (task) args.push('--task', task);
  for (const i of inputs) args.push('--input', i);
  if (files !== null) args.push('--files', files);
  args.push(...extra);
  return sk(sb, args, { env, input: text });
}

function handoffText({ nn, role = 'qa', status = 'done', round = 0, blocking = ['- none'], files = ['src/a.txt'], did = ['- Wrote tests.'], topStatus } = {}) {
  return [
    '---',
    `step: ${nn.slice(0, 2)}`,
    `role: ${role}`,
    `task: ${SLUG}`,
    `status: ${status}`,
    `round: ${round}`,
    `base-commit: ${BASE40}`,
    'risk-tier: high',
    'acceptance-ids: [AC12]',
    `files-touched: [${files.join(', ')}]`,
    'contracts: [handoff v2.8]',
    '---',
    `By: ${role}`,
    '```aico-top',
    `status: ${topStatus ?? status}`,
    `files: [${files.join(', ')}]`,
    'ac_ids: [AC12]',
    'rule_ids: [proj.M4]',
    'risks: []',
    'read_next: []',
    'tokens_used: unknown',
    '```',
    '## Did',
    ...did,
    '## Decisions',
    '- None.',
    '## Blocking',
    ...blocking,
    '## Nits',
    '- none',
    '## Next',
    '- lead: continue.',
    '',
  ].join('\n');
}

function writeHandoff(sb, nn, opts = {}) {
  const role = nn.replace(/^\d+-/, '');
  const file = path.join(sb.run, `${nn}.md`);
  fs.writeFileSync(file, handoffText({ nn, role, ...opts }));
  return file;
}

function after1(sb, nn, env) { return sk(sb, ['after', SLUG, nn], { env }); }

function rows(sb, result) {
  const p = path.join(sb.run, 'step-keys.jsonl');
  if (!fs.existsSync(p)) return [];
  const all = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  return result ? all.filter(r => r.result === result) : all;
}

function logText(sb) {
  const p = path.join(sb.run, 'step-keys.jsonl');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

// Round 0 Step 05-qa dispatched, done, Blocking none: a live entry.
function makeEntry(sb, opts = {}, handoff = {}) {
  const nn = opts.nn ?? '05-qa';
  const b = before(sb, { round: 0, ...opts, nn });
  assert.equal(b.code, 0, b.out + b.err);
  assert.match(b.out, /^miss\b/, 'round 0 never hits');
  const file = writeHandoff(sb, nn, handoff);
  const a = after1(sb, nn, opts.env);
  assert.equal(a.code, 0, a.out + a.err);
  return { file, after: a };
}

const hit = (sb, o = {}) => before(sb, { nn: '12-qa', round: 1, dispatch: prompt(1, '12-qa.md'), ...o });
const OUT_REL = `${RUN_REL}/12-qa.md`;

function lintOk(sb, rel) {
  const r = spawnSync(process.execPath, [LINT, rel], { cwd: sb.root, encoding: 'utf8', env: cleanEnv(sb), timeout: TIMEOUT });
  return { code: r.status, text: (r.stdout || '') + (r.stderr || '') };
}

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

describe('harness', () => {
  it('builds a Handoff that handoff-lint accepts', () => {
    const sb = sandbox();
    writeHandoff(sb, '05-qa');
    const r = lintOk(sb, `${RUN_REL}/05-qa.md`);
    assert.equal(r.code, 0, r.text);
  });
});

describe('key table replay (AC12)', () => {
  const g = loadGolden('step-key');
  const table = g.json('key-table.json');
  let mod;
  const load = async () => (mod ??= await import(pathToFileURL(STEPKEY).href));

  it('fixtures are stamped with the Contract version', () => {
    assert.equal(g.version, '1.0');
    assert.deepEqual(table.columns, ['v', 'step', 'dispatch', 'model', 'inputs', 'node', 'os', 'lock', 'check', 'env']);
  });

  it('exports columns and compare', async () => {
    const m = await load();
    assert.equal(typeof m.columns, 'function');
    assert.equal(typeof m.compare, 'function');
  });

  for (const row of table.rows) {
    it(`${row.name}: ${row.expect}`, async () => {
      const { compare } = await load();
      const changed = { ...table.base, ...row.change };
      const want = row.expect === 'hit' ? null : row.expect.replace(/^miss /, '');
      assert.equal(compare(table.base, changed), want);
      assert.equal(compare(changed, table.base), want);
    });
  }

  it('a malformed column set is never reported equal', async () => {
    const { compare } = await load();
    for (const bad of [null, undefined, 'x', 7, [], {}]) {
      let r;
      try { r = compare(table.base, bad); } catch { r = 'threw'; }
      assert.notEqual(r, null, `compare(base, ${JSON.stringify(bad)}) must not equal`);
    }
  });
});

describe('hit and reuse (AC12)', () => {
  it('round 1 with the same key as a done Blocking-none round-0 entry hits', () => {
    const sb = sandbox();
    makeEntry(sb);
    const h = hit(sb);
    assert.equal(h.code, 0, h.out + h.err);
    assert.equal(h.out, 'hit 05-qa');
    const last = rows(sb).at(-1);
    assert.equal(last.result, 'hit');
    assert.equal(last.round, 1);
    assert.match(last.key, /^[0-9a-f]{64}$/);
  });

  it('a later round (2) hits the same entry', () => {
    const sb = sandbox();
    makeEntry(sb);
    const h = before(sb, { nn: '14-qa', round: 2, dispatch: prompt(2, '14-qa.md') });
    assert.equal(h.out, 'hit 05-qa');
  });

  it('a prompt that differs only in Round: and Output: lines still hits', () => {
    const sb = sandbox();
    makeEntry(sb);
    const p = prompt(1, 'zz-other-output.md').replace('Round: 1', 'Round: 7');
    assert.equal(hit(sb, { dispatch: p }).out, 'hit 05-qa');
  });

  it('CRLF line ends and trailing spaces do not change the key', () => {
    const sb = sandbox();
    makeEntry(sb);
    const p = prompt(1).split('\n').map(l => (l ? `${l}   ` : l)).join('\r\n');
    assert.equal(hit(sb, { dispatch: p }).out, 'hit 05-qa');
  });

  it('the prompt from a file path gives the key the stdin prompt gives', () => {
    const sb = sandbox();
    makeEntry(sb);
    fs.writeFileSync(path.join(sb.root, 'prompt-1.txt'), prompt(1));
    const args = ['before', SLUG, '12-qa', '--round', '1', '--dispatch', 'prompt-1.txt', '--model', 'sonnet',
      '--input', 'docs/in.md', '--files', 'src/a.txt'];
    assert.equal(sk(sb, args).out, 'hit 05-qa');
  });

  it('a change outside --files does not break the hit; a change inside it does', () => {
    const sb = sandbox();
    makeEntry(sb);
    fs.writeFileSync(path.join(sb.root, 'src', 'b.txt'), 'changed\n');
    fs.writeFileSync(path.join(sb.root, 'stray.txt'), 'new\n');
    assert.equal(hit(sb).out, 'hit 05-qa');
    fs.writeFileSync(path.join(sb.root, 'src', 'a.txt'), 'changed\n');
    assert.match(hit(sb).out, /^miss inputs\b/);
  });

  it('reuse writes the copy with the new step and round and the Reused bullet; it lints and is no entry', () => {
    const sb = sandbox();
    const { file } = makeEntry(sb);
    assert.equal(hit(sb).out, 'hit 05-qa');
    const r = sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(r.out, `reused ${RUN_REL}/05-qa.md`);
    const copy = fs.readFileSync(path.join(sb.run, '12-qa.md'), 'utf8');
    const src = fs.readFileSync(file, 'utf8');
    assert.match(copy, /^step: 12$/m);
    assert.match(copy, /^round: 1$/m);
    assert.doesNotMatch(copy, /^step: 05$/m);
    const key16 = rows(sb, 'hit').at(-1).key.slice(0, 16);
    const did = copy.split('\n');
    const bullet = did[did.indexOf('## Did') + 1];
    assert.equal(bullet, `- Reused ${RUN_REL}/05-qa.md (stepKey ${key16}); no Step ran.`);
    assert.ok(copy.includes('- Wrote tests.'), 'the source Did bullets stay');
    assert.equal(src.includes('Reused'), false);
    assert.equal(fs.readFileSync(file, 'utf8'), src, 'the source is untouched');
    const lint = lintOk(sb, OUT_REL);
    assert.equal(lint.code, 0, lint.text);
    assert.equal(rows(sb, 'reused').length, 1);
    assert.equal(rows(sb).filter(x => x.result === 'outcome').length, 1, 'a reuse creates no entry');
    assert.equal(copy.includes('\r'), false);
  });

  it('after a reused Step writes nothing and prints none', () => {
    const sb = sandbox();
    makeEntry(sb);
    hit(sb);
    sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL]);
    const n = rows(sb).length;
    const a = after1(sb, '12-qa');
    assert.equal(a.code, 0, a.out + a.err);
    assert.equal(a.out, 'none');
    assert.equal(rows(sb).length, n);
  });

  it('a Step with a different ticket has no entry to hit', () => {
    const sb = sandbox();
    makeEntry(sb, { task: 'P20261116.000003-T3' });
    const h = hit(sb, { task: 'P20261116.000003-T4' });
    assert.match(h.out, /^miss first\b/);
  });

  it('a hit needs the same ticket as the entry', () => {
    const sb = sandbox();
    makeEntry(sb, { task: 'P20261116.000003-T3' });
    assert.equal(hit(sb, { task: 'P20261116.000003-T3' }).out, 'hit 05-qa');
  });

  it('stats counts reused Steps and writes nothing', () => {
    const sb = sandbox();
    makeEntry(sb);
    hit(sb);
    sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL]);
    const before1 = logText(sb);
    const files1 = fs.readdirSync(sb.run).sort();
    const s = sk(sb, ['stats', SLUG]);
    assert.equal(s.code, 0, s.out + s.err);
    assert.match(s.out, /reused\D{0,6}1\b/);
    assert.equal(logText(sb), before1);
    assert.deepEqual(fs.readdirSync(sb.run).sort(), files1);
  });
});

describe('misses (AC12)', () => {
  it('round 0 never hits, even with a live entry', () => {
    const sb = sandbox();
    makeEntry(sb);
    const b = before(sb, { nn: '06-qa', round: 0 });
    assert.match(b.out, /^miss round0\b/);
  });

  it('no earlier entry: first', () => {
    const sb = sandbox();
    assert.match(hit(sb).out, /^miss first\b/);
  });

  it('a purged key misses with purged', () => {
    const sb = sandbox();
    makeEntry(sb);
    const v = before(sb, { nn: '20-qa', round: 1, dispatch: prompt(1, '20-qa.md'), extra: ['--verify'] });
    assert.equal(v.out, 'verify');
    writeHandoff(sb, '20-qa', { blocking: ['- [test] a red test.'] });
    assert.equal(after1(sb, '20-qa').out, 'disagree');
    assert.match(hit(sb).out, /^miss purged\b/);
  });

  it('an edited source Handoff misses with handoff-changed', () => {
    const sb = sandbox();
    const { file } = makeEntry(sb);
    fs.appendFileSync(file, '- extra\n');
    assert.match(hit(sb).out, /^miss handoff-changed\b/);
  });

  it('a deleted source Handoff misses with handoff-changed', () => {
    const sb = sandbox();
    const { file } = makeEntry(sb);
    fs.rmSync(file);
    assert.match(hit(sb).out, /^miss handoff-changed\b/);
  });

  for (const [label, opts] of [
    ['status blocked', { status: 'blocked' }],
    ['status needs-ceo', { status: 'needs-ceo' }],
    ['status handover', { status: 'handover' }],
    ['a tagged [test] Blocking item', { blocking: ['- [test] red.'] }],
    ['a tagged [security] Blocking item', { blocking: ['- [security] hole.'] }],
    ['frontmatter blocked while the aico-top block says done', { status: 'blocked', topStatus: 'done' }],
    ['Blocking none plus a tagged item', { blocking: ['- none', '- [spec] gap.'] }],
  ]) {
    it(`a source with ${label} is no entry`, () => {
      const sb = sandbox();
      makeEntry(sb, {}, opts);
      assert.equal(rows(sb, 'outcome').filter(r => r.hsha).length, 0, 'no entry row');
      const h = hit(sb);
      assert.match(h.out, /^miss\b/);
      assert.doesNotMatch(h.out, /^hit/);
    });
  }

  it('a missing Handoff after a Step gives no entry and never hits', () => {
    const sb = sandbox();
    before(sb, { round: 0 });
    const a = after1(sb, '05-qa');
    assert.equal(a.code, 0, a.out + a.err);
    assert.match(hit(sb).out, /^miss\b/);
  });

  describe('each column changed alone', () => {
    const cases = [
      ['dispatch (Goal)', 'dispatch', sb => hit(sb, { dispatch: prompt(1, '12-qa.md', 'Another goal.') })],
      ['dispatch (Round: mid-line is not stripped)', 'dispatch', sb => hit(sb, { dispatch: prompt(1).replace('Goal: Do the thing.', 'Goal: Do the thing. Round: 2') })],
      ['dispatch (indented Round: is not stripped)', 'dispatch', sb => hit(sb, { dispatch: `${prompt(1)} Round: 1\n` })],
      ['dispatch (Files line)', 'dispatch', sb => hit(sb, { dispatch: prompt(1).replace('Files: src/a.txt', 'Files: src/a.txt, src/b.txt') })],
      ['model', 'model', sb => hit(sb, { model: 'opus' })],
      ['inputs (content)', 'inputs', sb => { fs.writeFileSync(path.join(sb.root, 'docs', 'in.md'), '# changed\n'); return hit(sb); }],
      ['inputs (an added input)', 'inputs', sb => hit(sb, { inputs: ['docs/in.md', 'src/b.txt'] })],
      ['inputs (a declared file now missing)', 'inputs', sb => { fs.rmSync(path.join(sb.root, 'docs', 'in.md')); return hit(sb); }],
      ['inputs (project.md edited)', 'inputs', sb => { fs.appendFileSync(path.join(sb.root, '.company', 'project.md'), 'x\n'); return hit(sb); }],
      ['lock', 'lock', sb => { fs.writeFileSync(path.join(sb.root, 'package-lock.json'), '{"lockfileVersion":3,"x":1}\n'); git(sb, ['add', 'package-lock.json']); return hit(sb); }],
      ['env (an AICO_ value)', 'env', sb => hit(sb, { env: { AICO_FLAG: 'two' } })],
      ['env (NODE_ENV)', 'env', sb => hit(sb, { env: { NODE_ENV: 'production' } })],
      ['env (NODE_OPTIONS)', 'env', sb => hit(sb, { env: { NODE_OPTIONS: '--no-warnings' } })],
      ['env (CLAUDE_PLUGIN_ROOT)', 'env', sb => hit(sb, { env: { CLAUDE_PLUGIN_ROOT: path.resolve(HERE, '..') } })],
    ];
    for (const [label, column, change] of cases) {
      it(`${label} misses with ${column}`, () => {
        const sb = sandbox();
        if (column === 'lock') {
          fs.writeFileSync(path.join(sb.root, 'package-lock.json'), '{"lockfileVersion":3}\n');
          git(sb, ['add', 'package-lock.json']);
        }
        makeEntry(sb, { env: column === 'env' ? { AICO_FLAG: 'one' } : undefined });
        assert.equal(hit(sb, { env: column === 'env' ? { AICO_FLAG: 'one' } : undefined }).out, 'hit 05-qa', 'baseline hits');
        const r = change(sb);
        assert.equal(r.code, 0, r.out + r.err);
        assert.match(r.out, new RegExp(`^miss ${column}\\b`));
      });
    }

    it('an edited untracked .company input misses with inputs', () => {
      const sb = sandbox();
      const input = path.join(sb.run, '03-product-manager.md');
      fs.writeFileSync(input, 'brief v1\n');
      const rel = `${RUN_REL}/03-product-manager.md`;
      makeEntry(sb, { inputs: ['docs/in.md', rel] });
      assert.equal(hit(sb, { inputs: ['docs/in.md', rel] }).out, 'hit 05-qa');
      fs.writeFileSync(input, 'brief v2\n');
      assert.match(hit(sb, { inputs: ['docs/in.md', rel] }).out, /^miss inputs\b/);
    });

    it('an env var that is not in the key table does not change the key', () => {
      const sb = sandbox();
      makeEntry(sb);
      assert.equal(hit(sb, { env: { FOO_BAR: 'x', PATH_EXTRA: 'y' } }).out, 'hit 05-qa');
    });

    it('a new env name misses with env', () => {
      const sb = sandbox();
      makeEntry(sb);
      assert.match(hit(sb, { env: { AICO_NEWFLAG: '1' } }).out, /^miss env\b/);
    });

    it('AICO_COLD is not in the env column', () => {
      const sb = sandbox();
      makeEntry(sb);
      assert.equal(hit(sb, { env: { AICO_COLD: '0' } }).out, 'hit 05-qa');
    });
  });

  describe('--files none is the whole-tree key', () => {
    it('any tracked change misses with inputs', () => {
      const sb = sandbox();
      makeEntry(sb, { files: 'none' });
      assert.equal(hit(sb, { files: 'none' }).out, 'hit 05-qa');
      fs.writeFileSync(path.join(sb.root, 'src', 'b.txt'), 'changed\n');
      assert.match(hit(sb, { files: 'none' }).out, /^miss inputs\b/);
    });

    it('an untracked file misses with inputs', () => {
      const sb = sandbox();
      makeEntry(sb, { files: 'none' });
      fs.writeFileSync(path.join(sb.root, 'new-file.txt'), 'n\n');
      assert.match(hit(sb, { files: 'none' }).out, /^miss inputs\b/);
    });

    it('a new commit misses with inputs', () => {
      const sb = sandbox();
      makeEntry(sb, { files: 'none' });
      fs.writeFileSync(path.join(sb.root, 'src', 'b.txt'), 'changed\n');
      git(sb, ['commit', '-q', '-am', 'change']);
      assert.match(hit(sb, { files: 'none' }).out, /^miss inputs\b/);
    });

    it('no --files at all is the same whole-tree key', () => {
      const sb = sandbox();
      makeEntry(sb, { files: null });
      fs.writeFileSync(path.join(sb.root, 'new-file.txt'), 'n\n');
      assert.match(hit(sb, { files: null }).out, /^miss inputs\b/);
    });

    it('a --files key and a whole-tree key differ', () => {
      const sb = sandbox();
      makeEntry(sb, { files: 'src/a.txt' });
      assert.match(hit(sb, { files: 'none' }).out, /^miss inputs\b/);
    });
  });

  describe('errors are misses with exit 0 (never a hit, never a stop)', () => {
    const entryThen = (mutate, args = {}) => {
      const sb = sandbox();
      makeEntry(sb);
      mutate(sb);
      return { sb, r: hit(sb, args) };
    };
    const logPath = sb => path.join(sb.run, 'step-keys.jsonl');
    const saltPath = sb => path.join(sb.run, 'step-keys.salt');

    it('error:log when the log is a directory', () => {
      const { r } = entryThen(sb => { fs.rmSync(logPath(sb)); fs.mkdirSync(logPath(sb)); });
      assert.equal(r.code, 0, r.out + r.err);
      assert.equal(r.out, 'miss error:log');
    });

    it('error:log when the log is a link', () => {
      const { sb, r } = entryThen(sb2 => {
        const target = path.join(sb2.root, 'elsewhere');
        fs.mkdirSync(target);
        fs.rmSync(logPath(sb2));
        fs.symlinkSync(target, logPath(sb2), 'junction');
      });
      assert.equal(r.code, 0, r.out + r.err);
      assert.equal(r.out, 'miss error:log');
      assert.deepEqual(fs.readdirSync(path.join(sb.root, 'elsewhere')), []);
    });

    it('error:parse when the log holds a broken line', () => {
      const { r } = entryThen(sb => fs.appendFileSync(logPath(sb), '{not json\n'));
      assert.equal(r.code, 0, r.out + r.err);
      assert.equal(r.out, 'miss error:parse');
    });

    it('error:parse when a log line is not an object', () => {
      const { r } = entryThen(sb => fs.appendFileSync(logPath(sb), '[1,2]\n'));
      assert.equal(r.code, 0, r.out + r.err);
      assert.equal(r.out, 'miss error:parse');
    });

    it('error:limit when the log is over 256 KiB', () => {
      const { r } = entryThen(sb => {
        const line = `${JSON.stringify({ v: 1, at: '2026-11-16T00:00:00.000Z', step: '01-x', id: 'x', round: 0, result: 'miss', reason: 'first' })}\n`;
        fs.appendFileSync(logPath(sb), line.repeat(Math.ceil(300 * 1024 / line.length)));
      });
      assert.equal(r.code, 0, r.out + r.err);
      assert.equal(r.out, 'miss error:limit');
    });

    it('error:limit when a log line is over 1024 bytes', () => {
      const { r } = entryThen(sb => fs.appendFileSync(logPath(sb), `${JSON.stringify({ v: 1, result: 'miss', reason: 'x'.repeat(2000) })}\n`));
      assert.equal(r.code, 0, r.out + r.err);
      assert.match(r.out, /^miss error:(limit|parse)$/);
    });

    it('error:salt when the salt is a directory', () => {
      const { r } = entryThen(sb => { fs.rmSync(saltPath(sb), { force: true }); fs.mkdirSync(saltPath(sb)); });
      assert.equal(r.code, 0, r.out + r.err);
      assert.equal(r.out, 'miss error:salt');
    });

    it('error:salt when the salt is a link', () => {
      const { sb, r } = entryThen(sb2 => {
        const target = path.join(sb2.root, 'elsewhere');
        fs.mkdirSync(target);
        fs.rmSync(saltPath(sb2), { force: true });
        fs.symlinkSync(target, saltPath(sb2), 'junction');
      });
      assert.equal(r.code, 0, r.out + r.err);
      assert.equal(r.out, 'miss error:salt');
      assert.deepEqual(fs.readdirSync(path.join(sb.root, 'elsewhere')), []);
    });

    it('error:salt when the salt file is too short', () => {
      const { r } = entryThen(sb => fs.writeFileSync(saltPath(sb), 'short'));
      assert.equal(r.code, 0, r.out + r.err);
      assert.equal(r.out, 'miss error:salt');
    });

    it('error:salt when the salt file is empty', () => {
      const { r } = entryThen(sb => fs.writeFileSync(saltPath(sb), ''));
      assert.equal(r.code, 0, r.out + r.err);
      assert.equal(r.out, 'miss error:salt');
    });

    it('error:git when the tree cannot be read (--files none, no commit)', () => {
      const sb = sandbox({ commit: false });
      const r = before(sb, { nn: '12-qa', round: 1, dispatch: prompt(1), files: 'none' });
      assert.equal(r.code, 0, r.out + r.err);
      assert.equal(r.out, 'miss error:git');
    });

    it('error:read when the dispatch path is a directory', () => {
      const sb = sandbox();
      makeEntry(sb);
      fs.mkdirSync(path.join(sb.root, 'promptdir'));
      const r = sk(sb, ['before', SLUG, '12-qa', '--round', '1', '--dispatch', 'promptdir', '--model', 'sonnet',
        '--input', 'docs/in.md', '--files', 'src/a.txt']);
      assert.equal(r.code, 0, r.out + r.err);
      assert.equal(r.out, 'miss error:read');
    });
  });
});

describe('reuse refusals write nothing (AC12)', () => {
  const refused = (r, re = /^refused: /) => {
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out, re);
  };

  it('the output exists: refused, the file is untouched', () => {
    const sb = sandbox();
    makeEntry(sb);
    hit(sb);
    const out = path.join(sb.run, '12-qa.md');
    fs.writeFileSync(out, 'precious\n');
    const n = rows(sb).length;
    refused(sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL]));
    assert.equal(fs.readFileSync(out, 'utf8'), 'precious\n');
    assert.equal(rows(sb).length, n);
  });

  it('the newest before is a miss: refused', () => {
    const sb = sandbox();
    makeEntry(sb);
    hit(sb, { model: 'opus' });
    refused(sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL]));
    assert.equal(fs.existsSync(path.join(sb.run, '12-qa.md')), false);
    assert.equal(rows(sb, 'reused').length, 0);
  });

  it('a hit followed by a miss for the same Step: refused (newest before decides)', () => {
    const sb = sandbox();
    makeEntry(sb);
    hit(sb);
    hit(sb, { model: 'opus' });
    refused(sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL]));
    assert.equal(fs.existsSync(path.join(sb.run, '12-qa.md')), false);
  });

  it('no before at all: refused', () => {
    const sb = sandbox();
    makeEntry(sb);
    refused(sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL]));
    assert.equal(fs.existsSync(path.join(sb.run, '12-qa.md')), false);
  });

  it('a verify before is not a hit: refused', () => {
    const sb = sandbox();
    makeEntry(sb);
    before(sb, { nn: '12-qa', round: 1, dispatch: prompt(1), extra: ['--verify'] });
    refused(sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL]));
    assert.equal(fs.existsSync(path.join(sb.run, '12-qa.md')), false);
  });

  it('the source changed after the hit: refused', () => {
    const sb = sandbox();
    const { file } = makeEntry(sb);
    assert.equal(hit(sb).out, 'hit 05-qa');
    fs.appendFileSync(file, '- edited later\n');
    refused(sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL]));
    assert.equal(fs.existsSync(path.join(sb.run, '12-qa.md')), false);
  });

  it('the source was deleted after the hit: refused', () => {
    const sb = sandbox();
    const { file } = makeEntry(sb);
    hit(sb);
    fs.rmSync(file);
    refused(sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL]));
    assert.equal(fs.existsSync(path.join(sb.run, '12-qa.md')), false);
  });

  it('cold by AICO_COLD: refused: cold, nothing written', () => {
    const sb = sandbox();
    makeEntry(sb);
    hit(sb);
    const r = sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL], { env: { AICO_COLD: '1' } });
    refused(r, /^refused: cold$/);
    assert.equal(fs.existsSync(path.join(sb.run, '12-qa.md')), false);
  });

  it('cold by --cold: refused: cold, nothing written', () => {
    const sb = sandbox();
    makeEntry(sb);
    hit(sb);
    const r = sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL, '--cold']);
    refused(r, /^refused: cold$/);
    assert.equal(fs.existsSync(path.join(sb.run, '12-qa.md')), false);
  });

  it('a log that went bad between hit and reuse: refused', () => {
    const sb = sandbox();
    makeEntry(sb);
    hit(sb);
    fs.appendFileSync(path.join(sb.run, 'step-keys.jsonl'), '{not json\n');
    refused(sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL]));
    assert.equal(fs.existsSync(path.join(sb.run, '12-qa.md')), false);
  });

  it('a purged entry between hit and reuse: refused', () => {
    const sb = sandbox();
    makeEntry(sb);
    hit(sb);
    const v = before(sb, { nn: '20-qa', round: 1, dispatch: prompt(1, '20-qa.md'), extra: ['--verify'] });
    assert.equal(v.out, 'verify');
    writeHandoff(sb, '20-qa', { blocking: ['- [test] red.'] });
    assert.equal(after1(sb, '20-qa').out, 'disagree');
    refused(sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL]));
    assert.equal(fs.existsSync(path.join(sb.run, '12-qa.md')), false);
  });

  it('an output outside the run folder: refused, nothing written', () => {
    const sb = sandbox();
    makeEntry(sb);
    hit(sb);
    refused(sk(sb, ['reuse', SLUG, '12-qa', '--output', 'docs/12-qa.md']));
    assert.equal(fs.existsSync(path.join(sb.root, 'docs', '12-qa.md')), false);
  });

  it('an output through a link out of the run folder: refused, nothing written', () => {
    const sb = sandbox();
    makeEntry(sb);
    hit(sb);
    const outside = path.join(sb.root, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(sb.run, 'linkdir'), 'junction');
    refused(sk(sb, ['reuse', SLUG, '12-qa', '--output', `${RUN_REL}/linkdir/12-qa.md`]));
    assert.deepEqual(fs.readdirSync(outside), []);
  });

  it('an output that is itself a link: refused, the target is untouched', () => {
    const sb = sandbox();
    makeEntry(sb);
    hit(sb);
    const outside = path.join(sb.root, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(sb.run, '12-qa.md'), 'junction');
    refused(sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL]));
    assert.deepEqual(fs.readdirSync(outside), []);
  });

  for (const [label, p] of [
    ['a parent segment', `${RUN_REL}/../x/12-qa.md`],
    ['a leading ..', '../12-qa.md'],
    ['an absolute path', path.join(os.tmpdir(), '12-qa-abs.md')],
    ['a control character', `${RUN_REL}/12-\u0007qa.md`],
    ['a newline', `${RUN_REL}/12-qa.md\nx`],
  ]) {
    it(`an --output with ${label}: refused, nothing written`, () => {
      const sb = sandbox();
      makeEntry(sb);
      hit(sb);
      const n = rows(sb).length;
      refused(sk(sb, ['reuse', SLUG, '12-qa', '--output', p]));
      assert.equal(rows(sb).length, n);
      assert.equal(fs.existsSync(path.join(sb.run, '12-qa.md')), false);
      assert.equal(fs.existsSync(path.join(os.tmpdir(), '12-qa-abs.md')), false);
    });
  }
});

describe('hostile path arguments are refused (proj.M4)', () => {
  for (const [label, args] of [
    ['--dispatch with ..', ['--dispatch', '../prompt.txt']],
    ['--dispatch absolute', ['--dispatch', path.join(os.tmpdir(), 'x-prompt.txt')]],
    ['--dispatch with a control character', ['--dispatch', 'prompt\u0001.txt']],
    ['--input with ..', ['--input', '../secret.txt']],
    ['--input absolute', ['--input', path.join(os.tmpdir(), 'secret.txt')]],
    ['--input with a control character', ['--input', 'docs/in\u0001.md']],
  ]) {
    it(label, () => {
      const sb = sandbox();
      const r = sk(sb, ['before', SLUG, '05-qa', '--round', '0', '--model', 'sonnet', '--files', 'src/a.txt', ...args], { input: prompt(0) });
      assert.equal(r.code, 2, r.out + r.err);
      assert.match(r.out, /^refused: /);
      assert.equal(logText(sb), '', 'a refusal writes nothing');
      assert.equal(fs.existsSync(path.join(sb.run, 'step-keys.salt')), false);
    });
  }

  it('a --files path with .. is refused', () => {
    const sb = sandbox();
    const r = before(sb, { files: '../a.txt' });
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out, /^refused: /);
    assert.equal(logText(sb), '');
  });

  it('an unknown command is refused', () => {
    const sb = sandbox();
    const r = sk(sb, ['frobnicate', SLUG, '05-qa']);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out, /^refused: /);
  });

  it('a slug that leaves the work folder is refused', () => {
    const sb = sandbox();
    const r = sk(sb, ['before', '../../../evil/x', '05-qa', '--round', '0', '--dispatch', '-', '--model', 'sonnet'], { input: prompt(0) });
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out, /^refused: /);
    assert.equal(fs.existsSync(path.join(sb.root, '..', 'evil')), false);
  });
});

describe('uncacheable Steps never hit (AC12)', () => {
  it('no --dispatch is uncacheable and never becomes an entry', () => {
    const sb = sandbox();
    const b = before(sb, { omit: ['dispatch'] });
    assert.equal(b.code, 0, b.out + b.err);
    assert.match(b.out, /^uncacheable\b/);
    writeHandoff(sb, '05-qa');
    after1(sb, '05-qa');
    assert.equal(rows(sb, 'outcome').filter(r => r.hsha).length, 0);
    assert.match(hit(sb).out, /^miss\b/);
  });

  it('no --model is uncacheable', () => {
    const sb = sandbox();
    const b = before(sb, { omit: ['model'] });
    assert.equal(b.code, 0, b.out + b.err);
    assert.match(b.out, /^uncacheable\b/);
  });

  it('an uncacheable round 1 does not hit although an entry exists', () => {
    const sb = sandbox();
    makeEntry(sb);
    assert.match(hit(sb, { omit: ['model'] }).out, /^uncacheable\b/);
    assert.match(hit(sb, { omit: ['dispatch'] }).out, /^uncacheable\b/);
  });

  it('--undeclared is uncacheable', () => {
    const sb = sandbox();
    makeEntry(sb);
    const h = hit(sb, { extra: ['--undeclared', 'Input Handoffs'] });
    assert.equal(h.code, 0, h.out + h.err);
    assert.match(h.out, /^uncacheable\b/);
  });

  it('a Handoff with files-touched outside --files is uncacheable and no entry', () => {
    const sb = sandbox();
    before(sb, { round: 0 });
    writeHandoff(sb, '05-qa', { files: ['src/a.txt', 'src/b.txt'] });
    const a = after1(sb, '05-qa');
    assert.equal(a.code, 0, a.out + a.err);
    assert.ok(rows(sb, 'uncacheable').length >= 1, 'the row is marked uncacheable');
    assert.equal(rows(sb, 'outcome').filter(r => r.hsha).length, 0);
    assert.match(hit(sb).out, /^miss\b/);
  });

  it('files-touched with a parent path is outside --files too', () => {
    const sb = sandbox();
    before(sb, { round: 0 });
    writeHandoff(sb, '05-qa', { files: ['src/a.txt', '../outside.txt'] });
    after1(sb, '05-qa');
    assert.match(hit(sb).out, /^miss\b/);
  });

  it('files-touched inside --files stays an entry', () => {
    const sb = sandbox();
    makeEntry(sb, { files: 'src/a.txt,src/b.txt' }, { files: ['src/a.txt', 'src/b.txt'] });
    assert.equal(hit(sb, { files: 'src/a.txt,src/b.txt' }).out, 'hit 05-qa');
  });
});

describe('verify, cold wins and purge (AC13)', () => {
  const verify = (sb, nn = '20-qa', round = 1) =>
    before(sb, { nn, round, dispatch: prompt(round, `${nn}.md`), extra: ['--verify'] });

  it('--verify never hits although the key matches a live entry', () => {
    const sb = sandbox();
    makeEntry(sb);
    const v = verify(sb);
    assert.equal(v.code, 0, v.out + v.err);
    assert.equal(v.out, 'verify');
    const row = rows(sb).at(-1);
    assert.equal(row.result, 'verify');
    assert.match(row.key, /^[0-9a-f]{64}$/, 'the key is computed');
  });

  it('--verify never hits at round 0 or on a first call either', () => {
    const sb = sandbox();
    assert.equal(verify(sb, '05-qa', 0).out, 'verify');
    assert.equal(verify(sb, '06-qa', 1).out, 'verify');
  });

  it('the same outcome is agree and nothing is purged', () => {
    const sb = sandbox();
    makeEntry(sb);
    verify(sb);
    writeHandoff(sb, '20-qa');
    const a = after1(sb, '20-qa');
    assert.equal(a.code, 0, a.out + a.err);
    assert.equal(a.out, 'agree');
    assert.equal(rows(sb, 'agree').length, 1);
    assert.equal(rows(sb, 'disagree').length, 0);
    assert.equal(rows(sb, 'purge').length, 0);
    assert.match(hit(sb).out, /^hit (05|20)-qa$/);
  });

  it('a different outcome is disagree with both outcomes, then a purge; the key never hits again', () => {
    const sb = sandbox();
    makeEntry(sb);
    verify(sb);
    writeHandoff(sb, '20-qa', { blocking: ['- [test] red test.'], files: ['src/a.txt'] });
    const a = after1(sb, '20-qa');
    assert.equal(a.code, 0, a.out + a.err);
    assert.equal(a.out, 'disagree');
    const [d] = rows(sb, 'disagree');
    assert.ok(d, 'a disagree row');
    assert.equal(typeof d.cached, 'object');
    assert.equal(typeof d.cold, 'object');
    assert.ok(JSON.stringify(d.cached).includes('done'));
    assert.ok(!JSON.stringify(d.cached).includes('test]'));
    assert.ok(JSON.stringify(d.cold).includes('test'), 'the cold outcome holds the Blocking tag');
    const [p] = rows(sb, 'purge');
    assert.ok(p, 'a purge row');
    assert.equal(p.key, d.key);
    assert.match(hit(sb).out, /^miss purged\b/);
    assert.match(hit(sb).out, /^miss purged\b/, 'still purged on a second look');
  });

  it('a different status is a disagree', () => {
    const sb = sandbox();
    makeEntry(sb);
    verify(sb);
    writeHandoff(sb, '20-qa', { status: 'blocked' });
    assert.equal(after1(sb, '20-qa').out, 'disagree');
  });

  it('different files-touched is a disagree', () => {
    const sb = sandbox();
    const files = 'src/a.txt,src/b.txt';
    makeEntry(sb, { files }, { files: ['src/a.txt'] });
    before(sb, { nn: '20-qa', round: 1, dispatch: prompt(1, '20-qa.md'), files, extra: ['--verify'] });
    writeHandoff(sb, '20-qa', { files: ['src/a.txt', 'src/b.txt'] });
    assert.equal(after1(sb, '20-qa').out, 'disagree');
  });

  it('files-touched order does not matter (sorted)', () => {
    const sb = sandbox();
    makeEntry(sb, { files: 'src/a.txt,src/b.txt' }, { files: ['src/b.txt', 'src/a.txt'] });
    before(sb, { nn: '20-qa', round: 1, dispatch: prompt(1, '20-qa.md'), files: 'src/a.txt,src/b.txt', extra: ['--verify'] });
    writeHandoff(sb, '20-qa', { files: ['src/a.txt', 'src/b.txt'] });
    assert.equal(after1(sb, '20-qa').out, 'agree');
  });

  it('a verify against a reused Step compares with the source outcome', () => {
    const sb = sandbox();
    makeEntry(sb);
    assert.equal(hit(sb).out, 'hit 05-qa');
    assert.equal(sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL]).code, 0);
    verify(sb, '20-qa', 1);
    writeHandoff(sb, '20-qa', { blocking: ['- [spec] drift.'] });
    assert.equal(after1(sb, '20-qa').out, 'disagree');
    assert.equal(rows(sb, 'purge').length, 1);
    assert.match(hit(sb, { nn: '21-qa' }).out, /^miss purged\b/);
  });

  it('a dispatched Step whose key matches a live entry is compared too', () => {
    const sb = sandbox();
    makeEntry(sb);
    before(sb, { nn: '12-qa', round: 1, dispatch: prompt(1), omit: [] }); // a hit, but the Lead dispatched anyway
    writeHandoff(sb, '12-qa', { blocking: ['- [test] red.'], round: 1 });
    const a = after1(sb, '12-qa');
    assert.equal(a.code, 0, a.out + a.err);
    assert.equal(a.out, 'disagree');
    assert.equal(rows(sb, 'purge').length, 1);
  });

  it('a verify Step with no live entry for its id is none', () => {
    const sb = sandbox();
    verify(sb, '20-qa', 1);
    writeHandoff(sb, '20-qa');
    const a = after1(sb, '20-qa');
    assert.equal(a.code, 0, a.out + a.err);
    assert.equal(a.out, 'none');
  });

  it('a purge is permanent for the run: a later agreeing entry does not revive the key', () => {
    const sb = sandbox();
    makeEntry(sb);
    verify(sb);
    writeHandoff(sb, '20-qa', { blocking: ['- [test] red.'] });
    after1(sb, '20-qa');
    assert.match(hit(sb).out, /^miss purged\b/);
    verify(sb, '21-qa', 1);
    writeHandoff(sb, '21-qa');
    after1(sb, '21-qa');
    assert.match(hit(sb).out, /^miss purged\b/);
  });

  it('every log row stays within 1024 bytes and a reason within 120 characters', () => {
    const sb = sandbox();
    makeEntry(sb, { env: { AICO_FLAG: 'x'.repeat(300) } });
    verify(sb, '20-qa', 1);
    writeHandoff(sb, '20-qa', { blocking: ['- [test] red.'] });
    after1(sb, '20-qa');
    for (const line of logText(sb).split('\n').filter(Boolean)) {
      assert.ok(Buffer.byteLength(line) <= 1024, `row of ${Buffer.byteLength(line)} bytes`);
      const row = JSON.parse(line);
      assert.ok((row.reason ?? '').length <= 120);
      assert.equal(row.v, 1);
    }
    assert.ok(logText(sb).endsWith('\n'));
    assert.equal(logText(sb).includes('\r'), false);
  });
});

describe('cold is the rollback (AC14)', () => {
  for (const v of ['1', 'true', 'yes', 'banana', '2', 'TRUE']) {
    it(`AICO_COLD=${v} is cold: before reads, computes and reuses nothing`, () => {
      const sb = sandbox();
      makeEntry(sb);
      const n = rows(sb).length;
      const b = hit(sb, { env: { AICO_COLD: v } });
      assert.equal(b.code, 0, b.out + b.err);
      assert.equal(b.out, 'cold');
      const all = rows(sb);
      assert.equal(all.length, n + 1, 'exactly one row');
      const row = all.at(-1);
      assert.equal(row.result, 'cold');
      assert.equal('key' in row, false);
      assert.equal('cols' in row, false);
    });
  }

  for (const v of ['', '0', 'false']) {
    it(`AICO_COLD=${JSON.stringify(v)} is warm: a hit stays a hit`, () => {
      const sb = sandbox();
      makeEntry(sb, { env: { AICO_COLD: v } });
      assert.equal(hit(sb, { env: { AICO_COLD: v } }).out, 'hit 05-qa');
      const r = sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL], { env: { AICO_COLD: v } });
      assert.equal(r.code, 0, r.out + r.err);
    });
  }

  it('an unset AICO_COLD is warm', () => {
    const sb = sandbox();
    makeEntry(sb, { env: { AICO_COLD: undefined } });
    assert.equal(hit(sb, { env: { AICO_COLD: undefined } }).out, 'hit 05-qa');
  });

  it('--cold on before is cold', () => {
    const sb = sandbox();
    makeEntry(sb);
    const b = hit(sb, { extra: ['--cold'] });
    assert.equal(b.out, 'cold');
    assert.equal(rows(sb).at(-1).result, 'cold');
  });

  it('cold before a fresh run creates no salt and no key', () => {
    const sb = sandbox();
    const b = before(sb, { round: 1, nn: '12-qa', dispatch: prompt(1), env: { AICO_COLD: '1' } });
    assert.equal(b.out, 'cold');
    assert.equal(fs.existsSync(path.join(sb.run, 'step-keys.salt')), false);
    assert.equal(rows(sb).length, 1);
  });

  it('cold before does not read a broken log (nothing is read)', () => {
    const sb = sandbox();
    makeEntry(sb);
    fs.appendFileSync(path.join(sb.run, 'step-keys.jsonl'), '{not json\n');
    const b = hit(sb, { env: { AICO_COLD: '1' } });
    assert.equal(b.code, 0, b.out + b.err);
    assert.equal(b.out, 'cold');
  });

  it('cold after writes one cold row, no outcome, and prints cold', () => {
    const sb = sandbox();
    makeEntry(sb);
    writeHandoff(sb, '20-qa', { blocking: ['- [test] red.'] });
    const n = rows(sb).length;
    const a = after1(sb, '20-qa', { AICO_COLD: '1' });
    assert.equal(a.code, 0, a.out + a.err);
    assert.equal(a.out, 'cold');
    const all = rows(sb);
    assert.equal(all.length, n + 1);
    assert.equal(all.at(-1).result, 'cold');
    assert.equal('key' in all.at(-1), false);
  });

  it('cold after with --cold prints cold', () => {
    const sb = sandbox();
    makeEntry(sb);
    writeHandoff(sb, '20-qa');
    const a = sk(sb, ['after', SLUG, '20-qa', '--cold']);
    assert.equal(a.out, 'cold');
  });

  it('a cold verify purges nothing: the entry hits again once warm', () => {
    const sb = sandbox();
    makeEntry(sb);
    const v = before(sb, { nn: '20-qa', round: 1, dispatch: prompt(1, '20-qa.md'), extra: ['--verify'], env: { AICO_COLD: '1' } });
    assert.equal(v.out, 'cold');
    writeHandoff(sb, '20-qa', { blocking: ['- [test] red.'] });
    assert.equal(after1(sb, '20-qa', { AICO_COLD: '1' }).out, 'cold');
    assert.equal(rows(sb, 'purge').length, 0);
    assert.equal(rows(sb, 'disagree').length, 0);
    assert.equal(hit(sb).out, 'hit 05-qa');
  });

  it('a cold Step is never an entry', () => {
    const sb = sandbox();
    before(sb, { round: 0, env: { AICO_COLD: '1' } });
    writeHandoff(sb, '05-qa');
    after1(sb, '05-qa', { AICO_COLD: '1' });
    assert.equal(rows(sb, 'outcome').length, 0);
    assert.match(hit(sb).out, /^miss\b/);
  });

  it('a hostile AICO_COLD value never turns into a hit', () => {
    const sb = sandbox();
    makeEntry(sb);
    for (const v of ['off', 'no', '-1', 'nope']) {
      const b = hit(sb, { env: { AICO_COLD: v } });
      assert.equal(b.code, 0, `${JSON.stringify(v)}: ${b.out}${b.err}`);
      assert.doesNotMatch(b.out, /^hit/, `value ${JSON.stringify(v)}`);
    }
  });
});

describe('secrets stay out of the log (AC16, proj.M-SEC2)', () => {
  function secretRun(salt) {
    const sb = sandbox();
    if (salt) fs.writeFileSync(path.join(sb.run, 'step-keys.salt'), salt);
    const env = { AICO_SECRET_TOKEN: SECRET, NODE_ENV: 'production' };
    const outs = [];
    const b0 = before(sb, { env }); outs.push(b0);
    writeHandoff(sb, '05-qa');
    outs.push(after1(sb, '05-qa', env));
    outs.push(hit(sb, { env }));
    outs.push(sk(sb, ['reuse', SLUG, '12-qa', '--output', OUT_REL], { env }));
    outs.push(before(sb, { nn: '20-qa', round: 1, dispatch: prompt(1, '20-qa.md'), extra: ['--verify'], env }));
    writeHandoff(sb, '20-qa', { blocking: ['- [test] red.'] });
    outs.push(after1(sb, '20-qa', env));
    outs.push(sk(sb, ['stats', SLUG], { env }));
    outs.push(before(sb, { env: { ...env, AICO_SECRET_TOKEN: SECRET }, omit: ['model'] }));
    return { sb, outs };
  }

  const forbidden = saltBuf => {
    const list = [SECRET, sha256(SECRET), sha256(SECRET).slice(0, 16), sha256(`${SECRET}\n`), crypto.createHash('sha256').update(SECRET).digest('base64')];
    if (saltBuf) list.push(saltBuf.toString('latin1'), saltBuf.toString('hex'), saltBuf.toString('base64'), saltBuf.toString('utf8'));
    return list.filter(x => x && x.length >= 8);
  };

  it('the secret value, its plain SHA-256 and the salt appear in no row, output or error', () => {
    const { sb, outs } = secretRun();
    const salt = fs.readFileSync(path.join(sb.run, 'step-keys.salt'));
    const hay = [logText(sb), ...outs.map(o => `${o.raw}\n${o.err}`)].join('\n');
    for (const needle of forbidden(salt)) assert.equal(hay.includes(needle), false, `leaked ${needle.slice(0, 12)}...`);
    const reuseCopy = fs.readFileSync(path.join(sb.run, '12-qa.md'), 'utf8');
    for (const needle of forbidden(salt)) assert.equal(reuseCopy.includes(needle), false);
  });

  it('the row holds the env name and a 16 hex HMAC under the run salt', () => {
    const salt = Buffer.from(SALT_TEXT, 'latin1');
    assert.equal(salt.length, 32);
    const { sb } = secretRun(salt);
    const row = rows(sb).find(r => r.cols);
    assert.ok(row, 'a row with columns');
    const pairs = Object.fromEntries(row.cols.env);
    const want = crypto.createHmac('sha256', salt).update(SECRET).digest('hex').slice(0, 16);
    assert.equal(pairs.AICO_SECRET_TOKEN, want);
    assert.match(pairs.NODE_ENV, /^[0-9a-f]{16}$/);
    assert.deepEqual(row.cols.env.map(p => p[0]), [...row.cols.env.map(p => p[0])].sort());
    assert.equal(JSON.stringify(row).includes('production'), false);
    assert.equal(JSON.stringify(row).includes(SALT_TEXT), false);
  });

  it('a known salt is never printed or logged', () => {
    const { sb, outs } = secretRun(Buffer.from(SALT_TEXT, 'latin1'));
    assert.ok(rows(sb).length >= 4, 'the run logged rows');
    const hay = [logText(sb), ...outs.map(o => `${o.raw}\n${o.err}`)].join('\n');
    assert.equal(hay.includes(SALT_TEXT), false);
    assert.equal(hay.includes(Buffer.from(SALT_TEXT).toString('hex')), false);
    assert.equal(hay.includes(Buffer.from(SALT_TEXT).toString('base64')), false);
  });

  it('the salt is 32 bytes, created once, and stays the same across calls', () => {
    const sb = sandbox();
    before(sb, { env: { AICO_SECRET_TOKEN: SECRET } });
    const p = path.join(sb.run, 'step-keys.salt');
    const first = fs.readFileSync(p);
    assert.equal(first.length, 32);
    before(sb, { nn: '06-qa', env: { AICO_SECRET_TOKEN: SECRET } });
    assert.deepEqual(fs.readFileSync(p), first);
    if (process.platform !== 'win32') assert.equal(fs.statSync(p).mode & 0o777, 0o600);
  });

  it('two runs get two salts, so a secret has two different HMACs', () => {
    const a = sandbox();
    const b = sandbox();
    for (const sb of [a, b]) before(sb, { env: { AICO_SECRET_TOKEN: SECRET } });
    const hm = sb => Object.fromEntries(rows(sb)[0].cols.env).AICO_SECRET_TOKEN;
    assert.notEqual(hm(a), hm(b));
  });

  it('a different secret value misses with env and a same value hits', () => {
    const sb = sandbox();
    makeEntry(sb, { env: { AICO_SECRET_TOKEN: SECRET } });
    assert.equal(hit(sb, { env: { AICO_SECRET_TOKEN: SECRET } }).out, 'hit 05-qa');
    assert.match(hit(sb, { env: { AICO_SECRET_TOKEN: `${SECRET}x` } }).out, /^miss env\b/);
  });

  it('a salt that is a link is never followed to write or read elsewhere', () => {
    const sb = sandbox();
    const outside = path.join(sb.root, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(sb.run, 'step-keys.salt'), 'junction');
    const b = before(sb, { env: { AICO_SECRET_TOKEN: SECRET } });
    assert.equal(b.code, 0, b.out + b.err);
    assert.doesNotMatch(b.out, /^hit/);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
});

describe('Contract surface', () => {
  it('line 2 of the provider names the Contract', () => {
    const text = fs.readFileSync(STEPKEY, 'utf8');
    assert.equal(text.split('\n')[1].trim(), '// contract: docs/contracts/step-key.md v1.0');
  });

  it('the provider uses Node built-ins only', () => {
    const text = fs.readFileSync(STEPKEY, 'utf8');
    const specs = [...text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
    for (const s of specs) assert.ok(s.startsWith('node:') || s.startsWith('./') || s.startsWith('../'), `import ${s}`);
  });

  it('every row version is 1 and the log is LF only', () => {
    const sb = sandbox();
    makeEntry(sb);
    hit(sb);
    for (const r of rows(sb)) assert.equal(r.v, 1);
    assert.equal(logText(sb).includes('\r'), false);
  });
});
