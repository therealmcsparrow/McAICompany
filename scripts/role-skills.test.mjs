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
  '--line', '12:stk-skill=backend-engineer'];

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
  const r = run(p, ['migrate', '--apply', '--line', '4:hallmark=ui-ux-designer', '--line', '7:stk-skill=backend-engineer']);
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
  const r = run(p, ['migrate', '--apply', '--line', '4:fancy-ui=qa', '--line', '7:stk-skill=architect']);
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

  const plain = run(p, ['migrate', '--apply', '--line', '12:stk-skill=qa']);
  assert.match(plain.text, /line 12: stays, Role not offered/);
  assert.equal(fs.existsSync(userFile(p)), false);

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
  assert.match(design.r.text, /line 6: stays, category not offered/);
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
