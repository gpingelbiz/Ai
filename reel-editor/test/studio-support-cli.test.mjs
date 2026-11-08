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
test('support commands hand their own arguments, plus the studio folder, to the modules that own them', async t => {
  const root = fixture(t), calls = [];
  const record = (name) => (...args) => { calls.push({ name, args }); return { ok: name }; };
  const modules = {
    './studio-routine.mjs': { routineReceiptCommand: record('routineReceiptCommand'), verifyRoutines: record('verifyRoutines') },
    './heartbeat.mjs': { heartbeatCommand: record('heartbeatCommand') },
    './storage.mjs': { cleanupStorage: record('cleanupStorage'), storageSummary: () => 'summary' },
  };
  const deps = { loadModule: async (file) => modules[file] };
  await studioSupportCommand('routine-receipt', ['--nonce', 'one', '--tasks', '[]', '--studio', root], deps);
  assert.deepEqual(calls[0].args[0], ['--nonce', 'one', '--tasks', '[]', '--studio', root]);
  await studioSupportCommand('verify-routines', ['--studio', root], deps);
  assert.equal(calls[1].args[0], root);
  await studioSupportCommand('heartbeat', ['start', 'reel-publish', '--studio', root], deps);
  assert.deepEqual(calls[2].args[0], ['start', 'reel-publish', '--studio', root]);
  const storage = await studioSupportCommand('storage', ['--yes', '--studio', root], deps);
  assert.deepEqual(calls[3].args[0], { yes: true, studio: root }); assert.equal(storage.summary, 'summary');
});
