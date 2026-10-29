---
name: setup
description: Install the standalone skills aico relies on (hallmark, find-skills, humanizer, impeccable, security and frontend skills), plus optional stack groups. Also sets the company type and searches for skills that fit it.
disable-model-invocation: true
argument-hint: [core] [research] [go] [react] [tanstack] [auth] [type]
---

# Setup

**Help:** argument is exactly `help` or `--help` → read the `### /aico:setup` entry of `documentation/commands.md` (plugin root = two folders above this skill's base directory) and reply with its usage, options, what it does and an example, in the language of `aico:pipeline` §1.6; change nothing, start nothing, and stop.

The plugin dependencies (`superpowers`, `mattpocock-skills`) install automatically with aico. This skill adds the **standalone skills** listed in `${CLAUDE_PLUGIN_ROOT}/deps/skills.json`.

1. Groups = the arguments except `type`, or `core` if there are none (and no `type`). Available groups: `core` (also installs `research`), `research`, `go`, `react`, `tanstack`, `auth`. `core` includes `research` (find-skills, used as guidance only; no Role runs `npx skills find` or `add`).
2. Dry run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" install-skills <groups> --dry-run`. Commands use a pinned skills CLI version; the CLI sends anonymous telemetry (skill name, timestamp) to skills.sh.
3. Show the CEO the commands it prints. They download third-party code, so ask once in a form (Install / Cancel). Nothing to install → say so and stop.
4. If approved, run the same command without `--dry-run`. If some installs fail, show the FAILED lines; the rest are installed. Re-running retries only the missing ones.
5. Tell the CEO to restart Claude Code (or run `/reload-plugins`) so the new skills appear.
6. Argument `type`, or no arguments at all: continue with the company type section below. Other arguments: stop here.

Missing a skill for some other stack? Use `find-skills` to search, and add the result to `deps/skills.json` under a new group.

## Company type and skill search
No `.company/project.md` → run `aico:pipeline` §1.2 first (copy the template, fill the stack, one form), then come back here.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" company-type resolve` from the product root. A first line that starts with `refused: ` → show it and stop; nothing is written.
2. The first line ends with `from .company/project.md` → the type is already set. Say so and go to step 5; never switch it (`set` refuses).
3. The first line ends with `default: no company_type line` → run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" company-type list` and build the form from its lines (`<id>: <label>. Ship means: <ship_meaning>`), in their order, with no pre-selected option. Header `Company type`. Question: "What kind of company is this project? This sets which Roles and Playbooks aico offers, and what "ship" means here." One option per entry, the label is `id`, the description is `ship_meaning` after a short line saying what the company is. Footer: "One type per project. Free-text answers other than these four are refused with this list."
4. Only after the CEO picks an id from that list run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" company-type set <id>`, with `<id>` taken from the `list` output and never from free text. Cancel, no answer or any other text → run nothing, write nothing, say the project stays a software company, and stop. After `set` succeeded say: "Company type set to <id>. Next: aico looks for up to 5 skills that fit. Nothing installs without your answer." If `set` printed `refused: …`, show it and stop.
5. Skill search, one question: "Search for skills that fit this company? (Search / Skip)". Skip → stop. Search → follow `${CLAUDE_PLUGIN_ROOT}/skills/lead/references/skill-picks.md` as written, with these inputs:
   - §1: `skillspector.mjs detect --json`; not installed → its install form; Skip → no search.
   - §2: dispatch the `skill-researcher` with the `aico:pipeline` §2 prompt and the Goal line `Area: company-type`. The `skill search hints:` line of the `resolve` output (`skill_search.hints`, split at `; `, `none` = no hints) goes in the Goal as search hints, at most 5. The Role also reads `audience` and `goal` from the profile and asks for at most 5 picks.
   - §3 and §4 unchanged: `vet`, approve form, record into `## Skills`, Install / Skip form, `check-install`, scan, stop form.
6. This skill adds no fetch, clone or install path of its own: vet and the installer read the same source, commit and folder. It runs no removal command, and never answers the approve, Install or stop form by itself.
