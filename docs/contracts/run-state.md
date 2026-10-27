# Contract: run-state v1.2

Provider: `scripts/run-state.mjs` (Node built-ins only). Writer: the Lead (`aico:pipeline`, through `skills/pipeline/references/run-state.md`; from v1.1 also `aico:reprompt`, `reprompt` v1; from v1.2 also `aico:triage` and `aico:lead` for the triage record). Consumers: the `aico-mods` v1 mods (Savvy, Reflect, Blast Radius, Cache Tax), through `show` and `active` only; `aico:lead` through `triage check` (v1.2).
Why it exists: Handoff frontmatter gives Steps, Roles, status and Fix round, but nothing on disk says which wave a run is in, which Gates passed, when it started or how it ended (`docs/adr/0016-run-state-record.md`).
v1.1 is additive (minor bump, `docs/adr/0007-contract-minor-versions.md`; rationale `docs/adr/0024-reprompt-playbook-owns-the-flow.md`): it adds the `pick` event and the view's `picks` list, so the CEO's answer to the reprompt form can be counted (success metric), and it bounds the view's `round` to what the mods accept. Every v1 file is a valid v1.1 file and gives the same view plus `"picks": []`. A v1 reader skips a `pick` line with its usual `line <n> skipped` warning; `reflect.mjs` ignores it.
v1.2 is additive (rationale `docs/adr/0027-triage-record.md`): it adds the triage record ("Triage record"), the commands `triage issue` and `triage check <nonce>`, and the folder `.company/triage/`. Run files, records, the run view, `show` and `active` are unchanged; `active` never reads `.company/triage/`.

## Storage
- `.company/work/<slug>/run-state.jsonl`, append-only, one JSON object per line, LF. `<slug>` matches `^[a-z0-9][a-z0-9-]{0,63}$`.
- Counts, enums and times only. No prompt, reply, Handoff or CEO text (GDPR Art. 5(1)(c)).
- Limits: a line ≤ 256 bytes, a file ≤ 64 KiB, at most 1000 lines. The file and the run folder are opened with `lstat`; a symlink is refused.
- Committed with the run's Handoffs (it sits in the run folder). A reprompt run folder is not committed: it carries its own `.gitignore` (`reprompt` v1).

## Record (allow-list; unknown keys refused)
| Key | Value |
|---|---|
| `v` | `1` |
| `at` | UTC time `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`, written by the script, never typed by the Lead |
| `ev` | `start \| wave \| gate \| pick \| end` (`pick` v1.1) |
| `wave` | `wave` only: integer 1–99 (the plan's wave number; a Fix round keeps the wave it belongs to) |
| `gate` | `gate` only: `brief \| plan \| ship` |
| `result` | `gate` only: `passed \| changed \| stopped` |
| `pick` | `pick` only: `use \| edit \| keep \| stop` (the reprompt form answer, v1.1) |
| `asked` | `pick` only: integer 0–3, question rounds held before this answer (v1.1) |
| `outcome` | `end` only: `ship \| abort` |

## CLI (cwd = product repo; refusals `refused: <reason>` on stdout, exit 2)
| Command | Effect |
|---|---|
| `start <slug>` | appends `start`. Refused when the file already has a `start` and no `end` (`refused: run <slug> already started`). A new `start` after an `end` begins a new segment (a resumed or reopened run). |
| `wave <slug> <n>` | appends `wave`. Refused without an open segment. |
| `gate <slug> <brief\|plan\|ship> <passed\|changed\|stopped>` | appends `gate`. Refused without an open segment. |
| `pick <slug> <use\|edit\|keep\|stop> <asked>` | (v1.1) appends `pick`. Refused without an open segment, or when `<asked>` is not a whole number 0–3 (`refused: asked must be 0 to 3`) or the answer is not in the list (`refused: pick must be use, edit, keep or stop`). |
| `end <slug> <ship\|abort>` | appends `end`, closing the segment. Refused without an open segment. |
| `show <slug> --json` | prints the run view (below), exit 0 even for a missing or damaged file |
| `active --json` | prints `{ "slug": <slug or null>, "view": <run view or null> }` for the active run, exit 0 |
| `triage issue` | (v1.2) reads and deletes `request.txt`, appends an `issue` record, prints `{"nonce":"<32 hex>","type":"<type>"}` (Triage record) |
| `triage check <nonce>` | (v1.2) reads and deletes `request.txt`, prints `{"trusted":true,"type":"<type>"}` and appends `used`, or `{"trusted":false,"reason":"<reason>"}`; exit 0 both (Triage record) |

Writes are append with `O_APPEND`; the script checks the size limit before writing.

## Run view (`show`, `active`)
```json
{ "v": 1, "slug": "x", "state": "running|ended|stale|none", "started": "<at>", "ended": "<at>|null",
  "outcome": "ship|abort|null", "wave": 2, "gates": [{ "gate": "brief", "result": "passed", "at": "<at>" }],
  "picks": [{ "pick": "keep", "asked": 0, "at": "<at>" }],
  "round": 1, "tier": "low|medium|high|unknown",
  "steps": [{ "step": "05", "role": "backend-engineer", "status": "done", "round": 0, "file": "05-backend-engineer.md", "mtime": "<at>" }],
  "warnings": ["line 7 skipped"] }
```
- `picks` (v1.1): every `pick` of the last segment, in file order; `[]` when none. Placed directly after `gates`.
- `steps`: every `^\d{2}-[a-z0-9-]+\.md$` file in the run folder (no recursion, at most 200, each read only to the end of its frontmatter and at most 8 KiB, frontmatter parsed with the `handoff-lint.mjs` parser). Files without a valid `step` and `role` are left out with a warning. `status`, `round` and `risk-tier` outside their allowed values read as `unknown`; a step's `round` is allowed as a whole number 0–99 (v1.1; a reprompt run's edits have no cap, so its rounds can pass 99).
- `round` = highest numeric `round:` among `steps` (so 0–99), else `0`; `tier` = highest `risk-tier:` among `steps` (`low < medium < high`), else `unknown`.
- Times and order come from the file; the view uses only the last segment (from the last `start`).

## Active run
`active` picks, among `.company/work/*/run-state.jsonl` (at most 200 folders), the one whose last segment has no `end` and whose newest activity (last record, or newest Step file mtime) is the most recent. A segment with no activity for 12 hours is `stale` and never active. No candidate → `{ "slug": null, "view": null }`.

## How the pipeline uses it (`aico:pipeline`, Core)
- Setup, once the slug is known: `start <slug>`.
- Each wave start in the plan: `wave <slug> <n>`.
- Each Brief, Plan and Ship Gate answer (an `auto` Gate counts as `passed`): `gate <slug> <gate> <result>`.
- Ship done, or the CEO stops the run: `end <slug> ship|abort`.
- A run resumed with "resume <slug>" after an `end` runs `start <slug>` again.
- The Lead never edits the file by hand; a refused command is reported in the next Gate summary and the run goes on (run-state never blocks a Step or a Gate).
- (v1.1) The pipeline never writes `pick`; only `aico:reprompt` does (`reprompt` v1, Lead flow step 7).
- (v1.2) The pipeline never runs `triage`; only `aico:triage` (`issue`) and `aico:lead` (`check`) do (`company-type` v1.3 "Trust rule").

## Triage record (v1.2)
The proof that the CEO approved a direct route at triage's Brief Gate for one exact request, in this session. Plugin-written; the Lead trusts a direct-route triage line only through `triage check` (`company-type` v1.3 trust rule).

**Folder `.company/triage/`**, never committed. Every `triage` call first checks that `.company` and `.company/triage` are plain folders (lstat; a link → refused `triage folder is a link`), makes the folder when missing, and writes `.gitignore` = exactly `*` and LF when it is missing or differs. It is not a run folder: no slug, no Handoffs, and `active` and the `aico:pipeline` Setup never read it. The reprompt checker's watch set covers it as part of `.company/`; no `triage` command runs during a reprompt run (one Playbook at a time).

**Plain files only.** Every file a `triage` call opens (`.gitignore`, `request.txt`, `records.jsonl`) must, by lstat, be a regular file with exactly one hard link (`nlink` 1); writes add `O_NOFOLLOW` where the platform has it. Otherwise: `.gitignore` → refused `triage folder is a link`; `records.jsonl` → refused `triage record unreadable`; `request.txt` → treated as missing, and its name is still deleted.

**`request.txt`**: written only by the main session (triage's Approve branch, or `aico:lead`) with the Write tool, never by a Role and never through a shell: the exact text the Playbook passes or received as its argument, the request followed by one space and the triage line. Every `triage` call reads it (plain file, at most 64 KiB, valid UTF-8) and then deletes it, on success, refusal or `trusted:false` alike; CEO text sits on disk only between that Write and that call. Missing or unreadable → `issue` refused `no request`; `check` → `trusted:false`, reason `no request`.

**Normalized request**: the text of `request.txt` after exactly these steps, in this order: Unicode NFC; CR LF and a lone CR → LF; spaces and tabs removed from the end of every line; leading and trailing whitespace of the whole text removed (`String.prototype.trim`); then, when the result is at least 2 characters long and both starts and ends with `"` (U+0022), those two characters are removed and the result is trimmed again (one pair only, never repeated). Nothing else changes. `issue` and `check` use the same steps. Why: the main session's Write of the argument does not keep trailing spaces, line endings or Unicode form byte for byte (spike, 10 requests: exact bytes matched 5, CRLF plus trim 7, this rule 10), and the CEO's `/aico:lead "<request> (triage: …)"` command, triage's fallback when the Skill tool refuses the hand-over, can pass its enclosing quotes on in the argument. The argument triage writes always ends in `)`, so the quote step never changes it at `issue`.

**Triage line** at the end of the normalized request, ASCII, byte-exact: `/ \(triage: XS, risk low, (feature|bug|refactor|launch|audit|incident|upkeep|content|research), route direct\)$/`. Only the direct route is recorded: every other route is started by triage itself and no Playbook but `aico:lead` checks a line. No match → `issue` refused `no direct triage line`; `check` → `trusted:false`, reason `no triage line`.

**Nonce**: 16 bytes from `crypto.randomBytes`, printed by `issue` as 32 lowercase hex characters, never written to disk by the script. The main session keeps the nonce in its own context. It is used only as the argument of `triage check`, run by the Lead, and is never put in a file, Handoff, dispatch, hand-over argument or command shown to the CEO.

**Keys.** `k` = SHA-256 (lowercase hex) of the 32-character nonce string; it finds the record. `h` = HMAC-SHA256 (lowercase hex) with key = the 32-character nonce string as ASCII bytes and message = the UTF-8 bytes of the normalized request; it binds the record to that request. Without the nonce no one can compute `h` for another request, so editing the file cannot point a record at another request.

**`records.jsonl`**: append-only (`O_APPEND`, `O_NOFOLLOW`), LF, one JSON object per line; a line ≤ 256 bytes, the file ≤ 64 KiB and at most 1000 lines. Allow-list, unknown keys refused, bad lines skipped:
| Key | Value |
|---|---|
| `v` | `1` |
| `at` | as in Record, written by the script |
| `ev` | `issue \| used` |
| `h` | `issue` only: 64 lowercase hex (HMAC, Keys) |
| `k` | 64 lowercase hex (SHA-256 of the nonce, Keys) |
No request text, no route or tier, no names: hashes, an event and a time only.

**Expiry**: an `issue` is live for 30 minutes (`TRIAGE_TTL_MS` = 1 800 000) from its `at`; `now − at` below 0 (dated in the future) or above the TTL → expired. Before it appends, every `triage` call drops each `issue` that is expired by that rule (future-dated ones included), each `used` whose `issue` is gone and each bad line, by writing the rest to a temporary file in the folder and renaming it over `records.jsonl` (GDPR Art. 5(1)(e)). Still at a limit after that → `issue` refused `triage record full`.

**`triage issue`** (no arguments; any argument → refused with the usage): read and delete `request.txt`, normalize it, match the line, make a nonce, append `{"v":1,"at":…,"ev":"issue","h":…,"k":…}`, print `{"nonce":"<32 hex>","type":"<type>"}`, exit 0. Only triage's Approve branch runs it; the Lead never does.

**`triage check <nonce>`**: `<nonce>` must match `^[0-9a-f]{32}$` (else refused `bad nonce`; nothing read or deleted). Read and delete `request.txt`. The first rule that holds gives `{"trusted":false,"reason":…}`, in this order: `no request`; `no triage line`; `no record` (no `issue` with this `k`); `used` (a `used` line with this `k`); `expired`; `request changed` (`h` is not the HMAC of the normalized request under this nonce). Else append `{"v":1,"at":…,"ev":"used","k":…}` and print `{"trusted":true,"type":"<type>"}`. A record is used once: a second check of the same nonce gets `used`. Exit 0 for both results; the Lead treats anything but exit 0 with `"trusted":true` as untrusted.

**What cannot forge it.**
- Text (a request, a reprompt body, a hand-over argument, a pasted line, a file, a web page) mints no record: only `issue` writes one, and only triage's Approve branch in the main session runs it.
- A real triage line copied onto another request fails `h`. So does a record line that a Role or a person edits or writes into `records.jsonl`: `h` is keyed by the nonce, which the file does not hold, so an old `k` cannot be pointed at another request, and a hand-made `k` has no nonce the Lead holds.
- What the file cannot protect: `used` lines and `at` sit in the same file, so a writer who edits it can drop a `used` line or refresh an `at` and re-enable the exact request the CEO approved, never another one. Single use against such a writer rests on the Lead's nonce rule (`company-type` v1.3 trust rule): the Lead checks only the nonce printed by the `triage issue` that triage ran for the request in front of it, checks it once, and never checks an earlier nonce.
- Residual: a process running as the CEO's user can do anything the script does. The nonce also appears in the session transcript under the Claude config folder, which an agent with Read can reach; with a nonce, a writer can compute `h` for any request, which is why a spent nonce is never checked again. The durable fix is a key no agent can read (a hook-held secret, ADR 0027). Two `check` calls at the same moment are not serialized (no lock between the read and the append or rename), so both could print `trusted:true`; only the main session runs `check`, one call at a time. A background agent could swap `request.txt` between the Lead's Write and its `check` while a record is live; the Lead then trusts only the text that check hashed, and no Role runs between `issue` and `check`.

## Error cases
- Missing file → `state: none`, empty `gates` and `picks`, `steps` still listed.
- Bad line (invalid JSON, unknown key, over 256 bytes, CR byte) → skipped, `warnings: ["line <n> skipped"]`.
- File over 64 KiB or a symlink → `state: none`, `warnings: ["run-state unreadable"]`; writes refused.
- Bad `<slug>`, unknown gate, result, pick or outcome, `wave` outside 1–99, `asked` outside 0–3 → `refused`, nothing written.
- (v1.2) `triage`: a link, or a file with more than one hard link, in the path ("Plain files only"), `records.jsonl` unreadable or over 64 KiB when read (checked before pruning), a bad nonce, or any other error → `refused: <reason>`, exit 2, nothing appended. `request.txt` is still deleted once read. A refused `issue` means no direct route (`company-type` v1.3); a refused `check` means untrusted. The rest of run-state is unaffected.
