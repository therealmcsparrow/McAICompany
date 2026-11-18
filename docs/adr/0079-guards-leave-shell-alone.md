# ADR 0079: Guards no longer judge shell commands, except secrets and run records

Date: 2026-11-17. Status: proposed (feature run P20261117.000001/01-feature). Contracts: `context-guard` v3.0, `hook-event` v1.4, `mod-hook` v1.2, `mod-manifest` v1.1. Amends `docs/adr/0072-guards-before-release.md` (five guards become four).

Roles and Leads may run any `Bash` or `PowerShell` command: the `git-add.M-SEC1` guard is removed (rule, manifest, row, fixtures) and `self-protect.M-SEC1` no longer judges shell commands for plugin, settings or home files, `hook-pins` or `set-mod` (CEO scope change, this run), because the shell block-list kept stopping real work (pin refreshes, interpreter one-liners) and, being path-token based, never stopped a command that builds its path at run time. Three shell checks stay, because they protect what only the CEO may decide or see: `dotenv.M-SEC1` (no `.env` read or write, any tool), the run-record write deny on `forms.jsonl`, `run-state.jsonl` and `guard.jsonl` (`Write`/`Edit` and shell, any session; `AICO_GUARDS=off` does not lift it, but a shell command that turns the hooks off does, see Accepted risk), and the deny of a shell command that runs the lead-relay `answer` adapter (`self-protect.M-SEC1`, any session, also with `AICO_GUARDS=off`; reason and match in `docs/adr/0078-ceo-answer-from-hook.md` and `context-guard` v3.0), so no shell can record a forged CEO answer. `Write`/`Edit` protection of plugin and settings files, the cap and the model floor are not shell checks and stay, with the same limit. Hard to reverse because builders will start relying on shell access the guard used to block, and re-adding a block-list later breaks those habits.

Decided: `guard.jsonl` stays in the run-record set with `forms.jsonl` and `run-state.jsonl`, because it is the cap's run record and the cap stays; a shell write to it could undo a freeze or a `guards-off` trace. Decided by the CEO at the Ship Gate, 2026-11-18, verbatim answer "Keep it in the set".

Decided: the lead-relay `answer` adapter shell deny is a narrow exception to this ADR, CEO ruling "Block shell calls (Recommended)" (fresh review R-4, recorded in ADR 0078). CEO scope rule for `AICO_GUARDS=off`: only the `.env` protection, the CEO-answer and Gate-record write protection and this `answer` shell deny stay on.

## Accepted risk

The guards are tripwires against accidental writes, not a boundary against a hostile or prompt-injected agent. With the shell blocks gone, three paths are open:
1. One shell command can edit `~/.claude/settings.json`, `.claude/settings.local.json` (e.g. `disableAllHooks`) or the plugin's `hooks/rules.json`/`hooks/hooks.json`, then run `hook-pins.mjs write`; that turns off every guard that "stays" above, the dotenv check, the run-record deny, `Write`/`Edit` protection, the cap and the model floor included.
2. The run-record shell check matches path tokens, so a name built at run time (variables, `$(...)`, interpreter string concatenation, symlinks) gets past it, the same gap that ended the block-list (Debt `134-security:R-6`).
3. With `git-add.M-SEC1` removed, `git add -A` or `git add .` may stage untracked secrets or logs again; this repo has no pre-commit secret scan.

The real boundary is the Claude Code permission mode and sandbox, set by the CEO, and CEO review of the diff and run records at the Gates. Decided: CEO sign-off 2026-11-17, verbatim answer "Accept, document in ADR (Recommended)".
