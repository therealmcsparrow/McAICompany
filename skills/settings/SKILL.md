---
name: settings
description: Open the local aico settings page in the browser to set Role model and effort, language, profile, pipeline options and Gates, as a user default or a per-project override. Use for /aico:settings.
disable-model-invocation: true
argument-hint: "[help]"
---

# Settings

**Help:** argument is exactly `help` or `--help` → read the `### /aico:settings` entry of `documentation/commands.md` (plugin root = two folders above this skill's base directory) and reply with its usage, options, what it does and an example, in the language of `aico:pipeline` §1.6; change nothing, start nothing, and stop.

The settings page is a small local server, `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" settings`. It owns all validation and all file changes. Never edit `config.json`, `settings.json` or `.company/project.md` yourself. Run it from the product repo (the current directory).

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" settings serve` with the Bash tool's `run_in_background`. It never exits on its own right away, so do not wait for it.
2. Read the background output for the line `aico settings: <url>`. If it does not appear, or the process exits, show what it printed and stop.
3. Give the CEO the complete `<url>`, including the `?token=…` part; never shorten it. The server opens the browser itself, so say the link is there in case it did not open.
4. Tell the CEO, in a few lines:
   - The page covers Role name, model and effort; language and profile; pipeline (Fix-round limit, parallel or sequential, optional lanes); Gates (ask or auto); and each Role's personality (used only in cooler and brainstorm). Locked Gates (Ship, installs, security lanes) can only be unlocked from user settings.
   - There are two levels: your user default (`~/.mcsparrow/config.json`) and a project override (`.company/settings.json`, profile in `.company/project.md`). The project wins.
   - The page stops when Done is pressed, or after 30 minutes idle. Changes apply from the next aico run.

Write your reply in the run language: resolve it as in `aico:pipeline` Setup §1.6 (`node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" language`, first field; invalid or failing → `en`). The URL, paths and file names stay as written.

This Playbook dispatches no Role and creates no branch or commit.
