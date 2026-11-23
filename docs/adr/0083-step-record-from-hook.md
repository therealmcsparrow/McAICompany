# ADR 0083: The SubagentStop hook writes the Step's ledger row

Date: 2026-11-20. Status: proposed (run P20261120.000001/01-lead, cut C10; depends on spike task P20261120.000001-T42). Contracts: `step-times` v1.4, `token-ledger` v1.15, `step-close` v1.0.

The step-times SubagentStop adapter writes one ledger row per Role subagent from the subagent transcript, keyed by the `<NN>` and role of the dispatch `Output:` line, so the Lead no longer types `ledger add` and the three Step counts of one run (summary, ledger, Handoffs) come from one source. The hook never blocks; a missing row is filled by `step-close --usage`. Hard to reverse because the Lead's dispatch flow and the scorecard will rely on the hook row.

Decided: the Lead's own usage is recorded as kind `lead` rows by the same hook, because the Lead runs as a subagent (ADR 0077) and its cost was not measured (baseline P20261120.000001 step 03, F2). A Lead stint is recognised by a payload `agent_type` equal to `aico:project-manager` exactly (the rule `step-times` v1.3 already uses to skip the Lead); it has no `Output:` line, so its row carries no `<NN>` and is keyed by the stint's agent id.

Decided: if the spike (T42) finds the payload lacks the transcript path, or the read misses the 4 s deadline, the hook writes no rows; Role rows come from `step-close --usage` on every close, and the Lead-stint row is not recorded (Debt), because the main session must stay a pure Lead spawner.
