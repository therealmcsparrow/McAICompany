---
name: triage
description: Playbook. Classify a request by size, risk and product type, then recommend the shortest valid route before any build starts, so small work doesn't pay full ceremony.
disable-model-invocation: true
argument-hint: <request>
---

# Playbook: triage

**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `triage` and stop.

A fast pre-router. It builds nothing and dispatches no Role; it ends by recommending a route the CEO approves. Use it when a request's size or risk is unclear, or as the first step of `aico:lead`.

0. Resolve the language once (`aico:pipeline` §1.6) and use it for your reply and form; triage dispatches no Role.
1. Run `aico:pipeline` Setup §1.0 first (the type check; refused → show the line and stop). Recommend only Playbooks in its `playbooks`; one outside them is never named as a route. Read `.company/project.md` (stack, product type, approved Core) and the request. Classify:
   - **Size:** XS (one-line / copy / config) · S (one Module, no Contract change) · M (several Modules) · L (new product or Core/Contract change).
   - **Risk tier:** `low | medium | high` — forced **high** for anything touching auth, payments, personal data, migrations or a Contract (`aico:handoff`).
   - **Type:** feature · bug · refactor · launch · audit · incident · upkeep · content · research (find out online first: feasibility, market, quick wins, design skills).

2. Recommend the **shortest valid route**, never shorter than the risk allows:
   - XS + low, no Contract/Core, no security surface → a direct Lead route (the one builder, then one reviewer) via `aico:lead`.
   - bug → `aico:fix` · refactor → `aico:refactor` · go public → `aico:launch` · assess → `aico:audit` · outage/security event → `aico:incident` · upkeep → `aico:maintain` · research → `aico:research` · otherwise a feature → `aico:feature`.
   - **Risk overrides size:** any `high`-risk item keeps the full reviewer lane (code-reviewer ∥ qa ∥ security) and every Gate, however small. Triage shortens ceremony, never oversight.

3. Present one line to the CEO: size, risk tier, type, and the recommended route with the Gates it keeps. **→ Brief Gate** (a form: Approve / Change / Stop). On approve, hand straight to the chosen Playbook or `aico:lead` route; the risk tier travels into every dispatch.

Triage is advisory: it never skips a Gate a Playbook mandates, and the CEO can always choose a longer route.
