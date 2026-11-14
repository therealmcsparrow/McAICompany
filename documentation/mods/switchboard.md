# Switchboard

## In short
Switchboard is one pane that lists every mod and guard and lets you switch the savers on or off. It also shows the last refusals from the guards. Open it with `/aico-mods`.

## How it works
1. Type `/aico-mods`. The pane opens beside the chat.
2. Read the rows. Each shows a title, a kind (guard, gate or saver) and a state.
3. Guards and gates show `locked on`. You cannot change them here.
4. To switch a saver, use its row. Expected result: the pane shows the new state after your next turn (press Refresh to see it sooner).
5. Read RECENT DENIES for the newest five refusals of this session: rule ID, kind and time.

## Technical details
- **What it writes.** A saver switch runs `settings.mjs set-mod <id> on|off` and changes the user-level key `mods.<id>.enabled`. There is no second switch file.
- **Project values.** If the project file sets the same key, the switch is refused with `refused: <id> is set in .company/settings.json` on the pane's message line, and the row stays as it was.
- **Rule savers.** A saver that works through a rule, such as the Browser screenshot note (off by default), picks up the change at the next Step dispatch. Pane savers pick it up at your next turn.
- **No row for itself.** Switchboard has no row for Switchboard. If you switch it off, turn it back on in `/aico:settings` (Mods tab, Switchboard unit, Power).
- **First time.** While `mods.switchboard.seen` is `false`, a toast at session start names `/aico-mods`. Opening the pane sets it. It is a user-level key; a project value is ignored.
- **What it costs.** It runs in the Lead session only, makes no model call and no outbound call, and adds no tokens to a prompt.

Back to [Mods](README.md). See also [Guards](../concepts/guards.md).
