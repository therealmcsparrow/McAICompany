# Contract: test-run v1

Provider: `scripts/test-run.mjs` (Node built-ins only). Consumers: the `test` script in `package.json` (the one place the test patterns live), `.github/workflows/ci.yml`, QA.
Rationale: Windows CI splits `npm test` over parallel jobs. A hanging test file must fail by name instead of running into the job timeout, and a split run must prove that every test file ran exactly once. The split is node's own `--test-shard` (by file count, not duration): one file, `scripts/worktree.test.mjs`, takes about 95% of the slowest shard, so no file-level split can beat it by much.

## Command
`node scripts/test-run.mjs <arg>...`, normally through `npm test [-- <flag>...]`.
- An argument that starts with `-` is a flag; any other is a pattern (a literal path or `<dir>/*<suffix>`, as before v1). Flags and patterns may come in any order.
- node is started as `node --test <reporters> [--test-timeout=1200000] <flags> <patterns>`: flags in their given order, always before the patterns. Every flag except `--aico-cover=<dir>` reaches `node --test` unchanged. Node rejects a bad flag; the run then exits non-zero.
- `--test-shard=<i>/<n>` runs node's shard `i` of `n`. Without it the full suite runs, as before v1.
- **Per-file timeout.** With no `--test-timeout=` flag, test-run adds `--test-timeout=1200000` (20 minutes). A test file that has not finished by then fails, its repo-relative path is in the output, and the run exits non-zero. A given `--test-timeout=<ms>` replaces the default (tests use a short one). The timeout must also fail a file whose top-level code or open handle never lets it end, not only a slow test.
- **Progress total.** `AICO_TEST_TOTAL` is computed from the patterns as before v1. With a `--test-shard=` flag, the total is unknown (`?`).
- **Exit code.** node's exit status; 1 when node cannot start or is killed by a signal.

## File list (`AICO_TEST_FILES_OUT`)
- When the environment variable `AICO_TEST_FILES_OUT` holds a path, the reporter writes that file when the run ends: one line per test file that completed (passed or failed), as a path relative to the working directory with `/` separators, sorted, UTF-8, LF line ends, a final LF. The parent folder is created if missing.
- A file counts as completed on its file-level `test:complete` event (nesting 0), the same event that drives the progress line.
- Unset or empty: nothing is written. A run killed before it ends writes nothing, so cover mode reports its files as missing.

## Cover mode (`--aico-cover=<dir>`)
- Runs no tests. Lists the files the patterns select (same rule as the progress count, sorted) and reads every plain `*.txt` file directly inside `<dir>` (non-recursive; each file at most 1 MiB) as a file list.
- Prints one line per finding, sorted: `missing <file>` (selected, in no list), `twice <file> <k>` (in the lists `k` > 1 times in total), `unknown <file>` (listed, not selected).
- No findings and at least one list: prints `cover: <n> files, <m> lists, ok` and exits 0.
- Any finding, no list, a missing or unreadable `<dir>`, a list over 1 MiB or a pattern whose files cannot be listed: prints the findings or one line `cover: error <reason>` and exits 1. A reason never repeats list content.

## CI jobs (`.github/workflows/ci.yml`)
- `check`, matrix `os: [ubuntu-latest, macos-latest]`: `npm test`, then `npm run check`, as before v1.
- `windows-test`, matrix `shard: [1, 2, 3, 4]`, `fail-fast: false`, `runs-on: windows-latest`, same checkout into a path with a space. Env `AICO_TEST_SHARD` is `<shard>/4` and `AICO_TEST_FILES_OUT` is `<runner temp>/shard-files/shard-<shard>.txt`, both set in `env:` blocks, never as `${{ }}` on a `run:` line. Runs `npm test -- "--test-shard=$AICO_TEST_SHARD"`. Shard 1 also runs `npm run check`; no other Windows job runs it. Uploads its list as artifact `shard-files-<shard>`, even when tests fail.
- `windows-check`, `name: check (windows-latest)`, `needs: windows-test`, `if: always()`, `runs-on: ubuntu-latest`. Downloads `shard-files-*` into one folder (`merge-multiple: true`), runs `npm test -- "--aico-cover=<that folder>"`, and fails when `needs.windows-test.result` (passed through `env:`) is not `success`.
- Required-check names stay `check (ubuntu-latest)`, `check (windows-latest)` and `check (macos-latest)`. `check (windows-latest)` is red when any shard fails, is cancelled or is skipped, or when cover mode finds a gap.
- New actions are pinned to a full commit with a `# vX.Y.Z` comment, like every other `uses:` line.

## Compatibility
v1. A new flag or a new CI job is a minor bump. These are major bumps: a changed default timeout, a changed file-list or cover output format, a changed cover exit code, or a renamed required check.
