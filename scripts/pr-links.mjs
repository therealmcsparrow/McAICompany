#!/usr/bin/env node
// Live pull request and issue lookup for a run branch. Asks `gh`, keeps nothing, writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { WorkFolderRefusal, branchId, exactWorkPath, isWorkFolder } from '../mods/lib/work-folder.mjs';

const MAX_OUT = 1024 * 1024;
const MAX_PRS = 5;
const NUMBER = /^[1-9]\d{0,9}$/;
const URL_OK = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/(pull|issues)\/\d+$/;
const STATES = new Set(['open', 'closed', 'merged']);
const FIELDS = 'number,url,state,closingIssuesReferences';

const result = (slug, branch, state, prs = [], issues = []) => ({ v: 1, slug, branch, state, prs, issues });

function slugOk(root, slug) {
  if (typeof slug !== 'string' || slug === '' || !isWorkFolder(slug)) return false;
  try {
    return exactWorkPath({ fs, path }, root, [slug]) === 'exact';
  } catch (error) {
    if (error instanceof WorkFolderRefusal) return false;
    return false;
  }
}

// Resolves to the parsed JSON array of `gh` stdout, or null on any failure.
function runGh(spawn, args, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let child;
    let timer;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (value === null && child) {
        try { child.kill(); } catch { /* already gone */ }
      }
      resolve(value);
    };
    try {
      child = spawn('gh', args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch {
      return finish(null);
    }
    timer = setTimeout(() => finish(null), timeoutMs);
    const chunks = [];
    let size = 0;
    child.on('error', () => finish(null));
    child.stderr?.on('data', () => {});
    child.stdout?.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_OUT) return finish(null);
      chunks.push(chunk);
    });
    child.on('close', (code) => {
      if (code !== 0) return finish(null);
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        finish(Array.isArray(parsed) ? parsed : null);
      } catch {
        finish(null);
      }
    });
  });
}

// Validators for untrusted `gh` output. goodNumber mirrors the PR/issue number printed in the page text; goodUrl mirrors the
// `<a href>` the page builds and the browser URL parser. Covers: non-integer or oversized numbers, non-https schemes
// (javascript:, data:), other hosts, userinfo, whitespace and control characters (open redirect, script injection, CWE-79, CWE-601).
const goodNumber = (n) => Number.isInteger(n) && NUMBER.test(String(n));
const goodUrl = (u) => typeof u === 'string' && URL_OK.test(u);

export async function lookup(root, slug, { spawn = nodeSpawn, timeoutMs = 5000 } = {}) {
  if (!slugOk(root, slug)) return result(null, null, 'none');
  const branch = `aico/${branchId(slug)}`;
  const rows = await runGh(spawn, ['pr', 'list', '--head', branch, '--state', 'all', '--limit', String(MAX_PRS), '--json', FIELDS], timeoutMs);
  if (rows === null) return result(slug, branch, 'unavailable');
  const prs = [];
  const issues = [];
  const seen = new Set();
  for (const row of rows) {
    if (prs.length >= MAX_PRS) break;
    if (row === null || typeof row !== 'object') continue;
    const state = typeof row.state === 'string' ? row.state.toLowerCase() : '';
    if (!goodNumber(row.number) || !goodUrl(row.url) || !STATES.has(state)) continue;
    prs.push({ number: row.number, url: row.url, state });
    const refs = Array.isArray(row.closingIssuesReferences) ? row.closingIssuesReferences : [];
    for (const ref of refs) {
      if (ref === null || typeof ref !== 'object') continue;
      if (!goodNumber(ref.number) || !goodUrl(ref.url) || seen.has(ref.number)) continue;
      seen.add(ref.number);
      issues.push({ number: ref.number, url: ref.url });
    }
  }
  if (rows.length === 0) return result(slug, branch, 'none');
  return result(slug, branch, prs.length > 0 ? 'found' : 'none', prs, issues);
}

async function main(argv) {
  const [cmd, slug, ...flags] = argv;
  if (cmd !== 'show' || !flags.includes('--json')) {
    process.stderr.write('usage: pr-links.mjs show <slug> --json\n');
    return 2;
  }
  process.stdout.write(`${JSON.stringify(await lookup(process.cwd(), slug))}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
