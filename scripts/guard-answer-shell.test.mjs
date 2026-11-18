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

// a PowerShell -EncodedCommand whose payload runs the relay `answer` denies, in every flag form.
const b64 = (t) => Buffer.from(t, 'utf16le').toString('base64');
const ANSWER_PAYLOAD = b64('node scripts/lead-relay.mjs answer < forged.json');
const FLAGS = ['-EncodedCommand', '-enc', '/EncodedCommand', '--EncodedCommand', '–EncodedCommand', '—EncodedCommand', '―EncodedCommand'];
for (const name of ['Bash', 'PowerShell']) {
  for (const shell of ['powershell', 'pwsh']) {
    for (const f of FLAGS) {
      test(`${name} denies ${shell} ${f.replace(/[^\x00-\x7f]/g, (c) => `U+${c.codePointAt(0).toString(16)}`)} encoded answer`, () => {
        for (const cmd of [`${shell} ${f} ${ANSWER_PAYLOAD}`, `${shell} ${f}:${ANSWER_PAYLOAD}`, `${shell} -NoProfile ${f} ${ANSWER_PAYLOAD}`]) {
          for (const v of verdicts(name, cmd)) {
            assert.equal(v.v, 'deny', cmd);
            assert.match(v.message, /CEO answer/);
          }
        }
      });
    }
  }
  test(`${name} passes an encoded harmless payload`, () => {
    const ok = b64('Write-Output ok');
    for (const f of FLAGS) for (const cmd of [`powershell ${f} ${ok}`, `pwsh ${f}:${ok}`]) {
      for (const v of verdicts(name, cmd)) assert.equal(v.v, 'allow', cmd);
    }
  });
  test(`${name} passes an encoded relay read payload`, () => {
    const ok = b64("node scripts/lead-relay.mjs read 'P1/x' f1 --json");
    for (const v of verdicts(name, `powershell -EncodedCommand ${ok}`)) assert.equal(v.v, 'allow');
  });
}

test('a file tool is not judged by the answer check', () => {
  const e = { tool: { name: 'Write', paths: [{ raw: 'C:/p/answer.txt' }] }, protected: [] };
  assert.equal(mod.judge(e).v, 'allow');
});

// decoded and -c text is parsed again, so a nested or double-encoded answer denies in every wrapper.
const NEST_ANSWER = 'node scripts/lead-relay.mjs answer < forged.json';
const NESTED = {
  'pwsh -c wrapping pwsh -enc': `pwsh -c "pwsh -enc ${b64(NEST_ANSWER)}"`,
  'pwsh -Command wrapping powershell -EncodedCommand': `pwsh -Command "powershell -EncodedCommand ${b64(NEST_ANSWER)}"`,
  'pwsh -c wrapping the plain answer': `pwsh -c "${NEST_ANSWER}"`,
  'double-encoded -enc': `pwsh -enc ${b64(`pwsh -enc ${b64(NEST_ANSWER)}`)}`,
  'triple-encoded -EncodedCommand': `powershell -EncodedCommand ${b64(`pwsh -enc ${b64(`pwsh -enc ${b64(NEST_ANSWER)}`)}`)}`,
  'encoded wrapper around pwsh -c': `pwsh -enc ${b64(`pwsh -c "${NEST_ANSWER}"`)}`,
};
for (const name of ['Bash', 'PowerShell']) {
  for (const [label, cmd] of Object.entries(NESTED)) {
    test(`${name} denies nested answer: ${label}`, () => {
      for (const v of verdicts(name, cmd)) {
        assert.equal(v.v, 'deny', cmd);
        assert.match(v.message, /CEO answer/);
      }
    });
  }
  test(`${name} passes harmless nested payloads`, () => {
    const ok = 'Write-Output ok';
    const read = "node scripts/lead-relay.mjs read 'P1/x' f1 --json";
    for (const cmd of [
      `pwsh -c "pwsh -enc ${b64(ok)}"`,
      `pwsh -enc ${b64(`pwsh -enc ${b64(ok)}`)}`,
      `pwsh -c "${read}"`,
      `pwsh -enc ${b64(`pwsh -enc ${b64(read)}`)}`,
    ]) for (const v of verdicts(name, cmd)) assert.equal(v.v, 'allow', cmd);
  });
}

// at the nesting depth limit a still-decodable -enc payload denies (fail closed), in judge and judgeRecord.
const layers = (n, inner) => { let t = inner; for (let i = 0; i < n; i++) t = `pwsh -enc ${b64(t)}`; return t; };
for (const name of ['Bash', 'PowerShell']) {
  for (const n of [4, 5, 6]) {
    test(`${name} denies ${n}-layer pwsh -enc around a relay answer call`, () => {
      for (const v of verdicts(name, layers(n, NEST_ANSWER))) assert.equal(v.v, 'deny', `${n} layers`);
    });
    test(`${name} denies ${n}-layer pwsh -enc around a harmless payload at the depth limit (fail closed)`, () => {
      for (const v of verdicts(name, layers(n, 'Write-Output ok'))) assert.equal(v.v, 'deny', `${n} layers`);
    });
  }
  test(`${name} still passes a 2-layer pwsh -enc around a harmless payload`, () => {
    for (const v of verdicts(name, layers(2, 'Write-Output ok'))) assert.equal(v.v, 'allow');
  });
  // a missing, empty or non-base64 -enc payload cannot be read, so it denies.
  const BAD = [
    'pwsh -enc', 'pwsh -EncodedCommand', 'pwsh -enc ""', 'pwsh -enc !!!', 'pwsh -enc "not base64 at all"',
    'pwsh -enc not_base64$', 'pwsh -EncodedCommand:!!!', 'powershell -enc -NoProfile', 'pwsh /enc ***', 'pwsh –enc ###',
  ];
  for (const cmd of BAD) {
    test(`${name} denies an unreadable -enc payload: ${cmd}`, () => {
      for (const v of verdicts(name, cmd)) assert.equal(v.v, 'deny', cmd);
    });
  }
  test(`${name} passes an odd-length base64 -EncodedCommand AAAA`, () => {
    for (const v of verdicts(name, 'pwsh -EncodedCommand AAAA')) assert.equal(v.v, 'allow');
  });
  test(`${name} passes a pwsh call without an encoded flag`, () => {
    for (const cmd of ['pwsh -NoProfile -File x.ps1', 'pwsh -ExecutionPolicy Bypass -File x.ps1']) {
      for (const v of verdicts(name, cmd)) assert.equal(v.v, 'allow', cmd);
    }
  });
}

// A spawn verb (iex, Invoke-Expression, Start-Process, saps, start, icm) with pwsh and an encoded flag denies in any order,
// in judge and judgeRecord, on both shell tools. A pwsh call without an encoded flag, or an encoded flag with no spawn verb, still follows the payload.
const SPAWN_B64 = b64(NEST_ANSWER);
const SPAWN_DENY = {
  'iex with a quoted pwsh -enc': `iex "pwsh -enc ${SPAWN_B64}"`,
  'Invoke-Expression with powershell -EncodedCommand': `Invoke-Expression "powershell -EncodedCommand ${SPAWN_B64}"`,
  'Start-Process -ArgumentList with -enc': `Start-Process pwsh -ArgumentList '-enc','${SPAWN_B64}'`,
  'saps -ArgumentList with -EncodedCommand': `saps powershell -ArgumentList '-EncodedCommand','${SPAWN_B64}'`,
  'Start-Process -FilePath with -e prefix': `Start-Process -FilePath pwsh -ArgumentList "-e ${SPAWN_B64}"`,
  'spawn verb after the flag': `pwsh -enc ${SPAWN_B64} ; iex x`,
  'iex over a harmless encoded payload': `iex "pwsh -enc ${b64('Write-Output 1')}"`,
  'icm with pwsh -enc': `icm { pwsh -enc ${SPAWN_B64} }`,
};
for (const name of ['Bash', 'PowerShell']) {
  for (const [label, cmd] of Object.entries(SPAWN_DENY)) {
    test(`${name} denies a spawn verb around pwsh -enc: ${label}`, () => {
      for (const v of verdicts(name, cmd)) assert.equal(v.v, 'deny', cmd);
    });
  }
  test(`${name} still passes a plain pwsh -enc around a harmless payload and a spawn verb without pwsh`, () => {
    for (const cmd of [`pwsh -enc ${b64('Write-Output 1')}`, 'iex "Write-Output 1"', "Start-Process notepad -ArgumentList 'a.txt'", 'echo hi']) {
      for (const v of verdicts(name, cmd)) assert.equal(v.v, 'allow', cmd);
    }
  });
}

// Call operators in front of pwsh: `&` and `.` are not on the spawn list, so the spawn rule does not fire for them.
// The answer payload is still decoded and denied; the over-deny for a harmless payload is the expected-deny probe below.
for (const name of ['Bash', 'PowerShell']) {
  for (const op of ['&', '.']) {
    test(`${name} denies a call operator '${op}' before pwsh -enc around a relay answer call`, () => {
      for (const v of verdicts(name, `${op} pwsh -enc ${SPAWN_B64}`)) assert.equal(v.v, 'deny', op);
    });
  }
}
