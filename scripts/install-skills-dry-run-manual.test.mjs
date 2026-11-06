import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('the Playbooks that show the dry run tell the Lead to mark the WARNING line and say it is not run', () => {
  for (const f of ['skills/setup/SKILL.md', 'skills/research/SKILL.md', 'skills/feature/SKILL.md', 'skills/lead/references/skill-picks.md']) {
    const t = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.match(t, /`WARNING:` line/, f);
    assert.match(t, /not run|does not run|never run/, f);
  }
});

test('vulnscan notice, docs page and agent name the audit destinations and private names', () => {
  for (const f of ['skills/vulnscan/SKILL.md', 'documentation/commands/vulnscan.md']) {
    const t = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(t, /nothing else leaves/, f);
    for (const w of ['npm audit', 'pip-audit', 'cargo audit', 'osv-scanner', 'govulncheck', 'private package names', 'web search']) assert.ok(t.includes(w), `${f}: ${w}`);
  }
  const a = readFileSync(new URL('../agents/vuln-scanner.md', import.meta.url), 'utf8');
  assert.match(a, /unscanned and never queried/);
  assert.match(a, /no code text/);
  assert.match(readFileSync(new URL('../documentation/concepts/where-your-words-go.md', import.meta.url), 'utf8'), /aico:vulnscan/);
});

test('triage names a fitting work: Playbook and checks the fix fallback against playbooks', () => {
  const t = readFileSync(new URL('../skills/triage/SKILL.md', import.meta.url), 'utf8');
  assert.match(t, /fits the request best/);
  assert.match(t, /`aico:fix` for a bug only when it is in `playbooks`/);
  assert.doesNotMatch(t, /else `aico:feature`, with/);
});
