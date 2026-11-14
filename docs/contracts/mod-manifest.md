# Contract: mod-manifest v1

New Contract (task P20261114.000001/01-feature; the brief calls it `aico.mod-manifest` v1: aico's Contract index uses bare kebab names). Provider: one JSON file per mod in the installed plugin, hooks/manifests/<mod-id>.json (created by the build). Consumers: the hook engine (`hook-event` v1, `mod-hook` v1; checks every manifest at load), the hook check script (CI and pipeline Setup), the switchboard saver (draws its rows from the manifests), `aico-settings` (which switch keys exist). Rationale: `docs/adr/0071-guards-as-rule-table.md`.

## Shape (allow-list; an unknown key, a missing key or a wrong type makes the manifest invalid)
```json
{ "v": 1,
  "id": "git-add",
  "kind": "guard",
  "title": "git add -A deny",
  "owner": "backend-engineer",
  "sessions": "all",
  "events": ["PreToolUse"],
  "rules": ["git-add.M-SEC1"],
  "fail": "closed",
  "switch": null,
  "lock": true,
  "upstream": null }
```
| Key | Value |
|---|---|
| `v` | `1` |
| `id` | `^[a-z][a-z0-9-]{0,31}$`, equal to the file name without `.json`, unique |
| `kind` | `guard`, `saver` or `gate` (an existing Lead-only refusal mod of `aico-mods`: plan Gate, Fresh Step, reprompt write gate) |
| `title` | 1-60 printable characters, shown in the switchboard (escaped) |
| `owner` | a Role id of `role-names` |
| `sessions` | `all` (guard: required) or `lead` (saver, gate: required) |
| `events` | non-empty list of `hook-event` v1 event names the mod is wired to; empty only for a view-only saver (pane, no rule) |
| `rules` | list of rule IDs (`^[a-z][a-z0-9-]{0,23}\.(M-SEC|M|S|Y)\d+$`, the `rule-check` grammar) this mod owns in the rule table; a guard has at least one |
| `fail` | `closed` (guard, gate) or `open` (saver) |
| `switch` | `null` (guard, gate) or the settings key that switches a saver, `mods.<id_with_underscores>.enabled` |
| `lock` | `true` (guard, gate) or `false` (saver) |
| `upstream` | `null`, or for a pack-derived saver `{ "name": "<pack>", "version": "<version>", "licence": "<SPDX id or none>" }` (credit and audit; NOTICE names the same) |

Kind fixes the rest: a guard is `sessions: all`, `fail: closed`, `switch: null`, `lock: true`; a gate is `sessions: lead`, `fail: closed`, `switch: null`, `lock: true`; a saver is `sessions: lead`, `fail: open`, `lock: false` and has a `switch`. A manifest whose keys match none of these three rows is invalid.

Mod file to manifest: a mod file `mods/<id>.ts` or `mods/<id>.tsx` maps to `hooks/manifests/<id>.json` (same `id`). Files under `mods/shared/` (the shell, the status composer) and `mods/lib/` are shared code, not mods, and need no manifest even when `hooks/register.tsx` calls them. A rule module `hooks/rules/<name>.mjs` is covered when a rule-table row names it and that row's rule ID is in exactly one manifest's `rules`.

## Rules for the engine and the check
- Load: only from the installed plugin root (`CLAUDE_PLUGIN_ROOT`), real path inside it, regular file, at most 8 KiB. A manifest anywhere else (a project repo, a symlink out) is never loaded.
- Each rule-table row names a rule ID; the row is used only when exactly one manifest lists that ID and the row's `fail` equals the manifest's `fail`. The kind comes from the manifest, never from the row or the rule code.
- The check fails (and the release does not ship) when: a manifest is invalid; a mod file (each `mods/<id>.ts` / `mods/<id>.tsx` imported by `hooks/register.tsx`, `mods/shared/` and `mods/lib/` excepted) or a rule module has no manifest by the mapping above; a manifest lists an event that no `hooks/hooks.json` entry or register hook wires; a rule ID has no table row, or a row has no manifest; a guard rule ID lacks a `pass` or a `block` fixture (`mod-hook` v1 "Fixtures").
- Switchboard: one row per manifest, guards and gates read-only with the words `locked on`; a saver row shows its switch. It writes only through `settings.mjs` (`aico-settings`), never a second switch file.

## Release 1 manifests
Guards (kind `guard`): `cap` (rule `cap.M1`), `git-add` (`git-add.M-SEC1`), `dotenv` (`dotenv.M-SEC1`), `model-floor` (`model-floor.M1`), `self-protect` (`self-protect.M-SEC1`). Savers (kind `saver`): `cache-tax` (the existing Cache Tax mod, `mods/cache-tax.tsx`, title `Cache clock`, switch `mods.cache_tax.enabled`; view only), `efficient-browser-use` (`browser.Y1`, note only, default off), `switchboard` (view only), `savings` (view only), `savvy`, `reflect` (existing). Gates (kind `gate`): `plan-gate`, `fresh-step`, `reprompt-gate` (existing, unchanged behaviour).

## Error cases
| Case | Result |
|---|---|
| Invalid or oversize manifest, or outside the plugin root | not loaded; the CEO is told at session start; a guard so lost makes the Setup check stop the run (AC14) |
| Two manifests claim one rule ID | both rows unused; guards on that event deny `manifest-conflict` |
| Saver manifest with `fail: closed` (or the reverse) | invalid |

## Compatibility
New Contract, v1. A new optional key is a minor bump; a new kind or a changed kind rule is a major.
