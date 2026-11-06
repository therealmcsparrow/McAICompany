import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync as __mkdtemp, rmSync as __rmTree, copyFileSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { join, resolve, sep, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, runAll, expand, missing, parseDesignSkills, main, retiredSkills, SKILLS_CLI, skillsEnv, cleanPath, installExec } from './install-skills.mjs';
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

const REPO = '[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}';
const CMD_RE = new RegExp(`^npx -y skills@1\\.7\\.4 add ${REPO} -s ([a-z0-9][a-z0-9-]{0,63}|'\\*'|"\\*")( -g)? -a claude-code -y$`);

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

// ---- hostile input first: each case must error, name a line and never run anything ----
const HOSTILE = {
  'name with ;': line({ name: 'a;b' }),
  'name with &&': line({ name: 'a&&b' }),
  'name with |': line({ name: 'a|b' }),
  'name with >': line({ name: 'a>b' }),
  'name with $()': line({ name: '$(x)' }),
  'name with backtick': line({ name: 'a`b' }),
  'name with %PATH%': line({ name: '%PATH%' }),
  'name with ^': line({ name: 'a^b' }),
  'name with quote': line({ name: "a'b" }),
  'name with space': line({ name: 'a b' }),
  'name with CR': line({ name: 'a\rb' }),
  'name leading -': line({ name: '-rf' }),
  'source with &&': line({ source: 'owner/repo&&calc' }),
  'source with |': line({ source: 'owner/repo|calc' }),
  'source with >': line({ source: 'owner/repo>x' }),
  'source with $()': line({ source: 'owner/$(calc)' }),
  'source backtick in repo': line({ source: 'owner/re`calc`po' }),
  'source %PATH%': line({ source: 'owner/%PATH%' }),
  'source ^': line({ source: 'owner/re^po' }),
  'source quote': line({ source: 'owner/re"po' }),
  'source space': line({ source: 'owner/repo extra' }),
  'source CR': line({ source: 'owner/repo\r' }),
  'source leading -': line({ source: 'owner/-rf' }),
  'source owner leading -': line({ source: '-o/repo' }),
  'source owner/..': line({ source: 'owner/..' }),
  'source owner/.': line({ source: 'owner/.' }),
  'source command not in manifest': line({ name: 'evil', source: '`npx -y evil install`' }),
  'source command, empty': line({ source: '``' }),
  'manifest command under another name': line({ name: 'hallmark', source: '`npx -y impeccable skills install`' }),
  'manifest command plus suffix': line({ name: 'impeccable', source: '`npx -y impeccable skills install && calc`' }),
  'plugin with shell': line({ name: 'aico:ui', source: 'plugin aico;calc', license: '-', vetted: '-' }),
  'license with space': line({ license: 'MIT OR calc' }),
  'license NONE': line({ license: 'NONE' }),
  'license - on repo': line({ license: '-' }),
  'vetted impossible date': line({ vetted: '2026-02-30' }),
  'vetted future': line({ vetted: '2026-10-23' }),
  'approved wrong format': line({ approved: 'yesterday' }),
  'why with backtick': line({ why: 'run `calc`' }),
  'why with <': line({ why: 'a <b>' }),
  'why with CR': line({ why: 'a\rb' }),
  'not an entry': 'rm -rf /',
  'extra field': line() + '; extra: x',
  'unanchored prefix': 'x ' + line()
};

for (const [label, bad] of Object.entries(HOSTILE)) {
  test(`hostile: ${label}`, () => {
    const s = sandbox();
    try {
      const res = s.run(['core', 'design', '--project', s.projectFile, '--dry-run'], doc(line({ name: 'ok-one', source: 'ok/one' }), bad));
      assert.equal(res.code, 1);
      assert.match(res.out, /^ERROR design skill line \d+: /m);
      assert.doesNotMatch(res.out, /calc|rm -rf|evil/);
      assert.equal(res.calls.length, 0);
      assert.doesNotMatch(res.out, /\[dry-run\]/, 'nothing planned in any group');
      // same input without --dry-run: nothing executed
      const real = s.run(['core', 'design', '--project', s.projectFile], undefined);
      assert.equal(real.code, 1);
      assert.equal(real.calls.length, 0);
    } finally { s.done(); }
  });
}

test('hostile: 6 entries', () => {
  const s = sandbox();
  try {
    const six = [1, 2, 3, 4, 5, 6].map(i => line({ name: `s-${i}`, source: `o/r${i}` }));
    const res = s.run(['design', '--project', s.projectFile], doc(...six));
    assert.equal(res.code, 1);
    assert.match(res.out, /design skill line 10: entries too many entries/);
    assert.equal(res.calls.length, 0);
  } finally { s.done(); }
});

test('hostile: 501-char line', () => {
  const s = sandbox();
  try {
    const res = s.run(['design', '--project', s.projectFile], doc(line({ why: 'a'.repeat(500) })));
    assert.equal(res.code, 1);
    assert.match(res.out, /line 5: line too long/);
    assert.equal(res.calls.length, 0);
  } finally { s.done(); }
});

test('hostile: 300 KiB file', () => {
  const s = sandbox();
  try {
    const res = s.run(['design', '--project', s.projectFile], doc(line()) + 'x'.repeat(300 * 1024));
    assert.equal(res.code, 1);
    assert.match(res.out, /file too large/);
    assert.equal(res.calls.length, 0);
    assert.throws(() => parseDesignSkills(doc(line()) + 'x'.repeat(300 * 1024), manifest, TODAY), /file too large/);
  } finally { s.done(); }
});

test('hostile: a 100k ; line is refused fast and without echo', () => {
  const s = sandbox();
  try {
    const t0 = Date.now();
    const res = s.run(['design', '--project', s.projectFile], doc('- name: a' + ';'.repeat(100_000)));
    assert.ok(Date.now() - t0 < 1000, 'time bound');
    assert.equal(res.code, 1);
    assert.match(res.out, /line too long/);
    assert.equal(res.calls.length, 0);
    const t1 = Date.now();
    assert.throws(() => parseDesignSkills(doc('- name: ' + 'a; '.repeat(150)), manifest, TODAY), /malformed|too long/);
    assert.ok(Date.now() - t1 < 1000);
  } finally { s.done(); }
});

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
test('every generated command is pinned and allow-listed or a manifest install', () => {
  const s = sandbox();
  try {
    const res = s.run(['core', 'go', 'design', '--project', s.projectFile, '--dry-run'],
      doc(line(), line({ name: 'impeccable', source: '`npx -y impeccable skills install`' })));
    assert.equal(res.code, 0);
    const cmds = plan(manifest, ['core', 'go'], new Set(), 'linux');
    assert.ok(cmds.length > 0);
    for (const { cmd } of cmds) {
      assert.ok(CMD_RE.test(cmd) || cmd === 'npx -y impeccable skills install', cmd);
      assert.ok(cmd.startsWith(`npx -y ${SKILLS_CLI} `) || !cmd.includes('skills add'));
    }
  } finally { s.done(); }
});

test('design commands carry the product root as cwd and no -g', () => {
  const s = sandbox();
  try {
    const res = s.run(['design', '--project', s.projectFile], doc(line(), line({ name: 'impeccable', source: '`npx -y impeccable skills install`' })));
    assert.equal(res.code, 0);
    assert.deepEqual(res.calls, [
      ['npx -y skills@1.7.4 add nutlope/hallmark -s hallmark -a claude-code -y', s.root]
    ]);
    assert.match(res.out, new RegExp(`\\(in .+product\\) npx -y skills@1\\.7\\.4 add nutlope/hallmark`));
    for (const [c] of res.calls) if (c.includes(' add ')) assert.doesNotMatch(c, / -g /);
  } finally { s.done(); }
});

test('user-scope commands have -g and no cwd; plan returns the pinned form', () => {
  const cmds = plan(manifest, ['core'], new Set(['wordsmith']), 'linux');
  assert.deepEqual(cmds, [
    { cmd: 'npx -y skills@1.7.4 add nutlope/hallmark -s hallmark -g -a claude-code -y', argv: ['-y', 'skills@1.7.4', 'add', 'nutlope/hallmark', '-s', 'hallmark', '-g', '-a', 'claude-code', '-y'] },
    { cmd: 'npx -y impeccable skills install' },
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

test('linux: design entry argv has no -g, keeps cwd; the exec spy receives argv', () => {
  const s = sandbox();
  const seen = [];
  const spy = (c, cwd, argv) => seen.push([c, cwd, argv]);
  try {
    const res = s.run(['design', '--project', s.projectFile], doc(line(), line({ name: 'impeccable', source: '`npx -y impeccable skills install`' })), { exec: spy });
    assert.equal(res.code, 0);
    assert.deepEqual(seen, [
      ['npx -y skills@1.7.4 add nutlope/hallmark -s hallmark -a claude-code -y', s.root, ['-y', 'skills@1.7.4', 'add', 'nutlope/hallmark', '-s', 'hallmark', '-a', 'claude-code', '-y']]
    ]);
    seen.length = 0;
    s.run(['design', '--project', s.projectFile], undefined, { platform: 'win32', exec: spy });
    assert.equal(seen[0][2], undefined);
  } finally { s.done(); }
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
  const real = JSON.parse(readFileSync(new URL('../deps/skills.json', import.meta.url), 'utf8'));
  assert.deepEqual(real.research, [{ name: 'find-skills', source: 'vercel-labs/skills', license: 'MIT', vetted: '2026-10-22' }]);
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
  for (const e of real.research) assert.ok(e.license && e.vetted);
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

test('installed detection includes <root>/.claude/skills and <root>/.agents/skills with --project', () => {
  const s = sandbox();
  try {
    mkdirSync(join(s.root, '.agents', 'skills', 'hallmark'), { recursive: true });
    const res = s.run(['design', '--missing', '--project', s.projectFile], doc(line(), line({ name: 'other', source: 'o/other' })));
    assert.equal(res.out, 'missing other');
  } finally { s.done(); }
});

test('plugin entries are skipped', () => {
  const s = sandbox();
  try {
    const res = s.run(['design', '--project', s.projectFile], doc(line({ name: 'aico:ui-design', source: 'plugin aico', license: '-', vetted: '-' })));
    assert.equal(res.code, 0);
    assert.match(res.out, /All skills already installed\./);
    assert.equal(res.calls.length, 0);
    assert.deepEqual(missing({ design: [{ name: 'x:y', source: 'o/r' }] }, ['design'], new Set()), []);
  } finally { s.done(); }
});

test('empty design section installs nothing; missing project.md is an empty group', () => {
  const s = sandbox();
  try {
    assert.match(s.run(['design', '--project', s.projectFile], doc('- (none yet; the design-researcher proposes them)')).out, /All skills already installed/);
    rmSync(s.projectFile);
    assert.equal(s.run(['design', '--project', s.projectFile]).code, 0);
  } finally { s.done(); }
});

test('design without --project is an unknown group', () => {
  const s = sandbox();
  try {
    const res = s.run(['design']);
    assert.equal(res.code, 1);
    assert.match(res.out, /ERROR unknown group design/);
    assert.equal(res.calls.length, 0);
    assert.throws(() => plan({ ...manifest, design: [{ name: 'x', source: 'o/r' }] }, ['design'], new Set()), /unknown group design/);
  } finally { s.done(); }
});

test('bad --project paths error', () => {
  const s = sandbox();
  try {
    for (const p of [join(s.root, 'project.md'), join(s.root, '.company', 'other.md'), join(s.root, 'x', 'project.md')]) {
      const res = s.run(['design', '--project', p]);
      assert.equal(res.code, 1);
      assert.match(res.out, /ERROR --project must point to <root>\/\.company\/project\.md/);
    }
    assert.equal(s.run(['design', '--project']).code, 1);
    assert.equal(s.run(['design', '--project', '--dry-run']).code, 1);
    assert.equal(s.run(['--bogus']).code, 1);
    assert.equal(s.calls?.length ?? 0, 0);
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

// ---- optional commit on a design line: pinned install; v1 lines unchanged ----
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const pinned = (o = {}) => {
  const f = { name: 'hallmark', source: 'nutlope/hallmark', license: 'MIT', vetted: '2026-10-22', commit: SHA, why: 'good', approved: '2026-10-22', ...o };
  return `- name: ${f.name}; source: ${f.source}; license: ${f.license}; vetted: ${f.vetted}; commit: ${f.commit}; why: ${f.why}; approved: ${f.approved}`;
};

test('a v1 design line installs exactly the v1 command and argv, with no commit token', () => {
  const s = sandbox();
  try {
    const exec = [];
    const res = s.run(['design', '--project', s.projectFile], doc(line()), { exec: (c, cwd, argv) => exec.push([c, cwd, argv]) });
    assert.equal(res.code, 0);
    assert.deepEqual(exec.at(-1), ['npx -y skills@1.7.4 add nutlope/hallmark -s hallmark -a claude-code -y', s.root, ['-y', 'skills@1.7.4', 'add', 'nutlope/hallmark', '-s', 'hallmark', '-a', 'claude-code', '-y']]);
    assert.deepEqual(parseDesignSkills(doc(line()), manifest, TODAY)[0].commit, undefined);
  } finally { s.done(); }
});

test('a design line with commit installs <owner>/<repo>#<commit> as a string and as argv', () => {
  const s = sandbox();
  try {
    const exec = [];
    const res = s.run(['design', '--project', s.projectFile], doc(pinned()), { exec: (c, cwd, argv) => exec.push([c, cwd, argv]) });
    assert.equal(res.code, 0);
    assert.deepEqual(exec, [[`npx -y skills@1.7.4 add nutlope/hallmark#${SHA} -s hallmark -a claude-code -y`, s.root, ['-y', 'skills@1.7.4', 'add', `nutlope/hallmark#${SHA}`, '-s', 'hallmark', '-a', 'claude-code', '-y']]]);
    const win = main(['design', '--project', s.projectFile, '--dry-run'], { manifest, home: join(s.base, 'home'), cwd: s.base, today: TODAY, platform: 'win32', log: (x) => exec.push(x), exec: () => assert.fail('dry run') });
    assert.equal(win, 0);
    assert.equal(exec.at(-1), `[dry-run] (in ${s.root}) npx -y skills@1.7.4 add nutlope/hallmark#${SHA} -s hallmark -a claude-code -y`);
  } finally { s.done(); }
});

for (const [label, text, re] of [
  ['dash on a repo source', pinned({ commit: '-' }), /commit invalid/],
  ['short sha', pinned({ commit: 'a1b2c3d' }), /commit invalid/],
  ['uppercase sha', pinned({ commit: SHA.toUpperCase() }), /commit invalid/],
  ['branch name', pinned({ commit: 'main' }), /commit invalid/],
  ['shell tail', pinned({ commit: `${SHA}&&calc` }), /commit invalid/],
  ['on a command source', pinned({ name: 'impeccable', source: '`npx -y impeccable skills install`' }), /commit invalid/],
  ['on a plugin source', pinned({ name: 'aico:ui-design', source: 'plugin aico', license: '-', vetted: '-' }), /commit invalid/],
  ['after why (wrong order)', `- name: hallmark; source: nutlope/hallmark; license: MIT; vetted: 2026-10-22; why: good; commit: ${SHA}; approved: 2026-10-22`, /malformed/],
  ['twice', `- name: hallmark; source: nutlope/hallmark; license: MIT; vetted: 2026-10-22; commit: ${SHA}; commit: ${SHA}; why: good; approved: 2026-10-22`, /malformed/],
]) {
  test(`design line with commit ${label} errors and installs nothing`, () => {
    assert.throws(() => parseDesignSkills(doc(text), manifest, TODAY), re);
    const s = sandbox();
    try {
      const res = s.run(['design', '--project', s.projectFile], doc(text));
      assert.equal(res.code, 1);
      assert.match(res.out, /ERROR design skill line \d+: /);
      assert.equal(res.calls.length, 0);
    } finally { s.done(); }
  });
}

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
  const real = JSON.parse(readFileSync(new URL('../deps/skills.json', import.meta.url), 'utf8'));
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

test('user-scope installs run from the home folder, project installs keep the product root', () => {
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

// A tar archive with one file per entry, gzipped: enough for npm to unpack a package.
function tgz(files) {
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

const listen = (handler) => new Promise(res => { const srv = http.createServer(handler).listen(0, '127.0.0.1', () => res(srv)); });
const runChild = (file, opts) => new Promise(res => {
  const c = spawn(process.execPath, [file], { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { err += d; });
  c.on('close', status => res({ status, out, err }));
});

test('a project install runs the real add path with npx kept away from the hostile repo', { timeout: 120_000 }, async () => {
  const base = mkdtempSync(join(tmpdir(), 'aico-npx-'));
  const home = join(base, 'home'), root = join(base, 'product'), rec = join(base, 'rec.json');
  mkdirSync(home);
  mkdirSync(join(root, '.company'), { recursive: true });
  // The product folder is hostile: a package with the pinned name and version, a registry file, and launchers named like the programs.
  const bin = "import { writeFileSync } from 'node:fs'; writeFileSync(process.env.REC, JSON.stringify({ who: 'hostile' }));\n";
  mkdirSync(join(root, 'node_modules', 'skills', 'bin'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'skills', 'package.json'), JSON.stringify({ name: 'skills', version: '1.7.4', bin: { skills: 'bin/cli.mjs' } }));
  writeFileSync(join(root, 'node_modules', 'skills', 'bin', 'cli.mjs'), bin);
  const hits = [];
  const hostileReg = await listen((q, r) => { hits.push(q.url); r.statusCode = 404; r.end('{}'); });
  const good = tgz({
    'package/package.json': JSON.stringify({ name: 'skills', version: '1.7.4', bin: { skills: 'bin/cli.mjs' } }),
    'package/bin/cli.mjs': "#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs'; writeFileSync(process.env.REC, JSON.stringify({ who: 'real', cwd: process.cwd(), argv: process.argv.slice(2), dnt: process.env.DO_NOT_TRACK, dt: process.env.DISABLE_TELEMETRY }));\n"
  });
  const userReg = await listen((q, r) => {
    if (q.url.endsWith('.tgz')) { r.setHeader('content-type', 'application/octet-stream'); return r.end(good); }
    if (q.url.startsWith('/skills')) {
      r.setHeader('content-type', 'application/json');
      const tarball = `http://127.0.0.1:${userReg.address().port}/skills/-/skills-1.7.4.tgz`;
      return r.end(JSON.stringify({ name: 'skills', 'dist-tags': { latest: '1.7.4' }, versions: { '1.7.4': { name: 'skills', version: '1.7.4', bin: { skills: 'bin/cli.mjs' }, dist: { tarball } } } }));
    }
    r.statusCode = 404; r.end('{}');
  });
  try {
    writeFileSync(join(root, '.npmrc'), `registry=http://127.0.0.1:${hostileReg.address().port}/\n`);
    writeFileSync(join(home, '.npmrc'), `registry=http://127.0.0.1:${userReg.address().port}/\n`);
    const marks = [];
    if (process.platform === 'win32') {
      for (const n of ['npx', 'skills']) {
        const mark = join(base, `${n}-ran.txt`); marks.push(mark);
        writeFileSync(join(root, `${n}.cmd`), `@echo off\r\necho hostile> "${mark}"\r\n`);
      }
    }
    writeFileSync(join(root, '.company', 'project.md'), doc(line({ name: 'projskill', source: 'acme/projskill' })));
    const runner = join(base, 'runner.mjs');
    writeFileSync(runner, [
      `import { main } from ${JSON.stringify(new URL('./install-skills.mjs', import.meta.url).href)};`,
      `process.exit(main(['design', '--project', ${JSON.stringify(join(root, '.company', 'project.md'))}], { manifest: { core: [] }, home: ${JSON.stringify(home)}, today: new Date('2026-10-23T12:00:00Z') }));`
    ].join('\n'));
    // A cold npm cache, the user config in the fake home, and the Windows lookup switch unset (its default).
    const env = { ...process.env, REC: rec, HOME: home, USERPROFILE: home, npm_config_cache: join(base, 'cache'), npm_config_userconfig: join(home, '.npmrc'), npm_config_globalconfig: join(base, 'none'), npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' };
    delete env.NoDefaultCurrentDirectoryInExePath;
    for (const k of Object.keys(env)) if (/^npm_config_(registry|prefix)$/i.test(k)) delete env[k];
    const r = await runChild(runner, { env, cwd: base });
    assert.equal(r.status, 0, r.out + r.err);
    assert.ok(existsSync(rec), r.out + r.err);
    const seen = JSON.parse(readFileSync(rec, 'utf8'));
    assert.equal(seen.who, 'real');
    assert.equal(realpathSync(seen.cwd), realpathSync(root)); // the install still lands in the product folder
    assert.deepEqual(seen.argv, ['add', 'acme/projskill', '-s', 'projskill', '-a', 'claude-code', '-y']);
    assert.equal(seen.dnt, '1');
    assert.equal(seen.dt, '1');
    assert.deepEqual(hits, [], 'the repo .npmrc registry was asked');
    for (const m of marks) assert.equal(existsSync(m), false, m);
  } finally {
    hostileReg.close(); userReg.close();
  }
});

// ---- project install: nothing from the product folder steers or runs ----
// The stand-in CLI records where it ran and what it can reach, and probes `node` (through a shell) and `git` (no shell).
const PROBE_CLI = [
  '#!/usr/bin/env node',
  "import { writeFileSync } from 'node:fs'; import { spawnSync } from 'node:child_process';",
  "const probe = `require('fs').writeFileSync(${JSON.stringify(process.env.GITMARK)}, 'x')`;",
  "spawnSync('node', ['-v'], { shell: true, stdio: 'ignore' });",
  "spawnSync('git', ['-p', probe], { stdio: 'ignore' });",
  "writeFileSync(process.env.REC, JSON.stringify({ who: 'real', cwd: process.cwd(), argv: process.argv.slice(2), path: process.env.PATH ?? process.env.Path }));"
].join('\n') + '\n';

async function hostileProject({ plant, pathDirs = () => [], cliFiles, nested = false }) {
  const base = mkdtempSync(join(tmpdir(), 'aico-hostile-'));
  const home = join(base, 'home'), top = nested ? join(base, 'parent') : base;
  const root = join(top, 'product'), rec = join(base, 'rec.json');
  mkdirSync(home);
  mkdirSync(join(root, '.company'), { recursive: true });
  const marks = {};
  const mark = n => (marks[n] = join(base, `mark-${n}.txt`));
  plant({ root, top, base, mark });
  const cliPkg = JSON.stringify({ name: 'skills', version: '1.7.4', bin: { skills: 'bin/cli.mjs' } });
  const good = tgz(cliFiles ?? { 'package/package.json': cliPkg, 'package/bin/cli.mjs': PROBE_CLI });
  const userReg = await listen((q, r) => {
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
    writeFileSync(join(root, '.company', 'project.md'), doc(line({ name: 'projskill', source: 'acme/projskill' })));
    const runner = join(base, 'runner.mjs');
    writeFileSync(runner, [
      `import { main } from ${JSON.stringify(new URL('./install-skills.mjs', import.meta.url).href)};`,
      `const out = []; const code = main(['design', '--project', ${JSON.stringify(join(root, '.company', 'project.md'))}], { manifest: { core: [] }, home: ${JSON.stringify(home)}, today: new Date('2026-10-23T12:00:00Z'), log: s => out.push(s) });`,
      'console.log(out.join("\\n")); process.exit(code);'
    ].join('\n'));
    const env = { ...process.env, REC: rec, GITMARK: mark('git-probe'), HOME: home, USERPROFILE: home, npm_config_cache: join(base, 'cache'), npm_config_userconfig: join(home, '.npmrc'), npm_config_globalconfig: join(base, 'none'), npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' };
    delete env.NoDefaultCurrentDirectoryInExePath;
    for (const k of Object.keys(env)) if (/^npm_config_(registry|prefix)$/i.test(k)) delete env[k];
    const dirs = pathDirs({ root, top });
    if (dirs.length) {
      const key = Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH';
      env[key] = [...dirs, env[key]].join(delimiter);
    }
    const r = await runChild(runner, { env, cwd: base });
    return { r, root, top, marks, seen: existsSync(rec) ? JSON.parse(readFileSync(rec, 'utf8')) : null };
  };
  return { run, close: () => userReg.close() };
}

const planted = {
  nodeCmd: (dir, mark) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'node.cmd'), `@echo off\r\necho x> "${mark}"\r\n`); },
  gitExe: dir => { mkdirSync(dir, { recursive: true }); copyFileSync(process.execPath, join(dir, 'git.exe')); },
  posix: (dir, mark1, mark2) => {
    mkdirSync(dir, { recursive: true });
    for (const [n, m] of [['node', mark1], ['git', mark2]]) writeFileSync(join(dir, n), `#!/bin/sh\necho x > "${m}"\n`, { mode: 0o755 });
  }
};

const FIXTURES = {
  'root .npmrc prefix= with a planted npx-cli.js': {
    plant: ({ root, mark }) => {
      const m = mark('npx-cli');
      writeFileSync(join(root, '.npmrc'), 'prefix=evil\n');
      const d = join(root, 'evil', 'node_modules', 'npm', 'bin'); mkdirSync(d, { recursive: true });
      for (const f of ['npx-cli.js', 'npm-cli.js']) writeFileSync(join(d, f), `require('fs').writeFileSync(${JSON.stringify(m)}, 'x');\n`);
    }
  },
  'node_modules/.bin/node.cmd in the product root': {
    plant: ({ root, mark }) => planted.nodeCmd(join(root, 'node_modules', '.bin'), mark('node-cmd')),
    pathDirs: ({ root }) => [join(root, 'node_modules', '.bin')]
  },
  'node_modules/.bin/git.exe in the product root': {
    plant: ({ root }) => planted.gitExe(join(root, 'node_modules', '.bin')),
    pathDirs: ({ root }) => [join(root, 'node_modules', '.bin')]
  },
  'POSIX node and git in node_modules/.bin of the product root': {
    plant: ({ root, mark }) => planted.posix(join(root, 'node_modules', '.bin'), mark('posix-node'), mark('posix-git')),
    pathDirs: ({ root }) => [join(root, 'node_modules', '.bin')]
  },
  'a .bin folder in a parent of the product root': {
    nested: true,
    plant: ({ top, mark }) => {
      const d = join(top, 'node_modules', '.bin');
      planted.nodeCmd(d, mark('parent-node-cmd')); planted.gitExe(d); planted.posix(d, mark('parent-posix-node'), mark('parent-posix-git'));
    },
    pathDirs: ({ top }) => [join(top, 'node_modules', '.bin')]
  }
};

for (const [label, fx] of Object.entries(FIXTURES)) {
  test(`project install ignores: ${label}`, { timeout: 180_000 }, async () => {
    const h = await hostileProject(fx);
    try {
      const { r, seen, root, top, marks } = await h.run();
      assert.equal(r.status, 0, r.out + r.err);
      assert.ok(seen, r.out + r.err);
      assert.equal(seen.who, 'real');
      assert.equal(realpathSync(seen.cwd), realpathSync(root));
      for (const m of Object.values(marks)) assert.equal(existsSync(m), false, `planted program ran: ${m}`);
      for (const p of seen.path.split(delimiter)) {
        assert.ok(!resolve(p).toLowerCase().startsWith(resolve(top).toLowerCase() + sep), `product folder on PATH: ${p}`);
      }
    } finally { h.close(); }
  });
}

test('project install reports FAILED when the fetched package has no bin file, and runs nothing from the product', { timeout: 180_000 }, async () => {
  const h = await hostileProject({
    plant: ({ root, mark }) => planted.nodeCmd(join(root, 'node_modules', '.bin'), mark('node-cmd')),
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

test('main: a manifest command at project scope is printed as manual, never run, not counted as failed', () => {
  const s = sandbox();
  try {
    const res = s.run(['design', '--project', s.projectFile], doc(line({ name: 'impeccable', source: '`npx -y impeccable skills install`' })));
    assert.equal(res.code, 0, res.out);
    assert.deepEqual(res.calls, []);
    assert.match(res.out, /^manual npx -y impeccable skills install$/m);
    assert.match(res.out, /^WARNING: impeccable .*third-party.*run it yourself: npx -y impeccable skills install/m);
    assert.doesNotMatch(res.out, /FAILED/);
    assert.match(res.out, /0 installed, 0 failed/);
  } finally { s.done(); }
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
  assert.ok(w[0].includes(`run it yourself: ${PINNED_IMPECCABLE}`), w[0]);
  assert.ok(!out.join('').includes(''));
  assert.ok(out.includes('1 installed, 0 failed'), out.join('|'));
});

test('main: the WARNING line is ANSI yellow only when colour is on', () => {
  const on = userScopeRun(true).out.find(l => l.includes('WARNING'));
  assert.ok(on.startsWith('[33mWARNING: ') && on.endsWith('[0m'), JSON.stringify(on));
  const off = userScopeRun(false).out.find(l => l.includes('WARNING'));
  assert.ok(off.startsWith('WARNING: '), JSON.stringify(off));
});

test('main: the pinned CLI still runs at project scope next to a manual command', () => {
  const s = sandbox();
  try {
    const res = s.run(['design', '--project', s.projectFile], doc(line(), line({ name: 'impeccable', source: '`npx -y impeccable skills install`' })));
    assert.equal(res.code, 0, res.out);
    assert.equal(res.calls.length, 1);
    assert.match(res.out, /1 installed, 0 failed/);
    assert.match(res.out, /^manual npx -y impeccable skills install$/m);
  } finally { s.done(); }
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
