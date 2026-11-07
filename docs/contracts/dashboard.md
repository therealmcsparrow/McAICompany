# Contract: dashboard v1.1

v1.1 (task role-skills-file; additive): a Step file name takes 2 or 3 digits, so a run past Step 99 keeps its Did text. Cites move to `run-state` v1.9 and `token-ledger` v1.9. Every v1 name, field and route stays valid.

Providers (Node built-ins only): `scripts/dashboard-data.mjs` (board JSON), `scripts/dashboard-run.mjs` (run JSON, the Did reader, the slug resolver), `scripts/dashboard-tokens.mjs` (token reader), `scripts/dashboard-server.mjs` (HTTP API, access token, `serve` CLI). Page assets: `scripts/dashboard-page/` (`index.html`, `board.js`, `drawer.js`, `live.js`), private files of the server, not Modules. Consumer: the CEO's browser, through the HTTP API only.
Uses: run-state v1.9 (`list`, `active`, `show`), run-stage v1 (`readStage`), intake-record v1 (`listIntake`), roadmap-list v1 (`listRoadmap`), pr-links v1 (`lookup`), token-ledger v1.9 (`report --json`, in a child process), cost-source v1 (`readCost`), work-folder-name v1.1 (`isWorkFolder`, `exactWorkPath`).
Why it exists: the CEO sees every run, its stage, the Gate it waits on and its token use on one live page without reading Handoffs. Rationale: `docs/adr/0057-dashboard-reads-script-json-only.md` (data only from aico script JSON, loopback by default) and `docs/adr/0058-dashboard-access-token.md` (per-start token). Read-only: nothing here writes a record, blocks a Step or a Gate.

## Sources and imports
- `dashboard-server.mjs` imports only `node:` built-ins, `dashboard-data.mjs`, `dashboard-run.mjs` and `pr-links.mjs`, and reads no file except the four page assets.
- `dashboard-data.mjs` and `dashboard-run.mjs` read run data only through the Contracts under Uses. The one exception is the Did reader of `dashboard-run.mjs` (Run, Did reader), the only new reader of Handoff bodies.
- `dashboard-tokens.mjs` reads the ledger only through `ledger.mjs report --json` in a child process, plus one `lstat` of the ledger file for its cache key.
- No dashboard Module parses `run-state.jsonl`, `stage.jsonl`, `intake.jsonl` or a ledger file itself.

## Board: `board(root, { now, deps })`
`board` is exported by `scripts/dashboard-data.mjs`. `deps` replaces the reader functions in tests; the defaults are the providers under Uses.
```json
{ "v": 1, "generated": "<at>", "active": "<slug>|null", "inflight": 0,
  "columns": [{ "id": "intake|brief|plan|build|review|ship-gate|needs-ceo|done", "cards": [] }],
  "roadmap": [] }
```
- `generated`: `now` as UTC `<at>`. `columns`: all eight, always, in the order above.
- `active`: the `slug` of run-state v1.9 `active(root, { now })` (one running, non-stale run, the newest activity), else `null`.
- `inflight`: for the active run, the view `subs` entries with `stop: null` whose `start` is within the last 12 hours; `0` when `active` is `null`.
- `roadmap`: the `items` of roadmap-list v1 `listRoadmap(root)`.
- Intake lane (`columns` id `intake`): one card `{ "id", "topic", "outcome", "at" }` per intake-record v1 `listIntake` item with outcome `needs-info` or `rejected`, in that order.

### Run card
```json
{ "slug": "<slug>", "title": "…", "state": "running|ended|stale|none|unreadable", "started": "<at>|null", "ended": "<at>|null",
  "elapsedS": 0, "live": true, "tier": "high", "round": 0, "needsCeo": false, "column": "build",
  "stageNote": "stage not recorded"|null, "readable": true, "tokens": { "spend": 0, "cacheRead": 0 }|null, "usd": 0.42|null }
```
- One card per run-state v1.9 `list` entry; fields from that entry and the run view (`show`) of the run.
- `title`: for a new work folder name, the text after ` - ` as on disk (Topic plus any suffix and number); for a legacy slug, the slug.
- `state`: the list `state` (the page shows "stale" for `stale`). `live`: `state` is `running`.
- `elapsedS`: whole seconds from `started` to `ended`, or to `now` when `ended` is `null`; `null` when `started` is `null`.
- `tier`, `round`: view `tier` and `round`.
- `needsCeo`: view `open_ask` is not `null`, or the highest-numbered Step in view `steps` has `status: needs-ceo`.
- `readable`: `false` when `state` is `unreadable`; `"not recorded"` when `state` is `none`; else `true`.
- `tokens`: `readLedger` `totals` when its `state` is `ok`, else `null`. Shown as `spend` with `cacheRead` beside it, labelled "tokens, not cost". `ctx_end` is never summed.
- `usd`: only from cost-source v1 `readCost(root, slug)`: `state: "recorded"` → `micros / 1000000`; `state: "none"` → `null`, shown as nothing. An ended run's `usd` is cached in server memory, keyed by slug and `ended`.

### Column rule (first match wins; exactly one column per run)
1. Run `ended` is not `null` → `done`.
2. `needsCeo` → `needs-ceo`.
3. run-stage v1 `readStage` gives `state: recorded` → its `stage`.
4. Else from the view `gates`, with `stageNote: "stage not recorded"`: any `ship` entry → `ship-gate`; a `plan` entry with result `passed` → `build`; a `brief` entry with result `passed` → `plan`; else `brief`.

`stageNote` is `null` unless rule 4 placed the card. A `stale` run keeps its column.

### `refreshActive(root, prev, { now, deps })`
Exported by `scripts/dashboard-data.mjs`; returns a new board equal to `prev` except the active run's card, `active` and `inflight`, recomputed from run-state `show`, `readStage` and `readLedger` for `prev.active` only. A run started since `prev` appears at the next full `board()`.

## Token reader: `readLedger(root, slug, { spawn, timeoutMs, cache })`
`readLedger` is exported by `scripts/dashboard-tokens.mjs`. It resolves to `{ "state": "ok|none|unavailable", "totals": { "spend", "cacheRead" }|null, "overCap": [{ "step", "role", "ctxEnd" }] }`.
- `.company/ledger/<slug>.jsonl` missing by `lstat` (a link counts as missing) → `none`, no spawn.
- Else spawns `process.execPath` with `[<ledger.mjs beside this script>, "report", <slug>, "--json"]`, `shell: false`, cwd `root`, timeout 5 s (`timeoutMs`), stdout at most 1 MiB; at most 4 children at once, others wait.
- Non-zero exit, timeout, stdout over 1 MiB, unparsable JSON or `v` other than 1 → `unavailable`.
- `totals` = report `totals.spend` and `totals.cache_read`. `overCap` = every report row with `ctx_end` above 95000 (the token-ledger v1.9 over-cap threshold), as `step` = row `id`, `role`, `ctxEnd` = `ctx_end`, in file order; `[]` unless `ok`.
- Cache key: slug, ledger `mtimeMs` and `size`. A result, failures included, is reused while the key is unchanged, so an unchanged ledger is never spawned twice.

## Run: `run(root, slug, { now, deps })`
`run`, `routing` and `resolveRunSlug` are exported by `scripts/dashboard-run.mjs`.
```json
{ "v": 1, "slug": "<slug>", "steps": [{ "step": "05", "role": "qa", "status": "done", "round": 0, "summary": "…"|null }],
  "rounds": [{ "round": 0, "gate": "pass|fail"|null, "review": "approve|changes|blocked"|null }],
  "routing": ["code-reviewer"],
  "active": null | { "gates": [{ "gate", "result", "waitS" }], "waves": [{ "wave", "at" }],
    "roleTimes": [{ "role", "ms", "steps" }], "overCap": [{ "step", "role", "ctxEnd" }], "fixRounds": 0 } }
```
- `slug` not resolved by `resolveRunSlug` → `null` (the server answers 404).
- `steps`: view `steps` (`step`, `role`, `status`, `round`) plus `summary` (Did reader).
- `rounds`: one entry per distinct step `round`, ascending; `gate` and `review` = the step keys `gate` and `verdict` (run-state v1.9) of the highest-numbered Step of that round that carries one, else `null`. Until Handoffs carry `gate:` and `verdict:`, every chip says "verdict not recorded".
- `routing`: `routing(steps)`, the reviewer Roles in first-seen order.
- `active` is non-null only when `slug` equals run-state `active`. `gates` = view `gates` (`gate`, `result`, `waitS` = `wait`). `waves` = view `waves`. `roleTimes` = view `subs` grouped by `role` in first-seen order: `ms` = sum of non-null `ms`, `steps` = number of entries (open ones included). `overCap` = `readLedger` `overCap`. `fixRounds` = view `round`.

### Did reader
- `summary` = the first 3 non-empty lines of the `## Did` section, each without its list marker, joined by one space, control characters (Cc, Cf, Zl, Zp) removed, at most 300 characters, plain text.
- File name from view `steps[].file`, which must match `^\d{2,3}-[a-z0-9-]+\.md$`; at most 200 files per run; `lstat` regular file with one hard link; at most 32 KiB; real path inside the real run folder; UTF-8 decoded with `fatal: true`.
- Any failure, or no `## Did` section → `summary: null`; the Step stays listed.

### `resolveRunSlug(root, raw)`
`resolveRunSlug` exported by `scripts/dashboard-run.mjs` returns the slug or `null`. `raw` is the path part exactly as received (after the token prefix and `api/run/`, up to the next `/` or the end). `null` when:
1. `raw` is longer than 300 characters;
2. `decodeURIComponent` throws (decoded exactly once, never again);
3. the decoded text fails `isWorkFolder`;
4. `exactWorkPath(io, root, [slug])` is `missing` or throws `wrong letter case`;
5. `lstat` of the folder is not a directory (a link or junction included);
6. its `realpath` differs from `join(realpath(<root>/.company/work), slug)`.

`run()` re-runs `resolveRunSlug`; pr-links v1 `lookup()` runs its own `isWorkFolder` and `exactWorkPath` check.

## Server access (`dashboard-server.mjs`)
Every request, in this order:
1. Host header in the allow-list, else 421. Allow-list: `127.0.0.1:<port>`, `localhost:<port>`; under `--lan` also `<ip>:<port>` for each non-internal IPv4 of `os.networkInterfaces()` at start.
2. Method GET or HEAD, else 405 with `Allow: GET, HEAD`; nothing changes on any request.
3. A request target with a query string → 404.
4. Path prefix `/t/<token>/` with the token of this start, compared with `crypto.timingSafeEqual` after a length check; missing or wrong → 404.

Token: 32 bytes of `crypto.randomBytes`, base64url without padding (43 characters), made at each start, held only in memory, printed only inside the URL lines, never written to disk, logged, or put in any response body or header. It applies in both modes.

## HTTP API (paths after the prefix)
- the bare prefix `/t/<token>/` (the page `index.html`), `board.js`, `drawer.js`, `live.js`: the page assets.
- `api/board`: the `board()` result plus the top-level key `"lan": <boolean>` (`true` only when started with `--lan`), always present and part of the `ETag` input. `board()` itself takes no flag.
- `api/run/<slug>`: the `run()` result. `api/run/<slug>/links`: the pr-links v1 `lookup()` result.
- `<slug>` goes through `resolveRunSlug`; `null` → 404. Any other path, `/t/<token>` without the last `/` included → 404.
- Every 404, 405 and 421 has a fixed body that echoes nothing from the request. A failure inside a handler → 500 with a fixed body; never a 500 for the whole board because of one run (Error cases).
- JSON responses carry an `ETag`; an `If-None-Match` match → 304. HEAD sends the GET headers and no body.
- Headers on every response: `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.

## Refresh and caching (server memory only, never on disk)
- While a request came in the last 60 s: a full `board()` every 30 s and `refreshActive()` every 1.5 s; `run(slug)` memoized for 1.5 s.
- PR links: loaded when the drawer opens, cached 60 s per slug.
- Timing goal: a change to the active run shows within 5 s; a change to any other run, a new run included, within 35 s.

## Page rules
- Only relative URLs (`api/board`, `api/run/` plus `encodeURIComponent(slug)`); no page file reads `location`, `document.URL` or `document.referrer`, or uses `localStorage`, `sessionStorage` or cookies. PR links open with `rel="noopener noreferrer"`.
- Text is written only with `textContent` (no `innerHTML`, no `insertAdjacentHTML`). DOM nodes update in place keyed by slug and step; a focused node is never replaced.
- Polling: `api/board` (and the open run) every 2 s with `If-None-Match`.
- Pause: a native `button` "Pause updates" in `header`, `aria-pressed`, target at least 44 px. Pressed → no fetch until pressed again, `#status` says `Updates paused`; pressed again → one fetch at once, then the 2 s poll, `#status` says `Updates resumed`. Held in memory only.
- After 3 failed polls in a row (network error, or a status other than 200 and 304) the page stops polling and `#status` says `Dashboard server stopped. Run /aico:dashboard for a new link.`
- LAN banner, shown only when `lan === true`: `LAN mode is on. Anyone on your network who has this link can read these runs, including names in Handoffs. Stop the server to end access.`

## CLI
`node scripts/dashboard-server.mjs serve [--lan] [--port <1024-65535>]`
- Binds `127.0.0.1`, or `0.0.0.0` with `--lan`; never an IPv6 address. Default port 0 (the OS picks); `--port` pins one. A bad flag or port → usage on stderr, exit 2.
- Prints `aico dashboard: http://127.0.0.1:<port>/t/<token>/`. With `--lan` also one `aico dashboard (LAN): http://<ip>:<port>/t/<token>/` line per non-internal IPv4 and the line `WARNING: LAN mode has no login beyond this link. Anyone on your network who gets the link can read these runs, including names in Handoffs. The link travels unencrypted. Stop the server to end access.`
- Stops on SIGINT or SIGTERM, or after 60 minutes with no request.

## Error cases
- A run whose run-state is unreadable → its card `readable: false` ("unreadable"); no records → `readable: "not recorded"`. One bad source never fails the board.
- A failed reader (run-stage, intake, roadmap, tokens, cost) → that part is `null`, empty or `"stage not recorded"`; the rest of the board is built.
- Did reader failure → `summary: null`. pr-links failure → `state: "unavailable"`.

## Residuals (`docs/adr/0058-dashboard-access-token.md`)
- Under `--lan` the link, token included, travels as plain HTTP; anyone who can read that traffic can read the runs while the server runs.
- The printed URL sits in the session transcript; anyone who can read the transcript can use the link until the server stops.
