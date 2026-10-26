# Tool checks bind to rules by ID, never by rule text

A binding in `.company/checks.json` names a check ID and the one rule it proves; Project rules show it with a `check:` tag, while shared packs carry no tag, so one project's binding never fails another's `drift`. Built-in IDs run plugin scripts and project IDs run a fixed argv without a shell. Rule packs come from web research, so their text is never executed or interpolated into a command. Each binding stores a SHA-256 of its rule's text, and the `drift` test fails when the rule changes without the binding.
