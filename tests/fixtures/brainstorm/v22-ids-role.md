---
topic: Add a dark mode to the demo app
started: 2026-10-20 10.00
status: open
roles: architect, writer, product-manager
format: 2
ids: role
mode: debate
---
## Summary
(written at close)
## Digest
### Decisions
- D-1 — Q-1 — "Yes, ship dark mode first, light stays the default." — src: R1
### Open threads
- O-1 — Which palette source do we trust? — ideas: I-1.1, I-1.2 — src: R2
### Dissent
- architect — "A theme switch touches every component, so it is not small." — src: R2
### Threads
- I-1.2 ← writer challenge: "Copy must survive both themes." — src: R2
### Estimate
- M, 3–5 d — src: R2
## Questions
- Q-1 [blocking] votes:2 status:answered — Ship dark mode first? — options: yes | no — default: yes — src: R1
- Q-2 [nice-to-have] votes:1 status:open — Follow the system theme? — options: follow | manual — default: follow — src: R2
## Rounds
### Round 1 — ideas
#### architect
Idea: CSS variables for every color.
Risk: a second palette doubles the QA matrix.
#### writer
skip
#### product-manager
Idea: ask users first.
**Lead:** Dark mode first, with CSS variables as the base.
**CEO:** Yes, ship dark mode first, light stays the default.
### Round 2 — debate: crossfire
#### architect
Idea: a theme token file, one source of truth.
#### writer
Idea: check every string in both themes.
#### product-manager
Idea: ship behind a flag.
#### writer — crossfire
Re: architect. Copy must survive both themes.
#### architect — crossfire
Re: writer. A theme switch touches every component, so it is not small.
**Lead:** Tokens first, copy check second; the size is M.
**CEO:** Go on.
