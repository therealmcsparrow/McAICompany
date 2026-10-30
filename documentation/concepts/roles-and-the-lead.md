# Roles, the Lead and the CEO

## In short
You are the **CEO**, the human. You have the final say. The **Lead** (Project Manager) takes your request and organizes the work. A **Role** is a specialist helper that does one job and then hands the result to the next one. Short definitions of every term are in [the glossary](../../GLOSSARY.md).

## How it works
1. You describe what you want.
2. The Lead picks the Roles and puts them in order.
3. Each Role starts with a fresh context, does its one job and writes a Handoff.
4. The Lead stops at the Gates and waits for your answer. See [Gates](gates.md).

## Technical details
You're not a Role; you have the final say and approve work at Gates. The **Lead** (Project Manager) takes your request, picks the Roles, sequences them and runs the Gates. A **Role** is a specialist agent that starts with a fresh context, does one job, and hands off. See [Roles](../roles/README.md).

### Models, effort and names
Every Role runs on a **model** (opus, sonnet or haiku) and an **effort** level (`low`, `medium`, `high`, `xhigh`, `max`). The model is how capable the Role is; effort is how long it thinks before acting. The plugin's defaults put the deepest thinking where a miss is expensive (architect, code-reviewer, security, pentester on high) and keep writing, art, lookup and support work on low. Every Role also has a pseudonym for display, such as Ava the architect or Quinn the QA tester. Use a pseudonym, never a real person's name. Names are shown only to you; Roles get their Role id, not your name, in prompts. A Role never gets a name in its prompt: it works under its Role id and writes that id in its Handoff byline (`By: architect`). Brainstorm files store Role ids from v0.20.0. You can still ask for a Role by name ("ask Ava to check the Contracts"); the Lead routes on your words and replaces the name with the Role id before it dispatches. Internal IDs like `aico:architect` never change. The full list is in [Roles](../roles/README.md).

To see which model a Role really runs on, read [Which model a Role runs on](model-choice.md).
