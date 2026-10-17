---
name: performance
description: Use when building, reviewing or testing anything with a speed, size or memory goal. Defines the budgets, how to measure per product type, and when exceeding one blocks.
---

# Performance

## 1. Budgets
Read `## Performance budget` in `.company/project.md`. When it is empty, use these defaults:

| Product type | Metric | Default |
|---|---|---|
| web | LCP | <= 2.5 s |
| web | INP | <= 200 ms |
| web | CLS | <= 0.1 |
| web | Initial JS | <= 200 kB gzipped |
| desktop | Cold start | <= 2 s |
| desktop | Idle memory | <= 200 MB |
| API (any product) | p95 latency | <= 300 ms |
| game | Frame time | <= 16.7 ms at target hardware |

A budget counts as CEO-approved only when the Project profile says so (set at a Plan Gate). Defaults are not approved until then.

## 2. Measure
Find the stack's tools with `aico:stack-detect`. Measure the thing that is budgeted:

- **web**: a lab run (Lighthouse or equivalent) on a production build, throttled; bundle size from the build output; real-user data when it exists.
- **desktop**: cold start from process launch to first usable window; memory after 60 s idle, via the OS process monitor or the stack's profiler.
- **API**: a load test at expected traffic against a production-like build; read p95, not the mean.
- **game**: the engine profiler on the target hardware named in the Project profile; report the worst sustained frame, not the average.

Never measure a debug build. State the build, hardware and conditions with each number.

## 3. Report
Quote numbers from a command you ran this session (`aico:verify`): `metric - measured - budget - pass/fail`. No "feels fast".

## 4. Over budget
| Budget | Handoff section |
|---|---|
| CEO-approved | `## Blocking` |
| Default, not approved | `## Nits`, marked *recommendation* |

## 5. Builder habits
- Measure before optimizing; fix the biggest cost first.
- New dependency: record its size cost in the Handoff.
- Keep work off the critical path (startup, first paint, frame loop); load lazily.
- Do not trade correctness or accessibility for speed.
