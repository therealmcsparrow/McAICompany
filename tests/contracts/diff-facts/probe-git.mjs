// Test runner: runs scripts/diff-facts.mjs main() with a git whose blob reads can be tampered with.
// Usage: node probe-git.mjs <diff-facts args...>   env DF_MODE, DF_LEN, DF_NUL, DF_LOG; run with cwd = the repo.
// Modes (act on every matching call of the real git):
//   none           pass through (control)
//   log            append the argv of each `cat-file blob` call as one JSON line to DF_LOG
//   blob-enobufs   `cat-file blob` fails like a pipe-cap stop: code ENOBUFS, stdout = DF_LEN bytes of "x", a NUL at index DF_NUL (-1 = none)
//   blob-exit      `cat-file blob` ends normally with DF_LEN bytes of "x"
//   batch-id       every `--batch` header gets a different object id
//   batch-size     every `--batch` header names size+1; the byte after the content is "x", not a newline (total length unchanged)
//   batch-type     every `--batch` header says `tree` instead of `blob`
//   batch-missing  every `--batch` header becomes `<spec> missing` and its content stays
import cp from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.env.DF_MODE ?? 'none';
const len = Number(process.env.DF_LEN ?? '0');
const nul = Number(process.env.DF_NUL ?? '-1');
const real = cp.execFileSync;

const fake = () => {
  const b = Buffer.alloc(len, 0x78);
  if (nul >= 0 && nul < len) b[nul] = 0;
  return b;
};

function tamperBatch(out) {
  const parts = [];
  let pos = 0;
  while (pos < out.length) {
    const nl = out.indexOf(10, pos);
    const header = out.subarray(pos, nl).toString('latin1');
    const m = /^(\S+) (\S+) (\d+)$/.exec(header);
    const size = Number(m[3]);
    const body = out.subarray(nl + 1, nl + 1 + size);
    pos = nl + 1 + size + 1;
    if (mode === 'batch-id') parts.push(Buffer.from(`${m[1][0] === '0' ? '1' : '0'}${m[1].slice(1)} ${m[2]} ${m[3]}\n`), body, Buffer.from('\n'));
    else if (mode === 'batch-size') parts.push(Buffer.from(`${m[1]} ${m[2]} ${size + 1}\n`), body, Buffer.from('x'));
    else if (mode === 'batch-type') parts.push(Buffer.from(`${m[1]} tree ${m[3]}\n`), body, Buffer.from('\n'));
    else parts.push(Buffer.from(`${m[1]} missing\n`), body, Buffer.from('\n'));
  }
  return Buffer.concat(parts);
}

cp.execFileSync = (file, args, opts) => {
  if (file !== 'git' || !Array.isArray(args) || !args.includes('cat-file')) return real(file, args, opts);
  const isBlob = args.includes('blob');
  if (isBlob && mode === 'log') appendFileSync(process.env.DF_LOG, `${JSON.stringify(args)}\n`);
  if (isBlob && mode === 'blob-enobufs') throw Object.assign(new Error('spawnSync git ENOBUFS'), { code: 'ENOBUFS', stdout: fake(), stderr: Buffer.alloc(0) });
  if (isBlob && mode === 'blob-exit') return fake();
  const out = real(file, args, opts);
  if (args.includes('--batch') && mode.startsWith('batch-')) return tamperBatch(out);
  return out;
};
syncBuiltinESMExports();

const here = dirname(fileURLToPath(import.meta.url));
const { main } = await import(pathToFileURL(resolve(here, '../../../scripts/diff-facts.mjs')).href);
const r = main(process.argv.slice(2));
process.stdout.write(r.out);
process.exitCode = r.code;
