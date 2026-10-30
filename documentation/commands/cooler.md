# `/aico:cooler`

`/aico:cooler [topic] [turns=N | listen]`

## In short
**What it does.** Colleagues chat at the water cooler about the project — thoughts, ideas, gripes, worries — with nobody running the meeting. It's recorded so you can read what was overheard.

**When to use it.** When you want the company's unprompted take: what's bugging people, what they'd do next, ideas nobody asked for. Use [`/aico:brainstorm`](brainstorm.md) instead when you have an idea you want worked through.

**Help:** `/aico:cooler help` (or `--help`) explains the command without running it.

## How it works
1. 2–3 **random** Roles meet at the cooler. They talk about your topic, or without one, whatever is on their mind about the project.
2. They speak one line at a time, replying to each other. Now and then a random colleague walks up (more likely when the talk is in their field) or someone heads back to their desk; 2–5 are there at once.
3. It ends in one of three ways: **natural** (default — when nobody has anything new to say, or after 20 turns), **`turns=N`** (after N turns), or **`listen`** (every 4 turns you're asked: keep listening, chime in, or stop). No Gates.

## Technical details
**You get.** `.company/cooler/YYYYMMDD-HHMM-topic.md`: an **Overheard** list (ideas, problems, worries and questions, each with who raised it), then the chat written as a movie script: scenes per subject, stage directions for who walks up or leaves, each speaker's name in capitals above their line, ending in FADE OUT. The terminal shows only the file path and who was there. Nothing is built or routed; take anything further with `/aico:brainstorm "<file>"` or [`/aico:lead`](lead.md).

**Personality.** Each colleague talks in its own [personality](../concepts/personalities.md): a temperament, a way of talking, a pet topic, and an intelligence and creativity level.

**Example.** `/aico:cooler` · `/aico:cooler our flaky CI listen` · `/aico:cooler pricing turns=12`
