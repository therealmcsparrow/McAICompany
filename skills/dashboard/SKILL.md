---
name: dashboard
description: Start the local aico dashboard, a read-only board of all runs with a drawer per run, and give the CEO its link. Use for /aico:dashboard, with an optional --lan or --port.
disable-model-invocation: true
argument-hint: "[help] [--lan] [--port <1024-65535>]"
---

# Dashboard

**Help:** argument is exactly `help` or `--help` → read `documentation/commands/dashboard.md` (plugin root = two folders above this skill's base directory) and reply with its usage, options (start, stop, `--lan` and its warning), what it does and an example, in the language of `aico:pipeline` §1.6; start nothing, and stop.

The dashboard is a small read-only local server. It writes no file and changes no run. Run it from the product repo (the current directory).

1. Allow only the flags `--lan` and `--port <1024-65535>`. Anything else → show the usage line `node --disable-proto=delete "${CLAUDE_PLUGIN_ROOT}/scripts/dashboard-server.mjs" serve [--lan] [--port <1024-65535>]` and stop.
2. Run `node --disable-proto=delete "${CLAUDE_PLUGIN_ROOT}/scripts/dashboard-server.mjs" serve` plus the flags, with the Bash tool's `run_in_background`. It does not exit on its own, so do not wait for it.
3. Read the background output for the line `aico dashboard: <url>` (with `--lan` also `aico dashboard (LAN): <url>` lines). If it does not appear, or the process exits, show what it printed and stop.
4. Give the CEO each complete `<url>`, including the `/t/<token>/` part; never shorten it. The server does not open a browser.
5. With `--lan`, repeat the server's `WARNING:` line unchanged.
6. Tell the CEO, in a few lines:
   - Every start makes a new link. An old link stops working once the server is gone.
   - Anyone with the link can read the runs until the server stops. The link is also in this session's transcript.
   - To stop: stop the background task (`/tasks`), or wait; it ends itself after 60 idle minutes.
   - The page needs no login beyond the link; with `--lan` the link is plain HTTP.

Write your reply in the run language: resolve it as in `aico:pipeline` Setup §1.6 (`node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" language`, first field; invalid or failing → `en`). URLs, flags and file names stay as written.

This Playbook dispatches no Role and creates no branch or commit.
