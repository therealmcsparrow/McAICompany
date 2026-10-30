# Test a local copy

## In short
To try the plugin from a folder on your computer instead of the installed version, start Claude Code with that folder. This page shows the command and how to confirm the copy loaded.

## How it works
1. Start Claude Code with `--plugin-dir` and your folder in quotes.
2. The local copy replaces the installed plugin of the same name for that session.
3. To confirm it loaded, add `--debug-file` and search the log for the line `hooks module aico@inline loaded`.
4. If the log says `Plugin path does not exist` instead, the path was wrong; check the quotes and slashes.

## Technical details
To try the plugin from a checkout instead of the installed version, start Claude Code with the folder, in quotes:

```
claude --plugin-dir "Z:/projects/aicompany"
```

Use your own path. Keep the quotes. In Git Bash, an unquoted path with backslashes (`Z:\projects\aicompany`) loses the backslashes and becomes `Z:projectsaicompany`. Claude Code then skips the missing folder without an error and starts on the installed version, so you see no mods from your copy. Forward slashes in quotes work in PowerShell, cmd and Git Bash.

The local copy replaces the installed plugin of the same name for that session. Claude Code also writes an untracked `tsconfig.json` into the plugin folder on each start. It is not part of the plugin.

### Confirm the load in the debug log

Add `--debug-file` to write a log:

```
claude --plugin-dir "Z:/projects/aicompany" --debug-file "C:/temp/c.log"
```

Search the log for this line:

```
hooks module aico@inline loaded
```

If it is there, the mods loaded. If the log says `Plugin path does not exist` instead, the path was wrong; check the quotes and slashes above.

Back to [Mods](README.md).
