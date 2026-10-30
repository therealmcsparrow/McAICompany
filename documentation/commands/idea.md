# `/aico:idea`

`/aico:idea <idea | resume <slug>>`

## In short
**Help:** `/aico:idea help` (or `--help`) explains the command without running it.

**Only you start this command.** No other command or the Lead starts it. All four company types.

**What it does.** Guides a rough idea from your text to a build, one pick at a time. Builds only after you pick Build, and then through [`/aico:feature`](feature.md).

**When to use it.** You have an idea and want the company to lead you through questions, a route and tickets. For a bug use [`/aico:bug`](bug.md).

## How it works
1. The idea is saved as `idea.md` in `.company/work/<slug>/`, then a form asks which grill to use: grilling (recommended), grill-me or grill-with-docs.
2. After the grill, a reprompt step turns the idea and the decisions into one prompt. It is shown in full, marked as AI-written.
3. The routes form offers A to E. The letters on offer come from the `idea-flow` script, never from the Lead's own text.
   - **A** Water cooler: colleagues chat about it, nothing is built.
   - **B** Brainstorm: the Roles weigh in until you say done.
   - **C** Research: researchers look it up online and write one sourced report; reprompt then runs again.
   - **D** Spec and tickets: the spec is written, tickets are cut, and you approve or change each ticket one at a time.
   - **E** Park the idea: a copy goes to `.company/ideas/<name>/` and the flow ends.
4. After D, one form: **F** Build, **G** park all tickets on the roadmap, or **E** park the idea.
5. **F** asks again only for tickets that are new or changed since you approved them, sizes the approved ones with triage (size and tier only), writes `.company/work/<slug>-build/plan.md` and starts `/aico:feature` on it. If the start is refused, you are shown the command to type.

Each step runs in the same session by reading that Playbook up to its stop point. `resume <slug>` reopens the open form.

## Technical details
**You get.** Local files under `.company/work/<slug>/`, a parked copy under `.company/ideas/<name>/` or roadmap files under `.company/roadmap/`, or a feature built through the Ship Gate.

**Your data.** The Claude model you configured reads the idea, grill, ticket and Handoff text. The web search tool gets queries only in grilling fact lookups and in research (route C). Files are local, archived and never deleted; an erasure request overrides that.

**Example.** `/aico:idea let customers pause their subscription`
