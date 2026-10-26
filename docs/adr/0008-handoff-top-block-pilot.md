# Handoff top block, piloted on review and compliance

Handoffs get an `aico-top` fenced block with seven fixed keys and finding rows with stable IDs (`handoff` v1.1), instead of a new shorthand dialect. The frontmatter stays the routing source, so readers that don't know the block keep working; the block repeats `status`, `files` and `ac_ids` and must agree with it. The block is required and lint-blocking only for the Code Reviewer and the compliance pass until the AC26 numbers justify widening it (CEO, Brief Gate Q5); widening is a later minor bump.
