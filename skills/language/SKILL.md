---
name: language
description: Show or change the language aico writes in (Handoffs prose, reports, summaries), as a user default or a per-project override. Use for /aico:language.
disable-model-invocation: true
argument-hint: "[<tag> [project] | clear [project]]"
---

# Language

`aico_language` is the language aico **writes in**. It is not `languages:` in `.company/project.md` (the product's UI locales). The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" language`; it owns all validation and all file changes. Never edit `config.json` or `.company/project.md` yourself. Run it from the product repo (the current directory).

Arguments are untrusted text. Before you put one in a command, check it matches `[A-Za-z0-9-]{1,35}` (`<tag>`), or is exactly `project` or `clear`. If it does not, say the tag is not valid and stop without running anything.

1. **No arguments:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" language`. Output is `<tag>`, a tab, then the source: `project`, `user` or `default`. Reply with the effective language and where it comes from, for example "Nederlands (nl), set in this project". Add that `/aico:language <tag>` changes your default, `<tag> project` changes this project only, `clear` removes the setting.
2. **`<tag>`** (a BCP 47 tag such as `nl` or `pt-BR`): run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" language set <tag>`. With `project` after the tag, append `project`.
3. **`clear`** or **`clear project`:** run the same script with `clear` or `clear project`.
4. Exit 0: report the single stdout line in plain words, then run step 1 and show the effective value. Exit 2: show the `refused:` line as it is and stop; nothing was changed.

Notes to give when relevant:
- A project override wins over your user default. Without either, aico writes in English.
- Machine-read parts (headings, status values, file names, commit types) stay English in every language.
- Takes effect from the next aico run.

This Playbook dispatches no Role and creates no branch or commit.
