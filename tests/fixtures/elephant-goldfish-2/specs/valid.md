---
slug: saved-rows
version: pending
shipped: pending
---
## Problem
People lose the rows they type because nothing keeps them between visits.
## Solution
Each submitted row is kept and shown again on the next visit.
## User stories
- As a visitor I see my earlier rows when I come back.
## Decisions
- Rows are kept per visitor, not shared.
## Testing decisions
- The visible list after a second visit is the thing under test.
## Out of scope
- Sharing rows between visitors.
