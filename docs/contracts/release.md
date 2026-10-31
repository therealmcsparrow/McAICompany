# Contract: release v1.2

Provider: `scripts/release.mjs` (the one command), `scripts/sbom.mjs` and `scripts/gate-report.mjs` (Node built-ins only). Consumers: the CEO and CI reading `releases/<x.y.z>/`, and `scripts/stable.mjs` through the rollback line. Sources read: `token-ledger` v1.6 files (`.company/ledger/<run>.jsonl`), `run-state` v1.5 `show`.
Rationale: every release carries a bill of materials, a one-line way back and a record of how its Gates went, all made from recorded data. Rules: `.company/standards/cyclonedx@1.md` (cdx.M1 to M7, S1 to S5, M-SEC1, M-SEC2), `.company/standards/git@2.md` (git.M1, git.M4). The deviation from gha.S5 (an SBOM built in CI): it is built here, in `release.mjs`, so the file is in the release commit; CI can run `node scripts/sbom.mjs <file>` to build the same file.

## Files of a release
`release.mjs <x.y.z>` writes, then commits with the version bump (one commit, one annotated local tag, nothing sent to a remote):
- `releases/<x.y.z>/sbom.cdx.json`
- `releases/<x.y.z>/gate-report.md`

Both are built from the bumped files, in memory, before the checks run. If either cannot be built, or `releases/<x.y.z>` already exists, the release stops: every bumped file is restored, no commit, no tag, nothing written under `releases/`. Files are LF only.

## SBOM (`sbom.cdx.json`)
CycloneDX 1.6, JSON. Inputs, each a plain file (not a link) of at most 8 MiB: `.claude-plugin/plugin.json`, `deps/skills.json`, `tools/claude-cli/package-lock.json` (`lockfileVersion` 3, at most 5000 packages). A missing, unreadable or malformed input stops the build; a partial SBOM is never written.
- Top level: `bomFormat`, `specVersion: "1.6"`, `serialNumber` (`urn:uuid:` and a random lowercase v4 uuid from `crypto.randomUUID`), `version: 1`, `metadata`, `components`, `dependencies`, `compositions`. No `vulnerabilities` key.
- `metadata`: `timestamp` (UTC), `tools` in the object form (`{components: [...]}`), and `component`, the plugin itself: `type: application`, name `aico`, the version of `plugin.json`, `bom-ref` and `purl` `pkg:generic/aico@<version>`. The creator is a project URL (`externalReferences` type `website`) taken from `plugin.json` `homepage` or `repository`, only when it is an https URL without credentials; never an email address.
- `components`: one per distinct skill of `deps/skills.json` (`include` entries skipped; the same `name` and `source` in two groups is one component with the groups in property `aico:groups`; `bom-ref` `skill:<name>@<source or local>`; `group` and `purl` `pkg:github/<source>` when a `source` is given; the `install` command is not copied) and one per distinct package of the lockfile (`bom-ref` = `purl` = `pkg:npm/<name>@<exact version>`, the scope's `@` written `%40`).
- Hashes: only from the lockfile `integrity`. Each space-separated SRI value that decodes to the right length becomes one entry: `sha512-` as `SHA-512` (128 lowercase hex), `sha1-` as `SHA-1` (40 hex). Other algorithms, odd values and a missing `integrity` give no hash.
- Licences: `[{license: {id}}]` for a valid SPDX id from a fixed list, a single `[{expression}]` for an SPDX expression of those ids, otherwise `[{license: {name}}]`; a value over 200 characters or with control characters is left out.
- Build-only packages (`dev: true`) are kept with property `aico:dev` = `true`.
- `externalReferences` `distribution` only for an https `resolved` URL without credentials; any other `resolved` value (userinfo, `git+ssh`, `file:`, a local path) is dropped.
- `dependencies`: the plugin depends on every skill and every direct lockfile dependency; each lockfile package depends on the packages its `dependencies` and `optionalDependencies` resolve to, found the way node resolves (nearest `node_modules` up the path). Every `ref` and `dependsOn` item is a `bom-ref` of the BOM.
- `compositions`: lockfile packages are `complete` when every required dependency resolved, else `incomplete`; skills are `unknown` (their own dependencies are not listed).
- Nothing in the file, the Gate Report or the release text claims conformance to BSI TR-03183-2.

## Rollback line
The new `## [x.y.z] - <date>` section of `CHANGELOG.md` starts with `Rollback: node scripts/stable.mjs <previous>`, where `<previous>` is the plain-semver version of the next `## [..]` heading below. The first release has no line. Running it moves `stable` to the commit of the annotated tag `v<previous>` (the rules and limits of `scripts/stable.mjs` apply); this contract does not change them.

## Gate Report (`gate-report.md`, `node scripts/gate-report.mjs <x.y.z>`)
Title `# Gate Report v<x.y.z>`, the two eval lines below, then one section per run of that version: a run is a ledger file `.company/ledger/<run>.jsonl` whose `<run>` passes `isWorkFolder` (`work-folder-name` v1: a work folder name or a legacy slug; any other file name is skipped) (run names `brainstorm-`, `replay-` and `baseline-` excluded) whose last `meta` record has `aico` equal to the version. Per run, only recorded values:
- Gates: each `gate` entry of `run-state` with result and wait.
- CEO forms: each `ceo` entry (Gate and form count).
- Fix rounds: `fix_rounds` of the last `ship` record.
- Run time: `t_start` to `t_ship` of that record.
- Step time by Role: the sum of `sub` start-to-stop times per Role id.
A value that is missing reads `not recorded`; so does the whole report when no run of the version is on this machine (`.company/` is local). Role ids only: no display names, no free text, no paths. A ledger file that is a link, over 1 MiB or has a bad name is skipped; a damaged line is skipped.

### Eval lines
Directly after the intro text, before the runs (also when no run of the version is on this machine):
- `plan review eval: <k> of <n> (<date>)`, from the last line of `eval.jsonl` in the folder tests/plan-review whose `aico` equals the version, else `plan review eval: not recorded`.
- `code review eval: <k> of <n> (<date>)`, from the last line of `eval.jsonl` in the folder tests/code-review whose `aico` equals the version, else `code review eval: not recorded`. It sits directly after the plan review line.

Only these two fixed files are read, each a plain file (no link in the path) of at most 256 KiB, line by line; a line over 1024 characters is skipped. A line counts after `JSON.parse` and a check by type: `v` 1, `aico` the version, `caught` and `total` non-negative integers with `caught` at most `total`, `at` a UTC time (`YYYY-MM-DDTHH:MM:SSZ`). Nothing is merged into another object. The line holds only the two numbers and the date part of `at`, never raw file text. A missing file, a link, an oversize file, an unreadable file, or a last matching line that is malformed reads `not recorded`; the eval lines never fail or block the report or the release. The Lead produces the records (`plan-review` v1 `score --record`, `--kind plan|code`); targets 4 of 5 (plan) and 2 of 2 (code) are for the Lead and the Ship Gate, not enforced here.

## Compatibility
v1.1 (additive: the two eval lines). v1.2 (additive: run names are work folder names or legacy slugs; every v1.1 report is unchanged). v1. A new file under `releases/<x.y.z>/`, another source for the report or a changed rollback line is a minor bump; a different SBOM format version or a removed file is a major bump.
