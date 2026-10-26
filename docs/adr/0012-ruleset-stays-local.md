# The ruleset stays local; CI checks the tools on fixtures

`.company/` is untracked here (global gitignore), and `.company/standards.md` holds Debt lines that point at weak code, so we don't force-add it to a public repo. With no ruleset present, `check.mjs` repo mode and `rule-check` print `no ruleset` and pass, while a half-present ruleset fails closed. CI proves the code on fixtures, and the Lead's machine, where the real files exist, runs the real checks (`npm test`, `drift` after each sign-off and before Ship).
