import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');

test('the repo ignores the tsconfig.json the host writes into the plugin root, so scoring never lists it', () => {
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\/tsconfig\.json$/m);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-ign-'));
  try {
    const git = (...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8' });
    git('init', '-q');
    fs.copyFileSync(path.join(root, '.gitignore'), path.join(d, '.gitignore'));
    fs.writeFileSync(path.join(d, 'tsconfig.json'), '{}\n');
    fs.mkdirSync(path.join(d, 'sub'));
    fs.writeFileSync(path.join(d, 'sub', 'tsconfig.json'), '{}\n');
    const listed = git('ls-files', '--others', '--exclude-standard').stdout.split('\n');
    assert.ok(!listed.includes('tsconfig.json'));
    assert.ok(listed.includes('sub/tsconfig.json'));
    const review = spawnSync(process.execPath, [path.join(root, 'scripts', 'review-depth.mjs'), '--worktree', '--json'], { cwd: d, encoding: 'utf8' });
    const paths = JSON.parse(review.stdout).paths.map((p) => p.path);
    assert.ok(paths.includes('sub/tsconfig.json'));
    assert.ok(!paths.includes('tsconfig.json'));
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
