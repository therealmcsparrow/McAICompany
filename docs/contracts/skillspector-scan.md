# Contract: skillspector-scan v1

Provider: `scripts/skillspector.mjs` (Node built-ins only, proj.S1). Consumers: the `/aico:skillspector` Playbook (`skills/skillspector/SKILL.md`), `scripts/skill-picks.mjs vet` (the Lead's pre-approval scan, `skill-recommendation` v1), the Lead's post-install scan (`skills/lead/references/skill-picks.md`).
The third-party tool is NVIDIA SkillSpector (Apache-2.0), run as its CLI only. Rationale: `docs/adr/0018-skillspector-through-a-tested-wrapper.md`, `docs/adr/0019-lead-runs-the-gating-scan.md`. Facts about the tool: `.company/work/skill-researcher-scan/02-tech-researcher.md` (v2.12.0), spikes SP1 (`06-spike-backend-engineer.md`) and SP2 (`04-spike-backend-engineer.md`), and the installed v2.13.1 source read in Fix round 1 (`26-architect.md`). Still v1 and unreleased; Fix round 1 changes are folded in.
Everything the tool prints is untrusted (AC13): only the fields named under "Shape guard" are read, and no free text from it (`finding`, `explanation`, `remediation`, `code_snippet`, `pattern`, `evidence`, `message`, `skill.name`) ever reaches stdout, a report, a Handoff or a shell.

## Names and roots
- Skill name allow-list: `^[a-z0-9][a-z0-9-]{0,63}$` (ASCII only, so a Unicode lookalike, `..`, `/`, `\`, `:`, a drive letter, `;`, a backtick, `$(`, `|`, a space and a name over 64 characters all fail). A name that fails is refused before any file access, and is never echoed. The refusal states the rule: `refused: bad skill name (lowercase letters, digits and -, at most 64)`.
- Roots per scope (a root that does not exist is skipped):
  - `project`: `<cwd>/.claude/skills`, `<cwd>/.agents/skills`
  - `global`: `<home>/.claude/skills`, `<home>/.agents/skills` (`<home>` = `os.homedir()`; tests point `HOME`/`USERPROFILE` at a temp dir, proj.M8)
  - `quarantine`: `<os.tmpdir()>/aico-quarantine-<id>/repo`, `<id>` = `^[0-9a-f]{12}$`
  Plugin-cache skills are never in scope.
- **Project root containment (Fix round 1, security B1).** A project root is used only when `lstat` shows that none of `<cwd>/.claude`, `<cwd>/.agents`, and the root itself is a symlink or junction, **and** `realpath(root)` lies strictly inside `realpath(cwd)`. Otherwise the root is skipped and counted in `roots_refused` (output and report). Global and quarantine roots stay trusted as before. Each used root is passed through `fs.realpathSync` once.
- Resolution of a skill `<n>` in a scope: for each used root, `<root>/<n>` → `realpathSync`. The real path must lie strictly inside one of the used, realpath'd roots of **any** scope above (`path.relative` neither empty, nor absolute, nor starting with `..`). So a project link `.claude/skills/<n>` → `.agents/skills/<n>` is scanned, and a link or junction whose target leaves every root is `outside-roots`. Two entries with the same real path are scanned once; two **different** real paths with the same name are both listed and scanned, each with its `root` (`claude` or `agents`).
- The **resolved real path** is what the tool receives (it refuses symlinked inputs with exit 2).

## CLI (cwd = product repo; refusals `refused: <reason>` on stdout, exit 2; every success exits 0, also with findings)
| Command | Effect |
|---|---|
| `detect --json` | `{ "v":1, "installed":bool, "version":str\|null, "commit":str\|null, "uv":bool }`. Runs `skillspector --version` and `uv --version` (10 s each). `installed: false` when the spawn emits `error` with `code: 'ENOENT'`. `commit` from the tool's `direct_url.json` under `uv tool dir` when found, else `null`. Always exit 0. |
| `install-commands --json` | `{ "v":1, "install":[…], "rollback":[…] }`, the constants below |
| `list --scope project\|global\|all --json` | `{ "v":1, "skills":[{ "name", "scope", "root" }], "skipped_invalid":n, "truncated":n, "roots_refused":n }`; at most 200 skills per run, the rest counted in `truncated`. Only names that pass the allow-list are printed. |
| `scan --scope project\|global\|all [--skill <n>] [--mode no-llm\|claude_cli] [--report <slug>] --json` | scans every skill in scope, or every match of `<n>` (must be in the `list` output for that scope, else `refused: skill not found`) |
| `fetch <owner>/<repo> [--ref <sha>] --json` | new quarantine, see "Quarantine"; `{ "v":1, "id", "commit", "skills":[names], "skipped_invalid":n }` |
| `scan --quarantine <id> [--skill <n>] [--mode …] --json` | scans skills inside that quarantine |
| `clean --quarantine <id>` | removes it; `fetch` also removes `aico-quarantine-*` folders older than 24 h |
| `help`, `--help` | one usage line per command above on stdout, exit 0 |

Arguments are a fixed grammar: an unknown or repeated flag, an extra positional, or `scan` with neither or both of `--scope` and `--quarantine` → `refused: usage …`. `<owner>/<repo>` = the `design-skills-section` v1 repo pattern; `<sha>` = `^[0-9a-f]{40}$`; `<slug>` = `^[a-z0-9][a-z0-9-]{0,63}$`.
Callers never put user text on a command line: the Playbook matches the CEO's argument by string equality against `list` output and passes the listed name (AC8).
- **Export for `skill-picks.mjs` (Fix round 1):** `vetCandidate({ source, commit, name, mode })` = `fetch <source> --ref <commit>`, then `scan --quarantine <id> --skill <name>`, then `clean --quarantine <id>` in a `finally`, so a quarantine never outlives the call. Returns `{ commit, result }` (`result` = one `results[]` entry below) or `{ refused: <reason> }` (`fetch failed`, `candidate too large`, `skill not in repo`, `git missing`, `skillspector missing`). Inputs are re-validated with the patterns above.

## Progress (Fix round 1, S2)
`scan` writes progress to **stderr** only (stdout stays one JSON document): first `scan: <m> skills, about <s> s` (`<s>` = `m × 15` in `no-llm`, `m × 60` in `claude_cli`), then one line per skill as it finishes, `scan: <i>/<m> <name> <verdict>`. `<name>` is the allow-listed name; nothing from the tool is printed. `detect` prints nothing extra.

## Mode
- `--mode` given → that value. Absent → `node settings.mjs get skillspector.mode` (`aico-settings` v1.2, 5 s); any failure → `no-llm`.
- `no-llm` → the tool gets `--no-llm`. `claude_cli` → no `--no-llm`, and the child env sets `SKILLSPECTOR_PROVIDER=claude_cli`. There is no provider flag; the env var is the only selector.
- Effective mode per skill: `no-llm`; `claude_cli` only when `metadata.llm_requested`, `metadata.llm_available` are `true` and `metadata.llm_provenance.provider.effective_adapter` is `claude_cli`; otherwise `static-fallback` (shown as "static fallback, not an LLM scan"). In `no-llm` a `metadata.llm_requested: true` is `error` `mode-mismatch`.
- `claude` unavailable (SP1): the tool exits **2** with parsable JSON, `execution_successful: false`, so the skill is `error` `not-successful` (rule 2 below). `static-fallback` stays for a run that succeeds with `llm_available: false`.
- No API key is asked for, read or passed (AC11, proj.M-SEC2). The `claude` login works under the env allow-list below. Only the CEO's Playbook flag passes `--mode`; `skill-picks.mjs vet` and the Lead's post-install scan never do.

## Network (what leaves the machine; Fix round 1, security B2)
- **Both modes:** SkillSpector's supply-chain rule SC4 (`nodes/analyzers/static_patterns_supply_chain.py`, `osv_client.py`) sends the package names, versions and ecosystem found in a scanned skill's dependency files (`requirements*`, `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `pyproject.toml`, `setup.py`, `Pipfile`, `uv.lock`, `poetry.lock`) to `https://api.osv.dev/v1/querybatch`, and the ids of vulnerabilities found to `https://api.osv.dev/v1/vulns/<id>`. A skill with no such file sends nothing. No skill text is sent.
- **`claude_cli` only:** the text of each scanned skill also goes to Anthropic through the local `claude` login.
- **No off switch.** v2.13.1 has no flag or supported setting that turns SC4 off. `SKILLSPECTOR_OSV_TIMEOUT` only sets the timeout; at `0` the lookup is skipped but recorded as a runtime limit, which makes the scan `incomplete` (`error`) for every skill with a dependency file. So aico passes no `SKILLSPECTOR_*` variable beyond the provider (env allow-list below) and states the lookup wherever the mode is described. OSV unreachable (offline, proxy not passed) → the tool falls back to its static list and records the gap; such a scan is normally `incomplete`.
- Every text that describes `no-llm` uses this meaning: "static rules on this machine; no skill text leaves it; package names and versions from a skill's dependency files go to OSV.dev for a vulnerability lookup". The sentence in `aico-settings` v1.2 is the one source; others say the same.

## Child process
- argv is exactly `[skillspector, "scan", <real path>, "--format", "json", "--no-llm"]` in `no-llm` and the same without `"--no-llm"` in `claude_cli`. A test pins both arrays as exact values. Never `-r`, `-o`/`--output`, `--fail-on-*`, `--baseline`, `--use-shipped-baseline`, `--yara-rules-dir`, `--transitive*`, a Git URL or a path that was not resolved above. One skill per call.
- **Baselines (SP2):** the only file the tool reads from a scanned folder is a top-level `<skill>/.skillspector-baseline.yaml`, and only `--use-shipped-baseline` applies it. The wrapper never passes either baseline flag, so such a file stays inert; `suppressed_count !== 0` is still `error`. The tool reads no config, baseline or `.env` file from the cwd.
- `spawn` with `shell: false`, `windowsHide: true`, stdin ignored, cwd = a fresh empty `mkdtemp` dir. On Windows `spawn('skillspector', …)` finds the uv shim `skillspector.exe` through `PATH` without a shell (SP2). A `.cmd` or `.bat` shim surfaces as `spawn-failed`, never as a reason to turn on a shell.
- **Not installed** = the child emits `error` with `code: 'ENOENT'`. Any other `error` event is that skill's `spawn-failed`.
- Env is an allow-list, nothing else is passed: `PATH PATHEXT SYSTEMROOT SystemDrive WINDIR COMSPEC TEMP TMP TMPDIR HOME USERPROFILE APPDATA LOCALAPPDATA XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME LANG LC_ALL`, plus `PYTHONIOENCODING=utf-8`; in `claude_cli` also `CLAUDE_CONFIG_DIR` (when set) and `SKILLSPECTOR_PROVIDER=claude_cli`. Every other `SKILLSPECTOR_*`, `*_API_KEY`, `ANTHROPIC_*`, `NVIDIA_*`, `OPENAI_*` is dropped.
- Outer wall clock: 180 s (`no-llm`), 900 s (`claude_cli`). Stdout cap 8 MiB; stderr is drained and dropped.
- On timeout or oversize the whole process tree is killed, by PID only, never by image name:
  - Windows: `execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true })`.
  - POSIX: spawn with `detached: true`, then `process.kill(-pid, 'SIGKILL')` for the process group.
- **Order (Fix round 1, review):** the kill runs and the child's `close` is awaited **inside** the temp-cwd callback, before the cwd is removed. The removal uses `rmSync(…, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })`; a removal that still fails is ignored for that skill (the OS temp sweep is enough) and never turns the run into `error: internal`. A test drives `scanOne` with a real long-running child and the real runner.

## Classification (per skill; the first rule that matches wins)
1. Pre-checks, no spawn: `not-found`; `outside-roots`; `no-skill-md` (no `SKILL.md`, or it is not a regular file by `lstat`); `symlink-inside` (any symlink or junction anywhere in the skill dir); `too-large` (walk over 5000 entries or depth 10).
2. In this order:
   - `spawn-failed`, `timeout`, `oversize`.
   - **Exit 2:** stdout parses as a JSON object and `execution_successful === false` → `not-successful`; else `analysis_completeness.is_complete === false` → `incomplete`; else `exit-2`. Only these two booleans are read here (`Object.hasOwn`).
   - `exit-<n>` (any exit other than 0, 1 or 2).
   - Exit 0 or 1: `unparsable` (empty or invalid JSON), `shape` (guard fails, incl. an unknown severity), `not-successful` (`execution_successful !== true`), `no-components` (`components.length < 1`), `incomplete` (`analysis_completeness.is_complete !== true`, **unless the reference caveat below holds**), `suppressed` (`suppressed_count !== 0`), `mode-mismatch`.
   Any of 1–2 → verdict **`error`**, never `pass` (AC13).
3. Otherwise counts `critical high medium low` from `issues[].severity` (never from the exit code). `blocking` = `critical + high > 0`, or `max_issue_severity` HIGH/CRITICAL, or exit 1, or `recommendation` `DO_NOT_INSTALL`. Verdict **`pass`** = no issue, exit 0, not blocking; else **`findings`**.
   `risk_assessment.severity` is the score band and is never read.

**Reference caveat (Fix round 1, CEO decision 5).** SkillSpector marks a scan `partial` (`is_complete: false`) when a `SKILL.md` names a local path that is not in the skill folder (`reason_code: reference_missing`, for example `.company/project.md` or a file the skill writes at run time). Every bundled file is still inspected. The tool's own install gate (`mcp_server.py`, `reference_caveat_only`) accepts exactly this case. The wrapper does the same, and nothing wider. `is_complete: false` is **not** `incomplete` only when all of these hold, each checked with `Object.hasOwn` and its type:
- `execution_successful === true` and `analysis_completeness.execution_successful === true`;
- `analysis_completeness.limitations` is an array of length 0;
- `analysis_completeness.partially_inspected_files === 0` and `analysis_completeness.entirely_uninspected_files === 0` (integers);
- `analysis_completeness.ledger_exceptions` is an array of 1 to 1000 objects, each with `reason_code === "reference_missing"` and `fatal === false`.
Any field missing or of another type, any other reason code (`reference_unresolved`, `manifest_parse_error`, a runtime or size limit, …) → `incomplete` as before. The result then carries `refs_not_bundled: <number of exceptions>`, shown in the report. Fail-closed stays: the caveat can only turn `incomplete` into the normal rule 3, never skip rules 1, 2 or the shape guard.
Evidence: a recursive v2.12.0 scan of this repo's own skills (Fix round 1) had 23 of 32 skills `partial` with only `reference_missing` (incl. `brainstorm`, `handoff`, `review`), 5 complete and 4 with `manifest_parse_error`. Under the old rule, every real aico skill with a cross-reference was `error` in the default mode.

## Shape guard (the only fields read)
`risk_assessment.{score: int 0–100, recommendation: SAFE|CAUTION|DO_NOT_INSTALL, max_issue_severity: NONE|LOW|MEDIUM|HIGH|CRITICAL}`, `components: array`, `issues: array ≤ 10000` of `{ id, category, severity: LOW|MEDIUM|HIGH|CRITICAL, location.file, location.start_line }`, `suppressed_count: int`, `metadata.{skillspector_version, llm_requested: bool, llm_available: bool, llm_provenance.provider.effective_adapter}`, `execution_successful: bool`, `analysis_completeness.is_complete: bool`. Missing or wrong-typed → `shape`. A schema test pins this list against recorded real outputs, so tool drift fails closed.
- Read only for the reference caveat and the report detail (missing → caveat does not hold, never `shape`): `analysis_completeness.{execution_successful, limitations, partially_inspected_files, entirely_uninspected_files, ledger_exceptions[].reason_code, ledger_exceptions[].fatal}`.
- Unknown keys are ignored and never required: `risk_assessment.severity`, and the `metadata` keys that appear only sometimes (`llm_degraded`, `llm_error`, `llm_calls_attempted`, `llm_calls_succeeded`).

## Output (`--json`)
```json
{ "v": 1, "tool": { "version": "2.13.1", "commit": "f3b2569…" }, "mode": "no-llm",
  "results": [{ "name": "settings", "scope": "project", "root": "claude", "verdict": "findings", "blocking": false,
    "reason": null, "incomplete_codes": [], "refs_not_bundled": 0, "effective_mode": "no-llm", "shipped_baseline": false,
    "score": 12, "recommendation": "CAUTION",
    "counts": { "critical": 0, "high": 0, "medium": 1, "low": 0 },
    "issues": [{ "id": "…", "category": "…", "severity": "MEDIUM", "file": "SKILL.md", "line": 4 }] }],
  "skipped_invalid": 0, "truncated": 0, "roots_refused": 0, "summary": { "pass": 0, "findings": 1, "error": 0 } }
```
- `name`, `scope` and `root` are aico's own, never the tool's `skill.name`. `reason` is one code from "Classification" or `null`. `root` is `claude`, `agents` or `quarantine`.
- `incomplete_codes`: with `reason: incomplete`, the distinct `ledger_exceptions[].reason_code` values that match `^[a-z_]{1,40}$` (others become `?`), at most 5, sorted; else `[]`.
- `refs_not_bundled`: the count from the reference caveat, else `0`.
- `shipped_baseline`: `true` when `lstat(<real path>/.skillspector-baseline.yaml)` is a regular file; a warning only.
- `issues`: at most 50 per skill; `id` `^[A-Za-z0-9._:-]{1,64}$`, `category` `^[A-Za-z0-9_-]{1,40}$`, `file` `^[A-Za-z0-9._/-]{1,200}$` (no space; Fix round 1), `line` int ≥ 0; a value that fails becomes `?`.
- `tool.version`: `detect`'s `version` when it passes `^\d+\.\d+\.\d+([.+-][0-9A-Za-z.]{1,20})?$`, else the first result's `metadata.skillspector_version` when it passes, else `?`. One value per run, the same in the JSON and the report. `commit` is `detect`'s, when known.

## Report (`--report <slug>`; AC9, the only file a scan writes)
`.company/work/<slug>/skillspector-report.md`, built only from the output JSON and the fixed texts below; the folder is created when missing and refused when it, or the file, is a symlink (`lstat`); atomic write; LF. Lists, no tables, verdicts as words (proj.S2).
```markdown
# SkillSpector scan
- Date: <UTC>; tool: skillspector <version>[@<commit7>]; mode: <mode>; scope: <scope or one skill>
- Network: package names and versions from dependency files go to OSV.dev[; skill text goes to Anthropic (claude_cli)]
## Summary
- pass <n>, findings <n>, error <n>
## Skills
- <name> (<scope>): <verdict> — critical <c>, high <h>, medium <m>, low <l> — mode <effective_mode>[ — blocking][ — reason <code>[: <incomplete_codes>]][ — ships a baseline file (not applied)][ — <r> references to files outside the skill (not inspected)]
  - Why: <meaning>
  - Next: <step>
  - Issues: <id> <severity> <file>:<line>; … (at most 10, then "and <k> more in the JSON")
## Not scanned
- <n> entries with an invalid name were skipped (names not shown).
- <n> more skills over the limit of 200 were not scanned.
- <n> project skill folders are links or point outside the project, so they were not scanned.
```
- `Why` and `Next` lines appear for every skill that is not `pass` (and `Issues` when there are any). `## Not scanned` lines with a count of 0 are left out; the heading is left out when all are 0.
- Fixed texts (English in the file; the Playbook shows them in the run language). `<cmd>` is the removal text from the Playbook:
  - `findings`, blocking: Why "critical or high findings". Next "do not use it; remove it (<cmd>)".
  - `findings`, not blocking: Why "medium or low findings only". Next "read the issues below before you use it".
  - `not-found`: Why "not in the skill folders". Next "check the name with list".
  - `outside-roots`: Why "the folder is a link to a place outside the skill folders, so it was not scanned". Next "check the link; remove it if you did not make it".
  - `no-skill-md`: Why "no SKILL.md file". Next "check the folder; it is not a working skill".
  - `symlink-inside`: Why "it contains a link, which can point anywhere, so it was not scanned". Next "replace the link with the file, or remove the skill".
  - `too-large`: Why "over 5000 files or 10 levels deep, so it was not scanned". Next "check it by hand".
  - `spawn-failed`: Why "SkillSpector did not start". Next "run /aico:skillspector install, or check PATH".
  - `timeout`: Why "the scan took longer than <180|900> s". Next "scan this skill alone; with claude_cli, try no-llm".
  - `oversize`, `unparsable`, `shape`, `exit-2`, `exit-<n>`: Why "SkillSpector gave a result aico cannot trust". Next "run /aico:skillspector install to check the pinned version, then scan again".
  - `not-successful`: Why "SkillSpector reported a failed run (with claude_cli: often `claude` is not available)". Next "check that claude works, or scan with no-llm".
  - `no-components`: Why "SkillSpector found no files to scan". Next "check that the folder holds the skill files".
  - `incomplete`: Why "SkillSpector could not inspect all of it (<incomplete_codes>)". Next "do not treat it as checked; read the named files by hand, and check network access to api.osv.dev if a lookup failed".
  - `suppressed`: Why "findings were suppressed by a baseline". Next "report this; aico never applies baselines".
  - `mode-mismatch`: Why "an LLM was used although no-llm was asked". Next "report this; do not trust the result".
GDPR Art. 5(1)(c): names, verdicts, counts, issue ids and in-skill file paths only, never skill text.

## Quarantine (`fetch`, for candidates)
- `mkdtemp(<os.tmpdir()>/aico-quarantine-)` with a 12-hex id. `<url>` = `https://github.com/<owner>/<repo>.git`, built only from the validated `<owner>/<repo>`. `<cfg>` = `-c core.symlinks=false -c core.hooksPath=<empty dir> -c credential.helper= -c protocol.allow=never -c protocol.https.allow=always -c transfer.fsckObjects=true`, given on **every** git call.
- No `--ref`: `git <cfg> clone --depth 1 --single-branch --no-tags --no-recurse-submodules -- <url> <q>/repo`.
- With `--ref`: `git <cfg> init <q>/repo`, then `git <cfg> -C <q>/repo fetch --depth 1 --no-tags --no-recurse-submodules -- <url> <sha>`, then `git <cfg> -C <q>/repo checkout --detach FETCH_HEAD`.
- `--` before the URL is **mandatory** (SP2). `protocol.allow=never` refuses `file://` and `ext::` (SP2).
- Env (added to the child env allow-list): `GIT_TERMINAL_PROMPT=0 GIT_LFS_SKIP_SMUDGE=1 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=<os.devNull>`. `spawn` with `shell: false`, 120 s for the whole fetch, the same tree kill (inside the temp-dir callback, as above). `commit` = `git rev-parse HEAD`, must match `^[0-9a-f]{40}$` (and equal `<sha>` when given), else `refused: fetch failed`. `git` not found (ENOENT) → `refused: git missing`, exit 2.
- Bounds: ≤ 50 MiB and ≤ 5000 files after clone, `.git` excluded. **The walk never stops early (Fix round 1):** a symlink, junction or other non-regular entry is counted and not followed; a dir that cannot be read, or any such entry at all, → the quarantine is removed and `refused: candidate too large`. (`core.symlinks=false` is proven only on Windows, so a POSIX clone can hold links; refusing them here keeps the bound exact.)
- **Ownership (POSIX, Fix round 1):** `openQuarantine` and `cleanQuarantine` act only on a folder whose `lstat` is a real dir with `uid === process.getuid()`; the 24 h sweep skips any other. Windows has no `getuid`; the check is skipped there.
- Skills = folders up to depth 4 holding a regular `SKILL.md` whose folder name passes the allow-list. Nothing in a quarantine is ever executed, imported or installed (AC4).

## Install (AC10; the Lead runs these after the CEO picks Install, never a Role)
- Install, byte-identical, in this order: `uv tool install 'skillspector[mcp] @ git+https://github.com/NVIDIA/skillspector.git@v2.13.1'` then `claude mcp add --scope user skillspector -- skillspector mcp`.
- Rollback: `uv tool uninstall skillspector`, `claude mcp remove --scope user skillspector`.
- The form says both change user-scope config, gives the rollback, and names the pinned release v2.13.1 (CEO, Plan Gate P2). One constant in `skillspector.mjs`; a test pins the Playbook text, this Contract and the constant byte for byte. Recorded outputs from v2.12.0 stay valid test data (CEO waiver, Fix round 1).
- Always asked, whatever `gates.installs` says. `detect` says `uv: false` → say so and run nothing; aico never installs `uv`. After install, `detect` again; still missing → say so, no retry.
- **MCP:** aico never calls the SkillSpector MCP tool; the registration is for the CEO's own use. Any aico text that shows `scan_skill` passes `use_llm: false` explicitly; no agent lists an `mcp__skillspector` tool (pinned tests).

## Error cases
- Bad arguments, a name that fails the allow-list, a name not in scope, a bad id, slug or repo → `refused: <reason>` (input never echoed), exit 2, nothing scanned or written.
- Tool missing → `scan` and `fetch` print `refused: skillspector missing`, exit 3, no report written; callers then offer the Install form (AC3, AC10). Both run the `detect` probe first, so a run never stops halfway. An ENOENT on a later per-skill spawn is that skill's `spawn-failed`.
- A per-skill failure, including a failed temp-dir removal, is that skill's `error` verdict or nothing; the run goes on with the next skill and still exits 0.
- Internal failure → `error: internal` on stderr, exit 1, no report written.
