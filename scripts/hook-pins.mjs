#!/usr/bin/env node
// contract: docs/contracts/mod-hook.md v1
// Writes or checks hooks/pins.json: one SHA-256 per file of the pinned set. Usage: hook-pins.mjs write|check [--root <plugin root>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPins, pinHashes } from './hook-host.mjs';
import { depHashes, verifyDeps } from '../hooks/lib/dep-pins.mjs';

// The hashes recorded under the given root, not the ones this script was loaded with.
function readDepHashes(root) {
  try {
    const text = fs.readFileSync(path.join(root, 'hooks', 'lib', 'dep-hashes.mjs'), 'utf8');
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch { return {}; }
}

export function main(argv) {
  const [cmd, ...rest] = argv;
  const i = rest.indexOf('--root');
  const root = i !== -1 && rest[i + 1] ? path.resolve(rest[i + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (cmd === 'write') {
    const deps = depHashes(root);
    if (deps.bad.length > 0) return { code: 1, out: `pins not written, unreadable imports: ${deps.bad.join(', ')}
` };
    fs.writeFileSync(path.join(root, 'hooks', 'lib', 'dep-hashes.mjs'), `export const DEP_HASHES = ${JSON.stringify(deps.hashes, null, 2)};
`);
    const pins = pinHashes(root);
    fs.writeFileSync(path.join(root, 'hooks', 'pins.json'), `${JSON.stringify(pins, null, 2)}\n`);
    return { code: 0, out: `pins written: ${Object.keys(pins.files).length} files\n` };
  }
  if (cmd === 'check') {
    const r = checkPins(root);
    const files = [...new Set([...(r.ok ? [] : r.files), ...verifyDeps(root, readDepHashes(root))])];
    return files.length === 0 ? { code: 0, out: 'pins ok\n' } : { code: 1, out: `pins-mismatch: ${files.join(', ')}\n` };
  }
  return { code: 2, out: 'usage: hook-pins.mjs write|check [--root <plugin root>]\n' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = main(process.argv.slice(2));
  process.stdout.write(r.out);
  process.exitCode = r.code;
}
