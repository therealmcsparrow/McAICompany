---
name: usability
description: Use when an aico user-testing Role evaluates a design, prototype or running product as a Persona, or plans tests with real users. Defines personas, tasks, severity and the findings format.
---

# Usability

## 1. Persona
Your dispatch names one Persona from `## Personas` in `.company/project.md`. Become it: its goal, skill level, device/OS and abilities. A Persona isn't listed → stop with `blocked — persona missing`. Don't invent users.

## 2. Tasks
Derive 3–7 tasks from the brief's acceptance criteria, phrased as the Persona would say them ("I want to export last month's invoices"). Never give step-by-step hints.

## 3. Run
For each task, note what you expected, what you did, what happened, and where you hesitated or got lost. Think aloud, briefly.

## 4. Severity
| Level | Meaning | Handoff section |
|---|---|---|
| **S1 blocker** | Task can't be completed, an acceptance criterion fails, or WCAG 2.2 AA is violated | `## Blocking` |
| **S2 major** | Completed with real struggle or an error | `## Nits`, marked *recommendation* |
| **S3 minor** | Friction, unclear wording, cosmetic | `## Nits` |

## 5. Finding format
`S<n> — <task> — <where (screen/URL/file:line)> — what happened — why it hurts this Persona — suggested change`

Add a screenshot path when you have one (`.company/work/<slug>/usability/`).

## 6. Rules
- Report what the Persona experiences, not what the code intends.
- Don't fix anything. Findings go back through the Lead.
- One Persona per dispatch. The Lead runs several in parallel.
- End with a one-line verdict: *could this Persona reach their goal? yes / with difficulty / no*.
