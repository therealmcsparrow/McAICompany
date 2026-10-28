// Plan markdown lines: the code-fence and heading reading that plan-check and plan-tasks share.
// Node built-ins only. The text is untrusted: a line over the cap is never matched, and every pattern is anchored.
export const MAX_LINE_CHARS = 4000;

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ *(`+|~+) *$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;

// Splits the text at CRLF, LF or a lone CR and sorts each line:
//   fence   the line that opens a code fence
//   fenced  a line inside a fence, the closing line included
//   heading an ATX heading (level 1-6, title text)
//   long    a line over the cap outside a fence
//   text    anything else
// Returns { lines: [{ no, line, kind, level?, title? }], openFence: { no } | null }.
export function readPlanLines(text) {
  const lines = [];
  let fence = null;
  const raw = String(text).split(/\r\n|\r|\n/);
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    const no = i + 1;
    if (fence) {
      const close = FENCE_CLOSE.exec(line.length <= MAX_LINE_CHARS ? line : '');
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
      lines.push({ no, line, kind: 'fenced' });
      continue;
    }
    if (line.length > MAX_LINE_CHARS) {
      lines.push({ no, line, kind: 'long' });
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = { char: open[1][0], len: open[1].length, no };
      lines.push({ no, line, kind: 'fence' });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      lines.push({ no, line, kind: 'heading', level: heading[1].length, title: heading[2] });
      continue;
    }
    lines.push({ no, line, kind: 'text' });
  }
  return { lines, openFence: fence ? { no: fence.no } : null };
}
