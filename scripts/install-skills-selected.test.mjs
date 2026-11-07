import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, installExec, SKILLS_CLI } from './install-skills.mjs';
import { boundedFolderHash } from './skill-catalog.mjs';

const COMMIT = 'a'.repeat(40);
const SOURCE = 'octo/skills';
const NAME = 'demo-skill';
const TODAY = '2026-11-06';

function tmp(t, label = 'selected') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const userFile = (home) => path.join(home, '.mcsparrow', '3rdpartyskills.json');
function writeUser(home, entries) {
  fs.mkdirSync(path.join(home, '.mcsparrow'), { recursive: true });
  fs.writeFileSync(userFile(home), JSON.stringify({ schema: 1, entries }));
}
const readUser = (home) => JSON.parse(fs.readFileSync(userFile(home), 'utf8')).entries;
const entry = (extra = {}) => ({ skillname: NAME, skillcategory: 'engineering', skillrepo: SOURCE, skillcommit: COMMIT, license: 'MIT', ...extra });

function plant(dir, body = 'hello') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
  return boundedFolderHash(dir);
}

const settingsFor = (lists, moved = false) => ({
  settings_folder_moved: moved,
  roles: Object.fromEntries(Object.entries(lists).map(([role, [level, names]]) => [role, { skills: names.map((name) => ({ name, approved: TODAY })), source: { skills: level } }])),
});

function setup(t, { entries = [entry()], lists = { qa: ['user', [NAME]] }, scan = {}, install, moved = false, after } = {}) {
  const home = tmp(t, 'home');
  const root = tmp(t, 'root');
  if (entries.length) writeUser(home, entries);
  const bodyHash = (dir) => plant(dir);
  const scanDir = tmp(t, 'scan');
  const scanHash = bodyHash(scanDir);
  const log = [];
  const calls = [];
  const vets = [];
  const afters = [];
  const env = {
    home, productRoot: root, today: TODAY, log: (x) => log.push(x),
    settings: settingsFor(lists, moved),
    vet: async (arg) => { vets.push(arg); return scan.value ?? { commit: COMMIT, hash: scanHash, result: { verdict: 'pass', counts: { critical: 0, high: 0 } }, ...scan }; },
    scanInstalled: async (arg, deps) => { afters.push({ arg, deps }); return after ?? { results: [{ verdict: 'pass', blocking: false }] }; },
    exec: (cmd, cwd, argv) => {
      calls.push({ cmd, cwd, argv });
      if (install) install({ cmd, cwd, argv, home, root });
      else {
        const dir = argv.includes('-g') ? path.join(home, '.claude', 'skills', NAME) : path.join(root, '.agents', 'skills', NAME);
        plant(dir);
      }
    },
  };
  return { home, root, env, log, calls, vets, afters, scanHash };
}

test('a user-scope selection scans, installs the pinned commit with -g from the home, then stores hash and date', async (t) => {
  const s = setup(t);
  const code = await main(['--selected'], s.env);
  assert.equal(code, 0, s.log.join('|'));
  assert.deepEqual(s.vets, [{ source: SOURCE, commit: COMMIT, name: NAME }]);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.calls[0].argv, ['-y', SKILLS_CLI, 'add', `${SOURCE}#${COMMIT}`, '-s', NAME, '-g', '-a', 'claude-code', '-y']);
  assert.equal(s.calls[0].cwd, s.home);
  const [stored] = readUser(s.home);
  assert.equal(stored.hash, s.scanHash);
  assert.equal(stored.vetted, TODAY);
});

test('a project-scope selection installs without -g from the product root', async (t) => {
  const s = setup(t, { lists: { qa: ['project', [NAME]] } });
  const code = await main(['--selected'], s.env);
  assert.equal(code, 0, s.log.join('|'));
  assert.ok(!s.calls[0].argv.includes('-g'));
  assert.equal(s.calls[0].cwd, s.root);
});

test('a skill selected at user level by one Role and at project level by another installs once, at user scope', async (t) => {
  const s = setup(t, { lists: { qa: ['project', [NAME]], writer: ['user', [NAME]] } });
  const code = await main(['--selected'], s.env);
  assert.equal(code, 0, s.log.join('|'));
  assert.equal(s.calls.length, 1);
  assert.ok(s.calls[0].argv.includes('-g'));
  assert.equal(s.calls[0].cwd, s.home);
  assert.equal(fs.existsSync(path.join(s.root, '.agents')), false);
  assert.equal(s.vets.length, 1);
});

test('a scan that fails installs nothing, clears hash and vetted, and reports the skill missing', async (t) => {
  const s = setup(t, { entries: [entry({ hash: 'b'.repeat(64), vetted: '2026-01-01' })], scan: { result: { verdict: 'fail', blocking: true, counts: { critical: 1, high: 0 } } } });
  const code = await main(['--selected'], s.env);
  assert.equal(code, 1);
  assert.deepEqual(s.calls, []);
  const [stored] = readUser(s.home);
  assert.equal(stored.hash, undefined);
  assert.equal(stored.vetted, undefined);
  assert.ok(s.log.some((l) => l.startsWith('scan failed: demo-skill') && l.endsWith('missing')), s.log.join('|'));
});

test('a scan that errors or is refused fails closed the same way', async (t) => {
  for (const kind of ['throws', 'refused']) {
    const s = setup(t, { entries: [entry({ hash: 'b'.repeat(64), vetted: '2026-01-01' })] });
    s.env.vet = async () => { if (kind === 'throws') throw new Error('boom'); return { refused: 'skillspector missing' }; };
    assert.equal(await main(['--selected'], s.env), 1, kind);
    assert.deepEqual(s.calls, [], kind);
    assert.equal(readUser(s.home)[0].hash, undefined, kind);
  }
});

test('a scan that returns another commit is not trusted', async (t) => {
  const s = setup(t, { scan: { commit: 'c'.repeat(40) } });
  assert.equal(await main(['--selected'], s.env), 1);
  assert.deepEqual(s.calls, []);
});

test('a user entry with no license is not in the catalog, so nothing is scanned or installed', async (t) => {
  const bare = entry();
  delete bare.license;
  const s = setup(t, { entries: [bare] });
  await main(['--selected'], s.env);
  assert.deepEqual(s.calls, []);
  assert.deepEqual(s.vets, []);
  assert.ok(s.log.some((l) => l.includes('not in the catalog: demo-skill')), s.log.join('|'));
});

test('a hash that differs after the install stores nothing, prints the remove command and exits 1', async (t) => {
  const s = setup(t, { install: ({ home }) => plant(path.join(home, '.claude', 'skills', NAME), 'tampered') });
  const code = await main(['--selected'], s.env);
  assert.equal(code, 1);
  assert.equal(readUser(s.home)[0].hash, undefined);
  assert.equal(readUser(s.home)[0].vetted, undefined);
  const line = s.log.find((l) => l.startsWith('hash differs: demo-skill'));
  assert.ok(line, s.log.join('|'));
  assert.ok(line.includes(`npx -y ${SKILLS_CLI} remove ${NAME} -g -a claude-code -y`), line);
  assert.equal(fs.existsSync(path.join(s.home, '.claude', 'skills', NAME)), true);
});

test('a folder already equal to the scan hash is bound without an install', async (t) => {
  const s = setup(t);
  plant(path.join(s.home, '.claude', 'skills', NAME));
  assert.equal(await main(['--selected'], s.env), 0, s.log.join('|'));
  assert.deepEqual(s.calls, []);
  assert.equal(readUser(s.home)[0].hash, s.scanHash);
});

test('a planted folder with other content is not trusted on its name: it is reinstalled at the pin', async (t) => {
  const s = setup(t);
  plant(path.join(s.home, '.claude', 'skills', NAME), 'planted');
  assert.equal(await main(['--selected'], s.env), 0, s.log.join('|'));
  assert.equal(s.calls.length, 1);
  assert.equal(readUser(s.home)[0].hash, s.scanHash);
});

test('an install that throws stores nothing and exits 1', async (t) => {
  const s = setup(t);
  s.env.exec = () => { throw new Error('network down'); };
  assert.equal(await main(['--selected'], s.env), 1);
  assert.equal(readUser(s.home)[0].hash, undefined);
  assert.ok(s.log.some((l) => l.startsWith('FAILED npx')), s.log.join('|'));
});

test('an installed skill with a bound hash is neither scanned nor installed again', async (t) => {
  const s = setup(t);
  const hash = plant(path.join(s.home, '.claude', 'skills', NAME));
  writeUser(s.home, [entry({ hash, vetted: TODAY })]);
  assert.equal(await main(['--selected'], s.env), 0);
  assert.deepEqual(s.vets, []);
  assert.deepEqual(s.calls, []);
});

test('the dry run prints the scan and the exact command, scans and installs nothing', async (t) => {
  const s = setup(t);
  assert.equal(await main(['--selected', '--dry-run'], s.env), 0);
  assert.deepEqual(s.vets, []);
  assert.deepEqual(s.calls, []);
  assert.ok(s.log.includes(`[dry-run] npx -y ${SKILLS_CLI} add ${SOURCE}#${COMMIT} -s ${NAME} -g -a claude-code -y`), s.log.join('|'));
  assert.equal(readUser(s.home)[0].hash, undefined);
});

test('an unpinned baseline repo, an installer and a plugin are never scanned or run', async (t) => {
  const s = setup(t, { entries: [], lists: { qa: ['user', ['find-skills', 'impeccable', 'aico:ui-design']] } });
  assert.equal(await main(['--selected'], s.env), 0, s.log.join('|'));
  assert.deepEqual(s.vets, []);
  assert.deepEqual(s.calls, []);
  assert.ok(s.log.some((l) => l.startsWith('needs a pin: find-skills') && l.includes('/aico:add-skill')));
  assert.ok(s.log.some((l) => l.startsWith('manual npx ')));
  assert.ok(s.log.some((l) => l.startsWith('WARNING: impeccable ') && l.includes('not vetted')));
  assert.ok(s.log.some((l) => l.startsWith('plugin aico:ui-design') && l.includes('/plugin')));
});

test('a name installed without a pin counts as present on the needs a pin line', async (t) => {
  const s = setup(t, { entries: [], lists: { qa: ['user', ['find-skills']] } });
  fs.mkdirSync(path.join(s.home, '.claude', 'skills', 'find-skills'), { recursive: true });
  await main(['--selected'], s.env);
  assert.ok(s.log.some((l) => l.startsWith('needs a pin: find-skills') && l.includes('installed, name only')), s.log.join('|'));
});

test('a stale name and a name that is shell text reach neither the catalog lookup nor a command', async (t) => {
  const s = setup(t, { lists: { qa: ['user', ['gone-skill', '$(touch x)', 'a;b']] } });
  assert.equal(await main(['--selected'], s.env), 0, s.log.join('|'));
  assert.deepEqual(s.calls, []);
  assert.deepEqual(s.vets, []);
  assert.ok(!s.log.join('|').includes('$('));
});

test('a settings folder that moved is printed, and a missing flag counts as moved', async (t) => {
  const a = setup(t, { moved: true });
  await main(['--selected', '--dry-run'], a.env);
  assert.ok(a.log.includes('settings folder moved'));
  const b = setup(t);
  delete b.env.settings.settings_folder_moved;
  await main(['--selected', '--dry-run'], b.env);
  assert.ok(b.log.includes('settings folder moved'));
  const c = setup(t);
  await main(['--selected', '--dry-run'], c.env);
  assert.ok(!c.log.includes('settings folder moved'));
});

test('--status prints one line per skill with Roles, status, place, license, vetted text and dispatch', async (t) => {
  const s = setup(t, { lists: { qa: ['user', [NAME, 'aico:ui-design', 'impeccable']], writer: ['user', [NAME]] } });
  assert.equal(await main(['--status'], s.env), 0);
  const lines = s.log.filter((l) => l.includes(' | ') && !l.includes(' | roles: - | '));
  assert.equal(lines.length, 3, s.log.join('|'));
  const demo = lines.find((l) => l.startsWith('demo-skill'));
  assert.equal(demo, 'demo-skill | roles: qa, writer | missing | place: - | license: MIT, as stated, not checked | not vetted | dispatch: no');
  assert.ok(lines.find((l) => l.startsWith('aico:ui-design')).endsWith('dispatch: session list'));
  assert.ok(lines.find((l) => l.startsWith('impeccable')).includes('not vetted'));
  assert.deepEqual(s.calls, []);
  assert.deepEqual(s.vets, []);
});

test('--status says dispatch yes and shows the date once the folder is bound and installed', async (t) => {
  const s = setup(t);
  const hash = plant(path.join(s.home, '.claude', 'skills', NAME));
  writeUser(s.home, [entry({ hash, vetted: TODAY })]);
  await main(['--status'], s.env);
  const line = s.log.find((l) => l.startsWith('demo-skill'));
  assert.ok(line.includes(`| installed | place: user |`), line);
  assert.ok(line.includes(`vetted ${TODAY}`) && line.endsWith('dispatch: yes'), line);
});

test('--status shows a date with no hash as from the old list, and a baseline license gap as no license on record', async (t) => {
  const s = setup(t, { entries: [entry({ vetted: '2026-01-02' })], lists: { qa: ['user', [NAME, 'vercel-react-best-practices']] } });
  await main(['--status'], s.env);
  assert.ok(s.log.some((l) => l.includes('vetted 2026-01-02, from the old list, not scanned here')), s.log.join('|'));
  assert.ok(s.log.some((l) => l.startsWith('vercel-react-best-practices') && l.includes('license: no license on record')), s.log.join('|'));
});

test('--selected and --status refuse each other, other flags and a dry run of --status', async (t) => {
  const s = setup(t);
  for (const args of [['--selected', '--status'], ['--selected', '--project'], ['--status', '--dry-run'], ['--selected', 'core']]) {
    s.log.length = 0;
    assert.equal(await main(args, s.env), 1, args.join(' '));
    assert.ok(s.log.some((l) => l.startsWith('ERROR')), args.join(' '));
  }
});

test('the install child sees the given home as HOME and USERPROFILE and no CLAUDE_CONFIG_DIR in any case', async (t) => {
  const home = tmp(t, 'home');
  const cwd = tmp(t, 'cwd');
  const saved = { cfg: process.env.Claude_Config_Dir, home: process.env.HOME, up: process.env.USERPROFILE };
  t.after(() => {
    for (const [k, v] of [['Claude_Config_Dir', saved.cfg], ['HOME', saved.home], ['USERPROFILE', saved.up]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  process.env.Claude_Config_Dir = path.join(cwd, 'planted');
  process.env.HOME = path.join(cwd, 'planted-home');
  process.env.USERPROFILE = path.join(cwd, 'planted-home');
  const seen = [];
  const runners = {
    execFileSync: (file, args, opts) => {
      seen.push(opts.env);
      if (String(args[0]).endsWith('npm-cli.js')) {
        const pkg = path.join(home, '.mcsparrow', 'cli', 'skills-1.7.4', 'node_modules', 'skills');
        fs.mkdirSync(pkg, { recursive: true });
        fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ version: '1.7.4', bin: { skills: 'bin.mjs' } }));
        fs.writeFileSync(path.join(pkg, 'bin.mjs'), '');
      }
    },
    execSync: () => { throw new Error('no shell'); },
  };
  const run = installExec(home, runners, { pinHome: true });
  run('npx', cwd, ['-y', SKILLS_CLI, 'add', `${SOURCE}#${COMMIT}`, '-s', NAME, '-a', 'claude-code', '-y']);
  assert.equal(seen.length, 2);
  for (const env of seen) {
    assert.equal(env.HOME, home);
    assert.equal(env.USERPROFILE, home);
    assert.equal(Object.keys(env).filter((k) => /^claude_config_dir$/i.test(k)).length, 0);
    assert.equal(env.DISABLE_TELEMETRY, '1');
    assert.equal(env.DO_NOT_TRACK, '1');
  }
});

const TWO = ['other-skill', NAME];
const twoSetup = (t) => setup(t, { entries: [entry(), entry({ skillname: 'other-skill' })], lists: { qa: ['user', TWO] } });

test('--skill=<name> limits the run to the named skills: only they are scanned, installed and stored', async (t) => {
  const s = twoSetup(t);
  const code = await main(['--selected', `--skill=${NAME}`], s.env);
  assert.equal(code, 0, s.log.join('|'));
  assert.deepEqual(s.vets, [{ source: SOURCE, commit: COMMIT, name: NAME }]);
  assert.equal(s.calls.length, 1);
  assert.ok(s.calls[0].argv.includes(NAME));
  const stored = readUser(s.home);
  assert.equal(stored.find((e) => e.skillname === NAME).hash, s.scanHash);
  assert.equal(stored.find((e) => e.skillname === 'other-skill').hash, undefined);
});

test('--skill is repeatable and the dry run honors it', async (t) => {
  const s = twoSetup(t);
  assert.equal(await main(['--selected', '--dry-run', `--skill=${NAME}`, '--skill=other-skill'], s.env), 0, s.log.join('|'));
  assert.equal(s.log.filter((l) => l.startsWith('[dry-run] npx')).length, 2);
  const one = twoSetup(t);
  assert.equal(await main(['--selected', '--dry-run', '--skill=other-skill'], one.env), 0);
  const cmds = one.log.filter((l) => l.startsWith('[dry-run] npx'));
  assert.equal(cmds.length, 1);
  assert.ok(cmds[0].includes('-s other-skill'));
  assert.deepEqual(one.calls, []);
});

test('a named skill that is not in the selection is refused and nothing is installed', async (t) => {
  const s = twoSetup(t);
  const code = await main(['--selected', `--skill=${NAME}`, '--skill=not-selected'], s.env);
  assert.equal(code, 1);
  assert.deepEqual(s.calls, []);
  assert.deepEqual(s.vets, []);
  assert.ok(s.log.some((l) => l.startsWith('ERROR')), s.log.join('|'));
  assert.equal(readUser(s.home).some((e) => e.hash !== undefined), false);
});

test('a name outside the fixed pattern is refused before settings are read and nothing is installed', async (t) => {
  for (const bad of ['', 'Demo', '-x', 'a b', 'a;rm -rf', '$(id)', '../x', 'a:b', 'a*', 'x'.repeat(70)]) {
    const s = twoSetup(t);
    let read = false;
    s.env.settings = new Proxy({}, { get() { read = true; return undefined; } });
    assert.equal(await main(['--selected', `--skill=${bad}`], s.env), 1, JSON.stringify(bad));
    assert.equal(read, false, JSON.stringify(bad));
    assert.deepEqual(s.calls, []);
    assert.deepEqual(s.vets, []);
  }
  const s = twoSetup(t);
  assert.equal(await main(['--selected', '--skill', NAME], s.env), 1);
  assert.deepEqual(s.calls, []);
});

test('--skill is refused with --status and without --selected', async (t) => {
  for (const args of [['--status', `--skill=${NAME}`], [`--skill=${NAME}`]]) {
    const s = twoSetup(t);
    assert.equal(await main(args, s.env), 1, args.join(' '));
    assert.deepEqual(s.calls, []);
  }
});

test('a named skill keeps every check: a failed scan installs nothing and a missing license installs nothing', async (t) => {
  const s = setup(t, { entries: [entry(), entry({ skillname: 'other-skill', license: '' })], lists: { qa: ['user', TWO] }, scan: { result: { verdict: 'fail', blocking: true, counts: { critical: 1, high: 0 } } } });
  assert.equal(await main(['--selected', `--skill=${NAME}`], s.env), 1);
  assert.deepEqual(s.calls, []);
  const t2 = setup(t, { entries: [entry(), entry({ skillname: 'other-skill', license: '' })], lists: { qa: ['user', TWO] } });
  assert.equal(await main(['--selected', '--skill=other-skill'], t2.env), 0);
  assert.ok(t2.log.includes('not in the catalog: other-skill'), t2.log.join('|'));
  assert.deepEqual(t2.calls, []);
  assert.deepEqual(t2.vets, []);
});

test('a hash that differs after a named install stores nothing and exits 1', async (t) => {
  const s = setup(t, { install: ({ home }) => plant(path.join(home, '.claude', 'skills', NAME), 'other') });
  assert.equal(await main(['--selected', `--skill=${NAME}`], s.env), 1);
  assert.equal(readUser(s.home)[0].hash, undefined);
});

const BASE = 'find-skills';
const statusLine = async (s) => { await main(['--status'], s.env); return s.log.find((l) => l.startsWith(BASE)); };

test('name only: place project gives dispatch no, place user gives dispatch yes, status text unchanged', async (t) => {
  const p = setup(t, { entries: [], lists: { qa: ['project', [BASE]] } });
  plant(path.join(p.root, '.claude', 'skills', BASE));
  const pl = await statusLine(p);
  assert.match(pl, /\| installed \(name only\) \| place: project \|/);
  assert.ok(pl.endsWith('dispatch: no'), pl);
  const u = setup(t, { entries: [], lists: { qa: ['user', [BASE]] } });
  plant(path.join(u.home, '.claude', 'skills', BASE));
  const ul = await statusLine(u);
  assert.match(ul, /\| installed \(name only\) \| place: user \|/);
  assert.ok(ul.endsWith('dispatch: yes'), ul);
});

test('name only in both places at project scope reads place project and dispatch no', async (t) => {
  const s = setup(t, { entries: [], lists: { qa: ['project', [BASE]] } });
  plant(path.join(s.root, '.claude', 'skills', BASE));
  plant(path.join(s.home, '.claude', 'skills', BASE));
  const line = await statusLine(s);
  assert.match(line, /place: project/);
  assert.ok(line.endsWith('dispatch: no'), line);
});

test('a failed scan clears the pin even when the file holds another bad row', async (t) => {
  const s = setup(t, { entries: [entry({ hash: 'b'.repeat(64), vetted: '2026-01-01' }), entry({ skillname: 'other-skill', license: 'MIT\u2028' })], scan: { result: { verdict: 'fail', blocking: true, counts: { critical: 1, high: 0 } } } });
  assert.equal(await main(['--selected'], s.env), 1);
  assert.equal(readUser(s.home)[0].hash, undefined);
  assert.equal(readUser(s.home)[0].vetted, undefined);
});

test('a bound pin cleared by a blocking scan after install, beside a bad row, reads dispatch no and is scanned again', async (t) => {
  const s = setup(t, {
    entries: [entry({ hash: 'b'.repeat(64), vetted: '2026-01-01' }), entry({ skillname: 'other-skill', license: 'MIT\u2028' })],
    lists: { qa: ['project', [NAME]] },
    after: { results: [{ verdict: 'findings', blocking: true }] },
  });
  assert.equal(await main(['--selected'], s.env), 1);
  assert.equal(s.vets.length, 1);
  const stored = readUser(s.home)[0];
  assert.equal(stored.hash, undefined);
  assert.equal(stored.vetted, undefined);
  assert.ok((await statusOf(s)).endsWith('dispatch: no'));
  fs.rmSync(path.join(s.root, '.agents'), { recursive: true, force: true });
  await main(['--selected'], s.env);
  assert.equal(s.vets.length, 2);
});

test('after install, a hostile copy beside a proven one stops the bind', async (t) => {
  const s = setup(t, { lists: { qa: ['project', [NAME]] }, install: ({ root }) => {
    plant(path.join(root, '.agents', 'skills', NAME));
    plant(path.join(root, '.claude', 'skills', NAME), 'hostile');
  } });
  assert.equal(await main(['--selected'], s.env), 1);
  assert.ok(s.log.some((l) => l.startsWith('hash differs')), s.log.join('|'));
  assert.equal(readUser(s.home)[0].hash, undefined);
});

const statusOf = async (s) => {
  const lines = [];
  await main(['--status'], { ...s.env, log: (x) => lines.push(x) });
  return lines.find((l) => l.startsWith(`${NAME} |`));
};

test('the installed copy is scanned at its scope before the hash is bound, and the bind follows a clean scan', async (t) => {
  for (const [level, scope] of [['user', 'global'], ['project', 'project']]) {
    const s = setup(t, { lists: { qa: [level, [NAME]] } });
    let boundWhenScanned;
    s.env.scanInstalled = async (arg, deps) => {
      boundWhenScanned = readUser(s.home)[0].hash;
      s.afters.push({ arg, deps });
      return { results: [{ verdict: 'findings', blocking: false }] };
    };
    assert.equal(await main(['--selected'], s.env), 0, s.log.join('|'));
    assert.equal(boundWhenScanned, undefined, level);
    assert.deepEqual(s.afters, [{ arg: { name: NAME, scope }, deps: { cwd: s.root, home: s.home } }], level);
    assert.equal(readUser(s.home)[0].hash, s.scanHash, level);
  }
});

test('a folder already equal to the scan is scanned too before it is bound', async (t) => {
  const s = setup(t, { lists: { qa: ['project', [NAME]] } });
  plant(path.join(s.root, '.agents', 'skills', NAME));
  assert.equal(await main(['--selected'], s.env), 0, s.log.join('|'));
  assert.equal(s.calls.length, 0);
  assert.equal(s.afters.length, 1);
  assert.equal(readUser(s.home)[0].hash, s.scanHash);
});

test('a blocking, errored, refused, thrown or ambiguous scan after install binds nothing and the status says dispatch no', async (t) => {
  const bad = {
    blocking: { results: [{ verdict: 'findings', blocking: true }] },
    errored: { results: [{ verdict: 'error', blocking: false }] },
    refused: { refused: 'skillspector missing' },
    none: { results: [] },
    oneBad: { results: [{ verdict: 'pass', blocking: false }, { verdict: 'findings', blocking: true }] },
    unmarked: { results: [{ verdict: 'pass' }] },
    thrown: null,
  };
  for (const [kind, out] of Object.entries(bad)) {
    const s = setup(t, { entries: [entry({ hash: 'b'.repeat(64), vetted: '2026-01-01' })], lists: { qa: ['project', [NAME]] } });
    s.env.scanInstalled = async () => { if (out === null) throw new Error('boom'); return out; };
    assert.equal(await main(['--selected'], s.env), 1, kind);
    assert.ok(s.log.some((l) => l.startsWith(`scan failed after install: ${NAME}`)), `${kind} ${s.log.join('|')}`);
    const stored = readUser(s.home)[0];
    assert.equal(stored.hash, undefined, kind);
    assert.equal(stored.vetted, undefined, kind);
    const line = await statusOf(s);
    assert.ok(line.endsWith('dispatch: no'), `${kind} ${line}`);
  }
});

test('a project pin with a different home copy installs nothing, stores nothing and names the home folder', async (t) => {
  const s = setup(t, { lists: { qa: ['project', [NAME]] } });
  plant(path.join(s.home, '.claude', 'skills', NAME), 'older copy');
  assert.equal(await main(['--selected'], s.env), 1);
  assert.deepEqual(s.calls, []);
  assert.equal(s.afters.length, 0);
  assert.ok(s.log.includes(`hash differs: ${NAME}, nothing stored. Your home folder holds another copy; run this from your home folder only: npx -y ${SKILLS_CLI} remove ${NAME} -g -a claude-code -y`), s.log.join('|'));
  assert.equal(readUser(s.home)[0].hash, undefined);
  assert.ok(!s.log.some((l) => l.startsWith('installed ')));
});

test('a project pin with a different home copy reads folder not recognized, place user, dispatch no', async (t) => {
  const s = setup(t, { lists: { qa: ['project', [NAME]] } });
  const hash = plant(path.join(s.root, '.agents', 'skills', NAME));
  writeUser(s.home, [entry({ hash, vetted: TODAY })]);
  plant(path.join(s.home, '.claude', 'skills', NAME), 'older copy');
  const line = await statusOf(s);
  assert.match(line, /\| folder not recognized \| place: user \|/);
  assert.ok(line.endsWith('dispatch: no'), line);
});

// ---------- linked segments, post-install compare, scan result lines ----------

function link(t, target, at) {
  fs.mkdirSync(path.dirname(at), { recursive: true });
  try { fs.symlinkSync(target, at, 'junction'); return true; } catch { t.diagnostic('cannot create links here'); return false; }
}
const REFUSAL = (segment) => `hash differs: ${NAME}, nothing stored. This is a link or not a folder; delete it by hand: ${segment}`;

test('a linked segment under the product root at scope project is refused with no scan and no install, with or without the name in it', async (t) => {
  const cases = [
    ['.claude', (root, other) => link(t, other, path.join(root, '.claude'))],
    ['.claude/skills', (root, other) => { fs.mkdirSync(path.join(root, '.claude'), { recursive: true }); return link(t, other, path.join(root, '.claude', 'skills')); }],
    ['.agents/skills', (root, other) => { fs.mkdirSync(path.join(root, '.agents'), { recursive: true }); return link(t, other, path.join(root, '.agents', 'skills')); }],
    ['.claude', (root) => { fs.writeFileSync(path.join(root, '.claude'), 'a file'); return true; }],
  ];
  for (const withName of [false, true]) {
    for (const [segment, make] of cases) {
      const s = setup(t, { entries: [entry({ hash: 'b'.repeat(64), vetted: '2026-01-01' })], lists: { qa: ['project', [NAME]] } });
      const other = tmp(t, 'other');
      if (withName) plant(path.join(other, NAME));
      if (!make(s.root, other)) return;
      assert.equal(await main(['--selected'], s.env), 1, `${segment} ${withName}`);
      assert.ok(s.log.includes(REFUSAL(segment)), `${segment} ${withName} ${s.log.join('|')}`);
      assert.equal(s.vets.length, 0);
      assert.equal(s.calls.length, 0);
      assert.equal(s.afters.length, 0);
      assert.equal(s.log.at(-1), '0 installed, 1 failed');
      assert.equal(readUser(s.home)[0].hash, 'b'.repeat(64), 'the stored hash stays');
    }
  }
});

test('two linked segments give two lines and one failure for the skill', async (t) => {
  const s = setup(t, { lists: { qa: ['project', [NAME]] } });
  const other = tmp(t, 'other');
  if (!link(t, other, path.join(s.root, '.agents', 'skills'))) return;
  link(t, other, path.join(s.root, '.claude', 'skills'));
  assert.equal(await main(['--selected'], s.env), 1);
  assert.ok(s.log.includes(REFUSAL('.agents/skills')) && s.log.includes(REFUSAL('.claude/skills')), s.log.join('|'));
  assert.equal(s.log.at(-1), '0 installed, 1 failed');
  assert.equal(s.calls.length, 0);
});

test('the dry run shows the refusal after [dry-run], prints no command and exits 0', async (t) => {
  const s = setup(t, { lists: { qa: ['project', [NAME]] } });
  if (!link(t, tmp(t, 'other'), path.join(s.root, '.claude', 'skills'))) return;
  assert.equal(await main(['--selected', '--dry-run'], s.env), 0, s.log.join('|'));
  assert.ok(s.log.includes(`[dry-run] ${REFUSAL('.claude/skills')}`), s.log.join('|'));
  assert.ok(!s.log.some((l) => l.includes('npx ')), s.log.join('|'));
});

test('a linked ~/.claude/skills at scope user is not refused', async (t) => {
  const s = setup(t, { install: ({ home }) => plant(path.join(home, '.agents', 'skills', NAME)) });
  if (!link(t, tmp(t, 'dotfiles'), path.join(s.home, '.claude', 'skills'))) return;
  assert.equal(await main(['--selected'], s.env), 0, s.log.join('|'));
  assert.ok(!s.log.some((l) => l.startsWith('hash differs')), s.log.join('|'));
  assert.equal(s.calls.length, 1);
});

test('a proven bound .agents copy beside an empty linked .claude/skills reads installed and is not refused', async (t) => {
  const s = setup(t, { lists: { qa: ['project', [NAME]] } });
  const hash = plant(path.join(s.root, '.agents', 'skills', NAME));
  writeUser(s.home, [entry({ hash, vetted: TODAY })]);
  if (!link(t, tmp(t, 'empty'), path.join(s.root, '.claude', 'skills'))) return;
  assert.equal(await main(['--selected'], s.env), 0, s.log.join('|'));
  assert.ok(s.log.includes(`installed ${NAME} (project)`), s.log.join('|'));
  assert.ok(!s.log.some((l) => l.startsWith('hash differs')), s.log.join('|'));
  assert.equal(s.calls.length, 0);
});

test('the compare after the install reads place by scope: a link planted by the install fails at project and not at user', async (t) => {
  let linked = true;
  const plantLink = (root) => {
    plant(path.join(root, '.agents', 'skills', NAME));
    const other = tmp(t, 'other');
    plant(path.join(other, NAME), 'hostile');
    linked = link(t, other, path.join(root, '.claude', 'skills')) && linked;
  };
  const p = setup(t, { lists: { qa: ['project', [NAME]] }, install: ({ root }) => plantLink(root) });
  assert.equal(await main(['--selected'], p.env), 1, p.log.join('|'));
  if (!linked) return;
  assert.ok(p.log.some((l) => l.startsWith(`hash differs: ${NAME}, nothing stored. The folder stays`)), p.log.join('|'));
  assert.equal(readUser(p.home)[0].hash, undefined);
  const u = setup(t, { install: ({ home }) => plantLink(home) });
  assert.equal(await main(['--selected'], u.env), 0, u.log.join('|'));
  assert.equal(readUser(u.home)[0].hash, u.scanHash);
});

test('two clean results after the install bind; one clean and one blocking do not', async (t) => {
  const pass = { verdict: 'pass', blocking: false };
  const s = setup(t, { lists: { qa: ['project', [NAME]] }, after: { results: [pass, { verdict: 'findings', blocking: false }] } });
  assert.equal(await main(['--selected'], s.env), 0, s.log.join('|'));
  assert.equal(readUser(s.home)[0].hash, s.scanHash);
  const f = setup(t, { lists: { qa: ['project', [NAME]] }, after: { results: [pass, { verdict: 'findings', blocking: true }] } });
  assert.equal(await main(['--selected'], f.env), 1);
  assert.equal(readUser(f.home)[0].hash, undefined);
});

test('the real scan of two real project copies binds when both are clean and refuses when the second is blocking', async (t) => {
  const { scanInstalled } = await import('./skillspector.mjs');
  const fix = path.join(import.meta.dirname, '..', 'tests', 'fixtures', 'skillspector');
  const cleanText = fs.readFileSync(path.join(fix, 'sp1', 'claude_cli.raw.json'), 'utf8');
  const blockText = fs.readFileSync(path.join(fix, 'golden', 'hostile-c.nobaseline.json'), 'utf8');
  for (const blockSecond of [false, true]) {
    const s = setup(t, { lists: { qa: ['project', [NAME]] }, install: ({ root }) => {
      plant(path.join(root, '.agents', 'skills', NAME));
      plant(path.join(root, '.claude', 'skills', NAME));
    } });
    let runs = 0;
    const runTool = async () => { runs++; return { exit: 0, stdout: blockSecond && runs === 2 ? blockText : cleanText }; };
    let seen;
    s.env.scanInstalled = async (arg, deps) => {
      seen = await scanInstalled(arg, { ...deps, runTool, detect: async () => ({ v: 1, installed: true, version: '2.13.1', commit: null, uv: true }), settingsMode: async () => 'claude_cli' });
      return seen;
    };
    const code = await main(['--selected'], s.env);
    assert.equal(runs, 2, 'both copies are scanned');
    assert.equal(seen.results.length, 2);
    assert.equal(code, blockSecond ? 1 : 0, s.log.join('|'));
    assert.equal(readUser(s.home)[0].hash, blockSecond ? undefined : s.scanHash);
    if (blockSecond) assert.ok(s.log.some((l) => l.startsWith(`scan failed after install: ${NAME}, nothing stored, verdict findings, blocking.`)), s.log.join('|'));
  }
});

test('the scan failed after install line names what failed, whole line', async (t) => {
  const folders = (root) => `${path.join(root, '.agents', 'skills', NAME)} and ${path.join(root, '.claude', 'skills', NAME)}`;
  const cases = [
    [{ refused: 'skillspector missing' }, 'refused: skillspector missing'],
    [{ results: [] }, 'no usable result'],
    [{ results: [{ verdict: 'findings', blocking: true }] }, 'verdict findings, blocking'],
    [{ results: [{ verdict: 'error', reason: 'timeout', blocking: false }] }, 'verdict error timeout'],
    [{ results: [{ verdict: 'error', reason: 'Bad Text; rm', blocking: false }] }, 'no usable result'],
    [{ results: [{ verdict: 'pass', blocking: false }, { verdict: 'findings', blocking: true }] }, 'verdict findings, blocking'],
    [{ results: [{ verdict: 'pass' }] }, 'no usable result'],
  ];
  for (const [out, what] of cases) {
    const s = setup(t, { lists: { qa: ['project', [NAME]] }, after: out });
    assert.equal(await main(['--selected'], s.env), 1);
    assert.ok(s.log.includes(`scan failed after install: ${NAME}, nothing stored, ${what}. The folder stays until you remove it; delete these folders by hand: ${folders(s.root)}`), `${what} ${s.log.join('|')}`);
  }
});
