# Plan: mail-retry (v1.4.0)

By: architect. Brief: `01-product-manager.md` (AC1-AC3). Risk tier medium.

## Core (for the Plan Gate)
No Core item. The change sits in the mail queue module and touches no Contract.

## Contracts
None changed.

## Acceptance
| AC | Criterion | Task |
|---|---|---|
| AC1 | `mailQueue.drain` keeps a message whose send throws and tries it again | T1 |
| AC2 | `drain` stops after `maxFailures` failed sends (default 3) and returns the count sent | T1 |
| AC3 | Each criterion has a test that fails when `drain` is wrong | T2 |

## Tasks
### T1 Retry in drain
- role: backend-engineer
- files: src/mail/queue.mjs
- depends-on: none
- parallel: yes

Give `drain` a third argument `{ maxFailures }`. A failed send puts the message back at the end of the queue and counts one failure; the loop ends when the queue is empty or the failures reach the limit.

### T2 Retry tests
- role: qa
- files: src/mail/queue.test.mjs
- depends-on: T1
- parallel: no

Test `drain` with a send function that throws: the count returned, the messages left in the queue and the stop at `maxFailures`. The existing happy-path test stays as it is.
