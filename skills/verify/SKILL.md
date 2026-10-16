---
name: verify
description: Use before any aico Role writes status done or claims something works, passes or is fixed.
---

# Verify

**Use** `superpowers:verification-before-completion` if available.

**Fallback:** run the actual command (tests, build, lint, app), read its output, and quote the result line in your Handoff under `## Did`. "Should pass" isn't evidence. If you couldn't run it, say so and set `status: blocked`.
