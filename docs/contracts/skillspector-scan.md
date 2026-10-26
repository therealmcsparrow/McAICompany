# Contract: skillspector-scan v1

Provider: `scripts/skillspector.mjs` (Node built-ins only, proj.S1). Consumers: the `/aico:skillspector` Playbook (`skills/skillspector/SKILL.md`), the `skill-researcher` Role (`skill-recommendation` v1), the Lead's post-install scan (`skills/lead/references/skill-picks.md`).
The third-party tool is NVIDIA SkillSpector (Apache-2.0), run as its CLI only. Rationale: `docs/adr/0018-skillspector-through-a-tested-wrapper.md`. Facts about the tool: `.company/work/skill-researcher-scan/02-tech-researcher.md` (checked 2026-10-26, v2.12.0 main `d7338f5`), confirmed live by spikes SP1 (`06-spike-backend-engineer.md`) and SP2 (`04-spike-backend-engineer.md`) on Windows 11. Still v1 and unreleased; the spike results are folded in additively.
Everything the tool prints is untrusted (AC13): only the fields named under "Shape guard" are read, and no free text from it (`finding`, `explanation`, `remediation`, `code_snippet`, `pattern`, `evidence`, `skill.name`) ever reaches stdout, a report, a Handoff or a shell.

## Names and roots
- Skill name allow-list: `^[a-z0-9][a-z0-9-]{0,63}$` (ASCII only, so a Unicode lookalike, `..`, `/`, `\`, `:`, a drive letter, `;`, a backtick, `$(`, `|`, a space and a name over 64 characters all fail). A name that fails is refused before any file access, and is never echoed.
- Roots per scope (each passed through `fs.realpathSync` once; a root that does not exist is skipped):
  - `project`: `<cwd>/.claude/skills`, `<cwd>/.agents/skills`
  - `global`: `<home>/.claude/skills`, `<home>/.agents/skills` (`<home>` = `os.homedir()`; tests point `HOME`/`USERPROFILE` at a temp dir, proj.M8)
  - `quarantine`: `<os.tmpdir()>/aico-quarantine-<id>/repo`, `<id>` = `^[0-9a-f]{12}$`
  Plugin-cache skills are never in scope.
- Resolution of a skill `<n>` in a scope: for each root, `<root>/<n>` → `realpathSync`. The real path must lie strictly inside one of the realpath'd roots of **any** scope above (`path.relative` neither empty, nor absolute, nor starting with `..`). So a project link `.claude/skills/<n>` → `.agents/skills/<n>` is scanned, and a link or junction whose target leaves every root is `outside-roots`. Two entries with the same real path are scanned once.
- The **resolved real path** is what the tool receives (it refuses symlinked inputs with exit 2).

## CLI (cwd = product repo; refusals `refused: <reason>` on stdout, exit 2; every success exits 0, also with findings)
| Command | Effect |
|---|---|
| `detect --json` | `{ "v":1, "installed":bool, "version":str\|null, "commit":str\|null, "uv":bool }`. Runs `skillspector --version` and `uv --version` (10 s each). `installed: false` when the spawn emits `error` with `code: 'ENOENT'` (see "Child process"). `commit` from the tool's `direct_url.json` under `uv tool dir` when found, else `null`. Always exit 0. |
| `install-commands --json` | `{ "v":1, "install":[…], "rollback":[…] }`, the constants below |
| `list --scope project\|global\|all --json` | `{ "v":1, "skills":[{ "name", "scope" }], "skipped_invalid":n }`; at most 200 skills per run. Only names that pass the allow-list are printed, so every printed name is shell-safe. |
| `scan --scope project\|global\|all [--skill <n>] [--mode no-llm\|claude_cli] [--report <slug>] --json` | scans every skill in scope, or only `<n>` (must be in the `list` output for that scope, else `refused: skill not found`) |
| `fetch <owner>/<repo> [--ref <sha>] --json` | new quarantine, see "Quarantine"; `{ "v":1, "id", "commit", "skills":[names], "skipped_invalid":n }` |
| `scan --quarantine <id> [--skill <n>] [--mode …] --json` | scans skills inside that quarantine |
| `clean --quarantine <id>` | removes it; `fetch` also removes `aico-quarantine-*` folders older than 24 h |

Arguments are a fixed grammar: an unknown or repeated flag, an extra positional, or `scan` with neither or both of `--scope` and `--quarantine` → `refused: usage …`. `<owner>/<repo>` = the `design-skills-section` v1 repo pattern; `<sha>` = `^[0-9a-f]{40}$`; `<slug>` = `^[a-z0-9][a-z0-9-]{0,63}$`.
Callers never put user text on a command line: the Playbook matches the CEO's argument by string equality against `list` output and passes the listed name (AC8).

## Mode
- `--mode` given → that value. Absent → `node settings.mjs get skillspector.mode` (`aico-settings` v1.2, 5 s); any failure → `no-llm`.
- `no-llm` → the tool gets `--no-llm`. `claude_cli` → no `--no-llm`, and the child env sets `SKILLSPECTOR_PROVIDER=claude_cli`. There is no provider flag; the env var is the only selector.
- Effective mode per skill: `no-llm`; `claude_cli` only when `metadata.llm_requested`, `metadata.llm_available` are `true` and `metadata.llm_provenance.provider.effective_adapter` is `claude_cli`; otherwise `static-fallback` (shown as "static fallback, not an LLM scan"). In `no-llm` a `metadata.llm_requested: true` is `error` `mode-mismatch`.
- `claude` unavailable (SP1): v2.12.0 does not fall back to a clean static result. It exits **2** with parsable JSON, `execution_successful: false`, `is_complete: false`, `effective_adapter: "unknown"`, so the skill is `error` `not-successful` (rule 2 below). `static-fallback` stays for a run that succeeds with `llm_available: false`; it was not reproduced, and every other rule still applies to it.
- No API key is asked for, read or passed (AC11, proj.M-SEC2). The `claude` login works under the env allow-list below (SP1; `CLAUDE_CONFIG_DIR` pass-through untested). The `skill-researcher` never passes `--mode` (pinned test); only the CEO's Playbook flag does.

## Child process
- argv is exactly `[skillspector, "scan", <real path>, "--format", "json", "--no-llm"]` in `no-llm` and the same without `"--no-llm"` in `claude_cli`. A test pins both arrays as exact values. Never `-r`, `-o`/`--output` (exit 2 on Windows), `--fail-on-*`, `--baseline`, `--use-shipped-baseline`, `--yara-rules-dir`, a Git URL or a path that was not resolved above. One skill per call (the tool's recursive mode stops at 32 and skips symlinked children with exit 0).
- **Baselines (SP2):** the only file the tool reads from a scanned folder is a top-level `<skill>/.skillspector-baseline.yaml`, and only `--use-shipped-baseline` applies it. Applied, an author's file turns 2 HIGH into SAFE with `suppressed_count: 2`. Because the wrapper never passes either baseline flag, such a file stays inert; `suppressed_count !== 0` is still `error` as a second line of defence. The tool reads no config, baseline or `.env` file from the cwd.
- `spawn` with `shell: false`, `windowsHide: true`, stdin ignored, cwd = a fresh empty `mkdtemp` dir (removed after), so no config is read from the repo. On Windows, `spawn('skillspector', …)` finds the uv shim `skillspector.exe` through `PATH` without a shell (SP2). A `.cmd` or `.bat` shim cannot run with `shell: false`; it surfaces as `spawn-failed`, never as a reason to turn on a shell.
- **Not installed** = the child emits `error` with `code: 'ENOENT'` (Windows close code `-4058`). Any other `error` event is that skill's `spawn-failed`.
- Env is an allow-list, nothing else is passed: `PATH PATHEXT SYSTEMROOT SystemDrive WINDIR COMSPEC TEMP TMP TMPDIR HOME USERPROFILE APPDATA LOCALAPPDATA XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME LANG LC_ALL`, plus `PYTHONIOENCODING=utf-8`; in `claude_cli` also `CLAUDE_CONFIG_DIR` (when set) and `SKILLSPECTOR_PROVIDER=claude_cli`. Every other `SKILLSPECTOR_*`, `*_API_KEY`, `ANTHROPIC_*`, `NVIDIA_*`, `OPENAI_*` is dropped.
- Outer wall clock: 180 s (`no-llm`), 900 s (`claude_cli`; the tool's own budget is 600 s + 60 s ingest; SP1 measured 4.4 s static and 8.9 s `claude_cli` for one small skill). Stdout cap 8 MiB; stderr is drained and dropped.
- On timeout or oversize the whole process tree is killed, by PID only, never by image name (other sessions may run their own `skillspector` MCP servers):
  - Windows: `execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true })`. A plain `child.kill()` is not enough: it left no orphan in SP2, but that relied on the uv shim, not on a guarantee, and a `claude` grandchild is not covered.
  - POSIX: spawn with `detached: true`, then `process.kill(-pid, 'SIGKILL')` for the process group (unverified live; T4 covers it on CI).

## Classification (per skill; the first rule that matches wins)
1. Pre-checks, no spawn: `not-found`; `outside-roots`; `no-skill-md` (no `SKILL.md`, or it is not a regular file by `lstat`); `symlink-inside` (any symlink or junction anywhere in the skill dir); `too-large` (walk over 5000 entries or depth 10).
2. In this order:
   - `spawn-failed`, `timeout`, `oversize`.
   - **Exit 2:** stdout parses as a JSON object and `execution_successful === false` → `not-successful`; else `analysis_completeness.is_complete === false` → `incomplete`; else `exit-2`. Only these two booleans are read here (`Object.hasOwn`), so a partial shape cannot hide the reason. This is the SP1 "`claude` unavailable" case.
   - `exit-<n>` (any exit other than 0, 1 or 2).
   - Exit 0 or 1: `unparsable` (empty or invalid JSON), `shape` (guard fails, incl. an unknown severity), `not-successful` (`execution_successful !== true`), `no-components` (`components.length < 1`: a dir without a skill scans as SAFE, exit 0), `incomplete` (`analysis_completeness.is_complete !== true`), `suppressed` (`suppressed_count !== 0`), `mode-mismatch`.
   Any of 1–2 → verdict **`error`**, never `pass` (AC13).
3. Otherwise counts `critical high medium low` from `issues[].severity` (never from the exit code: a HIGH issue can exit 0, SP2 golden `hostile-c`). `blocking` = `critical + high > 0`, or `max_issue_severity` HIGH/CRITICAL, or exit 1, or `recommendation` `DO_NOT_INSTALL`. Verdict **`pass`** = no issue, exit 0, not blocking; else **`findings`**.
   `risk_assessment.severity` is the score band (CRITICAL at score 100 even when the worst issue is HIGH, SP2 golden `hostile-a`) and is never read.

## Shape guard (the only fields read)
`risk_assessment.{score: int 0–100, recommendation: SAFE|CAUTION|DO_NOT_INSTALL, max_issue_severity: NONE|LOW|MEDIUM|HIGH|CRITICAL}`, `components: array`, `issues: array ≤ 10000` of `{ id, category, severity: LOW|MEDIUM|HIGH|CRITICAL, location.file, location.start_line }`, `suppressed_count: int`, `metadata.{skillspector_version, llm_requested: bool, llm_available: bool, llm_provenance.provider.effective_adapter}`, `execution_successful: bool`, `analysis_completeness.is_complete: bool`. Missing or wrong-typed → `shape`. A schema test pins this list against recorded real outputs (SP1 `claude_cli.raw.json`, SP2 `spike/golden/*.json`), so tool drift fails closed.
- Unknown keys are ignored and never required: `risk_assessment.severity`, and the `metadata` keys that appear only sometimes (`llm_degraded`, `llm_error`, `llm_calls_attempted`, `llm_calls_succeeded`, SP1). A test feeds outputs with and without them.

## Output (`--json`)
```json
{ "v": 1, "tool": { "version": "2.12.0", "commit": "d7338f5…" }, "mode": "no-llm",
  "results": [{ "name": "settings", "scope": "project", "verdict": "findings", "blocking": false,
    "reason": null, "effective_mode": "no-llm", "shipped_baseline": false, "score": 12, "recommendation": "CAUTION",
    "counts": { "critical": 0, "high": 0, "medium": 1, "low": 0 },
    "issues": [{ "id": "…", "category": "…", "severity": "MEDIUM", "file": "SKILL.md", "line": 4 }] }],
  "skipped_invalid": 0, "summary": { "pass": 0, "findings": 1, "error": 0 } }
```
- `name` and `scope` are aico's own (the dir name that passed the allow-list), never the tool's `skill.name`. `reason` is one code from "Classification" or `null`.
- `shipped_baseline`: `true` when `lstat(<real path>/.skillspector-baseline.yaml)` is a regular file. aico's own check, never parsed from the tool's stderr. A warning only: the verdict is unchanged, because the file is never applied. (A symlinked one is already `symlink-inside`.)
- `issues`: at most 50 per skill; `id` `^[A-Za-z0-9._:-]{1,64}$`, `category` `^[A-Za-z0-9_-]{1,40}$`, `file` `^[A-Za-z0-9._/ -]{1,200}$`, `line` int ≥ 0; a value that fails becomes `?`.
- `version` `^\d+\.\d+\.\d+([.+-][0-9A-Za-z.]{1,20})?$` else `?`. A git-main install reports an older version than its code (2.12.0 for post-2.13.1 code), so `commit` is recorded when known.

## Report (`--report <slug>`; AC9, the only file a scan writes)
`.company/work/<slug>/skillspector-report.md`, built only from the output JSON; the folder is created when missing and refused when it, or the file, is a symlink (`lstat`); atomic write; LF. Lists, no tables, verdicts as words (proj.S2).
```markdown
# SkillSpector scan
- Date: <UTC>; tool: skillspector <version>[@<commit7>]; mode: <mode>; scope: <scope or one skill>
## Summary
- pass <n>, findings <n>, error <n>
## Skills
- <name> (<scope>): <verdict> — critical <c>, high <h>, medium <m>, low <l> — mode <effective_mode>[ — blocking][ — reason <code>][ — ships a baseline file (not applied)]
## Not scanned
- <n> entries with an invalid name were skipped (names not shown).
```
GDPR Art. 5(1)(c): names, verdicts, counts and issue ids only, never skill text.

## Quarantine (`fetch`, for candidates)
- `mkdtemp(<os.tmpdir()>/aico-quarantine-)` with a 12-hex id. `<url>` = `https://github.com/<owner>/<repo>.git`, built only from the validated `<owner>/<repo>`. `<cfg>` = `-c core.symlinks=false -c core.hooksPath=<empty dir> -c credential.helper= -c protocol.allow=never -c protocol.https.allow=always -c transfer.fsckObjects=true`, given on **every** git call.
- No `--ref`: `git <cfg> clone --depth 1 --single-branch --no-tags --no-recurse-submodules -- <url> <q>/repo`.
- With `--ref`: `git <cfg> init <q>/repo`, then `git <cfg> -C <q>/repo fetch --depth 1 --no-tags --no-recurse-submodules -- <url> <sha>`, then `git <cfg> -C <q>/repo checkout --detach FETCH_HEAD`.
- `--` before the URL is **mandatory**: without it a `--upload-pack=…` value parses as an option (SP2). `protocol.allow=never` refuses `file://` and `ext::` (SP2).
- Env (added to the child env allow-list): `GIT_TERMINAL_PROMPT=0 GIT_LFS_SKIP_SMUDGE=1 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=<os.devNull>` (`NUL` on Windows, `/dev/null` on POSIX). `spawn` with `shell: false`, 120 s for the whole fetch, the same tree kill. `commit` = `git rev-parse HEAD`, must match `^[0-9a-f]{40}$` (and equal `<sha>` when given), else `refused: fetch failed`. `git` not found (ENOENT) → `refused: git missing`, exit 2.
- SP2 proved submodules and repo hooks are not fetched. `core.symlinks=false` is proven only on Windows (where it is the default), so the `symlink-inside` pre-check stays mandatory. Only a local fixture was cloned; a live HTTPS clone is covered by the T4 e2e case and the hands-on-tester.
- Bounds: ≤ 50 MiB and ≤ 5000 files after clone, else the quarantine is removed and `refused: candidate too large`.
- Skills = folders up to depth 4 holding a regular `SKILL.md` whose folder name passes the allow-list. Nothing in a quarantine is ever executed, imported or installed (AC4).

## Install (AC10; the Lead runs these after the CEO picks Install, never a Role)
- Install, byte-identical, in this order: `uv tool install 'skillspector[mcp] @ git+https://github.com/NVIDIA/skillspector.git'` then `claude mcp add --scope user skillspector -- skillspector mcp`.
- Rollback: `uv tool uninstall skillspector`, `claude mcp remove --scope user skillspector`.
- The form says both change user-scope config, gives the rollback, and names the supply-chain risk of an unpinned git main (CRA). Proposed pin (Plan Gate P2, not the default): `…skillspector.git@v2.13.1'`. One constant in `skillspector.mjs`; a test pins the Playbook text, this Contract and the constant byte for byte. If P2 is approved, the recorded golden outputs are re-recorded on the pinned version before T4 is done.
- Always asked, whatever `gates.installs` says (it changes user-scope Claude config). `detect` says `uv: false` → say so and run nothing; aico never installs `uv`. After install, `detect` again; still missing (often the uv bin dir is not on `PATH` yet) → say so, no retry.
- **MCP:** aico never calls the SkillSpector MCP tool; the registration is for the CEO's own use. Any aico text that shows `scan_skill` passes `use_llm: false` explicitly (its default is `true`); no agent lists an `mcp__skillspector` tool (pinned tests).

## Error cases
- Bad arguments, a name that fails the allow-list, a name not in scope, a bad id, slug or repo → `refused: <reason>` (input never echoed), exit 2, nothing scanned or written.
- Tool missing → `scan` and `fetch` print `refused: skillspector missing`, exit 3, no report written; callers then offer the Install form (AC3, AC10). Both run the `detect` probe (`skillspector --version`, 10 s) first, and ENOENT there is "missing", so a run never stops halfway. An ENOENT on a later per-skill spawn is that skill's `spawn-failed`.
- A per-skill failure is that skill's `error` verdict; the run goes on with the next skill and still exits 0.
- Internal failure → `error: internal` on stderr, exit 1, no report written.
