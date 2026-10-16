import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from './install-skills.mjs';

const manifest = {
  core: [
    { name: 'humanizer', source: 'blader/humanizer' },
    { name: 'hallmark', source: 'nutlope/hallmark' },
    { name: 'impeccable', install: 'npx -y impeccable skills install' }
  ],
  go: [{ name: 'golang-*', source: 'samber/cc-skills-golang' }]
};

test('skips installed skills and builds skills-CLI commands for missing ones', () => {
  const cmds = plan(manifest, ['core'], new Set(['humanizer']), 'linux');
  assert.deepEqual(cmds, [
    'npx -y skills add nutlope/hallmark -s hallmark -g -a claude-code -y',
    'npx -y impeccable skills install'
  ]);
});

test('wildcard group is skipped when any matching skill is installed', () => {
  assert.deepEqual(plan(manifest, ['go'], new Set(['golang-cli']), 'linux'), []);
  assert.deepEqual(plan(manifest, ['go'], new Set(), 'linux'), [
    "npx -y skills add samber/cc-skills-golang -s '*' -g -a claude-code -y"
  ]);
});

test('unknown group throws', () => {
  assert.throws(() => plan(manifest, ['cobol'], new Set()), /unknown group cobol/);
});

test('wildcard uses double quotes on Windows (cmd.exe keeps single quotes)', () => {
  assert.deepEqual(plan(manifest, ['go'], new Set(), 'win32'), [
    'npx -y skills add samber/cc-skills-golang -s "*" -g -a claude-code -y'
  ]);
});
