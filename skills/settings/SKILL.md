---
name: settings
description: Open the local aico settings page in the browser to set Role model and effort, language, profile, pipeline options and Gates, as a user default or a per-project override. Use for /aico:settings.
disable-model-invocation: true
argument-hint: "[help]"
---

# Settings

**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `settings` and stop.

The settings page is a small local server, `${CLAUDE_PLUGIN_ROOT}/scripts/settings.mjs`. It owns all validation and all file changes. Never edit `config.json`, `settings.json` or `.company/project.md` yourself. Run it from the product repo (the current directory).

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/settings.mjs" serve` with the Bash tool's `run_in_background`. It never exits on its own right away, so do not wait for it.
2. Read the background output for the line `aico settings: <url>`. If it does not appear, or the process exits, show what it printed and stop.
3. Give the CEO the complete `<url>`, including the `?token=…` part; never shorten it. The server opens the browser itself, so say the link is there in case it did not open.
4. Tell the CEO, in a few lines:
   - The page covers Role name, model and effort; language and profile; pipeline (Fix-round limit, parallel or sequential, optional lanes); Gates (ask or auto); and each Role's personality (used only in cooler and brainstorm). Locked Gates (Ship, installs, security lanes) can only be unlocked from user settings.
   - There are two levels: your user default (`~/.mcsparrow/config.json`) and a project override (`.company/settings.json`, profile in `.company/project.md`). The project wins.
   - The page stops when Done is pressed, or after 30 minutes idle. Changes apply from the next aico run.

Write your reply in the run language: resolve it as in `aico:pipeline` Setup §1.6 (`node "${CLAUDE_PLUGIN_ROOT}/scripts/language.mjs"`, first field; invalid or failing → `en`). The URL, paths and file names stay as written.

This Playbook dispatches no Role and creates no branch or commit.
