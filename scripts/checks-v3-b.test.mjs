// Tests: wayfinder, skill-picks, spec-check and the guard
// and plan-gate mods take a v3 run slug `<ProjectID>/<NN>-<playbook>` and answer as they do for a v2 name.
// Each test pairs a v3 assertion with the v2 / legacy answer (unchanged, byte for byte).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, main as wayfinder } from './wayfinder.mjs';
import { lint } from './skill-picks.mjs';
import { main as specCheck } from './spec-check.mjs';
import { parseOutputLine, parseOutputText, workFolder } from '../mods/lib/guard.mjs';
import { parseGateCommand, recordPath } from '../mods/lib/plan-gate.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const root = () => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'checks-v3-b-')));
  tmps.push(d);
  return d;
};
const put = (cwd, rel, text = 'x\n') => {
  const file = path.join(cwd, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

const PID = 'P20261109.000009';
const V3 = `${PID}/01-draft`;
const V2 = `${PID}-10.00.00`;
const LEGACY = 'demo';
const SHA = 'a'.repeat(40);
// Shapes a v3 slug must never be taken for.
const BAD_V3 = [
  `${V3}/x`, `${PID}/1-draft`, `${PID}/00-draft`, `${PID}/01-Draft`, `${PID}/01-`, `${PID}\\01-draft`, `${PID}/../01-draft`,
  `${PID}/..`, `p20261109.000009/01-draft`, `${V3}\n`, `${V3}\u202e`, `${PID}//01-draft`, `/${V3}`, `${V3}/`,
  `${PID}/01-${'a'.repeat(70)}`, `${PID}~01-draft`,
];

// ---------- wayfinder (wayfinder v1.2) ----------
const D = '—';
const MAP = '.company/wayfinder/demo.md';
const map = (ref) => `# Wayfinder: demo\n\n## Decisions\n\n## Open\n\n## Pointers\n- ${ref} ${D} plan\n`;
const planOf = (slug) => `# plan\n\n### ${projectOf(slug)}-T1 first task\n- role: qa\n`;
const projectOf = (slug) => (slug.includes('/') ? slug.split('/')[0] : slug.slice(0, PID.length));

test('wayfinder: a pointer into a v3 run folder is a clean pointer, like one into a v2 folder', () => {
  const cwd = root();
  put(cwd, `.company/work/${PID}/00-project.md`);
  put(cwd, `.company/work/${PID}/01-draft/plan.md`, planOf(V3));
  put(cwd, `.company/work/${V2}/plan.md`, planOf(V2));
  assert.deepEqual(validate(map(`\`.company/work/${PID}/01-draft/plan.md\``), { root: cwd }), []);
  assert.deepEqual(validate(map(`.company/work/${PID}/01-draft/plan.md`), { root: cwd }), []);
  assert.deepEqual(validate(map(`\`.company/work/${PID}/00-project.md\``), { root: cwd }), []);
  assert.deepEqual(validate(map(`\`.company/work/${V2}/plan.md\``), { root: cwd }), []);
});

test('wayfinder: a v3 pointer whose file is missing says so, a v3 pointer in the wrong letter case is a bad ref', () => {
  const cwd = root();
  put(cwd, `.company/work/${PID}/01-draft/plan.md`, planOf(V3));
  const missing = validate(map(`\`.company/work/${PID}/01-draft/nope.md\``), { root: cwd });
  assert.deepEqual(missing.map((e) => e.reason), [`pointer missing .company/work/${PID}/01-draft/nope.md`]);
  assert.deepEqual(validate(map(`\`.company/work/${PID}/01-Draft/plan.md\``), { root: cwd }).map((e) => e.reason), ['bad ref']);
  assert.deepEqual(validate(map(`\`.company/work/${PID.toLowerCase()}/01-draft/plan.md\``), { root: cwd }).map((e) => e.reason), ['bad ref']);
  // v2 folder missing file: the same message shape as today
  put(cwd, `.company/work/${V2}/plan.md`, planOf(V2));
  assert.deepEqual(validate(map(`\`.company/work/${V2}/nope.md\``), { root: cwd }).map((e) => e.reason), [`pointer missing .company/work/${V2}/nope.md`]);
});

test('wayfinder: a ticket anchor on a v3 plan answers as on the same plan in a v2 folder', () => {
  const cwd = root();
  put(cwd, `.company/work/${PID}/01-draft/plan.md`, planOf(V3));
  put(cwd, `.company/work/${V2}/plan.md`, planOf(V2));
  const answer = (slug, anchor) => validate(map(`\`.company/work/${slug}/plan.md#${anchor}\``), { root: cwd }).map((e) => e.reason.replace(slug, '<run>'));
  for (const anchor of [`${PID}-T1`, `${PID}-T2`]) {
    const v3 = answer(V3, anchor);
    assert.deepEqual(v3, answer(V2, anchor), anchor);
  }
  assert.deepEqual(answer(V3, `${PID}-T1`), []);
  assert.deepEqual(answer(V3, `${PID}-T2`), [`task missing ${PID}-T2 in .company/work/<run>/plan.md`]);
});

test('wayfinder: hostile v3-shaped pointers are bad refs, and the CLI prints the v2 answer for a v3 map', () => {
  const cwd = root();
  put(cwd, `.company/work/${PID}/01-draft/plan.md`, planOf(V3));
  for (const bad of BAD_V3.filter((s) => !/[\n\u202e]/.test(s))) {
    const errs = validate(map(`\`.company/work/${bad}/plan.md\``), { root: cwd });
    assert.equal(errs.length, 1, bad);
    assert.ok(errs[0].reason === 'bad ref' || errs[0].reason.startsWith('pointer missing'), `${bad}: ${errs[0].reason}`);
  }
  put(cwd, MAP, map(`\`.company/work/${PID}/01-draft/plan.md\``));
  const r = wayfinder(['check', MAP], { root: cwd });
  assert.deepEqual(r, { code: 0, lines: ['wayfinder: 0 errors'] });
});

// ---------- skill-picks (skill-recommendation v2.1) ----------
const today = new Date(2026, 10, 9);
const handoff = '---\narea: stack\n---\nBy: skill-researcher\n## Did\n- x\n';
const picks = (folder, cwd) => lint(`.company/work/${folder}/08-skill-researcher.md`, today, cwd);

test('skill-picks: lint reads a researcher Handoff in a v3 run folder, as it does in a v2 folder', () => {
  const cwd = root();
  put(cwd, `.company/work/${PID}/01-draft/08-skill-researcher.md`, handoff);
  put(cwd, `.company/work/${V2}/08-skill-researcher.md`, handoff);
  put(cwd, `.company/work/${LEGACY}/08-skill-researcher.md`, handoff);
  const expect = { v: 1, area: 'stack', lines: [], picks: [] };
  assert.deepEqual(picks(V3, cwd), expect);
  assert.deepEqual(picks(V2, cwd), expect);
  assert.deepEqual(picks(LEGACY, cwd), expect);
});

test('skill-picks: a v3 path in the wrong letter case, or a nested non-run folder, is refused', () => {
  const cwd = root();
  put(cwd, `.company/work/${PID}/01-draft/08-skill-researcher.md`, handoff);
  assert.deepEqual(picks(V3, cwd).picks, []);
  assert.throws(() => picks(`${PID}/01-Draft`, cwd), /handoff path must be/);
  assert.throws(() => picks(`${PID.toLowerCase()}/01-draft`, cwd), /handoff path must be/);
  for (const bad of [`${PID}/x`, `${PID}/01-draft/x`, `${PID}/../${V3}`, `${PID}\\01-draft`, `${PID}/1-draft`, `${PID}//01-draft`]) {
    assert.throws(() => picks(bad, cwd), /handoff path must be/, bad);
  }
  // a v3 run folder that is not there stays `handoff not found`
  assert.throws(() => picks(`${PID}/02-draft`, cwd), /handoff not found/);
  // the old nested-folder refusal for a plain name is unchanged
  put(cwd, '.company/work/demo/x/08-skill-researcher.md', handoff);
  assert.throws(() => picks('demo/x', cwd), /handoff path must be/);
});

// ---------- spec-check (destination-spec v1.5) ----------
const HEADINGS = ['## Problem', '## Solution', '## User stories', '## Decisions', '## Testing decisions', '## Out of scope'];
const spec = (slug) => `---\nslug: ${slug}\nversion: pending\nshipped: pending\n---\n${HEADINGS.map((h) => `${h}\nPlain words about the result.\n`).join('\n')}`;

test('spec-check: check takes a spec in a v3 run folder whose frontmatter slug is the run slug, like a v2 one', () => {
  const cwd = root();
  put(cwd, `.company/work/${PID}/01-draft/spec.md`, spec(V3));
  put(cwd, `.company/work/${V2}/spec.md`, spec(V2));
  assert.deepEqual(specCheck(['check', `.company/work/${PID}/01-draft/spec.md`], { root: cwd }), { code: 0, lines: ['spec-check: 0 errors'] });
  assert.deepEqual(specCheck(['check', path.join(cwd, '.company', 'work', PID, '01-draft', 'spec.md')], { root: cwd }), { code: 0, lines: ['spec-check: 0 errors'] });
  assert.deepEqual(specCheck(['check', `.company/work/${V2}/spec.md`], { root: cwd }), { code: 0, lines: ['spec-check: 0 errors'] });
});

test('spec-check: stamp works on a v3 spec and leaves a v2 spec as before', () => {
  const cwd = root();
  put(cwd, `.company/work/${PID}/01-draft/spec.md`, spec(V3));
  put(cwd, `.company/work/${V2}/spec.md`, spec(V2));
  for (const [slug, rel] of [[V3, `.company/work/${PID}/01-draft/spec.md`], [V2, `.company/work/${V2}/spec.md`]]) {
    const r = specCheck(['stamp', rel, '--version', '1.2.3', '--date', '2026-11-09'], { root: cwd });
    assert.deepEqual(r, { code: 0, lines: [`stamped ${rel} 1.2.3 2026-11-09`] }, slug);
    const text = fs.readFileSync(path.join(cwd, ...rel.split('/')), 'utf8');
    assert.ok(text.startsWith(`---\nslug: ${slug}\nversion: 1.2.3\nshipped: 2026-11-09\n---\n`), slug);
  }
});

test('spec-check: a v3 spec path in the wrong letter case, a bad v3 shape, or a frontmatter slug that is no run is refused or an ERROR', () => {
  const cwd = root();
  put(cwd, `.company/work/${PID}/01-draft/spec.md`, spec(V3));
  for (const rel of [`.company/work/${PID}/01-Draft/spec.md`, `.company/work/${PID.toLowerCase()}/01-draft/spec.md`, `.Company/work/${PID}/01-draft/spec.md`]) {
    const r = specCheck(['check', rel], { root: cwd });
    assert.equal(r.code, 3, rel);
    assert.match(r.lines[0], /^refused: /, rel);
  }
  for (const bad of BAD_V3.filter((s) => !/[\n\u202e]/.test(s))) {
    assert.equal(specCheck(['check', `.company/work/${bad}/spec.md`], { root: cwd }).code, 3, bad);
  }
  // the run must exist
  assert.equal(specCheck(['check', `.company/work/${PID}/02-draft/spec.md`], { root: cwd }).code, 3);
  // a frontmatter slug that is not a run name is an ERROR, a v3 slug is not
  put(cwd, `.company/work/${PID}/02-draft/spec.md`, spec(`${PID}/02-Draft`));
  const r = specCheck(['check', `.company/work/${PID}/02-draft/spec.md`], { root: cwd });
  assert.equal(r.code, 2, r.lines.join('\n'));
  assert.ok(r.lines.some((l) => l.startsWith('ERROR')), r.lines.join('\n'));
  // a plain docs spec is unchanged
  put(cwd, 'docs/specs/demo.md', spec('demo'));
  assert.equal(specCheck(['check', 'docs/specs/demo.md'], { root: cwd }).code, 0);
});

// ---------- guard mod (aico-mods v1.8) ----------
test('guard: an Output line with a v3 run folder gives the run slug, a v2 line gives the folder name as before', () => {
  assert.deepEqual(parseOutputLine(`Output: .company/work/${V3}/05-qa.md`), { slug: V3, step: '05', role: 'qa' });
  assert.deepEqual(parseOutputLine(`Output: .company/work/${V2}/05-qa.md`), { slug: V2, step: '05', role: 'qa' });
  assert.deepEqual(parseOutputLine(`Output: .company/work/${LEGACY}/105-qa.md`), { slug: LEGACY, step: '105', role: 'qa' });
  const text = `Task: x\r\nOutput: .company/work/${V3}/05-qa.md\r\nGoal: y\r\n`;
  assert.deepEqual(parseOutputText(text), { slug: V3, step: '05', role: 'qa' });
});

test('guard: Output lines with a bad v3 shape are not read', () => {
  for (const bad of BAD_V3.filter((s) => s !== V3)) {
    assert.equal(parseOutputLine(`Output: .company/work/${bad}/05-qa.md`), null, bad);
  }
  assert.equal(parseOutputLine(`Output: .company/work/${V3}/x/05-qa.md`), null);
  assert.equal(parseOutputLine(`Output: .company/work/${PID}/05-qa.md`.replace(PID, 'x/y')), null);
  assert.equal(parseOutputLine(`output: .company/work/${V3}/05-qa.md`), null);
  assert.equal(parseOutputLine(`Output: .company/work/${V3}/05-QA.md`), null);
});

test('guard: workFolder takes a v3 run slug and the v2 and legacy names, nothing else', () => {
  for (const ok of [V3, V2, LEGACY]) assert.equal(workFolder(ok), ok);
  for (const bad of [...BAD_V3, 42, null, undefined, '', `${V3}/${'a'.repeat(120)}`]) assert.equal(workFolder(bad), undefined, String(bad));
});

// ---------- plan-gate mod (aico-mods v1.8) ----------
const GATE = 'node scripts/run-state.mjs gate';

test('plan-gate: the Gate command takes one single-quoted v3 run slug, like a v2 name', () => {
  assert.equal(parseGateCommand(`${GATE} '${V3}' plan passed`), V3);
  assert.equal(parseGateCommand(`node /p/scripts/run.mjs run-state gate '${V3}' plan passed`), V3);
  assert.equal(parseGateCommand(`${GATE} '${V2}' plan passed`), V2);
  assert.equal(parseGateCommand(`${GATE} ${LEGACY} plan passed`), LEGACY);
  assert.equal(parseGateCommand(`${GATE} '${LEGACY}' plan passed`), LEGACY);
});

test('plan-gate: an unquoted v3 slug, a bad v3 shape or an extra token is not judged', () => {
  assert.equal(parseGateCommand(`${GATE} ${V3} plan passed`), null);
  for (const bad of BAD_V3.filter((s) => s !== V3 && !/[\n]/.test(s))) {
    assert.equal(parseGateCommand(`${GATE} '${bad}' plan passed`), null, bad);
  }
  assert.equal(parseGateCommand(`${GATE} '${V3}' plan passed; x`), null);
  assert.equal(parseGateCommand(`${GATE} "${V3}" plan passed`), null);
  assert.equal(parseGateCommand(`${GATE} '${V3}' 'x' plan passed`), null);
  assert.equal(parseGateCommand(`${GATE} '${PID}/01-draft'\n plan passed`), null);
});

test('plan-gate: a write to the run record of a v3 run is found and names the run slug', () => {
  for (const p of [
    `.company/work/${PID}/01-draft/run-state.jsonl`,
    `/abs/proj/.company/work/${PID}/01-draft/run-state.jsonl`,
    `C:\\proj\\.company\\work\\${PID}\\01-draft\\run-state.jsonl`,
    `.company/work/${PID}/01-draft/run-state.jsonl.`,
    `.company/work/${PID}/01-draft/run-state.jsonl:stream`,
    `.company/work/${PID}/01-draft/RUN-STATE.JSONL`,
  ]) {
    assert.deepEqual(recordPath(p), { slug: V3 }, p);
  }
  assert.deepEqual(recordPath(`.company/work/${V2}/run-state.jsonl`), { slug: V2 });
  assert.deepEqual(recordPath(`work/${LEGACY}/run-state.jsonl`), { slug: LEGACY });
});

test('plan-gate: a run record path with a bad v3 shape is still a record path, with no slug', () => {
  for (const run of [`${PID}/01-Draft`, `${PID}/1-draft`, `${PID}/x`, `${PID.toLowerCase()}/01-draft`]) {
    assert.deepEqual(recordPath(`.company/work/${run}/run-state.jsonl`), { slug: null }, run);
  }
  assert.equal(recordPath(`.company/work/${V3}/plan.md`), null);
  assert.equal(recordPath(`.company/work/${V3}/05-qa.md`), null);
});

// ---------- Contracts ----------
const doc = (name) => fs.readFileSync(path.join(REPO, 'docs', 'contracts', `${name}.md`), 'utf8');
for (const [name, version, header = version] of [['wayfinder', '1.2'], ['skill-recommendation', '2.1'], ['destination-spec', '1.5'], ['aico-mods', '1.8', '2.1']]) {
  test(`${name} is v${header} and says v2, v1.1 and legacy names are byte-identical`, () => {
    const text = doc(name);
    assert.ok(text.startsWith(`# Contract: ${name} v${header}\n`), text.split('\n')[0]);
    const para = text.split('\n').find((l) => new RegExp(`^v${version.replace('.', '\\.')}\\b`).test(l));
    assert.ok(para, `a v${version} paragraph exists`);
    assert.match(para, /byte-identical/);
    assert.match(para, /isRunSlug/);
    assert.match(para, /workParts/);
  });
}

test('the provider scripts declare the new Contract versions', () => {
  const head = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n').slice(0, 3).join('\n');
  assert.match(head('scripts/wayfinder.mjs'), /docs\/contracts\/wayfinder\.md v1\.2\b/);
  assert.match(head('scripts/spec-check.mjs'), /docs\/contracts\/destination-spec\.md v1\.5\b/);
});
