#!/usr/bin/env node
// run.mjs <script> [args]: runs a bundled script of the active plugin version.
// Contract: docs/contracts/plugin-root.md (v1). Refusals exit 3 or 2 with one "aico run:" line.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveActive } from './plugin-root.mjs'

const NAME = /^[a-z][a-z0-9-]{0,40}$/
const HERE = path.dirname(fileURLToPath(import.meta.url))

function refuse(code, message) {
  console.error(`aico run: ${message}`)
  process.exit(code)
}

const [name, ...args] = process.argv.slice(2)
if (typeof name !== 'string' || !NAME.test(name) || name === 'run') refuse(2, 'bad script name')

const active = resolveActive()
if (!active.ok) refuse(active.code, active.message)

// The file name comes from the folder listing, never from the input.
const found = fs.readdirSync(HERE, { withFileTypes: true })
  .find((d) => d.isFile() && d.name === `${name}.mjs`)
if (!found) refuse(2, 'unknown script')

const child = spawn(process.execPath, [path.join(HERE, found.name), ...args], { stdio: 'inherit', shell: false })
child.on('error', () => refuse(1, 'could not start script'))
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
