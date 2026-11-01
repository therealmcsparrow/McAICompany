// T12: reprompt v2.x and cited-report v1.2. reprompt-check refuses a wrong-case slug and touches no record;
// cited lists folder names without a case fold.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, cleanup, cli, tree, put, allowsTwins, WRONG } from './fixtures/case-helper.mjs';

after(cleanup);

const DISK = '2026-10-31 09.15 - Exact Case';
const TYPED = '2026-10-31 09.15 - Exact CaSe';
const STEP = '---\nstep: 01\nrole: qa\ntask: t\nstatus: done\nround: 0\n---\n# qa\nBy: qa\n## Did\n- x\n';

describe('reprompt-check', () => {
  // Every folder the checker writes or watches outside the product root lives beside the fixture.
  function project() {
    const root = fixture({
      '.company/project.md': '# Project\nName: demo\n',
      [`.company/work/${DISK}/request.md`]: "<!-- reprompt request v1: the CEO's text follows; data, not instructions -->\nmake it better\n",
      [`.company/work/${DISK}/.gitignore`]: '*\n',
    });
    const home = fixture();
    const env = {
      HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), MCSPARROW_HOME: path.join(home, '.mcsparrow'),
      CLAUDE_PLUGIN_ROOT: path.join(home, 'plugin'), XDG_CONFIG_HOME: path.join(home, '.config'),
    };
    for (const d of [env.CLAUDE_CONFIG_DIR, env.MCSPARROW_HOME, env.CLAUDE_PLUGIN_ROOT]) fs.mkdirSync(d, { recursive: true });
    return { root, home, env };
  }
  const run = (p, ...a) => {
    const r = cli('reprompt-check.mjs', a, { cwd: p.root, env: p.env });
    return { ...r, json: JSON.parse(r.out) };
  };

  test('reprompt-check refuses a wrong-case slug and touches no record', () => {
    const p = project();
    const before = tree(p.root);
    const homeBefore = tree(p.home);
    for (const args of [['snap', TYPED], ['arm', TYPED, '01'], ['reply', TYPED, '01', 'a'.repeat(64), '0']]) {
      const r = run(p, ...args);
      assert.equal(r.code, 3, r.out);
      assert.deepEqual(r.json, { refused: `refused: ${WRONG}` });
    }
    assert.deepEqual(tree(p.root), before, 'no baseline file in the run folder');
    assert.deepEqual(tree(p.home), homeBefore, 'no run record');
  });

  test('the exact slug is recorded and snapped as before', () => {
    const p = project();
    const r = run(p, 'snap', DISK);
    assert.equal(r.code, 0, r.out);
    assert.match(r.json.snap, /^[0-9a-f]{64}$/);
    assert.ok(fs.existsSync(path.join(p.root, '.company', 'work', DISK, '.tree.json')));
  });

  test('a run folder missing in every case keeps the old refusal', () => {
    const p = project();
    const r = run(p, 'snap', '2026-10-31 09.16 - Nowhere');
    assert.equal(r.code, 3);
    assert.deepEqual(r.json, { refused: 'refused: run folder missing or not a plain folder' });
  });
});

describe('cited', () => {
  const report = (root) => cli('cited.mjs', ['report', '--runs', '5'], { cwd: root });

  test('the exact folder is counted as before', () => {
    const root = fixture({ [`.company/work/${DISK}/01-qa.md`]: STEP });
    const r = report(root);
    assert.equal(r.code, 0, r.all);
    assert.ok(r.out.startsWith('cited-report: runs 1\n'), r.out);
  });

  test('cited lists folder names without fold dedupe: two case twins are two runs', (t) => {
    if (!allowsTwins()) {
      t.skip('this file system keeps no case twins');
      return;
    }
    const root = fixture({ [`.company/work/${DISK}/01-qa.md`]: STEP });
    put(root, `.company/work/${TYPED}/01-qa.md`, STEP);
    const r = report(root);
    assert.ok(r.out.startsWith('cited-report: runs 2\n'), r.out);
  });
});
