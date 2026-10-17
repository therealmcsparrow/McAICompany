---
name: observability
description: Use when building, deploying or reviewing a Module that runs in production or on user machines. Defines logs, metrics, health checks, alerts and consent-based crash reporting.
---

# Observability

You cannot fix what you cannot see. Each Module ships with its own signals, exposed without breaking the Module boundary (see `aico:contracts`). Find the stack's logging and metrics tools with `aico:stack-detect`.

## 1. Per Module (services and web backends)
- [ ] **Structured logs**: one machine-readable record per event, with level, timestamp, Module name and a correlation ID that follows the request across Modules.
- [ ] **No personal data, no secrets** in logs: no e-mail, name, IP, token, password, payment data. Log an opaque ID instead. `security` and `legal` check this.
- [ ] **RED metrics** per Module entry point: Rate (requests), Errors (failures), Duration (latency, as a histogram so p95 is readable).
- [ ] **Health check**: a cheap liveness endpoint and a readiness check that tests real dependencies.
- [ ] **Alert rules**: each alert names an owner (a Role or the CEO), a threshold, and a first-response step. An alert without an owner is not shipped.

Alert on user-visible symptoms (error rate, latency against the budget in `aico:performance`) before causes (CPU, disk).

## 2. Desktop and game
- [ ] Local log file with rotation and a size cap; no personal data.
- [ ] **Crash reporting is opt-in**: off until the user agrees, asked in plain language, revocable in settings. Consent and what is sent follow GDPR; `legal` writes the wording.
- [ ] A crash report holds the stack trace, version and OS only; no file paths with usernames, no content.
- [ ] Anonymous usage telemetry follows the same consent rule.

## 3. Frontend
- [ ] Capture client errors with the release version; scrub user input and tokens in URLs.
- [ ] Analytics and error tracking that set identifiers need consent where GDPR requires it: ask `legal`.

## 4. Operations
- Deploys record the version in logs and metrics, so an Incident can be tied to a release.
- `devops` owns the pipeline for logs, metrics and alerts; engineers own the signals in code.
- Dashboards show the RED metrics for each Module and the budgets that matter.
- During an Incident, these logs and metrics are the first evidence.

## Review blockers (always `## Blocking`)
- Personal data or a secret in a log line.
- Crash reporting or telemetry that sends before the user opted in.
- A Module in production with no health check.

Missing metrics: `## Nits`, marked *recommendation*, unless the Plan Gate required it. An alert without an owner: `## Blocking`.
