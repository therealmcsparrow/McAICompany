# Contract: project-init v1

Provider: `scripts/project-init.mjs` (Node built-ins, plus `company-type.mjs` for the type registry and `language.mjs` for tag checks). Consumer: `aico:lead` (guided first product, `skills/lead/references/first-product.md`).
Uses: the project template `skills/lead/references/project-template.md` and the readers `company-type` v1 and `aico-language` v1.
Rationale: a new CEO reaches the Brief Gate through forms alone; the profile is written from checked answers, never by hand.

## Command
`node scripts/project-init.mjs write <answers.json>` from the product root. Any other argument shape: `refused: usage: project-init.mjs write <answers.json>`, exit 3. Success: `wrote .company/project.md`, exit 0. Every refusal: `refused: <reason>`, exit 3, nothing written.

## Answers file
A plain file (not a link), at most 32 KiB, checked before `JSON.parse`, holding one JSON object. Keys are exactly the template's one-line keys without `standards` (`product_type`, `engagement`, `client`, `audience`, `goal`, `stack`, `languages`, `voice`, `license`, `jurisdiction`), plus `personas` (a list of 0 to 5 strings) and optionally `company_type`. A missing or unknown key is refused (an unknown key is reported by length only). Keys are read with `Object.hasOwn`; values are never merged into another object.

## Values
- One line, 1 to 200 characters, a string, well-formed Unicode, no C0, DEL or C1 control, no zero-width or bidi mark or control, no line or paragraph separator, no leading or trailing space, and no `<!--` or `-->`.
- `product_type` is `web`, `desktop` or `game`; `engagement` is `own` or `client`; `voice` is `clear`, `bold` or `technical`.
- `languages` is 1 to 8 different comma-separated BCP 47 tags, each checked by `language.mjs` and written in canonical form.
- `company_type` is a key of the `company-type` registry; absent means the default (software), and no line is written.
- Each persona is one line by the same rules.
A refusal names the key and the rule, never the value.

## Output file
The template with each header key line filled, a `company_type: <id>` line before `product_type:` when given, the persona lines in place of the Personas placeholder when there are any, and all other template text as it is. LF only, ends with a line feed.

## Write rules
`.company` is created when absent; a link or non-folder at that path is refused. An existing `.company/project.md`, or a link at that path, is refused and left untouched. The text goes to a temporary file in `.company`, then a hard link makes it `project.md` (it fails when the name is taken, so a file made in between is never replaced), then the temporary file is removed. A failure leaves no temporary file.

## Compatibility
v1. A new key or a rule change that refuses answers accepted today is a major bump.
