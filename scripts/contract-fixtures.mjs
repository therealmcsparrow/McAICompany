// Golden fixtures per Contract (contract: docs/contracts/contract-index.md v1). Node built-ins only; read-only.
// A fixture folder `tests/contracts/<contract>/` holds `version.txt` (the Contract header version) and data files.
// Data only: text and JSON are read, never imported or run. A Contract bump makes every consumer throw until the
// fixtures are regenerated and re-stamped.
import { readFileSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 1_000_000;
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const FILE = /^[A-Za-z0-9][\w.-]{0,80}$/;
const HEADER = /^# Contract: ([a-z][a-z0-9]*(?:-[a-z0-9]+)*) v(\d+(?:\.\d+)?)[ \t]*$/;
const VERSION = /^(\d+)(?:\.(\d+))?$/;

export const FIXTURE_ROOT_ENV = 'CONTRACT_FIXTURE_ROOT';

const norm = text => {
  const m = VERSION.exec(text);
  return m ? `${Number(m[1])}.${m[2] === undefined ? 0 : Number(m[2])}` : null;
};

function readSmall(abs, what) {
  let st;
  try { st = lstatSync(abs); } catch { throw new Error(`${what} is missing`); }
  if (!st.isFile()) throw new Error(`${what} is not a plain file`);
  if (st.size > MAX_BYTES) throw new Error(`${what} is over ${MAX_BYTES} bytes`);
  return readFileSync(abs, 'utf8');
}

// The repo root is the parent of scripts/. The env override points tests at a copy of docs/contracts and tests/contracts.
export function defaultRoot() {
  const env = process.env[FIXTURE_ROOT_ENV];
  return env ? resolve(env) : resolve(fileURLToPath(import.meta.url), '..', '..');
}

export function headerVersion(contract, root = defaultRoot()) {
  if (!NAME.test(contract)) throw new Error(`bad Contract name ${JSON.stringify(String(contract).slice(0, 40))}`);
  const text = readSmall(join(root, 'docs', 'contracts', `${contract}.md`), `Contract ${contract}`);
  const m = HEADER.exec(text.slice(0, 300).split(/\r?\n/, 1)[0]);
  if (!m || m[1] !== contract) throw new Error(`Contract ${contract} has no header on line 1`);
  return norm(m[2]);
}

// Throws unless version.txt equals the header version. Returns readers for the data files.
export function loadGolden(contract, { root = defaultRoot() } = {}) {
  const want = headerVersion(contract, root);
  const dir = join(root, 'tests', 'contracts', contract);
  const stamped = norm(readSmall(join(dir, 'version.txt'), `fixture ${contract}/version.txt`).trim());
  if (stamped === null) throw new Error(`fixture ${contract}/version.txt is not a version`);
  if (stamped !== want) {
    throw new Error(`fixtures for ${contract} are stamped v${stamped}, the Contract header is v${want}: regenerate tests/contracts/${contract}/ and re-stamp version.txt`);
  }
  const read = name => {
    if (!FILE.test(name) || name === 'version.txt') throw new Error(`bad fixture name ${JSON.stringify(String(name).slice(0, 40))}`);
    return readSmall(join(dir, name), `fixture ${contract}/${name}`);
  };
  return { contract, version: want, text: read, json: name => JSON.parse(read(name)) };
}
