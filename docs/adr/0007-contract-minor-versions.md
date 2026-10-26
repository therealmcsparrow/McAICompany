# Additive Contract changes bump a minor version

From 0.11 an additive Contract change bumps the minor version (`dispatch-prompt` v3 → v3.1, `aico-settings` v1 → v1.1, `handoff` v1.0 → v1.1), as `aico:contracts` says; a breaking change bumps the major version and needs the CEO. The earlier additive integer bumps (`dispatch-prompt` v2 and v3) stay as history. A stored data version (such as `aico_settings.version`) changes only when the stored shape breaks.
