# CEO pack

How the Lead bundles questions to the CEO (`run-state` v1.5, `docs/contracts/run-state.md`). The success metric is the number of prompts that appear outside a form.

## Rules
- A Step that returns `status: needs-ceo` does not get its question shown at once. The Lead holds it until every Step of the current wave has returned.
- When the wave ends, all held questions go out as one form (up to 4 questions per form; more are split into the fewest forms, pre-grouped by owner). The answers go into the next dispatches.
- At a Brief, Plan or Ship Gate, the held questions join that Gate's own form instead of a separate one.
- Always a form, whatever the settings say: Blocking security findings, escalations after the Fix-round limit, messages to a client, publishing, reports to authorities and production deploys (`skills/pipeline/SKILL.md`). These still wait for the wave to end unless the run cannot go on without the answer.
- A Step that cannot continue without its answer ends the wave early: the Lead shows the form once the other running Steps return.

## Recording
- After each form is shown: `node "${CLAUDE_PLUGIN_ROOT}/scripts/run-state.mjs" ceo '<slug>' '<brief|plan|ship|none>' '<n>'`, one record per form, `<n>` the number of questions in it (1 to 20).
- A Gate form uses its Gate word. A wave-end form between Gates uses the Gate the run is heading for.
- `none` counts a prompt that appeared outside any form (a stray question in text, a permission prompt the Lead had to ask alone). It is the number to drive down.
- Pass only the checked words and the count. Never put a question, an answer or CEO text in an argument.
- A refused command is named in the next Gate summary and the run goes on.
