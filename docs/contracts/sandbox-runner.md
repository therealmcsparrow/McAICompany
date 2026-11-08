# Contract: sandbox-runner v1

Status: draft until plan task T19 (run 2026-11-08 20.27 - Pocock Large Items) builds the WSL2 adapter; T19 removes this line and puts the provider paths in backticks.

Providers: scripts/afk-sandbox-wsl2.mjs (`createWsl2Runner(opts)`, adapter `wsl2`) and scripts/afk-probe.mjs (`probeChecks`, the boundary probe the adapter runs). Test double and shared suite: scripts/afk-sandbox-fake.mjs and scripts/sandbox-runner-suite.mjs, owned by QA. Consumer: the AFK loop only. Rationale: docs/adr/0067-afk-wsl2-runner.md. A Docker adapter may come later on this same Contract; the loop never knows which adapter runs.

## Adapter choice
`wsl2` on a win32 host with `wsl.exe` and the distro named in `afk-policy` v1. Any other host → `unsupported-host`. Never a fallback to running unsandboxed.

## Operations
- `start({ bundle, base, inputs, allowlist, env }) → { runId }`. `bundle`: host path of a git bundle holding `base`. `inputs`: at most 4 files `{ name, bytes }` (name `^[a-z0-9][a-z0-9.-]{0,63}$`, at most 256 KiB each), copied into the run's `in/` folder. `allowlist`: egress hosts from the policy. `env`: at most 8 variables, names `^AICO_[A-Z0-9_]{1,40}$` or `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` (the per-run proxy token, never a host credential). The adapter makes a fresh run user and folder inside the distro, clones the bundle there, fixes mounts once, then runs `probe`; a failing probe destroys the run and throws `probe-failed`.
- `probe(runId) → { pass, reasons }`. Reasons, all that apply: `automount-on`, `interop-on`, `wslconf-drift`, `mount-extra`, `windows-path-readable`, `egress-open`, `dns-open`, `redirect-open`, `credential-visible:env`, `credential-visible:git-helper`, `credential-visible:gh`, `credential-visible:ssh`, `credential-visible:claude-home`.
- `exec(runId, argv, { timeoutMs }) → { code, tail }`. Runs `argv` (array, 1-64 items) as the run user in the repo folder. No path, cwd or mount argument exists. `tail`: the last 4 KiB of output, for the host log only, never journaled. Timeout → the process tree is killed, `exec-timeout`.
- `exportBundle(runId) → { file }`. The only way out: a git bundle of `HEAD` since `base`, streamed to a new host file `.company/work/<slug>/afk/<runId>.bundle` (created with O_EXCL, at most 50 MiB).
- `destroy(runId)`. Kills the run's processes, removes its user, folder and inputs. Idempotent; also called for a crashed run on the next start.

## Errors
`unsupported-host`, `distro-missing`, `probe-failed`, `exec-timeout`, `bundle-too-large`, `run-unknown`, `adapter-error`. Each carries a `code`; messages hold no host path and no output text.

## Rules
- The host never passes a host path other than `bundle` and never mounts one.
- `runId` matches `^[0-9a-f]{12}$` and is made by the adapter.
- The shared suite runs against every adapter: the fake in CI, `wsl2` only when the environment variable AICO_AFK_REAL is `1`.

## Compatibility
New Contract. A new operation, probe reason or error is a minor bump; a new argument that carries a host path is never added.
