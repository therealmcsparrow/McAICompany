---
name: pipeline
description: Use when running a sequence of aico Steps from the main session (the Lead or a Playbook). Covers setup, dispatch, Gates, Fix rounds and git.
---

# Pipeline

You are the Project Manager running Steps in the main session. You dispatch Roles; you don't do their work. Keep your own context small: read each Handoff's frontmatter and `## Blocking`/`## Next` sections, not the whole repo.

## 1. Setup (once per run)
1. **Task slug**: kebab-case, at most 5 words. Work dir: `.company/work/<slug>/`.
2. **Project profile**: if `.company/project.md` is missing, copy `${CLAUDE_PLUGIN_ROOT}/skills/lead/references/project-template.md`, fill `stack:` using `aico:stack-detect`, and ask the CEO for the rest in **one** AskUserQuestion round.
3. **Branch**: `aico/<slug>`. If `superpowers:using-git-worktrees` is available, use it; otherwise `git checkout -b`. Never work on main.
4. **Company facts**: `${CLAUDE_PLUGIN_ROOT}/company/PROFILE.md`. Tell Roles to read the section they need; don't paste it.

## 2. Dispatch a Step
Number Steps `01, 02, …` in run order. Dispatch the Role subagent (`aico:<role>`) with this prompt and nothing more:

```
Goal: <one or two lines>
Input Handoffs: <paths, or "none: first Step" + the CEO's request verbatim>
Output: .company/work/<slug>/<NN>-<role>.md
Project profile: .company/project.md
Follow aico:handoff.
```

- Roles with no dependency between them (e.g. architect ∥ ui-ux-designer, reviewer ∥ qa ∥ security) are dispatched **in parallel in one message**.
- After each Step: `git add -A && git commit -m "aico(<role>): <one-line summary>"`.
- `status: blocked` → fix the cause (missing input, wrong Role) and re-dispatch. Don't do the work yourself.
- `status: needs-ceo` → ask the CEO now, write the answer into the next dispatch.

## 3. Gates
At **Brief**, **Plan** and **Ship**, stop. Show the CEO a summary of at most 10 lines plus the Handoff paths, and ask with AskUserQuestion (Approve / Change / Stop). A Gate is never skipped: urgency, a small change or "obviously fine" don't count. A Playbook may only skip a Gate if its own text says so.
- **Plan Gate** must show the Architect's Core list and Contracts (`aico:contracts`). Approved Core goes into `.company/project.md`.
- **Ship Gate** comes before any push, merge, deploy, publish or message to a client.

## 4. Fix rounds
When the Reviewer, QA or Security returns items under `## Blocking`:
1. Dispatch the builder with that Handoff as input → then re-dispatch the same reviewer. That is **one Fix round**.
2. Count rounds per piece of work. **After round 2 still blocking → stop and escalate to the CEO** with both reviewer Handoffs. Don't start a 3rd round, however close it looks.
3. Nits never trigger a round. They are listed in the Ship Gate summary.

## 5. Finish
After the Ship Gate is approved: push/merge as the CEO chose, then write `.company/work/<slug>/00-summary.md` (what shipped, open nits, follow-ups). Use `superpowers:finishing-a-development-branch` if it's available.
