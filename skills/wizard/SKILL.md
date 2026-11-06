---
name: wizard
description: Use when an aico Role must hand the CEO manual steps only a human can do (third-party dashboards, credentials, CI secrets, a one-off cutover). Writes a bash wizard that walks the CEO through them; never for steps a Role can do itself.
---

# Wizard

A wizard is a bash script that walks the CEO through a manual procedure one stage at a time: it opens each URL, says what to click and copy, captures the values, writes them where they belong (`.env`, GitHub secrets or variables), confirms before anything irreversible and shows how many stages are left. Start from `template.sh` next to this skill: the library above the `STAGES` marker stays as it is; you only write stages.

1. **Scope.** Read the repo first, never ask cold: `.env.example`, README, `docker-compose*`, framework config and `.github/workflows/*` (every `secrets.*` and `vars.*` is a value the wizard must produce). Never read a live secret file: if the CEO points at one, read key names only, never values. For a cutover: the current state, the target state and the irreversible actions between. For each value know where the CEO gets it, where it is written (`.env`, a secret, both, nowhere) and whether it is secret.
2. **Map each stage.** Write the exact path a stranger could follow: "Dashboard → Developers → API keys → Reveal → copy". A UI or command you have not checked in the vendor's docs is never guessed: ask the CEO or mark it in the stage as "check: <what>".
3. **Write it.** Copy `template.sh` to `scripts/wizards/<name>.sh` in the product (or the work dir for a one-off), one `stage` per step in dependency order, and set `TOTAL_STAGES`. Open the URL before asking for its value, `ask_secret` for anything secret, `write_env` every kept value, `set_secret` only what CI reads, `confirm` before anything irreversible. One focused task per stage.
4. **Check, don't run.** `bash -n <script>`, and `shellcheck` if present. Never run it: it opens browsers and waits for the CEO. Trace it instead: every value from step 1 is captured and lands where step 1 says, and every `set_secret` name matches a `secrets.*` in CI.
5. **Hand over.** The Handoff `## Next` gives the run command. A wizard is a one-off unless the CEO wants a repeatable setup path; then it is committed and linked from the README.
