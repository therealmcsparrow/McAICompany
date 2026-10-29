# Plan: cart-discount (v1.4.0)

By: architect. Brief: `01-product-manager.md` (AC1-AC3). Risk tier medium.

## Core (for the Plan Gate)
No Core item. The change sits in the cart module and touches no Contract.

## Contracts
None changed.

## Acceptance
| AC | Criterion | Task |
|---|---|---|
| AC1 | `applyDiscount(total, percent)` returns the total minus the percent | T1 |
| AC2 | A percent below 0 or above 100 throws a `RangeError` | T1 |
| AC3 | Each criterion has a test that fails when the function is wrong | T2 |

## Tasks
### T1 Discount function
- role: backend-engineer
- files: src/cart/total.mjs
- depends-on: none
- parallel: yes

Add `applyDiscount` next to `cartTotal`. It validates the percent first, then returns the discounted total.

### T2 Discount tests
- role: qa
- files: src/cart/total.test.mjs
- depends-on: T1
- parallel: no

Test `applyDiscount` through its public signature: the discounted total for a valid percent, and the `RangeError` for a percent outside 0-100. The existing `cartTotal` test stays as it is.
