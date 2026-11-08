# Contract: afk-policy v1

Status: draft until plan task T14 (run 2026-11-08 20.27 - Pocock Large Items) builds the provider; T14 removes this line and puts the provider path in backticks.

Provider: scripts/afk-policy.mjs (`loadPolicy(root)`, `killSwitch(root)`; Node built-ins only, read-only). Consumers: AFK preflight, picker, host gate, ship step, proxy. Rationale: docs/adr/0067-afk-wsl2-runner.md.

## Where
Policy `.company/afk-policy.json` and kill switch `.company/afk-off`, both on the host product root. Never read from a bundle, a clone or the sandbox, so a run cannot loosen its own policy. Both paths are protected in every diff.

## Kill switch (fails closed)
`killSwitch(root)`: `.company/afk-off` exists as anything (file, folder, link) → `kill-switch`; an `lstat` error other than ENOENT → `kill-switch-unreadable`. Checked at run start and before every task.

## Policy keys (all required, no other key)
| Key | Value |
|---|---|
| `v` | `1` |
| `repo` | `<owner>/<name>`, each `^[A-Za-z0-9_.-]{1,100}$` |
| `max_tasks` | integer 1-10 (the N of a run) |
| `tiers` | exactly `["low"]` in v1 |
| `distro` | exactly `"aico-afk"` |
| `egress_allowlist` | 0-20 host names, `^[a-z0-9.-]{1,253}$`, no wildcard (the proxy address is added by the loop) |
| `protected_paths` | 1-100 paths (plan-tasks path rule); must hold `.github/`, `.claude/`, `.githooks/`, `hooks/`, `.husky/`, `CLAUDE.md`, `.gitattributes`, `.gitmodules`, `.company/` |
| `push_token_env` | `^[A-Z][A-Z0-9_]{2,40}$`, the host env variable holding the push token |
| `model_key_env` | same shape, the host env variable holding the model key the proxy adds |
| `proxy_port` | integer 1024-65535 |
| `exec_timeout_min` | integer 5-120 |
| `licence_check` | `null`, or `{ "date": "YYYY-MM-DD", "list_sha256": "<64 hex>" }`: the CEO's recorded licence check of the runbook package list |

## Results
`loadPolicy(root) → { ok: true, policy } | { ok: false, cause }`. Causes: `kill-switch`, `kill-switch-unreadable`, `policy-missing`, `policy-unreadable` (link, more than one hard link, over 64 KiB, bad JSON), `policy-version`, `policy-invalid:<key>` (key echoed only when it is a known key, else `?`). The kill switch is checked first.

## Licence gate
A real run needs `licence_check` set and `list_sha256` equal to SHA-256 of the package list section of the AFK runbook (documentation/afk-runbook.md, section `## Packages`), else preflight cause `licence-unchecked`. Dry runs and tests never check it.

## Compatibility
New Contract. A new optional key is a minor bump; a widened `tiers` or a removed required protected path is a major and a Plan Gate item.
