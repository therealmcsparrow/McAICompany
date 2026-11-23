import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './idea-flow.mjs';

const flow = (cwd, ...a) => main(a, cwd);
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'form-labels-')); tmps.push(d); return d; };

test('pick mapping: a label or Other text is never an allowed pick of the open form (AC6)', () => {
  const c = tmp();
  flow(c, 'start', 's', '--kind', 'idea');
  for (const bad of ['Grill me', 'Other', 'Build', 'F', 'A']) assert.equal(flow(c, 'pick', 's', bad).code, 3, bad);
});
