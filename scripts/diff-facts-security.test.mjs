// diff-facts v1.1: the `security_changed` flag and the optional `security_paths` config key (plan task T17, tests T11).
// Red until T17 lands. Public interface only: `classify`, `readConfig`, and the `show` CLI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./diff-facts.mjs', import.meta.url));
const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 3 }); });

const load = () => import('./diff-facts.mjs');
const entry = (path, o = {}) => ({ path, from: null, status: 'M', added: 1, removed: 1, similarity: null, ...o });

const TRUE_PATHS = [
  '.github/workflows/ci.yml',
  'package.json',
  'yarn.lock',
  '.claude/settings.json',
  'hooks/x.mjs',
  'src/AuthService.ts',
  'scripts/run-guard.mjs',
  'diff-facts.config.json',
];

test('classify: every security trigger path sets security_changed true', async () => {
  const { classify } = await load();
  for (const p of TRUE_PATHS) {
    assert.equal(classify([entry(p)], null).security_changed, true, p);
  }
});

test('classify: one trigger among harmless paths still sets the flag', async () => {
  const { classify } = await load();
  const c = classify([entry('skills/x/SKILL.md'), entry('scripts/foo.mjs'), entry('yarn.lock')], null);
  assert.equal(c.security_changed, true);
});

test('classify: a skill text plus a plain script leaves security_changed false', async () => {
  const { classify } = await load();
  const c = classify([entry('skills/x/SKILL.md'), entry('scripts/foo.mjs')], null);
  assert.equal(c.security_changed, false);
});

test('classify: a truncated list is fail-safe true', async () => {
  const { classify } = await load();
  const many = Array.from({ length: 5001 }, (_, i) => entry(`scripts/f${String(i).padStart(5, '0')}.mjs`));
  const c = classify(many, null);
  assert.equal(c.truncated, true);
  assert.equal(c.security_changed, true);
});

test('classify: the flag is a boolean next to the old flags, which keep their values', async () => {
  const { classify } = await load();
  const c = classify([entry('docs/guide.md')], null);
  assert.equal(typeof c.security_changed, 'boolean');
  assert.equal(c.docs_only, true);
  assert.equal(c.contract_changed, false);
});

test('config: security_paths in diff-facts.config.json marks a matching path true', async () => {
  const { classify } = await load();
  const config = { v: 1, not_docs: [], security_paths: ['internal/billing/**'] };
  assert.equal(classify([entry('internal/billing/charge.go')], config).security_changed, true);
  assert.equal(classify([entry('internal/other/x.go')], config).security_changed, false);
});

test('config: security_paths can only set the flag true, never clear a built-in trigger', async () => {
  const { classify } = await load();
  const config = { v: 1, not_docs: [], security_paths: ['nothing/**'] };
  assert.equal(classify([entry('package.json')], config).security_changed, true);
  assert.equal(classify([entry('.github/workflows/ci.yml')], config).security_changed, true);
  assert.equal(classify([entry('skills/x/SKILL.md')], config).security_changed, false);
});

test('config: a config with security_paths is valid (not ignored, not_docs still honoured)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dfsec-cfg-'));
  roots.push(dir);
  writeFileSync(join(dir, 'diff-facts.config.json'), JSON.stringify({ v: 1, not_docs: ['docs/api/**'], security_paths: ['x/**'] }));
  const { readConfig } = await load();
  const r = readConfig(dir);
  assert.equal(r.warning, null);
  assert.deepEqual(r.config.security_paths, ['x/**']);
  assert.deepEqual(r.config.not_docs, ['docs/api/**']);
});

test('config: a bad security_paths (not a list of strings) makes the config ignored with a warning', async () => {
  const { readConfig } = await load();
  const okDir = mkdtempSync(join(tmpdir(), 'dfsec-ok-'));
  roots.push(okDir);
  writeFileSync(join(okDir, 'diff-facts.config.json'), JSON.stringify({ v: 1, not_docs: [], security_paths: ['x/**'] }));
  assert.equal(readConfig(okDir).warning, null);
  for (const bad of ['x/**', [1], [''], null]) {
    const dir = mkdtempSync(join(tmpdir(), 'dfsec-bad-'));
    roots.push(dir);
    writeFileSync(join(dir, 'diff-facts.config.json'), JSON.stringify({ v: 1, not_docs: [], security_paths: bad }));
    const r = readConfig(dir);
    assert.match(r.warning ?? '', /config ignored/, JSON.stringify(bad));
  }
});

// ---- end to end: show prints the flag through the CLI

function repoWith(base, head) {
  const root = mkdtempSync(join(tmpdir(), 'dfsec-'));
  roots.push(root);
  mkdirSync(join(root, 'home'));
  writeFileSync(join(root, 'gitconfig'), '[user]\n\tname = T\n\temail = t@example.invalid\n[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n');
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(GIT_|GITHUB_|MCSPARROW_|AICO_)/.test(k)) env[k] = v;
  Object.assign(env, { GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', HOME: join(root, 'home'), USERPROFILE: join(root, 'home') });
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '-q');
  const put = (files) => {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(repo, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content);
    }
    git('add', '-A');
    git('commit', '-q', '-m', 'c');
    return git('rev-parse', 'HEAD').trim();
  };
  const b = put(base);
  const h = put(head);
  const show = () => {
    const r = spawnSync(process.execPath, [SCRIPT, 'show', '--base', b, '--head', h], { cwd: repo, env, encoding: 'utf8', timeout: 30000 });
    return { status: r.status, facts: r.status === 0 ? JSON.parse(r.stdout) : null, out: r.stdout + r.stderr };
  };
  return { show };
}

test('show: a diff touching .github/workflows/ci.yml prints security_changed true', () => {
  const r = repoWith({ 'README.md': 'a\n' }, { '.github/workflows/ci.yml': 'name: ci\n' }).show();
  assert.equal(r.status, 0, r.out);
  assert.equal(r.facts.security_changed, true);
});

test('show: yarn.lock alone prints true; a skill text plus a script prints false', () => {
  const a = repoWith({ 'README.md': 'a\n' }, { 'yarn.lock': '# lock\n' }).show();
  assert.equal(a.facts.security_changed, true, a.out);
  const b = repoWith({ 'README.md': 'a\n' }, { 'skills/x/SKILL.md': '# s\n', 'scripts/foo.mjs': 'export {};\n' }).show();
  assert.equal(b.status, 0, b.out);
  assert.equal(b.facts.security_changed, false);
});

test('show: the printed key set holds security_changed beside the v1.0 keys', () => {
  const r = repoWith({ 'README.md': 'a\n' }, { 'scripts/foo.mjs': 'export {};\n' }).show();
  const keys = Object.keys(r.facts).sort();
  assert.ok(keys.includes('security_changed'), keys.join(','));
  for (const k of ['base', 'contract_changed', 'docs_only', 'head', 'paths', 'strings_changed', 'truncated', 'ui_changed', 'v']) {
    assert.ok(keys.includes(k), k);
  }
});

test('classify: each hook script (hook-host, lead-relay, lead-handover, step-times) sets security_changed true', async () => {
  const { classify } = await load();
  for (const p of ['scripts/hook-host.mjs', 'scripts/lead-relay.mjs', 'scripts/lead-handover.mjs', 'scripts/step-times.mjs']) {
    assert.equal(classify([entry(p)], null).security_changed, true, p);
  }
  assert.equal(classify([entry('scripts/foo.mjs')], null).security_changed, false, 'control: a plain script stays false');
});

test('classify: the hook scripts stay security even when the config lists other security_paths', async () => {
  const { classify } = await load();
  const config = { v: 1, not_docs: [], security_paths: ['nothing/**'] };
  assert.equal(classify([entry('scripts/hook-host.mjs')], config).security_changed, true);
});

test('show: a diff touching scripts/lead-relay.mjs prints security_changed true', () => {
  const r = repoWith({ 'README.md': 'a\n' }, { 'scripts/lead-relay.mjs': 'export {};\n' }).show();
  assert.equal(r.status, 0, r.out);
  assert.equal(r.facts.security_changed, true);
});
