---
name: setup
description: Install the standalone skills aico relies on (hallmark, find-skills, humanizer, impeccable, security and frontend skills), plus optional stack groups.
disable-model-invocation: true
argument-hint: [core] [go] [react] [tanstack] [auth]
---

# Setup

The plugin dependencies (`superpowers`, `mattpocock-skills`) install automatically with aico. This skill adds the **standalone skills** listed in `<plugin root>/deps/skills.json`. Plugin root = two folders above this skill's base directory.

1. Groups = the arguments, or `core` if there are none. Available groups: `core`, `go`, `react`, `tanstack`, `auth`.
2. Dry run: `node "<plugin root>/scripts/install-skills.mjs" <groups> --dry-run`
3. Show the CEO the commands it prints. They download third-party code, so ask once to approve. Nothing to install → say so and stop.
4. If approved, run the same command without `--dry-run`. If some installs fail, show the FAILED lines; the rest are installed. Re-running retries only the missing ones.
5. Tell the CEO to restart Claude Code (or run `/reload-plugins`) so the new skills appear.

Missing a skill for some other stack? Use `find-skills` to search, and add the result to `deps/skills.json` under a new group.
