---
name: contracts
description: Use when designing, building or reviewing any McSparrow product structure. Every product is a minimal Core plus pluggable Modules that talk only through versioned Contracts.
---

# Core, Modules, Contracts

This applies to every product type: backend, frontend and desktop. Patterns per type are in `references/by-product-type.md`; read only your section.

## Rules
1. **Core is minimal.** It holds only what the CEO approved at a Plan Gate, listed under `## Core` in `.company/project.md`. Typical Core: bootstrapping, the Module registry/loader, shared Contract definitions, cross-cutting plumbing (config, logging, auth context).
2. **Everything else is a Module**: self-contained, removable, and owning its own data, UI and tests.
3. **Modules talk only through Contracts.** A Contract is an explicit interface (functions/types, events, routes/slots, an IPC or plugin API) plus its version. Never import, call or query another Module's internals, tables or private state.
4. **Contracts are versioned and owned by the Architect.**
   - Additive change (new optional field, new event): the Architect may approve it. Bump the minor version.
   - Breaking change: new major version, the old one kept until consumers migrate, **and CEO approval**.
5. **Contracts come first.** Builders implement against a Contract that already exists. If you need one that doesn't exist yet, stop with `status: needs-ceo` (Core) or ask the Architect (Module Contract) through your Handoff.

## Builder checklist
- [ ] My code lives in my Module's folder.
- [ ] Every cross-Module or Core interaction goes through a listed Contract.
- [ ] I added nothing to Core. *"It's shared, so it belongs in Core"* is not approval. Shared code goes in a Contract or its own Module.
- [ ] My Module can be disabled or removed without breaking compilation or startup of the others.

## Review blockers (always `## Blocking`, never a nit)
- A Module imports or calls another Module's internals, or reads its storage.
- Code added to Core that isn't on the approved Core list.
- A Contract changed without a version bump, or a breaking change without CEO approval.
- A Module has no contract tests for the Contracts it provides.

## Contract tests
QA writes one contract test suite per provided Contract. It exercises only the public interface, so any implementation can be swapped in.
