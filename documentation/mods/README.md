# Mods

## In short
Mods are three small add-ons that run inside Claude Code while aico works. They show you what the run is doing, what it costs and what to remember. All three are on after a fresh install.

| Mod | What it does |
|---|---|
| [Savvy](savvy.md) | Shows the progress of the current run. |
| [Cache Tax](cache-tax.md) | Shows what the run spends per Step, and the cache clock. |
| [Reflect](reflect.md) | Looks at each finished Step and suggests what to remember. |

The three share one [status line](status-line.md). To try the plugin from a checkout, see [Test a local copy](local-copy.md).

## How it works
1. You switch each mod on or off, and set its options, on the [`/aico:settings`](../commands/settings.md) page (Mods section).
2. A change takes effect by your next turn: no reinstall, no restart.
3. While a run is going, Savvy and Cache Tax draw panes where they can, and every mod adds its part to the status line.
4. To check that the mods loaded, follow the steps under Technical details.

## Technical details
Mods are three small add-ons that run inside Claude Code while aico works. They show you what the run is doing, what it costs and what to remember. All three are on after a fresh install. You switch each one on or off, and set its options, on the [`/aico:settings`](../commands/settings.md) page (Mods section). A change takes effect by your next turn: no reinstall, no restart.

A mod switched off draws nothing, sets no status part, runs no timer, calls no script and acts on no event. Its options are kept.

Mods add no tokens to any model prompt, except the Reflect `model` mode. The cache clock makes no model call.

### Where mods work

- **Terminal.** Proven on a real terminal (Windows).
- **Desktop app.** Unverified. The mods pass tests that mimic the desktop app, but nobody has run them in the real app. The desktop API documents running scripts as terminal-only, so any value a mod gets from a script shows `unknown` there, and the view still draws.
- **VS Code and mobile.** The views do not draw.

Every state is written in words (`running`, `unknown`, `expired`), never by colour alone. With `NO_COLOR` set, no colour is used.

### Settings

Set these on the `/aico:settings` page, or read one with `node scripts/settings.mjs get mods.<path>`. A wrong value is refused and nothing is written.

| Key | Values | Default |
|---|---|---|
| `mods.savvy.enabled` | `true`, `false` | `true` |
| `mods.savvy.pane` | `auto`, `command` | `auto` |
| `mods.cache_tax.enabled` | `true`, `false` | `true` |
| `mods.cache_tax.pane` | `auto`, `command` | `command` |
| `mods.reflect.enabled` | `true`, `false` | `true` |
| `mods.reflect.step_check` | `true`, `false` | `true` |
| `mods.reflect.retrospective` | `true`, `false` | `true` |
| `mods.reflect.mode` | `deterministic`, `model` | `deterministic` |

There is no keep-warm key. `mods.cache_tax.keep_warm` is refused as unknown.

Aico 0.37.0 removed the commit-gate mod. A leftover key of that mod in a settings file is ignored with one warning and refused on save. The first save from the settings page cleans it out. See the [CHANGELOG](../../CHANGELOG.md).

`pane: auto` opens the pane when a run starts, only where it can dock (see [Savvy](savvy.md)). `command` opens it only when you run its command.

### Locks

One rule keeps a cloned repo from switching on token spend. As with other [locks](../concepts/settings-and-locks.md), only your user settings can unlock.

1. **Reflect `model` is user-level only.** A project file cannot switch on token spend. A project value is ignored and listed.

If a project settings file is broken, Reflect `mode` stays at its plugin default.

### Check that the mods are on

With no run active, the status line shows only the version and the part `aico idle`. Use one of these to check that the mods loaded:

1. Start a session and look for the toast `aico <version> mods ready`. It shows once, at the start.
2. Look at the status line. With no run it shows `v<version> · aico idle`.
3. Run `/aico-cost`. The Cache Tax pane opens; with no run it says "No aico run is active".

If none of these appear, the mods are not loaded. In a folder you have never trusted, Claude Code loads no mods until you accept "Yes, I trust this folder".

### Related

- [Concepts](../concepts/README.md): Gates, Core/Modules/Contracts, settings and locks
- [`../../docs/contracts/aico-mods.md`](../../docs/contracts/aico-mods.md): the full mod specification
