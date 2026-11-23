# ADR 0082: Skills and agents cite Contracts by name

Date: 2026-11-20. Status: proposed (run P20261120.000001/01-lead, cut C13). Supersedes the cite rule of `docs/adr/0007-contract-minor-versions.md`. Contract: `contract-index` v1.2.

The version lives only in the Contract header (`# Contract: <name> v<x.y>`); skills and agents cite `` `<name>` `` without a version, and the drift check only asserts that the named Contract exists. Every major bump used to force repin Steps across skills, agents and pinned tests; git history already holds which version a text was written against. Script header comments (`// contract: docs/contracts/<name>.md v<x.y>`) keep their version as the Module's declared Contract. Hard to reverse because the version trace in prose is removed in one sweep.
