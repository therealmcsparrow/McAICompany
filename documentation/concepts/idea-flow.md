# Idea flow

## In short
`/aico:idea` and `/aico:bug` take you from your first words to a build, with a form at every step. You approve the tickets one by one before anything is built.

## How it works
1. Start with `/aico:idea` for a new idea or `/aico:bug` for a bug report.
2. Answer the form at each step of the route. See [From idea to shipped code](../start/idea-to-ship.md#the-route).
3. Approve or change each ticket.
4. Pick Build. `/aico:idea` builds through `/aico:feature`, `/aico:bug` through `/aico:fix`. **→ Ship Gate**

## Technical details
### Idea flow
`/aico:idea` and `/aico:bug` guide one idea or bug report from your first words to a build, with a form at every step. Both use the same route, kept in one text (`skills/idea/references/routes.md`); only the build Playbook differs: `/aico:idea` builds through `/aico:feature`, `/aico:bug` through `/aico:fix`. The allowed picks of every form come from the `idea-flow` script, not from the Lead's wording. The steps run in your session, because grill, to-spec and to-tickets are CEO-only Playbooks. See [From idea to shipped code](../start/idea-to-ship.md#the-route) for the route.

The state lives in `.company/work/<slug>/idea-flow.jsonl`, an append-only record. `resume <slug>` reopens the open form.

### Ticket approval
After the spec is cut into tickets, you approve them one by one: Approve or Change. A ticket is one task of the plan. An approval counts only for the exact text it was given for: if a ticket changes after your approval, you are asked again. When you pick Build, tickets are asked once more only if they are new or changed. You can park a ticket on the roadmap (`.company/roadmap/`) or park them all. The record is `.company/work/<slug>/tickets.jsonl`. No Gate reads it to skip anything. The Ship Gate shows each approval line so you can check it.
