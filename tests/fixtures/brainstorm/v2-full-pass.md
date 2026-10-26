---
topic: Move the settings page to a server
started: 2026-10-21 09.30
status: open
roles: architect, writer
format: 2
mode: debate
---
## Summary
(written at close)
## Digest
### Decisions
- D-1 — Q-1 — default: local (CEO skipped) — src: R1
### Open threads
- O-1 — Who owns the session token? — ideas: I-1.1 — src: R1
### Dissent
- Ren (writer) — "Users read a loopback URL as a bug." — src: R1
### Threads
- I-1.1 ← Ava (architect) challenge: "Loopback only, no remote bind." — src: R1
### Estimate
- not estimated
## Questions
- Q-1 [blocking] votes:1 status:answered — Where does it run? — options: local | hosted — default: local — src: R1
## Rounds
### Round 1 — debate: full_pass
#### Ava (architect)
Idea: loopback server with a token.
#### Ren (writer)
Idea: a plain URL on start-up.
#### Ava (architect) — full pass
Re: Ren. Loopback only, no remote bind.
#### Ren (writer) — full pass
Re: Ava. Users read a loopback URL as a bug.
#### Ava (architect) — crossfire
Re: Ren. Print the URL with one line of help.
#### Ren (writer) — crossfire
Re: Ava. One line of help is enough.
**Lead:** Local, one line of help.
**CEO:** (skipped)
