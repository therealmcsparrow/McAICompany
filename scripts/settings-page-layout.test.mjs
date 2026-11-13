import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './settings-server.mjs';

const PAGE = fs.readFileSync(path.join(import.meta.dirname, 'settings-page.html'), 'utf8');
const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));
const BODY = PAGE.slice(PAGE.indexOf('<body'), PAGE.lastIndexOf('<script>'));
const STYLE = PAGE.slice(0, PAGE.indexOf('</style>'));

// The text of one top-level function in the page script, up to the next top-level function.
function fnBody(name) {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(SCRIPT);
  assert.ok(m, `function ${name} exists`);
  const rest = SCRIPT.slice(m.index + 1);
  const next = rest.search(/^(?:async )?function /m);
  return next < 0 ? rest : rest.slice(0, next);
}
const hasClass = (src, cls) => new RegExp(`class(?:Name)?(?:=|:\\s*)\\\\?["']([^"']*\\s)?${cls}(\\s[^"']*)?\\\\?["']`).test(src);
const faceUrls = () => [...STYLE.matchAll(/@font-face\s*\{[^}]*\}/g)].flatMap((m) => [...m[0].matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((x) => x[1]));

test('layout: header has the USER/PROJECT editing-level switch with both config paths', () => {
  assert.ok(/<header[^>]*class="[^"]*\bbridge\b/.test(BODY), 'header.bridge');
  assert.ok(/<fieldset[^>]*class="[^"]*\brocker\b/.test(BODY), 'fieldset.rocker');
  assert.ok(/<legend[^>]*>\s*Editing level/.test(BODY), 'legend Editing level');
  for (const v of ['user', 'project']) {
    assert.ok(new RegExp(`<input[^>]*type="radio"[^>]*name="lvl"[^>]*id="lvl-${v}"[^>]*value="${v}"`).test(BODY), `radio lvl-${v}`);
  }
  assert.ok(BODY.includes('~/.mcsparrow/config.json'), 'User config path shown');
  assert.ok(BODY.includes('.company/settings.json'), 'Project settings path shown');
});

test('layout: status bar has 4 counters and a show toggle', () => {
  assert.ok(/id="lamps"/.test(BODY), '#lamps');
  for (const label of ['Warnings', 'Ignored', 'Held by lock', 'Unlocks']) assert.ok(SCRIPT.includes(`'${label}'`), `counter ${label}`);
  assert.ok(hasClass(SCRIPT, 'lamp'), 'lamp class');
  assert.ok(/<details[^>]*id="annun-details"/.test(BODY), 'show toggle is a details element');
  assert.ok(/<summary>\s*Show warnings and ignored settings/.test(BODY), 'toggle summary');
});

test('layout: the 8 tabs are CH 0n channel tabs in a select bank', () => {
  assert.ok(/CH \$\{String\(i \+ 1\)\.padStart\(2, '0'\)\}/.test(SCRIPT) || /CH 0[1-8]/.test(BODY), 'CH 0n label');
  assert.ok(/select-bank/.test(BODY), 'tablist.select-bank');
  assert.ok(hasClass(SCRIPT + BODY, 'tabdirty'), 'tab dirty lamp');
  for (const t of ['roles', 'skills', 'personality', 'language', 'pipeline', 'gates', 'scan', 'mods']) {
    assert.ok(PAGE.includes(`'${t}'`) || PAGE.includes(`tab-${t}`), `tab ${t}`);
  }
});

test('layout: Roles are channel-strip cards with key-cap models, vertical effort fader, readout and floor LED', () => {
  const src = fnBody('renderRoles') + (SCRIPT.match(/^function roleStrip[\s\S]*?^}/m)?.[0] ?? '');
  for (const c of ['strips', 'strip', 'strip-top', 'strip-mid', 'mbank', 'fader', 'ticks', 'readout', 'floor', 'rid']) {
    assert.ok(hasClass(src, c), `Roles builds .${c}`);
  }
  assert.ok(!/table\(\[/.test(fnBody('renderRoles')), 'no Role table');
  assert.ok(/writing-mode:\s*vertical-lr/.test(STYLE), 'effort fader is vertical');
  assert.ok(/type:\s*'range'/.test(src), 'effort fader is a range input');
  assert.ok(/type:\s*'radio'/.test(src), 'model keys are radio inputs');
  assert.ok(/Protected · floor/.test(src), 'protected-floor LED line');
});

test('layout: Roles keep a slim Apply-to bar, no "at" dropdown, following the level switch', () => {
  const src = fnBody('renderRoles');
  assert.ok(hasClass(src, 'bulk'), 'bulk bar kept');
  assert.ok(src.includes("'Apply to'") && src.includes("'model'") && src.includes("'effort'"), 'Apply to, model, effort');
  assert.ok(!/el\('label', \{\}, 'at'/.test(src), 'no "at" label');
  assert.ok(!/value: 'project', disabled/.test(src), 'no level dropdown inside the bar');
  assert.ok(!/draft\[level\.value\]/.test(src), 'does not read a bar-local level select');
  assert.ok(/draft\[level\]/.test(src), 'applies to the editing-level switch value');
});

test('layout: Skills is a patch bay of jack rows under a filter toolbar', () => {
  const src = fnBody('renderSkills');
  for (const c of ['toolbar', 'bay', 'bay-row', 'jacks', 'jack', 'info']) assert.ok(hasClass(src, c), `Skills builds .${c}`);
});

test('layout: Personality is a list of Role cards with a filter toolbar', () => {
  const src = fnBody('renderPersonality');
  for (const c of ['toolbar', 'pers', 'who', 'gist', 'body']) assert.ok(hasClass(src, c), `Personality builds .${c}`);
});

test('layout: Language and profile is a rack of controls with a profile block', () => {
  const src = fnBody('renderLanguage');
  for (const c of ['rack', 'profile']) assert.ok(hasClass(src, c), `Language builds .${c}`);
});

test('layout: Pipeline is racks of labelled controls with level readouts', () => {
  assert.ok(hasClass(fnBody('renderPipeline'), 'rack'), 'Pipeline builds .rack');
  for (const c of ['ctl', 'ctl-label', 'readout', 'lockcap']) assert.ok(hasClass(SCRIPT, c), `page builds .${c}`);
});

test('layout: Gates are big switches, unlock key barrels and an Ignored list', () => {
  const src = fnBody('renderGates');
  for (const c of ['gates', 'keys', 'keysw', 'barrel', 'kt']) assert.ok(hasClass(src, c), `Gates builds .${c}`);
  assert.ok(src.includes('Unlocks · user level only'), 'Unlocks section heading');
  assert.ok(src.includes('Ignored settings'), 'Ignored settings section heading');
  assert.ok(/'aria-pressed'/.test(src), 'key barrels are toggle buttons');
});

test('layout: Skill scan is one rack', () => {
  assert.ok(hasClass(fnBody('renderScan'), 'rack'), 'Scan builds .rack');
});

test('layout: Mods are rack units with a screw head', () => {
  const src = fnBody('renderMods');
  for (const c of ['units', 'unit', 'unit-h', 'screw', 'rack']) assert.ok(hasClass(src, c), `Mods builds .${c}`);
});

test('layout: footer is the transport bar and keeps its four buttons', () => {
  assert.ok(/<footer[^>]*class="[^"]*\btransport\b/.test(BODY), 'footer.transport');
  for (const id of ['clear-user', 'clear-project', 'save', 'done']) assert.ok(new RegExp(`id="${id}"`).test(BODY), `#${id}`);
});

test('fonts: three @font-face rules point at same-origin woff2 files, no remote URLs', () => {
  const faces = [...STYLE.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]);
  for (const fam of ['Saira Condensed', 'IBM Plex Sans', 'IBM Plex Mono']) {
    assert.ok(faces.some((f) => f.includes(`'${fam}'`) || f.includes(`"${fam}"`)), `@font-face for ${fam}`);
  }
  const urls = faceUrls();
  assert.ok(urls.length >= 3, 'at least one file per family');
  for (const u of urls) {
    assert.ok(u.startsWith('/') && !u.startsWith('//'), `same-origin path: ${u}`);
    assert.ok(/\.woff2$/.test(u), `woff2 file: ${u}`);
  }
  assert.ok(!/https?:\/\//.test(STYLE.replace(/xmlns="[^"]*"/g, '')), 'no remote URL in the page CSS');
});

test('fonts: the server serves each font from the same origin as woff2 without a token, and the CSP stays strict', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-layout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = await startServer({ home: root, cwd: root, pluginRoot: path.join(import.meta.dirname, '..'), open: false, log: () => {} });
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.port}`;
  const page = await fetch(`${origin}/`, { headers: { 'X-Aico-Token': server.token } });
  assert.equal(page.headers.get('content-security-policy'),
    "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  const urls = new Set(faceUrls());
  assert.ok(urls.size >= 3, 'at least one file per family');
  for (const u of urls) {
    const res = await fetch(`${origin}${u}`);
    assert.equal(res.status, 200, `${u} loads without a token header (a stylesheet fetch cannot send one)`);
    assert.equal(res.headers.get('content-type'), 'font/woff2');
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2', `${u} is a woff2 file`);
  }
  assert.equal((await fetch(`${origin}/api/state`)).status, 403, 'API still needs the token');
});
