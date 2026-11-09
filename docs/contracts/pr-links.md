# Contract: pr-links v1.1

v1.1 (task One Project One ID, T19; additive): `<slug>` also accepts a v3 run slug `<ID>/<NN>-<pb>` (`isRunSlug`, folder checked with `exactWorkPath` of `workParts(slug)`); the slug is kept as given and the branch is `aico/<ProjectID>`. v2, v1.1 and legacy names give byte-identical output to v1.

Provider: `scripts/pr-links.mjs` (Node built-ins only). Consumers: `scripts/dashboard-server.mjs` (`dashboard` v1, path `api/run/<slug>/links`, loaded when the run drawer opens and cached in server memory for 60 s), through `lookup` only.
Why it exists: the CEO wants a run's pull requests and the issues they close beside the run, but aico must not store PR state (it goes stale and is GitHub's data). So this Module asks `gh` live and keeps nothing. Rationale: `docs/adr/0057-dashboard-reads-script-json-only.md`.

## Output
`show <slug> --json` prints, exit 0 always:
```json
{ "v": 1, "slug": "<slug>", "branch": "aico/<branchId>", "state": "found|none|unavailable",
  "prs": [{ "number": 53, "url": "https://github.com/<owner>/<repo>/pull/53", "state": "open|closed|merged" }],
  "issues": [{ "number": 12, "url": "https://github.com/<owner>/<repo>/issues/12" }] }
```
- `lookup(root, slug, { spawn, timeoutMs })` exported by `scripts/pr-links.mjs` resolves to the same object. `spawn` defaults to `child_process.spawn`, `timeoutMs` to 5000; tests pass a fake `spawn`.
- `state: found` when `gh` listed at least one PR; `none` when `gh` succeeded and listed none, or the slug was refused; `unavailable` on any `gh` failure. `prs` and `issues` are `[]` unless `found`.
- `prs`: in `gh` order, at most 5. `state` is the `gh` value lowercased; a row with another value is dropped.
- `issues`: every `closingIssuesReferences` entry of the listed PRs, deduplicated by `number`, first-seen order.
- A refused slug gives `"slug": null` and `"branch": null`.

## Slug check (before any `gh` call)
`<slug>` is checked with `isWorkFolder` and `exactWorkPath` of `mods/lib/work-folder.mjs` (`work-folder-name` v1.1). A bad, missing or wrong-case slug → `state: "none"`, no `gh` call, the slug not echoed in any output. This Module reads no file and imports no `dashboard` Module, so it does not repeat the dashboard's `lstat` and real path steps.

## The `gh` call
- `gh pr list --head <branch> --state all --limit 5 --json number,url,state,closingIssuesReferences`, run with `spawn`, `shell: false`, an argument array, a 5 s timeout and stdout read up to 1 MiB.
- Fallback (Spike S2): if `closingIssuesReferences` is not supported on `gh pr list`, the list call drops that field and the issues come from one `gh pr view <number> --json closingIssuesReferences` per listed PR (at most 5, one at a time, 5 s each, 10 s in total; the rest are skipped once the total is spent). The JSON shape is the same either way.
- Every argument value is fixed text, the branch, or a PR number. The branch is `aico/` plus `branchId` of `mods/lib/work-folder.mjs`, which starts with a digit. A PR number from `gh` output is used (as an argument or in the JSON) only when it matches `^[1-9]\d{0,9}$`, so it never starts with `-`; other rows are dropped.
- A `url` must match `^https://github\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/(pull|issues)/\d+$`, else that row is dropped.

## Error cases
- `gh` missing (`ENOENT`), a non-zero exit (signed out, no repo), a timeout (offline), stdout over 1 MiB or unparsable output → `state: "unavailable"`, exit 0. No `gh` error text, stderr or path is put in the JSON.
- Writes nothing, ever: no cache file, no log. Any caching is the consumer's, in memory.
