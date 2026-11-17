# ADR 0078: A CEO answer is recorded by a hook from the CEO's own reply

Date: 2026-11-17. Status: proposed (feature run P20261117.000001/01-feature). Contracts: `docs/contracts/lead-relay.md` v1, `run-state` v3.1.

A subagent Lead cannot ask the CEO, so it records the open form and ends `needs-ceo`; main asks with `AskUserQuestion`, a `PostToolUse` hook writes the answer from the tool result into `forms.jsonl` only when the questions match the record exactly, and the fresh Lead reads the answer from that record, never from its prompt (CEO D2). A Gate pass that is not `auto` is refused unless the recorded answer chose an option tagged with that result, so every pass traces to the CEO's own click or words. Hard to reverse because every Gate and ask form in every Playbook moves to this path, and dropping the hook would make Gate passes rest on model-written text again.
