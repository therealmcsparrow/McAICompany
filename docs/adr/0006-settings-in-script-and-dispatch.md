# Settings resolve in a script and travel in the dispatch

aico's settings (each Role's name, model and effort, the Fix-round limit, dispatch mode, optional lanes and Gates) are resolved by `scripts/settings.mjs` with the precedence project > user > plugin. The script owns all validation and every write; the page and the Lead never edit the files. Pipeline Setup §1.7 runs `settings.mjs get` once per run, and the values reach each Role as Agent-call parameters (`model`, `effort`) plus the `Name:` and `Settings:` dispatch lines (`dispatch-prompt` v3). Agent files are never edited to apply a setting.

Unlocks count only from the user level (`~/.mcsparrow/config.json`): a cloned or client repo must never unlock push, installs or skipping security on this machine. A project can always lock again.

**Consequences**: one resolver to test instead of 32 Roles and many skills; with nothing set, behaviour is identical to before. Handoffs record what was overridden. Must exceptions, Blocking security findings and messages that leave the machine stay CEO asks whatever the settings say. Changing the precedence, the lock rules or the dispatch lines later is a Contract change.
