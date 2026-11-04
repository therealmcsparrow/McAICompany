# Contract: roadmap-list v1

Provider: `scripts/roadmap.mjs` (Node built-ins only; read-only, writes nothing). Consumers: `scripts/dashboard-data.mjs` (`dashboard` v1, the board's `roadmap` list), through `listRoadmap` only.
Why it exists: the roadmap is a folder of Markdown files with frontmatter; the dashboard may read only aico script JSON, so this Module turns the frontmatter into JSON. Rationale: `docs/adr/0057-dashboard-reads-script-json-only.md`.

## Output
`list --json` prints, exit 0 always:
```json
{ "v": 1, "items": [{ "file": "2026-11-04 02.10 - Windows CI Sharding.md", "topic": "…", "started": "2026-11-04 02.10",
  "status": "roadmap", "lane": "roadmap|not-now|to-check" }], "warnings": [] }
```
- `listRoadmap(root)` exported by `scripts/roadmap.mjs` returns the same object.

## Sources
- `lane: roadmap`: `.company/roadmap/*.md`.
- `lane: not-now`: `.company/roadmap/Not now/*.md`.
- `lane: to-check`: `.company/roadmap/to-check/*.md`.
- No other folder, no recursion. Order: lane in the order above, then file name.

## Reading
- Each folder and file is checked with `lstat`; a link, or anything but a regular file with a `.md` name, is skipped (folders: a linked lane folder is skipped whole).
- At most 200 files in total; the rest are left out with the warning `over 200 items`.
- Each file is read only to the end of its frontmatter and at most 4 KiB: the first line must be `---`, the block ends at the next `---` line. `key: value` lines; only `topic`, `started` and `status` are kept.
- `file` is the file name only (no folder). `topic`, `started`, `status` are strings with control characters (Cc, Cf, Zl, Zp) removed and cut to 200 characters; a missing key → `null`.
- Nothing after the frontmatter is read.

## Error cases
- Missing `.company/roadmap` folder → `items: []`.
- A file with no frontmatter, an unclosed block within 4 KiB, or invalid UTF-8 → skipped with `warnings: ["<lane> file <n> skipped"]` (`<n>` its 1-based place in that lane; the name is not echoed).
