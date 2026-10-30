# Gates

## In short
A **Gate** is a point where the Lead stops and waits for your approval. At each you can Approve, Change or Stop. `/aico:feature` and `/aico:fix` keep only the Ship Gate. Every question the company puts to you comes as a form you click through, never buried in the chat.

## How it works
1. The Lead reaches a Gate and shows a summary.
2. You answer with a form: Approve, Change or Stop.
3. **→ Ship Gate** Before anything is released or made public, you approve here. By default nothing is pushed before that.
4. Questions that arise in between are held and shown together as one form at the end of the wave.

## Technical details
A **Gate** is a point where the Lead stops and waits for your approval. There are three: **Brief** (scope agreed), **Plan** (plan/design agreed) and **Ship** (before anything is released or made public). At each you can Approve, Change or Stop. `/aico:feature` and `/aico:fix` keep only the Ship Gate, in every run and also when you call them directly. What the Brief and Plan Gates used to show (Core and Contract changes, the parallel plan, the plan check, spike results) goes into the Ship Gate summary, and nothing waits for it before the build. A decision that used to wait for a Gate comes as one form when it arises. Script refusals are never bypassed. Other Playbooks keep their Gates. Every question the company puts to you — Gates, picks from a report, decisions a Role can't make — comes as a form you click through, never as a question buried in the chat output. See [Getting started](../start/getting-started.md#the-three-gates).

In [settings](settings-and-locks.md) you can set a Gate to **auto**: the Lead writes the Gate summary to the run folder and carries on, then tells you it did. The Ship Gate and installs start **locked** (see [Locks](settings-and-locks.md#locks)). An auto Ship Gate commits the run's wrap-up, pushes the branch and opens a PR, then stops. It never merges. Some asks always stay a form whatever the settings say: Must exceptions, Blocking security findings, picks from a report, escalations, design-skill approval, and anything sent outside your machine other than that PR (client messages, publishing, authority reports, production deploys, and every Ship Gate in `/aico:incident`).

### The hook Gate
`plan_check.policy` is `warn`, `block` or `off`. Under `block` the scripts refuse the Plan Gate record, the build start and every task start while the plan has open decisions. The scan reads the plan itself, reads no record and writes nothing. A plan entry that is a link or not a plain file is an `unreadable` error, never skipped. A project can raise the policy to `block` but cannot lower a `block` set in your user settings. Under `warn` and `off`, behaviour is unchanged.

### The CEO question pack
The Lead does not show a question the moment a Step returns `needs-ceo`. It holds the question until every Step of the current wave has returned, then shows all held questions as one form (up to 4 questions per form; more are split into the fewest forms). At the Brief, Plan or Ship Gate, the held questions join that Gate's own form. Some questions always get their own form and wait for the wave end only if the run can go on without them: Blocking security findings, escalations after the Fix-round limit, messages to a client, publishing, reports to authorities and production deploys. A Step that cannot continue without its answer ends the wave early.

The Lead records each form with `run-state ceo <slug> <brief|plan|ship|none> <n>`: the Gate and the number of questions, never the text. `none` counts a prompt that appeared outside any form; it is the number the pack aims to reduce.

### Questions to you
Every question the company puts to you carries a **recommended answer** first, with a one-line reason. `/aico:reprompt` and `/aico:brainstorm` also stop asking when no open question would change the result, and say so ("No open question left" or "No open questions"). They never pad a round to a count; `reprompt.question_rounds` (0 to 3) is only the upper bound. A question without its reason is malformed (`reprompt` v2.0, `brainstorm-reply` v2.0).
