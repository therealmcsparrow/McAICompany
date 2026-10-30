# `/aico:refactor`

`/aico:refactor <scope>`

## In short
**What it does.** Restructures existing code toward Core, Modules and Contracts in safe slices, with **no change in behavior**. The audit report is the brief.

**When to use it.** The code works but is hard to change — tangled Modules, leaky boundaries, missing Contracts. Not for adding behavior (use [`/aico:feature`](feature.md)) or fixing bugs (use [`/aico:fix`](fix.md)).

**Help:** `/aico:refactor help` (or `--help`) explains the command without running it.

## How it works
0. With no audit report to start from, you are asked **Run audit first (Recommended)** or **Skip audit**. Run audit first: `refactor` tells you to run `/aico:refactor "<scope>"` again once the audit report is written, then starts [`/aico:audit`](audit.md) as its own run and ends. The second `refactor` run starts from that report. Skip audit: it stops and asks you to bring an audit report. If `/aico:audit` cannot be started, you are shown both commands to type.
1. **Architect** defines the target Core, Module map, Contracts and the slices (each slice moves one Module out). The **Senior Engineer** maps the ruleset and the Architect signs off if Must rules changed. **→ Plan Gate.**
2. Per slice, in order: **QA** writes characterization tests of current behavior (they must pass first) → the owning **engineer** moves the code behind the Contract with no behavior change → **Code Reviewer** ∥ **QA** ∥ **Senior Engineer** confirm the same tests still pass. **→ Ship Gate** (per slice).

## Technical details
**You get.** The same behavior behind cleaner boundaries, slice by slice, each independently shippable. Old rule violations are logged as Debt, never fixed inside a slice.

**Example.** `/aico:refactor extract the billing logic out of the user service into its own Module`
