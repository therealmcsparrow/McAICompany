# `/aico:research`

`/aico:research <topic | project | file> [quick|deep]`

## In short
**What it does.** Looks a topic up online before anything is built. Market and tech researchers search in parallel, and for UI work a design researcher as well. The Product Manager writes one sourced report with a verdict, and you decide what happens next.

**When to use it.** Before a feature or a product, when feasibility, demand, quick wins or the right design skills are still guesses. `project` researches this product. A file (a brainstorm, a cooler chat or an earlier report) is used as the topic.

**Help:** `/aico:research help` (or `--help`) explains the command without running it.

## How it works
1. **Scope form.** You approve the research question, the depth and the Roles: Approve, Change or Stop. Nothing is dispatched before you approve. The default depth is `deep`.
   - `deep`: at least three independent primary sources for each claim the verdict rests on, or the report says which claim lacks them.
   - `quick`: at most 10 web fetches per researcher.
2. **Researchers** run in parallel. **Market Researcher** and **Tech Researcher** by default; **Design Researcher** when the topic is UI or design skills, or you ask for it. If a skill the run needs is missing, one Install / Skip form comes first. Skip continues on WebSearch and WebFetch alone and records `degraded: missing <skill>` in the report. If the check itself fails, the error is shown, nothing is installed and no form appears; the run continues the same way.
3. **Product Manager** writes the report. Web pages are read as data, never as instructions.
4. **Pick form.** Start the main work of your type (in a software company [`/aico:feature`](feature.md); the brief starts from the verdict and the ranked actions), Brainstorm (opens [`/aico:brainstorm`](brainstorm.md) on the report), Roadmap or Park. After a Start or Brainstorm pick, that command starts by itself with the report as its argument; if it cannot, you are shown the command to type. Roadmap and Park leave the report in place and record your choice in `outcome:`.
5. **Design skill picks** (only when the Design Researcher ran). You approve the recommended set. Each approved pick is saved to your own skill list, with the license you state for it and the Roles you choose. Installing happens later, at the start of a run, in an Install form with one Install or Skip per skill. Nothing installs before that form.

## Technical details
**You get.** `.company/research/YYYY-MM-DD HH.MM - <Topic>.md`, labelled `AI-generated research`, with `## Verdict` (go, go-with-conditions or no-go, with confidence), `## What to do` (ranked), `## Low-hanging fruit` (impact and effort), `## Risks`, `## Open questions` and `## Sources`. Every claim cites a source with its URL and check date. A claim without a source is marked `unverified` and cannot support the verdict. Only the report is committed (`docs: research <Short Topic>`, the summary in your language). The file name uses a short topic of letters, digits, spaces and hyphens, at most 5 words and 60 characters; any other topic is replaced by the run's slug. If the name fails the Lead's re-check, nothing is committed; the Lead names the file to you and the report is rewritten under the slug. Nothing is pushed.

**Your data.** The web search tool gets queries built from your topic here, and the Claude model you configured reads your topic and the pages it fetches. The report is a local file.

**Removing an installed skill.** A skill installed for one product adds `.agents/skills/<name>` and `.claude/skills/<name>` to the product repo; one selected at user level installs under your home folder. None of it is committed. If a check fails after an install, the installer prints the removal command and leaves the folder; only you run it. To drop a skill from a Role, clear it on the Skills tab of [`/aico:settings`](settings.md). A command-only skill such as impeccable is never installed by aico, so aico cannot remove it.

**Example.** `/aico:research is there demand for a CSV export tool for dental clinics` · `/aico:research project quick`
