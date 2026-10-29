# Contract: contract-index v1

Provider: `scripts/contract-drift.mjs` (Node built-ins only; read-only, writes nothing); `buildIndex(root)` and `checkDrift(root)` exported by `scripts/contract-drift.mjs`. Consumers: `scripts/check.mjs --drift` (the one call; no check logic in Core), `aico:maintain`, CI. Rationale: `docs/adr/0036-contract-index-from-headers.md`; the cite rule is `docs/adr/0007-contract-minor-versions.md`.

## Index
`buildIndex(root)` returns `Map` of name → `{ major, minor, file }`, computed from line 1 of each `docs/contracts/*.md`: `# Contract: <name> v<x>` or `v<x>.<y>` (a missing minor is 0). No other list exists. A file whose line 1 does not match is not in the index.

## Module declaration
A Module is a script in `scripts/` (not `*.test.mjs`) whose line 2 holds `contract: docs/contracts/<name>.md v<x>[.<y>]`, bare (`// contract: ...`) or inside a header sentence (`// Plan check (contract: ...). ...`). An optional line 3 `// uses: docs/contracts/<name>.md v<x>[.<y>] ...` lists Contracts the Module reads. The declared version must equal the header version exactly; a `uses` entry follows the cite rule.

## Cite rule
A cite is `<contract-name> v<x>[.<y>]` in a skill, agent, `documentation/` page, README, Contract or ADR, where the name is in the index and not part of a longer word. It is valid when the major equals the current major and the minor is not newer: an older minor of the current major is valid ("since" cites), a bare `v<x>` and `v<x>.x` mean minor 0. A newer minor or another major is an error.

## Anchors
In every Contract and ADR, a backticked token that starts in a folder existing at the repo root, with an optional `:<line>` suffix or arguments after the first space, is an anchor. Globs, `<placeholders>`, one-letter file names (examples) and `.company/` paths are skipped. The path is joined lexically under the root; a `..` segment is refused, never read. A sentence "`<name>` exported by `<path>`" also needs `<name>` exported from `<path>` (`export function|const|let|var|class <name>` or in an `export { ... }` list).

## Errors and exit
One line each, sorted by check, duplicates removed:
- `ERROR module <script> contract <c> declares v<a>, file v<b>` (also `no such Contract` when the file is not in the index)
- `ERROR <file>:<line> cites <c> v<a>, current v<b>`
- `ERROR <doc>:<line> anchor <path> missing` or `refused`
- `ERROR <contract> provider <script> lacks export <name>`

The CLI prints the lines and `<n> error(s)`; exit 1 on any error, else 0. `check.mjs --drift [root]` runs only these checks (exit 2 on bad usage); `aico:maintain` runs it and reports each line.

## Bounds
A file over 2,000,000 bytes, a link, or a folder deeper than 6 levels is skipped. All patterns are anchored or bounded: linear time on hostile text.
