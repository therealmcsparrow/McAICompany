import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkillsSection, parseDesignSkills } from './install-skills.mjs';

const TODAY = new Date('2026-10-26T12:00:00Z');
const manifest = { core: [{ name: 'impeccable', install: 'npx -y impeccable skills install' }] };
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const line = (o = {}) => {
  const f = { area: 'stack', name: 'golang-testing', source: 'samber/cc-skills-golang', license: 'MIT', vetted: '2026-10-26', commit: SHA, why: 'tests', approved: '2026-10-26', ...o };
  const commit = f.commit === null ? '' : `commit: ${f.commit}; `;
  return `- area: ${f.area}; name: ${f.name}; source: ${f.source}; license: ${f.license}; vetted: ${f.vetted}; ${commit}why: ${f.why}; approved: ${f.approved}`;
};
const doc = (...lines) => `# P\n\n## Skills\n<!-- approved -->\n${lines.join('\n')}\n\n## Next\nx\n`;

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
  test(`hostile: ${label} errors and names the line`, () => {
    assert.throws(() => parseSkillsSection(`## Skills\n${text}\n`, manifest, TODAY), re);
    assert.throws(() => parseSkillsSection(doc(text), manifest, TODAY), /skills line \d+: /);
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
