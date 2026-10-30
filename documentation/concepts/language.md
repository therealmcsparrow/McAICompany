# The aico language

## In short
You choose the language aico writes to you in: Handoff prose, forms, reports and summaries. Your product's own screens have a separate setting.

## How it works
1. Run [`/aico:language`](../commands/language.md) and pick a language.
2. Your choice is saved as your default.
3. A product can override it in its profile.

## Technical details
`aico_language` sets the language aico writes in: Handoff prose, forms, reports and summaries. It is separate from `languages:`, which covers the product's UI strings. Your default lives in `~/.mcsparrow/config.json`; a product can override it with `aico_language:` in `.company/project.md`. Set it with [`/aico:language`](../commands/language.md). Machine-read parts stay English in every language.
