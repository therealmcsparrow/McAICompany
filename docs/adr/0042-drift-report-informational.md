# 0042: The behaviour drift report is read by a model and blocks nothing

Status: proposed (Plan Gate, task elephant-goldfish)

Comparing what a Contract says a Module does with what the code does needs a reader, not a pattern, so the drift report is an Architect Step in `/aico:maintain`, run only when the CEO asks for it; the deterministic Contract drift check (`scripts/contract-drift.mjs`) stays the one that can fail CI. The report never changes an exit code, a Gate or CI, because model findings have false positives and the CEO decides what to act on.
