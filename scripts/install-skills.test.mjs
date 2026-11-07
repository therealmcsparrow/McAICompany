import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync as __mkdtemp, rmSync as __rmTree, copyFileSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync, existsSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { join, resolve, sep, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, runAll, expand, missing, parseDesignSkills, main, retiredSkills, manifestFromBaseline, skillsEnv, cleanPath, installExec } from './install-skills.mjs';
import { readBaseline, boundedFolderHash as boundedFolderHashOf } from './skill-catalog.mjs';
// Remove the temp dirs this file made, once the run is over.
const __tmpDirs = [];
const mkdtempSync = (...a) => { const d = __mkdtemp(...a); __tmpDirs.push(d); return d; };
process.on('exit', () => { for (const d of __tmpDirs) { try { __rmTree(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

const TODAY = new Date('2026-10-22T12:00:00Z');
const manifest = {
  core: [
    { name: 'wordsmith', source: 'acme/wordsmith' },
    { name: 'hallmark', source: 'nutlope/hallmark' },
    { name: 'impeccable', install: 'npx -y impeccable skills install' },
    { include: 'research' }
  ],
  research: [{ name: 'find-skills', source: 'vercel-labs/skills', license: 'MIT', vetted: '2026-10-22' }],
  go: [{ name: 'golang-*', source: 'samber/cc-skills-golang' }]
};


const line = (o = {}) => {
  const f = { name: 'hallmark', source: 'nutlope/hallmark', license: 'MIT', vetted: '2026-10-22', why: 'good', approved: '2026-10-22', ...o };
  return `- name: ${f.name}; source: ${f.source}; license: ${f.license}; vetted: ${f.vetted}; why: ${f.why}; approved: ${f.approved}`;
};
const doc = (...lines) => `# P\n\n## Design skills\n<!-- approved -->\n${lines.join('\n')}\n\n## Next\nx\n`;

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), 'aico-skills-'));
  const home = join(base, 'home');
  const root = join(base, 'product');
  mkdirSync(home);
  mkdirSync(join(root, '.company'), { recursive: true });
  const projectFile = join(root, '.company', 'project.md');
  const calls = [];
  const out = [];
  const run = (args, md, extra = {}) => {
    if (md !== undefined) writeFileSync(projectFile, md);
    const code = main(args, { manifest, home, cwd: base, today: TODAY, platform: 'linux', log: s => out.push(s), exec: (c, cwd) => calls.push([c, cwd]), ...extra });
    return { code, out: out.join('\n'), calls };
  };
  return { base, root, projectFile, run, done: () => rmSync(base, { recursive: true, force: true }) };
}

test('hostile: error never echoes the text, even in parseDesignSkills', () => {
  assert.throws(() => parseDesignSkills(doc(line({ source: 'owner/SECRETMARK&&x' })), manifest, TODAY), e => {
    assert.match(e.message, /^design skill line 5: source invalid$/);
    return !e.message.includes('SECRETMARK');
  });
});

test('hostile: bad group names cannot reach Object.prototype', () => {
  for (const g of ['__proto__', 'constructor', 'toString']) {
    assert.throws(() => expand(manifest, [g]), /unknown group/);
  }
});

// ---- dates are compared against the local calendar day, not UTC ----
// Pin the process time zone per case so a UTC-comparison regression fails on any runner.
function inZone(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { fn(); } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
}

test('approved today is accepted just after local midnight in a zone ahead of UTC', () => {
  inZone('Pacific/Auckland', () => {
    const justAfterMidnight = new Date(2026, 9, 22, 0, 30); // local 22nd; UTC is still the 21st
    assert.equal(justAfterMidnight.getUTCDate(), 21, 'zone pin took effect');
    const got = parseDesignSkills(doc(line({ vetted: '2026-10-22', approved: '2026-10-22' })), manifest, justAfterMidnight);
    assert.equal(got.length, 1);
    const twoAm = new Date(2026, 9, 22, 1, 59);
    assert.equal(parseDesignSkills(doc(line()), manifest, twoAm).length, 1);
  });
});

test('tomorrow is still refused late in the local evening in a zone behind UTC', () => {
  inZone('Pacific/Honolulu', () => {
    const lateEvening = new Date(2026, 9, 22, 23, 30); // local 22nd; UTC is already the 23rd
    assert.equal(lateEvening.getUTCDate(), 23, 'zone pin took effect');
    assert.throws(() => parseDesignSkills(doc(line({ approved: '2026-10-23' })), manifest, lateEvening), /approved invalid/);
    assert.throws(() => parseDesignSkills(doc(line({ vetted: '2026-10-23' })), manifest, lateEvening), /vetted invalid/);
  });
});

// ---- valid parsing ----
test('parseDesignSkills accepts repo, manifest command and plugin lines', () => {
  const m = { ...manifest };
  const got = parseDesignSkills(doc(
    line(),
    line({ name: 'impeccable', source: '`npx -y impeccable skills install`', license: 'Apache-2.0' }),
    line({ name: 'aico:ui-design', source: 'plugin aico', license: '-', vetted: '-' })
  ), m, TODAY);
  assert.deepEqual(got.map(e => e.name), ['hallmark', 'impeccable', 'aico:ui-design']);
  assert.equal(got[0].source, 'nutlope/hallmark');
  assert.equal(got[1].install, 'npx -y impeccable skills install');
  assert.equal(got[2].plugin, 'aico');
});

test('empty section, missing section and CRLF files', () => {
  assert.deepEqual(parseDesignSkills(doc('- (none yet; the design-researcher proposes them)'), manifest, TODAY), []);
  assert.deepEqual(parseDesignSkills('# no section\n', manifest, TODAY), []);
  assert.equal(parseDesignSkills(doc(line()).replace(/\n/g, '\r\n'), manifest, TODAY).length, 1);
});

test('section ends at the next ## heading', () => {
  assert.equal(parseDesignSkills(doc(line()) + 'rm -rf /\n', manifest, TODAY).length, 1);
});

// ---- command generation ----
test('user-scope commands have -g and no cwd; plan returns the pinned form', () => {
  const cmds = plan(manifest, ['core'], new Set(['wordsmith']), 'linux');
  assert.deepEqual(cmds, [
    { cmd: 'npx -y skills@1.7.4 add nutlope/hallmark -s hallmark -g -a claude-code -y', argv: ['-y', 'skills@1.7.4', 'add', 'nutlope/hallmark', '-s', 'hallmark', '-g', '-a', 'claude-code', '-y'] },
    { cmd: 'npx -y impeccable skills install', manual: true, name: 'impeccable' },
    { cmd: 'npx -y skills@1.7.4 add vercel-labs/skills -s find-skills -g -a claude-code -y', argv: ['-y', 'skills@1.7.4', 'add', 'vercel-labs/skills', '-s', 'find-skills', '-g', '-a', 'claude-code', '-y'] }
  ]);
});

test('wildcard: skipped when any match is installed; quoted per platform', () => {
  assert.deepEqual(plan(manifest, ['go'], new Set(['golang-cli']), 'linux'), []);
  assert.equal(plan(manifest, ['go'], new Set(), 'linux')[0].cmd, "npx -y skills@1.7.4 add samber/cc-skills-golang -s '*' -g -a claude-code -y");
  assert.equal(plan(manifest, ['go'], new Set(), 'win32')[0].cmd, 'npx -y skills@1.7.4 add samber/cc-skills-golang -s "*" -g -a claude-code -y');
});

// ---- argv form off Windows ----
test('linux: source entries carry exact argv; win32 and manifest install strings never do', () => {
  const m = {
    core: [
      { name: 'hallmark', source: 'nutlope/hallmark' },
      { name: 'impeccable', install: 'npx -y impeccable skills install' }
    ],
    go: [{ name: 'golang-*', source: 'samber/cc-skills-golang' }],
    design: []
  };
  const lin = plan(m, ['core', 'go'], new Set(), 'linux');
  assert.deepEqual(lin[0].argv, ['-y', 'skills@1.7.4', 'add', 'nutlope/hallmark', '-s', 'hallmark', '-g', '-a', 'claude-code', '-y']);
  assert.equal(lin[1].cmd, 'npx -y impeccable skills install');
  assert.ok(!('argv' in lin[1]));
  assert.deepEqual(lin[2].argv, ['-y', 'skills@1.7.4', 'add', 'samber/cc-skills-golang', '-s', '*', '-g', '-a', 'claude-code', '-y']);
  assert.equal(lin[2].cmd, "npx -y skills@1.7.4 add samber/cc-skills-golang -s '*' -g -a claude-code -y");
  const win = plan(m, ['core', 'go'], new Set(), 'win32');
  for (const item of win) assert.ok(!('argv' in item));
  assert.equal(win[0].cmd, 'npx -y skills@1.7.4 add nutlope/hallmark -s hallmark -g -a claude-code -y');
  assert.equal(win[2].cmd, 'npx -y skills@1.7.4 add samber/cc-skills-golang -s "*" -g -a claude-code -y');
});

test('runAll passes argv through to exec', () => {
  const seen = [];
  runAll([{ cmd: 'a', cwd: '/x', argv: ['-y', 'b'] }, 'c'], (c, cwd, argv) => seen.push([c, cwd, argv]));
  assert.deepEqual(seen, [['a', '/x', ['-y', 'b']], ['c', undefined, undefined]]);
});

// ---- include, dedupe ----
test('include expands, unknown group and cycles throw', () => {
  assert.deepEqual(expand(manifest, ['research']).map(e => e.name), ['find-skills']);
  assert.ok(expand(manifest, ['core']).some(e => e.name === 'find-skills'));
  assert.throws(() => expand({ a: [{ include: 'b' }], b: [{ include: 'a' }] }, ['a']), /include cycle a -> b -> a/);
  assert.throws(() => expand({ a: [{ include: 'a' }] }, ['a']), /include cycle a -> a/);
  assert.throws(() => expand({ a: [{ include: 'zzz' }] }, ['a']), /unknown group zzz/);
  assert.throws(() => plan(manifest, ['cobol'], new Set()), /unknown group cobol/);
});

test('core pulls research; find-skills is deduplicated', () => {
  const real = manifestFromBaseline(readBaseline());
  assert.deepEqual(real.research, [{ name: 'find-skills', source: 'vercel-labs/skills' }]);
  assert.ok(real.core.some(e => e.include === 'research'));
  const cmds = plan(real, ['core'], new Set(), 'linux').map(c => c.cmd);
  assert.equal(cmds.filter(c => c.includes('-s find-skills')).length, 1);
  assert.deepEqual(plan(real, ['research'], new Set(), 'linux').length, 1);
  for (const [g, entries] of Object.entries(real)) {
    for (const e of entries) if (e.name) {
      assert.match(e.name, /^[a-z0-9][a-z0-9-]{0,63}\*?$/, g);
      if (e.source) assert.match(e.source, /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/, g);
    }
  }
});

test('invalid manifest entries are refused (defense in depth)', () => {
  assert.throws(() => plan({ core: [{ name: 'a;b', source: 'o/r' }] }, ['core'], new Set()), /invalid manifest entry/);
  assert.throws(() => plan({ core: [{ name: 'a', source: 'o/r && calc' }] }, ['core'], new Set()), /invalid manifest entry/);
  assert.throws(() => plan({ core: [{ name: 'a', source: 'o/..' }] }, ['core'], new Set()), /invalid manifest entry/);
});

// ---- --missing, --project, installed detection ----
test('--missing prints names only and exits 0; nothing missing prints nothing', () => {
  const s = sandbox();
  try {
    const res = s.run(['core', '--missing']);
    assert.equal(res.code, 0);
    assert.equal(res.out, ['wordsmith', 'hallmark', 'impeccable', 'find-skills'].map(n => `missing ${n}`).join('\n'));
    assert.equal(res.calls.length, 0);
    mkdirSync(join(s.base, 'home', '.claude', 'skills'), { recursive: true });
    for (const n of ['wordsmith', 'hallmark', 'impeccable', 'find-skills']) mkdirSync(join(s.base, 'home', '.claude', 'skills', n));
    const none = [];
    assert.equal(main(['core', '--missing'], { manifest, home: join(s.base, 'home'), log: x => none.push(x) }), 0);
    assert.deepEqual(none, []);
  } finally { s.done(); }
});

test('a valid run executes through the injected exec and reports failures', () => {
  const s = sandbox();
  try {
    const res = s.run(['go'], undefined, { exec: () => { throw new Error('boom'); } });
    assert.equal(res.code, 1);
    assert.match(res.out, /FAILED .*boom/);
    assert.match(res.out, /0 installed, 1 failed/);
  } finally { s.done(); }
});

test('runAll continues after a failing command and reports it', () => {
  const ran = [];
  const res = runAll(['a', { cmd: 'b', cwd: '/x' }, 'c'], (c, cwd) => { ran.push([c, cwd]); if (c === 'b') throw new Error('boom'); });
  assert.deepEqual(ran, [['a', undefined], ['b', '/x'], ['c', undefined]]);
  assert.deepEqual(res.ok, ['a', 'c']);
  assert.equal(res.failed[0].cmd, 'b');
  assert.match(res.failed[0].error, /boom/);
});

// ---- retired skills: names in shipped SBOMs that the manifest no longer lists ----
const sbomWith = (...names) => JSON.stringify({ components: names.map(n => ({ type: 'application', 'bom-ref': `skill:${n}@acme/${n}` })) });

function retiredSandbox() {
  const base = mkdtempSync(join(tmpdir(), 'aico-retired-'));
  const home = join(base, 'home');
  const releasesDir = join(base, 'releases');
  const skills = join(home, '.claude', 'skills');
  mkdirSync(skills, { recursive: true });
  mkdirSync(releasesDir);
  const sbom = (ver, text) => {
    mkdirSync(join(releasesDir, ver), { recursive: true });
    writeFileSync(join(releasesDir, ver, 'sbom.cdx.json'), text);
  };
  const out = [];
  const calls = [];
  const man = { core: [{ name: 'hallmark', source: 'nutlope/hallmark' }], go: [{ name: 'golang-*', source: 'samber/cc-skills-golang' }] };
  const run = (args, extra = {}) => {
    out.length = 0;
    const code = main(args, { manifest: man, home, releasesDir, platform: 'win32', log: s => out.push(s), exec: (c, cwd, argv) => calls.push([c, cwd, argv]), ...extra });
    return { code, out: out.join('\n'), lines: [...out] };
  };
  return { base, home, releasesDir, skills, sbom, run, calls, man, done: () => rmSync(base, { recursive: true, force: true }) };
}
const REMOVE_CMD = 'npx -y skills@1.7.4 remove oldskill -g -a claude-code -y';

test('retiredSkills derives names from shipped SBOMs minus the manifest, sorted', () => {
  const s = retiredSandbox();
  try {
    s.sbom('0.1.0', sbomWith('oldskill', 'hallmark', 'golang-lint', 'zeta-old'));
    s.sbom('0.2.0', sbomWith('alpha-old', 'oldskill'));
    assert.deepEqual(retiredSkills(s.man, s.releasesDir), ['alpha-old', 'oldskill', 'zeta-old']);
    assert.deepEqual(retiredSkills(s.man, join(s.base, 'missing')), []);
  } finally { s.done(); }
});

test('retiredSkills drops hostile names and skips untrusted SBOM files', () => {
  const s = retiredSandbox();
  try {
    s.sbom('0.1.0', sbomWith('good-old', 'bad;name', 'a&&b', '$(x)', 'golang-*', '*', 'Up', '-lead', '..', 'x y', 'a'.repeat(65)));
    s.sbom('0.2.0', '{ not json');
    s.sbom('0.3.0', sbomWith('big-old') + ' '.repeat(2 * 1024 * 1024));
    s.sbom('0.4.0', JSON.stringify({ components: [null, 5, { 'bom-ref': 7 }, { 'bom-ref': 'pkg:npm/x@1' }, { 'bom-ref': 'skill:nover' }] }));
    s.sbom('0.5.0', 'null');
    assert.deepEqual(retiredSkills(s.man, s.releasesDir), ['good-old']);
  } finally { s.done(); }
});

test('retiredSkills skips a linked SBOM and a linked release folder', t => {
  const s = retiredSandbox();
  try {
    writeFileSync(join(s.base, 'real.json'), sbomWith('linked-old'));
    mkdirSync(join(s.releasesDir, '0.1.0'));
    mkdirSync(join(s.base, 'elsewhere'));
    writeFileSync(join(s.base, 'elsewhere', 'sbom.cdx.json'), sbomWith('dirlink-old'));
    try {
      symlinkSync(join(s.base, 'real.json'), join(s.releasesDir, '0.1.0', 'sbom.cdx.json'), 'file');
      symlinkSync(join(s.base, 'elsewhere'), join(s.releasesDir, '0.2.0'), 'junction');
    } catch { t.skip('links not permitted here'); return; }
    assert.deepEqual(retiredSkills(s.man, s.releasesDir), []);
  } finally { s.done(); }
});

test('retired skills are listed and removed only on request', t => {
  const s = retiredSandbox();
  try {
    s.sbom('0.1.0', sbomWith('oldskill', 'linkskill', 'gone-old', 'hallmark'));
    mkdirSync(join(s.skills, 'oldskill'));
    mkdirSync(join(s.skills, 'hallmark'));
    mkdirSync(join(s.base, 'target'));
    let linked = true;
    try { symlinkSync(join(s.base, 'target'), join(s.skills, 'linkskill'), 'junction'); } catch { linked = false; }
    const listed = s.run(['--retired']);
    assert.equal(listed.code, 0);
    assert.equal(listed.out, linked ? 'retired linkskill\nretired oldskill' : 'retired oldskill');
    assert.equal(s.calls.length, 0);
    // listing alone removed nothing
    assert.ok(existsSync(join(s.skills, 'oldskill')));
    // --remove runs the pinned command for that one name only and checks the entry is gone
    const res = s.run(['--remove', 'oldskill'], { exec: (c, cwd, argv) => { s.calls.push([c, cwd, argv]); rmSync(join(s.skills, 'oldskill'), { recursive: true }); } });
    assert.equal(res.code, 0);
    assert.deepEqual(res.lines, ['removed oldskill']);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0][0], REMOVE_CMD);
    assert.ok(existsSync(join(s.skills, 'hallmark')));
  } finally { s.done(); }
});

test('--retired prints nothing when no retired skill is installed', () => {
  const s = retiredSandbox();
  try {
    s.sbom('0.1.0', sbomWith('oldskill'));
    const res = s.run(['--retired']);
    assert.equal(res.code, 0);
    assert.deepEqual(res.lines, []);
    assert.equal(s.run(['--retired'], { home: join(s.base, 'nohome') }).code, 0);
  } finally { s.done(); }
});

test('--remove refuses names that are not a retired installed skill and runs nothing', () => {
  const s = retiredSandbox();
  try {
    s.sbom('0.1.0', sbomWith('oldskill', 'notinstalled', 'bad;name', 'golang-*'));
    for (const n of ['oldskill', 'hallmark', 'bad;name', 'golang-*', 'golang-lint', '*', 'a&&b', '$(x)', '../oldskill', '--dry-run', 'Oldskill', '', 'unknown']) {
      mkdirSync(join(s.skills, n.replace(/[^a-z-]/gi, '_') || 'empty'), { recursive: true });
    }
    rmSync(join(s.skills, 'oldskill'), { recursive: true });
    for (const n of ['oldskill', 'hallmark', 'bad;name', 'golang-*', 'golang-lint', '*', 'a&&b', '$(x)', '../oldskill', 'Oldskill', 'notinstalled', 'unknown']) {
      const res = s.run(['--remove', n]);
      assert.equal(res.code, 1, n);
      assert.deepEqual(res.lines, ['ERROR not a retired installed skill'], n);
    }
    const none = s.run(['--remove']);
    assert.equal(none.code, 1);
    assert.deepEqual(none.lines, ['ERROR not a retired installed skill']);
    assert.equal(s.calls.length, 0);
  } finally { s.done(); }
});

test('--remove with --dry-run prints the pinned command and runs nothing', () => {
  const s = retiredSandbox();
  try {
    s.sbom('0.1.0', sbomWith('oldskill'));
    mkdirSync(join(s.skills, 'oldskill'));
    for (const platform of ['win32', 'linux']) {
      const res = s.run(['--remove', 'oldskill', '--dry-run'], { platform });
      assert.equal(res.code, 0);
      assert.deepEqual(res.lines, [`[dry-run] ${REMOVE_CMD}`]);
    }
    assert.equal(s.calls.length, 0);
    assert.ok(existsSync(join(s.skills, 'oldskill')));
  } finally { s.done(); }
});

test('--remove prints manual <cmd> and runs nothing where removal was not proven', () => {
  const s = retiredSandbox();
  try {
    s.sbom('0.1.0', sbomWith('oldskill'));
    mkdirSync(join(s.skills, 'oldskill'));
    for (const platform of ['linux', 'darwin']) {
      const res = s.run(['--remove', 'oldskill'], { platform });
      assert.equal(res.code, 0);
      assert.deepEqual(res.lines, [`manual ${REMOVE_CMD}`]);
    }
    assert.equal(s.calls.length, 0);
  } finally { s.done(); }
});

test('--remove reports FAILED for a failed command and for a skill still there', () => {
  const s = retiredSandbox();
  try {
    s.sbom('0.1.0', sbomWith('oldskill'));
    mkdirSync(join(s.skills, 'oldskill'));
    const fails = (err) => () => { throw Object.assign(new Error('Command failed: npx'), err); };
    let res = s.run(['--remove', 'oldskill'], { exec: fails({ stderr: '\n\nboom happened\nsecond line', status: 3 }) });
    assert.equal(res.code, 1);
    assert.deepEqual(res.lines, [`FAILED ${REMOVE_CMD}: boom happened`]);
    res = s.run(['--remove', 'oldskill'], { exec: fails({ stderr: '', status: 7 }) });
    assert.deepEqual(res.lines, [`FAILED ${REMOVE_CMD}: 7`]);
    res = s.run(['--remove', 'oldskill'], { exec: fails({ stderr: `a\u001b[31mb\u0000c\u007fd${'x'.repeat(300)}` }) });
    const text = res.lines[0].slice(`FAILED ${REMOVE_CMD}: `.length);
    assert.equal(res.lines.length, 1);
    assert.equal(text.length, 200);
    assert.ok(text.startsWith('a [31mb c d'));
    assert.equal(/[\u0000-\u001f\u007f]/.test(text), false);
    // exit 0 but the entry is still there
    res = s.run(['--remove', 'oldskill'], { exec: () => {} });
    assert.equal(res.code, 1);
    assert.equal(res.lines.length, 1);
    assert.ok(res.lines[0].startsWith(`FAILED ${REMOVE_CMD}: `));
    assert.ok(existsSync(join(s.skills, 'oldskill')));
  } finally { s.done(); }
});

test('--retired and --remove take no group or other mode flag', () => {
  const s = retiredSandbox();
  try {
    s.sbom('0.1.0', sbomWith('oldskill'));
    mkdirSync(join(s.skills, 'oldskill'));
    const bad = [['--retired', 'core'], ['--retired', '--missing'], ['--retired', '--project', join(s.base, '.company', 'project.md')],
      ['--remove', 'oldskill', 'core'], ['--remove', 'oldskill', '--missing'], ['--retired', '--remove', 'oldskill'],
      ['--remove', 'oldskill', '--project', join(s.base, '.company', 'project.md')], ['--retired', '--bogus']];
    for (const args of bad) {
      const res = s.run(args);
      assert.equal(res.code, 1, args.join(' '));
      assert.equal(res.lines.length, 1);
      assert.ok(res.lines[0].startsWith('ERROR '));
    }
    assert.equal(s.calls.length, 0);
    assert.ok(existsSync(join(s.skills, 'oldskill')));
  } finally { s.done(); }
});

test('--remove with the real capturing exec holds stdout and stderr and prints one line', () => {
  const s = retiredSandbox();
  try {
    s.sbom('0.1.0', sbomWith('oldskill'));
    const standIn = join(s.base, 'standin.mjs');
    writeFileSync(standIn, [
      "import { rmSync } from 'node:fs';",
      "console.log('stand-in says hello on stdout');",
      "console.error('stand-in says boom on stderr');",
      "if (process.argv[2] === 'ok') { rmSync(process.argv[3], { recursive: true }); process.exit(0); }",
      "process.exit(1);"
    ].join('\n'));
    const runner = join(s.base, 'runner.mjs');
    writeFileSync(runner, [
      `import { main } from ${JSON.stringify(new URL('./install-skills.mjs', import.meta.url).href)};`,
      "const [mode, entry] = process.argv.slice(2);",
      `const standIn = { file: process.execPath, args: [${JSON.stringify(standIn)}, mode, entry] };`,
      `const manifest = { core: [{ name: 'hallmark', source: 'nutlope/hallmark' }] };`,
      `process.exit(main(['--remove', 'oldskill'], { manifest, home: ${JSON.stringify(s.home)}, releasesDir: ${JSON.stringify(s.releasesDir)}, platform: 'win32', standIn }));`
    ].join('\n'));
    const childEnv = { ...process.env, HOME: s.home, USERPROFILE: s.home };
    const entry = join(s.skills, 'oldskill');
    mkdirSync(entry);
    let r = spawnSync(process.execPath, [runner, 'ok', entry], { encoding: 'utf8', env: childEnv });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'removed oldskill\n');
    assert.equal(r.stderr, '');
    assert.equal(existsSync(entry), false);
    mkdirSync(entry);
    r = spawnSync(process.execPath, [runner, 'fail', entry], { encoding: 'utf8', env: childEnv });
    assert.equal(r.status, 1);
    assert.equal(r.stdout.split('\n').length, 2);
    assert.ok(r.stdout.startsWith('FAILED '));
    assert.ok(r.stdout.includes(': stand-in says boom on stderr\n'));
    assert.equal(r.stderr, '');
    assert.equal(existsSync(entry), true);
  } finally { s.done(); }
});

test('the shipped manifest no longer lists the dropped writing clean-up skill', () => {
  const real = manifestFromBaseline(readBaseline());
  const names = Object.values(real).flat().map(e => e.name).filter(Boolean);
  assert.ok(names.includes('hallmark'));
  assert.equal(names.length, new Set(names).size + 1); // find-skills is in core and research
  // The shipped SBOMs list the dropped skill, so it shows as retired. The names are derived, never written here.
  const releases = fileURLToPath(new URL('../releases', import.meta.url));
  const dropped = retiredSkills(real, releases);
  assert.ok(dropped.length > 0, 'no retired name derived from the shipped SBOMs');
  // The base manifest still held the skill: with it added back the list shrinks, so the test fails on the base.
  const base = { ...real, core: [...real.core, ...dropped.map(name => ({ name }))] };
  const left = retiredSkills(base, releases);
  for (const n of dropped) assert.ok(!left.includes(n));
});

test('--remove runs from the home folder, never from the repo that holds a hostile node_modules/skills', () => {
  const s = retiredSandbox();
  try {
    s.sbom('0.1.0', sbomWith('oldskill'));
    mkdirSync(join(s.skills, 'oldskill'));
    // the injected exec sees the working folder the removal gets
    s.run(['--remove', 'oldskill'], { exec: (c, cwd, argv) => s.calls.push([c, cwd, argv]) });
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0][1], s.home);
    // the real capturing exec: the process starts inside a hostile repo, the child must not
    const repo = join(s.base, 'hostile');
    mkdirSync(join(repo, 'node_modules', 'skills'), { recursive: true });
    writeFileSync(join(repo, 'node_modules', 'skills', 'marker'), 'x');
    writeFileSync(join(repo, '.npmrc'), 'registry=http://127.0.0.1:9/\n');
    const standIn = join(s.base, 'cwd.mjs');
    writeFileSync(standIn, [
      "import { writeFileSync, rmSync, existsSync } from 'node:fs';",
      "import { join } from 'node:path';",
      `writeFileSync(${JSON.stringify(join(s.base, 'seen-cwd.txt'))}, process.cwd());`,
      `writeFileSync(${JSON.stringify(join(s.base, 'seen-env.txt'))}, [process.env.DO_NOT_TRACK, process.env.DISABLE_TELEMETRY].join(','));`,
      `rmSync(${JSON.stringify(join(s.skills, 'oldskill'))}, { recursive: true });`
    ].join('\n'));
    const runner = join(s.base, 'runner-cwd.mjs');
    writeFileSync(runner, [
      `import { main } from ${JSON.stringify(new URL('./install-skills.mjs', import.meta.url).href)};`,
      `const standIn = { file: process.execPath, args: [${JSON.stringify(standIn)}] };`,
      `const manifest = { core: [{ name: 'hallmark', source: 'nutlope/hallmark' }] };`,
      `process.exit(main(['--remove', 'oldskill'], { manifest, home: ${JSON.stringify(s.home)}, releasesDir: ${JSON.stringify(s.releasesDir)}, platform: 'win32', standIn }));`
    ].join('\n'));
    const r = spawnSync(process.execPath, [runner], { encoding: 'utf8', cwd: repo, env: { ...process.env, HOME: s.home, USERPROFILE: s.home } });
    assert.equal(r.stdout, 'removed oldskill\n');
    assert.equal(realpathSync(readFileSync(join(s.base, 'seen-cwd.txt'), 'utf8')), realpathSync(s.home));
    assert.equal(readFileSync(join(s.base, 'seen-env.txt'), 'utf8'), '1,1');
  } finally { s.done(); }
});

test('--remove reports FAILED when the removal outlives its time limit', () => {
  const s = retiredSandbox();
  try {
    s.sbom('0.1.0', sbomWith('oldskill'));
    mkdirSync(join(s.skills, 'oldskill'));
    const standIn = join(s.base, 'hang.mjs');
    writeFileSync(standIn, 'setTimeout(() => {}, 20000);\n');
    const runner = join(s.base, 'runner-hang.mjs');
    writeFileSync(runner, [
      `import { main } from ${JSON.stringify(new URL('./install-skills.mjs', import.meta.url).href)};`,
      `const standIn = { file: process.execPath, args: [${JSON.stringify(standIn)}] };`,
      `const manifest = { core: [{ name: 'hallmark', source: 'nutlope/hallmark' }] };`,
      `process.exit(main(['--remove', 'oldskill'], { manifest, home: ${JSON.stringify(s.home)}, releasesDir: ${JSON.stringify(s.releasesDir)}, platform: 'win32', standIn, timeoutMs: 400 }));`
    ].join('\n'));
    const r = spawnSync(process.execPath, [runner], { encoding: 'utf8', env: { ...process.env, HOME: s.home, USERPROFILE: s.home } });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, `FAILED ${REMOVE_CMD}: timed out, it may still finish\n`);
    assert.ok(existsSync(join(s.skills, 'oldskill')));
  } finally { s.done(); }
});

test('installs run from the home folder', () => {
  const calls = [];
  const home = mkdtempSync(join(tmpdir(), 'aico-home-'));
  const out = [];
  main(['core'], { manifest: { core: [{ name: 'hallmark', source: 'nutlope/hallmark' }] }, home, cwd: '/repo', platform: 'linux', log: x => out.push(x), exec: (c, cwd) => calls.push([c, cwd]) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], home);
  assert.ok(!out.some(l => l.includes('(in ')));
});

test('skillsEnv switches both telemetry variables on, keeps the rest and leaves the process alone', () => {
  const before = { dnt: process.env.DO_NOT_TRACK, dt: process.env.DISABLE_TELEMETRY };
  const env = skillsEnv({ PATH: '/bin', DO_NOT_TRACK: '' });
  assert.equal(env.DO_NOT_TRACK, '1');
  assert.equal(env.DISABLE_TELEMETRY, '1');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.NoDefaultCurrentDirectoryInExePath, '1');
  assert.deepEqual({ dnt: process.env.DO_NOT_TRACK, dt: process.env.DISABLE_TELEMETRY }, before);
});

test('cleanPath drops product folders, relative entries and .bin folders of the product and its parents', () => {
  const root = resolve(tmpdir(), 'aico-cp', 'a', 'product');
  const keep = resolve(tmpdir(), 'aico-cp', 'sys');
  const entries = [join(root, 'node_modules', '.bin'), join(root, 'tools'), join(root, '..', 'node_modules', '.bin'), join(root, '..', '..', 'node_modules', '.bin'), 'bin', '.', '', keep];
  assert.equal(cleanPath(entries.join(delimiter), root), keep);
});

test('a home folder with characters a shell would act on is refused before any command starts', () => {
  for (const home of ['/tmp/a%b', '/tmp/a"b', '/tmp/a$(x)', '/tmp/a`x`', 'C:\\Users\\x\\']) {
    let started = 0;
    const spy = () => { started++; };
    const exec = installExec(home, { execSync: spy, execFileSync: spy });
    assert.throws(() => exec('npx -y tool install', home, undefined), /cannot be used/, home);
    assert.equal(started, 0, home);
  }
  let seen;
  installExec('/tmp/fine home', { execSync: c => { seen = c; }, execFileSync: () => { throw new Error('no'); } })('npx -y tool install', '/tmp/fine home');
  assert.equal(seen, 'npx --prefix "/tmp/fine home" -y tool install');
});

test('a manifest command is not run with a product folder as working folder', () => {
  let started = 0;
  const spy = () => { started++; };
  const exec = installExec('/h', { execSync: spy, execFileSync: spy });
  assert.throws(() => exec('npx -y tool install', '/repo/product'), /product folder/);
  assert.equal(started, 0);
});

test('an install that outlives its time limit is reported with the timeout text', () => {
  const out = [];
  const code = main(['core'], { manifest: { core: [{ name: 'hallmark', source: 'nutlope/hallmark' }] }, home: '/h', cwd: '/repo', platform: 'linux', log: x => out.push(x), exec: () => { throw Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }); } });
  assert.equal(code, 1);
  assert.ok(out.some(l => l.endsWith(': timed out, it may still finish')), out.join('|'));
});

const PINNED_IMPECCABLE = 'npx -y impeccable@4.8.0 skills install';
function userScopeRun(color) {
  const out = [], calls = [];
  const m = { core: [{ name: 'hallmark', source: 'nutlope/hallmark' }, { name: 'impeccable', install: PINNED_IMPECCABLE }] };
  const code = main(['core'], { manifest: m, home: '/h', cwd: '/repo', platform: 'linux', color, log: x => out.push(x), exec: c => { calls.push(c); } });
  return { code, out, calls };
}

test('main: a manifest command at user scope is printed as manual with a WARNING line, never run (B4)', () => {
  const { code, out, calls } = userScopeRun(false);
  assert.equal(code, 0, out.join('|'));
  assert.equal(calls.length, 1);
  assert.ok(calls.every(c => !c.includes('impeccable')), calls.join('|'));
  assert.ok(out.includes(`manual ${PINNED_IMPECCABLE}`), out.join('|'));
  const w = out.filter(l => l.includes('WARNING'));
  assert.equal(w.length, 1, out.join('|'));
  assert.match(w[0], /^WARNING: impeccable /);
  assert.match(w[0], /third.party/);
  assert.match(w[0], /not inspected/);
  assert.match(w[0], /home folder only, never from a product folder/);
  assert.match(w[0], /repo's own copy/);
  assert.match(w[0], /only if you trust it/);
  assert.ok(w[0].endsWith(`then run: ${PINNED_IMPECCABLE}`), w[0]);
  assert.ok(!out.join('').includes(''));
  assert.ok(out.includes('1 installed, 0 failed'), out.join('|'));
});

test('main: the WARNING line is ANSI yellow only when colour is on', () => {
  const on = userScopeRun(true).out.find(l => l.includes('WARNING'));
  assert.ok(on.startsWith('[33mWARNING: ') && on.endsWith('[0m'), JSON.stringify(on));
  const off = userScopeRun(false).out.find(l => l.includes('WARNING'));
  assert.ok(off.startsWith('WARNING: '), JSON.stringify(off));
});

const PINNED_MANIFEST = { core: [{ name: 'impeccable', install: PINNED_IMPECCABLE }] };

// The colour rule reads process.stdout.isTTY and NO_COLOR itself when env.color is not given.
function colourRun({ tty, noColor }) {
  const was = { tty: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'), nc: process.env.NO_COLOR };
  Object.defineProperty(process.stdout, 'isTTY', { value: tty, configurable: true, writable: true });
  if (noColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = noColor;
  try {
    const out = [];
    main(['core'], { manifest: PINNED_MANIFEST, home: '/h', cwd: '/repo', platform: 'linux', log: x => out.push(x), exec: () => {} });
    return out.find(l => l.includes('WARNING'));
  } finally {
    if (was.tty) Object.defineProperty(process.stdout, 'isTTY', was.tty); else delete process.stdout.isTTY;
    if (was.nc === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = was.nc;
  }
}

test('main: WARNING colour rule without env.color: TTY is yellow, NO_COLOR is plain, a pipe is plain', () => {
  const yellow = colourRun({ tty: true, noColor: undefined });
  assert.ok(yellow.startsWith('\u001b[33mWARNING: ') && yellow.endsWith('\u001b[0m'), JSON.stringify(yellow));
  const plainEnv = colourRun({ tty: true, noColor: '1' });
  assert.ok(plainEnv.startsWith('WARNING: ') && !plainEnv.includes('\u001b'), JSON.stringify(plainEnv));
  const pipe = colourRun({ tty: undefined, noColor: undefined });
  assert.ok(pipe.startsWith('WARNING: ') && !pipe.includes('\u001b'), JSON.stringify(pipe));
});

test('user scope drops only node_modules/.bin folders from PATH, not other folders under home', () => {
  const base = mkdtempSync(join(tmpdir(), 'aico-userpath-'));
  const home = join(base, 'home');
  const pkg = join(home, '.mcsparrow', 'cli', 'skills-1.7.4', 'node_modules', 'skills');
  mkdirSync(join(pkg, 'bin'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'skills', version: '1.7.4', bin: { skills: 'bin/cli.mjs' } }));
  writeFileSync(join(pkg, 'bin', 'cli.mjs'), '');
  writeFileSync(join(home, '.mcsparrow', 'cli', 'skills-1.7.4', 'package.json'), '{"private":true}\n');
  const keep = join(home, 'bin');
  const drop = join(home, 'node_modules', '.bin');
  const envs = [];
  const run = (c, a, o) => { envs.push(o.env); };
  const oldPath = process.env.PATH;
  process.env.PATH = [keep, drop].join(delimiter);
  try {
    installExec(home, { execSync: run, execFileSync: run })('npx -y skills@1.7.4 add a/b -s c -g -a claude-code -y', home, ['-y', 'skills@1.7.4', 'add', 'a/b', '-s', 'c', '-g', '-a', 'claude-code', '-y']);
  } finally { process.env.PATH = oldPath; }
  const key = Object.keys(envs.at(-1)).find(k => k.toLowerCase() === 'path');
  assert.deepEqual(envs.at(-1)[key].split(delimiter), [keep]);
});

// Frozen copy of the dry-run output the shipped group map gave before the baseline file existed.
const FROZEN = {
  "linux core": ["[dry-run] npx -y skills@1.7.4 add vercel-labs/skills -s find-skills -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add nutlope/hallmark -s hallmark -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add addyosmani/agent-skills -s frontend-ui-engineering -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add addyosmani/agent-skills -s security-and-hardening -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add getsentry/skills -s security-review -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add wshobson/agents -s auth-implementation-patterns -g -a claude-code -y","manual npx -y impeccable@4.8.0 skills install","WARNING: impeccable is a third-party installer that aico has not inspected, so it was not run. To install it, run it yourself from your home folder only, never from a product folder, because a repo's own copy of the package would run instead. Run it only if you trust it. First change to your home folder, then run: npx -y impeccable@4.8.0 skills install"],
  "linux research": ["[dry-run] npx -y skills@1.7.4 add vercel-labs/skills -s find-skills -g -a claude-code -y"],
  "linux go": ["[dry-run] npx -y skills@1.7.4 add samber/cc-skills-golang -s '*' -g -a claude-code -y"],
  "linux react": ["[dry-run] npx -y skills@1.7.4 add vercel-labs/agent-skills -s vercel-react-best-practices -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add vercel-labs/agent-skills -s vercel-composition-patterns -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add wshobson/agents -s typescript-advanced-types -g -a claude-code -y"],
  "linux tanstack": ["[dry-run] npx -y skills@1.7.4 add tanstack-skills/tanstack-skills -s tanstack-query -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add tanstack-skills/tanstack-skills -s tanstack-router -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add tanstack-skills/tanstack-skills -s tanstack-form -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add tanstack-skills/tanstack-skills -s tanstack-table -g -a claude-code -y"],
  "linux auth": ["[dry-run] npx -y skills@1.7.4 add better-auth/skills -s two-factor-authentication-best-practices -g -a claude-code -y"],
  "win32 core": ["[dry-run] npx -y skills@1.7.4 add vercel-labs/skills -s find-skills -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add nutlope/hallmark -s hallmark -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add addyosmani/agent-skills -s frontend-ui-engineering -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add addyosmani/agent-skills -s security-and-hardening -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add getsentry/skills -s security-review -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add wshobson/agents -s auth-implementation-patterns -g -a claude-code -y","manual npx -y impeccable@4.8.0 skills install","WARNING: impeccable is a third-party installer that aico has not inspected, so it was not run. To install it, run it yourself from your home folder only, never from a product folder, because a repo's own copy of the package would run instead. Run it only if you trust it. First change to your home folder, then run: npx -y impeccable@4.8.0 skills install"],
  "win32 research": ["[dry-run] npx -y skills@1.7.4 add vercel-labs/skills -s find-skills -g -a claude-code -y"],
  "win32 go": ["[dry-run] npx -y skills@1.7.4 add samber/cc-skills-golang -s \"*\" -g -a claude-code -y"],
  "win32 react": ["[dry-run] npx -y skills@1.7.4 add vercel-labs/agent-skills -s vercel-react-best-practices -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add vercel-labs/agent-skills -s vercel-composition-patterns -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add wshobson/agents -s typescript-advanced-types -g -a claude-code -y"],
  "win32 tanstack": ["[dry-run] npx -y skills@1.7.4 add tanstack-skills/tanstack-skills -s tanstack-query -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add tanstack-skills/tanstack-skills -s tanstack-router -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add tanstack-skills/tanstack-skills -s tanstack-form -g -a claude-code -y","[dry-run] npx -y skills@1.7.4 add tanstack-skills/tanstack-skills -s tanstack-table -g -a claude-code -y"],
  "win32 auth": ["[dry-run] npx -y skills@1.7.4 add better-auth/skills -s two-factor-authentication-best-practices -g -a claude-code -y"],
  "missing": ["missing find-skills","missing hallmark","missing impeccable","missing frontend-ui-engineering","missing security-and-hardening","missing security-review","missing auth-implementation-patterns"],
};

const emptyHome = () => mkdtempSync(join(tmpdir(), 'aico-frozen-'));
const dry = (args, extra = {}) => {
  const out = [];
  const code = main(args, { home: emptyHome(), color: false, log: x => out.push(x), exec: () => assert.fail('a dry run runs nothing'), ...extra });
  return { code, out };
};

test('every group of the baseline prints the commands the old manifest printed, byte for byte', () => {
  for (const platform of ['linux', 'win32']) {
    for (const g of ['core', 'research', 'go', 'react', 'tanstack', 'auth']) {
      const res = dry([g, '--dry-run'], { platform });
      assert.equal(res.code, 0);
      assert.deepEqual(res.out, FROZEN[`${platform} ${g}`], `${platform} ${g}`);
    }
  }
  const missingOut = [];
  main(['core', '--missing'], { home: emptyHome(), log: x => missingOut.push(x) });
  assert.deepEqual(missingOut, FROZEN.missing);
});

test('groups design and skills are unknown, and --project is an unknown flag', () => {
  for (const g of ['design', 'skills']) {
    const res = dry([g, '--dry-run']);
    assert.equal(res.code, 1);
    assert.deepEqual(res.out, [`ERROR unknown group ${g}`]);
    assert.equal(Object.hasOwn(manifestFromBaseline(readBaseline()), g), false);
  }
  const res = dry(['core', '--project', '.company/project.md', '--dry-run']);
  assert.equal(res.code, 1);
  assert.deepEqual(res.out, ['ERROR unknown flag']);
});

test('a license, hash or date on an entry changes no command, and a planted user file changes none', () => {
  const base = readBaseline();
  const groups = ['core', 'go', 'react', 'auth'];
  const want = plan(manifestFromBaseline(base), groups, new Set(), 'linux');
  const changed = { ...base, entries: base.entries.map(e => ({ ...e, license: 'GPL-3.0-only', vetted: '2026-01-01', hash: 'sha256:' + 'a'.repeat(64) })) };
  assert.deepEqual(plan(manifestFromBaseline(changed), groups, new Set(), 'linux'), want);
  const home = emptyHome();
  mkdirSync(join(home, '.mcsparrow'), { recursive: true });
  writeFileSync(join(home, '.mcsparrow', '3rdpartyskills.json'), JSON.stringify({ schema: 1, entries: [{ skillname: 'planted', skillcategory: 'engineering', skillrepo: 'evil/planted', skillcommit: 'a'.repeat(40), license: 'MIT' }] }));
  const withUser = [];
  main(['core', 'go', '--dry-run'], { home, platform: 'linux', color: false, log: x => withUser.push(x) });
  assert.deepEqual(withUser, dry(['core', 'go', '--dry-run'], { platform: 'linux' }).out);
  assert.ok(!withUser.join('\n').includes('planted'));
});

test('a command entry prints manual by its kind, whatever its text says, and reaches no exec path', () => {
  const lookalike = 'npx -y skills@1.7.4 add evil/tool -s tool -g -a claude-code -y';
  const m = { core: [{ name: 'tool', install: lookalike }, { name: 'hallmark', source: 'nutlope/hallmark' }] };
  const ran = [];
  const out = [];
  const code = main(['core'], { manifest: m, home: emptyHome(), platform: 'linux', color: false, log: x => out.push(x), exec: (c, cwd, argv) => ran.push([c, cwd, argv]) });
  assert.equal(code, 0);
  assert.equal(ran.length, 1);
  assert.match(ran[0][0], /nutlope\/hallmark/);
  assert.ok(out.includes(`manual ${lookalike}`));
  assert.match(out.find(l => l.startsWith('WARNING')), /^WARNING: tool is a third-party installer/);
  const items = plan(m, ['core'], new Set(), 'linux');
  assert.equal(items[0].manual, true);
  assert.equal('argv' in items[0], false);
  assert.equal(items[1].manual, undefined);
});

test('the plugin entry is in no group, so expand and plan print nothing for it', () => {
  const real = manifestFromBaseline(readBaseline());
  for (const g of Object.keys(real)) assert.ok(!expand(real, [g]).some(e => e.name === 'aico:ui-design' || e.plugin !== undefined), g);
  assert.ok(!plan(real, Object.keys(real), new Set(), 'linux').some(c => c.cmd.includes('aico')));
});

test('--retired skips a name the user catalog holds and still lists the others', () => {
  const s = retiredSandbox();
  try {
    s.sbom('0.1.0', sbomWith('oldskill', 'mine'));
    for (const n of ['oldskill', 'mine']) mkdirSync(join(s.skills, n));
    assert.equal(s.run(['--retired']).out, 'retired mine\nretired oldskill');
    mkdirSync(join(s.home, '.mcsparrow'), { recursive: true });
    writeFileSync(join(s.home, '.mcsparrow', '3rdpartyskills.json'), JSON.stringify({ schema: 1, entries: [{ skillname: 'mine', skillcategory: 'engineering', skillrepo: 'acme/mine', skillcommit: 'b'.repeat(40), license: 'MIT' }] }));
    assert.equal(s.run(['--retired']).out, 'retired oldskill');
    const res = s.run(['--remove', 'mine']);
    assert.equal(res.code, 1);
    assert.match(res.out, /ERROR not a retired installed skill/);
    assert.equal(s.calls.length, 0);
    assert.deepEqual(retiredSkills(s.man, s.releasesDir, ['mine']), ['oldskill']);
  } finally { s.done(); }
});

// ---- selected installs: every folder present at the root must match the scan ----
const SEL_COMMIT = 'a'.repeat(40);
const SEL_NAME = 'demo-skill';
function selSetup(folders) {
  const home = mkdtempSync(join(tmpdir(), 'sel-home-'));
  const root = mkdtempSync(join(tmpdir(), 'sel-root-'));
  const scan = mkdtempSync(join(tmpdir(), 'sel-scan-'));
  writeFileSync(join(scan, 'SKILL.md'), 'pinned');
  mkdirSync(join(home, '.mcsparrow'), { recursive: true });
  writeFileSync(join(home, '.mcsparrow', '3rdpartyskills.json'), JSON.stringify({ schema: 1, entries: [{ skillname: SEL_NAME, skillcategory: 'engineering', skillrepo: 'octo/skills', skillcommit: SEL_COMMIT, license: 'MIT' }] }));
  for (const [dir, body] of Object.entries(folders)) {
    mkdirSync(join(root, dir, SEL_NAME), { recursive: true });
    writeFileSync(join(root, dir, SEL_NAME, 'SKILL.md'), body);
  }
  return { home, root, scan };
}
const selEnv = (s, extra = {}) => {
  const log = [];
  const calls = [];
  return {
    log, calls,
    env: {
      home: s.home, productRoot: s.root, today: '2026-11-06', log: (x) => log.push(x),
      settings: { settings_folder_moved: false, roles: { qa: { skills: [{ name: SEL_NAME, approved: '2026-11-06' }], source: { skills: 'project' } } } },
      vet: async () => ({ commit: SEL_COMMIT, hash: boundedFolderHashOf(s.scan), result: { verdict: 'pass', counts: { critical: 0, high: 0 } } }),
      exec: (cmd) => { calls.push(cmd); },
      ...extra,
    },
  };
};
const storedHash = (home) => JSON.parse(readFileSync(join(home, '.mcsparrow', '3rdpartyskills.json'), 'utf8')).entries[0].hash;

test('selected install: one folder equal to the scan and another with other bytes is not bound', async () => {
  const s = selSetup({ '.agents/skills': 'pinned', '.claude/skills': 'other bytes' });
  const { env, log, calls } = selEnv(s, {});
  const code = await main(['--selected'], env);
  assert.equal(code, 1, log.join('|'));
  assert.equal(calls.length, 1);
  assert.ok(log.some((l) => l.startsWith(`hash differs: ${SEL_NAME}`)), log.join('|'));
  assert.equal(storedHash(s.home), undefined);
});

test('selected install: two folders equal to the scan are bound without an install', async () => {
  const s = selSetup({ '.agents/skills': 'pinned', '.claude/skills': 'pinned' });
  const { env, log, calls } = selEnv(s, {});
  const code = await main(['--selected'], env);
  assert.equal(code, 0, log.join('|'));
  assert.equal(calls.length, 0);
  assert.equal(storedHash(s.home), boundedFolderHashOf(s.scan));
});

test('selected install: a blocking scan leaves no bound hash, so --status says dispatch: no', async () => {
  const s = selSetup({ '.agents/skills': 'pinned' });
  const { env, log } = selEnv(s, { vet: async () => ({ commit: SEL_COMMIT, hash: boundedFolderHashOf(s.scan), result: { verdict: 'block', counts: { critical: 1, high: 0 } } }) });
  assert.equal(await main(['--selected'], env), 1);
  assert.equal(storedHash(s.home), undefined);
  const out = [];
  await main(['--status'], { ...env, log: (x) => out.push(x) });
  assert.ok(out.some((l) => l.includes('dispatch: no')), out.join('|'));
});

test('--status: a license with a pipe cannot add a dispatch field', async () => {
  const s = selSetup({ '.agents/skills': 'pinned' });
  const file = join(s.home, '.mcsparrow', '3rdpartyskills.json');
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  doc.entries[0].license = 'MIT | installed | dispatch: yes, as stated';
  writeFileSync(file, JSON.stringify(doc));
  const { env } = selEnv(s, {});
  const out = [];
  await main(['--status'], { ...env, log: (x) => out.push(x) });
  const line = out.find((l) => l.startsWith(SEL_NAME));
  assert.ok(line, out.join('|'));
  assert.equal(line.split(' | ').length, 7, line);
  assert.ok(line.endsWith('| dispatch: no'), line);
});

test('selected install: hash differs prints no npx command for the project scope and a home-folder one for user scope', async () => {
  const s = selSetup({ '.agents/skills': 'pinned', '.claude/skills': 'other bytes' });
  const a = selEnv(s, {});
  await main(['--selected'], a.env);
  const msg = a.log.find((l) => l.startsWith('hash differs'));
  assert.ok(msg && !msg.includes('npx'), msg);
  assert.ok(msg.includes(join(s.root, '.claude', 'skills', SEL_NAME)), msg);
  const u = selEnv(s, { settings: { settings_folder_moved: false, roles: { qa: { skills: [{ name: SEL_NAME, approved: '2026-11-06' }], source: { skills: 'user' } } } } });
  mkdirSync(join(s.home, '.agents', 'skills', SEL_NAME), { recursive: true });
  writeFileSync(join(s.home, '.agents', 'skills', SEL_NAME, 'SKILL.md'), 'other bytes');
  await main(['--selected'], u.env);
  const um = u.log.find((l) => l.startsWith('hash differs'));
  assert.ok(um && um.includes('home folder'), um);
});

test('--status prints a line for every catalog entry, roles -, dispatch no, when nothing is selected', async () => {
  const s = selSetup({ '.agents/skills': 'pinned' });
  const { env } = selEnv(s, { settings: { settings_folder_moved: false, roles: {} } });
  const out = [];
  await main(['--status'], { ...env, log: (x) => out.push(x) });
  const line = out.find((l) => l.startsWith(`${SEL_NAME} |`));
  assert.ok(line, out.join('|'));
  assert.ok(line.includes('roles: -') && line.endsWith('dispatch: no'), line);
});

test('--status and --selected log the catalog warnings', async () => {
  const s = selSetup({});
  const prev = process.env.MCSPARROW_HOME;
  process.env.MCSPARROW_HOME = join(s.home, 'elsewhere');
  try {
    const { env, log } = selEnv(s, { home: undefined, settings: { settings_folder_moved: false, roles: {} } });
    await main(['--status'], env);
    assert.ok(log.some((l) => /MCSPARROW_HOME/.test(l)), log.join('|'));
  } finally {
    if (prev === undefined) delete process.env.MCSPARROW_HOME; else process.env.MCSPARROW_HOME = prev;
  }
});

test('selected install: a failed scan that cannot clear the old proof logs the write error and exits 1', { skip: process.platform === 'win32' }, async () => {
  const s = selSetup({ '.agents/skills': 'pinned' });
  const file = join(s.home, '.mcsparrow', '3rdpartyskills.json');
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  doc.entries[0].hash = 'a'.repeat(64);
  doc.entries[0].vetted = '2026-11-01';
  writeFileSync(file, JSON.stringify(doc));
  chmodSync(join(s.home, '.mcsparrow'), 0o555);
  try {
    const { env, log } = selEnv(s, { vet: async () => ({ refused: 'scan error' }) });
    assert.equal(await main(['--selected'], env), 1);
    assert.ok(log.some((l) => l.startsWith('ERROR user catalog')), log.join('|'));
  } finally { chmodSync(join(s.home, '.mcsparrow'), 0o755); }
});

// ---- project-level --selected install: the real installExec, a fake registry on 127.0.0.1, nothing from the product folder steers or runs ----
// Ported from 3607191 (npx kept away from a hostile repo, `project install ignores: <label>`, FAILED with no bin file),
// now through main(['--selected']) with a project-level selection. Only the scan is a stand-in; the CLI the installer
// fetches is a local package served by the test, so nothing reaches the network and no third-party code runs.
const HS_COMMIT = 'a'.repeat(40);
const HS_NAME = 'projskill';

function hsTgz(files) {
  const blocks = [];
  for (const [name, body] of Object.entries(files)) {
    const data = Buffer.from(body);
    const h = Buffer.alloc(512);
    h.write(name, 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136);
    h.write('        ', 148); h.write('0', 156); h.write('ustar\0' + '00', 257);
    h.write(h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
const hsListen = (handler) => new Promise((res) => { const srv = http.createServer(handler).listen(0, '127.0.0.1', () => res(srv)); });
const hsChild = (file, opts) => new Promise((res) => {
  const c = spawn(process.execPath, [file], { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
  c.on('close', (status) => res({ status, out, err }));
});

// The stand-in CLI records where it ran and what it can reach, probes `node` (through a shell) and `git` (no shell),
// and leaves the skill folder the scan stand-in expects.
const HS_PROBE_CLI = [
  '#!/usr/bin/env node',
  "import { writeFileSync, mkdirSync } from 'node:fs'; import { spawnSync } from 'node:child_process'; import { join } from 'node:path';",
  "const probe = `require('fs').writeFileSync(${JSON.stringify(process.env.GITMARK)}, 'x')`;",
  "spawnSync('node', ['-v'], { shell: true, stdio: 'ignore' });",
  "spawnSync('git', ['-p', probe], { stdio: 'ignore' });",
  `const dir = join(process.cwd(), '.agents', 'skills', '${HS_NAME}'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'SKILL.md'), 'hello');`,
  "writeFileSync(process.env.REC, JSON.stringify({ who: 'real', cwd: process.cwd(), argv: process.argv.slice(2), dnt: process.env.DO_NOT_TRACK, dt: process.env.DISABLE_TELEMETRY, path: process.env.PATH ?? process.env.Path }));"
].join('\n') + '\n';

async function hostileProject({ plant, pathDirs = () => [], cliFiles, nested = false }) {
  const base = mkdtempSync(join(tmpdir(), 'aico-hostile-'));
  const home = join(base, 'home'), top = nested ? join(base, 'parent') : base;
  const root = join(top, 'product'), rec = join(base, 'rec.json');
  mkdirSync(home);
  mkdirSync(join(root, '.company'), { recursive: true });
  const marks = {};
  const mark = (n) => (marks[n] = join(base, `mark-${n}.txt`));
  const extra = (await plant({ root, top, base, mark, listen: hsListen })) ?? {};
  const cliPkg = JSON.stringify({ name: 'skills', version: '1.7.4', bin: { skills: 'bin/cli.mjs' } });
  const good = hsTgz(cliFiles ?? { 'package/package.json': cliPkg, 'package/bin/cli.mjs': HS_PROBE_CLI });
  const userReg = await hsListen((q, r) => {
    if (q.url.endsWith('.tgz')) { r.setHeader('content-type', 'application/octet-stream'); return r.end(good); }
    if (q.url.startsWith('/skills')) {
      r.setHeader('content-type', 'application/json');
      const tarball = `http://127.0.0.1:${userReg.address().port}/skills/-/skills-1.7.4.tgz`;
      return r.end(JSON.stringify({ name: 'skills', 'dist-tags': { latest: '1.7.4' }, versions: { '1.7.4': { name: 'skills', version: '1.7.4', bin: { skills: 'bin/cli.mjs' }, dist: { tarball } } } }));
    }
    r.statusCode = 404; r.end('{}');
  });
  const run = async () => {
    writeFileSync(join(home, '.npmrc'), `registry=http://127.0.0.1:${userReg.address().port}/\n`);
    mkdirSync(join(home, '.mcsparrow'), { recursive: true });
    writeFileSync(join(home, '.mcsparrow', '3rdpartyskills.json'), JSON.stringify({ schema: 1, entries: [{ skillname: HS_NAME, skillcategory: 'engineering', skillrepo: 'acme/projskill', skillcommit: HS_COMMIT, license: 'MIT' }] }));
    const scan = join(base, 'scan');
    mkdirSync(scan);
    writeFileSync(join(scan, 'SKILL.md'), 'hello');
    const settings = { settings_folder_moved: false, roles: { qa: { skills: [{ name: HS_NAME, approved: '2026-11-06' }], source: { skills: 'project' } } } };
    const runner = join(base, 'runner.mjs');
    writeFileSync(runner, [
      `import { main } from ${JSON.stringify(new URL('./install-skills.mjs', import.meta.url).href)};`,
      `import { boundedFolderHash } from ${JSON.stringify(new URL('./skill-catalog.mjs', import.meta.url).href)};`,
      `const hash = boundedFolderHash(${JSON.stringify(scan)});`,
      `const vet = async () => ({ commit: ${JSON.stringify(HS_COMMIT)}, hash, result: { verdict: 'pass', counts: { critical: 0, high: 0 } } });`,
      `const out = []; const code = await main(['--selected'], { home: ${JSON.stringify(home)}, productRoot: ${JSON.stringify(root)}, settings: ${JSON.stringify(settings)}, today: '2026-11-06', vet, log: (s) => out.push(s) });`,
      'console.log(out.join("\\n")); process.exit(code);'
    ].join('\n'));
    // A cold npm cache, the user config in the fake home, and the Windows lookup switch unset (its default).
    const env = { ...process.env, REC: rec, GITMARK: mark('git-probe'), HOME: home, USERPROFILE: home, npm_config_cache: join(base, 'cache'), npm_config_userconfig: join(home, '.npmrc'), npm_config_globalconfig: join(base, 'none'), npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' };
    delete env.NoDefaultCurrentDirectoryInExePath;
    for (const k of Object.keys(env)) if (/^npm_config_(registry|prefix)$/i.test(k)) delete env[k];
    const dirs = pathDirs({ root, top });
    if (dirs.length) {
      const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
      env[key] = [...dirs, env[key]].join(delimiter);
    }
    const r = await hsChild(runner, { env, cwd: base });
    return { r, root, top, marks, extra, seen: existsSync(rec) ? JSON.parse(readFileSync(rec, 'utf8')) : null };
  };
  return { run, close: () => { userReg.close(); extra.close?.(); } };
}

const hsPlanted = {
  nodeCmd: (dir, mark) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'node.cmd'), `@echo off\r\necho x> "${mark}"\r\n`); },
  gitExe: (dir) => { mkdirSync(dir, { recursive: true }); copyFileSync(process.execPath, join(dir, 'git.exe')); },
  posix: (dir, mark1, mark2) => {
    mkdirSync(dir, { recursive: true });
    for (const [n, m] of [['node', mark1], ['git', mark2]]) writeFileSync(join(dir, n), `#!/bin/sh\necho x > "${m}"\n`, { mode: 0o755 });
  }
};

const HS_FIXTURES = {
  'a hostile .npmrc registry, a skills package in node_modules and launchers named like the programs': {
    plant: async ({ root, base, mark, listen }) => {
      const hits = [];
      const hostileReg = await listen((q, r) => { hits.push(q.url); r.statusCode = 404; r.end('{}'); });
      writeFileSync(join(root, '.npmrc'), `registry=http://127.0.0.1:${hostileReg.address().port}/\n`);
      mkdirSync(join(root, 'node_modules', 'skills', 'bin'), { recursive: true });
      writeFileSync(join(root, 'node_modules', 'skills', 'package.json'), JSON.stringify({ name: 'skills', version: '1.7.4', bin: { skills: 'bin/cli.mjs' } }));
      writeFileSync(join(root, 'node_modules', 'skills', 'bin', 'cli.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(join(base, 'rec.json'))}, JSON.stringify({ who: 'hostile' }));\n`);
      if (process.platform === 'win32') {
        for (const n of ['npx', 'skills']) writeFileSync(join(root, `${n}.cmd`), `@echo off\r\necho hostile> "${mark(`${n}-cmd`)}"\r\n`);
      }
      return { hits, close: () => hostileReg.close() };
    }
  },
  'root .npmrc prefix= with a planted npx-cli.js': {
    plant: ({ root, mark }) => {
      const m = mark('npx-cli');
      writeFileSync(join(root, '.npmrc'), 'prefix=evil\n');
      const d = join(root, 'evil', 'node_modules', 'npm', 'bin'); mkdirSync(d, { recursive: true });
      for (const f of ['npx-cli.js', 'npm-cli.js']) writeFileSync(join(d, f), `require('fs').writeFileSync(${JSON.stringify(m)}, 'x');\n`);
    }
  },
  'node_modules/.bin/node.cmd in the product root': {
    plant: ({ root, mark }) => hsPlanted.nodeCmd(join(root, 'node_modules', '.bin'), mark('node-cmd')),
    pathDirs: ({ root }) => [join(root, 'node_modules', '.bin')]
  },
  'node_modules/.bin/git.exe in the product root': {
    plant: ({ root }) => hsPlanted.gitExe(join(root, 'node_modules', '.bin')),
    pathDirs: ({ root }) => [join(root, 'node_modules', '.bin')]
  },
  'POSIX node and git in node_modules/.bin of the product root': {
    plant: ({ root, mark }) => hsPlanted.posix(join(root, 'node_modules', '.bin'), mark('posix-node'), mark('posix-git')),
    pathDirs: ({ root }) => [join(root, 'node_modules', '.bin')]
  },
  'a .bin folder in a parent of the product root': {
    nested: true,
    plant: ({ top, mark }) => {
      const d = join(top, 'node_modules', '.bin');
      hsPlanted.nodeCmd(d, mark('parent-node-cmd')); hsPlanted.gitExe(d); hsPlanted.posix(d, mark('parent-posix-node'), mark('parent-posix-git'));
    },
    pathDirs: ({ top }) => [join(top, 'node_modules', '.bin')]
  }
};

for (const [label, fx] of Object.entries(HS_FIXTURES)) {
  test(`project --selected install ignores: ${label}`, { timeout: 180_000 }, async () => {
    const h = await hostileProject(fx);
    try {
      const { r, seen, root, top, marks, extra } = await h.run();
      assert.equal(r.status, 0, r.out + r.err);
      assert.ok(seen, r.out + r.err);
      assert.equal(seen.who, 'real');
      assert.equal(realpathSync(seen.cwd), realpathSync(root)); // the install still lands in the product folder
      assert.deepEqual(seen.argv, ['add', `acme/projskill#${HS_COMMIT}`, '-s', HS_NAME, '-a', 'claude-code', '-y']);
      assert.equal(seen.dnt, '1');
      assert.equal(seen.dt, '1');
      if (extra.hits) assert.deepEqual(extra.hits, [], 'the repo .npmrc registry was asked');
      for (const m of Object.values(marks)) assert.equal(existsSync(m), false, `planted program ran: ${m}`);
      for (const p of seen.path.split(delimiter)) {
        assert.ok(!resolve(p).toLowerCase().startsWith(resolve(top).toLowerCase() + sep), `product folder on PATH: ${p}`);
      }
    } finally { h.close(); }
  });
}

test('project --selected install reports FAILED when the fetched package has no bin file, and runs nothing from the product', { timeout: 180_000 }, async () => {
  const h = await hostileProject({
    plant: ({ root, mark }) => hsPlanted.nodeCmd(join(root, 'node_modules', '.bin'), mark('node-cmd')),
    pathDirs: ({ root }) => [join(root, 'node_modules', '.bin')],
    cliFiles: { 'package/package.json': JSON.stringify({ name: 'skills', version: '1.7.4', bin: { skills: 'bin/cli.mjs' } }) }
  });
  try {
    const { r, seen, marks } = await h.run();
    assert.equal(r.status, 1, r.out + r.err);
    assert.match(r.out, /FAILED /);
    assert.equal(seen, null);
    for (const m of Object.values(marks)) assert.equal(existsSync(m), false, m);
  } finally { h.close(); }
});
