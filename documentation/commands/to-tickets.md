# `/aico:to-tickets`

`/aico:to-tickets <spec.md | brief file>`

## In short
**Only you start this command.** No other command or the Lead starts it. Software company only.

**What it does.** Splits a spec or a brief into a plan of small tasks, each with a role, files, dependencies, context size, slice and seams.

**When to use it.** You have a spec and want the work cut into ordered tasks before building.

**Help:** `/aico:to-tickets help` (or `--help`) explains the command without running it.

## How it works
1. Needs a spec with a problem and a solution, or a brief with `AC<n>:` lines. Otherwise it says what is missing and writes nothing.
2. The Architect writes the plan, with the base commit as its third line.
3. The plan check runs and the run prints the task graph and one line per task.

## Technical details
**You get.** `.company/work/<slug>/plan.md`. Start the build with [`/aico:feature`](feature.md) and the plan path; paths the plan lists are compared with the repository then.

**Example.** `/aico:to-tickets .company/work/pause-subscription/spec.md`
