# Blast Radius

## In short
Blast Radius checks what a `git commit` would touch before it happens. If the commit touches the Core, a Contract or a security path, it warns you or asks you first, depending on your settings. It never says yes for you.

## How it works
1. Claude is about to run a `git commit` through the `Bash` or `PowerShell` tool.
2. Blast Radius lists the files, Modules, Contracts and Core items the commit touches, with the risk tier and review depth.
3. If there is a hit, the category setting decides: `ask` gives you one question listing every hit, and the commit goes ahead only if you say yes; `warn` shows a toast and the commit goes ahead.
4. With nobody to ask (plain `claude -p`), an `ask` hit refuses the commit.
5. If the check cannot run, the commit is treated as a security hit.

## Technical details
Settings: `mods.blast_radius.enabled`, `mods.blast_radius.core`, `mods.blast_radius.contract`, `mods.blast_radius.security`. Locks: a project may only tighten it; see [Locks](README.md#locks).

Blast Radius checks what a `git commit` touches before it happens.

- **What it gates.** A `git commit` run through the `Bash` tool **or** the `PowerShell` tool. On Windows without Git Bash, the shell tool is `PowerShell`, so both are covered. Other tools are not gated.
- **What counts as a commit.** Anything not known to be safe. Blast Radius clears only a command made of `cd`, plain text tools such as `echo` or `cat`, and `git` with a known non-commit subcommand such as `status`, `log` or `diff`. Any other command is treated as a commit: a variable or glob in place of `git`, an alias, `git -c` overrides, or another program in a command that mentions `git` and `commit` or a history-changing word (`merge`, `pull`, `cherry-pick`, `revert`, `am`, `rebase`, `stash`, `reset`, `update-ref`, `commit-tree`). The checks are stricter when a command mentions `commit` or one of those words, or runs `git` nested inside another command (for example `git` as an argument or after `xargs`). Known gaps, accepted: a script file, tool, hook or earlier config that commits; a command that builds `git` and these words from pieces; a harmless program's own option that runs something; work saved by `git stash` and put on a branch by a later `reset`, `branch -f`, `checkout -B` or `switch -C`; and files that the same command writes or stages before its commit, because the check runs before the command.
- **What it checks.** It lists the files, Modules, Contracts and Core items the commit touches, plus the risk tier and review depth, using the same answer as `review-depth`. That covers staged files, changed files in the work tree and untracked files, since `git commit -a` or a preceding `git add` can bring any of them in. A commit is a hit when it touches Core, a Contract, or a security path. If the command points git at another directory or index (`--git-dir`, `--work-tree`, `GIT_DIR` and similar), Blast Radius cannot tell what is committed and counts it as a security hit.
- **What it does with a hit.** Each category is set to `ask` or `warn`:
  - `ask`: you get one question that lists every hit, and the commit goes ahead only if you say yes.
  - `warn`: a toast and a `⚠ <category>` part on the status line for 60 seconds, and the commit goes ahead.
- **Defaults.** `core: ask`, `security: ask`, `contract: warn`. So a commit that touches only a Contract is never asked or refused unless you change that.
- **Nobody to ask.** In plain `claude -p` there is nobody to answer, so an `ask` hit refuses the commit with a reason that says `nobody can be asked; commit refused`. A background loop is the same. If the commit comes from a subagent, the reason starts with `From subagent <Step> <role>:`. A run driven by a host permission prompt tool is asked, but sees no reason text.
- **Fails closed.** If the check cannot run (the script fails, or the surface cannot run scripts, as on the unverified desktop app), that counts as a security hit, so the commit is asked or refused. An error inside the hook refuses a commit and lets every other shell call through.
- **It never says yes for you.** The hook never answers `allow` and never changes your permission settings.
- **Before a code review.** When the Lead dispatches a code reviewer, Blast Radius lists the same facts first. This never blocks the dispatch.

### What Blast Radius does not see

Blast Radius only sees commits that Claude makes through its `Bash` and `PowerShell` tools. A commit made any other way never reaches it, and nothing warns you:

- a commit you type yourself with `!git commit` in the prompt
- a commit made in another terminal
- a commit made from an IDE or a git GUI
- a commit made by a script file that Claude did not write out in the command itself

If you need a guard on those, use a git hook in the repository. Blast Radius also reads `.company/project.md` from the folder Claude was started in. Started from another folder, it finds no Core list and cannot tell which files are Core.

Back to [Mods](README.md).
