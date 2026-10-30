# Receipts and reports

## In short
After a run you can print a receipt: what the run's records show, nothing more. A report lists which Roles' work later Steps actually used. Both only read. They change nothing and only you decide about removing a Role.

## How it works
1. Run `ledger.mjs receipt <run>` for a receipt of one run.
2. Run `node scripts/cited.mjs report --runs <N>` for the never-cited report.
3. `/aico:feedback` shows the report lines under `## Cited`.
4. Read the limits of the checks below before you rely on them.

## Technical details
### Receipts
`ledger.mjs receipt <run>` prints what the run's records show, and only the lines that were recorded: time, tokens, Gates and Fix rounds. A cost line appears only when a cost is recorded (see [Cost from telemetry](token-cost.md#cost-from-telemetry)). With `--baseline` it can also compare the time with the median of up to three earlier runs.

### The never-cited report
`node scripts/cited.mjs report --runs <N>` (1 to 50) reads the newest run folders and counts, for each Role, how many of its Step files a later Step of the same run cites. A Step is cited when a later Handoff names its file (`04-senior-engineer`, with or without `.md` or a path) or says `Step 04`. A Step number is shared by parallel Steps, so a prose cite can credit more than one Role. It is read-only and prints Role names only, no Handoff text:
- `keep <role>` for each keep lane, always: security, pentester, vuln-scanner, legal, accessibility-tester and senior-engineer.
- `cited <role>: <c> of <w>` for Steps cited of Steps written.
- `never cited <role>` for a Role that wrote Steps and had none cited.
- `skipped <k>` for files and folders that were not read.

`/aico:feedback` puts these lines under `## Cited`. A keep lane is never a removal candidate. Only you decide whether a Role is removed.

### Residual risks
These are limits of the checks, stated plainly.
- **The plan scan.** A Role that edits `Decided:` lines into the plan, or appends a `begin` record and rewrites the plan into a clean one, passes the scan. Read the plan at the Plan Gate, or, in feature and fix, which have no Plan Gate, in the Ship Gate summary.
- **User settings.** A Role with Bash can write your user `settings.json`. "Block wins" guards against project files only, the same limit as `pipeline.short_path`.
- **Git environment.** The judging scripts drop inherited `GIT_*` variables. A Role that can write `.claude/settings*.json` or a shell profile can still add hooks or aliases that change later commands.
- **Crafted binary files.** A file on the binary type list whose leading bytes are both a media header and code passes as `binary file changed`. These signatures are also a valid JavaScript start: `true` (ttf), `GIF8` (gif), `ID3` (mp3), `OggS` (ogg), `fLaC` (flac), `OTTO` (otf), `wOFF` (woff), `wOF2` (woff2), `RIFF` (webp, wav), and any 4 bytes plus `ftyp` (mp4, m4a, mov). CommonJS `require` runs such a file whatever its extension, so reviewers block any change that loads such a file as code, by any route.
