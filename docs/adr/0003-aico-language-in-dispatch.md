# aico's writing language travels in the dispatch, machine-read parts stay English

The language aico writes in (`aico_language`, user default in `~/.mcsparrow/config.json`, project override in `.company/project.md`) is resolved once per run by `scripts/language.mjs` and reaches every Role as a `Language:` dispatch line; agent and skill files stay English. Frontmatter, headings, status values, tags, IDs, names and the commit `<type>` stay English so the Lead and scripts route the same in every language.

**Consequences**: one resolver to test instead of 32 Roles; with nothing set, behaviour is identical to 0.8.1 (`en`). Changing the precedence or the English-only list later is a dispatch-prompt Contract change.
