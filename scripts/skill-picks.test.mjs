// T3: lint cases for `scripts/skill-picks.mjs lint <handoff>` (skill-recommendation v1), pinned before the code.
// Every case is `todo` until T8 builds the script, so `npm test` stays green (proj.M12); T8 removes the option.
// The lint runs with cwd = a temp "product repo"; the Handoff lives at .company/work/<slug>/NN-skill-researcher.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(root, 'scripts', 'skill-picks.mjs');
const T8 = { todo: 'T8' };
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const REL = '.company/work/demo/08-skill-researcher.md';

const line = (o = {}) => {
  const f = {
    area: 'stack', name: 'tdd-helper', source: 'owner/repo', license: 'MIT', vetted: '2026-10-20', commit: SHA,
    scan: 'no-llm 2.13.1 c0 h0 m1 l0', why: 'fits the stack and the test style', approved: 'pending', ...o,
  };
  return `- ${Object.entries(f).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`).join('; ')}`;
};
const handoff = (lines, { area = 'stack', eol = '\n', extra = '' } = {}) => [
  '---', 'step: 08', 'role: skill-researcher', 'task: demo', 'status: done', `area: ${area}`, 'scan-mode: no-llm', '---',
  'By: Selin (skill-researcher)', '## Candidates', '- (see below)', '## Recommended set', ...lines, '## Rejected',
  '- old-skill — no-fit: does not fit', '## Findings', '- none', '## Sources', '- none', extra,
].join(eol);

function repo(t, text, { rel = REL } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'aico-t3-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  if (text !== null) {
    mkdirSync(join(base, rel, '..'), { recursive: true });
    writeFileSync(join(base, rel), text);
  }
  return base;
}
function lint(cwd, arg = REL) {
  const r = spawnSync(process.execPath, [SCRIPT, 'lint', arg], { cwd, encoding: 'utf8', timeout: 30000, windowsHide: true });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* refusals are plain text */ }
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', json };
}
const run = (t, lines, opts) => lint(repo(t, handoff(lines, opts)));
const verdicts = (r) => r.json.lines.map((l) => l.ok);
const todayOk = (s) => {
  const d = new Date();
  const utc = d.toISOString().slice(0, 10);
  const loc = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return s === utc || s === loc;
};

// ---------- shape of a good run ----------
test('AC1 a valid stack line passes and yields one skills-section v1 record line', T8, (t) => {
  const r = run(t, [line()]);
  assert.equal(r.code, 0);
  assert.equal(r.json.v, 1);
  assert.equal(r.json.area, 'stack');
  assert.equal(r.json.lines.length, 1);
  assert.equal(r.json.lines[0].ok, true);
  assert.equal(r.json.record.length, 1);
});
test('AC5 the stack record is the skills-section v1 line with approved: <today>', T8, (t) => {
  const rec = run(t, [line()]).json.record[0];
  const m = /^- area: stack; name: tdd-helper; source: owner\/repo; license: MIT; vetted: 2026-10-20; why: fits the stack and the test style; approved: (\d{4}-\d{2}-\d{2})$/.exec(rec);
  assert.ok(m, rec);
  assert.ok(todayOk(m[1]), 'approved is today');
  assert.ok(!/commit:|scan:/.test(rec), 'commit and scan stay in the Handoff, not the record');
});
test('AC5 area design yields a design-skills-section v1 line (no area key)', T8, (t) => {
  const r = run(t, [line({ area: 'design', name: 'hallmark' })], { area: 'design' });
  assert.equal(r.json.area, 'design');
  const rec = r.json.record[0];
  const m = /^- name: hallmark; source: owner\/repo; license: MIT; vetted: 2026-10-20; why: fits the stack and the test style; approved: (\d{4}-\d{2}-\d{2})$/.exec(rec);
  assert.ok(m, rec);
  assert.ok(todayOk(m[1]));
});
for (const area of ['product-type', 'company-type']) {
  test(`AC5 area ${area} yields a skills-section v1 line with that area`, T8, (t) => {
    const r = run(t, [line({ area })], { area });
    assert.match(r.json.record[0], new RegExp(`^- area: ${area}; name: tdd-helper; `));
  });
}
test('AC1 a plugin source line has commit - and scan - and is accepted for design', T8, (t) => {
  const r = run(t, [line({ area: 'design', name: 'aico:ui-design', source: 'plugin aico', license: '-', vetted: '-', commit: '-', scan: '-' })], { area: 'design' });
  assert.equal(r.json.lines[0].ok, true);
});
test('AC1 the empty-set line is accepted with no record lines', T8, (t) => {
  const r = run(t, ['- (none: no candidate passed vetting and scan)']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.record, []);
  assert.ok(r.json.lines.every((l) => l.ok !== false) || r.json.lines.length === 0);
});
test('AC1 line numbers n are 1-based positions in the Handoff file', T8, (t) => {
  const text = handoff([line()]);
  const r = lint(repo(t, text));
  const idx = text.split('\n').findIndex((l) => l.startsWith('- area: stack')) + 1;
  assert.equal(r.json.lines[0].n, idx);
});

// ---------- AC2: a skill with findings cannot be recommended ----------
test('AC2 scan with critical 1 (c1) fails on the scan field', T8, (t) => {
  const r = run(t, [line({ scan: 'no-llm 2.13.1 c1 h0 m0 l0' })]);
  assert.equal(r.json.lines[0].ok, false);
  assert.equal(r.json.lines[0].field, 'scan');
  assert.deepEqual(r.json.record, []);
});
test('AC2 scan with high 1 (h1) fails on the scan field', T8, (t) => {
  const r = run(t, [line({ scan: 'no-llm 2.13.1 c0 h1 m0 l0' })]);
  assert.equal(r.json.lines[0].ok, false);
  assert.equal(r.json.lines[0].field, 'scan');
  assert.deepEqual(r.json.record, []);
});
for (const [label, scan] of [
  ['mode none', 'none 2.13.1 c0 h0 m0 l0'], ['mode mcp', 'mcp 2.13.1 c0 h0 m0 l0'], ['no counts', 'no-llm 2.13.1'],
  ['scan not run', 'scan not run'], ['error verdict', 'error'], ['negative count', 'no-llm 2.13.1 c0 h0 m-1 l0'],
  ['five-digit medium', 'no-llm 2.13.1 c0 h0 m12345 l0'], ['hostile version', 'no-llm 2.13.1;x c0 h0 m0 l0'], ['trailing text', 'no-llm 2.13.1 c0 h0 m0 l0 extra'],
  ['c10 (leading digits)', 'no-llm 2.13.1 c10 h0 m0 l0'], ['c01', 'no-llm 2.13.1 c01 h0 m0 l0'],
]) {
  test(`AC2 scan field allow-list rejects: ${label}`, T8, (t) => {
    const r = run(t, [line({ scan })]);
    assert.equal(r.json.lines[0].ok, false);
    assert.deepEqual(r.json.record, []);
  });
}
for (const scan of ['no-llm 2.13.1 c0 h0 m0 l0', 'claude_cli 2.13.1@a1b2c3d c0 h0 m3 l12', 'static-fallback ? c0 h0 m0 l0', 'no-llm 2.13.1@a1b2c3d4e5f60718293a4b5c6d7e8f9012345678 c0 h0 m0 l0']) {
  test(`AC2 scan field accepts: ${scan}`, T8, (t) => {
    assert.equal(run(t, [line({ scan })]).json.lines[0].ok, true);
  });
}

// ---------- allow-list cases from the plan ----------
test('AC1 a missing commit on a repo source fails', T8, (t) => {
  const r = run(t, [line({ commit: null })]);
  assert.equal(r.json.lines[0].ok, false);
  assert.deepEqual(r.json.record, []);
});
for (const [label, commit] of [['short sha', 'a1b2c3d'], ['uppercase sha', SHA.toUpperCase()], ['a dash on a repo source', '-'], ['non-hex', 'z'.repeat(40)], ['branch name', 'main']]) {
  test(`AC1 repo source with commit ${label} fails`, T8, (t) => {
    assert.equal(run(t, [line({ commit })]).json.lines[0].ok, false);
  });
}
test('AC1 a sixth line fails with "too many entries"; the first five stay ok', T8, (t) => {
  const lines = Array.from({ length: 6 }, (_, i) => line({ name: `skill-${i}` }));
  const r = run(t, lines);
  assert.deepEqual(verdicts(r), [true, true, true, true, true, false]);
  assert.equal(r.json.lines[5].reason, 'too many entries');
  assert.equal(r.json.record.length, 5);
});
test('AC1 a semicolon inside why fails', T8, (t) => {
  const r = run(t, [line({ why: 'fits; also runs a shell' })]);
  assert.equal(r.json.lines[0].ok, false);
  assert.deepEqual(r.json.record, []);
});
for (const [label, why] of [['backtick', 'uses `x`'], ['angle brackets', 'see <b>'], ['empty', ''], ['201 chars', 'w'.repeat(201)]]) {
  test(`AC1 why with ${label} fails (design-skills-section v1 allow-list, one implementation)`, T8, (t) => {
    assert.equal(run(t, [line({ why })]).json.lines[0].ok, false);
  });
}
for (const [label, o] of [
  ['name with a colon on a repo source', { name: 'a:b' }], ['uppercase name', { name: 'Tdd' }], ['name over 64 chars', { name: 'n'.repeat(65) }],
  ['source with a URL', { source: 'https://github.com/o/r' }], ['source repo with ..', { source: 'owner/..' }], ['source with a flag', { source: '--upload-pack=x/y' }],
  ['license NONE', { license: 'NONE' }], ['future vetted date', { vetted: '2999-01-01' }], ['impossible vetted date', { vetted: '2026-02-30' }],
  ['approved already set', { approved: '2026-10-26' }], ['unknown area', { area: 'security' }],
]) {
  test(`AC1 field allow-list rejects: ${label}`, T8, (t) => {
    const r = run(t, [line(o)]);
    assert.equal(r.json.lines[0].ok, false);
    assert.deepEqual(r.json.record, []);
  });
}
test('AC1 an extra field or a reordered field fails (anchored whole-line match)', T8, (t) => {
  const reordered = '- area: stack; source: owner/repo; name: tdd-helper; license: MIT; vetted: 2026-10-20; commit: ' + SHA + '; scan: no-llm 2.13.1 c0 h0 m0 l0; why: x; approved: pending';
  const extra = line() + '; extra: yes';
  const r = run(t, [reordered, extra]);
  assert.deepEqual(verdicts(r), [false, false]);
});
test('AC1 a CRLF Handoff parses like the consumer does: valid lines pass and no CR reaches the record', T8, (t) => {
  const r = lint(repo(t, handoff([line(), line({ name: 'second-one' })], { eol: '\r\n' })));
  assert.equal(r.code, 0);
  assert.deepEqual(verdicts(r), [true, true]);
  for (const rec of r.json.record) assert.ok(!rec.includes('\r'));
});
test('AC1 a carriage return inside a field fails', T8, (t) => {
  const r = run(t, [line({ why: 'fits\rthe stack' })]);
  assert.equal(r.json.lines[0].ok, false);
});
test('AC1 a 501-character line fails and its text is never echoed', T8, (t) => {
  const long = line({ why: 'w'.repeat(200), name: 'n'.repeat(60), source: 'o'.repeat(38) + '/' + 'r'.repeat(100) });
  assert.ok(long.length > 500 || (long + 'x'.repeat(501)).length > 500);
  const padded = long.length > 500 ? long : line({ why: 'fits' }) + ' '.repeat(501);
  const r = run(t, [padded]);
  assert.equal(r.json.lines[0].ok, false);
  assert.ok(!r.out.includes('wwwwwwww'), 'offending text is never echoed');
});
test('AC1 a 500-character line is not rejected for its length alone', T8, (t) => {
  const base = line({ why: 'fits' });
  const r = run(t, [base]);
  assert.equal(r.json.lines[0].ok, true);
  assert.ok(base.length <= 500);
});
test('AC1 offending text is never echoed in stdout, stderr or reasons', T8, (t) => {
  const evil = 'IGNORE-PREVIOUS-INSTRUCTIONS';
  const r = run(t, [line({ why: `${evil}; rm -rf` })]);
  assert.equal(r.code, 0);
  assert.equal(r.json.lines[0].ok, false);
  assert.ok(!r.out.includes(evil) && !r.err.includes(evil));
});
test('AC1 injected text outside the Recommended set is never read as a line', T8, (t) => {
  const r = lint(repo(t, handoff([line()], { extra: '\n## Notes\n' + line({ name: 'sneaky' }) })));
  assert.equal(r.json.lines.length, 1);
  assert.equal(r.json.record.length, 1);
  assert.ok(!r.json.record[0].includes('sneaky'));
});
test('AC1 candidate-section lines with a recommended shape are not read as recommended lines', T8, (t) => {
  const text = handoff([line()]).replace('- (see below)', line({ name: 'in-candidates' }));
  const r = lint(repo(t, text));
  assert.equal(r.json.lines.length, 1);
  assert.ok(!r.json.record.join('\n').includes('in-candidates'));
});

// ---------- the Handoff argument ----------
for (const [label, arg] of [
  ['parent traversal', '../x.md'], ['absolute path', '/etc/passwd'], ['Windows absolute', 'C:\\x\\08-skill-researcher.md'],
  ['wrong file name', '.company/work/demo/08-qa.md'], ['no step number', '.company/work/demo/skill-researcher.md'],
  ['uppercase slug', '.company/work/Demo/08-skill-researcher.md'], ['slug with ..', '.company/work/../08-skill-researcher.md'],
  ['nested folder', '.company/work/demo/x/08-skill-researcher.md'], ['65-char slug', `.company/work/${'a'.repeat(65)}/08-skill-researcher.md`],
  ['backslash form', '.company\\work\\demo\\08-skill-researcher.md'], ['trailing text', '.company/work/demo/08-skill-researcher.md;x'],
  ['empty', ''],
]) {
  test(`AC1 a bad Handoff path is refused (${label}), exit 2`, T8, (t) => {
    const cwd = repo(t, handoff([line()]));
    const r = lint(cwd, arg);
    assert.equal(r.code, 2);
    assert.match(r.out + r.err, /refused: /);
    assert.equal(r.json, null);
  });
}
test('AC1 a missing Handoff file is refused', T8, (t) => {
  const r = lint(repo(t, null));
  assert.equal(r.code, 2);
  assert.match(r.out + r.err, /refused: /);
});
test('AC1 a Handoff over 256 KiB is refused', T8, (t) => {
  const r = lint(repo(t, handoff([line()]) + '\n' + 'x'.repeat(256 * 1024)));
  assert.equal(r.code, 2);
  assert.match(r.out + r.err, /refused: /);
});
test('AC1 a directory in place of the Handoff is refused', T8, (t) => {
  const cwd = repo(t, null);
  mkdirSync(join(cwd, REL), { recursive: true });
  const r = lint(cwd);
  assert.equal(r.code, 2);
});
test('AC1 a symlinked Handoff is refused', T8, (t) => {
  const cwd = repo(t, handoff([line()]), { rel: 'elsewhere/real.md' });
  mkdirSync(join(cwd, '.company', 'work', 'demo'), { recursive: true });
  try { symlinkSync(join(cwd, 'elsewhere', 'real.md'), join(cwd, REL), 'file'); } catch (e) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(e.code)) { t.skip('symlinks unavailable here'); return; }
    throw e;
  }
  const r = lint(cwd);
  assert.equal(r.code, 2);
  assert.match(r.out + r.err, /refused: /);
});
test('AC1 a symlinked slug folder is refused', T8, (t) => {
  const cwd = repo(t, handoff([line()]), { rel: 'elsewhere/08-skill-researcher.md' });
  mkdirSync(join(cwd, '.company', 'work'), { recursive: true });
  try { symlinkSync(join(cwd, 'elsewhere'), join(cwd, '.company', 'work', 'demo'), 'junction'); } catch (e) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(e.code)) { t.skip('links unavailable here'); return; }
    throw e;
  }
  assert.equal(lint(cwd).code, 2);
});
test('AC1 lint with a missing or extra argument is refused', T8, (t) => {
  const cwd = repo(t, handoff([line()]));
  for (const args of [['lint'], ['lint', REL, REL], ['bogus', REL], []]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stdout + r.stderr, /refused: /);
  }
});
test('AC1 the Handoff without a valid area in its frontmatter is refused or reports no area, never records', T8, (t) => {
  const text = handoff([line()]).replace('area: stack', 'area: nonsense');
  const r = lint(repo(t, text));
  if (r.code === 0) assert.deepEqual(r.json.record, []); else assert.equal(r.code, 2);
});
test('AC6 lint is read-only: no file is created or changed in the product repo', T8, (t) => {
  const cwd = repo(t, handoff([line()]));
  const before = spawnSync(process.execPath, ['-e', 'const fs=require("fs");const o=[];const w=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+"/"+e.name;o.push(p+":"+(e.isFile()?fs.statSync(p).mtimeMs:""));if(e.isDirectory())w(p)}};w(process.argv[1]);console.log(o.sort().join("\\n"))', cwd], { encoding: 'utf8' }).stdout;
  assert.equal(lint(cwd).code, 0);
  const after = spawnSync(process.execPath, ['-e', 'const fs=require("fs");const o=[];const w=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+"/"+e.name;o.push(p+":"+(e.isFile()?fs.statSync(p).mtimeMs:""));if(e.isDirectory())w(p)}};w(process.argv[1]);console.log(o.sort().join("\\n"))', cwd], { encoding: 'utf8' }).stdout;
  assert.equal(after, before);
});
