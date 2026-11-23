import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Type gating: the company-type script allows and refuses Playbooks and Roles by type.

const root = path.join(import.meta.dirname, '..');
const script = path.join(root, 'scripts', 'company-type.mjs');
const haveScript = fs.existsSync(script);

const SOFTWARE = ['audit', 'brainstorm', 'client', 'cooler', 'feature', 'feedback', 'fix', 'grill', 'incident',
  'launch', 'maintain', 'pentest', 'refactor', 'research', 'standards', 'to-spec', 'to-tickets', 'usability-test', 'vulnscan'];

test('software company allows exactly the 19 Playbooks (needs company-type.mjs)', { skip: !haveScript }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'type-gating-'));
  try {
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: home, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home } });
    for (const name of SOFTWARE) assert.equal(run('check-playbook', name).status, 0, name);
    for (const name of ['report', 'campaign', 'content', 'design']) {
      const r = run('check-playbook', name);
      assert.equal(r.status, 2, name);
      assert.match(r.stdout, /^refused: .* is not part of the software company; allowed: /);
      assert.ok(r.stdout.includes('feature'));
    }
    assert.equal(run('check-role', 'editor').status, 2);
    assert.equal(run('check-role', 'backend-engineer').status, 0);
    assert.match(run('check-playbook', 'fix').stdout, /^ok: fix is part of the software company\ncompany type: software \(Software company\), default: no company_type line\n/);
    assert.equal(JSON.parse(run('check-playbook', 'fix', '--json').stdout).id, 'software');
    assert.equal(run('pick', 'architect', 'product-manager').stdout, 'architect\n');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('grill in every type, to-spec and to-tickets software only', { skip: !haveScript }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'type-gating-'));
  try {
    const inType = (id) => {
      const cwd = fs.mkdtempSync(path.join(home, 'p-'));
      fs.mkdirSync(path.join(cwd, '.company'));
      fs.writeFileSync(path.join(cwd, '.company', 'project.md'), `company_type: ${id}\n`);
      return (...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, MCSPARROW_HOME: home } });
    };
    for (const bad of ['__proto__', 'constructor', 'nope', 'Software']) {
      const r = inType(bad)('check-playbook', 'grill');
      assert.equal(r.status, 2, bad);
      assert.ok(!r.stdout.startsWith('ok:'), bad);
    }
    for (const id of ['software', 'research', 'marketing', 'design']) {
      const r = inType(id)('check-playbook', 'grill');
      assert.equal(r.status, 0, id);
      assert.match(r.stdout, new RegExp(`^ok: grill is part of the ${id} company\n`));
    }
    for (const name of ['to-spec', 'to-tickets']) {
      assert.equal(inType('software')('check-playbook', name).status, 0, name);
      for (const id of ['research', 'marketing', 'design']) {
        const r = inType(id)('check-playbook', name);
        assert.equal(r.status, 2, `${id} ${name}`);
        assert.match(r.stdout, new RegExp(`^refused: ${name} is not part of the ${id} company; allowed: `));
        assert.ok(!/\ballowed:[^\n]*\bto-(spec|tickets)\b/.test(r.stdout), `${id} ${name}`);
      }
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
