---
name: feature
description: Playbook. Build a feature or new product end to end, from brief to shipped, with Brief, Plan and Ship Gates.
disable-model-invocation: true
argument-hint: <feature description>
---

# Playbook: feature

**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `feature` and stop.

Run with `aico:pipeline`. Steps (∥ = dispatch in parallel):

1. `aico:product-manager`: brief and acceptance criteria from the CEO's request.
   **→ Brief Gate**
1a. Design skills (`design-skills-section` v1), only when the product has UI (`product_type` web, desktop or game, or the brief has UI work) and `## Design skills` in `.company/project.md` is stale (empty, or newest `approved:` over 180 days old). Otherwise skip silently.
   a. Dispatch `aico:design-researcher` (inputs per its Role). It recommends at most 5 skills and installs nothing.
   b. One form for the CEO: approve the set / change / skip. Nothing is written before the answer.
   c. Approved: the Lead writes `## Design skills` lines in the exact DS format, with today's `approved:` date. Never write a line that fails the DS allow-list (`source` is a repo, a plugin, or a backticked command byte-identical to a `deps/skills.json` `install` with the same `name`); drop it and say so.
   d. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install-skills.mjs" design --project .company/project.md --dry-run`. Show the printed commands, the telemetry line from `skills-manifest` v2, and ask one form: Install (Recommended) / Skip. Install: same command without `--dry-run` (project scope, product root), then tell the CEO to `/reload-plugins`. Skip: record `degraded: missing <name>, <name>` in the Handoff and Gate summary. An `ERROR design skill line <n>` means: install nothing, send `Design skills: none`, name line `<n>` in the Gate summary. The run continues either way.
   e. Install artifacts (`.agents/`, `.claude/skills/`, `skills-lock.json`) are never committed; the summary names them. Commit the `## Design skills` change with the run's other work.
2. `aico:architect` ∥ `aico:ui-ux-designer` (skip the designer if there's no UI) ∥ `aico:brand-artist` (only if `## Art direction` is empty or new Assets are needed): Core list, Contracts and Module map, plus flows/wireframes. The Lead also asks the Architect for S/M/L per Module.
2a. Spikes per `aico:pipeline` if the Architect listed any (show the result at the Plan Gate).
2b. UI work: one `aico:persona-tester` per Persona, in parallel, on the design. S1 findings go back to the designer (Fix round rules apply).
2c. `aico:senior-engineer`: mode **research** if any pack is missing, stale or new to the project, else **map** (`aico:ruleset`).
2d. `aico:architect`: ruleset sign-off, only when Must rules were added or changed. Otherwise say "sign-off skipped" at the Plan Gate. A rejected rule goes back to the Senior Engineer once; still rejected → the CEO decides at the Plan Gate.
   **→ Plan Gate** (CEO approves Core, Contracts and Art direction)
3. Builders, one Step per Module, in parallel when their Contracts are settled: `aico:backend-engineer` / `aico:frontend-engineer` / `aico:desktop-engineer` / `aico:ai-data-engineer` / `aico:game-engineer`, as the Module map says.
3b. Assets the build needs: `aico:brand-artist` / `aico:motion-artist` / `aico:game-artist`, in parallel with the builders.
4. `aico:code-reviewer` ∥ `aico:qa` ∥ `aico:security` ∥ `aico:senior-engineer` (compliance) (∥ `aico:legal` when the feature adds AI, payments or personal data, per `aico:eu-compliance`), plus for UI work `aico:hands-on-tester` (one per Persona) ∥ `aico:accessibility-tester`. Fix rounds per `aico:pipeline` (max 2). Usability S1 findings count as Blocking.
5. `aico:writer`: user docs and release notes (if user-facing), then `aico:localizer` if `languages:` lists more than one.
   **→ Ship Gate**
6. `aico:devops`: release/deploy as approved.
