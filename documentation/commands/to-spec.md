# `/aico:to-spec`

`/aico:to-spec <idea | grill.md | file>`

## In short
**Only you start this command.** No other command or the Lead starts it. Software company only.

**What it does.** Turns an idea, a grill file or another file into a spec draft: problem, solution and decisions. When the draft comes from a grill, each decision ends with the question it came from, such as `(grill Q-3)`.

**When to use it.** You want a written spec to review before tickets or a build.

**Help:** `/aico:to-spec help` (or `--help`) explains the command without running it.

## How it works
1. The Product Manager writes the draft from your input.
2. The spec check runs on it. A draft that fails is marked `not ready` and the run ends `blocked`.

## Technical details
**You get.** `.company/work/<slug>/spec.md` with `version: pending` and `shipped: pending`. It is a draft: never committed and never stamped. A `/aico:feature` run that takes it writes the shipped spec at its own spec step.

**Example.** `/aico:to-spec .company/work/pause-subscription/grill.md`
