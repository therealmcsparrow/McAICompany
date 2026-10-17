#!/usr/bin/env node
// Installs the standalone skills aico points to (deps/skills.json) that are not installed yet.
// Usage: node install-skills.mjs [group ...] [--dry-run]   (default group: core)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

export function plan(manifest, groups, installed, platform = process.platform) {
  const cmds = [];
  for (const group of groups) {
    if (!manifest[group]) throw new Error(`unknown group ${group}`);
    for (const { name, source, install } of manifest[group]) {
      const present = name.endsWith('*')
        ? [...installed].some(s => s.startsWith(name.slice(0, -1)))
        : installed.has(name);
      if (present) continue;
      const star = platform === 'win32' ? '"*"' : "'*'";
      const skill = name.endsWith('*') ? star : name;
      cmds.push(install ?? `npx -y skills add ${source} -s ${skill} -g -a claude-code -y`);
    }
  }
  return [...new Set(cmds)];
}

// Runs every command; a failure is recorded, not thrown.
export function runAll(cmds, exec) {
  const ok = [], failed = [];
  for (const cmd of cmds) {
    try { exec(cmd); ok.push(cmd); }
    catch (e) { failed.push({ cmd, error: e.message }); }
  }
  return { ok, failed };
}

function installedSkills() {
  const dirs = [join(homedir(), '.claude', 'skills'), join(process.cwd(), '.claude', 'skills')];
  return new Set(dirs.filter(existsSync).flatMap(d => readdirSync(d)));
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const groups = args.filter(a => !a.startsWith('--'));
  const manifest = JSON.parse(readFileSync(join(ROOT, 'deps', 'skills.json'), 'utf8'));
  const cmds = plan(manifest, groups.length ? groups : ['core'], installedSkills());
  if (!cmds.length) { console.log('All skills already installed.'); process.exit(0); }
  cmds.forEach(cmd => console.log(`${dry ? '[dry-run] ' : '$ '}${cmd}`));
  if (dry) process.exit(0);
  const { ok, failed } = runAll(cmds, cmd => execSync(cmd, { stdio: 'inherit' }));
  failed.forEach(f => console.log(`FAILED ${f.cmd}: ${f.error}`));
  console.log(`${ok.length} installed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}
