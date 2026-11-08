# 0067 AFK runs in a dedicated WSL2 distro behind sandbox-runner; credentials stay on the host

Status: proposed (Plan Gate, task 2026-11-08 20.27 - Pocock Large Items). Contracts: `docs/contracts/sandbox-runner.md`, `docs/contracts/afk-policy.md`, `docs/contracts/afk-run.md`.

The Claude Code built-in sandbox does not run on native Windows and the CEO chose WSL2 on his machine (brainstorm Q-3, Q-8, Q-9), so AFK runs in an `aico-afk` distro with automount and interop off and an egress allowlist, behind `sandbox-runner` v1 so a Docker adapter can replace it. No credential enters the sandbox: the model key is added by a host proxy that accepts only a per-run token revoked at the end, and only the host, from a clean clone after its own diff gate, pushes `aico/afk-*` branches with a one-repo token that GitHub rulesets keep off main and tags.
