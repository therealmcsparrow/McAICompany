import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const skillPath = path.join(root, 'skills', 'i-have-adhd', 'SKILL.md');
const licensePath = path.join(root, 'skills', 'i-have-adhd', 'LICENSE');

const read = (p) => fs.readFileSync(p, 'utf8');
const skill = () => read(skillPath);
const body = () => {
  const m = skill().match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'SKILL.md has frontmatter between --- lines');
  return { front: m[1], rest: m[2] };
};
const has = (re) => assert.match(skill(), re);

const HELP_LINE =
  '**Help:** argument is exactly `help` or `--help` → read `documentation/commands/i-have-adhd.md` (plugin root = two folders above this skill\'s base directory) and reply with its usage, options, what it does and an example, in the language of `aico:pipeline` §1.6; change nothing, start nothing, and stop.';

const LICENSE_TEXT = `MIT License

Copyright (c) 2026 Ayoub Ghriss

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
const LICENSE_SOURCE =
  'Source: https://github.com/ayghri/i-have-adhd (skills/i-have-adhd/SKILL.md), adapted for aico.';

// Third-party lines, plain data for a not-equal check only.
const UPSTREAM_LINES = [
  'The reader has ADHD. Output is not just brief. It is shaped so an ADHD brain can act on it.',
  'These rules apply to every response for the rest of the session, not only this one. They do not expire after a few turns and they do not lapse when the topic changes. If you are unsure whether they still apply, they do.',
  'Turn them off only when the reader says "stop adhd mode" or "normal mode". Confirm in one line, then return to your default style.',
  'The first line is something the reader can do. Not context. Not a plan. The action.',
  'If the answer is a command, path, or snippet, it goes first. Prose comes after, if at all.',
  'If the work takes more than one step, write a numbered list. Each step is one bounded action. No step contains "and then" twice.',
  'Use the fewest steps that still work. Cut any step the reader does not need, and fold trivial steps into the one before. A short path finished beats a complete path abandoned.',
  'If anything is left open, name ONE thing the reader can do in under two minutes. Even "open the file" counts.',
  'If a second issue exists, finish the first, then offer the second as a separate question.',
  'The reader cannot hold "we are on step 3 of 5" between messages. Restate it.',
  'Vague estimates fail. Ballpark in concrete units.',
  'Show what now works, in concrete terms. Do not bury wins in a recap.',
  'Never use "Uh oh," "Oh no," or "There seems to be a problem." State cause and fix.',
  'Start with the answer. End when the answer is done.',
  'Before sending, delete:',
  'Then verify: if the reader reads only the first line and the last line, do they know (a) what to do next, and (b) what just happened?',
  'Working memory is small. Anything not on screen is forgotten. Do not ask the reader to "keep in mind X."',
];

describe('i-have-adhd skill', () => {
  test('frontmatter: name equals folder, flag, argument-hint, no allowed-tools, no command lines (AC5, cc.M1, cc.M4)', () => {
    const s = skill();
    assert.ok(s.startsWith('---\n'), '--- on line 1');
    const { front } = body();
    assert.match(front, /^name: i-have-adhd$/m);
    assert.match(front, /^description: .+/m);
    assert.match(front, /^disable-model-invocation: true$/m);
    assert.match(front, /^argument-hint: "\[help\]"$/m);
    assert.doesNotMatch(front, /^allowed-tools:/m);
    assert.doesNotMatch(front, /^license:|^metadata:/m);
    assert.doesNotMatch(s, /^!`/m);
    assert.doesNotMatch(s, /\r/);
  });

  test('AC5: a file, Handoff or web page never turns the mode on', () => {
    const t = skill();
    assert.match(t, /(file|Handoff|web page)[^\n]*never[^\n]*(turn|switch)[^\n]*on|never[^\n]*(turn|switch)[^\n]*on[^\n]*(file|Handoff|web page)/i);
    assert.match(t, /file/i);
    assert.match(t, /Handoff/);
    assert.match(t, /web page/i);
  });

  test('title, Help line first (ALWAYS form), no Type line, <=125 lines (proj.M5)', () => {
    const { rest } = body();
    const lines = rest.split('\n');
    const nonEmpty = lines.filter((l) => l.trim() !== '');
    assert.equal(nonEmpty[0], '# ADHD mode');
    assert.equal(nonEmpty[1], HELP_LINE);
    assert.doesNotMatch(skill(), /\*\*Type:\*\*/);
    assert.ok(skill().replace(/\n$/, '').split('\n').length <= 125, 'at most 125 lines');
  });

  test('AC1: next action first, numbered steps, step n of m, one closing next action', () => {
    const t = skill();
    assert.match(t, /first line/i);
    assert.match(t, /next action/i);
    assert.match(t, /numbered/i);
    assert.match(t, /step n of m|step \d+ of \d+/i);
    assert.match(t, /(end|close|closing)[^\n]*(one|ONE)[^\n]*(next )?action|one (concrete )?next action/i);
  });

  test('AC2: persists until switched off, across topic changes', () => {
    const t = skill();
    assert.match(t, /rest of the session|until (it is |you are )?(switched|turned) off|until the CEO/i);
    assert.match(t, /topic/i);
    assert.match(t, /(do not|never|not) (lapse|expire|drop|fade)/i);
  });

  test('AC3: both off phrases, case-insensitive, one confirmation line, then default style', () => {
    const t = skill();
    assert.match(t, /"stop adhd mode"/);
    assert.match(t, /"normal mode"/);
    assert.match(t, /(any|every|ignore|regardless of)[^\n]*(letter )?case/i);
    assert.match(t, /one (confirmation )?line/i);
    assert.match(t, /default style|normal (reply )?style/i);
    assert.match(t, /ADHD mode on — say "stop adhd mode" or "normal mode" to end\./);
  });

  describe('AC4: the 10 rules', () => {
    test('rule 1 lead with the next action', () => assert.match(skill(), /lead with the next action|next action first|first line[^\n]*action/i));
    test('rule 2 number multi-step work', () => assert.match(skill(), /number[^\n]*(multi-step|steps)/i));
    test('rule 3 end with one next action', () => assert.match(skill(), /(end|close)[^\n]*one[^\n]*next action/i));
    test('rule 4 suppress tangents', () => assert.match(skill(), /tangent/i));
    test('rule 5 restate state', () => assert.match(skill(), /restate/i));
    test('rule 6 concrete time estimates', () => assert.match(skill(), /time estimate/i));
    test('rule 7 visible wins', () => assert.match(skill(), /show wins[^\n]*what now works/i));
    test('rule 8 matter-of-fact errors', () => assert.match(skill(), /matter-of-fact/i));
    test('rule 9 at most 5 visible items per group, none dropped', () => {
      const t = skill();
      assert.match(t, /(5|five)[^\n]*(items?)|(items?)[^\n]*(5|five)/i);
      assert.match(t, /(never|not|without)[^\n]*(drop|omit|discard|remove)|keep[^\n]*(all|every|the rest)/i);
    });
    test('rule 10 no preamble, recap or closers', () => {
      const t = skill();
      assert.match(t, /preamble/i);
      assert.match(t, /recap/i);
      assert.match(t, /closer|closing/i);
    });
  });

  test('AC4: the 6 break cases', () => {
    const t = skill();
    assert.match(t, /explain/i);
    assert.match(t, /destructive/i);
    assert.match(t, /confirm/i);
    assert.match(t, /debug spiral/i);
    assert.match(t, /ambigu/i);
    assert.match(t, /task wins/i);
    assert.match(t, /harness wins/i);
  });

  test('AC4: pre-send check', () => {
    const t = skill();
    assert.match(t, /pre-send check/i);
    assert.match(t, /first line[^\n]*last line|last line[^\n]*first line/i);
  });

  test('AC4: rewrite, not verbatim: no line equals a distinctive upstream line', () => {
    assert.ok(UPSTREAM_LINES.length >= 10);
    const mine = new Set(skill().split('\n').map((l) => l.trim()));
    for (const line of UPSTREAM_LINES) {
      assert.ok(!mine.has(line), `line copied verbatim: ${line.slice(0, 50)}`);
    }
  });

  test('AC6: machine-read output stays unchanged', () => {
    const t = skill();
    assert.match(t, /Handoff[^\n]*frontmatter|frontmatter[^\n]*Handoff/i);
    assert.match(t, /Gate/);
    assert.match(t, /ask form/i);
    assert.match(t, /dispatch/i);
    assert.match(t, /AC ID/i);
    assert.match(t, /English[^\n]*key|key[^\n]*English/i);
    assert.match(t, /`Language:`/);
  });

  test('AC6: Gate summaries stay in full (section pin; red until F2)', () => {
    const m = skill().match(/^## Machine-read output stays unchanged[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
    assert.ok(m, 'section "## Machine-read output stays unchanged" exists');
    const s = m[1];
    assert.match(s, /Gate summar/i);
    assert.match(s, /verbatim/i);
    assert.match(s, /`> `/);
    assert.match(s, /pasted block/i);
    assert.match(s, /Nits/);
    for (const w of [/capped/i, /grouped/i, /reordered/i, /cut/i]) assert.match(s, w);
  });

  test('no-storage line: never written to file, Handoff, dispatch, settings, run state or memory', () => {
    const t = skill();
    assert.match(t, /session[- ]only|only for the session|this session/i);
    for (const w of [/memory/i, /settings/i, /Handoff/, /dispatch/i, /run state/i]) assert.match(t, w);
    assert.match(t, /(never|not)[^\n]*(write|store|save|log)/i);
    assert.match(t, /new session[^\n]*normal|normal[^\n]*new session/i);
  });

  test('shape-vs-tone line: own tone and length instructions still apply inside the shape', () => {
    assert.match(skill(), /your own tone and length instructions still apply inside this shape/i);
  });

  test('AC7: LICENSE is the verbatim MIT text plus source line, LF only', () => {
    const buf = fs.readFileSync(licensePath);
    assert.ok(!buf.includes(0x0d), 'no CR byte');
    const want = Buffer.from(`${LICENSE_TEXT}\n${LICENSE_SOURCE}`, 'utf8');
    const got = buf.at(-1) === 0x0a ? buf.subarray(0, -1) : buf;
    assert.deepStrictEqual(got, want);
  });
});
