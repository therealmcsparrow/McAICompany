# Plan: demo feature

## Tasks

### T1 settings reader
- role: backend-engineer
- files: docs/contracts/aico-settings.md, scripts/settings.mjs
- depends-on: none
- parallel: yes

### T2 docs
- role: writer
- files: documentation/concepts.md
- depends-on: T1
- parallel: yes
