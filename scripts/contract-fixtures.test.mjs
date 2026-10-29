import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadGolden, headerVersion, FIXTURE_ROOT_ENV } from './contract-fixtures.mjs';
import { buildIndex } from './contract-drift.mjs';

const REPO = path.resolve(import.meta.dirname, '..');
const SELF = path.basename(import.meta.filename);
const FIXTURES = path.join(REPO, 'tests', 'contracts');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fixtures-'));
  dirs.push(d);
  return d;
};

function repo({ header = '1.1', stamp = '1.1', files = {} } = {}) {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs', 'contracts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'contracts', 'alpha'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'contracts', 'alpha.md'), `# Contract: alpha v${header}\n\nBody.\n`);
  if (stamp !== null) fs.writeFileSync(path.join(root, 'tests', 'contracts', 'alpha', 'version.txt'), `${stamp}\n`);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, 'tests', 'contracts', 'alpha', name), text);
  return root;
}

const fixtureNames = () => fs.readdirSync(FIXTURES, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();

// Consumers: test files that load a Contract's fixtures by name.
function consumers() {
  const out = new Map();
  for (const f of fs.readdirSync(path.join(REPO, 'scripts')).filter(n => n.endsWith('.test.mjs') && n !== SELF).sort()) {
    const text = fs.readFileSync(path.join(REPO, 'scripts', f), 'utf8');
    for (const m of text.matchAll(/loadGolden\(\s*'([a-z][a-z0-9-]*)'/g)) {
      if (!out.has(m[1])) out.set(m[1], new Set());
      out.get(m[1]).add(f);
    }
  }
  return out;
}

describe('loadGolden', () => {
  test('reads text and JSON when version.txt equals the header', () => {
    const root = repo({ files: { 'a.txt': 'hello\n', 'b.json': '{"x":1}' } });
    const g = loadGolden('alpha', { root });
    assert.equal(g.version, '1.1');
    assert.equal(g.text('a.txt'), 'hello\n');
    assert.deepEqual(g.json('b.json'), { x: 1 });
  });

  test('a missing minor means minor 0 on both sides', () => {
    assert.equal(loadGolden('alpha', { root: repo({ header: '2', stamp: '2.0' }) }).version, '2.0');
    assert.equal(loadGolden('alpha', { root: repo({ header: '2.0', stamp: '2' }) }).version, '2.0');
  });

  test('a stamp older than the header throws, naming the Contract and both versions', () => {
    assert.throws(() => loadGolden('alpha', { root: repo({ header: '1.2', stamp: '1.1' }) }),
      /fixtures for alpha are stamped v1\.1, the Contract header is v1\.2/);
  });

  test('a stamp newer than the header, or another major, throws', () => {
    assert.throws(() => loadGolden('alpha', { root: repo({ header: '1.1', stamp: '1.2' }) }), /stamped v1\.2/);
    assert.throws(() => loadGolden('alpha', { root: repo({ header: '4.0', stamp: '3.7' }) }), /stamped v3\.7, the Contract header is v4\.0/);
  });

  test('a missing, empty or malformed version.txt throws', () => {
    assert.throws(() => loadGolden('alpha', { root: repo({ stamp: null }) }), /version\.txt is missing/);
    for (const bad of ['', 'v1.1', '1.1.1', '1.', 'latest', '1.1 # note']) {
      assert.throws(() => loadGolden('alpha', { root: repo({ stamp: bad }) }), /not a version/, JSON.stringify(bad));
    }
  });

  test('a Contract with no header line 1, or no file, throws', () => {
    const root = repo();
    fs.writeFileSync(path.join(root, 'docs', 'contracts', 'alpha.md'), 'No header\n');
    assert.throws(() => loadGolden('alpha', { root }), /no header on line 1/);
    assert.throws(() => loadGolden('beta', { root }), /Contract beta is missing/);
  });

  test('a Contract name is an allow-listed slug, never a path', () => {
    const root = repo();
    for (const bad of ['../alpha', 'a/b', 'Alpha', '', 'alpha.md', 'alpha\0', '-alpha']) {
      assert.throws(() => loadGolden(bad, { root }), /bad Contract name/, JSON.stringify(bad));
    }
  });

  test('a fixture name is an allow-listed file name; version.txt is not data', () => {
    const g = loadGolden('alpha', { root: repo() });
    for (const bad of ['../x', 'a/b', '..', '.hidden', '', 'a b', 'version.txt', 'x\0y']) {
      assert.throws(() => g.text(bad), /bad fixture name/, JSON.stringify(bad));
    }
    assert.throws(() => g.text('nope.txt'), /nope\.txt is missing/);
  });

  test('a fixture that is a folder, or over the size cap, is refused', () => {
    const root = repo({ files: { 'big.txt': 'x'.repeat(1_000_001) } });
    fs.mkdirSync(path.join(root, 'tests', 'contracts', 'alpha', 'sub'));
    const g = loadGolden('alpha', { root });
    assert.throws(() => g.text('sub'), /not a plain file/);
    assert.throws(() => g.text('big.txt'), /over 1000000 bytes/);
  });

  test('bad JSON throws and fixtures are never run as code', () => {
    const root = repo({ files: { 'bad.json': '{nope', 'evil.mjs': 'throw new Error("ran")\n' } });
    const g = loadGolden('alpha', { root });
    assert.throws(() => g.json('bad.json'), SyntaxError);
    assert.equal(g.text('evil.mjs'), 'throw new Error("ran")\n');
  });

  test('the fixture root can come from the environment', () => {
    const root = repo({ header: '1.5', stamp: '1.4' });
    const before = process.env[FIXTURE_ROOT_ENV];
    process.env[FIXTURE_ROOT_ENV] = root;
    try {
      assert.equal(headerVersion('alpha'), '1.5');
      assert.throws(() => loadGolden('alpha'), /stamped v1\.4, the Contract header is v1\.5/);
    } finally {
      if (before === undefined) delete process.env[FIXTURE_ROOT_ENV];
      else process.env[FIXTURE_ROOT_ENV] = before;
    }
  });
});

describe('the committed fixtures', () => {
  test('every fixture folder is stamped with its current Contract header version', () => {
    const index = buildIndex(REPO);
    assert.ok(fixtureNames().length >= 2);
    for (const name of fixtureNames()) {
      assert.ok(index.has(name), `${name} has a Contract`);
      assert.doesNotThrow(() => loadGolden(name), name);
    }
  });

  test('Core Contracts have fixtures: handoff and dispatch-prompt', () => {
    for (const name of ['handoff', 'dispatch-prompt']) assert.ok(fixtureNames().includes(name), name);
  });

  test('fixture files are LF only, hold no display names and no Name line', () => {
    for (const name of fixtureNames()) {
      for (const f of fs.readdirSync(path.join(FIXTURES, name))) {
        const abs = path.join(FIXTURES, name, f);
        assert.ok(fs.lstatSync(abs).isFile(), `${name}/${f} is a plain file`);
        const text = fs.readFileSync(abs, 'utf8');
        assert.ok(!text.includes('\r'), `${name}/${f}: CR byte`);
        assert.ok(!/^Name:/m.test(text), `${name}/${f}: Name: line`);
        assert.ok(!/^By: .*\(/m.test(text), `${name}/${f}: By: line holds a display name`);
      }
    }
  });

  test('version.txt holds one version line and nothing else', () => {
    for (const name of fixtureNames()) {
      assert.match(fs.readFileSync(path.join(FIXTURES, name, 'version.txt'), 'utf8'), /^\d+(?:\.\d+)?\n$/, name);
    }
  });
});

describe('AC17 a Contract bump fails every consumer suite at once', () => {
  const found = consumers();

  test('every fixture folder has at least one consumer test file', () => {
    for (const name of fixtureNames()) assert.ok(found.get(name)?.size > 0, `no test file loads the ${name} fixtures`);
    assert.ok(found.get('handoff').has('golden.test.mjs'));
    assert.ok(found.get('dispatch-prompt').has('prompt-order.test.mjs'));
  });

  // The runner marks its children with NODE_TEST_CONTEXT; a nested run must not inherit it or it reports to the parent.
  function runConsumer(file, root) {
    const env = { ...process.env, [FIXTURE_ROOT_ENV]: root };
    delete env.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, ['--test', path.join(REPO, 'scripts', file)], {
      cwd: REPO, encoding: 'utf8', timeout: 120_000, env,
    });
  }

  function copyOf(contract, header) {
    const root = tmp();
    fs.cpSync(path.join(REPO, 'docs', 'contracts'), path.join(root, 'docs', 'contracts'), { recursive: true });
    fs.cpSync(FIXTURES, path.join(root, 'tests', 'contracts'), { recursive: true });
    if (header) {
      const file = path.join(root, 'docs', 'contracts', `${contract}.md`);
      const text = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, text.replace(/^# Contract: ([a-z-]+) v\S+/, `# Contract: $1 v${header}`));
    }
    return root;
  }

  for (const name of ['handoff', 'dispatch-prompt']) {
    test(`${name}: with matching stamps the consumers pass`, () => {
      const root = copyOf(name);
      for (const f of found.get(name)) {
        const r = runConsumer(f, root);
        assert.equal(r.status, 0, `${f}\n${r.stdout.slice(-800)}`);
      }
    });

    test(`${name}: a bumped header fails each consumer, naming the Contract and both versions`, () => {
      const current = headerVersion(name);
      const [major, minor] = current.split('.').map(Number);
      const bumped = `${major}.${minor + 1}`;
      const root = copyOf(name, bumped);
      assert.ok(found.get(name).size > 0);
      for (const f of found.get(name)) {
        const r = runConsumer(f, root);
        assert.notEqual(r.status, 0, `${f} still passes after the ${name} bump`);
        const out = `${r.stdout}${r.stderr}`;
        assert.ok(out.includes(`fixtures for ${name} are stamped v${current}, the Contract header is v${bumped}`), `${f}: ${out.slice(0, 600)}`);
      }
    });

    test(`${name}: a fixture stamped with the old major fails each consumer`, () => {
      const current = headerVersion(name);
      const root = copyOf(name);
      fs.writeFileSync(path.join(root, 'tests', 'contracts', name, 'version.txt'), '0.9\n');
      for (const f of found.get(name)) {
        const r = runConsumer(f, root);
        assert.notEqual(r.status, 0, `${f} still passes with a v0.9 stamp`);
        assert.ok(`${r.stdout}${r.stderr}`.includes(`stamped v0.9, the Contract header is v${current}`), f);
      }
    });
  }

  test('a bump of one Contract leaves the consumers of another Contract passing', () => {
    const root = copyOf('handoff', '1.9');
    const r = runConsumer('prompt-order.test.mjs', root);
    assert.equal(r.status, 0, r.stdout.slice(-800));
  });
});
