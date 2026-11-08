import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initStudio } from '../src/content-studio.mjs';
import { PKG_ROOT } from '../src/util.mjs';
import { studioSupportCommand } from '../src/studio-cli.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-support-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initStudio(root, { brandFrom: path.join(PKG_ROOT, 'examples/content-studio/brand'), config: { client: 'Example', timezone: 'UTC', metricool: { blogId: '42' } } }); return root;
}
test('support commands pass parsed routine, heartbeat and storage inputs to their owning modules', async t => {
  const root = fixture(t), calls = [];
  const module = Object.fromEntries(['writeRoutineReceipt', 'verifyRoutines', 'heartbeat', 'storageReport'].map(name => [name, (...args) => { calls.push({ name, args }); return { ok: name }; }]));
  const deps = { loadModule: async () => module };
  assert.deepEqual(await studioSupportCommand('routine-receipt', ['{"nonce":"one","tasks":[]}', '--studio', root], deps), { ok: 'writeRoutineReceipt' });
  await studioSupportCommand('verify-routines', ['--studio', root], deps);
  await studioSupportCommand('routine-receipt', ['--verify', '--studio', root], deps);
  for (const action of ['start', 'done', 'fail', 'check']) await studioSupportCommand('heartbeat', [action, 'publish', '--id', 'one', '--run-id', 'run', '--why', 'No result', '--studio', root], deps);
  await studioSupportCommand('storage', ['--studio', root], deps);
  assert.equal(calls[0].args[0].paths.root, root);
  assert.deepEqual(calls[0].args[1], { nonce: 'one', tasks: [] });
  assert.deepEqual(calls[3].args.slice(1), ['start', { lane: 'publish', id: 'one', runId: 'run', why: 'No result' }]);
  assert.equal(calls.at(-1).name, 'storageReport');
});
test('missing modules and exports give a clear pending error; unrelated import failures remain visible', async t => {
  const root = fixture(t), args = ['--studio', root];
  await assert.rejects(studioSupportCommand('storage', args, { loadModule: async () => ({}) }), /storageReport is not available yet/);
  await assert.rejects(studioSupportCommand('heartbeat', ['start', ...args], { loadModule: async () => { throw Object.assign(new Error('missing'), { code: 'ERR_MODULE_NOT_FOUND' }); } }), /heartbeat is not available yet/);
  await assert.rejects(studioSupportCommand('verify-routines', args, { loadModule: async () => { throw new Error('broken module'); } }), /broken module/);
});
