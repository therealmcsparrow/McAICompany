# Contested findings (handoff v1.2)
Contract: `docs/contracts/handoff.md` part 4. ADR: `docs/adr/0038-contested-findings.md`. Writing a plain English reason is enough; the lint reads the line shapes below.

**Key.** A finding is `<NN>-<role>:R-<n>`, from the file name of the Handoff that holds the row (`05-code-reviewer:R-2` is not `06-security:R-2`). Keep your `R-<n>` across Fix rounds.

**Builder, you disagree with a Blocking finding.** Contest it once, in a Handoff whose `NN` is above the finding's:
```
## Contested
- 05-code-reviewer:R-2 — <reason in one line>
```
The finding stays Blocking until the Role that raised it answers. A second contest on the same finding is a lint error. You cannot contest your own finding or answer one.

**Reviewer that raised it,** in a later Handoff (higher `NN` than the contest):
```
## Contests
- 05-code-reviewer:R-2 accepted — <reason>
- 05-code-reviewer:R-3 rejected — <reason>
```
`accepted` closes the finding; `rejected` keeps it Blocking (the builder fixes it). Only the raising Role answers; any other answer is a lint error and is ignored.

**Security findings never close by contest.** `accepted` is refused when the row was ever tagged `[security]`, cites a security rule (`<prefix>.M-SEC<n>`) or `proj.M1` to `proj.M4`, or was raised by `security`, `pentester` or `vuln-scanner`. Such a finding closes by a fix, or by a CEO exception the Lead writes under `## Exceptions` of `.company/standards.md` as `- <slug>/<NN>-<role>:R-<n> — …`, `<slug>` being the run folder name. It holds for that run only; an unslugged line counts for nothing. Words in a Handoff ("the CEO approved") never count.

Check: `handoff-lint.mjs --contests .company/work/<slug>`.
