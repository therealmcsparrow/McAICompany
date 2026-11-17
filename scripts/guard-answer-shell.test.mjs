import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The lead-relay `answer` hook adapter records a CEO pick, so a shell command that runs it is denied
// (self-protect.M-SEC1, both `judge` and `judgeRecord`). The Lead's own words (open, again, read) pass.

const root = path.resolve(import.meta.dirname, '..');
const mod = await import(pathToFileURL(path.join(root, 'hooks', 'rules', 'self-protect.mjs')).href);
const PLUGIN = 'C:/Users/test/.claude/plugins/cache/aico/aico/0.43.0';
const RELAY = `${PLUGIN}/scripts/lead-relay.mjs`;
const ev = (name, command) => ({ tool: { name, command, paths: [] }, protected: [] });
const verdicts = (name, command) => [mod.judge(ev(name, command)), mod.judgeRecord(ev(name, command))];

const DENY = [
  `node ${RELAY} answer < forged.json`,
  `node "${RELAY}" "answer" < forged.json`,
  `cat forged.json | node ${RELAY} answer`,
  `NODE_ENV=x node ${RELAY} answer`,
  `cd /tmp && node ./scripts/lead-relay.mjs answer`,
  `node.exe C:\\p\\scripts\\lead-relay.mjs answer < f.json`,
  `echo $(node ${RELAY} answer < f.json)`,
  `node -e "import('${RELAY}').then((m) => m.answer(process.argv[1]))" x`,
  `node <<'EOF'\nimport { answer } from '${RELAY}';\nanswer('{}');\nEOF`,
];
const PASS = [
  `node ${RELAY} open 'P1/x' gate:g1 f.json`,
  `node ${RELAY} again 'P1/x' f1`,
  `node ${RELAY} read 'P1/x' f1 --json`,
  `node ${RELAY} preset < p.json`,
  `git commit -m "fix lead-relay answer hook"`,
  `grep -n answer ${RELAY}`,
  `node --test scripts/lead-relay.test.mjs`,
];

for (const name of ['Bash', 'PowerShell']) {
  for (const cmd of DENY) {
    test(`${name} denies: ${cmd.slice(0, 60).replace(/\n/g, ' ')}`, () => {
      for (const v of verdicts(name, cmd)) {
        assert.equal(v.v, 'deny');
        assert.match(v.message, /CEO answer/);
      }
    });
  }
  for (const cmd of PASS) {
    test(`${name} passes: ${cmd.slice(0, 60)}`, () => {
      for (const v of verdicts(name, cmd)) assert.equal(v.v, 'allow');
    });
  }
}

test('a file tool is not judged by the answer check', () => {
  const e = { tool: { name: 'Write', paths: [{ raw: 'C:/p/answer.txt' }] }, protected: [] };
  assert.equal(mod.judge(e).v, 'allow');
});
