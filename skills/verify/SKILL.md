---
name: verify
description: Use before any aico Role writes status done or claims something works, passes or is fixed.
---

# Verify

**Use** `superpowers:verification-before-completion` if available.

**Fallback:** run the actual command (tests, build, lint, app), read its output, and quote the result line in your Handoff under `## Did`. "Should pass" isn't evidence. If you couldn't run it, say so and set `status: blocked`.

**Scope of the run.** Builders and QA verify with the test files that cover their changed files plus `node scripts/check.mjs` (or the product's check); they start no full suite run, in the background or while another Role may be running one in the same tree. A "prove it is fixed" check repeats only the affected file, at most 3 times, plus one full run. The Lead runs the full suite once, in the foreground, after the last review and before the Ship Gate; CI runs it on the PR.
