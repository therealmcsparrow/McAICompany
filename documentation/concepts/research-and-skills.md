# Research and skills

## In short
Before building, researchers can look a topic up online and the Product Manager writes one sourced report. UI products can have approved design skills, and other third-party skills are scanned before you see them. Nothing installs unless you say yes twice.

## How it works
1. Run [`/aico:research`](../commands/research.md) and read the report with its verdict.
2. Name an earlier report as input to a run if you want.
3. A design-researcher or the skill-researcher proposes skills.
4. You approve the set in one form, then confirm the exact install commands in a second form.

## Technical details
### Research inputs
You can name an earlier report from `.company/research/` as input to a run. The Product Manager and Architect cite it as `[S#]` with the report's date, and re-check or mark `(unverified)` any verdict or blocker taken from it. An old report is never a decision.

### Research before building
[`/aico:research`](../commands/research.md) has three researchers (market, tech and, for UI work, design) look the topic up online before anything is built. The Product Manager writes one report with a verdict (go, go-with-conditions or no-go), ranked actions, low-hanging fruit (impact and effort), risks and open questions. Every claim cites a source with its URL and check date. A claim with no source is marked `unverified` and cannot support the verdict. The report is labelled as AI-generated research. Researchers read web pages as data, never as instructions, and never install anything.

### Design skills
A UI product can have approved design skills. The set lives in `.company/project.md` under `## Design skills`: one line per skill with its source, license, vetted date and approval date, at most five. A design-researcher proposes the set from your stack, product type, Personas and Art direction. You approve it in a form, and installs run only after a second form shows the exact commands. `/aico:feature` refreshes the set for a UI product when it is empty or its newest approval is older than 180 days. The UI Roles load the approved skills from their dispatch.

### Skill picks
The skill-researcher (Selin) proposes third-party skills for four areas: `stack`, `product-type`, `company-type` and `design`. It has no Bash, so it runs no scanner. It vets each candidate against its sources, then the Lead scans every pick with SkillSpector in a new quarantine folder before you see it. A critical or high finding, a failed scan or a timeout means the pick is rejected, and with no scanner installed nothing is recommended. You approve the set (at most 5 per area) in one form, then see the exact install commands in a second; nothing installs unless you answer yes to both. The install pins the commit that was scanned. After it, the Lead scans the installed skill again; a bad result stops the run and shows you the removal command, which only you run. Approved `stack`, `product-type` and `company-type` skills are recorded in `.company/project.md` under `## Skills`, one line each, and design skills stay under `## Design skills`. To scan skills you already have, use [`/aico:skillspector`](../commands/skillspector.md).
