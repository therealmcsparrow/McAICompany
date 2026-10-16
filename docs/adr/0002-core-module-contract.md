# All products are Core + Modules joined by Contracts

Every McSparrow product (backend, frontend, desktop) keeps a minimal Core and puts everything else in pluggable Modules that talk only through versioned Contracts. The Architect proposes Core and the Contracts; the CEO approves at the Plan Gate. Breaking a Contract, reaching into another Module's internals, or adding unapproved code to Core is a blocking review issue. We accept extra upfront design so features can be added, removed, or sold separately without touching Core.

**Consequences**: Contract changes are versioned; additive changes need only the Architect, breaking changes need the CEO. QA writes contract tests per Module.
