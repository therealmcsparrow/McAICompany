# Getting started

## In short

aico is a Claude Code plugin that runs a small software company for you. You are the CEO: you describe the work, and you approve it at checkpoints called Gates. This page gets you from install to your first run.

## How it works

### Install

1. Add the marketplace and install the plugin in Claude Code:

   ```
   /plugin marketplace add therealmcsparrow/McAICompany
   /plugin install aico@aico
   ```

   Expected result: `aico` is installed. `superpowers` installs automatically as a dependency. The repository is private, so your git must be able to clone it (for example, run `gh auth login` once).

2. Optional: install the standalone and stack skills the Roles draw on.

   ```
   /aico:setup                 # standalone skills: hallmark, find-skills, impeccable, …
   /aico:setup go react        # optional stack groups: go, react, tanstack, auth
   ```

3. Optional but recommended: do the [one-time setup](setup.md), so the Lead can hand over to itself before Claude Code compacts.

Update later with `/plugin marketplace update aico`, then `/reload-plugins`. `/aico:version` shows which version you have. Not sure what a command does? `/aico:help` lists them all, and `/aico:help <command>` (or `/aico:<command> help`) explains its options without running it.

### Your first run

1. Open Claude Code in the repository of the product you want to work on (or an empty folder for a brand-new product).
2. Describe what you want:

   ```
   /aico:lead add a dark-mode toggle to the settings page
   ```

   `/aico:lead` is the front door. The Lead reads your request, picks the Roles it needs, shows you the planned route, and waits for your go-ahead. If your request matches a known kind of work, it tells you and switches to the matching command: for a feature it runs [`/aico:feature`](../commands/feature.md), for a bug [`/aico:fix`](../commands/fix.md), and so on. You can also call those commands directly.

3. Answer the short set of questions. The first time the company works in a repository, it creates `.company/project.md` and asks about product type, stack, voice and license. That profile is reused on every later run.

Starting from a rough idea or a bug report? Use `/aico:idea <idea>` or `/aico:bug <bug report>`. Both guide you with forms from the first words to a build; see [From idea to shipped code](idea-to-ship.md).

### How a job flows

1. **You ask.** Through `/aico:lead` or a specific command.
2. **The Lead routes.** It picks only the Roles the job needs and sequences them, running independent Roles in parallel.
3. **Roles work in turn.** Each Role starts fresh, reads the Handoff files it needs, does its part, and writes its own Handoff for the next Role. Work is committed one step at a time on a branch named `aico/<task>`.
4. **You approve at Gates.** The run pauses at each Gate (below) until you approve, ask for a change, or stop. **→ Ship Gate** is the one that always runs.
5. **Ship.** After the Ship Gate, release happens as you approved, and the Lead writes a short summary, shows one cost line (tokens used, counts only), prints a one-line [run scorecard](../concepts/receipts-and-reports.md) and records any Lessons for next time.

Nothing is pushed or released before you approve it at the Ship Gate (unless you unlock an auto Ship Gate in settings, which pushes and opens a PR but never merges).

### The three Gates

A **Gate** is a checkpoint where the company stops and waits for you.

| Gate | When | What you're approving |
|---|---|---|
| **Brief** | After the Product Manager writes the brief | The problem, who it's for, and the scope, before any design or code |
| **Plan** | After the Architect (and designer) plan it | The Core list, the Contracts, the Module map and the art direction, before anything is built |
| **Ship** | Before anything is released or made public | The finished, reviewed work, before it goes out |

At every Gate you can **Approve**, **Change** (send it back with notes) or **Stop**. `/aico:feature` and `/aico:fix` have no Brief Gate and no Plan Gate, in any run; they keep only the Ship Gate, and it always runs. Other commands keep the Gates listed here. Read-only commands such as [`/aico:audit`](../commands/audit.md) have no Plan or Ship Gate because they build nothing. They end with a report you act on. More in [Gates](../concepts/gates.md).

## Technical details

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

### The context cap

Every Role works under one fixed cap: 95000 tokens, with a hand-over at 85500. The old `context_cap` setting has no effect. The Lead's own hand-over needs the [one-time setup](setup.md).

### Tune the company

Run `/aico:settings` to open the settings page in your browser. There you can:
- rename Roles
- move a Role to another model or effort level
- change how many Fix rounds run before aico asks you
- see the max context, fixed at 95000 with a hand-over at 85500
- pick the brainstorm debate style, or turn on the film script
- choose which review lanes run
- let a Brief or Plan Gate continue on its own (feature and fix have neither)

Save a change for every project (your user default) or only for the current one. Nothing changes until you save something. See [Settings and locks](../concepts/settings-and-locks.md).

### Files a first run creates

- `.company/project.md`: your product profile.
- `.company/work/<slug>/`: the Handoff files and records of one job.

aico writes no ignore rule for `.company/`. They stay out of git only if your product ignores it. The Claude model you configured reads what the Roles read. See [Where your words go](../concepts/where-your-words-go.md).

### Where to go next

- The full list of commands: [Commands](../commands/README.md)
- Who does what: [Roles](../roles/README.md)
- The rules the whole company follows: [Concepts](../concepts/README.md)
- A rough idea to a merged release: [From idea to shipped code](idea-to-ship.md)
