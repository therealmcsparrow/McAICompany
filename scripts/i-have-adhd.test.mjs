import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const licensePath = path.join(root, 'skills', 'i-have-adhd', 'LICENSE');

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

describe('i-have-adhd skill', () => {
  test('AC7: LICENSE is the verbatim MIT text plus source line, LF only', () => {
    const buf = fs.readFileSync(licensePath);
    assert.ok(!buf.includes(0x0d), 'no CR byte');
    const want = Buffer.from(`${LICENSE_TEXT}
${LICENSE_SOURCE}`, 'utf8');
    const got = buf.at(-1) === 0x0a ? buf.subarray(0, -1) : buf;
    assert.deepStrictEqual(got, want);
  });
});
