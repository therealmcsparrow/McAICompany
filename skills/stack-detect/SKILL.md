---
name: stack-detect
description: Use when a Role needs to know a product's languages and frameworks, or when filling stack in .company/project.md. Maps manifests to installed stack skills.
---

# Stack detect

Roles are language-agnostic. This Practice finds the stack and points to the installed skills that know it.

## 1. Detect
If `stack:` is already filled in `.company/project.md`, use it and stop. Otherwise glob the repo root and one level down (skip `node_modules`, `vendor`, `target`, `dist`):

| Manifest | Stack |
|---|---|
| `Cargo.toml` | Rust (Tauri if `tauri.conf.json`) |
| `go.mod` | Go (Wails if `wails.json`) |
| `package.json` | JS/TS. Check deps for react, next, vue, svelte, electron, tauri |
| `composer.json` | PHP (Laravel/Symfony from deps) |
| `*.csproj`, `*.sln` | .NET (WPF/WinUI/Avalonia/MAUI from refs) |
| `pyproject.toml`, `requirements.txt` | Python |
| `CMakeLists.txt` | C/C++ (Qt if found) |

Write the result as one line: `stack: rust(tauri) + ts(react, tanstack-query)`.

## 2. Use installed skills (if present)
Load only those matching the task at hand:
- Go → `golang-*` skills (pick by topic: project-layout, dependency-management, continuous-integration, …)
- React/Next → `vercel-react-best-practices`, `vercel-composition-patterns`; TanStack libs → `tanstack-query` / `-router` / `-form` / `-table`
- TypeScript types → `typescript-advanced-types`
- Auth anywhere → `auth-implementation-patterns`
- Anything else → general knowledge plus the project's existing code conventions.

Check the available-skills list. Never assume a skill exists. If a stack's skills are missing, note in your Handoff that the CEO can run `/aico:setup <group>` (groups: go, react, tanstack, auth). Never install anything yourself.

## 3. Stack packs (only when there's a gap)
When a Role hits the same stack-specific mistake twice and no installed skill covers it, first search with `find-skills` and propose the result as a new group in `deps/skills.json`. Only if nothing good exists, add a pack at `references/<stack>.md` (at most 60 lines: conventions, pitfalls, commands) and add a row here: `<stack> → references/<stack>.md`. Never ship a pack speculatively.

Packs: _none yet_.
