import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { guardRunActive, parseOutputLine, parseOutputText, workFolder } from '../mods/lib/guard.mjs';
import { parseGateCommand, recordPath } from '../mods/lib/plan-gate.mjs';

const NAME = '2026-10-30 23.45 - Fix Login';
const HELPER = '2026-10-30 23.45 - Fix Login Build';
const LEGACY = 'run-one';
const ROOT = 'C:/plugins/aico/0.24.0';
const STATE = `node ${ROOT}/scripts/run-state.mjs gate`;
const RUN = `node ${ROOT}/scripts/run.mjs run-state gate`;
const SHA = 'a'.repeat(40);

// One broken name per forbidden character class, each built on a valid name.
const BAD = {
  'a double dot': '2026-10-30 23.45 - Fix..Login',
  'a forward slash': '2026-10-30 23.45 - Fix/Login',
  'a backslash': '2026-10-30 23.45 - Fix\\Login',
  'a quote': "2026-10-30 23.45 - Fix'Login",
  'a dollar sign': '2026-10-30 23.45 - Fix$Login',
  'a backtick': '2026-10-30 23.45 - Fix`Login',
  'a trailing dot': '2026-10-30 23.45 - Fix Login.'
};
const BAD_LIST = Object.entries(BAD);

describe('Output line, every mod reads it through guard.mjs', () => {
  test('a new name, a helper name and a legacy slug are read', () => {
    assert.deepEqual(parseOutputLine(`Output: .company/work/${NAME}/07-backend-engineer.md`), { slug: NAME, step: '07', role: 'backend-engineer' });
    assert.equal(parseOutputLine(`Output: .company/work/${HELPER}/01-product-manager.md`).slug, HELPER);
    assert.equal(parseOutputLine(`Output: .company/work/${LEGACY}/12-qa.md`).slug, LEGACY);
  });

  test('a dispatch text gives its first valid Output line, CRLF included', () => {
    const text = `Name: Lynn\r\nOutput: .company/work/${NAME}/05-qa.md\r\nGoal: x\r\n`;
    assert.deepEqual(parseOutputText(text), { slug: NAME, step: '05', role: 'qa' });
    assert.equal(parseOutputText(`Output: .company/work/${LEGACY}/05-qa.md\n`).slug, LEGACY);
  });

  for (const [what, bad] of BAD_LIST) {
    test(`a folder with ${what} is not read`, () => {
      assert.equal(parseOutputLine(`Output: .company/work/${bad}/07-qa.md`), null);
      assert.equal(parseOutputText(`Goal: x\nOutput: .company/work/${bad}/07-qa.md\n`), null);
    });
  }

  test('other bad shapes are not read', () => {
    const bad = [
      `Output: .company/work/${NAME}/../07-qa.md`,
      `Output: .company/work/${NAME}/x/07-qa.md`,
      `Output: .company/work/${NAME}/07-qa.md/`,
      `Output: .company/work/${NAME}/07-qa.md `,
      ` Output: .company/work/${NAME}/07-qa.md`,
      `Output: ./.company/work/${NAME}/07-qa.md`,
      `Output: .company/work/2026-10-30 23.45 - fix login/07-qa.md`,
      `Output: .company/work/2026-10-30 23.45 -  Fix Login/07-qa.md`,
      `Output: .company/work/2026-10-30 23.45 - Fix\tLogin/07-qa.md`,
      `Output: .company/work/2026-10-30 23.45 - Fix\u0000Login/07-qa.md`,
      `Output: .company/work/Bad_Slug/07-qa.md`,
      `Output: .company/work//07-qa.md`,
      `Output: .company/work/${NAME}/7-qa.md`,
      `Output: .company/work/${NAME}/07-QA.md`
    ];
    for (const line of bad) assert.equal(parseOutputLine(line), null, JSON.stringify(line));
    assert.equal(parseOutputText(null), null);
    assert.equal(parseOutputText(`Output: .company/work/${NAME}/07-qa.md\u2028`), null);
  });

  test('a long folder part or a long line is cut before any pattern runs', () => {
    const long = `${'x'.repeat(5000)}`;
    assert.equal(parseOutputLine(`Output: .company/work/${long}/07-qa.md`), null);
    assert.equal(parseOutputLine(`Output: .company/work/${'a'.repeat(200)}/07-qa.md`), null);
    const started = Date.now();
    assert.equal(parseOutputText(`Output: .company/work/${NAME}/07-qa.md${'z'.repeat(10_000_000)}`), null);
    assert.equal(parseOutputText(`${'\n'.repeat(5_000_000)}Output: .company/work/${NAME}/07-qa.md`), null);
    assert.ok(Date.now() - started < 2000);
  });
});

describe('workFolder guard and the run view', () => {
  test('names pass, forbidden-character names and wrong types do not', () => {
    assert.equal(workFolder(NAME), NAME);
    assert.equal(workFolder(LEGACY), LEGACY);
    for (const [, bad] of BAD_LIST) assert.equal(workFolder(bad), undefined, bad);
    for (const v of [null, undefined, 5, {}, [], '', 'x'.repeat(121)]) assert.equal(workFolder(v), undefined);
  });

  test('the active run answer takes a new name and refuses a forbidden-character name', () => {
    assert.equal(guardRunActive({ slug: NAME, view: null }).slug, NAME);
    assert.equal(guardRunActive({ slug: LEGACY, view: null }).slug, LEGACY);
    assert.equal(guardRunActive({ slug: null, view: null }).slug, null);
    for (const [, bad] of BAD_LIST) assert.equal(guardRunActive({ slug: bad, view: null }), undefined, bad);
  });

  test('a run view with a new name is kept and one with a forbidden-character name is refused', () => {
    const view = (slug) => ({
      v: 1, slug, state: 'running', started: '2026-10-30T22:45:00Z', ended: null, outcome: null, wave: 1, gates: [], round: 0, tier: 'high', steps: [], warnings: []
    });
    assert.equal(guardRunActive({ slug: NAME, view: view(NAME) }).view.slug, NAME);
    for (const [, bad] of BAD_LIST) assert.equal(guardRunActive({ slug: NAME, view: view(bad) }), undefined, bad);
  });
});

describe('plan Gate command', () => {
  test('both quoted forms are judged with the name', () => {
    assert.equal(parseGateCommand(`${STATE} '${NAME}' plan passed`), NAME);
    assert.equal(parseGateCommand(`${RUN} '${NAME}' plan passed`), NAME);
    assert.equal(parseGateCommand(`${RUN} '${HELPER}' plan passed`), HELPER);
    assert.equal(parseGateCommand(`node scripts/run-state.mjs gate '${NAME}' plan passed`), NAME);
    assert.equal(parseGateCommand(`node C:\\p\\aico\\scripts\\run.mjs run-state gate '${NAME}' plan passed`), NAME);
  });

  test('a quoted legacy slug is judged', () => {
    assert.equal(parseGateCommand(`${STATE} '${LEGACY}' plan passed`), LEGACY);
    assert.equal(parseGateCommand(`${RUN} '${LEGACY}' plan passed`), LEGACY);
  });

  test('the old unquoted forms with a legacy slug are still judged', () => {
    assert.equal(parseGateCommand(`${STATE} ${LEGACY} plan passed`), LEGACY);
    assert.equal(parseGateCommand(`${RUN} ${LEGACY} plan passed`), LEGACY);
  });

  test('the same new name unquoted is not judged', () => {
    assert.equal(parseGateCommand(`${STATE} ${NAME} plan passed`), null);
    assert.equal(parseGateCommand(`${RUN} ${NAME} plan passed`), null);
  });

  test('the new name double-quoted or in other quote marks is not judged', () => {
    assert.equal(parseGateCommand(`${STATE} "${NAME}" plan passed`), null);
    assert.equal(parseGateCommand(`${RUN} "${NAME}" plan passed`), null);
    assert.equal(parseGateCommand(`${RUN} \`${NAME}\` plan passed`), null);
    assert.equal(parseGateCommand(`${RUN} \u2018${NAME}\u2019 plan passed`), null);
    assert.equal(parseGateCommand(`${RUN} $'${NAME}' plan passed`), null);
    assert.equal(parseGateCommand(`${RUN} '${NAME}" plan passed`), null);
    assert.equal(parseGateCommand(`${RUN} '${NAME} plan passed`), null);
    assert.equal(parseGateCommand(`${RUN} ${NAME}' plan passed`), null);
  });

  for (const [what, bad] of BAD_LIST) {
    test(`a quoted name with ${what} is not judged`, () => {
      assert.equal(parseGateCommand(`${STATE} '${bad}' plan passed`), null);
      assert.equal(parseGateCommand(`${RUN} '${bad}' plan passed`), null);
    });
  }

  test('a second quoted token, a stray quote or text after the quote is not judged', () => {
    const forged = [
      `${RUN} '${NAME}' '${NAME}' plan passed`,
      `${RUN} '${NAME}' 'x' plan passed`,
      `${RUN} '${NAME}' x plan passed`,
      `${RUN} '${NAME}' plan passed 'x'`,
      `${RUN} '${NAME}' plan passed x`,
      `${RUN} '${NAME}' plan passed plan passed`,
      `${RUN} '${NAME}'plan passed`,
      `${RUN} '${NAME}'  plan passed`,
      `${RUN} ' ${NAME}' plan passed`,
      `${RUN} '${NAME} ' plan passed`,
      `${RUN} '${NAME}'' plan passed`,
      `${RUN} ''${NAME}'' plan passed`,
      `${RUN} '2026-10-30 23.45 - Fix' Login' plan passed`,
      `${RUN} '2026-10-30 23.45 - Fix Login' && echo x' plan passed`,
      `${RUN} '${NAME}' plan passed ; x`,
      `${RUN} '${NAME}' plan passed\n`,
      `${RUN} '${NAME}' plan passed `,
      `${RUN} '${NAME}'\nplan passed`,
      `${RUN} ''  plan passed`,
      `${RUN} '' plan passed`,
      `${RUN} ' plan passed`,
      `${RUN} '$(touch x)' plan passed`,
      `${RUN} '\`x\`' plan passed`,
      `${RUN} '${NAME}'\tplan passed`,
      `${RUN} '${NAME.toLowerCase()}' plan passed`,
      `${RUN} '${NAME}' plan changed`,
      `${RUN} '${NAME}' brief passed`,
      `node ${ROOT}/scripts/run.mjs run-state gate '${NAME}'`,
      `node ${ROOT}/scripts/other.mjs gate '${NAME}' plan passed`,
      `node ${ROOT}/scripts/run-state.mjs run-state gate '${NAME}' plan passed`,
      `node ${ROOT}/scripts/run.mjs gate '${NAME}' plan passed`,
      `node  ${ROOT}/scripts/run-state.mjs gate '${NAME}' plan passed`,
      `${STATE}  '${NAME}' plan passed`,
      `${STATE}\t'${NAME}' plan passed`,
      ` ${STATE} '${NAME}' plan passed`,
      `FOO=1 ${STATE} '${NAME}' plan passed`,
      `${STATE} '${NAME}' plan passed && x`,
      `${STATE} '${NAME}' plan passed | x`,
      `${STATE} '${NAME}' plan passed > x`,
      `node "${ROOT}/scripts/run-state.mjs" gate '${NAME}' plan passed`,
      `node -r x ${ROOT}/scripts/run-state.mjs gate '${NAME}' plan passed`
    ];
    for (const command of forged) assert.equal(parseGateCommand(command), null, JSON.stringify(command));
  });

  test('look-alike gate lines inside a longer command are not judged', () => {
    const line = `${RUN} '${NAME}' plan passed`;
    for (const command of [`echo ${line}`, `x; ${line}`, `(${line})`, `bash -c "${line}"`, `echo "${line}"`, `${line.slice(5)}`, `nodex ${line.slice(5)}`]) {
      assert.equal(parseGateCommand(command), null, command);
    }
  });

  test('an oversize command and wrong types are not judged and the work stays linear', () => {
    assert.equal(parseGateCommand(`${RUN} '${'a'.repeat(5000)}' plan passed`), null);
    assert.equal(parseGateCommand(`node ${'/'.repeat(4100)}scripts/run-state.mjs gate '${NAME}' plan passed`), null);
    assert.equal(parseGateCommand(`${RUN} '${' '.repeat(4000)}' plan passed`), null);
    assert.equal(parseGateCommand("node ' ".repeat(500)), null);
    for (const v of [null, undefined, 5, {}, ['node']]) assert.equal(parseGateCommand(v), null);
  });
});

describe('plan Gate record path', () => {
  test('a record under a new name or a legacy slug gives its name', () => {
    assert.deepEqual(recordPath(`/w/.company/work/${NAME}/run-state.jsonl`), { slug: NAME });
    assert.deepEqual(recordPath(`C:\\w\\.company\\work\\${NAME}\\run-state.jsonl`), { slug: NAME });
    assert.deepEqual(recordPath(`.company/work/${NAME}/run-state.jsonl`), { slug: NAME });
    assert.deepEqual(recordPath(`/w/.company/work/${NAME}/RUN-STATE.JSONL.`), { slug: NAME });
    assert.deepEqual(recordPath(`/w/.company/work/${LEGACY}/run-state.jsonl`), { slug: LEGACY });
  });

  for (const [what, bad] of BAD_LIST) {
    test(`a record folder with ${what} is a record path with no name`, () => {
      const got = recordPath(`/w/.company/work/${bad.replaceAll('/', '_')}/run-state.jsonl`);
      // A backslash reads as a slash, so that path has an extra folder and is no record at all.
      assert.deepEqual(got, bad.includes('\\') ? null : { slug: null });
    });
  }

  test('a folder name in the wrong case has no name; a plain file is no record', () => {
    assert.deepEqual(recordPath('/w/.company/work/2026-10-30 23.45 - fix login/run-state.jsonl'), { slug: null });
    assert.equal(recordPath(`/w/.company/work/${NAME}/02-plan.md`), null);
    assert.equal(recordPath(`/w/.company/work/${NAME}/x/run-state.jsonl`), null);
    assert.equal(recordPath(`/w/.company/work/${NAME}/run-state.jsonl.bak`), null);
  });
});

describe('reflect script takes a work folder name', () => {
  const reflect = path.join(import.meta.dirname, 'reflect.mjs');

  function sandbox(t, folder) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mods-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const home = path.join(dir, 'home');
    fs.mkdirSync(home);
    const work = path.join(dir, '.company', 'work', folder);
    fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(path.join(work, '05-backend-engineer.md'), ['---', 'step: 05', 'role: backend-engineer', 'task: demo', 'status: done', 'round: 0', 'base-commit: abc1234', 'risk-tier: medium', '---', 'By: Test (backend-engineer)', '## Did', '- did something', '## Blocking', '- none', '## Next', '- next', ''].join('\n'));
    return dir;
  }

  function run(dir, args) {
    const r = spawnSync(process.execPath, [reflect, ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: path.join(dir, 'home'), USERPROFILE: path.join(dir, 'home'), MCSPARROW_HOME: path.join(dir, 'home') }
    });
    return { status: r.status, out: r.stdout, err: r.stderr };
  }

  test('retro and step work on a folder with a new name', (t) => {
    const dir = sandbox(t, NAME);
    const retro = run(dir, ['retro', NAME, '--json']);
    assert.equal(retro.status, 0, retro.err);
    assert.equal(JSON.parse(retro.out).slug, NAME);
    const check = run(dir, ['step', NAME, '05-backend-engineer.md', '--json']);
    assert.equal(check.status, 0, check.err);
    assert.match(check.out, /"step"/);
  });

  test('a legacy folder still works', (t) => {
    const dir = sandbox(t, LEGACY);
    const retro = run(dir, ['retro', LEGACY, '--json']);
    assert.equal(retro.status, 0, retro.err);
    assert.equal(JSON.parse(retro.out).slug, LEGACY);
  });

  test('a name that is a work folder but has no folder is refused', (t) => {
    const dir = sandbox(t, LEGACY);
    const r = run(dir, ['retro', NAME, '--json']);
    assert.equal(r.status, 2);
    assert.match(r.out, /^refused: no run folder/);
  });

  for (const [what, bad] of [...BAD_LIST, ['an empty name', ''], ['a lower-case new name', NAME.toLowerCase()]]) {
    test(`a name with ${what} is refused for retro and step`, (t) => {
      const dir = sandbox(t, NAME);
      const retro = run(dir, ['retro', bad, '--json']);
      assert.equal(retro.status, 2, retro.out);
      assert.match(retro.out, /^refused: /);
      const check = run(dir, ['step', bad, '05-backend-engineer.md', '--json']);
      assert.equal(check.status, 2, check.out);
      assert.match(check.out, /^refused: /);
    });
  }
});

describe('one copy of the name rule', () => {
  const root = path.join(import.meta.dirname, '..');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const OLD = '[a-z0-9][a-z0-9-]{0,63}';

  test('no file of the task repeats the old run name pattern', () => {
    for (const file of ['mods/lib/guard.mjs', 'mods/savvy.tsx', 'mods/reflect.tsx', 'mods/cache-tax.tsx', 'scripts/reflect.mjs']) {
      assert.ok(!read(file).includes(OLD), file);
    }
    // plan-gate judges the unquoted legacy form through isLegacySlug, so it holds no copy either.
    assert.ok(!read('mods/lib/plan-gate.mjs').includes(OLD));
  });

  test('the mods read an Output line and a run name through the shared parsers', () => {
    for (const file of ['mods/savvy.tsx', 'mods/reflect.tsx', 'mods/cache-tax.tsx']) assert.match(read(file), /parseOutputText/, file);
    assert.match(read('mods/reflect.tsx'), /slug: workFolder/);
    assert.match(read('mods/cache-tax.tsx'), /run: workFolder/);
    assert.match(read('mods/lib/plan-gate.mjs'), /workParts/); // plan-gate moved from isWorkFolder to workParts in 25da620
    assert.match(read('scripts/reflect.mjs'), /isRunSlug/);
  });

  test('mod code imports no Node module and no npm package', () => {
    for (const file of ['mods/lib/guard.mjs', 'mods/lib/plan-gate.mjs', 'mods/lib/work-folder.mjs']) {
      const imports = read(file).split('\n').filter((l) => /^import /.test(l));
      for (const line of imports) assert.match(line, /from '\.\//, `${file}: ${line}`);
    }
  });

  test('the files have no CR byte', () => {
    for (const file of ['mods/lib/guard.mjs', 'mods/lib/plan-gate.mjs', 'mods/savvy.tsx', 'mods/reflect.tsx', 'mods/cache-tax.tsx', 'scripts/reflect.mjs', 'docs/contracts/aico-mods.md', 'docs/contracts/reflect.md', 'docs/contracts/plugin-root.md', 'scripts/work-folder-mods.test.mjs']) {
      assert.ok(!read(file).includes('\r'), file);
    }
  });

  test('the contracts state the new versions and the quoted gate form', () => {
    assert.match(read('docs/contracts/aico-mods.md'), /^# Contract: aico-mods v2\.1$/m);
    assert.match(read('docs/contracts/reflect.md'), /^# Contract: reflect v1\.4$/m);
    assert.match(read('docs/contracts/plugin-root.md'), /^# Contract: plugin-root v1\.1$/m);
    assert.match(read('docs/contracts/aico-mods.md'), /gate '<name>' plan passed/);
    assert.match(read('docs/contracts/plugin-root.md'), /gate '<name>' plan passed/);
  });
});
