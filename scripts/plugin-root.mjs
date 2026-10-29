#!/usr/bin/env node
// Resolves the active plugin root. Contract: docs/contracts/plugin-root.md (v1).
// Exports resolveActive(); the CLI prints the active root or refuses with exit 3.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CAP = 1024 * 1024
const WIN = process.platform === 'win32'
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/

const fold = (p) => {
  const r = path.resolve(p)
  return WIN ? r.replaceAll('/', '\\').toLowerCase() : r
}
const real = (p) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
const isDir = (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } }
const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)

export function ownRoot() {
  return path.dirname(real(path.dirname(fileURLToPath(import.meta.url))))
}

// The <marketplace>/<plugin>/<version> segments of a root inside the cache, null outside it,
// and { bad: true } for a root inside the cache that is not exactly three valid segments.
function cacheParts(root, home) {
  const base = fold(path.join(real(home), '.claude', 'plugins', 'cache'))
  const here = fold(root)
  if (!within(here, base) || here === base) return null
  const parts = path.relative(path.join(real(home), '.claude', 'plugins', 'cache'), root).split(path.sep)
  if (parts.length !== 3 || !parts.every((s) => SEGMENT.test(s))) return { bad: true }
  return { marketplace: parts[0], plugin: parts[1], version: parts[2] }
}

function readRecord(home) {
  const file = path.join(home, '.claude', 'plugins', 'installed_plugins.json')
  try {
    const st = fs.lstatSync(file)
    if (!st.isFile() || st.size > CAP) return null
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!data || typeof data !== 'object' || data.version !== 2) return null
    if (!data.plugins || typeof data.plugins !== 'object') return null
    return data.plugins
  } catch { return null }
}

function pluginName(root) {
  try {
    const f = path.join(root, '.claude-plugin', 'plugin.json')
    if (!fs.lstatSync(f).isFile()) return null
    const name = JSON.parse(fs.readFileSync(f, 'utf8'))?.name
    return typeof name === 'string' ? name : null
  } catch { return null }
}

function activeEntry(list, cwd) {
  const here = fold(cwd)
  let best = null
  let bestLen = -1
  let user = null
  for (const e of list) {
    if (!e || typeof e !== 'object' || typeof e.installPath !== 'string') continue
    if (e.scope === 'project' && typeof e.projectPath === 'string') {
      const pp = fold(e.projectPath)
      if (within(here, pp) && pp.length > bestLen) { best = e; bestLen = pp.length }
    } else if (e.scope === 'user' && !user) user = e
  }
  return best ?? user
}

// Control, format and line or paragraph separator characters become \uXXXX, so a folder name
// from the record cannot add a line or hide text on stderr. Length is capped.
const show = (name) => String(name).slice(0, 100).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => `\\u${c.codePointAt(0).toString(16).padStart(4, '0')}`)

// { ok: true, root, own } or { ok: false, code: 3, message }.
export function resolveActive({ root = ownRoot(), home = os.homedir(), cwd = process.cwd() } = {}) {
  const parts = cacheParts(root, home)
  if (!parts) return { ok: true, root, own: root }
  const unreadable = { ok: false, code: 3, message: 'plugin record unreadable' }
  if (parts.bad) return unreadable
  if (pluginName(root) !== parts.plugin) return unreadable
  const plugins = readRecord(home)
  const key = `${parts.plugin}@${parts.marketplace}`
  if (!plugins || !Object.hasOwn(plugins, key) || !Array.isArray(plugins[key])) return unreadable
  const entry = activeEntry(plugins[key], cwd)
  if (!entry || !isDir(entry.installPath)) return unreadable
  const active = real(entry.installPath)
  if (fold(active) === fold(root)) return { ok: true, root: active, own: root }
  return { ok: false, code: 3, message: `stale plugin ${show(path.basename(root))} active ${show(path.basename(active))}` }
}

if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  const r = resolveActive()
  if (r.ok) {
    console.log(r.root)
  } else {
    console.error(`aico run: ${r.message}`)
    process.exit(r.code)
  }
}
