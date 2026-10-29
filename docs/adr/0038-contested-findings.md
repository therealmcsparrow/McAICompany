# 0038: Contested findings

Status: proposed (Plan Gate, task v020-gate-roadmap)

A builder may contest a finding once; it stays blocking until the reviewer that raised it answers, and a security finding never closes by contest, only by a fix or a CEO exception in the Ruleset, so a disagreement costs a reply instead of a forced change. Findings are keyed `<NN>-<role>:R-<n>` from the Handoff file name, so the R-1 of the code-reviewer and the R-1 of security never share a key. States come only from `handoff-lint.mjs --contests`, which counts a contest only above the raising Handoff and an answer only from a later Handoff of the raising Role; Handoff prose such as "the CEO approved" never counts. The CEO exception lives in `.company/standards.md`, written by the Lead from the CEO's own answer. The change is additive, so `handoff` goes to v1.2 and a v1.1 Handoff still lints. Hard to reverse because Fix round routing and the Ship Gate list now read the contest states.
