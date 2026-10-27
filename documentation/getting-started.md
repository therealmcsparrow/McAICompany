# Getting started

## Install

In Claude Code:

```
/plugin marketplace add therealmcsparrow/McAICompany
/plugin install aico@aico
```

`superpowers` and `mattpocock-skills` install automatically as dependencies. The repository is private, so your git must be able to clone it (e.g. run `gh auth login` once).

Optionally install the standalone and stack skills the Roles draw on:

```
/aico:setup                 # standalone skills: hallmark, find-skills, humanizer, impeccable, …
/aico:setup go react        # optional stack groups: go, react, tanstack, auth
```

Update later with `/plugin marketplace update aico`, then `/reload-plugins`. `/aico:version` shows which version you have.

### Follow `stable` or pin an earlier tag

`stable` is a branch of the repository. It moves only to a release tag (`v<x.y.z>`) that has passed its Ship Gate and is merged into `main`, and it can move back to an earlier tag. It is created the first time the maintainer runs `npm run stable -- <x.y.z>`, so it does not exist before that. Once it exists, install from it by adding `#stable` to the marketplace source:

```
/plugin marketplace add therealmcsparrow/McAICompany#stable
```

To install one earlier release instead, add that release's tag. For v0.14.1:

```
/plugin marketplace add therealmcsparrow/McAICompany#v0.14.1
```

Then run `/plugin install aico@aico` as above. The tag form was checked with the Claude Code CLI (`claude plugin marketplace add therealmcsparrow/McAICompany#v0.14.1`, then `claude plugin install aico@aico`): it installed version 0.14.1. The `#stable` form has not been run yet, because the branch does not exist yet. The repository is private, so the same git access applies.

Not sure what a command does? `/aico:help` lists them all, and `/aico:help <command>` (or `/aico:<command> help`) explains its options without running it.

## Your first run

Open Claude Code in the repository of the product you want to work on (or an empty folder for a brand-new product) and describe what you want:

```
/aico:lead add a dark-mode toggle to the settings page
```

`/aico:lead` is the front door. The Lead reads your request, picks the Roles it needs, shows you the planned route, and waits for your go-ahead. If your request matches a known kind of work, it tells you and switches to the matching command — for a feature it runs [`/aico:feature`](commands.md#aicofeature), for a bug [`/aico:fix`](commands.md#aicofix), and so on. You can also call those commands directly.

The first time the company works in a repository, it creates `.company/project.md` and asks you a short set of questions (product type, stack, voice, license). That profile is reused on every later run.

## How a job flows

1. **You ask.** Through `/aico:lead` or a specific command.
2. **The Lead routes.** It picks only the Roles the job needs and sequences them, running independent Roles in parallel.
3. **Roles work in turn.** Each Role starts fresh, reads the Handoff files it needs, does its part, and writes its own Handoff for the next Role. Work is committed one step at a time on a branch named `aico/<task>`.
4. **You approve at Gates.** The run pauses at each Gate (below) until you approve, ask for a change, or stop.
5. **Ship.** After the Ship Gate, release happens as you approved, and the Lead writes a short summary, shows one cost line (tokens used, counts only), prints a one-line [run scorecard](concepts.md#run-scorecard) and records any Lessons for next time.

Nothing is pushed or released before you approve it at the Ship Gate (unless you unlock an auto Ship Gate in settings, which pushes and opens a PR but never merges).

## The three Gates

A **Gate** is a checkpoint where the company stops and waits for you:

| Gate | When | What you're approving |
|---|---|---|
| **Brief** | After the Product Manager writes the brief | The problem, who it's for, and the scope — before any design or code |
| **Plan** | After the Architect (and designer) plan it | The Core list, the Contracts, the Module map and the art direction — before anything is built |
| **Ship** | Before anything is released or made public | The finished, reviewed work — before it goes out |

At every Gate you can **Approve**, **Change** (send it back with notes) or **Stop**. Read-only commands such as [`/aico:audit`](commands.md#aicoaudit) have no Plan or Ship Gate because they build nothing — they end with a report you act on.

## Tune the company

Run `/aico:settings` to open the settings page in your browser. There you can:
- rename Roles
- move a Role to another model or effort level
- change how many Fix rounds run before aico asks you
- set the max context per Role (default 150000, minimum 60000)
- pick the brainstorm debate style, or turn on the film script
- choose which review lanes run
- let the Brief or Plan Gate continue on its own

Save a change for every project (your user default) or only for the current one. Nothing changes until you save something. See [Settings](concepts.md#settings) and [Locks](concepts.md#locks).

## Where to go next

- The full list of commands: [Commands](commands.md)
- Who does what: [Roles](roles.md)
- The rules the whole company follows: [Concepts](concepts.md)
