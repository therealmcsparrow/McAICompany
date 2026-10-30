# Lessons

## In short
When a run ships, the Lead writes up to three one-line lessons. Later runs read them, so the company improves a little each time.

## How it works
1. **→ Ship Gate** After the run ships, the Lead appends up to three lessons to `.company/lessons.md`.
2. Each lesson gets a class and a target.
3. Later runs pass the relevant lines to each Role.

## Technical details
When a run ships, the Lead appends up to three one-line **Lessons** to `.company/lessons.md`. Later runs read it and pass the relevant lines to each Role, so the company gets a little better each time.

Since `lessons` v2.0 each new lesson has a **class** and a **target**. A `mechanical` lesson is a failure a script could catch; its target is a proposed check, `check: script|lint|test <name>`. A `judgement` lesson needs a reader's call; its target is `standard: .company/standards.md`, `standard: skills/review/SKILL.md` or `standard: skills/review/references/<name>.md`. A target that names `CLAUDE.md`, `AGENTS.md` or an agent prompt is refused. `lessons accept` refuses a lesson without a class and a target, and `lessons lint` reports a malformed line. Lessons written before v2.0 stay readable, show as unclassified and are never rewritten. The change is breaking and is listed in the [changelog](../../CHANGELOG.md).
