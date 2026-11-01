import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { REASON, UNREADABLE, isModelSend, isResumeSpawn, judgeRun, refusalReason } from '../mods/lib/fresh-step.mjs';

const ran = (stdout, exitCode = 0, extra = {}) => ({ exitCode, stdout, stderr: '', ...extra });

test('only an origin of kind model counts as a model send', () => {
  const hostile = [undefined, null, 0, 'model', [], {}, { kind: 'plugin' }, { kind: 'Model' }, { kind: 'model ' }, { kind: ['model'] }, { kind: 'user' }];
  for (const origin of hostile) assert.equal(isModelSend({ to: 'a', text: 'x', origin }), false, JSON.stringify(origin));
  for (const e of [undefined, null, 'x', 7, []]) assert.equal(isModelSend(e), false);
  assert.equal(isModelSend({ origin: { kind: 'model' } }), true);
  assert.equal(isModelSend({ origin: Object.create({ kind: 'model' }) }), true);
});

test('only a spawn with a resume object counts as a resume', () => {
  for (const resume of [undefined, null, false, 0, '', 'a1']) assert.equal(isResumeSpawn({ resume }), false, String(resume));
  for (const e of [undefined, null, 'x', []]) assert.equal(isResumeSpawn(e), false);
  assert.equal(isResumeSpawn({}), false);
  assert.equal(isResumeSpawn({ resume: { agentId: 'a1' } }), true);
});

test('the refusal reason is the fixed text, with the suffix only for an unreadable run state', () => {
  assert.equal(REASON, 'aico: Steps are never resumed; dispatch a fresh Step (next NN) with the old Handoff as input (pipeline §2)');
  assert.equal(UNREADABLE, ' (run state unreadable)');
  assert.equal(refusalReason(false), REASON);
  assert.equal(refusalReason(true), `${REASON} (run state unreadable)`);
});

test('a failed or odd run-state answer is unreadable, never a pass', () => {
  const bad = [
    undefined, null, 'x', 3, [],
    ran('{"slug":null}', 1),
    ran('{"slug":null}', 2),
    ran('{"slug":null}', null),
    ran('{"slug":null}', '0'),
    ran('{"slug":null}', 0, { isStdoutTruncated: true }),
    ran(''),
    ran('{bad'),
    ran('[]'),
    ran('null'),
    ran('{"slug":7}'),
    ran('{"slug":"../x"}'),
    { exitCode: 0, get stdout() { throw new Error('boom'); } },
  ];
  for (const r of bad) assert.equal(judgeRun(r), 'unreadable');
});

test('judgeRun separates no active run from an active run', () => {
  assert.equal(judgeRun(ran('{"slug":null,"view":null}\r\n')), 'idle');
  assert.equal(judgeRun(ran('{"slug":"run-one","view":null}\n')), 'active');
  assert.equal(judgeRun(ran('{"slug":"2026-11-01 13.49 - Topic","view":null}')), 'active');
});

test('the mod source holds no shared script caller and no process probe', () => {
  const src = readFileSync(new URL('../mods/fresh-step.ts', import.meta.url), 'utf8');
  assert.ok(!/runScript\(/.test(src));
  assert.ok(!/\$\.process\?|typeof \$\.process/.test(src));
  assert.ok(!src.includes('\r'));
});

test('the hooks module registers the mod directly before the reprompt gate', () => {
  const src = readFileSync(new URL('../hooks/register.tsx', import.meta.url), 'utf8');
  assert.match(src, /import \{ registerFreshStep \} from '\.\.\/mods\/fresh-step'/);
  assert.match(src, /registerFreshStep\(on\)\n(?:\s*\/\/[^\n]*\n)*\s*registerRepromptGate\(on\)\n/);
  assert.ok(src.indexOf('registerPlanGate(on)') < src.indexOf('registerFreshStep(on)'));
});
