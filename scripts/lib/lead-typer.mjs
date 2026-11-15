// Terminal typer lookup for lead-session-mcp v2.0. Windows only: a platform with no typer returns null.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'console-type.ps1');

// win32: builds the powershell.exe argv that types stdin into the console of `claudePid`.
// Any other platform: null.
export function typer(platform) {
  if (platform !== 'win32') return null;
  return (claudePid) => {
    const pid = String(claudePid);
    if (!/^[1-9][0-9]*$/.test(pid)) throw new Error('bad pid');
    return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '--pid', pid];
  };
}
