import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plan, runAll, expand, missing, parseDesignSkills, main, SKILLS_CLI } from './install-skills.mjs';

const TODAY = new Date('2026-10-22T12:00:00Z');
const manifest = {
  core: [
    { name: 'humanizer', source: 'blader/humanizer' },
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

// ---- hostile input first (proj.M4): each case must error, name a line and never run anything ----
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
      ['npx -y skills@1.7.4 add nutlope/hallmark -s hallmark -a claude-code -y', s.root],
      ['npx -y impeccable skills install', s.root]
    ]);
    assert.match(res.out, new RegExp(`\\(in .+product\\) npx -y skills@1\\.7\\.4 add nutlope/hallmark`));
    for (const [c] of res.calls) if (c.includes(' add ')) assert.doesNotMatch(c, / -g /);
  } finally { s.done(); }
});

test('user-scope commands have -g and no cwd; plan returns the pinned form', () => {
  const cmds = plan(manifest, ['core'], new Set(['humanizer']), 'linux');
  assert.deepEqual(cmds, [
    { cmd: 'npx -y skills@1.7.4 add nutlope/hallmark -s hallmark -g -a claude-code -y' },
    { cmd: 'npx -y impeccable skills install' },
    { cmd: 'npx -y skills@1.7.4 add vercel-labs/skills -s find-skills -g -a claude-code -y' }
  ]);
});

test('wildcard: skipped when any match is installed; quoted per platform', () => {
  assert.deepEqual(plan(manifest, ['go'], new Set(['golang-cli']), 'linux'), []);
  assert.equal(plan(manifest, ['go'], new Set(), 'linux')[0].cmd, "npx -y skills@1.7.4 add samber/cc-skills-golang -s '*' -g -a claude-code -y");
  assert.equal(plan(manifest, ['go'], new Set(), 'win32')[0].cmd, 'npx -y skills@1.7.4 add samber/cc-skills-golang -s "*" -g -a claude-code -y');
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
    assert.equal(res.out, ['humanizer', 'hallmark', 'impeccable', 'find-skills'].map(n => `missing ${n}`).join('\n'));
    assert.equal(res.calls.length, 0);
    mkdirSync(join(s.base, 'home', '.claude', 'skills'), { recursive: true });
    for (const n of ['humanizer', 'hallmark', 'impeccable', 'find-skills']) mkdirSync(join(s.base, 'home', '.claude', 'skills', n));
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
