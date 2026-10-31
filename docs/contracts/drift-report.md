# Contract: drift-report v1.1

Provider: `scripts/drift-report.mjs` (Node built-ins only; read-only, writes nothing). Writer of the report: the Architect, in the one drift Step of `/aico:maintain drift`. Consumers: the Lead of `aico:maintain` (`pick`, `lint`) and the maintenance report (a link under Minor). Uses: `contract-index` v1 (`buildIndex`). Rationale: `docs/adr/0042-drift-report-informational.md`.
The report is informational. It never changes an exit code of `check`, a Gate or CI, and no `check` script or CI file reads it; the deterministic Contract drift check (`contract-index` v1) stays the one that can fail CI.

## When it runs
`/aico:maintain drift` is the only way to choose it. The Lead runs `pick` and dispatches `architect` once with the picked Contracts as its Goal input. Without the `drift` argument no drift Step is dispatched and `pick` is not run.

## `pick [--max <1-8>]`
Lists Contracts from the `contract-index` whose `Provider:` line begins with a backticked `scripts/<name>.mjs` that exists as a plain file. Order: never checked first, then the oldest date of a `checked:` entry in earlier reports (`.company/work/<slug>/drift-<YYYY-MM-DD>.md`), ties by name. At most 8 (default 8); `--max` is one digit 1-8, anything else → `refused: usage: pick [--max <1-8>]`, exit 3. One line per Contract: `<name> <contract file> <script> <last checked date|never>`, then `pick: <k> of <n> contracts`; no candidate → `pick: none`. Contract names come from the index only; names in a report that are not in the index are ignored and never joined into a path. A report that is not a plain file, is over 64 KiB or fails the frontmatter rule is skipped. Read-only, exit 0.

## Report
`.company/work/<work folder>/drift-<YYYY-MM-DD>.md` (the folder passes `isWorkFolder` of `work-folder-name` v1: a new name or a legacy slug; a calendar date). v1.1 is additive: the path is split at its slashes and the folder segment is checked, so a folder name with spaces is accepted. `pick` reads reports only from folders that pass the same check:

```markdown
---
checked: [<contract>, …]
date: <YYYY-MM-DD>
---
## Items
- <kind> | <doc path>:<n> | <code path>[:<n>] | <one line>
```

- Frontmatter: exactly `checked` (1 to 40 names, each in the `contract-index`) and `date`.
- `## Items` is the only heading. Each line is an item or the one line `- none` (alone). At most 500 items; a line is at most 1000 characters.
- `kind`: `missing-feature` (the Contract promises it, the code lacks it), `incomplete-model` (the code handles only part of what the Contract describes), `logic-shortcut` (the code gets the result by a path the Contract does not allow), `architectural-divergence` (the code is structured against the Contract or an ADR).
- Paths: forward slashes, `^[A-Za-z0-9._@+/-]{1,200}$`, the `plan-tasks` v1 path rule (no `.` or `..` segment, none starting with `-` or ending with `.`, no `.git`, no `.env*`). The doc path has a line number, the code path may have one (1 to 6 digits). The text is 1 to 300 characters with no control, bidi or zero-width character and no ` | `.

## `lint <report>`
The report path is `.company/work/<work folder>/drift-<YYYY-MM-DD>.md` (relative to the product root, or absolute inside it); any other name → `refused`, exit 3, as for a control character or an argument over 4096 characters. Lint checks the shape above, the kind (an exact list) and that both paths of each item pass the real-path read rule as plain files: the real path of the lexical path equals it (no link or junction on it), it lies inside the real product root, `lstat` shows a regular file with one hard link, and the opened handle matches. A path that misses the rule is a lint error; there is no fallback to the lexical path. The report is read by the same rule, at most 64 KiB, UTF-8; unreadable → `drift-report: report unreadable`, exit 1.
Output: one `ERROR line <n>: <reason>` per problem (at most 50 shown, fixed words only, no report text), then `drift-report: <e> errors`. Exit 2 when e > 0, else 0. Errors go back to the Architect once; the Lead does not run a second round.

## Maintenance report
The Lead links a lint-clean report under Minor in `maintenance-report.md` with the item count. A report that still fails after the one correction is linked as "report failed lint" and its items are not copied. It adds no Gate, Fix round or Ship Gate line.
