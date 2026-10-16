---
name: handoff
description: Use when starting or finishing any aico Step. Defines what a Role may read at the start and the one Handoff file it must write at the end.
---

# Handoff

Every Step starts with a fresh context. The Handoff is the only memory between Steps.

## Starting a Step

Your dispatch prompt gives you:
- **Input Handoffs**: paths under `.company/work/<task>/`
- **Output path**: the one Handoff file you will write
- **Goal**: what this Step must deliver

Rules:
1. Read the input Handoffs first, then only the `.company/project.md` sections you need. Don't read other Steps' Handoffs or browse `.company/work/` to "get context".
2. **Input Handoffs missing *or* output path missing → stop.** Write nothing else. Return `blocked — missing handoff`, and leave it to the Lead to re-dispatch. Never reconstruct context by guessing. The only exception is a dispatch that literally says `Input Handoffs: none: first Step` and quotes the CEO's request.
3. Something the Handoff doesn't answer and the code doesn't show is a blocker. Record it; don't invent it.

## Finishing a Step

Write **exactly one** file at the output path, in this shape:

```markdown
---
step: 03
role: backend-engineer
task: <task-slug>
status: done | blocked | needs-ceo
round: 0            # Fix round this Step belongs to (0 = first pass), copied from the dispatch
---
## Did
- What changed, as facts, with file paths. No narrative.
## Decisions
- Decision — why. (Anything another Role must respect.)
## Blocking
- Issues that must be fixed before the next Step. Empty if none.
## Nits
- Non-blocking remarks. These never trigger a Fix round.
## Next
- What the next Step needs to know or do. Name the Role if obvious.
```

- `needs-ceo`: you need a decision only the CEO can make, e.g. a change to Core, a breaking Contract change, or a scope change. Put the question under Blocking.
- Keep it under ~60 lines. Link to files; don't paste code.
- Your final reply to the Lead is one line: `<status> — <output path>`.
