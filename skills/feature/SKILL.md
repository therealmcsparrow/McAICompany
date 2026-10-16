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
2. `aico:architect` ∥ `aico:ui-ux-designer` (skip the designer if there's no UI): Core list, Contracts and Module map, plus flows/wireframes.
   **→ Plan Gate** (CEO approves Core and Contracts)
3. Builders, one Step per Module, in parallel when their Contracts are settled: `aico:backend-engineer` / `aico:frontend-engineer` / `aico:desktop-engineer` / `aico:ai-data-engineer`, as the Module map says.
4. `aico:code-reviewer` ∥ `aico:qa` ∥ `aico:security`, with Fix rounds per `aico:pipeline` (max 2).
5. `aico:writer`: user docs and release notes (if user-facing).
   **→ Ship Gate**
6. `aico:devops`: release/deploy as approved.
