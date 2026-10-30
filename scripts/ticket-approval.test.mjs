import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './ticket-approval.mjs';
import * as markdown from './plan-markdown.mjs';

// Local time, the way the script names a roadmap file.
const NOW = new Date(2026, 9, 30, 13, 9, 0).getTime();
const BASE = 'a'.repeat(40);
const ZERO = '000000000000';

const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function ticket(id, o = {}) {
  return [
    `### ${id} ${o.title ?? `title of ${id}`}`,
    `- role: ${o.role ?? 'backend-engineer'}`,
    `- files: ${o.files ?? `src/${id.toLowerCase()}.mjs`}`,
    `- depends-on: ${o.deps ?? 'none'}`,
    ...(o.extra ?? []),
    ''
  ].join('\n');
}

const planText = (...blocks) => `${[
  '# Plan: demo', '', `Base commit: ${BASE}`, '',
  '## Decided (plan-wide)', '- Decided: keep it small, because the CEO said so.', '- Decided: no emoji.', '',
  '## Tasks', '', ...blocks
].join('\n')}\n`;

function fixture(text = planText(ticket('T1'), ticket('T2'), ticket('T3')), { slug = 'demo', name = 'plan.md', core = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-approval-'));
  roots.push(base);
  const root = path.join(base, 'product');
  const dir = path.join(root, '.company', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  if (text !== null) fs.writeFileSync(path.join(dir, name), text);
  if (core) {
    fs.writeFileSync(path.join(root, '.company', 'project.md'), [
      '# Project profile', '', '## Core', '- skills/pipeline: run setup', '- scripts/check.mjs: gate', '', '## Modules', '- skills/other: x', ''
    ].join('\n'));
  }
  const run = (...args) => main(args, { now: NOW, root });
  const record = path.join(dir, 'tickets.jsonl');
  const lines = () => fs.readFileSync(record, 'utf8').split('\n').filter(Boolean);
  const events = () => lines().map((l) => JSON.parse(l));
  const write = (t) => fs.writeFileSync(path.join(dir, name), t);
  return { base, root, dir, run, slug, name, record, lines, events, write };
}

const sha12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

// Appends a well-formed, correctly chained line, as anyone with a shell could.
function forgeLine(fx, fields) {
  const existing = fx.record && fs.existsSync(fx.record) ? fx.lines() : [];
  const prev = existing.length ? sha12(existing.at(-1)) : ZERO;
  const rec = { v: 1, n: existing.length + 1, prev, at: '2026-10-30T10:00:00Z', ...fields };
  fs.appendFileSync(fx.record, `${JSON.stringify(rec)}\n`);
}

function startPlan(fx, phase = 'd') {
  const r = fx.run('tickets', fx.slug, fx.name, '--phase', phase);
  assert.equal(r.code, 0, r.lines.join('\n'));
  return r;
}

describe('module seam', () => {
  test('plan-markdown exports the line reader this script needs', () => {
    assert.equal(typeof markdown.readPlanLines, 'function');
  });

  test('the script reads blocks only through plan-markdown and starts no child process', () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, 'ticket-approval.mjs'), 'utf8');
    assert.match(src, /from '\.\/plan-markdown\.mjs'/);
    assert.doesNotMatch(src, /child_process|execSync|spawn|execFile/);
    assert.doesNotMatch(src, /from '(?!node:|\.\/plan-markdown\.mjs)/);
    assert.equal(src.includes('\r'), false);
  });
});

describe('tickets', () => {
  test('phase d asks every ticket', () => {
    const fx = fixture();
    const r = startPlan(fx, 'd');
    assert.deepEqual(r.lines, ['tickets 3 phase d', 'ask T1 new', 'ask T2 new', 'ask T3 new']);
  });

  test('approved unchanged ticket is never asked again', () => {
    const fx = fixture();
    startPlan(fx, 'd');
    assert.equal(fx.run('ticket', fx.slug, 'T1', 'approve').code, 0);
    assert.equal(fx.run('ticket', fx.slug, 'T2', 'approve').code, 0);
    const f = startPlan(fx, 'f');
    assert.deepEqual(f.lines, ['tickets 3 phase f', 'skip T1 approved', 'skip T2 approved', 'ask T3 new']);
    // asking again changes nothing
    assert.deepEqual(startPlan(fx, 'f').lines, f.lines);
  });

  test('a changed block is asked again, the others stay skipped', () => {
    const fx = fixture();
    startPlan(fx, 'd');
    for (const id of ['T1', 'T2', 'T3']) fx.run('ticket', fx.slug, id, 'approve');
    fx.write(planText(ticket('T1'), ticket('T2', { extra: ['Also handle the empty case.'] }), ticket('T3')));
    assert.deepEqual(startPlan(fx, 'f').lines, ['tickets 3 phase f', 'skip T1 approved', 'ask T2 changed', 'skip T3 approved']);
  });

  test('a changed field and a changed heading change the hash', () => {
    for (const edit of [
      ticket('T1', { files: 'src/other.mjs' }),
      ticket('T1', { role: 'qa' }),
      ticket('T1', { title: 'renamed' })
    ]) {
      const fx = fixture(planText(ticket('T1')));
      startPlan(fx);
      fx.run('ticket', fx.slug, 'T1', 'approve');
      fx.write(planText(edit));
      assert.deepEqual(startPlan(fx, 'f').lines, ['tickets 1 phase f', 'ask T1 changed']);
    }
  });

  test('CRLF, trailing spaces, tabs and blank lines at the block end keep the hash', () => {
    const fx = fixture(planText(ticket('T1'), ticket('T2')));
    startPlan(fx);
    fx.run('ticket', fx.slug, 'T1', 'approve');
    const noisy = planText(ticket('T1'), ticket('T2')).replace('- role: backend-engineer', '- role: backend-engineer  \t').replace(/\n/g, '\r\n');
    fx.write(`${noisy}\r\n\r\n`);
    assert.deepEqual(startPlan(fx, 'f').lines, ['tickets 2 phase f', 'skip T1 approved', 'ask T2 new']);
  });

  test('a change pick or a park pick retracts an approval at that hash', () => {
    const fx = fixture(planText(ticket('T1')));
    startPlan(fx);
    fx.run('ticket', fx.slug, 'T1', 'approve');
    fx.run('ticket', fx.slug, 'T1', 'change');
    assert.deepEqual(startPlan(fx, 'f').lines, ['tickets 1 phase f', 'ask T1 changed']);
    fx.run('ticket', fx.slug, 'T1', 'approve');
    assert.deepEqual(startPlan(fx, 'f').lines, ['tickets 1 phase f', 'skip T1 approved']);
  });

  test('sub-headings and fenced headings stay inside the block', () => {
    const body = ['#### notes', 'text', '```', '### T9 not a ticket', '```'];
    const fx = fixture(planText(ticket('T1', { extra: body }), ticket('T2')));
    assert.deepEqual(startPlan(fx).lines, ['tickets 2 phase d', 'ask T1 new', 'ask T2 new']);
    fx.run('ticket', fx.slug, 'T1', 'approve');
    fx.write(planText(ticket('T1', { extra: [...body, 'more'] }), ticket('T2')));
    assert.deepEqual(startPlan(fx, 'f').lines, ['tickets 2 phase f', 'ask T1 changed', 'ask T2 new']);
  });

  test('core and contract flags follow the files field', () => {
    const fx = fixture(planText(
      ticket('T1', { files: 'skills/pipeline/SKILL.md, src/a.mjs' }),
      ticket('T2', { files: 'docs/contracts/x.md' }),
      ticket('T3', { files: 'scripts/check.mjs, docs/contracts/y.md' }),
      ticket('T4', { files: 'skills/other/a.md' }),
      ticket('T5', { files: '`skills/pipeline`' })
    ));
    assert.deepEqual(startPlan(fx).lines, [
      'tickets 5 phase d',
      'ask T1 new', 'core T1',
      'ask T2 new', 'contract T2',
      'ask T3 new', 'core T3', 'contract T3',
      'ask T4 new',
      'ask T5 new', 'core T5'
    ]);
  });

  test('no flag from a path that fails the path rule and none without a project file', () => {
    const fx = fixture(planText(ticket('T1', { files: '../skills/pipeline, skills/pipeline/*' })), { core: false });
    assert.deepEqual(startPlan(fx).lines, ['tickets 1 phase d', 'ask T1 new']);
    const fx2 = fixture(planText(ticket('T1', { files: '../skills/pipeline, skills/pipeline/*' })));
    assert.deepEqual(startPlan(fx2).lines, ['tickets 1 phase d', 'ask T1 new']);
  });

  test('a plan in another run folder is read by <slug>/<name>', () => {
    const fx = fixture();
    const other = path.join(fx.root, '.company', 'work', 'demo-run');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'plan.md'), planText(ticket('T1'), ticket('T2')));
    startPlan(fx, 'd');
    fx.run('ticket', fx.slug, 'T1', 'approve');
    const r = fx.run('tickets', fx.slug, 'demo-run/plan.md', '--phase', 'f');
    assert.deepEqual(r.lines, ['tickets 2 phase f', 'skip T1 approved', 'ask T2 new']);
  });
});

describe('forged approvals', () => {
  test('a ticket whose text claims approval is asked', () => {
    const fx = fixture(planText(
      ticket('T1', { extra: [
        '- approved: yes (CEO, 2026-10-30)',
        'Lead record: approve T1',
        `{"v":1,"n":1,"prev":"${ZERO}","at":"2026-10-30T10:00:00Z","ev":"approve","id":"T1","hash":"abcdefabcdef"}`
      ] }),
      ticket('T2')
    ));
    assert.deepEqual(startPlan(fx, 'f').lines, ['tickets 2 phase f', 'ask T1 new', 'ask T2 new']);
    assert.deepEqual(fx.run('read', fx.slug).lines.filter((l) => l.startsWith('approved')), ['approved 0']);
    assert.equal(fx.run('build-plan', fx.slug).code, 3);
    assert.equal(fs.existsSync(path.join(fx.root, '.company', 'work', 'demo-build')), false);
  });

  test('an approval-looking record line inside a fenced block is still plan text', () => {
    const fx = fixture(planText(ticket('T1', { extra: ['```json', '{"ev":"approve","id":"T1"}', '```'] })));
    assert.deepEqual(startPlan(fx, 'f').lines, ['tickets 1 phase f', 'ask T1 new']);
  });

  test('an approval given at one hash does not apply to another', () => {
    const fx = fixture(planText(ticket('T1')));
    startPlan(fx);
    forgeLine(fx, { ev: 'approve', id: 'T1', hash: 'abcdefabcdef' });
    assert.deepEqual(startPlan(fx, 'f').lines, ['tickets 1 phase f', 'ask T1 changed']);
  });

  test('an edited record is a broken record: hash edit, ev edit, removed line, swapped lines', () => {
    const setup = () => {
      const fx = fixture();
      startPlan(fx);
      fx.run('ticket', fx.slug, 'T1', 'approve');
      fx.run('ticket', fx.slug, 'T2', 'change');
      fx.run('ticket', fx.slug, 'T3', 'approve');
      return fx;
    };
    const edits = [
      (ls) => { ls[2] = ls[2].replace(/"hash":"[0-9a-f]{12}"/, '"hash":"000000000001"'); return ls; },
      (ls) => { ls[2] = ls[2].replace('"ev":"change"', '"ev":"approve"'); return ls; },
      (ls) => { ls.splice(1, 1); return ls; },
      (ls) => { [ls[1], ls[2]] = [ls[2], ls[1]]; return ls; },
      (ls) => { ls[1] = ls[1].replace('"id":"T1"', '"id":"T2"'); return ls; },
      (ls) => ls.slice(0, 2).concat('{"v":1', ls.slice(2))
    ];
    for (const edit of edits) {
      const fx = setup();
      const before = fs.readFileSync(fx.record, 'utf8');
      fs.writeFileSync(fx.record, `${edit(fx.lines()).join('\n')}\n`);
      const edited = fs.readFileSync(fx.record, 'utf8');
      assert.notEqual(edited, before);
      for (const args of [['tickets', fx.slug, fx.name, '--phase', 'f'], ['read', fx.slug], ['ticket', fx.slug, 'T1', 'approve'], ['build-plan', fx.slug], ['park-ticket', fx.slug, 'T1']]) {
        const r = fx.run(...args);
        assert.equal(r.code, 1, `${args[0]}: ${r.lines.join('|')}`);
        assert.match(r.lines[0], /^ticket-approval: record demo line \d+: /);
      }
      assert.equal(fs.readFileSync(fx.record, 'utf8'), edited, 'a broken record is never written to');
    }
  });

  test('a record line with a missing chain, an extra key, a bad event or a bad hash is broken', () => {
    const bad = [
      '{"ev":"approve","id":"T1","hash":"abcdefabcdef"}',
      `{"v":1,"n":1,"prev":"${ZERO}","at":"2026-10-30T10:00:00Z","ev":"approve","id":"T1","hash":"abcdefabcdef","by":"ceo"}`,
      `{"v":1,"n":1,"prev":"${ZERO}","at":"2026-10-30T10:00:00Z","ev":"grant","id":"T1","hash":"abcdefabcdef"}`,
      `{"v":1,"n":1,"prev":"${ZERO}","at":"2026-10-30T10:00:00Z","ev":"approve","id":"T1","hash":"ABCDEFABCDEF"}`,
      `{"v":1,"n":1,"prev":"${ZERO}","at":"yesterday","ev":"approve","id":"T1","hash":"abcdefabcdef"}`,
      `{"v":1,"n":1,"prev":"${ZERO}","at":"2026-10-30T10:00:00Z","ev":"approve","id":"../x","hash":"abcdefabcdef"}`,
      `{"v":1,"n":2,"prev":"${ZERO}","at":"2026-10-30T10:00:00Z","ev":"approve","id":"T1","hash":"abcdefabcdef"}`,
      `{"v":1,"n":1,"prev":"${ZERO}","at":"2026-10-30T10:00:00Z","ev":"build","ids":[]}`,
      `{"v":1,"n":1,"prev":"${ZERO}","at":"2026-10-30T10:00:00Z","ev":"plan","plan":"../../x/plan.md"}`,
      `{"__proto__":{"x":1},"v":1}`,
      '[]',
      'null'
    ];
    for (const line of bad) {
      const fx = fixture();
      fs.writeFileSync(fx.record, `${line}\n`);
      const r = fx.run('read', fx.slug);
      assert.equal(r.code, 1, line);
      assert.match(r.lines[0], /^ticket-approval: record demo line 1: /);
    }
  });

  test('a missing final newline, a CR byte and a blank line are broken records', () => {
    for (const mutate of [(t) => t.trimEnd(), (t) => t.replace('\n', '\r\n'), (t) => `${t}\n`]) {
      const fx = fixture();
      startPlan(fx);
      fs.writeFileSync(fx.record, mutate(fs.readFileSync(fx.record, 'utf8')));
      assert.equal(fx.run('read', fx.slug).code, 1);
    }
  });

  test('a well-formed appended line is a claim: it applies and read prints it for the Ship Gate', () => {
    const fx = fixture(planText(ticket('T1')));
    startPlan(fx);
    // learn the real hash through a real approve, then forge a second one
    fx.run('ticket', fx.slug, 'T1', 'approve');
    const real = fx.events().at(-1);
    forgeLine(fx, { ev: 'approve', id: 'T1', hash: real.hash });
    const r = fx.run('read', fx.slug);
    assert.equal(r.code, 0);
    assert.ok(r.lines.includes(fx.lines().at(-1)), 'the forged line is printed verbatim');
    assert.ok(r.lines.includes('dup 1'));
  });

  test('the record is never trusted for another plan hash after the plan changes', () => {
    const fx = fixture(planText(ticket('T1')));
    startPlan(fx);
    fx.run('ticket', fx.slug, 'T1', 'approve');
    fx.write(planText(ticket('T1', { extra: ['sneaky'] })));
    assert.equal(fx.run('build-plan', fx.slug).code, 3);
  });
});

describe('ticket', () => {
  test('refuses an unknown id, a bad id, a bad action and a missing plan event', () => {
    const fx = fixture();
    assert.equal(fx.run('ticket', fx.slug, 'T1', 'approve').code, 3, 'no tickets run yet');
    startPlan(fx);
    for (const args of [['T9', 'approve'], ['t1', 'approve'], ['T1', 'yes'], ['T1'], ['../T1', 'approve'], ['T1', 'approve', 'extra']]) {
      const r = fx.run('ticket', fx.slug, ...args);
      assert.equal(r.code, 3, args.join(' '));
      assert.match(r.lines[0], /^refused: /);
    }
    assert.equal(fx.events().length, 1, 'only the plan event was written');
  });

  test('writes the event with the current block hash, UTC time and chain', () => {
    const fx = fixture();
    startPlan(fx);
    fx.run('ticket', fx.slug, 'T2', 'approve');
    const ls = fx.lines();
    assert.equal(ls.length, 2);
    const [plan, ev] = ls.map((l) => JSON.parse(l));
    const at = new Date(NOW).toISOString().replace(/\.\d{3}Z$/, 'Z');
    assert.deepEqual(plan, { v: 1, n: 1, prev: ZERO, at, ev: 'plan', plan: 'demo/plan.md' });
    assert.equal(ev.at, at);
    assert.equal(ev.n, 2);
    assert.equal(ev.prev, sha12(ls[0]));
    assert.match(ev.hash, /^[0-9a-f]{12}$/);
    assert.equal(ev.id, 'T2');
  });

  test('dup counts repeated approvals for one id and hash', () => {
    const fx = fixture(planText(ticket('T1'), ticket('T2')));
    startPlan(fx);
    assert.ok(fx.run('read', fx.slug).lines.includes('dup 0'));
    fx.run('ticket', fx.slug, 'T1', 'approve');
    fx.run('ticket', fx.slug, 'T1', 'approve');
    fx.run('ticket', fx.slug, 'T1', 'approve');
    fx.run('ticket', fx.slug, 'T2', 'approve');
    assert.ok(fx.run('read', fx.slug).lines.includes('dup 2'));
    // an approve at a new hash is not a repeat
    fx.write(planText(ticket('T1', { extra: ['x'] }), ticket('T2')));
    startPlan(fx, 'f');
    fx.run('ticket', fx.slug, 'T1', 'approve');
    assert.ok(fx.run('read', fx.slug).lines.includes('dup 2'));
  });

  test('read prints state none without a record', () => {
    const fx = fixture();
    assert.deepEqual(fx.run('read', fx.slug), { code: 0, lines: ['state none'] });
  });

  test('read prints each applied approve line as stored, none for a stale one', () => {
    const fx = fixture(planText(ticket('T1'), ticket('T2')));
    startPlan(fx);
    fx.run('ticket', fx.slug, 'T1', 'approve');
    fx.run('ticket', fx.slug, 'T2', 'approve');
    const stored = fx.lines();
    let r = fx.run('read', fx.slug);
    assert.deepEqual(r.lines.slice(0, 5), ['state on', 'plan demo/plan.md', 'events 3', 'dup 0', 'approved 2']);
    assert.deepEqual(r.lines.slice(5), [stored[1], stored[2]]);
    fx.write(planText(ticket('T1'), ticket('T2', { extra: ['x'] })));
    r = fx.run('read', fx.slug);
    assert.deepEqual(r.lines.slice(4), ['approved 1', stored[1]]);
  });
});

describe('park-ticket', () => {
  const roadmap = (fx) => path.join(fx.root, '.company', 'roadmap');

  test('writes a roadmap file in the brainstorm naming form, then records parked', () => {
    const fx = fixture(planText(ticket('T1', { title: 'Cache the thing, quickly!' }), ticket('T2')));
    startPlan(fx);
    fx.run('ticket', fx.slug, 'T1', 'park');
    const r = fx.run('park-ticket', fx.slug, 'T1');
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.deepEqual(r.lines, ['parked T1 2026-10-30 13.09 - Cache the thing quickly.md']);
    const text = fs.readFileSync(path.join(roadmap(fx), '2026-10-30 13.09 - Cache the thing quickly.md'), 'utf8');
    assert.match(text, /^# Cache the thing quickly\n/);
    assert.ok(text.includes('### T1 Cache the thing, quickly!'));
    assert.ok(text.includes('demo'));
    assert.equal(text.includes('\r'), false);
    const last = fx.events().at(-1);
    assert.equal(last.ev, 'parked');
    assert.equal(last.file, '2026-10-30 13.09 - Cache the thing quickly.md');
    assert.deepEqual(startPlan(fx, 'f').lines, ['tickets 2 phase f', 'skip T1 parked', 'ask T2 new']);
  });

  test('refused without the CEO park pick, for approve picks and for stale picks', () => {
    const fx = fixture(planText(ticket('T1')));
    startPlan(fx);
    assert.equal(fx.run('park-ticket', fx.slug, 'T1').code, 3);
    fx.run('ticket', fx.slug, 'T1', 'approve');
    assert.equal(fx.run('park-ticket', fx.slug, 'T1').code, 3);
    fx.run('ticket', fx.slug, 'T1', 'park');
    fx.write(planText(ticket('T1', { extra: ['x'] })));
    assert.equal(fx.run('park-ticket', fx.slug, 'T1').code, 3);
    assert.equal(fs.existsSync(roadmap(fx)), false);
    assert.equal(fx.run('park-ticket', fx.slug, 'T9').code, 3);
  });

  test('refused while an unparked ticket depends on it', () => {
    const fx = fixture(planText(ticket('T1'), ticket('T2', { deps: 'T1' }), ticket('T3', { deps: '`T1`, T2' })));
    startPlan(fx);
    fx.run('ticket', fx.slug, 'T1', 'park');
    let r = fx.run('park-ticket', fx.slug, 'T1');
    assert.equal(r.code, 3);
    assert.match(r.lines[0], /^refused: T2 depends on T1 and is not parked$/);
    fx.run('ticket', fx.slug, 'T2', 'park');
    fx.run('ticket', fx.slug, 'T3', 'park');
    assert.equal(fx.run('park-ticket', fx.slug, 'T3').code, 0);
    assert.equal(fx.run('park-ticket', fx.slug, 'T1').code, 3, 'T2 still unparked');
    assert.equal(fx.run('park-ticket', fx.slug, 'T2').code, 0);
    r = fx.run('park-ticket', fx.slug, 'T1');
    assert.equal(r.code, 0, r.lines.join('\n'));
  });

  test('the title is cut to a safe file name', () => {
    const cases = [
      ['..\\..\\evil/../x: <b>"q"|*?', 'evilx bq'],
      ['Trailing dots...   ', 'Trailing dots'],
      ['  many   spaces   here ', 'many spaces here'],
      ['Ünïcode café 日本', 'ncode caf'],
      ['a'.repeat(200), 'a'.repeat(60)],
      ['!!!', 'T1'],
      ['x'.repeat(59) + ' yyyy', `${'x'.repeat(59)}`]
    ];
    for (const [title, want] of cases) {
      const fx = fixture(planText(ticket('T1', { title })));
      startPlan(fx);
      fx.run('ticket', fx.slug, 'T1', 'park');
      const r = fx.run('park-ticket', fx.slug, 'T1');
      assert.equal(r.code, 0, `${title}: ${r.lines.join('|')}`);
      const names = fs.readdirSync(roadmap(fx));
      assert.deepEqual(names, [`2026-10-30 13.09 - ${want}.md`], title);
    }
  });

  test('a Windows device name as the title is refused', () => {
    for (const title of ['con', 'NUL', 'Com1', 'lpt9', 'aux', 'prn', 'con.', 'Nul...']) {
      const fx = fixture(planText(ticket('T1', { title })));
      startPlan(fx);
      fx.run('ticket', fx.slug, 'T1', 'park');
      const r = fx.run('park-ticket', fx.slug, 'T1');
      assert.equal(r.code, 3, title);
      assert.equal(fs.existsSync(roadmap(fx)), false);
    }
    const fx = fixture(planText(ticket('T1', { title: 'console log' })));
    startPlan(fx);
    fx.run('ticket', fx.slug, 'T1', 'park');
    assert.equal(fx.run('park-ticket', fx.slug, 'T1').code, 0);
  });

  test('an existing roadmap file is never overwritten', () => {
    const fx = fixture(planText(ticket('T1', { title: 'same' })));
    startPlan(fx);
    fx.run('ticket', fx.slug, 'T1', 'park');
    fs.mkdirSync(roadmap(fx), { recursive: true });
    const file = path.join(roadmap(fx), '2026-10-30 13.09 - same.md');
    fs.writeFileSync(file, 'mine\n');
    const r = fx.run('park-ticket', fx.slug, 'T1');
    assert.equal(r.code, 3);
    assert.equal(fs.readFileSync(file, 'utf8'), 'mine\n');
    assert.equal(fx.events().at(-1).ev, 'park');
  });

  test('a linked roadmap folder is refused', (t) => {
    const fx = fixture(planText(ticket('T1')));
    startPlan(fx);
    fx.run('ticket', fx.slug, 'T1', 'park');
    const outside = path.join(fx.base, 'outside');
    fs.mkdirSync(outside);
    try {
      fs.symlinkSync(outside, roadmap(fx), 'junction');
    } catch {
      t.skip('cannot create a link here');
      return;
    }
    const r = fx.run('park-ticket', fx.slug, 'T1');
    assert.equal(r.code, 3);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
});

describe('build-plan', () => {
  const buildPath = (fx) => path.join(fx.root, '.company', 'work', `${fx.slug}-build`, 'plan.md');

  function approvedPlan() {
    const fx = fixture(planText(
      ticket('T1', { extra: ['Body one.'] }),
      ticket('T2', { extra: ['```', '### T7 inside a fence', '```'] }),
      ticket('T3'),
      ticket('T4')
    ));
    startPlan(fx);
    fx.run('ticket', fx.slug, 'T1', 'approve');
    fx.run('ticket', fx.slug, 'T2', 'approve');
    fx.run('ticket', fx.slug, 'T3', 'park');
    return fx;
  }

  test('writes title, base commit, plan-wide Decided lines and approved blocks only', () => {
    const fx = approvedPlan();
    const r = fx.run('build-plan', fx.slug);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.equal(r.lines[0], 'built 2 tickets');
    const text = fs.readFileSync(buildPath(fx), 'utf8');
    assert.equal(text, [
      '# Plan: demo', '',
      `Base commit: ${BASE}`, '',
      '- Decided: keep it small, because the CEO said so.',
      '- Decided: no emoji.', '',
      '## Tasks', '',
      '### T1 title of T1', '- role: backend-engineer', '- files: src/t1.mjs', '- depends-on: none', 'Body one.', '',
      '### T2 title of T2', '- role: backend-engineer', '- files: src/t2.mjs', '- depends-on: none', '```', '### T7 inside a fence', '```',
      ''
    ].join('\n'));
    assert.equal(text.includes('T3'), false);
    assert.equal(text.includes('T4'), false);
    assert.equal(text.includes('\r'), false);
    const stored = fx.lines();
    assert.deepEqual(r.lines.slice(1), [stored[1], stored[2]]);
    assert.deepEqual(fx.events().at(-1).ids, ['T1', 'T2']);
  });

  test('approved blocks keep their hash in the build plan', () => {
    const fx = approvedPlan();
    fx.run('build-plan', fx.slug);
    const r = fx.run('tickets', fx.slug, `${fx.slug}-build/plan.md`, '--phase', 'f');
    assert.deepEqual(r.lines, ['tickets 2 phase f', 'skip T1 approved', 'skip T2 approved']);
  });

  test('is created once, never overwritten', () => {
    const fx = approvedPlan();
    assert.equal(fx.run('build-plan', fx.slug).code, 0);
    const first = fs.readFileSync(buildPath(fx), 'utf8');
    const second = fx.run('build-plan', fx.slug);
    assert.equal(second.code, 3);
    assert.equal(fs.readFileSync(buildPath(fx), 'utf8'), first);
    assert.equal(fx.events().filter((e) => e.ev === 'build').length, 1);
  });

  test('refused with nothing approved and without a Base commit line', () => {
    const none = fixture();
    startPlan(none);
    assert.equal(none.run('build-plan', none.slug).code, 3);
    const nobase = fixture(planText(ticket('T1')).replace(/Base commit: .*\n/, ''));
    startPlan(nobase);
    nobase.run('ticket', nobase.slug, 'T1', 'approve');
    const r = nobase.run('build-plan', nobase.slug);
    assert.equal(r.code, 1);
    assert.equal(fs.existsSync(buildPath(nobase)), false);
    const short = fixture(planText(ticket('T1')).replace(BASE, 'abc12'));
    startPlan(short);
    short.run('ticket', short.slug, 'T1', 'approve');
    assert.equal(short.run('build-plan', short.slug).code, 1);
  });

  test('Decided lines inside a ticket block stay out of the plan-wide lines', () => {
    const fx = fixture(planText(ticket('T1', { extra: ['- Decided: smuggled into the block.'] })));
    startPlan(fx);
    fx.run('ticket', fx.slug, 'T1', 'approve');
    fx.run('build-plan', fx.slug);
    const text = fs.readFileSync(buildPath(fx), 'utf8');
    const head = text.slice(0, text.indexOf('## Tasks'));
    assert.equal(head.includes('smuggled'), false);
    assert.ok(text.includes('smuggled'), 'the line stays in the block');
  });

  test('a slug too long for a build folder is refused', () => {
    const slug = 'a'.repeat(60);
    const fx = fixture(undefined, { slug });
    startPlan(fx);
    fx.run('ticket', slug, 'T1', 'approve');
    const r = fx.run('build-plan', slug);
    assert.equal(r.code, 3);
  });

  test('a linked build folder is refused', (t) => {
    const fx = approvedPlan();
    const outside = path.join(fx.base, 'outside');
    fs.mkdirSync(outside);
    try {
      fs.symlinkSync(outside, path.dirname(buildPath(fx)), 'junction');
    } catch {
      t.skip('cannot create a link here');
      return;
    }
    assert.equal(fx.run('build-plan', fx.slug).code, 3);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
});

describe('hostile input', () => {
  test('arguments with a control character, too long, or unchecked are refused', () => {
    const fx = fixture();
    const bad = [
      ['tickets', 'demo', 'plan.md\n', '--phase', 'd'],
      ['tickets', 'demo', 'plan.md', '--phase', 'd\u202e'],
      ['tickets', 'demo', 'x'.repeat(5000), '--phase', 'd'],
      ['tickets', 'Demo', 'plan.md', '--phase', 'd'],
      ['tickets', '../demo', 'plan.md', '--phase', 'd'],
      ['tickets', 'demo', 'plan.md', '--phase', 'x'],
      ['tickets', 'demo', 'plan.md'],
      ['tickets', 'demo', '../demo/plan.md', '--phase', 'd'],
      ['tickets', 'demo', 'demo/../demo/plan.md', '--phase', 'd'],
      ['tickets', 'demo', 'a/b/plan.md', '--phase', 'd'],
      ['tickets', 'demo', 'C:\\plan.md', '--phase', 'd'],
      ['tickets', 'demo', 'notes.md', '--phase', 'd'],
      ['read'], ['read', 'demo', 'extra'], ['nope'], [], ['build-plan'], ['park-ticket', 'demo']
    ];
    for (const args of bad) {
      const r = fx.run(...args);
      assert.equal(r.code, 3, JSON.stringify(args).slice(0, 80));
      assert.match(r.lines[0], /^refused: /);
    }
    assert.equal(fs.existsSync(fx.record), false);
    assert.equal(main([1, 2], { root: fx.root }).code, 3);
    assert.equal(main(undefined, { root: fx.root }).code, 3);
  });

  test('an unreadable plan is exit 1 and writes nothing', () => {
    const missing = fixture(null);
    assert.equal(missing.run('tickets', 'demo', 'plan.md', '--phase', 'd').code, 1);
    assert.equal(fs.existsSync(missing.record), false);

    const big = fixture('# x\n' + 'a'.repeat(256 * 1024 + 10));
    assert.equal(big.run('tickets', 'demo', 'plan.md', '--phase', 'd').code, 1);

    const utf = fixture(null);
    fs.writeFileSync(path.join(utf.dir, 'plan.md'), Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]));
    assert.equal(utf.run('tickets', 'demo', 'plan.md', '--phase', 'd').code, 1);

    const dup = fixture(planText(ticket('T1'), ticket('T1', { title: 'again' })));
    const r = dup.run('tickets', 'demo', 'plan.md', '--phase', 'd');
    assert.equal(r.code, 1);
    assert.equal(fs.existsSync(dup.record), false);

    const nodir = fixture(null);
    fs.rmSync(nodir.dir, { recursive: true });
    assert.equal(nodir.run('tickets', 'demo', 'plan.md', '--phase', 'd').code, 1);
  });

  test('a plan with no ticket is exit 1; more than 100 tickets is exit 1', () => {
    assert.equal(fixture('# Plan\n\nBase commit: x\n').run('tickets', 'demo', 'plan.md', '--phase', 'd').code, 1);
    const many = Array.from({ length: 101 }, (_, i) => ticket(`T${i + 1}`));
    assert.equal(fixture(planText(...many)).run('tickets', 'demo', 'plan.md', '--phase', 'd').code, 1);
    const ok = fixture(planText(...many.slice(0, 100)));
    assert.equal(ok.run('tickets', 'demo', 'plan.md', '--phase', 'd').code, 0);
  });

  test('a linked plan file is refused', (t) => {
    const fx = fixture(null);
    const target = path.join(fx.base, 'real-plan.md');
    fs.writeFileSync(target, planText(ticket('T1')));
    try {
      fs.symlinkSync(target, path.join(fx.dir, 'plan.md'));
    } catch {
      t.skip('cannot create a link here');
      return;
    }
    assert.equal(fx.run('tickets', 'demo', 'plan.md', '--phase', 'd').code, 1);
  });

  test('a hard-linked plan file is refused', () => {
    const fx = fixture(null);
    const target = path.join(fx.base, 'real-plan.md');
    fs.writeFileSync(target, planText(ticket('T1')));
    fs.linkSync(target, path.join(fx.dir, 'plan.md'));
    assert.equal(fx.run('tickets', 'demo', 'plan.md', '--phase', 'd').code, 1);
  });

  test('a linked record is refused', (t) => {
    const fx = fixture();
    const target = path.join(fx.base, 'elsewhere.jsonl');
    fs.writeFileSync(target, '');
    try {
      fs.symlinkSync(target, fx.record);
    } catch {
      t.skip('cannot create a link here');
      return;
    }
    assert.equal(fx.run('read', fx.slug).code, 1);
    assert.equal(fx.run('tickets', fx.slug, fx.name, '--phase', 'd').code, 1);
    assert.equal(fs.readFileSync(target, 'utf8'), '');
  });

  test('a linked work folder is refused', (t) => {
    const fx = fixture();
    const moved = path.join(fx.base, 'moved');
    fs.renameSync(fx.dir, moved);
    try {
      fs.symlinkSync(moved, fx.dir, 'junction');
    } catch {
      t.skip('cannot create a link here');
      return;
    }
    assert.equal(fx.run('tickets', fx.slug, fx.name, '--phase', 'd').code, 1);
  });

  test('a heading or field line over 4000 characters is not read', () => {
    const long = `### T2 ${'x'.repeat(4100)}`;
    const text = `${planText(ticket('T1'))}\n${long}\n- role: qa\n`;
    const fx = fixture(text);
    assert.deepEqual(startPlan(fx).lines, ['tickets 1 phase d', 'ask T1 new']);
  });

  test('hostile titles and ids never reach the output', () => {
    const fx = fixture(planText(ticket('T1', { title: '\u202e\u001b[31mred\u0007' })));
    const r = startPlan(fx);
    assert.deepEqual(r.lines, ['tickets 1 phase d', 'ask T1 new']);
  });

  test('regex-heavy input stays fast', () => {
    const nasty = `${planText(ticket('T1', { files: `${'a,'.repeat(1500)}b` }))}${'- '.repeat(1900)}\n${'#'.repeat(3000)}\n`;
    const fx = fixture(nasty);
    const t0 = Date.now();
    startPlan(fx, 'f');
    assert.ok(Date.now() - t0 < 2000);
  });
});
