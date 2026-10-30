# Plan: demo

Brief: `.company/work/demo/01-product-manager.md`
Earlier notes: `.company/work/demo/03-architect.md` and `.company/work/demo/02-builder-notes.md`
Standards: `.company/standards.md`
Link: [site](https://example.com/x.mjs)
Absolute: `/etc/hosts` and `C:/Windows/win.ini`
Parent: `../outside.mjs`
Missing: `src/missing.mjs`

The task changes the lint rule in `docs/contracts/handoff.md` and keeps plan-review v1 as it is.

### T1 server
- role: backend-engineer
- files: `src/server.mjs`, src/util.mjs
- depends-on: none

### T2 tests
- role: qa
- files: src/big.test.mjs
- depends-on: T1
