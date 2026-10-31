import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRecord, main } from './ledger.mjs';
import { runsOf, gateReport } from './gate-report.mjs';

const NEW = '2026-10-30 22.42 - Work Folder Names';
const NEW_HELPER = '2026-10-30 22.42 - Cache Tax Draft 2';
const LEGACY = 'idea-20261030-2242-build-draft';
const HOSTILE = [
  '../escape',
  '2026-10-30 22.42 - ../x',
  '2026-10-30 22.42 - Build Draft/x',
  '2026-10-30 22.42 - Build Draft\\x',
  '2026-10-30 22.42 - Build Draft\n',
  '2026-10-30 22.42 - Build Draft‮',
  '2026-10-30 22.42 - build draft',
  '2026-13-30 22.42 - Build Draft',
  '2026-10-30 22.42 - Build Build Build Build Build Build',
  '2026-10-30 22.42 - Build Draft '.padEnd(200, 'a'),
  'A'.repeat(65),
  '__proto__',
  ''
];

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-folder-ledger-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const ledgerFile = (dir, name) => path.join(dir, '.company', 'ledger', `${name}.jsonl`);
const meta = (run, aico) => ({ v: 1, run, kind: 'meta', aico });
const ship = (run) => ({ v: 1, run, kind: 'ship', acs: 3 });
const jl = (...recs) => `${recs.map((r) => JSON.stringify(r)).join('\n')}\n`;

function put(dir, name, ...recs) {
  fs.mkdirSync(path.dirname(ledgerFile(dir, name)), { recursive: true });
  fs.writeFileSync(ledgerFile(dir, name), jl(...recs));
}

describe('ledger run names', () => {
  test('validateRecord accepts a new name, a helper name and a legacy slug', () => {
    for (const run of [NEW, NEW_HELPER, LEGACY]) {
      assert.deepEqual(validateRecord(ship(run)), { ok: true }, run);
    }
  });

  test('validateRecord refuses hostile names without echoing them', () => {
    for (const run of HOSTILE) {
      const verdict = validateRecord(ship(run));
      assert.equal(verdict.ok, false, JSON.stringify(run));
      assert.equal(verdict.reason.includes(run) && run !== '', false);
    }
  });

  test('add writes a file named after a new name and a legacy slug', (t) => {
    const dir = sandbox(t);
    for (const run of [NEW, LEGACY]) {
      const out = main(['add', run, 'step', '01', 'product-manager', 'agent1', '1000'], { root: dir, now: Date.parse('2026-10-31T00:00:00Z') });
      assert.equal(out.code, 0, out.lines.join('\n'));
      const rec = JSON.parse(fs.readFileSync(ledgerFile(dir, run), 'utf8').trim());
      assert.equal(rec.run, run);
    }
  });

  test('every command refuses a hostile run and writes nothing', (t) => {
    const dir = sandbox(t);
    const cmds = (run) => [
      ['add', run, 'step', '01', 'product-manager', 'agent1', '1000'],
      ['ship', run, '1'],
      ['report', run],
      ['scorecard', run],
      ['receipt', run],
      ['reconcile', run],
      ['brainstorm-report', run],
      ['scorecard', LEGACY, '--baseline', run]
    ];
    for (const run of HOSTILE) {
      for (const args of cmds(run)) {
        const out = main(args, { root: dir });
        assert.equal(out.code, 2, `${args[0]} ${JSON.stringify(run)}`);
        assert.match(out.lines[0], /^refused: /);
        if (run !== '') assert.equal(out.lines.join('\n').includes(run), false);
      }
    }
    assert.equal(fs.existsSync(path.join(dir, '.company', 'ledger')), false);
  });

  test('ship, report and scorecard work for a new name', (t) => {
    const dir = sandbox(t);
    main(['add', NEW, 'step', '01', 'product-manager', 'agent1', '1000'], { root: dir });
    const shipped = main(['ship', NEW, '2'], { root: dir, now: Date.parse('2026-10-31T00:00:00Z') });
    assert.equal(shipped.code, 0, shipped.lines.join('\n'));
    const report = main(['report', NEW], { root: dir });
    assert.equal(report.code, 0);
    assert.ok(report.lines.includes(`run ${NEW}`));
    const card = main(['scorecard', NEW], { root: dir });
    assert.equal(card.code, 0);
    assert.match(card.lines[0], /^scorecard 2026-10-30 22\.42 - Work Folder Names /);
  });

  test('a scorecard compares with new and legacy files and skips others', (t) => {
    const dir = sandbox(t);
    put(dir, NEW, ship(NEW));
    put(dir, LEGACY, ship(LEGACY));
    put(dir, 'Not A Name', ship(LEGACY));
    put(dir, '2026-10-30 22.42 - build', ship(LEGACY));
    const out = main(['scorecard', NEW], { root: dir });
    assert.equal(out.code, 0, out.lines.join('\n'));
    assert.equal(out.lines.join('\n').includes('Not A Name'), false);
  });

  test('a run named like an Object.prototype key is a plain value', (t) => {
    const dir = sandbox(t);
    for (const run of ['constructor', 'hasownproperty', 'tostring']) {
      const out = main(['add', run, 'step', '01', 'product-manager', 'agent1', '1000'], { root: dir });
      assert.equal(out.code, 0, run);
    }
  });
});

describe('gate report run names', () => {
  test('lists new and legacy runs of the version, skips every other file name', (t) => {
    const dir = sandbox(t);
    put(dir, NEW, meta(NEW, '0.25.0'), ship(NEW));
    put(dir, NEW_HELPER, meta(NEW_HELPER, '0.25.0'));
    put(dir, LEGACY, meta(LEGACY, '0.25.0'));
    put(dir, 'bad name', meta('bad-name', '0.25.0'));
    put(dir, '2026-10-30 22.42 - ../x', meta(LEGACY, '0.25.0'));
    put(dir, 'baseline-x', meta('baseline-x', '0.25.0'));
    const runs = runsOf(dir, '0.25.0').map((r) => r.run);
    assert.deepEqual(runs, [NEW, NEW_HELPER, LEGACY].sort());
  });

  test('the report heading holds only the checked name', (t) => {
    const dir = sandbox(t);
    put(dir, NEW, meta(NEW, '0.25.0'), ship(NEW));
    const text = gateReport({ root: dir, version: '0.25.0' });
    assert.ok(text.includes(`### ${NEW}\n`));
    assert.equal(text.includes('\r'), false);
  });

  test('a record that names another run does not change the heading', (t) => {
    const dir = sandbox(t);
    put(dir, NEW, meta('other-run', '0.25.0'));
    const text = gateReport({ root: dir, version: '0.25.0' });
    assert.ok(text.includes(`### ${NEW}\n`));
    assert.equal(text.includes('other-run'), false);
  });
});
