---
name: feature
description: Playbook. Build a feature or new product end to end, from brief to shipped, with Brief, Plan and Ship Gates.
disable-model-invocation: true
argument-hint: <feature description>
---

# Playbook: feature

Run with `aico:pipeline`. Steps (∥ = dispatch in parallel):

1. `aico:product-manager`: brief and acceptance criteria from the CEO's request.
   **→ Brief Gate**
2. `aico:architect` ∥ `aico:ui-ux-designer` (skip the designer if there's no UI) ∥ `aico:brand-artist` (only if `## Art direction` is empty or new Assets are needed): Core list, Contracts and Module map, plus flows/wireframes.
2b. UI work: one `aico:persona-tester` per Persona, in parallel, on the design. S1 findings go back to the designer (Fix round rules apply).
   **→ Plan Gate** (CEO approves Core, Contracts and Art direction)
3. Builders, one Step per Module, in parallel when their Contracts are settled: `aico:backend-engineer` / `aico:frontend-engineer` / `aico:desktop-engineer` / `aico:ai-data-engineer`, as the Module map says.
3b. Assets the build needs: `aico:brand-artist` / `aico:motion-artist` / `aico:game-artist`, in parallel with the builders.
4. `aico:code-reviewer` ∥ `aico:qa` ∥ `aico:security`, plus for UI work `aico:hands-on-tester` (one per Persona) ∥ `aico:accessibility-tester`. Fix rounds per `aico:pipeline` (max 2). Usability S1 findings count as Blocking.
5. `aico:writer`: user docs and release notes (if user-facing).
   **→ Ship Gate**
6. `aico:devops`: release/deploy as approved.
