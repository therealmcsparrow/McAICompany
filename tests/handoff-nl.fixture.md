---
step: 03
role: backend-engineer
task: voorbeeld
status: blocked
round: 1
base-commit: d39e8824d81e98a0a3333119ce71881a5716bd0b
risk-tier: high
acceptance-ids: [AC1, AC3]
files-touched: [src/x.ts, src/y.ts]
---
## Did
- De module `x` toegevoegd in `src/x.ts` met tests.
## Decisions
- Invoer wordt aan de rand gevalideerd, zodat andere modules niets hoeven te controleren.
## Blocking
- [security] src/x.ts:12 — invoer wordt niet gesaneerd — saneer vóór gebruik.
- [test] src/y.ts:4 — randgeval ontbreekt — voeg een test toe.
## Nits
- De naam `tmp` is onduidelijk.
## Next
- De code-reviewer controleert de wijzigingen sinds `base-commit`.
