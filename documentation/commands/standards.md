# `/aico:standards`

`/aico:standards [tool | refresh]`

## In short
**What it does.** The Senior Engineer researches sourced best-practice rules for a tool (or `refresh` to re-check the existing ruleset), the Architect signs off, and any exceptions come to you. This builds and maintains the product's **Ruleset**.

**When to use it.** When adopting a new tool, standing up the ruleset for a project, or periodically to keep rules current. This is also how the "warm rule packs" get their content — one run per stack.

**Help:** `/aico:standards help` (or `--help`) explains the command without running it.

## How it works
1. **Senior Engineer** researches the named tool (mode *research*), or reports what's stale/changed (mode *refresh*) for you to pick from. Rules come from primary sources only.
2. **Architect** signs off — but only when Must rules were added or changed. A rejected rule gets one revision, then you decide.
3. Exception requests and new Debt come to you in one round. **→ Ship Gate** (commits the `.company/standards.md` and pack changes).

## Technical details
**You get.** Updated rule packs in the library and committed copies in `.company/standards/`, plus the project's `.company/standards.md`. See [Ruleset and debt](../concepts/ruleset-and-debt.md).

**Example.** `/aico:standards react` · `/aico:standards refresh`
