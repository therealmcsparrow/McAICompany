#!/usr/bin/env node
// Usage: node scripts/release.mjs <x.y.z>
// Bumps every version field, rolls the CHANGELOG [Unreleased] section, runs the checks
// (including `claude plugin validate --strict .`, which fails closed), then makes one release commit and a local tag v<x.y.z>. It never contacts a remote.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// npm ships as npm.cmd on Windows, which cannot start without a shell. Run its JS entry point with this node instead.
function npmTest() {
  if (process.platform !== 'win32') return ['npm', ['test']];
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(cli)) return null;
  return [process.execPath, [cli, 'test']];
}

// The validate binary: AICO_CLAUDE_BIN (absolute path), else claude.exe on Windows, else claude.
// A .cmd or .bat shim cannot start without a shell, so it is refused. A script file runs through this node.
function claudeCommand() {
  const bin = process.env.AICO_CLAUDE_BIN;
  if (bin === undefined || bin === '') {
    return [process.platform === 'win32' ? 'claude.exe' : 'claude', []];
  }
  if (!path.isAbsolute(bin)) fail('AICO_CLAUDE_BIN must be an absolute path');
  if (/.(cmd|bat)$/i.test(bin)) fail('AICO_CLAUDE_BIN must not be a .cmd or .bat shim; point it at claude.exe or the CLI script');
  let stat = null;
  try {
    stat = fs.statSync(bin);
  } catch {
    // reported below
  }
  if (!stat || !stat.isFile()) fail('AICO_CLAUDE_BIN is not an existing file');
  if (/.(c|m)?js$/i.test(bin)) return [process.execPath, [bin]];
  return [bin, []];
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

// Fixed argument lists only: the version is validated as plain semver first and is never put in a shell.
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) fail(`git ${args[0]} failed: ${(r.stderr || '').trim()}`);
  return r.stdout.trim();
}

function higher(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

const argv = process.argv.slice(2);
if (argv.length !== 1) fail('usage: node scripts/release.mjs <x.y.z>');
const version = argv[0];
if (!SEMVER.test(version)) fail(`${JSON.stringify(version.slice(0, 40))} is not plain semver (x.y.z)`);

const [claudeBin, claudeArgs] = claudeCommand();

const root = process.cwd();
if (git(root, ['status', '--porcelain']) !== '') fail('working tree is dirty; commit or stash first');

const rel = {
  plugin: '.claude-plugin/plugin.json',
  market: '.claude-plugin/marketplace.json',
  readme: 'documentation/README.md',
  changelog: 'CHANGELOG.md'
};
const abs = (k) => path.join(root, rel[k]);

const originals = new Map();
for (const k of Object.keys(rel)) {
  if (!fs.existsSync(abs(k))) {
    if (k === 'market') continue;
    fail(`${rel[k]} is missing`);
  }
  const text = fs.readFileSync(abs(k), 'utf8');
  if (text.includes('\r')) fail(`${rel[k]} contains a CR byte; convert it to LF first`);
  originals.set(k, text);
}

const pm = originals.get('plugin').match(/"version":\s*"([^"]+)"/);
if (!pm || !SEMVER.test(pm[1])) fail(`${rel.plugin} has no valid "version"`);
if (!higher(version, pm[1])) fail(`${version} is not higher than the current ${pm[1]}`);
if (git(root, ['tag', '--list', `v${version}`]) !== '') fail(`tag v${version} exists`);

// CHANGELOG: the [Unreleased] section needs content, then it becomes the new version.
const lines = originals.get('changelog').split('\n');
const at = lines.findIndex((l) => /^##\s*\[Unreleased\]\s*$/i.test(l));
if (at < 0) fail('CHANGELOG.md has no "## [Unreleased]" section');
let end = lines.findIndex((l, i) => i > at && /^## /.test(l));
if (end < 0) end = lines.length;
if (lines.slice(at + 1, end).every((l) => l.trim() === '')) fail('the Unreleased section in CHANGELOG.md is empty');
const today = new Date().toISOString().slice(0, 10);
lines.splice(at + 1, 0, '', `## [${version}] - ${today}`);

const next = new Map();
next.set('plugin', originals.get('plugin').replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));
if (originals.has('market')) next.set('market', originals.get('market').replace(/("version":\s*")[^"]+(")/g, `$1${version}$2`));
const rd = originals.get('readme').replace(/(Current:\s*\*{0,2})\d+\.\d+\.\d+/, `$1${version}`);
if (rd === originals.get('readme'))
  fail(`${rel.readme} has no "Current:" version`);
next.set('readme', rd);
next.set('changelog', lines.join('\n'));

const restore = () => {
  for (const [k, text] of originals) fs.writeFileSync(abs(k), text);
};
for (const [k, text] of next) fs.writeFileSync(abs(k), text);

const npm = npmTest();
const checks = [
  ['check', process.execPath, ['scripts/check.mjs']],
  ['npm test', ...(npm ?? ['npm', ['test']])]
];
const VALIDATE_LIMIT = { timeout: 120000, maxBuffer: 1024 * 1024 };
function validate() {
  const r = spawnSync(claudeBin, [...claudeArgs, 'plugin', 'validate', '--strict', '.'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    ...VALIDATE_LIMIT
  });
  process.stdout.write((r.stdout ?? '').slice(0, 20000));
  process.stderr.write((r.stderr ?? '').slice(0, 20000));
  if (r.error) console.error(`release: could not run the claude CLI (${r.error.code ?? 'error'})`);
  return r.status === 0 && !r.error;
}

for (const [name, cmd, args] of checks) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    restore();
    fail(`${name} failed; files restored, no commit, no tag`);
  }
}

if (!validate()) {
  restore();
  fail('claude plugin validate failed; files restored, no commit, no tag');
}

// The checks may write files; the release commit takes only the files this script changed.
const files = [...next.keys()].map((k) => rel[k]);
git(root, ['add', '--', ...files]);
git(root, ['commit', '-q', '-m', `chore: release v${version}`, '--', ...files]);
git(root, ['tag', '-a', `v${version}`, '-m', `v${version}`]);
console.log(`released v${version}: commit and tag made locally, nothing was sent to any remote.`);
