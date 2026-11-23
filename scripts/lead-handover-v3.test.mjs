// Tests for lead-handoff v2.1. A Lead hand-over on a v3 run slug `<ID>/<NN>-<playbook>`:
// the run folder is `.company/work/<ID>/<NN>-<playbook>/`; v2, v1.1 and legacy names stay byte-identical.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main, contextHandover, newSessionCommand, watch, measure, findRun } from './lead-handover.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, 'lead-handover.mjs');
const ID = 'P20261109.000001';
const SLUG = `${ID}/01-feature`;
const SESSION = 'abcdef012345';

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
// The run cap is read from the Lead snapshot under MCSPARROW_HOME: point it at an empty temp home so a real snapshot never leaks in.
const isoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-home-'));
tmps.push(isoHome);
const savedHome = { MCSPARROW_HOME: process.env.MCSPARROW_HOME, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.MCSPARROW_HOME = path.join(isoHome, '.mcsparrow');
process.env.HOME = isoHome;
process.env.USERPROFILE = isoHome;
after(() => { for (const [k, v] of Object.entries(savedHome)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// A product root with a v3 project folder and one run folder; `running` leaves a Step open.
function fixture({ slug = SLUG, running = false, cap, recorded } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-v3-'));
  tmps.push(base);
  const root = path.join(base, 'product');
  const claudeDir = path.join(base, 'claude');
  const work = path.join(root, '.company', 'work');
  const dir = path.join(work, ...slug.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'projects', 'p1'), { recursive: true });
  if (slug.includes('/')) fs.writeFileSync(path.join(work, slug.split('/')[0], '00-project.md'), 'Demo project\n');
  const now = Date.now();
  const rows = [{ v: 1, at: iso(now - 60000), ev: 'start', ...(recorded === undefined ? {} : { cap: recorded }) }];
  rows.push({ v: 1, at: iso(now - 50000), ev: 'sub', role: 'backend-engineer', id: '000000000001', phase: 'start' });
  if (!running) rows.push({ v: 1, at: iso(now - 40000), ev: 'sub', role: 'backend-engineer', id: '000000000001', phase: 'stop' });
  fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  if (cap !== undefined) { // run-state v3.0: the run cap is the Lead snapshot threshold under MCSPARROW_HOME, keyed by the root
    const r12 = crypto.createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0, 12);
    fs.mkdirSync(path.join(process.env.MCSPARROW_HOME, 'hook-snapshots', r12), { recursive: true });
    fs.writeFileSync(path.join(process.env.MCSPARROW_HOME, 'hook-snapshots', r12, 'lead.json'),
      JSON.stringify({ v: 1, at: iso(now), threshold: cap, savers: {}, floor: {}, drift: false, settingsWarnings: [] }));
  }
  return { base, root, claudeDir, work, dir, slug, now };
}
const records = (fx) => fs.readFileSync(path.join(fx.dir, 'lead-handover.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const tree = (d, rel = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? tree(path.join(d, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`])).sort();
const USAGE_MID = { input_tokens: 1000, cache_creation_input_tokens: 4000, cache_read_input_tokens: 80000, output_tokens: 500 };
function transcript(fx) {
  const file = path.join(fx.claudeDir, 'projects', 'p1', 'session.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: USAGE_MID } })}\n`);
  return file;
}
const opts = (fx) => ({ root: fx.root, claudeDir: fx.claudeDir, env: { AICO_GUARDS: 'off' } });

describe('newSessionCommand', () => {
  test('a v3 slug gives the single-quoted command with the slug', () => {
    assert.equal(newSessionCommand(SLUG),
      `claude "aico lead hand-over: run lead-handover read '${SLUG}' first, as set out in references/lead-resume.md of the skill aico:pipeline, then follow that file."`);
  });

  test('a bad v3 shape gives null', () => {
    for (const bad of [`${SLUG}/x`, `${ID}/../01-feature`, `${ID}\\01-feature`, `${ID}/01-feature/`, `${ID}/1-feature`, '/01-feature', `${ID}//01-feature`, `${SLUG}%`, `${SLUG}"`]) {
      assert.equal(newSessionCommand(bad), null, bad);
    }
  });

  test('a legacy name keeps the exact command of today', () => {
    assert.equal(newSessionCommand('demo-run'),
      'claude "aico lead hand-over: run lead-handover read \'demo-run\' first, as set out in references/lead-resume.md of the skill aico:pipeline, then follow that file."');
  });
});

describe('CLI on a v3 slug', () => {
  test('read prints the state lines of the nested run', () => {
    const fx = fixture();
    const r = main(['read', SLUG], fx.root, {});
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^handovers 0$/m);
    assert.match(r.out, /^running: none$/m);
  });

  test('read reports a Step running in the nested run', () => {
    const fx = fixture({ running: true });
    assert.match(main(['read', SLUG], fx.root, {}).out, /^running: step$/m);
  });

  test('write puts the Handoff and the record in the run folder, slug line holds the slug', () => {
    const fx = fixture();
    const r = main(['write', SLUG], fx.root, {});
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out, 'wrote lead-handoff-1.md\n');
    const text = fs.readFileSync(path.join(fx.dir, 'lead-handoff-1.md'), 'utf8');
    assert.ok(text.split('\n').includes(`slug: ${SLUG}`));
    assert.equal(records(fx).find((e) => e.ev === 'handover').file, 'lead-handoff-1.md');
    // nothing lands in the project folder itself
    assert.deepEqual(fs.readdirSync(path.join(fx.work, ID)).sort(), ['00-project.md', '01-feature']);
  });

  test('write refuses with a Step running and writes nothing', () => {
    const fx = fixture({ running: true });
    const before = tree(fx.work);
    const r = main(['write', SLUG], fx.root, {});
    assert.equal(r.code, 3);
    assert.equal(r.out, 'refused: step running\n');
    assert.deepEqual(tree(fx.work), before);
  });

  test('begin, base, ctx work on the nested run', () => {
    const fx = fixture();
    assert.equal(main(['begin', SLUG, 'feature'], fx.root, {}).out, 'begun\n');
    assert.equal(main(['base', SLUG, 'a'.repeat(40)], fx.root, {}).out, 'recorded\n');
    const c = main(['ctx', SLUG, '--json'], fx.root, {});
    assert.equal(c.code, 0, c.out);
    assert.deepEqual(JSON.parse(c.out), { v: 1, ctx: null, peak: null, at: null, ttl: null });
    assert.ok(fs.existsSync(path.join(fx.dir, 'lead-handover.jsonl')));
  });

  test('a run that does not exist in an existing project is refused: no run', () => {
    const fx = fixture();
    const r = main(['read', `${ID}/02-feature`], fx.root, {});
    assert.equal(r.code, 3);
    assert.equal(r.out, 'refused: no run\n');
  });

  test('a wrong letter case of the run folder is refused and writes nothing', () => {
    const fx = fixture();
    const before = tree(fx.work);
    for (const s of [`${ID}/01-FEATURE`, `${ID.toLowerCase()}/01-feature`]) {
      const r = main(['write', s], fx.root, {});
      assert.equal(r.code, 3, s);
      assert.match(r.out, /^refused: (bad slug|wrong letter case|no run)\n$/);
    }
    assert.deepEqual(tree(fx.work), before);
  });

  test('hostile slugs are refused as bad slug and write nothing', () => {
    const fx = fixture();
    const before = tree(fx.work);
    for (const s of [`${SLUG}/..`, `${ID}/../${ID}/01-feature`, `${ID}\\01-feature`, `${SLUG}/`, `../${SLUG}`, `${ID}/01-feature/extra`]) {
      const r = main(['write', s], fx.root, {});
      assert.equal(r.code, 3, s);
      assert.equal(r.out, 'refused: bad slug\n', s);
    }
    assert.deepEqual(tree(fx.work), before);
  });

  test('a linked project folder is refused and nothing is written through it', () => {
    const fx = fixture({ slug: 'demo-run' });
    const outside = path.join(fx.base, 'outside');
    fs.mkdirSync(path.join(outside, '01-feature'), { recursive: true });
    fs.copyFileSync(path.join(fx.dir, 'run-state.jsonl'), path.join(outside, '01-feature', 'run-state.jsonl'));
    fs.symlinkSync(outside, path.join(fx.work, ID), 'junction');
    const before = tree(outside);
    const r = main(['write', SLUG], fx.root, {});
    assert.notEqual(r.code, 0);
    assert.doesNotMatch(r.out, /bad slug/, 'the slug is valid; the link is the reason');
    assert.deepEqual(tree(outside), before);
  });

  test('a linked run folder is refused and nothing is written through it', () => {
    const fx = fixture();
    const outside = path.join(fx.base, 'outside');
    fs.mkdirSync(outside);
    fs.copyFileSync(path.join(fx.dir, 'run-state.jsonl'), path.join(outside, 'run-state.jsonl'));
    fs.rmSync(fx.dir, { recursive: true });
    fs.symlinkSync(outside, fx.dir, 'junction');
    const before = tree(outside);
    const r = main(['write', SLUG], fx.root, {});
    assert.notEqual(r.code, 0);
    assert.doesNotMatch(r.out, /bad slug/, 'the slug is valid; the link is the reason');
    assert.deepEqual(tree(outside), before);
  });

  test('a bare project folder name is not a run: nothing written into it', () => {
    const fx = fixture();
    const r = main(['write', ID], fx.root, {});
    assert.notEqual(r.code, 0);
    assert.ok(!fs.readdirSync(path.join(fx.work, ID)).some((f) => f.startsWith('lead-handoff')));
  });
});

describe('hooks and context hand-over on a v3 run', () => {
  test('contextHandover writes the Handoff with the new-session command for the slug', () => {
    const fx = fixture();
    const file = contextHandover(fx.root, SLUG, { tokens: 85600, session: SESSION, now: fx.now });
    assert.match(String(file), /lead-handoff-1\.md/);
    const text = fs.readFileSync(path.join(fx.dir, 'lead-handoff-1.md'), 'utf8');
    assert.ok(text.split('\n').includes(`slug: ${SLUG}`));
    assert.equal(text.trimEnd().split('\n').pop(), `- New session command: ${newSessionCommand(SLUG)}`);
    const rec = records(fx).find((e) => e.ev === 'handover');
    assert.equal(rec.trigger, 'context');
    assert.equal(rec.session, SESSION);
  });

  test('contextHandover refuses a second hand-over of one session', () => {
    const fx = fixture();
    contextHandover(fx.root, SLUG, { tokens: 85600, session: SESSION, now: fx.now });
    assert.throws(() => contextHandover(fx.root, SLUG, { tokens: 85600, session: SESSION, now: fx.now }));
  });

  test('findRun finds the active v3 run', () => {
    const fx = fixture({ running: true });
    assert.equal(findRun(fx.root, fx.now), SLUG);
  });

  test('watch on a v3 run writes the Handoff into the run folder', () => {
    const fx = fixture();
    const r = watch(JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'manual', transcript_path: transcript(fx) }), opts(fx));
    assert.equal(r.code, 0);
    const text = fs.readFileSync(path.join(fx.dir, 'lead-handoff-1.md'), 'utf8');
    assert.ok(text.split('\n').includes(`slug: ${SLUG}`));
  });

  test('a v3 run follows the snapshot cap, not a start record: the running-Step rule of watch (AICO_GUARDS=off)', () => {
    const fx = fixture({ running: true, cap: 120000 });
    const at = (n) => {
      const file = path.join(fx.claudeDir, 'projects', 'p1', 'session.jsonl');
      fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: n - 15 } } })}
`);
      return JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: file });
    };
    assert.equal(watch(at(119999), opts(fx)).code, 2);
    assert.equal(watch(at(120000), opts(fx)).code, 0);
    const fy = fixture({ running: true, recorded: 120000 }); // an old recorded cap is ignored: the default 180000 applies
    const atY = (n) => {
      const file = path.join(fy.claudeDir, 'projects', 'p1', 'session.jsonl');
      fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: n - 15 } } })}\n`);
      return JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: file });
    };
    assert.equal(watch(atY(150000), opts(fy)).code, 2);
    assert.equal(watch(atY(180000), opts(fy)).code, 0);
  });

  test('a legacy run still hands over to its flat folder (byte-identical layout)', () => {
    const fx = fixture({ slug: 'demo-run' });
    assert.equal(main(['write', 'demo-run'], fx.root, {}).out, 'wrote lead-handoff-1.md\n');
    const text = fs.readFileSync(path.join(fx.work, 'demo-run', 'lead-handoff-1.md'), 'utf8');
    assert.ok(text.split('\n').includes('slug: demo-run'));
  });
});

// lead-handoff v3.0 (AC2, AC6, AC12): `measure` also runs on SubagentStop of the Lead agent (agent_type exactly aico:project-manager,
// usage read from <main>/subagents/agent-<id>.jsonl); `read` adds `leads <n>`, `main peak <n>` and the `form:` line of lead-relay v1.
describe('lead-handoff v3.0: leads, lead peak and main peak in read', () => {
  const usageOf = (n) => ({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: n - 15 });
  const row = (n, side) => `${JSON.stringify({ type: 'assistant', isSidechain: side, message: { role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: usageOf(n) } })}
`;
  const proj = (fx) => path.join(fx.claudeDir, 'projects', 'p1');
  const mainFile = (fx, n) => { const f = path.join(proj(fx), 'session.jsonl'); fs.writeFileSync(f, row(n, false)); return f; };
  const agentFile = (fx, id, n) => {
    const d = path.join(proj(fx), 'session', 'subagents');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `agent-${id}.jsonl`), row(n, true));
  };
  const stopOf = (fx, id, type) => JSON.stringify({ hook_event_name: 'SubagentStop', session_id: 'sess-1', transcript_path: mainFile(fx, 40000), agent_id: id, agent_type: type });
  const mainStop = (fx, n) => JSON.stringify({ hook_event_name: 'Stop', session_id: 'sess-1', transcript_path: mainFile(fx, n) });
  const o = (fx) => ({ root: fx.root, claudeDir: fx.claudeDir, env: {}, now: fx.now });
  const lines = (fx) => main(['read', fx.slug], fx.root, {}).out.split('\n');
  const LEAD = 'aico:project-manager';

  test('two Lead SubagentStop payloads, a main Stop and a cap hand-over: leads 2, lead peak, main peak, form line', () => {
    const fx = fixture();
    agentFile(fx, 'aid01', 90000);
    agentFile(fx, 'aid02', 120000);
    measure(stopOf(fx, 'aid01', LEAD), o(fx));
    measure(stopOf(fx, 'aid02', LEAD), o(fx));
    measure(mainStop(fx, 70000), o(fx));
    measure(mainStop(fx, 50000), o(fx));
    contextHandover(fx.root, fx.slug, { tokens: 150000, session: 'abcdef012345', now: fx.now });
    const out = lines(fx);
    assert.ok(out.includes('leads 2'), out.join('|'));
    assert.ok(out.includes('lead peak 120000'), out.join('|'));
    assert.ok(out.includes('main peak 70000'), out.join('|'));
    assert.ok(out.includes('handovers 1') || out.some((l) => /^handovers [1-9]/.test(l)), out.join('|'));
    assert.ok(out.some((l) => /^form: /.test(l)), out.join('|'));
  });

  test('a Role SubagentStop, a foreign agent_type and a main Stop are not counted as Leads', () => {
    const fx = fixture();
    agentFile(fx, 'aid03', 100000);
    agentFile(fx, 'aid04', 100000);
    agentFile(fx, 'aid05', 100000);
    measure(stopOf(fx, 'aid03', 'aico:qa'), o(fx));
    measure(stopOf(fx, 'aid04', 'other:project-manager'), o(fx));
    measure(stopOf(fx, 'aid05', undefined), o(fx));
    measure(mainStop(fx, 60000), o(fx));
    const out = lines(fx);
    assert.ok(!out.some((l) => /^leads [1-9]/.test(l)), out.join('|'));
    assert.ok(out.includes('main peak 60000'), out.join('|'));
  });

  test('the same Lead agent stopping twice counts once; each Lead keeps its own peak', () => {
    const fx = fixture();
    agentFile(fx, 'aid06', 80000);
    measure(stopOf(fx, 'aid06', LEAD), o(fx));
    measure(stopOf(fx, 'aid06', LEAD), o(fx));
    assert.ok(lines(fx).includes('leads 1'), lines(fx).join('|'));
    assert.ok(lines(fx).includes('lead peak 80000'));
  });

  test('an unreadable agent file or a payload without a transcript writes no reading', () => {
    const fx = fixture();
    measure(stopOf(fx, 'nofile', LEAD), o(fx));
    measure(JSON.stringify({ hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: LEAD }), o(fx));
    assert.ok(!lines(fx).some((l) => /^leads [1-9]/.test(l)), lines(fx).join('|'));
  });

  test('an open lead-relay form shows as a form line with its id and open', () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.dir, 'forms.jsonl'), `${JSON.stringify({ v: 1, at: iso(fx.now - 1000), ev: 'open', id: 'f01', kind: 'ask',
      questions: [{ q: 'Which?', header: 'Pick', multi: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }] })}
`);
    assert.ok(lines(fx).includes('form: f01 open'), lines(fx).join('|'));
    fs.appendFileSync(path.join(fx.dir, 'forms.jsonl'), `${JSON.stringify({ v: 1, at: iso(fx.now), ev: 'answer', id: 'f01', src: 'hook', answers: [{ labels: ['A'], other: null }] })}
`);
    assert.ok(lines(fx).includes('form: f01 answered'), lines(fx).join('|'));
  });
});

// Bug 2 (P20261118.000002): `read` refused the short forms a Lead is handed for a run that exists.
describe('read accepts the short slug forms of an existing v3 run', () => {
  test('project-only `<ProjectID>` reads its one run, not refused: bad slug', () => {
    const fx = fixture();
    const full = main(['read', SLUG], fx.root, {});
    assert.equal(full.code, 0, full.out);
    const r = main(['read', ID], fx.root, {});
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out, full.out);
  });

  test('flat `<NN>-<playbook>` reads the one matching run, not refused: no run', () => {
    const fx = fixture();
    const full = main(['read', SLUG], fx.root, {});
    const r = main(['read', '01-feature'], fx.root, {});
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out, full.out);
  });
});

// lead-handoff v3.1: ambiguity, writers, legacy folders, the CLI root in a linked worktree.
function addRun(fx, id, sub, { records = true } = {}) {
  const dir = path.join(fx.work, id, sub);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(fx.work, id, '00-project.md'))) fs.writeFileSync(path.join(fx.work, id, '00-project.md'), 'x\n');
  if (records) fs.copyFileSync(path.join(fx.dir, 'run-state.jsonl'), path.join(dir, 'run-state.jsonl'));
  else fs.writeFileSync(path.join(dir, 'form.json'), '{}\n');
  return dir;
}

describe('lead-handoff v3.1 short slug resolution', () => {
  test('a bare ID with two runs is ambiguous and lists both, exit 3', () => {
    const fx = fixture();
    addRun(fx, ID, '02-fix');
    const r = main(['read', ID], fx.root, {});
    assert.equal(r.code, 3);
    assert.equal(r.out, `refused: ambiguous slug: ${ID}/02-fix ${SLUG}\n`);
  });

  test('a flat name in two projects is ambiguous', () => {
    const fx = fixture();
    const other = 'P20261108.000002';
    addRun(fx, other, '01-feature');
    const r = main(['read', '01-feature'], fx.root, {});
    assert.equal(r.code, 3);
    assert.equal(r.out, `refused: ambiguous slug: ${SLUG} ${other}/01-feature\n`);
  });

  test('a bare ID or flat name whose folder has no records is no run', () => {
    const fx = fixture({ slug: `${ID}/01-feature` });
    fs.rmSync(path.join(fx.dir, 'run-state.jsonl'));
    fs.writeFileSync(path.join(fx.dir, 'form.json'), '{}\n');
    assert.equal(main(['read', ID], fx.root, {}).out, 'refused: no run\n');
    assert.equal(main(['read', '01-feature'], fx.root, {}).out, 'refused: no run\n');
    assert.equal(main(['read', '09-lead'], fx.root, {}).out, 'refused: no run\n');
  });

  test('a legacy flat folder of that name is the only match and keeps the v3.0 path', () => {
    const fx = fixture({ slug: '01-feature' });
    const r = main(['read', '01-feature'], fx.root, {});
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^handovers 0\n/);
  });

  test('a legacy folder in another letter case is refused, not resolved to a run', () => {
    const fx = fixture();
    fs.mkdirSync(path.join(fx.work, '01-Feature'));
    const r = main(['read', '01-feature'], fx.root, {});
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /wrong letter case/);
  });

  test('a 3-digit flat name at the longest legal run slug (80 characters) resolves', () => {
    const fx = fixture();
    const sub = '100-' + 'a'.repeat(59);
    assert.equal(`${ID}/${sub}`.length, 80);
    addRun(fx, ID, sub);
    const r = main(['read', sub], fx.root, {});
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out, main(['read', `${ID}/${sub}`], fx.root, {}).out);
  });

  test('writers stay strict: bare ID is bad slug, flat name is no run', () => {
    const fx = fixture();
    for (const argv of [['write'], ['begin'], ['base']]) {
      const extra = argv[0] === 'begin' ? ['feature'] : argv[0] === 'base' ? ['a'.repeat(40)] : [];
      assert.equal(main([...argv, ID, ...extra], fx.root, {}).out, 'refused: bad slug\n', argv[0]);
      assert.equal(main([...argv, '01-feature', ...extra], fx.root, {}).out, 'refused: no run\n', argv[0]);
    }
    assert.deepEqual(tree(fx.dir), ['run-state.jsonl']);
  });

  test('ctx with a bare ID equals the full slug output', () => {
    const fx = fixture();
    const full = main(['ctx', SLUG, '--json'], fx.root, {});
    assert.equal(full.code, 0, full.out);
    assert.equal(main(['ctx', ID, '--json'], fx.root, {}).out, full.out);
  });

  test('more than 5 candidates list 5 names and a rest count', () => {
    const fx = fixture();
    for (const n of ['02', '03', '04', '05', '06', '07', '08']) addRun(fx, ID, `${n}-fix`);
    const out = main(['read', ID], fx.root, {}).out;
    const m = /^refused: ambiguous slug: (.+?)(?: \+(\d+))?\n$/.exec(out);
    assert.ok(m, out);
    assert.equal(m[1].split(' ').length, 5);
    assert.equal(m[2], '3');
    assert.ok(m[1].startsWith(`${ID}/08-fix `), out);
  });
});

describe('lead-handoff v3.1 CLI root in a linked worktree', () => {
  test('read <full slug> from a linked worktree cwd reads the main tree run', () => {
    const fx = fixture();
    const main0 = fx.root;
    fs.mkdirSync(path.join(main0, '.git', 'worktrees', 'wt'), { recursive: true });
    const wt = path.join(fx.base, 'wt');
    fs.mkdirSync(path.join(wt, '.company', 'work', ID, '01-feature'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main0, '.git', 'worktrees', 'wt')}\n`);
    fs.writeFileSync(path.join(main0, '.git', 'worktrees', 'wt', 'gitdir'), `${path.join(wt, '.git')}\n`);
    fs.writeFileSync(path.join(main0, '.git', 'worktrees', 'wt', 'commondir'), '../..\n');
    const run = (cwd, slug) => spawnSync(process.execPath, [SCRIPT, 'read', slug], { cwd, encoding: 'utf8', env: { ...process.env, AICO_GUARDS: 'off' } });
    const r = run(wt, SLUG);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.stdout, main(['read', SLUG], fx.root, {}).out);
    assert.equal(run(wt, ID).stdout, r.stdout);
  });

  // A linked worktree `wt` of `main0`; the worktree holds its own run folder.
  function linked(fx) {
    const main0 = fx.root;
    fs.mkdirSync(path.join(main0, '.git', 'worktrees', 'wt'), { recursive: true });
    const wt = path.join(fx.base, 'wt');
    fs.mkdirSync(path.join(wt, '.company', 'work', ID, '01-feature'), { recursive: true });
    fs.copyFileSync(path.join(fx.dir, 'run-state.jsonl'), path.join(wt, '.company', 'work', ID, '01-feature', 'run-state.jsonl'));
    fs.writeFileSync(path.join(wt, '.company', 'work', ID, '00-project.md'), 'x\n');
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main0, '.git', 'worktrees', 'wt')}\n`);
    fs.writeFileSync(path.join(main0, '.git', 'worktrees', 'wt', 'gitdir'), `${path.join(wt, '.git')}\n`);
    fs.writeFileSync(path.join(main0, '.git', 'worktrees', 'wt', 'commondir'), '../..\n');
    return wt;
  }
  const runIn = (cwd, slug) => spawnSync(process.execPath, [SCRIPT, 'read', slug], { cwd, encoding: 'utf8', env: { ...process.env, AICO_GUARDS: 'off' } });

  test('a main tree without .company/work falls back to the worktree own folder', () => {
    const fx = fixture();
    const wt = linked(fx);
    fs.rmSync(fx.work, { recursive: true, force: true });
    const r = runIn(wt, SLUG);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^handovers 0\n/);
  });

  test('a main .company/work that is a link falls back to the worktree cwd', () => {
    const fx = fixture();
    const wt = linked(fx);
    const real = path.join(fx.base, 'elsewhere');
    fs.renameSync(fx.work, real);
    try { fs.symlinkSync(real, fx.work, 'junction'); } catch { return; } // links not creatable here
    // The linked target still holds the run; reading through cwd must give the worktree's own folder.
    fs.rmSync(path.join(wt, '.company', 'work', ID, '01-feature'), { recursive: true, force: true });
    const r = runIn(wt, SLUG);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /refused: no run/);
  });
});
