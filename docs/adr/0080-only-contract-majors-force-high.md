# ADR 0080: Only a Contract major forces the high tier

Date: 2026-11-20. Status: proposed (run P20261120.000001/01-lead, cut C4). Contracts: `tier-sets` v2.0, `handoff` v3.0.

A changed file under `docs/contracts/` forces the run to high only when its `# Contract: <name> v<major>.<minor>` header raises the major against the base commit, the file is deleted, or the header is missing or unreadable at either side (fail-closed); a new Contract file or a minor bump no longer does. With 66 Contracts nearly every plugin run was high, so medium (and the smaller medium set of cut C3) never applied. Hard to reverse because medium runs will be planned and budgeted on the smaller lane set.

Decided: plan paths under `docs/contracts/` force high only when the plan's `<name> v<old> → v<new>` line raises a major (the `plan-review majors` parser), because the plan cannot show the header diff yet.
