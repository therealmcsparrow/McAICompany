---
name: brainstorm
description: Playbook. The CEO pitches an idea, the relevant Roles weigh in over rounds until the CEO says done, then the idea is built, put on the roadmap, kept as nice-to-have or parked.
disable-model-invocation: true
argument-hint: <idea | brainstorm file to reopen>
---

# Playbook: brainstorm

You are the Lead, moderating. Roles think; nobody builds. No Gates, no branch, no `.company/work/` Handoffs: this Playbook skips `aico:pipeline` setup except the Project and Company profile (§1.2, §1.4). Read-only for every Role: no code, no file edits.

## Folders and file
`.company/brainstorms/` while it runs, then one of `.company/roadmap/`, `.company/nice-to-have/`, `.company/parked/`.
File name: `YYYY-MM-DD HH.MM - <Short Topic>.md` (local time at start; topic at most 5 words, Title Case, no `\ / : * ? " < > |`). Never a `:` in the name.

```markdown
---
topic: <one line, the CEO's idea>
started: 2026-10-19 14.30
status: open          # open | built | roadmap | nice-to-have | parked
roles: product-manager, architect, …
---
## Summary            # written at close
## Rounds
### Round 1 — ideas
<digest>
**CEO:** <the CEO's reply, verbatim>
```

## 1. Kickoff
1. Argument is an existing brainstorm file (in any of the four folders) → **reopen**: `git mv` it back to `.company/brainstorms/`, set `status: open`, read its Summary and last round, continue at §2.
2. Otherwise read the idea, `.company/project.md` (if any) and `.company/lessons.md` (if any). Pick the **4–8 Roles** whose angle matters (the Role table in `aico:lead`). Create the file.
3. Tell the CEO in one line: topic, Roles, mode (**ideas** unless the CEO named another). Then start round 1.

## 2. Rounds
Dispatch prompt per Role (nothing more):
```
Goal: Brainstorm only, from your Role's angle. Give up to 3 ideas, the biggest risk or cost, and 1–2 questions for the CEO. Max 150 words. No code.
Input: <absolute path to the brainstorm file> (the idea, earlier rounds and the CEO's replies)
Output: your reply only. Write no files and no Handoff.
Project profile: .company/project.md
Company profile: <absolute path to PROFILE.md>
```
Modes:
- **ideas** (default): all chosen Roles in parallel, one message.
- **debate:** as ideas, then a second parallel pass where each Role also gets the others' replies (pasted under `Other Roles:`) and agrees, challenges or builds on them, max 100 words.
- **moderated:** one Role at a time. You pick who speaks next from what was just said; each gets the replies so far this round. 3–5 turns per round.

After each round append a **digest** to the file (max 250 words): strongest ideas (with the Role), disagreements, risks, and the open questions for the CEO. Show it to the CEO and end with:
`Reply to steer · "mode ideas|debate|moderated" · "+<role>" / "-<role>" · "done" to wrap up`
Append the CEO's reply verbatim under the digest, apply any mode or Role change, and run the next round on it. Never end on your own and never cap the rounds; only the CEO's "done" (or "stop", "wrap up", "that's it") ends it.

## 3. Close
1. Write `## Summary` at the top of the body: the idea in one paragraph, decisions made, open questions, and size and risk (ask the Architect for S/M/L in the last round if it was in the room; else say "not estimated").
2. Ask the CEO in one AskUserQuestion:
   1. **Create a plan and implement**
   2. **Roadmap**
   3. **Nice to have, not now**
   4. **Park for later discussion**
3. Apply it:
   - **1** → `status: built`, file stays in `brainstorms/`. Then follow `aico:feature` in place with the brainstorm file as the CEO's request: the product-manager's brief starts from its Summary. All its Gates apply.
   - **2 / 3 / 4** → `status: roadmap | nice-to-have | parked`; `git mv` (or move, if untracked) the file to `.company/roadmap/`, `.company/nice-to-have/` or `.company/parked/`.
4. Commit only the brainstorm file (and its old path on a move): `git commit -m "docs: brainstorm <short topic>"`. On choice 1 commit before `aico:feature` creates its branch. Never push.
5. Tell the CEO where the file is and that `/aico:brainstorm "<path>"` reopens it.
