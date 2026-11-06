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

function setup(t, { entries = [entry()], lists = { qa: ['user', [NAME]] }, scan = {}, install, moved = false } = {}) {
  const home = tmp(t, 'home');
  const root = tmp(t, 'root');
  if (entries.length) writeUser(home, entries);
  const bodyHash = (dir) => plant(dir);
  const scanDir = tmp(t, 'scan');
  const scanHash = bodyHash(scanDir);
  const log = [];
  const calls = [];
  const vets = [];
  const env = {
    home, productRoot: root, today: TODAY, log: (x) => log.push(x),
    settings: settingsFor(lists, moved),
    vet: async (arg) => { vets.push(arg); return scan.value ?? { commit: COMMIT, hash: scanHash, result: { verdict: 'pass', counts: { critical: 0, high: 0 } }, ...scan }; },
    exec: (cmd, cwd, argv) => {
      calls.push({ cmd, cwd, argv });
      if (install) install({ cmd, cwd, argv, home, root });
      else {
        const dir = argv.includes('-g') ? path.join(home, '.claude', 'skills', NAME) : path.join(root, '.agents', 'skills', NAME);
        plant(dir);
      }
    },
  };
  return { home, root, env, log, calls, vets, scanHash };
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
  const lines = s.log.filter((l) => l.includes(' | '));
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
