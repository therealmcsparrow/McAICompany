#!/usr/bin/env node
// Usage: node scripts/stable.mjs <x.y.z>
// Moves the `stable` branch on origin to the commit of the annotated release tag v<x.y.z>.
// The tag must already be merged into origin/main. The tag is pushed if origin lacks it; a tag
// that is already on origin is never moved. Run it only after the release PR is merged.
// Every git call is a fixed argument list started without a shell.
import { spawnSync } from 'node:child_process';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const HEX = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const REMOTE = 'origin';

function fail(msg) {
  console.error(`stable: ${msg}`);
  process.exit(1);
}

// Git's own stderr can echo a remote URL; strip credentials before anything is printed.
function scrub(text) {
  return String(text ?? '')
    .replace(/\/\/[^/@\s]*@/g, '//***@')
    .trim()
    .split('\n')[0]
    .slice(0, 300);
}

const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

// Returns { status, stdout, stderr }. A start failure or a timeout is a status of null.
function run(args) {
  const r = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8', shell: false, env: gitEnv, timeout: 120000, maxBuffer: 1024 * 1024 });
  return { status: r.error ? null : r.status, stdout: (r.stdout ?? '').trim(), stderr: r.error ? String(r.error.code ?? r.error.message) : r.stderr };
}

function must(args, what) {
  const r = run(args);
  if (r.status !== 0) fail(`${what} failed: ${scrub(r.stderr)}`);
  return r.stdout;
}

// ls-remote prints "<sha>\t<ref>"; keep only the exact ref, never a tail match.
function remoteRef(ref) {
  const out = must(['ls-remote', '--refs', REMOTE, ref], `ls-remote ${ref}`);
  for (const line of out.split('\n')) {
    const [sha, name] = line.split('\t');
    if (name === ref) {
      if (!HEX.test(sha)) fail(`unexpected ls-remote output for ${ref}`);
      return sha;
    }
  }
  return '';
}

const argv = process.argv.slice(2);
if (argv.length !== 1) fail('usage: node scripts/stable.mjs <x.y.z>');
const version = argv[0];
if (!SEMVER.test(version)) fail(`${JSON.stringify(version.slice(0, 40))} is not plain semver (x.y.z)`);

const tagRef = `refs/tags/v${version}`;

// An annotated tag only: cat-file prints "tag" for it and "commit" for a lightweight tag.
const type = run(['cat-file', '-t', tagRef]);
if (type.status !== 0) fail(`tag v${version} does not exist here`);
if (type.stdout !== 'tag') fail(`v${version} is not an annotated tag`);
const tagObject = must(['rev-parse', '--verify', '--end-of-options', tagRef], 'rev-parse tag');
const commit = must(['rev-parse', '--verify', '--end-of-options', `${tagRef}^{commit}`], 'rev-parse commit');
if (!HEX.test(tagObject) || !HEX.test(commit)) fail('unexpected rev-parse output');

must(['fetch', '--quiet', '--no-tags', REMOTE, 'refs/heads/main:refs/remotes/origin/main'], 'fetch main');

// merge-base --is-ancestor: 0 is an ancestor, 1 is not, anything else is an error.
const anc = run(['merge-base', '--is-ancestor', '--end-of-options', commit, 'refs/remotes/origin/main']);
if (anc.status === 1) fail(`v${version} is not merged into origin/main; merge the release PR first`);
if (anc.status !== 0) fail(`merge-base failed (exit ${anc.status}): ${scrub(anc.stderr)}`);

// The tag: push when origin lacks it, skip when it is the same object, refuse when it differs.
const remoteTag = remoteRef(tagRef);
if (remoteTag === '') {
  must(['push', '--quiet', REMOTE, `refs/tags/v${version}:refs/tags/v${version}`], 'push tag');
} else if (remoteTag !== tagObject) {
  fail(`tag v${version} on ${REMOTE} differs from the local tag; a pushed tag is never moved, ship a new version`);
}

// stable: the lease names the value read just now. An empty value means the branch must not exist yet.
const old = remoteRef('refs/heads/stable');
must(['push', '--quiet', `--force-with-lease=refs/heads/stable:${old}`, REMOTE, `${commit}:refs/heads/stable`], 'push stable');

console.log(`stable -> v${version} (${commit.slice(0, 7)})`);
