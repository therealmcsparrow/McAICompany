// Tests for lead-relay v1: `open` records a form, the `answer` hook adapter records the CEO answer only on an exact form match.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, '..', '..', 'scripts', 'lead-relay.mjs');
const ID = 'P20261117.000001';
const SECRET = 'SECRET-OTHER-7731';

const tmps = [];
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-home-'));
tmps.push(home);
const env = { ...process.env, MCSPARROW_HOME: path.join(home, '.mcsparrow'), HOME: home, USERPROFILE: home };
delete env.AICO_GUARDS;
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// A product root with one running run folder per slug (a start row, no Step open).
function fixture(slugs = [`${ID}/01-feature`]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-'));
  tmps.push(root);
  const work = path.join(root, '.company', 'work');
  fs.mkdirSync(path.join(work, ID), { recursive: true });
  fs.writeFileSync(path.join(work, ID, '00-project.md'), 'Demo project\n');
  slugs.forEach((slug, i) => {
    const dir = path.join(work, ...slug.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'run-state.jsonl'), `${JSON.stringify({ v: 1, at: iso(Date.now() - 60000 + i), ev: 'start' })}\n`);
  });
  return { root, work, slugs };
}
const rowsOf = (fx, slug) => {
  const f = path.join(fx.work, ...slug.split('/'), 'forms.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const answers = (fx, slug) => rowsOf(fx, slug).filter((r) => r.ev === 'answer');

function relay(fx, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: fx.root, env, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
function hookRaw(fx, kind, input) {
  const r = spawnSync(process.execPath, [SCRIPT, kind], { cwd: fx.root, env, input, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const hook = (fx, kind, payload) => hookRaw(fx, kind, JSON.stringify({ cwd: fx.root, ...payload }));

const opt = (label, description = `${label} desc`, extra = {}) => ({ label, description, ...extra });
const single = (q = 'Which way?') => ({ q, header: 'Way', multi: false, options: [opt('Alpha'), opt('Beta'), opt('Gamma')] });
const multi = (q = 'Which parts?') => ({ q, header: 'Parts', multi: true, options: [opt('Red'), opt('Green'), opt('Blue')] });

let seq = 0;
function openForm(fx, questions, { kind = 'ask', slug = fx.slugs[0] } = {}) {
  const file = path.join(fx.root, `q-${seq++}.json`);
  fs.writeFileSync(file, JSON.stringify(questions));
  const r = relay(fx, ['open', slug, kind, file]);
  return { ...r, id: /^form: (f\d\d)$/m.exec(r.out)?.[1] ?? null };
}

// The AskUserQuestion payload main sends for a printed form.
function toolInput(questions) {
  return {
    questions: questions.map((q) => ({
      question: q.q,
      header: q.header,
      multiSelect: q.multi,
      options: q.options.map((x) => ({ label: x.label, description: x.description })),
    })),
  };
}
const answerOf = (questions, values) => ({ answers: Object.fromEntries(questions.map((q, i) => [q.q, values[i]])) });
const post = (questions, resp, extra = {}) => ({
  hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: toolInput(questions), tool_response: resp, ...extra,
});

// Open one form, then run the answer hook with a payload derived from it (`mutate` edits the payload last).
function roundTrip(questions, { mutate, resp, extra, kind } = {}) {
  const fx = fixture();
  const f = openForm(fx, questions, { kind });
  assert.equal(f.code, 0, f.out + f.err);
  const p = post(questions, resp ?? answerOf(questions, questions.map((q) => q.options[0].label)), extra);
  if (mutate) mutate(p);
  const h = hook(fx, 'answer', p);
  return { fx, f, h, rows: answers(fx, fx.slugs[0]) };
}

describe('lead-relay answer: recorded picks (AC4)', () => {
  test('single question, one label', () => {
    const qs = [single()];
    const { h, rows, f } = roundTrip(qs, { resp: answerOf(qs, ['Beta']) });
    assert.equal(h.code, 0);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].answers, [{ labels: ['Beta'], other: null }]);
    assert.equal(rows[0].id, f.id);
    assert.equal(rows[0].src, 'hook');
    assert.equal(rows[0].v, 1);
    assert.match(rows[0].at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });
  test('single question, Other text', () => {
    const qs = [single()];
    const { rows, h } = roundTrip(qs, { resp: answerOf(qs, [SECRET]) });
    assert.deepEqual(rows[0].answers, [{ labels: [], other: SECRET }]);
    assert.ok(!h.err.includes(SECRET) && !h.out.includes(SECRET), 'Other text stays out of hook output');
  });
  test('multi question, labels joined with ", "', () => {
    const qs = [multi()];
    const { rows } = roundTrip(qs, { resp: answerOf(qs, ['Blue, Red']) });
    assert.deepEqual(rows[0].answers, [{ labels: ['Blue', 'Red'], other: null }]);
  });
  test('multi question, labels plus Other text', () => {
    const qs = [multi()];
    const { rows, h } = roundTrip(qs, { resp: answerOf(qs, [`Green, ${SECRET}`]) });
    assert.deepEqual(rows[0].answers, [{ labels: ['Green'], other: SECRET }]);
    assert.ok(!h.err.includes(SECRET) && !h.out.includes(SECRET));
  });
  test('two questions, one answer each', () => {
    const qs = [single('First?'), multi('Second?')];
    const { rows } = roundTrip(qs, { resp: answerOf(qs, ['Gamma', 'Red, Green']) });
    assert.deepEqual(rows[0].answers, [{ labels: ['Gamma'], other: null }, { labels: ['Red', 'Green'], other: null }]);
  });
  test('single question with multiSelect absent in the payload still matches', () => {
    const { rows } = roundTrip([single()], { mutate: (p) => { delete p.tool_input.questions[0].multiSelect; } });
    assert.equal(rows.length, 1);
  });
  test('Gate form (single-select, results) records the picked label', () => {
    const qs = [{ q: 'Pass the brief?', header: 'Brief', multi: false, options: [opt('Approve', 'go', { result: 'pass' }), opt('Revise', 'again', { result: 'fix' })] }];
    const { rows } = roundTrip(qs, { kind: 'gate:brief', resp: answerOf(qs, ['Approve']) });
    assert.deepEqual(rows[0].answers, [{ labels: ['Approve'], other: null }]);
  });
  test('both tool_input.answers and tool_response.answers set: row written', () => {
    const qs = [single()];
    const { rows } = roundTrip(qs, { resp: answerOf(qs, ['Alpha']), mutate: (p) => { p.tool_input.answers = { 'Which way?': 'Alpha' }; } });
    assert.equal(rows.length, 1);
  });
});

describe('lead-relay answer: no row (fail closed, cch.M20, cch.M-SEC8)', () => {
  test('multi value as an array', () => {
    const qs = [multi()];
    assert.equal(roundTrip(qs, { resp: answerOf(qs, [['Red', 'Blue']]) }).rows.length, 0);
  });
  test('value is a number', () => {
    const qs = [single()];
    assert.equal(roundTrip(qs, { resp: answerOf(qs, [3]) }).rows.length, 0);
  });
  test('value is null', () => {
    const qs = [single()];
    assert.equal(roundTrip(qs, { resp: answerOf(qs, [null]) }).rows.length, 0);
  });
  test('missing key', () => {
    assert.equal(roundTrip([single()], { resp: { answers: {} } }).rows.length, 0);
  });
  test('foreign key only', () => {
    assert.equal(roundTrip([single()], { resp: { answers: { 'Something else?': 'Alpha' } } }).rows.length, 0);
  });
  test('second question missing from the map', () => {
    assert.equal(roundTrip([single('First?'), single('Second?')], { resp: { answers: { 'First?': 'Alpha' } } }).rows.length, 0);
  });
  test('declined: no answers key', () => {
    const { rows, h } = roundTrip([single()], { resp: { error: 'declined' } });
    assert.equal(h.code, 0);
    assert.equal(rows.length, 0);
  });
  test('tool_response absent', () => {
    assert.equal(roundTrip([single()], { mutate: (p) => { delete p.tool_response; } }).rows.length, 0);
  });
  test('answers is a list', () => {
    assert.equal(roundTrip([single()], { resp: { answers: ['Alpha'] } }).rows.length, 0);
  });
  test('payload with agent_id (a Lead or Role)', () => {
    const { rows, h } = roundTrip([single()], { extra: { agent_id: 'a1', agent_type: 'aico:project-manager' } });
    assert.equal(h.code, 0);
    assert.equal(rows.length, 0);
  });
  test('tool_input.answers alone gives no row', () => {
    const { rows } = roundTrip([single()], { mutate: (p) => { delete p.tool_response; p.tool_input.answers = { 'Which way?': 'Alpha' }; } });
    assert.equal(rows.length, 0);
  });
  test('tool_name is not AskUserQuestion', () => {
    assert.equal(roundTrip([single()], { extra: { tool_name: 'Bash' } }).rows.length, 0);
  });
  test('payload that is not JSON', () => {
    const fx = fixture();
    openForm(fx, [single()]);
    assert.equal(hookRaw(fx, 'answer', 'not json{').code, 0);
    assert.equal(answers(fx, fx.slugs[0]).length, 0);
  });
  test('no open form: nothing written, exit 0', () => {
    const fx = fixture();
    const qs = [single()];
    assert.equal(hook(fx, 'answer', post(qs, answerOf(qs, ['Alpha']))).code, 0);
    assert.equal(rowsOf(fx, fx.slugs[0]).length, 0);
  });
  test('no active run: exit 0', () => {
    const fx = fixture([]);
    const qs = [single()];
    assert.equal(hook(fx, 'answer', post(qs, answerOf(qs, ['Alpha']))).code, 0);
  });
  test('two matching open forms (two runs): no row in either', () => {
    const fx = fixture([`${ID}/01-feature`, `${ID}/02-fix`]);
    const qs = [single()];
    assert.equal(openForm(fx, qs, { slug: fx.slugs[0] }).code, 0);
    // `open` refuses the second form, so write the same open row straight into run 2.
    const first = rowsOf(fx, fx.slugs[0])[0];
    fs.writeFileSync(path.join(fx.work, ...fx.slugs[1].split('/'), 'forms.jsonl'), `${JSON.stringify(first)}\n`);
    hook(fx, 'answer', post(qs, answerOf(qs, ['Alpha'])));
    assert.equal(answers(fx, fx.slugs[0]).length +answers(fx, fx.slugs[1]).length, 0);
  });
  test('an already answered form gets no second answer', () => {
    const qs = [single()];
    const { fx } = roundTrip(qs);
    hook(fx, 'answer', post(qs, answerOf(qs, ['Beta'])));
    assert.equal(answers(fx, fx.slugs[0]).length, 1);
  });
});

describe('lead-relay answer: any compared field that differs gives no row (AC4)', () => {
  const diffs = {
    'changed question text': (q) => { q.question = 'Which way now?'; },
    'changed header': (q) => { q.header = 'Other'; },
    'multiSelect flipped': (q) => { q.multiSelect = true; },
    'one option description changed': (q) => { q.options[1].description = 'changed'; },
    'trailing space in a description': (q) => { q.options[0].description += ' '; },
    'one option label changed': (q) => { q.options[1].label = 'Bravo'; },
    'option order changed': (q) => { q.options.reverse(); },
    'option removed': (q) => { q.options.pop(); },
    'option added': (q) => { q.options.push({ label: 'Delta', description: 'd' }); },
  };
  for (const [name, edit] of Object.entries(diffs)) {
    test(name, () => {
      const { rows, h } = roundTrip([single()], {
        mutate: (p) => {
          edit(p.tool_input.questions[0]);
          p.tool_response = { answers: { [p.tool_input.questions[0].question]: 'Alpha', 'Which way?': 'Alpha' } };
        },
      });
      assert.equal(h.code, 0);
      assert.equal(rows.length, 0);
    });
  }
  test('question removed', () => {
    const { rows } = roundTrip([single()], { mutate: (p) => { p.tool_input.questions = []; } });
    assert.equal(rows.length, 0);
  });
  test('question added', () => {
    const { rows } = roundTrip([single()], {
      mutate: (p) => {
        p.tool_input.questions.push({ question: 'Extra?', header: 'X', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] });
        p.tool_response = { answers: { 'Which way?': 'Alpha', 'Extra?': 'A' } };
      },
    });
    assert.equal(rows.length, 0);
  });
});

describe('lead-relay open: refused forms (cch.M21)', () => {
  function refused(questions, kind = 'ask') {
    const fx = fixture();
    const r = openForm(fx, questions, { kind });
    assert.equal(r.code, 1, `exit code, output: ${r.out}${r.err}`);
    assert.match(r.out + r.err, /refused: /);
    assert.equal(rowsOf(fx, fx.slugs[0]).length, 0, 'nothing written');
  }
  const two = (extra = {}) => ({ q: 'Q?', header: 'H', multi: false, options: [opt('Yes'), opt('No')], ...extra });
  test('duplicate question text', () => refused([single('Same?'), multi('Same?')]));
  test('multi question in a Gate form', () => refused([two({ multi: true, options: [opt('Yes', 'y', { result: 'pass' }), opt('No', 'n', { result: 'fix' })] })], 'gate:plan'));
  test('Gate option without a result', () => refused([single()], 'gate:ship'));
  test('result on a non-Gate form', () => refused([two({ options: [opt('A', 'a', { result: 'pass' }), opt('B')] })]));
  test('option label with a comma', () => refused([two({ options: [opt('Yes, now'), opt('No')] })]));
  test('option label with an em dash', () => refused([two({ options: [opt('Yes — now'), opt('No')] })]));
  test('header with ]', () => refused([two({ header: 'A]B' })]));
  test('header over 12 characters', () => refused([two({ header: 'x'.repeat(13) })]));
  test('one option', () => refused([two({ options: [opt('Yes')] })]));
  test('five options', () => refused([two({ options: ['a', 'b', 'c', 'd', 'e'].map((l) => opt(l)) })]));
  test('five questions', () => refused(['1', '2', '3', '4', '5'].map((n) => single(`Q${n}?`))));
  test('no questions', () => refused([]));
  test('unknown kind', () => refused([single()], 'bogus'));
  const breaks = {
    question: { q: 'Line\none?' },
    header: { header: 'a\nb' },
    label: { options: [opt('A\nB'), opt('No')] },
    description: { options: [opt('Yes', 'a\nb'), opt('No')] },
    'carriage return': { options: [opt('Yes', 'a\rb'), opt('No')] },
  };
  for (const [name, patch] of Object.entries(breaks)) {
    test(`line break in ${name}`, () => refused([two(patch)]));
  }
  test('a second form while one is unanswered', () => {
    const fx = fixture();
    assert.equal(openForm(fx, [single()]).code, 0);
    const r = openForm(fx, [single('Another?')]);
    assert.equal(r.code, 1);
    assert.match(r.out + r.err, /refused: open form f\d\d/);
    assert.equal(rowsOf(fx, fx.slugs[0]).filter((x) => x.ev === 'open').length, 1);
  });
});

describe('lead-relay open: STATUS block (AC3)', () => {
  test('records the form and prints needs-ceo with questions and options in order', () => {
    const fx = fixture();
    const r = openForm(fx, [single('First?'), multi('Second?')]);
    assert.equal(r.code, 0, r.out + r.err);
    const lines = r.out.trimEnd().split('\n');
    assert.equal(lines[0], 'STATUS: needs-ceo');
    assert.ok(lines.includes(`run: .company/work/${fx.slugs[0]}`));
    assert.ok(lines.some((l) => /^handoff: \S/.test(l)));
    assert.ok(lines.includes(`form: ${r.id}`));
    assert.ok(lines.includes('Q1 [Way]: First?'));
    assert.ok(lines.indexOf('- Alpha — Alpha desc') < lines.indexOf('- Beta — Beta desc'));
    const rows = rowsOf(fx, fx.slugs[0]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ev, 'open');
    assert.equal(rows[0].kind, 'ask');
    assert.match(rows[0].id, /^f\d\d$/);
    assert.equal(rows[0].questions.length, 2);
  });
  test('(multi) marker on a multi question, none on a single one', () => {
    const fx = fixture();
    const lines = openForm(fx, [single('First?'), multi('Second?')]).out.split('\n');
    assert.ok(lines.includes('Q1 [Way]: First?'));
    assert.ok(lines.includes('Q2 [Parts] (multi): Second?'));
    assert.ok(!lines.some((l) => /^Q1 .*\(multi\)/.test(l)));
  });
  test('largest form stays under 40 lines', () => {
    const fx = fixture();
    const qs = [1, 2, 3, 4].map((n) => ({ q: `Question ${n}?`, header: `H${n}`, multi: n % 2 === 0, options: ['a', 'b', 'c', 'd'].map((l) => opt(`${l}${n}`)) }));
    const r = openForm(fx, qs);
    assert.equal(r.code, 0, r.out + r.err);
    assert.ok(r.out.trimEnd().split('\n').length < 40);
  });
  test('again prints the same block for an open, unanswered form', () => {
    const fx = fixture();
    const r = openForm(fx, [single()]);
    const a = relay(fx, ['again', fx.slugs[0], r.id]);
    assert.equal(a.code, 0, a.out + a.err);
    assert.equal(a.out, r.out);
  });
  test('again for an unknown id is refused', () => {
    const fx = fixture();
    openForm(fx, [single()]);
    const a = relay(fx, ['again', fx.slugs[0], 'f99']);
    assert.equal(a.code, 1);
    assert.match(a.out + a.err, /refused: /);
  });
  test('a form whose payload changed has no answer and is asked again (AC4)', () => {
    const { fx, f, rows } = roundTrip([single()], { mutate: (p) => { p.tool_input.questions[0].header = 'Changed'; } });
    assert.equal(rows.length, 0);
    const a = relay(fx, ['again', fx.slugs[0], f.id]);
    assert.equal(a.code, 0, a.out + a.err);
    assert.equal(a.out, f.out);
  });
});

describe('lead-relay: Other text stays private (proj.M-SEC9)', () => {
  test('absent from every script output; read --json shows it', () => {
    const qs = [single()];
    const { fx, f, h } = roundTrip(qs, { resp: answerOf(qs, [SECRET]) });
    for (const o of [f, h]) assert.ok(!o.out.includes(SECRET) && !o.err.includes(SECRET));
    const r = relay(fx, ['read', fx.slugs[0], f.id, '--json']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.ok(r.out.includes(SECRET), 'the Lead reads the text from read --json');
    assert.ok(!r.err.includes(SECRET));
  });
  test('read --json of an unanswered form says answer: none', () => {
    const fx = fixture();
    const f = openForm(fx, [single()]);
    const r = relay(fx, ['read', fx.slugs[0], f.id, '--json']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /answer: none/);
  });
});
