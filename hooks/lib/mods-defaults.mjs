// The plugin default of every mod switch. scripts/settings.mjs re-exports this table; the hook snapshot reads it here.
export const MODS_DEFAULTS = {
  savvy: { enabled: true, pane: 'auto' },
  cache_tax: { enabled: true, pane: 'command' },
  reflect: { enabled: true, step_check: true, retrospective: true, mode: 'deterministic' },
  efficient_browser_use: { enabled: false },
  switchboard: { enabled: true, seen: false },
  savings: { enabled: true }
};
