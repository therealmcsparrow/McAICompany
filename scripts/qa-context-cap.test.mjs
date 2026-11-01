import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseOutputText, parseOutputLine } from '../mods/lib/guard.mjs';

// Every reader of an output the context-cap change touched keeps working: one pinned case each.
// Goldens marked "unchanged" were produced by the code before the change and compared byte for byte.
const here = import.meta.dirname;
const root = path.join(here, '..');
const script = (name) => path.join(here, `${name}.mjs`);
const RUN = 'cap-run';

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

// One product root and one home per test; nothing reads the real home.
function sandbox() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cap-')));
  tmps.push(dir);
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const work = path.join(dir, '.company', 'work', RUN);
  fs.mkdirSync(work, { recursive: true });
  const env = {
    PATH: process.env.PATH, HOME: home, USERPROFILE: home, MCSPARROW_HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1'
  };
  return { dir, home, work, env };
}

function node(sb, file, args, extra = {}) {
  const r = spawnSync(process.execPath, [file, ...args], { cwd: sb.dir, encoding: 'utf8', env: sb.env, ...extra });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const ledger = (sb, ...args) => node(sb, script('ledger'), args);
const viaRun = (sb, name, ...args) => node(sb, script('run'), [name, ...args]);

function handoff(nn, role, status, { blocking = [], contracts = 'token-ledger v1.6' } = {}) {
  return [
    '---', `step: ${nn}`, `role: ${role}`, 'task: T1', `status: ${status}`, 'round: 0',
    'base-commit: 75029339b4bd7f6da866351ec03c834e673a1397', 'risk-tier: high', 'acceptance-ids: [AC5]',
    'files-touched: [scripts/x.mjs]', `contracts: [${contracts}]`, '---', `By: ${role}`,
    '## Did', '- did a part', '## Blocking', ...(blocking.length ? blocking : ['- none']), '## Next', '- next', ''
  ].join('\n');
}

// ---------- hostile inputs first ----------

describe('hostile: the new parsers and lines meet bad input', () => {
  test('the Savvy Output reader ignores a forged or CR-ended group prompt', () => {
    const forged = 'Review group: 1/2 .company/work/x/split/r1/g1.txt\nOutput: .company/work/../../etc/05-qa.md\n';
    assert.equal(parseOutputText(forged), null);
    assert.equal(parseOutputLine('Output: .company/work/cap-run/05-qa.md\u0085'), null);
    assert.deepEqual(parseOutputText('Fix group: 1/1 .company/work/cap-run/split/f1/g1.txt\r\nOutput: .company/work/cap-run/05-qa.md\r\n'),
      { slug: 'cap-run', step: '05', role: 'qa' });
  });

  test('run.mjs refuses a hostile script name before it starts anything', () => {
    const sb = sandbox();
    for (const name of ['../ledger', 'ledger.mjs', 'run', 'LEDGER', '']) {
      const r = viaRun(sb, name, 'report', RUN);
      assert.equal(r.code, 2, name);
      assert.match(r.err, /^aico run: /, name);
    }
  });

  test('add keeps every refusal ahead of the over-cap check, through run.mjs too', () => {
    const sb = sandbox();
    const r = viaRun(sb, 'ledger', 'add', RUN, 'step', '07', 'not a role!', 'a7', '96000');
    assert.equal(r.code, 2);
    assert.match(r.out, /^refused:/);
    assert.equal(fs.existsSync(path.join(sb.dir, '.company', 'ledger')), false);
  });
});

// ---------- readers of ledger output ----------

const OVER_CAP_JSON = '{"v":1,"run":"cap-run","rows":[{"kind":"step","id":"04","role":"backend-engineer","agent":"a4","state":"unreconciled","tokens":null,"spend":null,"ctx_end":96000,"ms":null,"model":null},{"kind":"step","id":"05","role":"backend-engineer","agent":"a5","state":"unreconciled","tokens":null,"spend":null,"ctx_end":40000,"ms":null,"model":null}],"totals":{"spend":0,"cache_read":0,"cache_write":0,"cache_write_share":0,"by_kind":{}},"per_ac":{"spend":null,"cache_read":null},"not_reconciled":2,"warnings":[]}\n';

function overCapRun(sb) {
  assert.equal(ledger(sb, 'add', RUN, 'step', '04', 'backend-engineer', 'a4', '96000').code, 4);
  assert.equal(ledger(sb, 'add', RUN, 'step', '05', 'backend-engineer', 'a5', '40000').code, 0);
}

describe('run.mjs and ledger exit codes', () => {
  test('run.mjs passes exit 4 and its line through unchanged', () => {
    const sb = sandbox();
    const r = viaRun(sb, 'ledger', 'add', RUN, 'step', '04', 'backend-engineer', 'a4', '96000');
    assert.equal(r.code, 4);
    assert.equal(r.out, 'over cap: step 04 backend-engineer ctx_end 96000 > 95000\n');
    assert.equal(r.err, '');
    assert.equal(viaRun(sb, 'ledger', 'add', RUN, 'step', '05', 'qa', 'a5', '95000').code, 0);
    assert.equal(viaRun(sb, 'ledger', 'add', RUN, 'step', '06', 'qa', 'a6', '0').code, 0);
  });

  test('AC7: the report text counts over-cap Steps, report --json is byte-unchanged', () => {
    const sb = sandbox();
    overCapRun(sb);
    assert.equal(ledger(sb, 'report', RUN, '--json').out, OVER_CAP_JSON);
    const text = ledger(sb, 'report', RUN).out.split('\n');
    assert.ok(text.includes('over cap: 1 steps (max 96000)'), text.join('|'));
  });

  test('Cache Tax and Reflect read report --json: no key outside the allow-list appears, with or without --live', () => {
    const sb = sandbox();
    overCapRun(sb);
    for (const flags of [['--json'], ['--json', '--live']]) {
      const json = JSON.parse(ledger(sb, 'report', RUN, ...flags).out);
      assert.deepEqual(Object.keys(json), ['v', 'run', 'rows', 'totals', 'per_ac', 'not_reconciled', 'warnings'], flags.join(' '));
      assert.deepEqual(Object.keys(json.totals), ['spend', 'cache_read', 'cache_write', 'cache_write_share', 'by_kind']);
      assert.deepEqual(Object.keys(json.rows[0]), ['kind', 'id', 'role', 'agent', 'state', 'tokens', 'spend', 'ctx_end', 'ms', 'model']);
      assert.ok(!/over|cap_|peak/i.test(JSON.stringify(Object.keys(json))));
    }
  });

  test('AC7: a run without over-cap Steps prints no over cap line (committed token-ledger v1.8 text)', () => {
    const sb = sandbox();
    assert.equal(ledger(sb, 'add', RUN, 'step', '01', 'architect', 'a1', '95000').code, 0);
    assert.ok(!/over cap/.test(ledger(sb, 'report', RUN).out));
  });
});

// ---------- Reflect on a fresh-Step chain ----------

describe('Reflect keeps reading a chain of fresh Steps', () => {
  const writeStep = (sb, nn, role, status, opts) => fs.writeFileSync(path.join(sb.work, `${nn}-${role}.md`), handoff(nn, role, status, opts));
  const reflect = (sb, ...args) => node(sb, script('reflect'), args);

  test('Step NN+1 of the same Role after an over-cap Step is not a re-dispatch', () => {
    const sb = sandbox();
    writeStep(sb, '04', 'backend-engineer', 'done');
    writeStep(sb, '05', 'backend-engineer', 'done');
    overCapRun(sb);
    for (const nn of ['04', '05']) {
      const r = reflect(sb, 'step', RUN, `${nn}-backend-engineer.md`, '--json');
      assert.equal(r.code, 0, r.err);
      const check = JSON.parse(r.out);
      assert.deepEqual(Object.keys(check), ['v', 'step', 'role', 'status', 'did', 'wrong', 'remember', 'lessons']);
      assert.deepEqual(check.wrong, [], nn);
    }
    const retro = reflect(sb, 'retro', RUN, '--json');
    assert.equal(retro.code, 0, retro.err);
    assert.deepEqual(Object.keys(JSON.parse(retro.out)), ['v', 'slug', 'outcome', 'top_spend', 'top_time', 'fix_causes', 'lessons', 'warnings']);
    assert.ok(!retro.out.includes('re-dispatch'));
  });

  test('the check Step after an exit-4 handover Step is not flagged either, and the handover still is', () => {
    const sb = sandbox();
    writeStep(sb, '04', 'backend-engineer', 'handover');
    writeStep(sb, '05', 'backend-engineer', 'done');
    overCapRun(sb);
    const first = JSON.parse(reflect(sb, 'step', RUN, '04-backend-engineer.md', '--json').out);
    assert.deepEqual(first.wrong, ['handover']);
    const second = JSON.parse(reflect(sb, 'step', RUN, '05-backend-engineer.md', '--json').out);
    assert.deepEqual(second.wrong, []);
  });

  test('a second dispatch of the same Step number is still flagged', () => {
    const sb = sandbox();
    writeStep(sb, '04', 'backend-engineer', 'done');
    assert.equal(ledger(sb, 'add', RUN, 'step', '04', 'backend-engineer', 'a4', '1000').code, 0);
    assert.equal(ledger(sb, 'add', RUN, 'step', '04', 'backend-engineer', 'a4b', '2000').code, 0);
    const check = JSON.parse(reflect(sb, 'step', RUN, '04-backend-engineer.md', '--json').out);
    assert.deepEqual(check.wrong, ['re-dispatch: 2']);
  });
});

// ---------- handoff-lint on a re-check Step ----------

describe('handoff-lint accepts the Handoff of a fresh re-check Step', () => {
  test('same Role, next NN, status done: exit 0; a malformed one still exits 1', () => {
    const sb = sandbox();
    const ok = path.join(sb.work, '05-backend-engineer.md');
    fs.writeFileSync(ok, handoff('05', 'backend-engineer', 'done'));
    const r = node(sb, script('handoff-lint'), [ok]);
    assert.equal(r.code, 0, r.out + r.err);
    const bad = path.join(sb.work, '06-backend-engineer.md');
    fs.writeFileSync(bad, handoff('06', 'backend-engineer', 'oops'));
    assert.equal(node(sb, script('handoff-lint'), [bad]).code, 1);
  });

  test('a split-group blocker row lints as a normal Blocking line', () => {
    const sb = sandbox();
    const file = path.join(sb.work, '07-qa.md');
    fs.writeFileSync(file, handoff('07', 'qa', 'blocked', { blocking: ['- [test] R-1 scripts/ledger.mjs:12 — over cap not recorded — fix it'] }));
    assert.equal(node(sb, script('handoff-lint'), [file]).code, 0);
  });
});

// ---------- Savvy Output regex on group prompts ----------

describe('Savvy reads the Output line of a group prompt', () => {
  const prompt = (group) => [
    'Project profile: .company/project.md', 'Risk tier: high', 'Round: 0', group,
    'Input Handoffs: .company/work/cap-run/04-backend-engineer.md', 'Output: .company/work/cap-run/09-code-reviewer.md', 'Goal: review.'
  ].join('\n');

  test('a Review group line and a Fix group line leave step, role and slug intact', () => {
    for (const g of ['Review group: 2/3 .company/work/cap-run/split/r1/g2.txt', 'Fix group: 1/2 .company/work/cap-run/split/f1/g1.txt']) {
      assert.deepEqual(parseOutputText(prompt(g)), { slug: 'cap-run', step: '09', role: 'code-reviewer' }, g);
    }
  });
});

// ---------- review-depth without --lines ----------

describe('review-depth output without --lines is byte-unchanged', () => {
  function stagedRepo() {
    const sb = sandbox();
    const git = (...a) => {
      const r = spawnSync('git', a, { cwd: sb.dir, encoding: 'utf8', env: sb.env });
      assert.equal(r.status, 0, r.stderr);
    };
    git('init', '-q', '.');
    git('config', 'user.email', 'qa@example.invalid');
    git('config', 'user.name', 'Test');
    fs.mkdirSync(path.join(sb.dir, 'src'));
    fs.writeFileSync(path.join(sb.dir, 'src', 'util.mjs'), 'a\n');
    git('add', 'src');
    git('commit', '-qm', 'init');
    fs.appendFileSync(path.join(sb.dir, 'src', 'util.mjs'), 'b\n');
    fs.writeFileSync(path.join(sb.dir, 'src', 'auth.mjs'), 'x\n');
    git('add', 'src');
    return sb;
  }

  test('json and text match the output from before the change', () => {
    const sb = stagedRepo();
    const json = '{"v":1,"source":"staged","base":null,"tier":"unknown","depth":"full","paths":[{"path":"src/auth.mjs","categories":["security"],"module":null},{"path":"src/util.mjs","categories":[],"module":null}],"reasons":[{"path":"src/auth.mjs","rule":"security path"}],"truncated":false}\n';
    assert.equal(node(sb, script('review-depth'), ['--staged', '--json']).out, json);
    assert.equal(node(sb, script('review-depth'), ['--staged']).out, 'full\nreason: src/auth.mjs — security path\n');
  });

  test('--lines only adds a lines count to each path', () => {
    const sb = stagedRepo();
    const plain = JSON.parse(node(sb, script('review-depth'), ['--staged', '--json']).out);
    const lines = JSON.parse(node(sb, script('review-depth'), ['--staged', '--json', '--lines']).out);
    assert.deepEqual(lines.paths.map((p) => p.lines), [1, 1]);
    for (const p of lines.paths) delete p.lines;
    assert.deepEqual(lines, plain);
  });

  test('--lines without --json is refused', () => {
    const sb = stagedRepo();
    assert.notEqual(node(sb, script('review-depth'), ['--staged', '--lines']).code, 0);
  });
});

// ---------- Lead Handoff resume with the context reading present ----------

describe('the Lead Handoff still resumes after measure wrote lead-context.json', () => {
  const lead = script('lead-handover');
  const USAGE = { input_tokens: 1000, cache_creation_input_tokens: 4000, cache_read_input_tokens: 80000, output_tokens: 500 };

  function leadRun() {
    const sb = sandbox();
    const claude = path.join(sb.home, '.claude');
    fs.mkdirSync(path.join(claude, 'projects', 'p1'), { recursive: true });
    const at = new Date(Date.now() - 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    fs.writeFileSync(path.join(sb.work, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at, ev: 'start' })}\n`);
    const file = path.join(claude, 'projects', 'p1', 'session.jsonl');
    const rows = [{ type: 'user', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }], usage: USAGE } }];
    fs.writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
    sb.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '98500';
    return { sb, file };
  }
  const hook = (sb, cmd, payload) => node(sb, lead, [cmd], { input: JSON.stringify(payload) });

  test('Stop, PreCompact and SessionStart in a row: the Handoff is injected and keeps its exact keys', () => {
    const { sb, file } = leadRun();
    assert.equal(hook(sb, 'measure', { hook_event_name: 'Stop', transcript_path: file }).code, 0);
    const reading = JSON.parse(fs.readFileSync(path.join(sb.work, 'lead-context.json'), 'utf8'));
    assert.deepEqual(Object.keys(reading), ['v', 'ctx', 'peak', 'at']);
    assert.equal(reading.ctx, 85500);
    assert.equal(hook(sb, 'watch', { hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: file }).code, 0);
    const written = fs.readFileSync(path.join(sb.work, 'lead-handoff-1.md'), 'utf8');
    const keys = written.split('\n').slice(1, written.split('\n').indexOf('---', 1)).map((l) => l.split(':')[0]);
    assert.deepEqual(keys, ['slug', 'playbook', 'step', 'round', 'base-commit', 'risk-tier', 'tier-path', 'tier-set', 'gate', 'form', 'records', 'running', 'tokens-at-handover', 'window', 'trigger']);
    const r = hook(sb, 'resume', { hook_event_name: 'SessionStart', source: 'compact' });
    assert.equal(r.code, 0);
    const context = JSON.parse(r.out).hookSpecificOutput.additionalContext;
    assert.ok(context.includes('tokens-at-handover: 85500'), context);
    assert.ok(!context.includes('lead-context'));
  });

  test('read shows the Lead reading with its over cap marker, ctx --json shows the stored object', () => {
    const { sb, file } = leadRun();
    hook(sb, 'measure', { hook_event_name: 'Stop', transcript_path: file });
    const read = node(sb, lead, ['read', RUN]).out.split('\n');
    assert.ok(read.includes('lead ctx 85500'), read.join('|'));
    assert.ok(read.includes('lead peak 85500'));
    const ctx = JSON.parse(node(sb, lead, ['ctx', RUN, '--json']).out);
    assert.deepEqual(Object.keys(ctx), ['v', 'ctx', 'peak', 'at']);
  });

  test('a Stop from a subagent writes no reading', () => {
    const { sb, file } = leadRun();
    assert.equal(hook(sb, 'measure', { hook_event_name: 'Stop', transcript_path: file, agent_id: 'sub1' }).code, 0);
    assert.equal(fs.existsSync(path.join(sb.work, 'lead-context.json')), false);
  });
});

// ---------- R-21: no skill or agent tells a Role to SendMessage ----------

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

// A line may name SendMessage only to forbid it.
const forbids = (line) => /\b(never|not|refused)\b/i.test(line);
function sendMessageOffenders(files) {
  const bad = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => { if (/SendMessage/i.test(line) && !forbids(line)) bad.push(`${path.relative(root, file)}:${i + 1}`); });
  }
  return bad;
}

describe('R-21: SendMessage appears in skills and agents only as a prohibition', () => {
  test('the detector flags an instruction and passes a prohibition', () => {
    const sb = sandbox();
    const a = path.join(sb.dir, 'a.md');
    fs.writeFileSync(a, 'Use SendMessage to answer the Step.\nNever SendMessage a Step.\n');
    assert.deepEqual(sendMessageOffenders([a]).map((x) => x.split(':').pop()), ['1']);
  });

  test('no file under skills/ or agents/ tells anyone to use SendMessage', () => {
    const files = [...walk(path.join(root, 'skills')), ...walk(path.join(root, 'agents'))];
    assert.ok(files.length > 20);
    assert.deepEqual(sendMessageOffenders(files), []);
  });
});

// ---------- AC12: Contract drift ----------

describe('AC12: the Contract bumps pass the drift check', () => {
  test('check.mjs --drift reports 0 errors', () => {
    const r = spawnSync(process.execPath, [script('check'), '--drift'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /0 error\(s\)/);
  });
});

// ---------- trace: every AC has a test that exists ----------

const TRACE = {
  AC1: [['mods/test/fresh-step.test.tsx', 'a model send in an active run is not delivered with the fixed reason'], ['scripts/fresh-step-lib.test.mjs', 'the refusal reason is the fixed text']],
  AC2: [['scripts/context-cap-text.test.mjs', 'a Step is never resumed']],
  AC3: [['scripts/step-split.test.mjs', 'a 3000-line diff splits into 3 groups'], ['scripts/context-cap-text.test.mjs', 'one Step per review or Fix group']],
  AC4: [['scripts/step-split-fix.test.mjs', '11 blockers in 2 areas become groups of at most 8'], ['scripts/context-cap-text.test.mjs', 'one Step per review or Fix group']],
  AC5: [['scripts/ledger-cap.test.mjs', 'add above 95000 writes the row, prints the over cap line and exits 4'], ['scripts/qa-context-cap.test.mjs', 'run.mjs passes exit 4']],
  AC6: [['scripts/context-cap-text.test.mjs', 'ledger exit 4 routes to one fresh check Step'], ['scripts/qa-context-cap.test.mjs', 'the check Step after an exit-4 handover Step']],
  AC7: [['scripts/ledger-cap.test.mjs', 'report text ends with an over cap line'], ['scripts/qa-context-cap.test.mjs', 'AC7: the report text counts over-cap Steps']],
  AC8: [['scripts/lead-context.test.mjs', 'writes ctx, peak and time'], ['scripts/qa-context-cap.test.mjs', 'Stop, PreCompact and SessionStart in a row']],
  AC9: [['mods/test/savvy-ctx.test.tsx', 'a running agent at 90000 tokens shows ctx 90.0k near cap']],
  AC10: [['scripts/ctx-row-lib.test.mjs', 'ctxCell: plain, near cap past 85500, over cap past 95000'], ['mods/test/savvy-ctx.test.tsx', 'a count past 95000 shows over cap']],
  AC11: [['scripts/ledger-cap.test.mjs', 'agent-ctx refuses hostile ids'], ['mods/test/savvy-ctx.test.tsx', 'failures draw ctx ? and never block the pane']],
  AC12: [['scripts/qa-context-cap.test.mjs', 'check.mjs --drift reports 0 errors']],
  AC13: [['scripts/context-cap-text.test.mjs', 'Ship Gate shows over cap and the Lead peak'], ['scripts/lead-context.test.mjs', 'read prints ctx and peak, with over cap past CAP']],
  AC14: [['scripts/lead-context.test.mjs', 'warns when neither env nor settings hold 98500']]
};

describe('trace: AC1 to AC14 each name a test that exists', () => {
  for (const [ac, cases] of Object.entries(TRACE)) {
    test(`${ac} is covered`, () => {
      assert.ok(cases.length > 0);
      for (const [file, title] of cases) {
        assert.ok(fs.existsSync(path.join(root, file)), `${ac}: ${file} missing`);
        assert.ok(fs.readFileSync(path.join(root, file), 'utf8').includes(title), `${ac}: "${title}" not found in ${file}`);
      }
    });
  }
});
