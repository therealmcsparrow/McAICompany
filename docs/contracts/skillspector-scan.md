# Contract: skillspector-scan v1.2

v1.2 (task input-fix, T10; additive): `--report '<work folder>'` (`writeReport`) checks the exact letter case of `.company`, `work` and the report folder with `exactWorkPath` of `work-folder-name` v1.1, after the `bad report slug` check and before anything is created. A folder listed only in another letter case → `refused: wrong letter case`, exit 2, nothing written. A folder missing in every case is made as before.

Provider: `scripts/skillspector.mjs` (Node built-ins only, proj.S1). Consumers: the `/aico:skillspector` Playbook (`skills/skillspector/SKILL.md`), `scripts/skill-picks.mjs vet` (the Lead's pre-approval scan, `skill-recommendation` v1), the Lead's post-install scan (`skills/lead/references/skill-picks.md`).
The third-party tool is NVIDIA SkillSpector (Apache-2.0), run as its CLI only. Rationale: `docs/adr/0018-skillspector-through-a-tested-wrapper.md`, `docs/adr/0019-lead-runs-the-gating-scan.md`, `docs/adr/0020-bind-the-scan-to-the-installed-bytes.md`. Facts about the tool: `.company/work/skill-researcher-scan/02-tech-researcher.md` (v2.12.0), spikes SP1 (`06-spike-backend-engineer.md`) and SP2 (`04-spike-backend-engineer.md`), and the installed v2.13.1 source read in Fix round 1 (`26-architect.md`). Facts about the skills CLI 1.7.4: its `dist/cli.mjs`, read in Fix round 2 (`40-architect.md`). Still v1 and unreleased; Fix rounds 1 to 3 are folded in.
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
| `scan --scope project\|global\|all [--skill <n>] [--mode no-llm\|claude_cli] [--report '<work folder>'] --json` | scans every skill in scope, or every match of `<n>` (must be in the `list` output for that scope, else `refused: skill not found`) |
| `fetch <owner>/<repo> [--ref <sha>] --json` | new quarantine, see "Quarantine"; `{ "v":1, "id", "commit", "skills":[names], "skipped_invalid":n }` |
| `scan --quarantine <id> [--skill <n>] [--mode …] --json` | scans skills inside that quarantine; with `--skill`, only the bound folder of `<n>` ("Bound skill folder") |
| `clean --quarantine <id>` | removes it; `fetch` also removes `aico-quarantine-*` folders older than 24 h |
| `help`, `--help` | one usage line per command above on stdout, exit 0 |

Arguments are a fixed grammar: an unknown or repeated flag, an extra positional, or `scan` with neither or both of `--scope` and `--quarantine` → `refused: usage …`. `<owner>/<repo>` = the `design-skills-section` v1 repo pattern; `<sha>` = `^[0-9a-f]{40}$`; `<work folder>` = `isWorkFolder` of `work-folder-name` v1 (a new name or a legacy slug; v1.1 is additive). Skill names keep `^[a-z0-9][a-z0-9-]{0,63}$`; they are not work folder names.
Callers never put user text on a command line: the Playbook matches the CEO's argument by string equality against `list` output and passes the listed name (AC8).
- **Export for `skill-picks.mjs` (Fix rounds 1 and 2):** `vetCandidate({ source, commit, name, mode })` = `fetch <source> --ref <commit>`, then the bound folder of `<name>`, its `hash`, and `scan --quarantine <id> --skill <name>`, then `clean --quarantine <id>` in a `finally`, so a quarantine never outlives the call. Returns `{ commit, hash, result }` (`hash` = 64 lowercase hex, "Folder hash"; `result` = one `results[]` entry below) or `{ refused: <reason> }`, reason one of: `fetch failed`, `candidate too large`, `commit not in repo`, `candidate has a link or submodule`, `skill not in repo`, `skill not bound (root skill)`, `skill not bound (unreadable name)`, `skill not bound (same name twice)`, `skill not bound (name differs from folder)`, `git missing`, `skillspector missing`. Inputs are re-validated with the patterns above.

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
- Every text that describes `no-llm` uses this meaning: "static rules on this machine; no skill text leaves it; package names, versions and ecosystems from a skill's dependency files go to OSV.dev for a vulnerability lookup, plus the ids of any vulnerabilities found". The sentence in `aico-settings` v1.2 is the one source; others say the same. A shorter mention says "package names, versions and ecosystems", never "package names and versions" alone.
- The quarantine `fetch` talks only to `https://github.com/<owner>/<repo>.git` (git over HTTPS), and sends nothing but the git protocol requests.

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

## Report (`--report '<work folder>'`; AC9, the only file a scan writes)
`.company/work/<work folder>/skillspector-report.md`, built only from the output JSON and the fixed texts below; the folder is created when missing and refused when it, or the file, is a symlink (`lstat`); atomic write; LF. Lists, no tables, verdicts as words (proj.S2).
```markdown
# SkillSpector scan
- Date: <UTC>; tool: skillspector <version>[@<commit7>]; mode: <mode>; scope: <scope or one skill>
- Network: package names, versions and ecosystems from dependency files, plus the ids of any vulnerabilities found, go to OSV.dev[; skill text goes to Anthropic (claude_cli)]
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
- `mkdtemp(<os.tmpdir()>/aico-quarantine-)` with a 12-hex id. `<url>` = `https://github.com/<owner>/<repo>.git`, built only from the validated `<owner>/<repo>`. `<cfg>` = `-c core.symlinks=false -c core.hooksPath=<empty dir> -c credential.helper= -c protocol.allow=never -c protocol.https.allow=always -c transfer.fsckObjects=true`, given on **every** git call except the two `config --get` reads below.
- No `--ref`: `git <cfg> <eol> clone --depth 1 --single-branch --no-tags --no-recurse-submodules -- <url> <q>/repo`.
- With `--ref`, in this order (each argv pinned by a test):
  1. **Reachability (Fix round 2, security B3).** GitHub serves any commit of the fork network by sha, under any fork's name. So: `git <cfg> clone --bare --filter=tree:0 --no-recurse-submodules -- <url> <q>/refs.git` (commits of every branch and tag, no trees or blobs), then `git <cfg> -C <q>/refs.git for-each-ref --contains <sha> --count=1 --format=%(refname) refs/heads refs/tags`. Exit 0 with one non-empty line → reachable. Anything else (empty output, an unknown object, any non-zero exit) → `refused: commit not in repo`. `refs/pull/*` is never fetched, so a pull request commit does not count.
  2. `git <cfg> init <q>/repo`, then `git <cfg> -C <q>/repo fetch --depth 1 --no-tags --no-recurse-submodules -- <url> <sha>`, then `git <cfg> <eol> -C <q>/repo checkout --detach FETCH_HEAD`.
- `--` before the URL is **mandatory** (SP2). `protocol.allow=never` refuses `file://` and `ext::` (SP2).
- Env (added to the child env allow-list): `GIT_TERMINAL_PROMPT=0 GIT_LFS_SKIP_SMUDGE=1 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=<os.devNull>`. `spawn` with `shell: false`, 120 s for the whole fetch (every step above shares it), the same tree kill (inside the temp-dir callback, as above). `commit` = `git rev-parse HEAD`, must match `^[0-9a-f]{40}$` (and equal `<sha>` when given), else `refused: fetch failed`. `git` not found (ENOENT) → `refused: git missing`, exit 2.
- **Line endings, `<eol>` (Fix round 2).** The skills CLI checks out with the user's own git config, so `core.autocrlf=true` (the Git for Windows default) writes CRLF and changes the bytes and the hash. Before the checkout, `fetch` runs `git config --get core.autocrlf` and `git config --get core.eol` once each: env = the child allow-list **without** `GIT_CONFIG_NOSYSTEM` and `GIT_CONFIG_GLOBAL`, cwd = `<q>` (not a repo), 10 s, argv exactly as written. A trimmed value matching `^(true|false|input)$` (case-insensitive, lower-cased) becomes `-c core.autocrlf=<v>`, one matching `^(lf|crlf|native)$` becomes `-c core.eol=<v>`; any other value, an unset key or an error → not passed. `<eol>` is those zero to two flags, on the clone or checkout call only. Nothing else from the user's config is read.
- **No links or submodules (Fix round 2, security B2).** `core.symlinks=false` checks a committed link out as a plain file, so the walk cannot see it, while the skills CLI on POSIX creates the link and copies its target. After the checkout: `git <cfg> -C <q>/repo ls-tree -r -z --full-tree HEAD` (stdout cap 4 MiB). Each NUL-separated record must parse as `<mode> <type> <oid>\t<path>`; any entry with mode `120000` (link) or `160000` (submodule) → `refused: candidate has a link or submodule`. A record that does not parse, a non-zero exit or oversize → `refused: fetch failed`.
- Bounds: ≤ 50 MiB and ≤ 5000 files after clone, `.git` excluded (`<q>/refs.git` is outside the walked `repo`). **The walk never stops early (Fix round 1):** a symlink, junction or other non-regular entry is counted and not followed; a dir that cannot be read, or any such entry at all, → the quarantine is removed and `refused: candidate too large`.
- **Ownership (POSIX, Fix round 1):** `openQuarantine` and `cleanQuarantine` act only on a folder whose `lstat` is a real dir with `uid === process.getuid()`; the 24 h sweep skips any other. Windows has no `getuid`; the check is skipped there.
- Skills listed by `fetch` = folders up to depth 4 holding a regular `SKILL.md` whose folder name passes the allow-list. Nothing in a quarantine is ever executed, imported or installed (AC4).

### Bound skill folder (Fix round 2, review B1 and security B1)
The skills CLI 1.7.4 does not pick by folder name. `add <owner>/<repo>#<sha> -s <n>` clones that commit (`cloneAtSha`, cli.mjs:753). If the repo root holds a `SKILL.md`, it takes only that one (`discoverSkills`, :1330-1339). Otherwise it searches the priority dirs, then any depth, and keeps each skill whose frontmatter `name`, lower-cased, equals `<n>` lower-cased (`filterSkills`, :1389). It installs that folder under its frontmatter name and writes the folder's hash to `skills-lock.json` `skills.<name>.computedHash` (`computeSkillFolderHash`, :1137; `projectLockEntry`, :5178). So `vetCandidate` and `scan --quarantine <id> --skill <n>` scan a folder only when it is the one folder the CLI can pick:
- Walk the whole `repo` tree (`.git` excluded, inside the bounds above). For each regular file whose name, lower-cased, is `skill.md`, read its name (below). Then, the first rule that matches wins:
  1. such a file directly in the repo root → `refused: skill not bound (root skill)`;
  2. any such file whose name cannot be read → `refused: skill not bound (unreadable name)`;
  3. S = the files whose name, lower-cased, equals `<n>`. S empty → `refused: skill not in repo`; two or more → `refused: skill not bound (same name twice)`;
  4. the one file is not exactly `<dir>/SKILL.md` at depth 1–4, with `basename(<dir>) === <n>` and its name `=== <n>` → `refused: skill not bound (name differs from folder)`.
  Otherwise `<dir>` is the bound folder; it is the scanned path. A folder named `<n>` whose own `SKILL.md` declares another name never counts.
- **Name reader** (Node built-ins only, proj.S1). It mirrors `parseFrontmatter` (cli.mjs:1017) and the `.trim()` in `sanitizeMetadata` (cli.mjs:350). Where it cannot match them exactly, it fails closed: the file is unreadable, and rule 2 above refuses the candidate.
  - File over 1 MiB → unreadable. Decode as UTF-8. Apply the CLI's regex exactly: `/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/`. No match → the file declares no name.
  - Split group 1 on `\n` and drop one trailing `\r` per line. Each line, the first rule that matches wins:
    1. **Blank** = empty or only U+0020 spaces (`/^ *$/`) → skipped. A line that holds any other whitespace (tab, U+00A0, U+3000, U+FEFF, U+2028, VT, FF) is not blank; it goes on to the rules below and ends as unreadable.
    2. Starts with `#` → skipped (comment).
    3. Starts with a tab → unreadable.
    4. Starts with a space:
       - before the first key line → unreadable (YAML reads an indented block as top-level keys, so ` name: foo` declares `foo`);
       - after the `name` line and before the next key line, even with blank or comment lines in between → unreadable (YAML folds `name: foo`, a blank line and `  bar` into `foo bar`);
       - anywhere else → a continuation of the previous key, skipped.
    5. Matches `^[A-Za-z0-9_-]+ *:( |$)` → a key line. Any other line (`{`, `[`, `?`, `<<`, `&`, `*`, `!`, `%`, a quoted key, `---`, `...`) → unreadable.
  - Lines with the key exactly `name`: none → no name; two or more → unreadable.
  - Value = the text after the first `:`, with U+0020 spaces trimmed at both ends and nothing else trimmed. Empty → no name. Then one of:
    - Quoted: `'…'` with no `'` inside, or `"…"` with no `"` and no `\` inside, each optionally followed by spaces and a `#` comment → the inner text, as is. A quoted value with `'` (single) or `"` or `\` (double) inside is not this form. It falls to plain, which forbids a leading quote, so it is unreadable.
    - Plain: the first character must not be one of `` ' " & * ! | > % @ ` { } [ ] , ? : - # ``. The text is cut at the first ` #` and U+0020-trimmed. It must not contain `: ` or a tab, and must not end in `:` (the CLI's YAML fails on `name: foo:`; this also covers `name: foo: ` once trimmed). Anything else → unreadable.
  - **Name allow-list (proj.M1).** The value must match `^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$`: printable ASCII, with no whitespace at either end. Anything else → unreadable. That covers a name padded with U+00A0, U+3000, U+2003, U+2028 or U+FEFF (the CLI's `.trim()` turns these into `foo`), a quoted `'foo '` or `" foo"`, and any control or non-ASCII character. So a repo with a non-ASCII skill name anywhere is refused as a whole. This is accepted as fail-closed. The name is compared with JavaScript `toLowerCase()`, as the CLI does.
  - Each unreadable form has an `attack:` test with a hostile `SKILL.md` that would win in the CLI's walk order, placed beside a real `skills/<n>/SKILL.md`, and the test expects `refused: skill not bound (unreadable name)`.
- **Folder hash.** `hash` = the CLI's `computeSkillFolderHash` over the bound folder, re-implemented exactly: `readdir` with `withFileTypes`; recurse into directories except ones named `.git` or `node_modules`; take every entry whose `isFile()` is true; `relativePath` = `path.relative(folder, file)` with `\` replaced by `/`; sort by `a.relativePath.localeCompare(b.relativePath)` (no locale argument); one SHA-256, `update(relativePath)` then `update(<file bytes>)` per file; lowercase hex. A golden test pins the value for a fixture folder against the `computedHash` that skills@1.7.4 wrote for the same files (recorded once into `tests/fixtures/skillspector/`).
- Bytes the CLI writes and aico did not mirror (a filter driver in the user's git config, another git version) give a different hash; that stops the run after install, never passes it (`skill-recommendation` v1, The Lead's side 5).

## Install (AC10; the Lead runs these after the CEO picks Install, never a Role)
- Install, byte-identical, in this order: `uv tool install 'skillspector[mcp] @ git+https://github.com/NVIDIA/skillspector.git@v2.13.1'` then `claude mcp add --scope user skillspector -- skillspector mcp`.
- Rollback: `uv tool uninstall skillspector`, `claude mcp remove --scope user skillspector`.
- The form says both change user-scope config, gives the rollback, and names the pinned release v2.13.1 (CEO, Plan Gate P2). One constant in `skillspector.mjs`; a test pins the Playbook text, this Contract and the constant byte for byte. Recorded outputs from v2.12.0 stay valid test data (CEO waiver, Fix round 1).
- Always asked, whatever `gates.installs` says. `detect` says `uv: false` → say so and run nothing; aico never installs `uv`. After install, `detect` again; still missing → say so, no retry.
- **MCP:** aico never calls the SkillSpector MCP tool; the registration is for the CEO's own use. Any aico text that shows `scan_skill` passes `use_llm: false` explicitly; no agent lists an `mcp__skillspector` tool (pinned tests).

## Error cases
- Bad arguments, a name that fails the allow-list, a name not in scope, a bad id, work folder name or repo → `refused: <reason>` (input never echoed), exit 2, nothing scanned or written.
- Tool missing → `scan` and `fetch` print `refused: skillspector missing`, exit 3, no report written; callers then offer the Install form (AC3, AC10). Both run the `detect` probe first, so a run never stops halfway. An ENOENT on a later per-skill spawn is that skill's `spawn-failed`.
- A commit not reachable from the named repo's branches or tags, a link or submodule entry, or a skill that is not bound → `refused: <reason>` from the list under "Export", exit 2, the quarantine removed, nothing scanned.
- A per-skill failure, including a failed temp-dir removal, is that skill's `error` verdict or nothing; the run goes on with the next skill and still exits 0.
- Internal failure → `error: internal` on stderr, exit 1, no report written.
