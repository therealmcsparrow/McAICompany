# Contract: cost-source v1

Provider: `scripts/cost-source.mjs` (Node built-ins only). Consumers: `scripts/ledger.mjs` (`scorecard`, `ship`, `receipt`; `token-ledger` v1.5). Sources read: `run-state` v1.5 `show` (the run's `sessions`, its start and its records' times).
Rationale: the CEO sees what a run cost Claude Code, beside its time, without an API key and without aico estimating anything. Rules: `.company/standards/claude-code-otel@2026.md` (ccotel.M1 to M6, S1 to S3, M-SEC1 to M-SEC4). Report only; nothing here blocks a Step or a Gate.

## Source
Claude Code has no file exporter. The CEO runs an OpenTelemetry Collector with an `otlp` receiver and a `file` exporter, which writes one stream for all sessions to one path:

`<MCSPARROW_HOME, else ~/.mcsparrow>/otel/metrics.jsonl`

That path is the only source: no per-run file, no setting, no rotation files in v1. Nothing in aico reads an `OTEL_*` variable or decides from its own environment whether telemetry is on (Claude Code does not pass them to hooks or scripts); only the file is evidence. Without the file the scorecard says `cost: not recorded`, which is the default.

Minimal Collector setup (the CEO's machine; aico never writes it):
```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:4318
exporters:
  file:
    path: ~/.mcsparrow/otel/metrics.jsonl
service:
  pipelines:
    metrics:
      receivers: [otlp]
      exporters: [file]
```
and for Claude Code: `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`. Leave `OTEL_METRICS_INCLUDE_SESSION_ID` at its default (on); without `session.id` a point can never be matched to a run.

## `readCost(root, run)`
Returns `{ state: "recorded", micros, points, skipped }` when at least one point matched, else `{ state: "none", reason }`. `micros` is an integer (micro-USD). `skipped` counts lines that are not metrics batches or do not parse (a truncated last line included) and matched points whose values or times are unusable. A second argument `{ limits: { file, line } }` lowers the two caps for tests.

`reason`, in the order the checks run:
| reason | when |
|---|---|
| `no-session` | the run has no `sessions` or no start in the `run-state` view (the file is not opened) |
| `no-file` | the path does not exist |
| `unreadable` | not a regular file, a link, a file with more than one hard link, a folder, a link as the `otel` folder, or a read error |
| `too-large` | the file is over 256 MiB, or one line is over 1 MiB (the whole file is refused) |
| `temporality` | a point of a matched session is not delta (below) |
| `no-points` | no point matched, or the sum is above 2^53 - 1 micro-USD |

Reasons are for tests and Handoffs; they are never printed in the scorecard.

## Reading
- The file is untrusted data. It is opened without following links and compared with its `lstat`, streamed in 1 MiB chunks, and each line is parsed alone. Keys are read with `Object.hasOwn`; nothing is merged.
- A line must be an object with a `resourceMetrics` array (the Collector's line and the OTLP http/json body Claude Code sends have the same shape, so the captured body is the test fixture). Anything else is skipped and counted.
- Walk `resourceMetrics[].scopeMetrics[].metrics[]`. Keep a metric only when `name` is `claude_code.cost.usage` and `unit` is `USD`. That one signal only: no log event, and no cost worked out from token counts.
- OTLP/JSON as specified: lowerCamelCase keys, unknown fields ignored. A point's session is the `session.id` entry of its `attributes` list, compared as an exact string with the run's sessions. A point whose `session.id` appears twice with different values, is missing, or is not a string is never attributed. Time never attributes a point.
- **Run sessions and window.** The sessions are the `sessions` of the `run-state` view (recorded by `step-times` from the hook payload's `session_id`). The window is the `at` of the run's `start` record to the `at` of its last record, both converted from milliseconds to nanoseconds as `BigInt`.
- **Temporality.** It is judged on the points of the run's matched sessions only. If any such point sits in a metric whose `sum.aggregationTemporality` is not the number `1` (delta; `2`, `0`, any other value or none), the result is `none` with reason `temporality`, with no partial sum of the delta points. Points of other sessions never decide the result.
- **Overlap.** A delta point counts when its interval `[startTimeUnixNano, timeUnixNano]` overlaps the window; both edges are inclusive. The two times are decimal strings (or safe-integer numbers), compared as `BigInt`, never as floats. An overlapping point counts whole, so each edge can add up to one export interval (default 60 s); this is one reason the text says approximate. A point whose times are missing, not integers, or reversed is skipped and counted.
- **Value.** `asDouble` (finite, not negative) or `asInt` (a safe integer, or a decimal string), exactly one of them. Scaled once to integer micro-USD and summed as `BigInt`. Rounding happens only when the text is made.
- **All `query_source` values count** (`main`, `subagent`, `auxiliary` and any new one), since aico Steps are subagents.
- **Data kept:** the value, the unit, the `session.id` and the two times, in memory only. Resource attributes and account attributes (`user.email`, the account and organization ids, `user.id`) are never read, stored or printed, and no session id is printed.

## Session check (T11, run on Claude Code 2.1.312)
One `claude -p` run against a fake API (`sk-fake`, no network, no cost) with a throwaway plugin that carries `SubagentStart` and `SubagentStop` hook entries, and a local OTLP http/json receiver, started one subagent. The hook payload's `session_id` equalled the cost metric's `session.id` on the main point (`query_source` `main`), and the subagent's cost point (`query_source` `subagent`, `agent.name` set) carried that same `session.id`. So a run's sessions, recorded from the hook payload, match the Lead's and its subagents' cost points.

## `costText(result)`
- recorded: `cost <usd> USD (approximate, Claude Code telemetry)`; `<usd>` = micros rounded half up to 2 decimals (`(micros + 5000) div 10000` cents).
- recorded, non-zero and under 5000 micros: `cost under 0.01 USD (approximate, Claude Code telemetry)`.
- none: `cost: not recorded`.
The number is Claude Code's approximate cost from telemetry. No text calls it a bill, a charge or spend (ccotel.M2).

## Compatibility
v1. A second source, a changed result shape or reason, a different path or a changed wording is a major bump. A rotation file name may be added in a minor bump only with a Contract line.
