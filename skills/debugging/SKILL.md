---
name: debugging
description: Use when an aico Role hits a bug, failing test or unexpected behavior, before proposing a fix.
---

# Debugging

**Use** `superpowers:systematic-debugging` or `mattpocock-skills:diagnosing-bugs` if available.

**Fallback:** reproduce reliably → shrink to a minimal case → form one hypothesis and test it → find the root cause, not the symptom → write a failing regression test (`aico:tdd`) → fix → verify (`aico:verify`). No fix without a confirmed root cause.
