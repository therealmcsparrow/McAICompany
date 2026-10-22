---
name: help
description: Explain the aico commands. No argument lists them all; with a command name, shows its options and what it does. Also what `/aico:<command> help` runs.
disable-model-invocation: true
argument-hint: [command]
---

# Help

Read-only: change no file, dispatch no Role, start nothing. Plugin root = two folders above this skill's base directory. The source is `<plugin root>/documentation/commands.md`; each command's `argument-hint` in `<plugin root>/skills/<name>/SKILL.md` is the authority on its options.

1. **No argument** → list every command from `commands.md`, grouped by its `##` sections: `` `/aico:<name> <options>` `` and one line on what it does. End with: "`/aico:help <command>` or `/aico:<command> help` for details."
2. **A command** (`feature`, `/aico:feature` and `aico:feature` all match) → find its `### /aico:<name>` entry and answer with:
   - **Usage:** the syntax line.
   - **Options:** each argument and value from the syntax line, one line each on its effect: required `<…>` vs optional `[…]`, the default when it's left out, and what each named option (e.g. `full`, `listen`, `turns=N`) changes. Take the effects from the entry; where the entry is silent, read that command's `SKILL.md`; never invent one.
   - **What it does:** the entry's "What it does" and "How it runs" in at most 6 lines, Gates marked, and whether it changes code or is read-only.
   - **You get** and **Example**, as in the entry.
3. **Unknown name** → say so and show the closest matches from the list in step 1. A Role name (e.g. `security`) → say it's a Role, not a command, give its one line from `documentation/roles.md`, and show how to summon it ("use the aico security agent on …").

**Language (§1.6):** resolve it as in `aico:pipeline` Setup §1.6 (`node "${CLAUDE_PLUGIN_ROOT}/scripts/language.mjs"`, first field; invalid or failing → `en`) and write your reply in it. Command names, options, flags and example commands stay as written. With `en` nothing changes.

Never end with a question; this is a reply, not a form.
