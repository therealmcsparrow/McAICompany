# Mods

Mods are four small add-ons that run inside Claude Code while aico works. They show you what the run is doing, what it costs and when it is about to touch something risky. All four are on after a fresh install. You switch each one on or off, and set its options, on the [`/aico:settings`](commands.md#aicosettings) page (Mods section). A change takes effect by your next turn: no reinstall, no restart.

A mod switched off draws nothing, sets no status part, runs no timer, calls no script and acts on no event. Its options are kept.

Mods add no tokens to any model prompt. There are two exceptions, both listed below: the Reflect `model` mode, and the reason Blast Radius shows when it asks or refuses a commit (at most 600 characters). The cache clock makes no model call.

## Where mods work

- **Terminal.** Proven on a real terminal (Windows).
- **Desktop app.** Unverified. The mods pass tests that mimic the desktop app, but nobody has run them in the real app. The desktop API documents running scripts as terminal-only, so any value a mod gets from a script shows `unknown` there, and the view still draws. Blast Radius counts that failure as a security hit (see below).
- **VS Code and mobile.** The views do not draw. Blast Radius still works wherever it can see the shell tool.

Every state is written in words (`running`, `unknown`, `warn`, `asked`, `refused`, `expired`), never by colour alone. With `NO_COLOR` set, no colour is used.

## The four mods

### Savvy

Shows the progress of the current run: task, wave, current Step and Role (with its name), Gates passed, Fix round, elapsed time, and one line per running subagent. After the run ends it keeps the final state with outcome and total time until the next run starts or the session ends. With no active run it shows nothing.

Open it with the `aico-run` command. With `pane: auto` (the default) it opens on its own when a run starts, but only where it can dock as a sidebar: a terminal at least 110 columns wide. Below that, or under `claude -p`, nothing opens and the one-line summary is on the status line instead.

It follows [run-state](../GLOSSARY.md), the small record the Lead writes of each run's wave, Gates and end.

### Cache Tax

Shows what the run spends per Step: tokens in, cache write, out, cache read and spend, taken from the [token ledger](concepts.md#token-cost). Cache writes are marked `[tax]`, and the total shows what share of spend they are. A subagent that has started but has no ledger row yet shows `running`.

Open it with the `aico-cost` command (`pane: command` is the default).

It also shows the **cache clock**, described next.

### Reflect

Reflect looks at each finished Step and suggests what to remember.

- **Step check.** For each new or changed Step file, it writes at most five lines: what was done, what went wrong, what to remember, and up to three suggested Lessons. The lines go to a notice in the transcript (which the model never reads) and to the `aico-reflect` pane.
- **Retrospective.** When the run ends, it shows the top three costs and the top three times, what caused Fix rounds, and suggested Lessons.
- **Lessons.** Each suggestion is labelled `suggested` and has its own Accept and Decline buttons. Accept writes that one line to `.company/lessons.md`. Lesson text may hold only letters, digits, spaces and these marks: `. , ; : ! ? ' " ( ) - _ / %`. It cannot start with `-`. A suggestion with any other character, such as `$` or a backtick, is dropped. Decline, no answer, or ending the session writes nothing.
- **When it starts.** Reflect starts at the first Step the run dispatches, not at session start. If you resume a run, it stays idle until the next Step is dispatched.
- **Never in the way.** No hook waits for Reflect. It does not edit Handoffs, block a Step or delay a dispatch.

By default it works from fixed rules and spends no tokens (`mode: deterministic`). With `mode: model` it makes one model call per check, on your session's model, using at most 16 KiB of that Handoff. That call is real spend, so it is off by default. Its tokens are written to the ledger as `reflect` rows.

### Blast Radius

Blast Radius checks what a `git commit` touches before it happens.

- **What it gates.** A `git commit` run through the `Bash` tool **or** the `PowerShell` tool. On Windows without Git Bash, the shell tool is `PowerShell`, so both are covered. Other tools are not gated.
- **What counts as a commit.** Anything not known to be safe. Blast Radius clears only a command made of `cd`, plain text tools such as `echo` or `cat`, and `git` with a known non-commit subcommand such as `status`, `log` or `diff`. Any other command is treated as a commit: a variable or glob in place of `git`, an alias, `git -c` overrides, or another program in a command that mentions `git` and `commit`. A script file that commits, or a command that builds `git` and `commit` from pieces, is not caught.
- **What it checks.** It lists the files, Modules, Contracts and Core items the commit touches, plus the risk tier and review depth, using the same answer as `review-depth`. That covers staged files, changed files in the work tree and untracked files, since `git commit -a` or a preceding `git add` can bring any of them in. A commit is a hit when it touches Core, a Contract, or a security path. If the command points git at another directory or index (`--git-dir`, `--work-tree`, `GIT_DIR` and similar), Blast Radius cannot tell what is committed and counts it as a security hit.
- **What it does with a hit.** Each category is set to `ask` or `warn`:
  - `ask`: you get one question that lists every hit, and the commit goes ahead only if you say yes.
  - `warn`: a toast and a `⚠ <category>` part on the status line for 60 seconds, and the commit goes ahead.
- **Defaults.** `core: ask`, `security: ask`, `contract: warn`. So a commit that touches only a Contract is never asked or refused unless you change that.
- **Nobody to ask.** In plain `claude -p` there is nobody to answer, so an `ask` hit refuses the commit with a reason that says `nobody can be asked; commit refused`. A background loop is the same. If the commit comes from a subagent, the reason starts with `From subagent <Step> <role>:`. A run driven by a host permission prompt tool is asked, but sees no reason text.
- **Fails closed.** If the check cannot run (the script fails, or the surface cannot run scripts, as on the unverified desktop app), that counts as a security hit, so the commit is asked or refused. An error inside the hook refuses a commit and lets every other shell call through.
- **It never says yes for you.** The hook never answers `allow` and never changes your permission settings.
- **Before a code review.** When the Lead dispatches a code reviewer, Blast Radius lists the same facts first. This never blocks the dispatch.

## The status line

The four mods share one status line. They cannot overwrite each other. Claude Code prints `⚠ aico: ` before it, and the mods supply only the text after that. The text is in compact form:

```
<savvy> · <blast> · <cost> · <reflect>
```

Only the parts that have something to say appear, always in this order:

1. `savvy`: `W<wave> S<step> <role> <elapsed>`, for example `W3 S12 ba-eng 14m`. The role is cut to two letters per leading word and three for the last. After the run ends it reads `ended <outcome> <elapsed>`. Elapsed time is in whole minutes. An unknown field shows `?`.
2. `blast`: `⚠ <category>` for 60 seconds after a warning. Before a code review it reads `rev <depth>`.
3. `cost`: `<n> tax <m>m`, for example `12.4k tax 60m`. `n` is the run's cache write count. The clock shows `exp` when the cache has expired and `?` when unknown.
4. `reflect`: `<n> lessons` (`1 lesson`), the suggestions waiting for you.

Each part has a fixed width, so the text is at most 70 cells. With the host's `⚠ aico: ` in front, the line fits one 80-column terminal row. If the host still cuts it, the last parts are lost first.

The compact form leaves out the slug, Fix round, Gates, Names, spend, exact counts, expiry time and blast paths. Those are in the panes. Where a pane does not open on its own (under 110 columns, or `claude -p`), the status line is all you see of that mod.

## The cache clock

Claude Code keeps a cache of the Lead's conversation so the next turn costs less to read. While the cache is alive, a turn reads it cheaply. After it expires, the next turn has to write it again, which costs more. The cache clock, part of Cache Tax, shows when that happens.

It reads one of three ways:

- `Lead cache: expires 14:32 (in 41 min)`
- `Lead cache: expired 14:32; the next turn rewrites it`
- `Lead cache: unknown`, when the mod has not seen a Lead request in this session yet (for example when it loaded mid-session)

The expiry is the time of the Lead's last request plus the cache lifetime. Every new Lead request restarts it. In our measurements on Claude Code 2.1.310, the Lead's cache lasted one hour, so the clock uses 60 minutes, labelled `1 h (measured)`. That figure is measured, not taken from the API documentation. Below it, the pane always says: `Subagent caches last 5 minutes; nothing keeps them warm.`

### Why there is no keep-warm

We first planned a feature that would keep the Lead's cache alive by sending a background request. We tested it (spike SP-M3) and found no sign that it works: a forked request sent 55 minutes in did not read the Lead's cached conversation, and the Lead's next real request at 66 minutes read only the small fixed prefix. Spending tokens on something that does not hold the cache would cost money and save none. So the feature was cut. Cache Tax never forks, pings or calls a model; it only tells you the time, and what you do with it is up to you.

## Settings

Set these on the `/aico:settings` page, or read one with `node scripts/settings.mjs get mods.<path>`. A wrong value is refused and nothing is written.

| Key | Values | Default |
|---|---|---|
| `mods.savvy.enabled` | `true`, `false` | `true` |
| `mods.savvy.pane` | `auto`, `command` | `auto` |
| `mods.cache_tax.enabled` | `true`, `false` | `true` |
| `mods.cache_tax.pane` | `auto`, `command` | `command` |
| `mods.reflect.enabled` | `true`, `false` | `true` |
| `mods.reflect.step_check` | `true`, `false` | `true` |
| `mods.reflect.retrospective` | `true`, `false` | `true` |
| `mods.reflect.mode` | `deterministic`, `model` | `deterministic` |
| `mods.blast_radius.enabled` | `true`, `false` | `true` |
| `mods.blast_radius.core` | `ask`, `warn` | `ask` |
| `mods.blast_radius.contract` | `ask`, `warn` | `warn` |
| `mods.blast_radius.security` | `ask`, `warn` | `ask` |

There is no keep-warm key. `mods.cache_tax.keep_warm` is refused as unknown.

`pane: auto` opens the pane when a run starts, only where it can dock (see Savvy). `command` opens it only when you run its command.

### Locks

Three rules keep a cloned repo or a careless click from weakening a safety check. As with other [locks](concepts.md#locks), only your user settings can unlock.

1. **Reflect `model` is user-level only.** A project file cannot switch on token spend. A project value is ignored and listed.
2. **A project may only tighten Blast Radius.** A project can turn it on or set a category to `ask`. A project that turns it off or sets `warn` is ignored.
3. **Security stays asked unless unlocked.** `mods.blast_radius.security: warn` and switching Blast Radius off both need the `security` unlock in your user settings. Without it they resolve to `ask` and on. `core` and `contract` may be `warn` at user level without an unlock.

If a project settings file is broken, Blast Radius and Reflect `mode` stay at their plugin defaults.

## Related

- [Concepts](concepts.md): Gates, Core/Modules/Contracts, settings and locks
- [`../docs/contracts/aico-mods.md`](../docs/contracts/aico-mods.md): the full mod specification
