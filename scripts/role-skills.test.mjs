import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, migrate, pending, stale, add, record, failLine } from './role-skills.mjs';

const TODAY = '2026-11-07';
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-skills-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const DESIGN = [
  '- name: hallmark; source: nutlope/hallmark; license: MIT; vetted: 2026-01-10; why: looks; approved: 2026-01-11',
  '- name: impeccable; source: `npx -y impeccable skills install`; license: Apache-2.0; vetted: 2026-01-10; why: polish; approved: 2026-01-12',
  `- name: fancy-ui; source: octo/fancy; license: MIT; vetted: 2026-02-01; commit: ${A}; why: fancy; approved: 2026-02-02`,
  `- name: nolicense; source: octo/nolic; license: -; vetted: 2026-02-01; commit: ${A}; why: w; approved: 2026-02-02`,
  '- name: aico:ui-design; source: plugin aico; license: -; vetted: -; why: own; approved: 2026-02-03',
  'hello there'
];
const SKILLS = [
  `- area: stack; name: stk-skill; source: octo/stk; license: MIT; vetted: 2026-02-03; commit: ${B}; why: w; approved: 2026-02-04`,
  '- area: stack; name: other; source: `npx -y other@1.0.0 skills install`; license: MIT; vetted: 2026-02-03; commit: -; why: w; approved: 2026-02-04'
];

function project(t, { design = DESIGN, skills = SKILLS, settings } = {}) {
  const cwd = tmp(t);
  const home = tmp(t);
  fs.mkdirSync(path.join(cwd, '.company'));
  const md = `# P\n\n## Design skills\n${design.join('\n')}\n\n## Skills\n${skills.join('\n')}\n\n## Other\nkeep\n`;
  fs.writeFileSync(path.join(cwd, '.company', 'project.md'), md);
  if (settings !== undefined) fs.writeFileSync(path.join(cwd, '.company', 'settings.json'), JSON.stringify(settings));
  return { cwd, home, md };
}

function run(p, args) {
  const out = [];
  const code = main(args, { cwd: p.cwd, home: p.home, today: TODAY, log: (s) => out.push(s) });
  return { code, text: out.join('\n'), out };
}

const APPLY = ['migrate', '--apply',
  '--line', '4:hallmark=ui-ux-designer',
  '--line', '5:impeccable=ui-ux-designer',
  '--line', '6:fancy-ui=ui-ux-designer,brand-artist',
  '--line', '8:aico:ui-design=ui-ux-designer',
  '--line', '12:stk-skill=backend-engineer',
  '--category', '12:stk-skill=engineering'];

const read = (p, f) => fs.readFileSync(path.join(p.cwd, '.company', f), 'utf8');
const userFile = (p) => path.join(p.home, '.mcsparrow', '3rdpartyskills.json');

test('preview lists every line and writes nothing', (t) => {
  const p = project(t);
  const r = run(p, ['migrate']);
  assert.equal(r.code, 0);
  assert.match(r.text, /line 4: hallmark, source nutlope\/hallmark.*selection only; Category: design; Roles: .*ui-ux-designer/);
  assert.match(r.text, /line 5: impeccable.*selection only/);
  assert.match(r.text, /line 6: fancy-ui.*license MIT.*approved 2026-02-02; new entry in your list/);
  assert.match(r.text, /line 7: stays, no license/);
  assert.match(r.text, /line 9: stays, not a skill line/);
  assert.match(r.text, /line 13: stays, command differs from the list/);
  assert.equal(read(p, 'project.md'), p.md);
  assert.equal(fs.existsSync(userFile(p)), false);
  assert.equal(pending({ cwd: p.cwd, home: p.home, today: TODAY }), 7);
  const counts = run(p, ['pending']);
  assert.deepEqual(counts.out, ['pending: 7', 'can migrate: 5']);
});

test('apply writes entries and selections, archives, clears, and a second run changes nothing', (t) => {
  const p = project(t);
  const r = run(p, APPLY);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /line 6: migrated, entry in your list, selected for ui-ux-designer, brand-artist/);
  assert.match(r.text, /line 7: stays, no license/);
  const cat = JSON.parse(fs.readFileSync(userFile(p), 'utf8'));
  assert.deepEqual(cat.entries.map((e) => e.skillname).sort(), ['fancy-ui', 'stk-skill']);
  const fancy = cat.entries.find((e) => e.skillname === 'fancy-ui');
  assert.equal(fancy.skillcategory, 'design');
  assert.equal(fancy.license, 'MIT');
  assert.equal(fancy.vetted, '2026-02-01');
  assert.equal(fancy.hash, undefined);
  assert.equal(cat.entries.find((e) => e.skillname === 'stk-skill').skillcategory, 'engineering');
  const roles = JSON.parse(read(p, 'settings.json')).aico_settings.roles;
  assert.deepEqual(roles['ui-ux-designer'].skills, [
    { name: 'hallmark', approved: '2026-01-11' },
    { name: 'impeccable', approved: '2026-01-12' },
    { name: 'fancy-ui', approved: '2026-02-02' },
    { name: 'aico:ui-design', approved: '2026-02-03' }]);
  assert.deepEqual(roles['backend-engineer'].skills, [{ name: 'stk-skill', approved: '2026-02-04' }]);
  const archived = fs.readdirSync(path.join(p.cwd, '.company', 'archive'));
  assert.equal(archived.length, 1);
  const arch = fs.readFileSync(path.join(p.cwd, '.company', 'archive', archived[0]), 'utf8');
  assert.match(arch, /name: fancy-ui/);
  const md = read(p, 'project.md');
  assert.doesNotMatch(md, /name: fancy-ui/);
  assert.match(md, /name: nolicense/);
  assert.match(md, /name: other;/);
  assert.match(md, /## Other\nkeep\n/);

  const files = [read(p, 'project.md'), read(p, 'settings.json'), fs.readFileSync(userFile(p), 'utf8')];
  const again = run(p, APPLY);
  assert.equal(again.code, 0);
  assert.deepEqual([read(p, 'project.md'), read(p, 'settings.json'), fs.readFileSync(userFile(p), 'utf8')], files);
  assert.equal(fs.readdirSync(path.join(p.cwd, '.company', 'archive')).length, 1);
});

test('a section left empty gets its placeholder back', (t) => {
  const p = project(t, { design: [DESIGN[0]], skills: [SKILLS[0]] });
  const r = run(p, ['migrate', '--apply', '--line', '4:hallmark=ui-ux-designer', '--line', '7:stk-skill=backend-engineer', '--category', '7:stk-skill=engineering']);
  assert.equal(r.code, 0, r.text);
  const md = read(p, 'project.md');
  assert.match(md, /## Design skills\n- \(none yet; the design-researcher proposes them\)\n/);
  assert.match(md, /## Skills\n- \(none yet; the skill-researcher proposes them\)\n/);
});

test('a failed value stays, never echoed', (t) => {
  const bad = `- name: odd; source: octo/odd; license: MIT!x; vetted: 2026-02-01; commit: ${A}; why: w; approved: 2026-02-02`;
  const p = project(t, { design: [bad], skills: [] });
  const r = run(p, ['migrate']);
  assert.match(r.text, /line 4: stays, license not valid/);
  assert.doesNotMatch(r.text, /MIT!x|octo\/odd/);
});

test('a repo line without a commit stays unless it equals a list entry', (t) => {
  const p = project(t, { design: ['- name: free; source: octo/free; license: MIT; vetted: 2026-02-01; why: w; approved: 2026-02-02'], skills: [] });
  assert.match(run(p, ['migrate']).text, /line 4: stays, repo line has no commit/);
});

test('a Role not offered, or a protected Role, stays', (t) => {
  const p = project(t, { design: [DESIGN[2]], skills: [SKILLS[0]] });
  const r = run(p, ['migrate', '--apply', '--line', '4:fancy-ui=qa', '--line', '7:stk-skill=architect', '--category', '7:stk-skill=engineering']);
  assert.match(r.text, /line 4: stays, Role not offered/);
  assert.match(r.text, /line 7: stays, Role not offered/);
  assert.equal(fs.existsSync(userFile(p)), false);
  assert.equal(read(p, 'project.md').includes('fancy-ui'), true);
});

test('a Role already at 5 is not offered', (t) => {
  const five = ['a1', 'a2', 'a3', 'a4', 'a5'].map((name) => ({ name }));
  const p = project(t, { design: [DESIGN[0]], skills: [], settings: { aico_settings: { version: 1, roles: { 'ui-ux-designer': { skills: five } } } } });
  const r = run(p, ['migrate']);
  assert.match(r.text, /line 4: hallmark/);
  assert.doesNotMatch(r.text, /Roles:.*\bui-ux-designer\b/);
  assert.match(r.text, /Roles: .*brand-artist/);
});

test('a name another line holds with another commit needs Move', (t) => {
  const p = project(t, { design: [DESIGN[2]], skills: [] });
  fs.mkdirSync(path.join(p.home, '.mcsparrow'));
  const hash = 'd'.repeat(64);
  fs.writeFileSync(userFile(p), JSON.stringify({ schema: 1, entries: [{ skillname: 'fancy-ui', skillcategory: 'design', skillrepo: 'octo/fancy', skillcommit: C, license: 'MIT', vetted: '2026-01-01', hash }] }));
  const keep = run(p, ['migrate', '--apply', '--line', '4:fancy-ui=ui-ux-designer']);
  assert.match(keep.text, /line 4: stays, commit differs from your list/);
  assert.equal(JSON.parse(fs.readFileSync(userFile(p), 'utf8')).entries[0].skillcommit, C);
  const move = run(p, ['migrate', '--apply', '--line', '4:fancy-ui=ui-ux-designer', '--move', '4:fancy-ui']);
  assert.equal(move.code, 0, move.text);
  const e = JSON.parse(fs.readFileSync(userFile(p), 'utf8')).entries[0];
  assert.equal(e.skillcommit, A);
  assert.equal(e.hash, undefined);
  assert.equal(e.vetted, undefined);
});

test('a line number now holding another skill is refused', (t) => {
  const p = project(t, { design: [DESIGN[0]], skills: [] });
  const r = run(p, ['migrate', '--apply', '--line', '4:impeccable=ui-ux-designer']);
  assert.match(r.text, /line 4: stays, line changed/);
  assert.equal(fs.existsSync(path.join(p.cwd, '.company', 'settings.json')), false);
});

test('MCSPARROW_HOME set elsewhere stops before any form', (t) => {
  const p = project(t);
  const old = process.env.MCSPARROW_HOME;
  process.env.MCSPARROW_HOME = tmp(t);
  t.after(() => { if (old === undefined) delete process.env.MCSPARROW_HOME; else process.env.MCSPARROW_HOME = old; });
  const out = [];
  const code = main(['migrate'], { cwd: p.cwd, today: TODAY, log: (s) => out.push(s) });
  assert.equal(code, 1);
  assert.deepEqual(out, ['ERROR user catalog: MCSPARROW_HOME is set']);
  assert.equal(read(p, 'project.md'), p.md);
});

test('an unwritable user catalog stops before any form', (t) => {
  const p = project(t);
  fs.writeFileSync(path.join(p.home, '.mcsparrow'), 'not a folder');
  const r = run(p, ['migrate']);
  assert.equal(r.code, 1);
  assert.equal(r.text.startsWith('ERROR user catalog'), true);
  assert.equal(read(p, 'project.md'), p.md);
});

test('a refused settings write leaves project.md whole and a rerun adds no duplicate', (t) => {
  const p = project(t, { design: [DESIGN[2]], skills: [] });
  fs.writeFileSync(path.join(p.cwd, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1, roles: { 'ui-ux-designer': { skills: [{ name: 'ghost-skill' }] } } } }));
  const r = run(p, ['migrate', '--apply', '--line', '4:fancy-ui=ui-ux-designer']);
  assert.equal(r.code, 1);
  assert.match(r.text, /project settings refused/);
  assert.match(r.text, /done so far: nothing; project.md is unchanged/);
  assert.equal(fs.existsSync(path.join(p.cwd, '.company', 'archive')), false);
  assert.equal(fs.existsSync(userFile(p)), false);
  assert.equal(read(p, 'project.md'), p.md);
  fs.writeFileSync(path.join(p.cwd, '.company', 'settings.json'), JSON.stringify({ aico_settings: { version: 1 } }));
  const again = run(p, ['migrate', '--apply', '--line', '4:fancy-ui=ui-ux-designer']);
  assert.equal(again.code, 0, again.text);
  assert.equal(JSON.parse(fs.readFileSync(userFile(p), 'utf8')).entries.length, 1);
});

test('pending is 0 without project.md', (t) => {
  const cwd = tmp(t);
  assert.equal(pending({ cwd, home: tmp(t), today: TODAY }), 0);
  const out = [];
  assert.equal(main(['pending'], { cwd, home: tmp(t), log: (s) => out.push(s) }), 0);
  assert.deepEqual(out, ['pending: 0', 'can migrate: 0']);
});

test('stale: none, old, undated and fresh design selections', (t) => {
  const mk = (skills) => {
    const p = project(t, { design: [], skills: [], settings: { aico_settings: { version: 1, roles: { 'ui-ux-designer': { skills } } } } });
    return stale({ cwd: p.cwd, home: p.home, today: TODAY });
  };
  assert.deepEqual([mk([]).stale, mk([]).reason], [true, 'no design selection']);
  assert.equal(mk([{ name: 'hallmark', approved: '2026-01-01' }]).reason, 'older than 180 days');
  assert.equal(mk([{ name: 'hallmark' }]).reason, 'no valid date');
  const fresh = mk([{ name: 'hallmark', approved: '2026-10-01' }]);
  assert.equal(fresh.stale, false);
  assert.deepEqual(fresh.names, ['hallmark']);
});

test('arguments are checked against an allow-list', (t) => {
  const p = project(t);
  for (const args of [['migrate', '--line', 'x=y'], ['migrate', '--line', '5:hallmark=Bad Role'], ['migrate', '--apply', '--cwd', '/x'], ['nope'], ['pending', 'x']]) {
    const r = run(p, args);
    assert.equal(r.code, 1);
    assert.match(r.text, /^ERROR usage/);
  }
  assert.equal(read(p, 'project.md'), p.md);
});

test('migrate returns the result lines for the caller', (t) => {
  const p = project(t, { design: [], skills: [] });
  assert.deepEqual(migrate({ cwd: p.cwd, home: p.home, today: TODAY }).lines, ['nothing to migrate']);
});

test('a design line offers the five UI Roles first, in that order', (t) => {
  const p = project(t);
  const line = run(p, ['migrate']).out.find((l) => l.startsWith('line 4:'));
  assert.match(line, /Roles: ui-ux-designer, frontend-engineer, desktop-engineer, game-engineer, brand-artist(,|$)/);
});

test('pending counts every skill line, prints how many can migrate, and migrate names the reasons', (t) => {
  const stays = '- name: octo-x; source: octo/x; license: MIT; vetted: 2026-02-01; why: w; approved: 2026-02-02';
  const p = project(t, { design: [stays], skills: [] });
  assert.equal(pending({ cwd: p.cwd, home: p.home, today: TODAY }), 1);
  assert.deepEqual(run(p, ['pending']).out, ['pending: 1', 'can migrate: 0']);
  assert.match(run(p, ['migrate']).text, /line 4: stays, repo line has no commit/);
});

test('pending stops with an error on a bad project settings file, and is 0 only without project.md', (t) => {
  const p = project(t, { design: [DESIGN[0]], skills: [] });
  fs.writeFileSync(path.join(p.cwd, '.company', 'settings.json'), '{ nope');
  const r = run(p, ['pending']);
  assert.equal(r.code, 1);
  assert.match(r.text, /^ERROR project settings/);
  assert.throws(() => pending({ cwd: p.cwd, home: p.home, today: TODAY }));
});

test('failLine lets a baseline catalog message through and hides other errors', () => {
  assert.equal(failLine(new Error('ERROR baseline catalog: missing'), 'x failed'), 'ERROR baseline catalog: missing');
  assert.equal(failLine(new Error('secret detail'), 'x failed'), 'ERROR x failed');
});

test('a second line with the same name and commit writes the entry when only it is chosen', (t) => {
  const p = project(t, { design: [DESIGN[2], DESIGN[2]], skills: [] });
  const r = run(p, ['migrate', '--apply', '--line', '5:fancy-ui=ui-ux-designer']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /line 5: migrated, entry in your list, selected for ui-ux-designer/);
  assert.equal(JSON.parse(fs.readFileSync(userFile(p), 'utf8')).entries.length, 1);
  assert.equal(JSON.parse(read(p, 'settings.json')).aico_settings.roles['ui-ux-designer'].skills[0].name, 'fancy-ui');
});

test('a stale name on another Role does not stop migration', (t) => {
  const p = project(t, { design: [DESIGN[2]], skills: [], settings: { aico_settings: { version: 1, roles: { 'brand-artist': { skills: [{ name: 'ghost-skill' }] } } } } });
  const r = run(p, ['migrate', '--apply', '--line', '4:fancy-ui=ui-ux-designer']);
  assert.equal(r.code, 0, r.text);
  const roles = JSON.parse(read(p, 'settings.json')).aico_settings.roles;
  assert.equal(roles['brand-artist'].skills[0].name, 'ghost-skill');
  assert.equal(roles['ui-ux-designer'].skills[0].name, 'fancy-ui');
});

test('a banned character in another Role stops migrate and record and leaves settings.json whole', (t) => {
  const settings = { aico_settings: { version: 1, roles: { 'brand-artist': { name: 'Brand‮Artist' } } } };
  const p = project(t, { design: [DESIGN[2]], skills: [], settings });
  const before = read(p, 'settings.json');
  const m = run(p, ['migrate', '--apply', '--line', '4:fancy-ui=ui-ux-designer']);
  assert.notEqual(m.code, 0, m.text);
  assert.equal(read(p, 'settings.json'), before);
  const q = project(t, { design: [], skills: [], settings });
  const beforeRecord = read(q, 'settings.json');
  const r = record({ entry: PLUGIN_PICK, license: 'MIT', roles: ['ui-ux-designer'] }, { cwd: q.cwd, home: q.home, today: TODAY });
  assert.equal(r.ok, false, r.lines.join('\n'));
  assert.equal(read(q, 'settings.json'), beforeRecord);
  assert.equal(fs.existsSync(userFile(q)), false);
});

test('add previews and stores a pin of a baseline entry under the baseline category', (t) => {
  const home = tmp(t);
  const input = { name: 'hallmark', repo: 'nutlope/hallmark', commit: A, category: 'quality', license: 'MIT' };
  const r = add(input, { home });
  assert.equal(r.ok, true, r.lines.join('\n'));
  assert.ok(r.lines.includes('Category: design'));
  assert.match(r.lines.find((l) => l.startsWith('Roles that can select it:')), /ui-ux-designer/);
  assert.doesNotMatch(r.lines.find((l) => l.startsWith('Roles that can select it:')), /qa/);
  assert.equal(add({ ...input, save: true }, { home }).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.mcsparrow', '3rdpartyskills.json'), 'utf8')).entries[0].skillcategory, 'design');
});

const PLUGIN_PICK = { skillname: 'other-plugin:thing', skillcategory: 'design', skillplugin: 'other-plugin' };

test('record writes a new plugin pick after a license question', (t) => {
  const p = project(t, { design: [], skills: [] });
  const r = record({ entry: PLUGIN_PICK, license: 'MIT', roles: ['ui-ux-designer'] }, { cwd: p.cwd, home: p.home, today: TODAY });
  assert.equal(r.ok, true, r.lines.join('\n'));
  assert.deepEqual(r.lines, ['entry added: other-plugin:thing', 'recorded: other-plugin:thing, Roles ui-ux-designer']);
  const e = JSON.parse(fs.readFileSync(userFile(p), 'utf8')).entries[0];
  assert.equal(e.skillplugin, 'other-plugin');
  assert.equal(e.license, 'MIT');
  assert.equal(JSON.parse(read(p, 'settings.json')).aico_settings.roles['ui-ux-designer'].skills[0].name, 'other-plugin:thing');
});

test('record of a new plugin pick with no license or a dash writes nothing', (t) => {
  const p = project(t, { design: [], skills: [] });
  for (const license of [undefined, '-', '  ']) {
    const r = record({ entry: PLUGIN_PICK, license, roles: ['ui-ux-designer'] }, { cwd: p.cwd, home: p.home, today: TODAY });
    assert.deepEqual(r, { ok: true, lines: ['no license stated: other-plugin:thing'] });
  }
  assert.equal(fs.existsSync(userFile(p)), false);
  assert.equal(fs.existsSync(path.join(p.cwd, '.company', 'settings.json')), false);
});

test('record still refuses a command pick no list holds', (t) => {
  const p = project(t, { design: [], skills: [] });
  const r = record({ entry: { skillname: 'cmd-pick', skillcategory: 'design', skillinstaller: 'npx -y cmd-pick@1.0.0 skills install' }, license: 'MIT', roles: ['ui-ux-designer'] }, { cwd: p.cwd, home: p.home, today: TODAY });
  assert.equal(r.ok, false);
  assert.match(r.lines[0], /^ERROR entry: /);
  assert.equal(fs.existsSync(userFile(p)), false);
});

test('a new entry from a Skills line takes a category the CEO picks, and the Roles follow it', (t) => {
  const p = project(t);
  const pre = run(p, ['migrate']);
  assert.match(pre.out.find((l) => l.startsWith('line 12:')), /new entry in your list; choose its category; Category: engineering; Roles: .*; Category: quality; Roles: qa/);
  const six = pre.out.find((l) => l.startsWith('line 6:'));
  assert.ok(!/choose its category/.test(six) && /; Category: design; Roles: /.test(six), 'a Design skills line shows its category and has no choice');
  assert.ok(!/Category: security/.test(pre.text));

  for (const who of ['qa', 'senior-engineer']) {
    const plain = run(p, ['migrate', '--apply', '--line', `12:stk-skill=${who}`]);
    assert.match(plain.text, /line 12: stays, no category chosen/);
    assert.equal(fs.existsSync(userFile(p)), false);
  }

  const r = run(p, ['migrate', '--apply', '--line', '12:stk-skill=qa', '--category', '12:stk-skill=quality']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /line 12: migrated, entry in your list, selected for qa/);
  const entry = JSON.parse(fs.readFileSync(userFile(p), 'utf8')).entries.find((e) => e.skillname === 'stk-skill');
  assert.equal(entry.skillcategory, 'quality');
  assert.deepEqual(JSON.parse(read(p, 'settings.json')).aico_settings.roles['qa'].skills.map((x) => x.name), ['stk-skill']);
});

test('a category choice is refused for security, for a Design skills line, for a name in a list and for a bad value', (t) => {
  const refused = (extra, line) => {
    const p = project(t);
    const r = run(p, ['migrate', '--apply', ...line, ...extra]);
    return { p, r };
  };
  const sec = refused(['--category', '12:stk-skill=security'], ['--line', '12:stk-skill=security']);
  assert.match(sec.r.text, /line 12: stays, category not offered/);
  const design = refused(['--category', '6:fancy-ui=quality'], ['--line', '6:fancy-ui=qa']);
  assert.match(design.r.text, /line 6: stays, category comes from the list/);
  assert.equal(fs.existsSync(userFile(design.p)), false);
  for (const bad of ['12:stk-skill=Quality', '12:stk-skill=', 'x:stk-skill=quality', '12:stk-skill=quality;x', '12:other=quality', '12:quality']) {
    const r = refused(['--category', bad], ['--line', '12:stk-skill=qa']).r;
    assert.equal(r.code, 1, bad);
    assert.match(r.text, /^ERROR usage/, bad);
  }
  const orphan = refused(['--category', '12:stk-skill=quality'], []).r;
  assert.equal(orphan.code, 1);
  assert.match(orphan.text, /^ERROR usage/);
});

test('a category whose Roles are all at 5 is not printed, and not accepted', (t) => {
  const quality = ['qa', 'code-reviewer', 'fresh-reviewer', 'hands-on-tester', 'persona-tester', 'accessibility-tester'];
  const five = ['a1', 'a2', 'a3', 'a4', 'a5'].map((name) => ({ name }));
  const roles = Object.fromEntries(quality.map((r) => [r, { skills: five }]));
  const p = project(t, { design: [], skills: [SKILLS[0]], settings: { aico_settings: { version: 1, roles } } });
  const pre = run(p, ['migrate']);
  const line = pre.out.find((l) => l.startsWith('line 7:'));
  assert.ok(line, pre.text);
  assert.match(line, /choose its category/);
  assert.match(line, /Category: engineering; Roles: /);
  assert.doesNotMatch(line, /Category: quality/);
  assert.doesNotMatch(line, /Category: security/);

  const r = run(p, ['migrate', '--apply', '--line', '7:stk-skill=qa', '--category', '7:stk-skill=quality']);
  assert.match(r.text, /line 7: stays, category not offered/);
  assert.equal(fs.existsSync(userFile(p)), false);
});

test('two lines with one name share the chosen category, and a Role outside it stays', (t) => {
  const twice = [SKILLS[0], SKILLS[0]];
  const share = project(t, { design: [], skills: twice });
  const r = run(share, ['migrate', '--apply',
    '--line', '7:stk-skill=qa', '--category', '7:stk-skill=quality',
    '--line', '8:stk-skill=hands-on-tester']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /line 7: migrated, entry in your list, selected for qa/);
  assert.match(r.text, /line 8: migrated, .*selected for hands-on-tester/);
  const entries = JSON.parse(fs.readFileSync(userFile(share), 'utf8')).entries.filter((e) => e.skillname === 'stk-skill');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].skillcategory, 'quality');
  const roles = JSON.parse(read(share, 'settings.json')).aico_settings.roles;
  assert.deepEqual(roles['qa'].skills.map((x) => x.name), ['stk-skill']);
  assert.deepEqual(roles['hands-on-tester'].skills.map((x) => x.name), ['stk-skill']);

  const outside = project(t, { design: [], skills: twice });
  const o = run(outside, ['migrate', '--apply',
    '--line', '7:stk-skill=qa', '--category', '7:stk-skill=quality',
    '--line', '8:stk-skill=senior-engineer']);
  assert.match(o.text, /line 7: migrated/);
  assert.match(o.text, /line 8: stays, Role not offered/);
  assert.equal(JSON.parse(fs.readFileSync(userFile(outside), 'utf8')).entries.find((e) => e.skillname === 'stk-skill').skillcategory, 'quality');
  assert.equal(JSON.parse(read(outside, 'settings.json')).aico_settings.roles['senior-engineer'], undefined);
});

const sameName = (commit, area = 'stack') => `- area: ${area}; name: dup-skill; source: octo/dup; license: MIT; vetted: 2026-02-03; commit: ${commit}; why: w; approved: 2026-02-04`;
const entryIn = (p, name) => JSON.parse(fs.readFileSync(userFile(p), 'utf8')).entries.find((e) => e.skillname === name);

test('a Design skills line and a Skills line of one name: the Design line settles the category', (t) => {
  const p = project(t, { design: [`- name: dup-skill; source: octo/dup; license: MIT; vetted: 2026-02-03; commit: ${A}; why: w; approved: 2026-02-04`], skills: [sameName(A)] });
  const r = run(p, ['migrate', '--apply', '--line', '4:dup-skill=ui-ux-designer', '--line', '7:dup-skill=backend-engineer', '--category', '7:dup-skill=engineering']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /line 4: migrated/);
  assert.match(r.text, /line 7: stays, category differs from an earlier line/);
  assert.doesNotMatch(r.text, /ERROR/);
  assert.equal(entryIn(p, 'dup-skill').skillcategory, 'design');
  assert.equal(JSON.parse(read(p, 'settings.json')).aico_settings.roles['backend-engineer'], undefined);
});

test('two Skills lines: the first chosen line settles the category before any write', (t) => {
  const p = project(t, { design: [], skills: [sameName(A), sameName(A)] });
  const r = run(p, ['migrate', '--apply',
    '--line', '7:dup-skill=qa', '--category', '7:dup-skill=quality',
    '--line', '8:dup-skill=backend-engineer', '--category', '8:dup-skill=engineering']);
  assert.match(r.text, /line 7: migrated/);
  assert.match(r.text, /line 8: stays, category differs from an earlier line/);
  assert.doesNotMatch(r.text, /ERROR/);
  assert.equal(entryIn(p, 'dup-skill').skillcategory, 'quality');
});

test('a line with another commit than an entry only this run would write offers no Move', (t) => {
  const p = project(t, { design: [], skills: [sameName(A), sameName(B)] });
  const pre = run(p, ['migrate']);
  assert.match(pre.out.find((l) => l.startsWith('line 8:')), /^line 8: stays, commit differs from an earlier line$/);
  const r = run(p, ['migrate', '--apply',
    '--line', '7:dup-skill=qa', '--category', '7:dup-skill=quality',
    '--line', '8:dup-skill=backend-engineer', '--move', '8:dup-skill']);
  assert.match(r.text, /line 7: migrated/);
  assert.match(r.text, /line 8: stays, commit differs from an earlier line/);
  assert.equal(entryIn(p, 'dup-skill').skillcommit, A);
  assert.match(read(p, 'project.md'), new RegExp(B));

  const only = project(t, { design: [], skills: [sameName(A), sameName(B)] });
  const o = run(only, ['migrate', '--apply', '--line', '8:dup-skill=backend-engineer', '--move', '8:dup-skill', '--category', '8:dup-skill=engineering']);
  assert.match(o.text, /line 8: stays, commit differs from an earlier line/);
  assert.equal(fs.existsSync(userFile(only)), false);
});

const dupLine = ({ commit = A, license = 'MIT', vetted = '2026-02-03' } = {}) => `- area: stack; name: dup-skill; source: octo/dup; license: ${license}; vetted: ${vetted}; commit: ${commit}; why: w; approved: 2026-02-04`;
const pluginLine = ({ license = 'MIT', vetted = '2026-02-03' } = {}) => `- name: other-plugin:thing; source: plugin other-plugin; license: ${license}; vetted: ${vetted}; why: w; approved: 2026-02-04`;
const dupDesign = ({ commit = A, license = 'MIT' } = {}) => `- name: dup-skill; source: octo/dup; license: ${license}; vetted: 2026-02-03; commit: ${commit}; why: w; approved: 2026-02-04`;

function listed(t, { design = [], skills = [] }, skillcategory = 'engineering') {
  const p = project(t, { design, skills });
  fs.mkdirSync(path.join(p.home, '.mcsparrow'));
  fs.writeFileSync(userFile(p), JSON.stringify({ schema: 1, entries: [{ skillname: 'dup-skill', skillcategory, skillrepo: 'octo/dup', skillcommit: C, license: 'MIT', vetted: '2026-01-01', hash: 'd'.repeat(64) }] }));
  return p;
}

for (const [route, make, first, roleArg, category] of [['Skills', dupLine, 7, 'backend-engineer', 'engineering'], ['Design skills', dupDesign, 4, 'ui-ux-designer', 'design']]) {
  const place = (lines) => (route === 'Skills' ? { design: [], skills: lines } : { design: lines, skills: [] });
  const args = (...ns) => ['migrate', '--apply', ...ns.flatMap((n) => ['--line', `${n}:dup-skill=${roleArg}`, '--move', `${n}:dup-skill`])];

  for (const [one, two] of [[A, B], [B, A]]) {
    test(`${route}: a later Move with another commit stays (${one.slice(0, 1)} then ${two.slice(0, 1)})`, (t) => {
      const p = listed(t, place([make({ commit: one }), make({ commit: two })]), category);
      const r = run(p, args(first, first + 1));
      assert.equal(r.code, 0, r.text);
      assert.match(r.text, new RegExp(`line ${first}: migrated`));
      assert.match(r.text, new RegExp(`line ${first + 1}: stays, commit differs from an earlier line`));
      assert.equal(entryIn(p, 'dup-skill').skillcommit, one);
      assert.match(read(p, 'project.md'), new RegExp(two));
      const roles = JSON.parse(read(p, 'settings.json')).aico_settings.roles;
      assert.equal(roles[roleArg].skills.length, 1);
    });
  }

  for (const [one, two] of [['MIT', 'Apache-2.0'], ['Apache-2.0', 'MIT']]) {
    test(`${route}: a later Move with the same commit and another license stays (${one} then ${two})`, (t) => {
      const p = listed(t, place([make({ license: one }), make({ license: two })]), category);
      const r = run(p, args(first, first + 1));
      assert.equal(r.code, 0, r.text);
      assert.match(r.text, new RegExp(`line ${first}: migrated`));
      assert.match(r.text, new RegExp(`line ${first + 1}: stays, license differs from an earlier line`));
      assert.equal(entryIn(p, 'dup-skill').license, one);
      assert.match(read(p, 'project.md'), new RegExp(two));
    });
  }
}

for (const [what, a, b, reason] of [
  ['license', { license: 'MIT' }, { license: 'Apache-2.0' }, 'license differs from an earlier line'],
  ['license', { license: 'Apache-2.0' }, { license: 'MIT' }, 'license differs from an earlier line'],
  ['vetted', { vetted: '2026-02-03' }, { vetted: '2026-02-04' }, 'vetted differs from an earlier line'],
  ['vetted', { plugin: true, vetted: '2026-02-03' }, { plugin: true, vetted: '-' }, 'vetted differs from an earlier line'],
  ['vetted', { plugin: true, vetted: '-' }, { plugin: true, vetted: '2026-02-03' }, 'vetted differs from an earlier line'],
]) {
  test(`a Skills line after a fresh entry with another ${what} stays (${JSON.stringify(a)} then ${JSON.stringify(b)})`, (t) => {
    const mk = a.plugin ? pluginLine : dupLine;
    const name = a.plugin ? 'other-plugin:thing' : 'dup-skill';
    const [first, second, cat, role] = a.plugin ? [4, 5, 'design', 'ui-ux-designer'] : [7, 8, 'quality', 'qa'];
    const p = project(t, a.plugin ? { design: [mk(a), mk(b)], skills: [] } : { design: [], skills: [mk(a), mk(b)] });
    const pre = run(p, ['migrate']);
    assert.equal(pre.out.find((l) => l.startsWith(`line ${second}:`)), `line ${second}: stays, ${reason}`);
    const choose = a.plugin ? [] : ['--category', `${first}:${name}=${cat}`];
    const r = run(p, ['migrate', '--apply', '--line', `${first}:${name}=${role}`, ...choose, '--line', `${second}:${name}=${role}`]);
    assert.match(r.text, new RegExp(`line ${first}: migrated`));
    assert.match(r.text, new RegExp(`line ${second}: stays, ${reason}`));
    assert.equal(entryIn(p, name).license, a.license ?? 'MIT');
    assert.match(read(p, 'project.md'), /why: w/);
  });
}

test('lines of a fresh entry with equal license and vetted both select', (t) => {
  const p = project(t, { design: [], skills: [dupLine(), dupLine()] });
  const r = run(p, ['migrate', '--apply',
    '--line', '7:dup-skill=qa', '--category', '7:dup-skill=quality',
    '--line', '8:dup-skill=qa']);
  assert.match(r.text, /line 7: migrated/);
  assert.match(r.text, /line 8: migrated/);
});

test('a line stays whole when a chosen Role reaches 5 partway through it', (t) => {
  const three = ['impeccable', 'frontend-ui-engineering', 'aico:ui-design'].map((name) => ({ name }));
  const design = [DESIGN[0], DESIGN[2].replace('fancy-ui', 'other-ui'), DESIGN[2]];
  const p = project(t, { design, skills: [], settings: { aico_settings: { version: 1, roles: { 'ui-ux-designer': { skills: three } } } } });
  const args = ['migrate', '--apply', '--line', '4:hallmark=ui-ux-designer', '--line', '5:other-ui=ui-ux-designer', '--line', '6:fancy-ui=ui-ux-designer,brand-artist'];
  const r = run(p, args);
  assert.match(r.text, /line 4: migrated/);
  assert.match(r.text, /line 6: stays, Role already has 5/);
  assert.match(read(p, 'project.md'), /name: fancy-ui/);
  assert.equal(entryIn(p, 'fancy-ui'), undefined);
  assert.equal(JSON.parse(read(p, 'settings.json')).aico_settings.roles['brand-artist'], undefined);
  const again = run(p, ['migrate', '--apply', '--line', '4:fancy-ui=brand-artist']);
  assert.match(again.text, /line 4: migrated, entry in your list, selected for brand-artist/);
  const names = JSON.parse(read(p, 'settings.json')).aico_settings.roles['brand-artist'].skills.map((x) => x.name);
  assert.deepEqual(names, ['fancy-ui']);
});

test('a plugin name of the longest allowed length previews and applies', (t) => {
  const plugin = 'a'.repeat(64);
  const name = `${plugin}:${'b'.repeat(64)}`;
  const line = `- name: ${name}; source: plugin ${plugin}; license: MIT; vetted: 2026-02-01; why: w; approved: 2026-02-02`;
  const p = project(t, { design: [line], skills: [] });
  const pre = run(p, ['migrate']);
  assert.match(pre.out[0], new RegExp(`^line 4: ${name}, source plugin`));
  const r = run(p, ['migrate', '--apply', '--line', `4:${name}=ui-ux-designer`]);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /line 4: migrated/);
  assert.equal(entryIn(p, name).skillplugin, plugin);
});

const stale2 = (role, name) => ({ aico_settings: { version: 1, roles: { [role]: { skills: [{ name }] } } } });
const line = (name) => `- name: ${name}; source: octo/${name}; license: MIT; vetted: 2026-02-01; commit: ${A}; why: w; approved: 2026-02-02`;

test('a stale stored name that a line adds for the same Role does not stop the migrate', (t) => {
  const p = project(t, { design: [line('xx-skill'), line('yy-skill')], skills: [], settings: stale2('ui-ux-designer', 'xx-skill') });
  const both = run(p, ['migrate', '--apply', '--line', '4:xx-skill=ui-ux-designer', '--line', '5:yy-skill=ui-ux-designer']);
  assert.equal(both.code, 0, both.text);
  assert.match(both.text, /line 4: migrated/);
  assert.match(both.text, /line 5: migrated/);
});

test('a stale stored name on another Role still refuses before any write', (t) => {
  const p = project(t, { design: [line('xx-skill')], skills: [`- area: stack; name: zz-skill; source: octo/zz; license: MIT; vetted: 2026-02-03; commit: ${B}; why: w; approved: 2026-02-04`], settings: stale2('backend-engineer', 'xx-skill') });
  const r = run(p, ['migrate', '--apply', '--line', '4:xx-skill=ui-ux-designer', '--line', '7:zz-skill=backend-engineer', '--category', '7:zz-skill=engineering']);
  assert.equal(r.code, 1, r.text);
  assert.match(r.text, /done so far: nothing; project.md is unchanged/);
  assert.equal(fs.existsSync(path.join(p.cwd, '.company', 'archive')), false);
  assert.equal(fs.existsSync(userFile(p)), false);
  assert.equal(read(p, 'project.md'), p.md);
});

test('record of a name that is stored stale for the Role writes the entry and dates the selection today', (t) => {
  const p = project(t, { settings: stale2('backend-engineer', 'pick-one') });
  const out = [];
  const pick = { skillname: 'pick-one', skillcategory: 'engineering', skillrepo: 'octo/pick', skillcommit: A };
  const code = main(['record'], { cwd: p.cwd, home: p.home, today: TODAY, stdin: `${JSON.stringify({ entry: pick, license: 'MIT', roles: ['backend-engineer'] })}\n`, log: (s) => out.push(s) });
  assert.equal(code, 0, out.join('|'));
  assert.equal(out[0], 'entry added: pick-one');
  assert.deepEqual(JSON.parse(read(p, 'settings.json')).aico_settings.roles['backend-engineer'].skills, [{ name: 'pick-one', approved: TODAY }]);
  assert.equal(JSON.parse(fs.readFileSync(userFile(p), 'utf8')).entries.length, 1);
});
