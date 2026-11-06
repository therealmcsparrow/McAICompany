import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync as __mkdtemp, rmSync as __rmTree, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSkillsSection, parseDesignSkills, main } from './install-skills.mjs';
// Remove the temp dirs this file made, once the run is over.
const __tmpDirs = [];
const mkdtempSync = (...a) => { const d = __mkdtemp(...a); __tmpDirs.push(d); return d; };
process.on('exit', () => { for (const d of __tmpDirs) { try { __rmTree(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

const TODAY = new Date('2026-10-26T12:00:00Z');
const manifest = { core: [{ name: 'impeccable', install: 'npx -y impeccable skills install' }] };
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const line = (o = {}) => {
  const f = { area: 'stack', name: 'golang-testing', source: 'samber/cc-skills-golang', license: 'MIT', vetted: '2026-10-26', commit: SHA, why: 'tests', approved: '2026-10-26', ...o };
  const commit = f.commit === null ? '' : `commit: ${f.commit}; `;
  return `- area: ${f.area}; name: ${f.name}; source: ${f.source}; license: ${f.license}; vetted: ${f.vetted}; ${commit}why: ${f.why}; approved: ${f.approved}`;
};
const doc = (...lines) => `# P\n\n## Skills\n<!-- approved -->\n${lines.join('\n')}\n\n## Next\nx\n`;

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), 'aico-skills-section-'));
  const home = join(base, 'home');
  const root = join(base, 'product');
  mkdirSync(home);
  mkdirSync(join(root, '.company'), { recursive: true });
  const projectFile = join(root, '.company', 'project.md');
  const calls = [];
  const out = [];
  const run = (args, md, over = {}) => {
    if (md !== undefined) writeFileSync(projectFile, md);
    const code = main(args, { manifest, ...over, home, cwd: base, today: TODAY, platform: 'linux', log: s => out.push(s), exec: (c, cwd, argv) => calls.push([c, cwd, argv]) });
    return { code, out: out.join('\n'), calls };
  };
  return { base, root, projectFile, run, done: () => rmSync(base, { recursive: true, force: true }) };
}

const HOSTILE = {
  'area outside the list': [line({ area: 'design' }), /line 2: line malformed/],
  'area with ;': [line({ area: 'stack;x' }), /line 2: line malformed/],
  'name with &&': [line({ name: 'a&&b' }), /line 2: name invalid/],
  'name with $()': [line({ name: '$(x)' }), /line 2: name invalid/],
  'name with colon': [line({ name: 'aico:ui-design' }), /line 2: name invalid/],
  'source with &&': [line({ source: 'owner/repo&&calc' }), /line 2: source invalid/],
  'source dot-dot repo': [line({ source: 'owner/..' }), /line 2: source invalid/],
  'plugin source is not allowed': [line({ name: 'aico:x', source: 'plugin aico', license: '-', vetted: '-', commit: '-' }), /line 2: source invalid/],
  'unlisted command': [line({ name: 'impeccable', source: '`npx -y impeccable skills install && calc`' }), /line 2: source not a manifest command/],
  'license NONE': [line({ license: 'NONE' }), /line 2: license invalid/],
  'license dash': [line({ license: '-' }), /line 2: license invalid/],
  'vetted dash': [line({ vetted: '-' }), /line 2: vetted invalid/],
  'approved in the future': [line({ approved: '2026-10-27' }), /line 2: approved invalid/],
  'why with backtick': [line({ why: 'a`b' }), /line 2: why invalid/],
  'why with angle': [line({ why: '<b>' }), /line 2: why invalid/],
  'not a list line': ['rm -rf /', /line 2: line malformed/],
  'repo line without a commit field': [line({ commit: null }), /line 2: line malformed/],
  'repo line with commit dash': [line({ commit: '-' }), /line 2: commit invalid/],
  'repo line with a short sha': [line({ commit: 'a1b2c3d' }), /line 2: commit invalid/],
  'repo line with an uppercase sha': [line({ commit: SHA.toUpperCase() }), /line 2: commit invalid/],
  'repo line with a branch name': [line({ commit: 'main' }), /line 2: commit invalid/],
  'repo line with a 41-hex commit': [line({ commit: `${SHA}0` }), /line 2: commit invalid/],
  'repo line with a flag as commit': [line({ commit: '--upload-pack=x' }), /line 2: commit invalid/],
  'repo line with a shell tail in commit': [line({ commit: `${SHA}&&calc` }), /line 2: commit invalid/],
  'command line with a sha': [line({ name: 'impeccable', source: '`npx -y impeccable skills install`', commit: SHA }), /line 2: commit invalid/],
  'command line with a branch': [line({ name: 'impeccable', source: '`npx -y impeccable skills install`', commit: 'main' }), /line 2: commit invalid/],
  'design line shape': ['- name: a; source: o/r; license: MIT; vetted: 2026-10-26; why: x; approved: 2026-10-26', /line 2: line malformed/]
};

for (const [label, [text, re]] of Object.entries(HOSTILE)) {
  test(`hostile: ${label} errors, names the line and installs nothing`, () => {
    assert.throws(() => parseSkillsSection(`## Skills\n${text}\n`, manifest, TODAY), re);
    const s = sandbox();
    try {
      const res = s.run(['skills', '--project', s.projectFile], doc(text));
      assert.equal(res.code, 1);
      assert.match(res.out, /^ERROR skills line \d+: /);
      assert.equal(res.calls.length, 0);
    } finally { s.done(); }
  });
}

test('hostile: error never echoes the offending text', () => {
  assert.throws(() => parseSkillsSection(doc(line({ source: 'owner/SECRETMARK&&x' })), manifest, TODAY), e => {
    assert.doesNotMatch(e.message, /SECRETMARK/);
    return true;
  });
});

test('hostile: more than 5 lines in one area, more than 15 in all', () => {
  const names = i => `skill-${i}`;
  const six = Array.from({ length: 6 }, (_, i) => line({ name: names(i) }));
  assert.throws(() => parseSkillsSection(doc(...six), manifest, TODAY), /line 10: entries too many entries/);
  const areas = ['stack', 'product-type', 'company-type'];
  const fifteen = areas.flatMap(a => Array.from({ length: 5 }, (_, i) => line({ area: a, name: `${a.slice(0, 1)}-${i}` })));
  assert.equal(parseSkillsSection(doc(...fifteen), manifest, TODAY).length, 15);
  assert.throws(() => parseSkillsSection(doc(...fifteen, line({ area: 'stack', name: 'extra' })), manifest, TODAY), /entries too many entries/);
});

test('hostile: 501-char line and a 300 KiB file', () => {
  assert.throws(() => parseSkillsSection(doc(line({ why: 'x'.repeat(480) })), manifest, TODAY), /line 5: line too long/);
  assert.throws(() => parseSkillsSection(doc(line()) + 'x'.repeat(300 * 1024), manifest, TODAY), /skills file: file too large/);
});

test('hostile: a 100k ; line is refused fast', () => {
  const t = Date.now();
  assert.throws(() => parseSkillsSection(doc('- area: stack; ' + 'a; '.repeat(30000)), manifest, TODAY), /malformed|too long/);
  assert.ok(Date.now() - t < 1000);
});

test('parseSkillsSection accepts repo and manifest command lines and keeps the area', () => {
  const got = parseSkillsSection(doc(
    line(),
    line({ area: 'company-type', name: 'impeccable', source: '`npx -y impeccable skills install`', commit: '-' })
  ), manifest, TODAY);
  assert.deepEqual(got.map(e => e.area), ['stack', 'company-type']);
  assert.equal(got[0].source, 'samber/cc-skills-golang');
  assert.equal(got[1].install, 'npx -y impeccable skills install');
  assert.equal(got[0].commit, SHA);
  assert.equal(got[1].commit, undefined);
});

test('empty section, missing section, CRLF and section end', () => {
  assert.deepEqual(parseSkillsSection(doc('- (none yet; the skill-researcher proposes them)'), manifest, TODAY), []);
  assert.deepEqual(parseSkillsSection('# no section\n', manifest, TODAY), []);
  assert.equal(parseSkillsSection(doc(line()).replace(/\n/g, '\r\n'), manifest, TODAY).length, 1);
  assert.equal(parseSkillsSection(doc(line()) + 'rm -rf /\n', manifest, TODAY).length, 1);
});

test('the two sections do not read each other', () => {
  const both = `## Design skills\n- name: hallmark; source: nutlope/hallmark; license: MIT; vetted: 2026-10-26; why: x; approved: 2026-10-26\n\n## Skills\n${line()}\n`;
  assert.equal(parseDesignSkills(both, manifest, TODAY).length, 1);
  assert.equal(parseSkillsSection(both, manifest, TODAY).length, 1);
  assert.equal(parseSkillsSection(both, manifest, TODAY)[0].name, 'golang-testing');
});

test('group skills installs into the product root, no -g, with exact argv', () => {
  const s = sandbox();
  try {
    const res = s.run(['skills', '--project', s.projectFile], doc(line()));
    assert.equal(res.code, 0);
    assert.deepEqual(res.calls, [[
      `npx -y skills@1.7.4 add samber/cc-skills-golang#${SHA} -s golang-testing -a claude-code -y`,
      s.root,
      ['-y', 'skills@1.7.4', 'add', `samber/cc-skills-golang#${SHA}`, '-s', 'golang-testing', '-a', 'claude-code', '-y']
    ]]);
    assert.match(res.out, /\(in .+product\) npx -y skills@1\.7\.4 add/);
  } finally { s.done(); }
});

test('group skills on Windows is one string with the pinned source', () => {
  const s = sandbox();
  try {
    writeFileSync(s.projectFile, doc(line()));
    const calls = [];
    const code = main(['skills', '--project', s.projectFile], { manifest, home: join(s.base, 'home'), cwd: s.base, today: TODAY, platform: 'win32', log: () => {}, exec: (c, cwd, argv) => calls.push([c, cwd, argv]) });
    assert.equal(code, 0);
    assert.deepEqual(calls, [[`npx -y skills@1.7.4 add samber/cc-skills-golang#${SHA} -s golang-testing -a claude-code -y`, s.root, undefined]]);
  } finally { s.done(); }
});

test('each repo line pins its own commit', () => {
  const s = sandbox();
  try {
    const other = 'f'.repeat(40);
    const res = s.run(['skills', '--project', s.projectFile], doc(line(), line({ name: 'second', source: 'o/second', commit: other })));
    assert.equal(res.code, 0);
    assert.deepEqual(res.calls.map(c => c[0]), [
      `npx -y skills@1.7.4 add samber/cc-skills-golang#${SHA} -s golang-testing -a claude-code -y`,
      `npx -y skills@1.7.4 add o/second#${other} -s second -a claude-code -y`
    ]);
  } finally { s.done(); }
});

test('groups design and skills together; a bad skills line stops both', () => {
  const s = sandbox();
  try {
    const md = `## Design skills\n- name: hallmark; source: nutlope/hallmark; license: MIT; vetted: 2026-10-26; why: x; approved: 2026-10-26\n\n## Skills\n${line()}\n`;
    const ok = s.run(['design', 'skills', '--project', s.projectFile], md);
    assert.equal(ok.code, 0);
    assert.equal(ok.calls.length, 2);
    const bad = s.run(['design', 'skills', '--project', s.projectFile], md.replace('golang-testing', 'a&&b'));
    assert.equal(bad.code, 1);
    assert.match(bad.out, /ERROR skills line \d+: name invalid/);
    assert.equal(bad.calls.length, 2);
  } finally { s.done(); }
});

test('group skills without --project is an unknown group; no section is an empty group', () => {
  const s = sandbox();
  try {
    const res = s.run(['skills']);
    assert.equal(res.code, 1);
    assert.match(res.out, /ERROR unknown group skills/);
    assert.match(s.run(['skills', '--project', s.projectFile], '# P\n').out, /All skills already installed/);
  } finally { s.done(); }
});

test('installed detection covers the product root for group skills', () => {
  const s = sandbox();
  try {
    mkdirSync(join(s.root, '.agents', 'skills', 'golang-testing'), { recursive: true });
    const res = s.run(['skills', '--missing', '--project', s.projectFile], doc(line(), line({ name: 'other', source: 'o/other' })));
    assert.equal(res.out, 'missing other');
  } finally { s.done(); }
});

test('group skills: the old unpinned impeccable line resolves to the pinned manifest command and is printed as manual, nothing runs', () => {
  const PINNED = 'npx -y impeccable@4.8.0 skills install';
  const s = sandbox();
  try {
    const res = s.run(['skills', '--project', s.projectFile], doc(line({ name: 'impeccable', source: '`npx -y impeccable skills install`', commit: '-' })), { manifest: { core: [{ name: 'impeccable', install: PINNED }] } });
    assert.equal(res.code, 0, res.out);
    assert.deepEqual(res.calls, []);
    assert.match(res.out, new RegExp(`^manual ${PINNED}$`, 'm'));
    assert.doesNotMatch(res.out, /ERROR|FAILED/);
  } finally { s.done(); }
});
