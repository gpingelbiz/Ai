import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { metricoolCall, createPost, normalizeScheduled } from '../src/studio-metricool.mjs';

function fakeClaude(t, reply, { exit = 0, hang = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metricool-once-'));
  const bin = path.join(dir, 'claude'), count = path.join(dir, 'count');
  const previous = process.env.REEL_CLAUDE_BIN;
  t.after(() => {
    if (previous === undefined) delete process.env.REEL_CLAUDE_BIN;
    else process.env.REEL_CLAUDE_BIN = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.writeFileSync(bin, `#!${process.execPath}\nconst fs = require('fs');\nfs.appendFileSync(${JSON.stringify(count)}, 'call\\n');\n${hang ? 'setInterval(() => {}, 1000);' : `process.stdout.write(${JSON.stringify(reply)}); process.exit(${exit});`}\n`, { mode: 0o755 });
  process.env.REEL_CLAUDE_BIN = bin;
  return () => fs.readFileSync(count, 'utf8').trim().split('\n').length;
}
for (const tool of ['createScheduledPost', 'updateScheduledPost', 'deleteScheduledPost']) {
  test(`${tool} never redispatches when the reply says the tool is not available`, async t => {
    const calls = fakeClaude(t, JSON.stringify({ error: `Tool ${tool} is not available in this session` }));
    await assert.rejects(metricoolCall('Test', tool, {}, { notReadyWaits: [1, 1] }), e => e.uncertain === true);
    assert.equal(calls(), 1);
  });
}
for (const reply of ['No result', 'null', '{}', '{"success":true}', JSON.stringify({ error: 'Request timed out' })]) {
  test(`create holds an uncertain reply ${reply}`, async t => {
    const calls = fakeClaude(t, reply);
    await assert.rejects(createPost('Test', {}), e => e.uncertain === true);
    assert.equal(calls(), 1);
  });
}
test('an interrupted write process is uncertain and never redispatched', async t => {
  const calls = fakeClaude(t, '', { exit: 1 });
  await assert.rejects(metricoolCall('Test', 'createScheduledPost', {}, { notReadyWaits: [1, 1] }), e => e.uncertain === true);
  assert.equal(calls(), 1);
});
test('a write timeout is uncertain and never redispatched', async t => {
  const calls = fakeClaude(t, '', { hang: true });
  await assert.rejects(metricoolCall('Test', 'createScheduledPost', {}, { timeoutMs: 5000, notReadyWaits: [1, 1] }), e => e.uncertain === true);
  assert.equal(calls(), 1);
});
test('connector snapshots retain identifying markers past the first 80 characters', () => {
  const marker = '[reel:12345678901234567890123456789012]';
  const text = 'Long caption. '.repeat(30) + marker;
  assert.equal(normalizeScheduled({ data: [{ id: 'remote', date: '2031-01-02T10:00', text }] })[0].text, text);
});
