# `/aico:client`

`/aico:client intake <client request> | handoff`

## In short
**What it does.** `intake` turns a client request into a brief, estimate and proposal; `handoff` packages finished work for the client.

**When to use it.** Client (agency) work rather than your own products. It sets `engagement: client` and the client's license and jurisdiction in the project profile.

**Help:** `/aico:client help` (or `--help`) explains the command without running it.

## How it works
- **intake:** **Account Manager** gathers goals, constraints, budget and open questions → **Product Manager** writes the brief → **Architect** proposes Core/Modules and an effort estimate. **→ Brief Gate.** Then **Account Manager** writes the proposal in the client's voice. **→ Ship Gate** (before anything goes to the client). Building then runs via [`/aico:feature`](feature.md), which you start.
- **handoff:** **Writer** ∥ **DevOps** produce user/admin docs plus a deployment runbook and credentials checklist (no secrets in files) → **Legal** checks license/IP transfer → **Account Manager** writes the handoff letter. **→ Ship Gate.**

## Technical details
**You get.** A client-ready proposal or handoff package under `.company/work/<slug>/`.

**Example.** `/aico:client intake build an internal booking tool for a dental practice`
