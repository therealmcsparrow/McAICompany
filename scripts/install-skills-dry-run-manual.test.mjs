import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from './install-skills.mjs';

const PINNED = 'npx -y impeccable@4.8.0 skills install';
const manifest = { core: [{ name: 'hallmark', source: 'nutlope/hallmark' }, { name: 'impeccable', install: PINNED }] };

function run(args, m = manifest) {
  const out = [], calls = [];
  const code = main(args, { manifest: m, home: '/h', cwd: '/repo', platform: 'linux', color: false, log: x => out.push(x), exec: c => { calls.push(c); } });
  return { code, out, calls };
}

test('dry run prints a manifest command as manual with a WARNING line and no [dry-run] echo', () => {
  const { code, out, calls } = run(['core', '--dry-run']);
  assert.equal(code, 0);
  assert.deepEqual(calls, []);
  assert.ok(out.includes(`manual ${PINNED}`), out.join('|'));
  assert.equal(out.filter(l => l.startsWith('WARNING: impeccable ')).length, 1, out.join('|'));
  assert.ok(!out.some(l => l.includes(`[dry-run] ${PINNED}`) || l.includes(`$ ${PINNED}`)), out.join('|'));
  assert.ok(out.some(l => l.startsWith('[dry-run] npx -y skills@1.7.4 add nutlope/hallmark')), out.join('|'));
});

test('dry run with only a manifest command prints manual and WARNING, no counts line', () => {
  const { code, out } = run(['core', '--dry-run'], { core: [{ name: 'impeccable', install: PINNED }] });
  assert.equal(code, 0);
  assert.equal(out.length, 2, out.join('|'));
  assert.ok(!out.some(l => /installed, \d+ failed/.test(l)));
});
