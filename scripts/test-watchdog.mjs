// Per-file watchdog preloaded into every test file's child process.
// contract: docs/contracts/test-run.md v1.1
// Arms one unref'd timer of AICO_TEST_WATCHDOG_MS when this process is a test file's child
// (the runner process has --test in its execArgv and never arms). When the timer fires the
// child ends with exit code 1, so node fails that file by name and the other files go on.
import fs from 'node:fs';
import path from 'node:path';

// Pure: the deadline in ms, or null when this process must not arm.
export function armDeadline(env, execArgv) {
  if (Array.isArray(execArgv) && execArgv.includes('--test')) return null;
  const raw = env?.AICO_TEST_WATCHDOG_MS;
  if (typeof raw !== 'string' || !/^\d{1,9}$/.test(raw)) return null;
  const ms = Number(raw);
  return ms > 0 ? ms : null;
}

function fileName() {
  const main = process.argv[1];
  if (typeof main !== 'string' || main === '') return 'unknown';
  return path.relative(process.cwd(), main).split(path.sep).join('/');
}

const deadline = armDeadline(process.env, process.execArgv);
if (deadline !== null) {
  const timer = setTimeout(() => {
    try {
      fs.writeSync(2, `aico test: watchdog: ${fileName()} did not end within ${deadline} ms\n`);
    } catch {
      // stderr is gone; still end the file
    }
    process.exit(1);
  }, deadline);
  timer.unref();
}
