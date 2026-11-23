// worktreeMain (hooks/lib/event.mjs) must confirm the back link when the pointer files name the
// tree by its Windows 8.3 short path (CI temp dirs such as C:\Users\RUNNER~1\...) while cwd resolves long.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { worktreeMain } from '../hooks/lib/event.mjs';

function shortOf(p) {
  const r = spawnSync('cmd', ['/d', '/c', `for %I in ("${p}") do @echo %~sI`], { encoding: 'utf8', windowsVerbatimArguments: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

test('worktreeMain confirms a linked worktree whose pointer files use 8.3 short paths', { skip: process.platform !== 'win32' && 'Windows only' }, (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'Worktree Long Name-'));
  try {
    const main0 = path.join(base, 'product-with-long-name');
    const wt = path.join(base, 'worktree-with-long-name');
    fs.mkdirSync(path.join(main0, '.git', 'worktrees', 'wt'), { recursive: true });
    fs.mkdirSync(wt);
    const sMain = shortOf(main0);
    const sWt = shortOf(wt);
    if (!(sMain && sWt && sMain !== main0)) return t.skip('8.3 short names unavailable on this volume');
    const gitdir = path.join(sMain, '.git', 'worktrees', 'wt');
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gitdir}\n`);
    fs.writeFileSync(path.join(gitdir, 'gitdir'), `${path.join(sWt, '.git')}\n`);
    fs.writeFileSync(path.join(gitdir, 'commondir'), '../..\n');
    const got = worktreeMain(wt);
    assert.notEqual(got, null, 'worktreeMain returned null: back link compare is not case/short-name normalised');
    assert.equal(fs.realpathSync.native(got), fs.realpathSync.native(main0));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
