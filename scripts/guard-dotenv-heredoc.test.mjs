// dotenv.M-SEC1 and heredocs: the shell never glob-expands a heredoc body, so a glob in code
// written through a heredoc names no file. A literal dotenv name in a body still denies, since
// the body may be fed to a shell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { judge } = await import(pathToFileURL(path.resolve(import.meta.dirname, '..', 'hooks', 'rules', 'dotenv.mjs')).href);
const bash = (command) => judge({ tool: { name: 'Bash', command, paths: [] } }).v;
const E = '.' + 'env';

test('a glob inside a quoted heredoc body passes', () => {
  const cmd = "cat > a.mjs <<'EOF'\nconst d = (s.match(/^description:\\s*(.*)$/m) || [])[1];\nEOF\nnode a.mjs";
  assert.equal(bash(cmd), 'allow');
});

test('a glob inside an unquoted and a <<- heredoc body passes', () => {
  assert.equal(bash('cat > a.txt <<EOF\nls .*\nEOF'), 'allow');
  assert.equal(bash('cat > a.txt <<-EOF\n\tls .*\n\tEOF'), 'allow');
});

test('a literal dotenv name inside a heredoc body denies', () => {
  assert.equal(bash(`bash <<'EOF'\ncat ${E}\nEOF`), 'deny');
  assert.equal(bash(`sh <<EOF\ncat dir/${E}.local\nEOF`), 'deny');
});

test('a template name inside a heredoc body passes', () => {
  assert.equal(bash(`cat <<'EOF'\ncp ${E}.example x\nEOF`), 'allow');
});

test('the shell part around a heredoc is still fully checked', () => {
  assert.equal(bash("cat .* <<'EOF'\nhello\nEOF"), 'deny');
  assert.equal(bash(`cat <<'EOF'\nhello\nEOF\ncat ${E}`), 'deny');
});

test('a glob outside any heredoc still denies', () => {
  assert.equal(bash('cat .*'), 'deny');
});

test('an unclosed heredoc still checks its body for literal names', () => {
  assert.equal(bash(`bash <<'EOF'\ncat ${E}`), 'deny');
});

test('a here-string is not a heredoc', () => {
  assert.equal(bash("cat <<< 'x'\ncat .*"), 'deny');
});
