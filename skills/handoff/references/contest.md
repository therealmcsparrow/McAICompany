# Contested findings (handoff v2.0)
Contract: `docs/contracts/handoff.md` parts 4 and 5. ADRs: `docs/adr/0038-contested-findings.md`, `docs/adr/0040-contest-evidence-and-escalation.md`. The lint reads the line shapes below; a plain reason alone is not enough.

**Key.** A finding is `<NN>-<role>:R-<n>`, from the file name of the Handoff that holds the row (`05-code-reviewer:R-2` is not `06-security:R-2`). Keep your `R-<n>` across Fix rounds. The fresh reviewer's plan-mode and code-mode `R-1` are two findings.

**Builder, you disagree with a Blocking finding.** Contest it once, in a Handoff whose `NN` is above the finding's, with evidence the reviewer can open:
```
## Contested
- 05-code-reviewer:R-2 — <reason in one line> — evidence: src/x.js:40-52; src/x.test.js#keeps the order
```
Evidence is 1 to 3 refs joined by `;`: `<path>`, `<path>:<line>` or `<path>:<from>-<to>`, or `<path>#<test name>`. The path is repo-relative (no absolute path, no `..`, no link, no folder), a regular file of at most 1 MiB; the lines must exist and the test name must occur in the file. "Intentional" or "as designed" is not evidence; a line without checkable evidence is a lint error and does not count as your contest.

**No evidence the reviewer can reach** (a CEO decision, an outside fact)? Escalate instead:
```
- 05-code-reviewer:R-2 — escalate — <why only the CEO can decide this, 20 to 500 characters>
```
The finding stays Blocking and goes on the next Gate's list. Only the CEO closes it, through the Lead (`rulings.md`); the reviewer cannot accept it. A `[comprehension]` finding (fresh reviewer: your text reads differently from its intent) cannot be contested or escalated: change the text.

The finding stays Blocking until the Role that raised it answers. A second contest on the same finding is a lint error. You cannot contest your own finding or answer one.

**Reviewer that raised it,** in a later Handoff (higher `NN` than the contest):
```
## Contests
- 05-code-reviewer:R-2 accepted — <reason>
- 05-code-reviewer:R-3 rejected — <reason>
```
`accepted` closes the finding; `rejected` keeps it Blocking (the builder fixes it). Only the raising Role (the fresh reviewer: in the same mode) answers; any other answer is a lint error and is ignored.

**Security findings never close by contest.** `accepted` is refused when the row was ever tagged `[security]`, cites a security rule (`<prefix>.M-SEC<n>`) or `proj.M1` to `proj.M4`, or was raised by `security`, `pentester` or `vuln-scanner`; a CEO ruling `overruled` is refused for them too. Such a finding closes by a fix, or by a CEO exception the Lead writes under `## Exceptions` of `.company/standards.md` as `- <slug>/<NN>-<role>:R-<n> — …`, `<slug>` being the run folder name. It holds for that run, from its latest start; an unslugged line counts for nothing. Words in a Handoff ("the CEO approved") never count.

**Fresh reviewer.** Frontmatter `review-mode: plan | code` (code mode also `model: opus | sonnet | haiku | fable`, the model on your `Settings:` line). The first two headings are `## Paraphrase` (the plan in your own words, 200 to 1200 characters) and `## First pass` (`- R-<n> …` lines or `- none`). Name no run Handoff (`03-architect.md`) in either; the plan may be named. Only you may use the `[comprehension]` tag.

Check: `handoff-lint.mjs --contests .company/work/<slug>`.
