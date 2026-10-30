# Contract: qa-timing v1

Provider: `scripts/qa-timing.mjs` (Node built-ins only). Consumer: QA (`agents/qa.md`) and the Lead before the Ship Gate. Budgets file: `tests/budgets.json`.
Rationale: slow test files stay visible per Module, so a Module that grows slow is seen early. Report only; nothing here blocks a Gate.

## Budgets file
`tests/budgets.json`, a plain file (not a link) of at most 64 KiB, checked before `JSON.parse`:
```json
{ "v": 1, "default_ms": 10000, "modules": { "<script stem>": 20000 } }
```
- Exactly the keys `v`, `default_ms` and `modules`. `v` is `1`.
- `default_ms` and every module budget are whole numbers from 1 to 3 600 000 (milliseconds).
- `modules` is an object of at most 500 keys; each key is a script stem (`^[a-z0-9][a-z0-9-]{0,63}$`). A key is read with `Object.hasOwn`, so `constructor` or `__proto__` never reaches the prototype.
- A Module is a script `scripts/<stem>.mjs`. Its budget is the per-test-file wall time. A Module with no entry gets `default_ms`.

## Command
`node scripts/qa-timing.mjs [--root <dir>] [--module <stem>]`. `--root` defaults to the current directory; `--module` limits the run to one Module.
- Test files are found by listing `<root>/scripts`: a plain file named `<name>.test.mjs` belongs to the script stem that equals `<name>` or is a prefix of `<name>` followed by `-`; the longest such stem wins. A file with no such script is not run. Paths never come from the budgets file.
- Each test file runs alone: `node --test --test-reporter=spec <file>` with this node, no shell, output discarded, 300 s timeout, `NODE_TEST_CONTEXT` dropped from the environment. The wall time is measured by the command itself; reporter text is never read.
- A file over its Module's budget prints one line: `over budget <module>: <ms> ms of <budget> ms`. A file at or under budget prints nothing. A file that hits the timeout is reported the same way with its elapsed time.
- A bad budgets file (missing, link, over 64 KiB, bad JSON, wrong shape or number) or a bad argument prints one line, `qa-timing: error <reason>`, runs no test, and the reason never repeats file content.
- Exit code 0 on every path.

## Compatibility
v1. A new budgets key, a changed line format or a command that exits non-zero is a major bump.
