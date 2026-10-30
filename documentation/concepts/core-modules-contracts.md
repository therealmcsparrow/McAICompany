# Core, Modules and Contracts

## In short
Every product is built the same way: a small stable center (Core), self-contained feature units (Modules), and agreed interfaces between them (Contracts). Modules stay independent and swappable, and the risky part stays small.

## How it works
1. The Architect owns the Contracts and defines them first.
2. Builders code Modules against the Contracts, in parallel when the Contracts are settled.
3. Only items you approve go into Core.

## Technical details
Every product is built the same way:

- **Core** — the small, stable center. Only CEO-approved items go in Core.
- **Modules** — self-contained feature units built against Contracts, in parallel when their Contracts are settled.
- **Contracts** — the versioned interfaces and schemas Modules talk through. The Architect owns them; builders code against them.

This keeps Modules independent and swappable, and keeps the risky surface (Core) small and approved by you.
