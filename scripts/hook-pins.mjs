#!/usr/bin/env node
// contract: docs/contracts/mod-hook.md v1
// Writes or checks hooks/pins.json: one SHA-256 per file of the pinned set. Usage: hook-pins.mjs write|check [--root <plugin root>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPins, pinHashes } from './hook-host.mjs';

export function main(argv) {
  const [cmd, ...rest] = argv;
  const i = rest.indexOf('--root');
  const root = i !== -1 && rest[i + 1] ? path.resolve(rest[i + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (cmd === 'write') {
    const pins = pinHashes(root);
    fs.writeFileSync(path.join(root, 'hooks', 'pins.json'), `${JSON.stringify(pins, null, 2)}\n`);
    return { code: 0, out: `pins written: ${Object.keys(pins.files).length} files\n` };
  }
  if (cmd === 'check') {
    const r = checkPins(root);
    return r.ok ? { code: 0, out: 'pins ok\n' } : { code: 1, out: `pins-mismatch: ${r.files.join(', ')}\n` };
  }
  return { code: 2, out: 'usage: hook-pins.mjs write|check [--root <plugin root>]\n' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = main(process.argv.slice(2));
  process.stdout.write(r.out);
  process.exitCode = r.code;
}
