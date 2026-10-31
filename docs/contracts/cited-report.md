# Contract: cited-report v1.1

v1.1 (`docs/adr/0007-contract-minor-versions.md`): run folders are new and legacy work folder names (`work-folder-name` v1); the report format is unchanged.

Provider: `scripts/cited.mjs` (Node built-ins only; read-only, writes nothing). Consumer: `aico:feedback` (the `## Cited` section of `feedback-report.md`); the CEO decides any Role removal from it.
Uses: the Step file layout of `handoff` v1.1 (`.company/work/<run>/NN-<role>.md`) and the Role names in `agents/*.md`.
Rationale: a Role that no later Handoff of its run ever names is a candidate for removal; the report lists candidates and never removes anything.

## Command
`node scripts/cited.mjs report --runs <N>` from the product root. `<N>` is digits only, 1 to 50. Any other argument shape or value: `refused: ...`, exit 3. Exit 0 otherwise.

## What is read
- Run folders `.company/work/<name>` (a name `isWorkFolder` accepts: new name or legacy slug; other names are ignored; names compare case-folded on win32 and darwin), newest first by folder time, at most the `<N>` newest that hold a Step. A linked folder is skipped and counted.
- Step files in a run: `^(\d{2,3})-((?:spike-)?<role>)\.md$` with `<role>` an `agents/*.md` name. `00-*` files, plan files (`NN-architect-plan.md`) and other names are not Steps. A Step file that is a link, not a plain single-link file, over 256 KiB, not valid UTF-8, or names no known Role is skipped and counted. At most 500 files per run and 8 MiB in all; the rest is skipped and counted.

## Cites (a later Handoff of the same run: a higher `NN`)
A Step is cited when a later valid Step file of the same run contains, anywhere (frontmatter `read_next` included):
- its file stem, bare or with `.md` or after a path: `04-senior-engineer`, `04-senior-engineer.md`, `.company/work/x/04-senior-engineer.md`. The token must not touch a letter, digit or `-` on either side, so `04-senior-engineer-plan` and `104-senior-engineer` do not match;
- prose `Step NN` or `step NN` with the Step's number (`Step 11`), which names every Step numbered 11 of that run (parallel Steps share a number; over-crediting only keeps a Role off the list).
A Step never cites itself or an earlier Step. Measured on the 14 real runs of this repo (2026-10-29): `Step NN` prose is the most common shape (about 500 uses), then `NN-role.md` file names (hundreds), while `read_next` holds source paths and finding ids, almost never a Handoff.

## Output (LF, one line each, Role names only; no Handoff text)
```
cited-report: runs <n>
keep <role>              one for each keep lane, always
cited <role>: <c> of <w>   Steps cited of Steps written, c >= 1
never cited <role>       w >= 1, c = 0
skipped <k>
```
Roles sorted by name. Keep lanes are `security`, `pentester`, `vuln-scanner`, `legal`, `accessibility-tester`, `senior-engineer`. They are frozen in the script: printed `keep` whatever the counts, never as `never cited`, and nothing read from a Handoff can change that.

## Compatibility
New Contract. No stored data. Adding a line kind is a minor bump; changing the cite rule or a line shape is a major bump.
