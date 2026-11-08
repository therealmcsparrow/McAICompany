# 0066 Tracker sink is one-way: upsert and close only

Status: proposed (Plan Gate, task 2026-11-08 20.27 - Pocock Large Items). Contract: `docs/contracts/tracker-sink.md`.

The plan file stays the single source of truth (brainstorm Q-1), so `tracker-sink` v1 only receives: issues carry a marker, title, two labels, a plan link and the task hash, never body text or personal data, and nothing is read back. Tracker text can then never steer a Role or an AFK run, and a hand edit is simply overwritten by the next sync, with `stale` marking a task that changed after its issue was made.
