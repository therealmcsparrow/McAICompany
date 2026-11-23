// tier-sets v2.0: only a major Contract change forces high; the medium start skips the high-only entries; the new
// `ran` command clears an `add before ship:` entry (plan task T15, tests T11). Red until T15 lands.
// Real git in a temp repo, public interface only: `main(args, { root, pluginRoot, now })`.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from './tier-set.mjs';

const REPO = path.resolve(import.meta.dirname, '..');
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const SLUG = 'demo';
const PROJECT = '## Core\n- skills/pipeline: run setup\n\n## Modules\n';
const BEGIN_MEDIUM = ['--playbook', 'feature', '--triage', 'medium', '--short', 'on', '--ceo', 'short'];

const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true, maxRetries: 3 }); });

function put(repo, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(repo, rel);
    if (content === null) { fs.rmSync(abs, { force: true }); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

// A repo with a base commit on main and the run branch refs/heads/aico/demo checked out. `base` files are committed at
// the base; `head` files are committed on the run branch (null deletes a file).
function repoWith(base, head) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tiermajor-'));
  roots.push(root);
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(GIT_|GITHUB_|MCSPARROW_|AICO_)/.test(k)) env[k] = v;
  Object.assign(env, { GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', HOME: root, USERPROFILE: root });
  fs.writeFileSync(path.join(root, 'gitconfig'), '[user]\n\tname = T\n\temail = t@example.invalid\n[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n');
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  put(repo, { '.company/project.md': PROJECT, 'README.md': 'r\n', ...base });
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const sha = git('rev-parse', 'HEAD').trim();
  git('checkout', '-q', '-b', `aico/${SLUG}`);
  put(repo, head);
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', 'work');
  fs.mkdirSync(path.join(repo, '.company', 'work', SLUG), { recursive: true });
  const old = process.cwd();
  const run = (...args) => {
    process.chdir(repo);
    try {
      Object.assign(process.env, { GIT_CONFIG_GLOBAL: env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: '1' });
      return main(args, { root: repo, pluginRoot: REPO, now: NOW });
    } finally { process.chdir(old); }
  };
  const record = () => fs.readFileSync(path.join(repo, '.company', 'work', SLUG, 'tier-path.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { repo, sha, run, record, begin: (flags = BEGIN_MEDIUM) => run('begin', SLUG, ...flags, '--base', sha) };
}

const header = (v) => `# Contract: demo v${v}\n\nbody\n`;
const syncDiff = (r) => r.run('sync', SLUG, '--diff', '--base', r.sha);
const hasContractHit = (res) => res.lines.some((l) => /^check: high: contract /.test(l));

// Control: the v2 rule is live (a minor bump is no hit), so the "is a hit" cases below cannot pass on the v1 rule alone.
function minorControl() {
  const r = repoWith({ 'docs/contracts/demo.md': header('1.0') }, { 'docs/contracts/demo.md': header('1.1') });
  r.begin();
  assert.equal(hasContractHit(syncDiff(r)), false, 'control: a minor bump must not be a hit');
}

describe('Contract version rule: only a major forces high', () => {
  test('a minor header bump (v1.0 -> v1.1) is no hit', () => {
    const r = repoWith({ 'docs/contracts/demo.md': header('1.0') }, { 'docs/contracts/demo.md': header('1.1') });
    r.begin();
    const res = syncDiff(r);
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.equal(hasContractHit(res), false, res.lines.join('\n'));
    assert.ok(res.lines.some((l) => /none forced high/.test(l)), res.lines.join('\n'));
  });
  test('a major header bump (v1.9 -> v2.0) is `high: contract`', () => {
    minorControl();
    const r = repoWith({ 'docs/contracts/demo.md': header('1.9') }, { 'docs/contracts/demo.md': header('2.0') });
    r.begin();
    const res = syncDiff(r);
    assert.ok(res.lines.includes('check: high: contract docs/contracts/demo.md'), res.lines.join('\n'));
  });
  test('a new Contract file is no hit', () => {
    const r = repoWith({}, { 'docs/contracts/fresh.md': '# Contract: fresh v1.0\n\nbody\n' });
    r.begin();
    const res = syncDiff(r);
    assert.equal(hasContractHit(res), false, res.lines.join('\n'));
  });
  test('a deleted Contract file is a hit', () => {
    minorControl();
    const r = repoWith({ 'docs/contracts/demo.md': header('1.0') }, { 'docs/contracts/demo.md': null });
    r.begin();
    assert.equal(hasContractHit(syncDiff(r)), true);
  });
  test('an unreadable header at the head is a hit', () => {
    minorControl();
    const r = repoWith({ 'docs/contracts/demo.md': header('1.0') }, { 'docs/contracts/demo.md': 'no header here\n' });
    r.begin();
    assert.equal(hasContractHit(syncDiff(r)), true);
  });
  test('a body edit with the same header version is no hit', () => {
    const r = repoWith({ 'docs/contracts/demo.md': header('1.0') }, { 'docs/contracts/demo.md': `${header('1.0')}more\n` });
    r.begin();
    assert.equal(hasContractHit(syncDiff(r)), false);
  });
  test('a minor bump does not raise the tier; a major does (cause diff)', () => {
    const minor = repoWith({ 'docs/contracts/demo.md': header('1.0') }, { 'docs/contracts/demo.md': header('1.2') });
    minor.begin();
    syncDiff(minor);
    assert.equal(minor.record().some((e) => e.ev === 'raise'), false);
    const major = repoWith({ 'docs/contracts/demo.md': header('1.0') }, { 'docs/contracts/demo.md': header('2.0') });
    major.begin();
    syncDiff(major);
    const raise = major.record().find((e) => e.ev === 'raise');
    assert.ok(raise, 'a major bump must raise');
    assert.equal(raise.tier, 'high');
    assert.equal(raise.cause, 'diff');
  });
  test('Core and forced-high name patterns still force high on a minor-bump diff', () => {
    const r = repoWith({ 'docs/contracts/demo.md': header('1.0') }, { 'docs/contracts/demo.md': header('1.1'), 'src/auth/login.ts': 'x\n' });
    r.begin();
    const res = syncDiff(r);
    assert.ok(res.lines.some((l) => /^check: high: pattern auth /.test(l)), res.lines.join('\n'));
    assert.equal(hasContractHit(res), false);
  });
});

describe('medium start: skip list, add before ship, ran', () => {
  test('a medium start lists senior-engineer-compliance in the begin record skip', () => {
    const r = repoWith({}, {});
    const res = r.begin();
    assert.equal(res.code, 0, res.lines.join('\n'));
    const begin = r.record()[0];
    assert.equal(begin.tier, 'medium');
    assert.ok(begin.skip.includes('senior-engineer-compliance'), JSON.stringify(begin.skip));
    assert.ok(res.lines.some((l) => /^skipped by tier: .*senior-engineer-compliance/.test(l)), res.lines.join('\n'));
  });
  test('the medium set printed by `sets` has no senior-engineer-compliance; high keeps it', () => {
    const r = repoWith({}, {});
    const lines = r.run('sets').lines;
    const get = (n) => lines.find((l) => l.startsWith(`${n}:`));
    assert.ok(get('feature medium'), lines.join('\n'));
    assert.ok(!get('feature medium').includes('senior-engineer-compliance'));
    assert.ok(get('feature high').includes('senior-engineer-compliance'));
  });
  test('a raise to high lists the skipped entry under `add before ship:`', () => {
    const r = repoWith({}, {});
    r.begin();
    const res = r.run('raise', SLUG, 'high');
    assert.ok(res.lines.some((l) => /^add before ship: .*senior-engineer-compliance/.test(l)), res.lines.join('\n'));
  });
  test('`ran` drops the entry from `add before ship:`', () => {
    const r = repoWith({}, {});
    r.begin();
    r.run('raise', SLUG, 'high');
    const res = r.run('ran', SLUG, 'senior-engineer-compliance');
    assert.equal(res.code, 0, res.lines.join('\n'));
    assert.ok(!res.lines.some((l) => l.includes('senior-engineer-compliance') && l.startsWith('add before ship:')), res.lines.join('\n'));
    const read = JSON.parse(r.run('read', SLUG).lines[0]);
    assert.ok(!read.add.includes('senior-engineer-compliance'), JSON.stringify(read.add));
  });
  test('`ran` of an entry that is not owed is refused (exit 3) and changes nothing', () => {
    const ok = repoWith({}, {});
    ok.begin();
    ok.run('raise', SLUG, 'high');
    assert.equal(ok.run('ran', SLUG, 'senior-engineer-compliance').code, 0, 'control: an owed entry is accepted');
    const r = repoWith({}, {});
    r.begin();
    r.run('raise', SLUG, 'high');
    const before = fs.readFileSync(path.join(r.repo, '.company', 'work', SLUG, 'tier-path.jsonl'), 'utf8');
    const res = r.run('ran', SLUG, 'code-reviewer');
    assert.equal(res.code, 3, res.lines.join('\n'));
    assert.equal(fs.readFileSync(path.join(r.repo, '.company', 'work', SLUG, 'tier-path.jsonl'), 'utf8'), before);
  });
  test('`ran` before any raise is refused: nothing is owed yet', () => {
    const ok = repoWith({}, {});
    ok.begin();
    ok.run('raise', SLUG, 'high');
    assert.equal(ok.run('ran', SLUG, 'senior-engineer-compliance').code, 0, 'control: owed after a raise');
    const r = repoWith({}, {});
    r.begin();
    assert.equal(r.run('ran', SLUG, 'senior-engineer-compliance').code, 3);
  });
  test('`ran` twice for the same entry: the second is refused', () => {
    const r = repoWith({}, {});
    r.begin();
    r.run('raise', SLUG, 'high');
    assert.equal(r.run('ran', SLUG, 'senior-engineer-compliance').code, 0);
    assert.equal(r.run('ran', SLUG, 'senior-engineer-compliance').code, 3);
  });
  test('`ran` refuses a hostile entry name and a missing run record', () => {
    const r = repoWith({}, {});
    assert.equal(r.run('ran', SLUG, 'senior-engineer-compliance').code, 3);
    r.begin();
    r.run('raise', SLUG, 'high');
    for (const bad of ['../x', '__proto__', 'a b']) assert.equal(r.run('ran', SLUG, bad).code, 3, bad);
    assert.equal(r.run('ran', SLUG, 'senior-engineer-compliance').code, 0, 'control: the valid entry is accepted');
  });
});
