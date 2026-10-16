# aico Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `aico` Claude Code plugin: 15 Role agents, a Lead skill, 5 Playbooks, 12 Practices, a company profile, and a structure checker.

**Architecture:** Markdown agents/skills with YAML frontmatter, cross-referenced by name (`aico:<skill>`, `aico:<agent>`). A zero-dependency Node script validates structure. Lead/Playbooks run in the main session and dispatch Role subagents through file Handoffs.

**Tech Stack:** Claude Code plugin format, Markdown, Node ≥ 20 (`node:test`, no deps).

**Spec:** `docs/spec.md` (+ `GLOSSARY.md`, `docs/adr/0001`, `0002`)

## Global Constraints
- Plugin name `aico`; skill `name` = folder name, lowercase-hyphen, ≤ 64 chars; description ≤ 1024 chars (hard), aim ≤ 250.
- Agent files ≤ 50 lines, skill files ≤ 125 lines — guideline; checker warns, does not fail.
- Use only Glossary terms (Role, Practice, Lead, Playbook, Step, Handoff, Gate, Fix round, Core, Module, Contract, CEO, Voice preset).
- Language-agnostic: no Role or Practice assumes a programming language.
- Lead, Playbooks: `disable-model-invocation: true` (no listing tokens, user-invoked only).
- Every pointer Practice names its target skill(s) and has a ≤ 3-line fallback.
- Every agent: says which Practices to load *and when*; never preloads skills via frontmatter.

## Review Focus
1. Broken cross-reference (`aico:foo` that doesn't exist) → checker errors with file + name.
2. Reviewer agent asked to "just fix it" → must refuse edits and write a blocking finding instead.
3. Builder tempted to put shared code in Core without approval → must create a Module/Contract or escalate.
4. Step started without a Handoff path → agent must stop and ask the Lead, not guess context.
5. Third Fix round → Lead escalates to CEO instead of looping.
Items 1 → Task 1 tests; 2–5 → Task 7 pressure scenarios.

## File Structure
```
.claude-plugin/plugin.json, marketplace.json
company/PROFILE.md
skills/{lead,feature,fix,launch,audit,client}/SKILL.md
skills/lead/references/project-template.md
skills/{handoff,pipeline,contracts,stack-detect}/SKILL.md
skills/contracts/references/by-product-type.md
skills/{tdd,review,security-check,ui-design,debugging,writing,planning,verify}/SKILL.md
agents/<15 roles>.md
scripts/check.mjs, scripts/check.test.mjs, scripts/fixtures/
tests/pressure/<scenario>.md
README.md
```

---

### Task 1: Scaffold + structure checker

**Files:** Create `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `scripts/check.mjs`, `scripts/check.test.mjs`, `scripts/fixtures/{good,bad}/…`, `.gitignore`

**Interfaces — Produces:** `node scripts/check.mjs [root]` → exit 1 on errors, 0 otherwise; prints `ERROR <file>: <msg>` / `WARN <file>: <msg>`. Exported `check(root) -> {errors: string[], warnings: string[]}`.

- [ ] Step 1: `git init`, plugin.json `{name:"aico", version:"0.1.0", description, author:{name:"McSparrow"}, license:"UNLICENSED"}`; marketplace.json listing plugin `aico` at `./`.
- [ ] Step 2: Write failing tests in `check.test.mjs` against fixtures:
  - good fixture → `errors.length === 0`
  - skill folder `x` with `name: y` → error contains `name mismatch`
  - description 1025 chars → error `description too long`
  - body reference `aico:missing` → error `unknown reference aico:missing`
  - agent of 51 lines → warning `agent 51 > 50 lines`; skill of 126 lines → warning `skill 126 > 125 lines`
  - agent `model: gpt4` → error `invalid model` (allowed: opus, sonnet, haiku, inherit)
- [ ] Step 3: `node --test scripts/` → FAIL.
- [ ] Step 4: Implement `check.mjs` (hand-rolled frontmatter parse: lines between first two `---`, `key: value`). References = regex `aico:([a-z0-9-]+)` across all .md, resolved against skill folder names ∪ agent names.
- [ ] Step 5: `node --test scripts/` → PASS. Commit `chore: scaffold aico plugin and checker`.

### Task 2: Company & project context

**Files:** `company/PROFILE.md`, `skills/lead/references/project-template.md`

- [ ] PROFILE.md (≤ 40 lines): name McSparrow; Voice presets `clear` (friendly, plain, no hype), `bold` (playful, punchy, witty), `technical` (precise, formal); jurisdiction Netherlands/EU, GDPR; default license proprietary (no copyleft deps without CEO approval); architecture rule pointer → `aico:contracts`.
- [ ] project-template.md: fields `product_type: web|desktop`, `engagement: own|client`, `client`, `audience`, `stack` (filled by `aico:stack-detect`), `voice`, `license`, `jurisdiction` (default from profile), `core:` (approved Core list), `modules:`.
- [ ] Commit `docs: company profile and project template`.

### Task 3: Own Practices — handoff, pipeline, contracts, stack-detect

**Interfaces — Produces** (used by every agent and the Lead):
- `aico:handoff` — Handoff file format: frontmatter `step, role, task, status: done|blocked|needs-ceo`; sections `## Did`, `## Decisions`, `## Blocking`, `## Nits`, `## Next`. Rules: read only given Handoffs; no Handoff path → stop with status `blocked`; write exactly one Handoff.
- `aico:pipeline` — how the main session runs Steps: task slug, branch `aico/<slug>` (use `superpowers:using-git-worktrees` if present), dispatch Role subagent with prompt `{input handoffs, output path, project.md, goal}`, commit per Step `aico(<role>): <summary>`, Gates Brief/Plan/Ship via AskUserQuestion, Fix-round counter max 2 then `needs-ceo`, parallel dispatch for independent Roles, no push before Ship Gate. Creates `.company/project.md` from template if missing.
- `aico:contracts` — Core/Module/Contract rules, review blockers list, contract versioning; `references/by-product-type.md`: backend (interfaces/events/ports), frontend (feature modules registering routes/slots, no cross-module imports), desktop (plugin host + extension points); contract tests.
- `aico:stack-detect` — manifest → stack table and installed-skill mapping (go.mod→`golang-*`, package.json+react→`vercel-react-best-practices`/`tanstack-*`, Cargo.toml, composer.json, *.csproj, pyproject.toml → general knowledge); writes `stack:` into project.md; rule for adding a Stack pack.

- [ ] Write the four SKILL.md files (+ by-product-type.md), each ≤ 125 lines, descriptions "Use when…".
- [ ] `node scripts/check.mjs` → 0 errors. Commit `feat: core practices`.

### Task 4: Pointer Practices

| skill | points to | fallback gist |
|---|---|---|
| tdd | `superpowers:test-driven-development`, `mattpocock-skills:tdd` | red→green→refactor; no code without failing test |
| review | `superpowers:requesting-code-review`, `mattpocock-skills:code-review` + `aico:contracts` | spec match, standards, contracts; blocking vs nit |
| security-check | `security-review`, `security-and-hardening`, `auth-implementation-patterns` | OWASP Top 10, secrets, deps audit |
| ui-design | `impeccable`, `frontend-ui-engineering` | hierarchy, a11y WCAG AA, states |
| debugging | `superpowers:systematic-debugging`, `mattpocock-skills:diagnosing-bugs` | reproduce → isolate → root cause → test |
| writing | `humanizer` + Voice preset from PROFILE | plain, specific, no AI tells |
| planning | `superpowers:writing-plans` | tasks with files, interfaces, tests |
| verify | `superpowers:verification-before-completion` | run it, show output, then claim |

- [ ] Write 8 SKILL.md files, each ≤ 20 lines. Checker → 0 errors. Commit `feat: pointer practices`.

### Task 5: Lead + Playbooks

**Interfaces — Consumes:** `aico:pipeline`, `aico:handoff`, agent names from Task 6.
- `lead` — Project Manager persona; classify request → choose Roles & order (routing table by request type), confirm route with CEO at Brief Gate, run via `aico:pipeline`.
- `feature` — product-manager → [Brief] → architect ∥ ui-ux-designer → [Plan] → builders per Module (parallel when Contracts settled) → code-reviewer → qa → security → [Ship] → devops (+ writer for release notes).
- `fix` — qa (reproduce, failing test) → relevant engineer (via `aico:debugging`, `aico:tdd`) → code-reviewer → [Ship].
- `launch` — product-manager brief → marketer ∥ writer ∥ legal (privacy/terms per jurisdiction) → [Ship].
- `audit` — code-reviewer ∥ qa ∥ security ∥ legal (license audit) → Lead merges into `.company/work/<slug>/report.md` prioritized; no Gates except presenting report.
- `client` — account-manager intake → product-manager brief → architect estimate → [Brief] → account-manager proposal; on `client handoff` argument: writer + devops produce handoff package → [Ship].
- [ ] Write 6 SKILL.md (`disable-model-invocation: true`, playbooks ≤ 40 lines). Commit `feat: lead and playbooks` (checker may report unknown agent refs until Task 6 — acceptable mid-plan; must be 0 after Task 6).

### Task 6: 15 Role agents

Template (≤ 50 lines): frontmatter `name, description (when to dispatch), tools, model` per spec table → `# Role` → Mission (2 lines) → Inputs (Handoffs given + project.md sections) → Do (5–8 bullets) → Practices (`aico:x` — when) → Boundaries (what it never does) → Output: one Handoff per `aico:handoff`.
Role-specific musts:
- architect: Core list + Contracts + Module map; ADRs in product `docs/adr/`; flags anything needing CEO.
- all builders: implement only their Module(s) against Contracts; touching Core or a Contract → status `needs-ceo`.
- code-reviewer, security, legal, product-manager, account-manager, architect: never edit source.
- qa: may write tests only; contract tests per Module.
- desktop-engineer: packaging, signing, installers, auto-update for Windows/Linux/macOS.
- legal: GDPR/NL, privacy/terms, license compatibility vs proprietary default.
- writer/marketer: use Voice preset from project.md via `aico:writing`.
- [ ] Write 15 agent files. Checker → 0 errors, list warnings. Commit `feat: role agents`.

### Task 7: Pressure tests (superpowers:writing-skills)

**Files:** `tests/pressure/{01-reviewer-no-edit,02-core-creep,03-missing-handoff,04-fix-round-limit,05-gate-skip,06-token-discipline}.md`
Each file: scenario prompt, pressures applied (time, authority, sunk cost), expected behavior, RED result (subagent without the skill/agent text), GREEN result (with it), loopholes closed.
- [ ] For each scenario: run RED subagent with only the task; record verbatim rationalizations.
- [ ] Run GREEN subagent with the relevant agent/skill text injected; record result.
- [ ] If GREEN fails: tighten the skill (explicit counter to the rationalization), rerun until pass.
- [ ] Checker → 0 errors. Commit `test: pressure tests for discipline skills`.

### Task 8: README + install + final verification

- [ ] README (≤ 60 lines): what, install (`/plugin marketplace add Z:\projects\aicompany` → `/plugin install aico@aico`), entry points, roster table, how to edit PROFILE, how to add a Stack pack.
- [ ] Run `node --test scripts/` and `node scripts/check.mjs` → show output.
- [ ] Commit `docs: readme`.
