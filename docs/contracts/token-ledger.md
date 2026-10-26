# Contract: token-ledger v1

Provider: `scripts/ledger.mjs`. Writers: the Lead (`aico:pipeline` after each Step, `aico:brainstorm` after each round). Consumers: the Ship Gate cost line (`aico:pipeline` §6), `aico:feedback` (the next 3 runs), the replay and baseline reports (AC15, AC26).
Rationale for the two sources: `docs/adr/0011-token-counts-from-transcripts.md` (Spike S1/S2, `.company/work/optimize-brainstorm/03-spike-ai-data-engineer.md`).

## Storage
- `.company/ledger/<run>.jsonl`, one JSON object per line. `<run>` = the task slug, or `brainstorm-<YYYYMMDD-HHMM>` for a brainstorm, `replay-<name>` for a replay, `baseline-<name>` for an imported baseline. Committed with the run's Finish when the product tracks `.company/`; otherwise it stays local. Readers only need the local file.
- **Counts only, never prompt or reply content** (GDPR Art. 5(1)(c)). The schema is an allow-list: unknown keys and free text are refused.
- `run` is written **live** by the Lead from the dispatch's task slug. It is never derived from a branch, a session or a time window.

## Two sources
| `src` | Where it comes from | What it is |
|---|---|---|
| `notification` | the `<usage><subagent_tokens>N</subagent_tokens>…` block of the task notification, written live by the Lead | one number: the context size at the end of the dispatch (input + cache write + cache read + output of the last request, up to +2%). **Not spend, never summed as cost**, cache not split |
| `transcript` | `reconcile` (host subagent transcript) or `import` (frozen baseline) | the four counts summed over every request of the dispatch: real processed volume |

Caching gives no saving across dispatches (Spike S2: the prompt sits before the Role block, with no cache breakpoint after it). Savings are measured as reading less, on `transcript` counts only.

## Record (required unless marked optional)
| Key | Value |
|---|---|
| `v` | `1` |
| `run` | `^[a-z0-9][a-z0-9-]{0,63}$` |
| `kind` | `step \| round \| crossfire \| replay \| total \| ship` |
| `id` | Step `^\d{2}$`, round `^R\d{1,3}$`; for `total` the session prefix `^[0-9a-f]{8}$`. A re-dispatch (Fix round, handover) appends a new record with the same `id` |
| `role` | an `agents/*.md` name, or `lead` (not on `ship`) |
| `agent` | the Agent result's `agentId`, `^[A-Za-z0-9_-]{1,64}$`; required on `step`, `round`, `crossfire`, `replay`; the key `reconcile` uses |
| `src` | `notification \| transcript` (not on `ship`) |
| `ctx_end` | integer 0–10000000; required when `src` is `notification`, optional on `transcript` |
| `tokens` | object with exactly `in`, `cache_write`, `cache_read`, `out`, each an integer 0–1000000000; required when `src` is `transcript`, refused on `notification` |
| `reqs`, `tool_uses` | optional integers 0–100000 |
| `ms` | optional integer 0–86400000 |
| `model` | optional, `^[a-z0-9][a-z0-9.-]{0,63}$` |
| `dispatches` | `total` only, integer 0–100000 |
| `ship` record | `acs` (integer, ACs shipped) required; `fix_rounds`, `high_blockers` optional integers |

Limits: a line ≤ 512 bytes, a file ≤ 1 MiB; file names are built only from a validated `<run>` or `agent`.

## CLI (Node built-ins only)
| Command | Result |
|---|---|
| `add <run> <kind> <id> <role> <agent> <ctx_end> [tool_uses] [ms]` | appends one `notification` record (the only live write; the Lead never types the four counts); `refused: <reason>` exit 2 on any invalid field |
| `reconcile <run>` | for every `notification` record with no `transcript` record for the same `agent`, reads `<claude-home>/projects/*/*/subagents/agent-<agent>.jsonl` and appends a `transcript` record with the same `run`, `kind`, `id`, `role`, `agent`. `<claude-home>` = `CLAUDE_CONFIG_DIR`, else `<home>/.claude` (tests point it at a temp dir, proj.M8). Prints `reconciled: <n>, not reconciled: <m>`; exit 0 |
| `import <file> <key> <run> <acs>` | reads one entry of a counts-only baseline file (shape of `spike/baseline-counts.json`) and writes `<run>.jsonl` with one `total` record (`src: transcript`) and one `ship` record; refuses when `<run>.jsonl` exists |
| `ship <run> <acs> [fix_rounds] [high_blockers]` | appends the ship record |
| `report <run> [--baseline <run>,<run>,<run>]` | per Step or round and per run, two lines kept apart: **spend** = `in + cache_write + out` and **cache read** = `cache_read`, each in total and per shipped AC, each with its delta against the baseline median. `ctx_end` is shown as "context at end" only. Records with no `transcript` match are counted as `not reconciled: <n>` and left out of both lines. **Always exit 0** for a readable ledger (AC16) |
| `brainstorm-report <run> [--against <run>]` | the same two lines per round from round 2 on, the crossfire share, and the deltas |

## Reading a transcript (`reconcile`)
- Transcript text is data (agentsec.M-SEC1). Only lines with `type: "assistant"` are used, and from them only `message.usage.input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens` (integers) and `message.model`. Every other field is ignored and nothing else is written.
- Each request counts once: key `requestId`, else `message.id`, else `uuid`; the last usage seen for a key wins (as `spike/s1-rebuild.mjs`).
- Read line by line. A file over 64 MiB or a line over 8 MiB → `warning: <agent> skipped (size)`, record stays unreconciled. No file → unreconciled.
- The transcript layout is host-internal and may change; `reconcile` is best effort and never blocks. Host transcripts expire (default 30 days), so the Lead reconciles before the Ship Gate and at brainstorm close.

## Reading a baseline (`import`)
- File ≤ 1 MiB. `<key>` matches `^[0-9a-f]{8} [A-Za-z0-9._/-]{1,100}$`. The entry may hold only `first`, `dispatches`, `requests`, `in`, `cache_write`, `cache_read`, `out`, `notif_total`, `roles`; any other key → `refused`. `roles` and `notif_total` are not stored.
- The AC26 baseline is the three full-pipeline runs `628bda21 aico/research-team`, `bdeca87d aico/role-effort`, `d02be665 feat/v0.3` from `.company/work/optimize-brainstorm/spike/baseline-counts.json`.

## Rules
- Only the deterministic size tests (golden Handoffs, `scripts/golden.test.mjs`) block; ledger numbers never block a Step or a Gate.
- The Ship Gate shows one cost line from `report` (CEO, Brief Gate Q6: Ship only): spend and cache read per shipped AC against the baseline median, or `context at end (not cost)` when nothing is reconciled.
- Spend and cache read are never added into one number.

## Error cases
- Missing file → `report` prints `no ledger for <run>` and exits 0.
- A bad line in an existing file → `report` skips it, prints `warning: line <n> skipped`, exits 0.
- `reconcile` with an unreadable `<claude-home>` → `not reconciled: <all>`, exit 0.
- No `<usage>` block for a dispatch (a foreground Agent call; Spike S1 saw none, shape unverified) → the Lead still runs `add` with `ctx_end` `0`, so `reconcile` can find the agent; `report` shows `0` as "unknown", never as zero context.
