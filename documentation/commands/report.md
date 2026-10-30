# `/aico:report`

`/aico:report <client question | brief file> [quick|deep]`

## In short
**Help:** `/aico:report help` (or `--help`) explains the command without running it.

**What it does.** Turns a client question into a sourced report in which every claim is cited `[S#]` or marked `(unverified)`, then delivers or publishes it after the Ship Gate. Research company only.

**When to use it.** You run a research consultancy and a client has a question to answer.

## How it works
1. **Account Manager** takes the intake; **Product Manager** writes the report brief with the depth (`quick` or `deep`, default `deep`). **→ Brief Gate.**
2. **Product Manager** writes the plan: the report outline, the questions each researcher answers and the source plan. **→ Plan Gate:** you approve the outline, the questions and the sources before any research starts. This plan has no Core, Contracts or Ruleset item to approve.
3. In parallel, as the plan needs: **Market Researcher**, **Tech Researcher**, **UX Researcher**. A researcher that is blocked does not stop the run. The report names the gap and marks the affected claims `(unverified)`.
4. **Writer** drafts `.company/work/<slug>/report.md` with `## Summary`, `## Findings`, `## Recommendations`, `## Limits` and `## Sources`, from the researcher Handoffs only.
5. **Editor** checks every claim against `## Sources`. An uncited claim, an `[S#]` that does not exist or does not say that, or two places that disagree is a blocking `[spec]` finding. The Writer fixes it, then the Editor checks again.
6. **Legal** checks the AI-generated label, personal data, copyright and licences of quoted sources, and any client confidentiality terms.
7. **→ Ship Gate.** Without an Editor Handoff that is done and has no blocking finding, Ship is blocked. You then choose Deliver to the client, Publish or Hold. aico sends nothing itself.

## Technical details
This command runs through the shared pipeline; see the [command overview](README.md#other-company-types). Usage: `/aico:report <client question | brief file> [quick|deep]`. `quick` or `deep` sets the depth; the default is `deep`. In a software company it stops with "not part of your `software` company".

**You get.** The report at `.company/work/<slug>/report.md`, labelled `AI-generated research`, plus the Handoff trail. The `claims-cited` check stays open until an Editor Handoff is done with no blocking finding; an open check blocks Ship. The Ship summary starts with a line `Ship means: …`. Passing the Legal check records that Legal stated its position. It is not legal advice, so have a qualified lawyer review before you publish.

**Example.** `/aico:report what do dental clinics in the Netherlands use for patient reminders quick`
