// worktreeMain (hooks/lib/worktree-main.mjs) must confirm the back link when the pointer files name the
// tree by its Windows 8.3 short path (CI temp dirs such as C:\Users\RUNNER~1\...) while cwd resolves long.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { worktreeMain } from '../hooks/lib/worktree-main.mjs';
import { mainRoot } from '../hooks/lib/cap-effects.mjs';

// A complete fake linked worktree; `gitdirText` is what the pointer file says, `back`/`common` the links.
function fakeTree(base, { gitdirText, back, common } = {}) {
  const main0 = fs.mkdtempSync(path.join(base, 'm-'));
  const wt = fs.mkdtempSync(path.join(base, 'w-'));
  const gitdir = path.join(main0, '.git', 'worktrees', 'wt');
  fs.mkdirSync(gitdir, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gitdirText ? gitdirText(gitdir) : gitdir}\n`);
  fs.writeFileSync(path.join(gitdir, 'gitdir'), `${back ?? path.join(wt, '.git')}\n`);
  fs.writeFileSync(path.join(gitdir, 'commondir'), `${common ?? '../..'}\n`);
  return { main0, wt, gitdir };
}

test('worktreeMain confirms a well-formed fake tree (control)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-ok-'));
  try {
    const { main0, wt } = fakeTree(base);
    assert.equal(fs.realpathSync.native(worktreeMain(wt)), fs.realpathSync.native(main0));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('worktreeMain refuses a gitdir that is UNC or device-prefixed, without touching it', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-unc-'));
  try {
    // Valid tree, correct back link and commondir: only the REMOTE guard can make these null.
    const forms = [
      (g) => `\\\\?\\${g}`,
      (g) => `\\\\.\\${g}`,
      (g) => `//?/${g.replace(/\\/g, '/')}`,
    ];
    for (const gitdirText of forms) {
      const { wt, gitdir } = fakeTree(base, { gitdirText });
      const seen = [];
      const orig = fs.lstatSync;
      fs.lstatSync = (p, ...r) => { seen.push(String(p)); return orig(p, ...r); };
      try { assert.equal(worktreeMain(wt), null, gitdirText(gitdir)); } finally { fs.lstatSync = orig; }
      assert.deepEqual(seen.filter((p) => /^[\\/]{2}/.test(p)), [], 'fs touched a UNC/device path');
    }
    for (const bad of ['\\\\host\\share\\main\\.git\\worktrees\\wt', '//host/share/main/.git/worktrees/wt']) {
      const wt = fs.mkdtempSync(path.join(base, 'w-'));
      fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${bad}\n`);
      assert.equal(worktreeMain(wt), null, bad);
    }
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('worktreeMain refuses when the back link or commondir cannot be resolved', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-null-'));
  try {
    for (const opt of [{ back: 'x\u0000y' }, { common: 'x\u0000y' }, { back: 'x\u0000y', common: 'x\u0000y' }, { back: 'elsewhere/.git' }]) {
      const { wt } = fakeTree(base, opt);
      assert.equal(worktreeMain(wt), null, JSON.stringify(opt));
    }
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('mainRoot follows a confirmed pointer but not a UNC/device gitdir', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-root-'));
  try {
    const ok = fakeTree(base);
    fs.mkdirSync(path.join(ok.main0, '.company', 'work'), { recursive: true });
    assert.equal(fs.realpathSync.native(mainRoot(ok.wt)), fs.realpathSync.native(ok.main0));
    const dev = fakeTree(base, { gitdirText: (g) => `\\\\?\\${g}` });
    fs.mkdirSync(path.join(dev.main0, '.company', 'work'), { recursive: true });
    assert.equal(mainRoot(dev.wt), dev.wt);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

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
