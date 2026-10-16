# Core/Module patterns by product type

Read only the section for your product type. All of these are language-agnostic: use the idioms of the detected stack.

## Backend
- **Core**: app bootstrap, Module registry, config, logging, auth context, and the Contract definitions (interfaces/ports, event schemas).
- **Module**: one bounded capability (billing, users, search). It exposes a service interface and/or publishes events, and owns its tables/schema.
- **Contracts**: interfaces/ports in a shared contracts package; event payload schemas; HTTP/RPC route schemas (OpenAPI/proto).
- **Forbidden**: cross-Module joins and foreign keys into another Module's tables. Reference by ID through the Contract instead.

## Frontend
- **Core**: app shell, router, Module registration, design-system tokens/components, the auth/session provider.
- **Module**: a feature package that registers its routes, nav items and slot/widget contributions with the shell.
- **Contracts**: a registration API (routes, slots, menu), typed events or a shared state interface, and API client types.
- **Forbidden**: importing from another feature Module's folder. Share through Core's design system or a Contract.
- A lint rule (import boundaries) is the cheapest enforcement. Add one when the stack supports it.

## Desktop (Windows, Linux, macOS)
- **Core**: the plugin host (discovery, loading, lifecycle), window/shell, settings, update mechanism, platform abstraction.
- **Module**: a plugin/extension contributing commands, views, file handlers or background services.
- **Contracts**: the extension-point API (commands, views, events, settings schema), the IPC message schema between processes, and a versioned plugin manifest.
- Platform-specific code lives behind a platform Contract in Core, never inside feature Modules.

## Contract test shape (all types)
One suite per Contract. It drives only the public interface and is runnable against any implementation, including fakes. A Module provides its Contract only once this suite passes.
