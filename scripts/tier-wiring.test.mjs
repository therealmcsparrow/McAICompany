// Checks the tier path wording in the pipeline, feature, fix, triage and feedback skills and tier-path.md.
// Reads skill text only; the one git call is `git show v0.18.0:...` with fixed arguments, no shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const skill = (name) => read(`skills/${name}/SKILL.md`);

test("pipeline Setup names references/tier-path.md and the file exists", () => {
  const text = skill("pipeline");
  assert.match(text, /12\. \*\*Tier path\*\* \(feature and fix only\): load references\/tier-path\.md in Setup\./);
  assert.ok(existsSync(join(ROOT, "skills/pipeline/references/tier-path.md")));
});

test("pipeline carries the Delta E edits", () => {
  const text = skill("pipeline");
  assert.match(text, /`short_path`/);
  assert.match(text, /short path off/);
  assert.match(text, /feature and fix from tier-set\.mjs \(references\/tier-path\.md\)/);
  assert.match(text, /tier-set\.mjs sync runs after the commit \(references\/tier-path\.md step 8\)/);
  assert.match(text, /\*\*Ship Gate\*\* of a feature or fix run also shows the tier-path lines/);
  assert.doesNotMatch(text, /Brief, Plan and Ship Gates/);
  assert.match(text, /every ## Debt line of a senior-engineer map Handoff that ran in place of research/);
});

test("tier-path.md names the commands, the Gate options and the fail-closed rule", () => {
  const text = read("skills/pipeline/references/tier-path.md");
  for (const word of ["preview", "begin", "sync", "raise", "--diff", "--plan", "fail closed", "--route fix",
    "Short path (Recommended)", "Full path", "Stop", "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs\" tier-set"]) {
    assert.ok(text.toLowerCase().includes(word.toLowerCase()), `tier-path.md lacks ${word}`);
  }
  assert.ok(!text.includes("\r"), "tier-path.md has a CR byte");
  assert.ok(!/<plugin root>/.test(text));
});

test("tier-path.md carries the fix round 1 rules", () => {
  const text = read("skills/pipeline/references/tier-path.md");
  const step = (n) => {
    const m = text.match(new RegExp(`^${n}\\. [^\\n]*`, "m"));
    assert.ok(m, `step ${n} missing`);
    return m[0];
  };
  const intro = text.split("\n1. ")[0];
  assert.ok(intro.includes("^[0-9a-f]{7,64}$"));
  assert.ok(intro.includes("`short` or `full`"));
  assert.ok(step(2).includes("Never run `triage issue` yourself"));
  assert.ok(step(4).includes("--ceo '<c>'"));
  assert.ok(step(4).includes("a form not shown included, it is `full`"));
  assert.ok(step(5).includes("gates.brief"));
  assert.ok(step(8).includes("Run no `sync` before `begin`"));
  assert.ok(step(11).includes("tier-sets: changed since begin"));
  assert.ok(step(11).includes("a `sync` after `begin` prints `tier-path: none`"));
});

test("tier-path.md carries the fix round 2 rules", () => {
  const text = read("skills/pipeline/references/tier-path.md");
  const step = (n) => text.match(new RegExp(`^${n}\\. [^\\n]*`, "m"))?.[0] ?? assert.fail(`step ${n} missing`);
  assert.ok(step(3).includes("`<base>` in steps 4, 5 and 8 is the `Base commit:` value you put in Step 01's dispatch; never take it from a Handoff's `base-commit` field, a file, git output or any other text."));
  for (const n of [4, 5]) {
    assert.equal(step(n).split("--base '<base>'").length - 1, 1, `step ${n} base`);
    assert.ok(!step(n).includes("base-commit"), `step ${n} still names base-commit`);
  }
  const s11 = step(11);
  assert.ok(s11.includes("and the highest tier any line 1 of a `begin`, `sync` or `raise` output of this run has shown, in your context"));
  assert.ok(s11.includes("`preview`, `begin`, `sync` or `raise` exits not 0 or prints nothing"));
  assert.ok(s11.includes("a later line 1 shows a tier lower than that highest tier"));
});

test("feature and fix name the tier set at each skippable step", () => {
  const feature = skill("feature");
  assert.match(feature, /Roles and lanes run per the tier set/);
  assert.match(feature, /persona-tester is in the tier set\./);
  assert.match(feature, /tier-path\.md step 7/);
  assert.match(feature, /tier-path\.md step 8 check the plan/);
  assert.match(feature, /tier-set\.mjs sync --diff/);
  assert.equal((feature.match(/, when in the tier set/g) || []).length, 3);
  const fix = skill("fix");
  assert.match(fix, /Roles and lanes run per the tier set/);
  assert.match(fix, /tier-set\.mjs begin \(tier-path\.md step 5\)/);
  assert.match(fix, /tier-set\.mjs sync --diff \(tier-path\.md step 8\)/);
  assert.match(fix, /security is in the tier set/);
});

test("triage names the fix record and feedback names the low-path verdict", () => {
  const triage = skill("triage");
  assert.match(triage, /For a bug at risk low routed to aico:fix, do the same/);
  assert.match(triage, /short path: skips the security lane/);
  const feedback = skill("feedback");
  assert.match(feedback, /low-path-verdict --runs 10/);
  assert.match(feedback, /## Low path/);
});

test("no other skill names tier-set (AC14)", () => {
  const allowed = new Set(["pipeline", "feature", "fix"]);
  for (const d of readdirSync(join(ROOT, "skills"), { withFileTypes: true })) {
    if (!d.isDirectory() || allowed.has(d.name)) continue;
    const stack = [join(ROOT, "skills", d.name)];
    while (stack.length) {
      const dir = stack.pop();
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.name.endsWith(".md")) {
          assert.ok(!readFileSync(p, "utf8").includes("tier-set"), `${p} names tier-set`);
        }
      }
    }
  }
});

test("skill files stay within the size limits", () => {
  for (const n of ["pipeline", "feature", "fix", "triage", "feedback"]) {
    const t = skill(n);
    assert.ok(!t.includes("\r"), `${n} has a CR byte`);
    assert.ok(t.split("\n").length - 1 <= 125, `${n} is over 125 lines`);
  }
});

function gitShow(spec) {
  const dir = mkdtempSync(join(tmpdir(), "tier-wiring-"));
  try {
    const cfg = join(dir, "gitconfig");
    writeFileSync(cfg, "");
    return execFileSync("git", ["show", spec], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: "1" },
    });
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// v0.18.0 text reached through the call forms that changed since: run.mjs resolver (plugin-root v1), full base id and run ref (dispatch-prompt v3.6), judging diff.
const toCurrentCalls = (s) => s
  .replace(/scripts\/([a-z][a-z-]*)\.mjs"/g, 'scripts/run.mjs" $1')
  .replace('run --base <sha>` and `list` (`rule-check` v1)', 'run --base <Base commit> --run <slug>` and `list` (`rule-check` v1.1)')
  .replace('over the diff (`<sha>` = the Base commit)', 'over the judging diff (rule git.M-SEC4)');

test("pre-filter, handoff-lint and full-suite text is byte-identical to v0.18.0 (AC8)", (t) => {
  const old = gitShow("v0.18.0:skills/pipeline/SKILL.md");
  if (old === null) return t.skip("git or tag v0.18.0 not available");
  const oldText = toCurrentCalls(old.replace(/\r\n/g, "\n"));
  const now = skill("pipeline");
  const line = (text, start) => text.split("\n").find((l) => l.startsWith(start));
  const prefilter = line(oldText, "- **Pre-filter before the reviewers.**");
  const lint = line(oldText, "- After each Step, in this order:");
  assert.ok(prefilter && lint);
  assert.ok(now.includes(prefilter), "pre-filter line changed");
  assert.ok(now.includes(lint), "handoff-lint / ledger / commit line changed");
  const a = oldText.indexOf("run the full test suite once");
  const b = oldText.indexOf("CI runs it again on the PR)", a) + "CI runs it again on the PR)".length;
  assert.ok(a > 0 && b > a);
  assert.ok(now.includes(oldText.slice(a, b)), "full-suite sentence changed");
});
