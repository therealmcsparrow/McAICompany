# Contract: plugin-root v1.1

Provider: `scripts/plugin-root.mjs` and `scripts/run.mjs` (Node built-ins only). Consumers: every skill and agent that calls a bundled script, `aico:pipeline` (company profile path).
Rationale: after a plugin update a session can still hold text from the old version; one resolver makes a stale call fail loudly instead of running old code.

## Calls
- Skills and agents write `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" <script> [args]`. `${CLAUDE_PLUGIN_ROOT}` is substituted when the text loads. No skill or agent names another script path. `hooks/hooks.json` keeps its direct paths: Claude Code substitutes the loaded plugin's own root there, so it cannot be stale.
- The plan Gate is typed with the run name in single quotes: `node ${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs run-state gate '<name>' plan passed`, the form the plan Gate mod judges. The old unquoted form with a legacy slug is still judged.
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" plugin-root` prints the active root on one line. Company profile paths are that root plus `company/PROFILE.md`.

## Own root
The parent of `scripts/` from `import.meta.url` (real path). `CLAUDE_PLUGIN_ROOT` from the environment is never read.

## Record
`<os.homedir()>/.claude/plugins/installed_plugins.json`: a regular file (not a link), at most 1 MiB, JSON with `version: 2`. Keys are read with `Object.hasOwn`. `plugins["<plugin>@<marketplace>"]` is an array of entries `{ scope: "user"|"project", projectPath?, installPath, version }`.
- Own root `<home>/.claude/plugins/cache/<marketplace>/<plugin>/<version>`: the key comes from that path, and `<plugin>` must equal `.claude-plugin/plugin.json` `name`.
- Active entry: the `project` entry whose `projectPath` equals the working directory or is its nearest ancestor, else the `user` entry. Paths are compared after `path.resolve`; on win32 also with separators and case folded. Its `installPath` must be an existing directory.
- Stale: own root differs from the active root. The cache folder list and `.orphaned_at` are never used.
- Own root outside the cache (`--plugin-dir`, a checkout, CI): it is the active root and the record is not read. This is not a trust boundary: whoever picks the load path already controls the plugin.

## Refusals
Exit 3, nothing run, one stderr line starting `aico run:`.
- `aico run: stale plugin <own version> active <active version>` (folder names).
- `aico run: plugin record unreadable`: record missing, a link or not a file, over the cap, bad JSON, wrong `version`, no key, no matching entry, `installPath` missing, or plugin name mismatch, while the own root is in the cache.
- Exit 2 `aico run: bad script name` or `unknown script`.

## run.mjs
The script name must match `^[a-z][a-z0-9-]{0,40}$` (and is not `run`), and `<script>.mjs` must appear in a readdir of the own `scripts/` folder; the path is built from the listed entry, never from the input. The child is `spawn(process.execPath, [file, ...args])`, `shell: false`, stdio inherited; its exit code passes through (a signal is 1).

Nothing is written under the plugin root.

## History
- v1: new.
- v1.1 (additive): the plan Gate call quotes the run name, because a work folder name holds spaces.
