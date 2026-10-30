# `/aico:maintain`

`/aico:maintain [drift]`

## In short
**What it does.** Routine upkeep: outdated dependencies, known vulnerabilities, license re-check, CI health and stale rule packs — then applies the upgrades you pick. With `drift` it also runs an informational behaviour check: the Architect compares a few Contracts with the code and lists differences (missing feature, incomplete model, logic shortcut, architectural divergence), each with the Contract line and code line it rests on. The drift report is linked under Minor in the maintenance report, never blocks a Gate and changes no code. Without the argument no drift check runs.

**When to use it.** On a schedule (monthly works well) or whenever the project has drifted.

**Help:** `/aico:maintain help` (or `--help`) explains the command without running it.

## How it works
1. In parallel: **Security** (dependency vulnerabilities; stops for [`/aico:incident`](incident.md) if one is exploited), **Legal** (license re-check), **DevOps** (outdated deps, SBOM status, CI health), **Senior Engineer** (refresh: stale packs, changed guidance, new advisories).
2. The Lead merges a report: Critical / Important / Minor with owner and size. **→ Brief Gate** (you pick upgrades).
3. The owning engineer applies each chosen upgrade group, then **Code Reviewer** ∥ **QA** ∥ **Security**. **→ Ship Gate.**

## Technical details
**You get.** `.company/work/<slug>/maintenance-report.md` and the upgrades you approved, shipped.

**Example.** `/aico:maintain`
