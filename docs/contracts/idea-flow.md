# Contract: idea-flow v1

New Contract. Provider: `scripts/idea-flow.mjs` (Node built-ins only). Writer of the record: the Lead of `aico:idea` and `aico:bug`, only through this CLI. Consumers: the same Leads (`options`, `state`, `read`) and `ticket-approval` v1 (reads nothing from it). The allowed picks of every form come from `options`, never from the Lead's text.

## Where it lives
- `.company/work/<slug>/idea-flow.jsonl`, slug `^[a-z0-9][a-z0-9-]{0,63}$`. No other path is accepted.
- Append-only, one JSON object per line, at most 2000 lines of at most 1024 bytes and 256 KiB in total. Created once with exclusive create (`O_CREAT|O_EXCL`); every later open is an append that checks the file is a regular file with one link and the same `dev` and `ino` as its `lstat`; `O_NOFOLLOW` is ORed in only where it exists (never on win32).

## Events
Keys are exactly those listed, in this order, plus `ts` (ISO 8601 UTC) last. Any other key, type or value breaks the record.
- `start`: `kind` (`idea` | `bug`).
- `pick`: `letter`, `route` (a letter from `options` and its route name).
- `done`: `step`, optional `size` (`XS|S|M|L`), `tier` (`low|medium|high`), `out` (see below).
- `park`: `name` (the final folder name).

## Transitions (the same for both kinds)
Forms and the picks they offer:
- grill form: `1 grilling`, `2 grill-me`, `3 grill-with-docs`. Then `done <grill step>`, then `done reprompt`.
- routes form: `A cooler`, `B brainstorm`, `C research`, `D to-spec`, `E park-idea`. After A: B C D E. After B: C D E. After C: `done reprompt` first, then D E.
- D: `done to-spec`, then `done to-tickets`, then the tickets form: `F build`, `G park-roadmap`, `E park-idea`.
- F: `done triage --size <s> --tier <t>`, then `done build`; the flow ends. G ends the flow at once, nothing built: the Lead has parked every ticket not yet parked in the roadmap through `ticket-approval` v1 `park-ticket`. E: `park-idea <slug> <name>` ends the flow.
- While a step is pending `options` prints no option line; `pick` is refused.
- `state` prints `build: feature` for kind idea and `build: fix` for kind bug. Nothing else depends on the kind; both kinds offer identical letters at every form.

## CLI (cwd = product root)
Every argument is at most 4096 characters and holds no character of Unicode category Cc, Cf, Zl or Zp, else `refused: argument is not accepted`, exit 3, before any command runs.
- `start <slug> --kind idea|bug`: creates the record (and the work folder if missing) with the `start` event. Prints `started`. A record that exists → exit 1 `exists`.
- `options <slug>`: prints `option <letter> <route>` per allowed pick, or `pending <step>`, or `ended`.
- `pick <slug> <letter>`: letter must be a single character of the open form's options, else `refused: not an allowed pick`, exit 3, nothing written. Prints `picked <letter> <route>`.
- `done <slug> <step> [--size S] [--tier T] [--out P]`: step from the fixed list `grilling, grill-me, grill-with-docs, reprompt, cooler, brainstorm, research, to-spec, to-tickets, triage, build`. `--size` and `--tier` are required for `triage` and refused for any other step. `--out` is a relative path of at most 200 characters from `[A-Za-z0-9._ /-]`, no leading `/`, no `.` or `..` segment, no empty segment; it is recorded, never opened. A step that is not the pending one → exit 1 `step out of order`.
- `park-idea <slug> <name>`: only while `park-idea` is pending. `<name>` matches `^[a-z0-9][a-z0-9-]{2,63}$` and is not a Windows device name (`con prn aux nul com1-9 lpt1-9`, with or without a `-` suffix part, case-folded); else exit 1 `name refused`. Copies the work folder (regular files only, no link followed or copied, depth 3, at most 200 files, 1 MiB each) to `.company/ideas/<name>/`; the directory is made without `recursive` so a collision is detected, then `<name>-2` to `<name>-9` are tried, then exit 1 `name taken`. Files are copied with exclusive create. The work folder is never changed or deleted. Prints `parked <final-name>`.
- `state <slug>`: prints `kind: <k>`, `form: <grill|routes|tickets|pending <step>|ended>`, `build: <feature|fix>`.
- `read <slug>`: prints `<n> <event> <fields>` per line, validated values only.
- Refusals `refused: <reason>` exit 3: `usage`, `argument is not accepted`, `bad slug`, `bad kind`, `bad step`, `bad size`, `bad tier`, `bad out`, `not an allowed pick`, `size and tier only for triage`, `size and tier required`. Exit 1, fail loud: `unknown slug`, `exists`, `step out of order`, `name refused`, `name taken`, `broken record`, `link`, `not a regular file`, `hard-linked`, `too large`.
- Output holds only fixed words, slugs, validated values and numbers; no argument or file text is echoed on a refusal.

## Personal data
The record holds the kind, step names, chosen routes, an optional artefact path and the parked folder name. A parked idea copy holds what the CEO typed, which can include personal data. Locations: `.company/work/<slug>/` and `.company/ideas/<name>/`, on the CEO's machine. aico never commits these files and writes no ignore rule for them: they are git-ignored only where the product ignores `.company/`, so the CEO should add `.company/` to the product's `.gitignore`. Recipients: the Claude model the CEO has configured reads the files in the Playbook runs; web search runs only in grilling lookups and research. McSparrow adds no other recipient. Archive rule: archived, never deleted early; an erasure request overrides it (CEO decides). Keep only what the decision needs (GDPR Art. 5(1)(c)).

## Error cases
- Broken record (bad JSON, unknown key, an event the transitions refuse, size caps) → exit 1 `broken record`; the Lead shows it and stops (fail closed).
- Script cannot run or prints nothing → the Lead stops.

## Compatibility
New Contract, v1. An added event, step, route or reason needs a new version.
