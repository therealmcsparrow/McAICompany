---
name: cooler
description: Playbook. Random colleagues chat at the water cooler about the project, unmoderated, swapping thoughts, ideas and problems; others walk up or leave. Recorded, nothing built.
disable-model-invocation: true
argument-hint: [topic] [turns=N | listen]
---

# Playbook: cooler

**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `cooler` and stop.

An unmanaged chat. You are the Lead, but you only set the scene, pass the turns and take the minutes; you never steer, summarize mid-chat or pick a winner. Roles think aloud; nobody builds. No Gates, no branch, no `.company/work/` Handoffs: this Playbook skips `aico:pipeline` setup except the Project and Company profile (§1.2, §1.4). Read-only for every Role: no code, no file edits.

## File
`.company/cooler/YYYYMMDD-HHMM-<topic-slug>.md` (local time at start; slug at most 5 words, lowercase, hyphens, no `\ / : * ? " < > |`).

```markdown
---
topic: <the CEO's topic, or the one the first speaker raised>
started: 2026-10-22 14.30
mode: natural          # natural | turns=N | listen
people: backend-engineer, ui-ux-designer, …   # everyone who was there at any point
---
## Overheard          # written at the end
## Chat
*architect and qa are at the cooler.*
**architect:** …
*security walks up.*
```

## 1. Scene
1. Parse the arguments: `turns=N` → **turns** mode (end after N turns); `listen` → **listen** mode; neither → **natural**. The rest is the topic (may be empty).
2. Read `.company/project.md`, `.company/lessons.md` and the latest few files in `.company/roadmap/` and `.company/cooler/` (any that exist), so you can brief the colleagues on what's going on.
3. Pick **2–3 Roles at random** from the agent names in `<plugin root>/agents/` (plugin root = two folders above this skill's base directory). Use real randomness, e.g. `node -e "const a=process.argv.slice(1);console.log(a.sort(()=>Math.random()-.5).slice(0,3).join(' '))" <names…>`; never choose by relevance.
4. Create the file with the opening line of who's at the cooler. Tell the CEO in one line: who's there, the topic (or "open chat"), the mode.

## 2. Turns
One speaker per turn, sequential, never in parallel. The first speaker opens: the topic, or (no topic) something on their mind about the project. After that the next speaker is whoever would naturally reply; vary it, and nobody speaks twice in a row.

Dispatch prompt per turn (nothing more):
```
Goal: You're at the office water cooler with colleagues, off the clock. Read the chat and say your next line, in your Role's voice: a thought, an idea, a gripe, a worry, a question to someone there, or a change of subject. Casual, max 80 words. No code. Say "PASS" if you have nothing new to add.
Input: <absolute path to the cooler file> (the chat so far)
Project brief: <3–5 lines from §1.2: product, current work, recent lessons>
Output: your line only. Write no files and no Handoff.
Project profile: .company/project.md
Company profile: <absolute path to PROFILE.md>
```
Append each line verbatim as `**<role>:** <line>` (a PASS as `*<role> sips their coffee.*`).

**Walk-ups and walk-offs.** Every 3 turns roll: about 1 in 3 a random Role not at the cooler walks up (raise it to 1 in 2 when the talk is squarely in that Role's field), and about 1 in 4 someone who's been there 4+ turns leaves. Keep 2–5 people at the cooler. Note each change in italics (`*legal walks up.*`, `*devops heads back to their desk.*`). A newcomer speaks next or soon.

**Ending** by mode:
- **natural** (default): ends when everyone at the cooler PASSes in a row, or at 20 turns.
- **turns=N:** ends after exactly N turns (PASSes count).
- **listen:** as natural, but every 4 turns ask the CEO in one form (`aico:pipeline`): Keep listening (Recommended) / Chime in / Stop. A chime-in comes through "Other" and goes in verbatim as `**CEO:** …`; the colleagues may answer it.

Close the chat with an italic line (`*Break's over.*`).

## 3. Overheard
1. Write `## Overheard` at the top of the body, max 150 words: ideas, problems and worries that came up, each with who raised it. No verdicts, no plan, no ranking.
2. Commit only the cooler file: `git commit -m "docs: cooler <topic-slug>"`. Never push.
3. Tell the CEO the file path and the Overheard list. Nothing is routed: the CEO can take anything further with `/aico:brainstorm "<path>"` or `/aico:lead`.
