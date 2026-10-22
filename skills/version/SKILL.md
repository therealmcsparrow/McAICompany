---
name: version
description: Show which version of the aico plugin is installed, with its latest changelog entry.
disable-model-invocation: true
---

# Version

**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `version` and stop.

Plugin root = two folders above this skill's base directory.

1. Read `<plugin root>/.claude-plugin/plugin.json` and take `name` and `version`.
2. Read the first `## [x.y.z] - date` entry in `<plugin root>/CHANGELOG.md`, if the file exists.
3. Reply in at most three lines: `aico <version>`, the changelog date and a one-line summary of that entry, and the plugin root path. If `plugin.json` can't be read, say so and show the path you tried.

Write the reply in the run language (§1.6): resolve it as in `aico:pipeline` Setup §1.6 (`node "${CLAUDE_PLUGIN_ROOT}/scripts/language.mjs"`, first field; invalid or failing → `en`). The version number, dates and paths stay as read.

Read-only: change no file and dispatch no Role.
