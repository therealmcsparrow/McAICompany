import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDescription, summaryDescription } from '../mods/lib/work-folder.mjs';

const HOSTILE = [
  ['U+3164 HANGUL FILLER', 'ㅤ'],
  ['U+034F COMBINING GRAPHEME JOINER', '͏'],
  ['U+115F HANGUL CHOSEONG FILLER', 'ᅟ'],
  ['U+FE0F VARIATION SELECTOR-16', '️'],
  ['U+FFA0 HALFWIDTH HANGUL FILLER', 'ﾠ'],
  ['U+1160 HANGUL JUNGSEONG FILLER', 'ᅠ'],
  ['U+17B4 KHMER VOWEL INHERENT AQ', '឴'],
  ['U+E0100 VARIATION SELECTOR-17', '\u{E0100}'],
];

for (const [label, ch] of HOSTILE) {
  test(`checkDescription refuses ${label} alone`, () => {
    assert.equal(checkDescription(ch), false);
  });
  test(`checkDescription refuses ${label} inside text`, () => {
    assert.equal(checkDescription(`Fix ${ch}login`), false);
  });
  test(`summaryDescription refuses ${label} on read`, () => {
    const out = summaryDescription(`Fix ${ch}login\n\nRun: first fix\n`);
    assert.equal(out.description, undefined);
    assert.ok(out.error);
  });
}

test('checkDescription still accepts plain text', () => {
  assert.equal(checkDescription('Fix login redirect'), true);
});

test('summaryDescription still reads plain text', () => {
  assert.deepEqual(summaryDescription('Fix login\n\nRun: first fix\n'), { description: 'Fix login' });
});
