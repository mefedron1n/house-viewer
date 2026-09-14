import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('API rate limiting happens before JSON parsing', async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'roomark-rate-'));
  process.env.MODEL_STORAGE_DIR = storage;
  process.env.API_RATE_LIMIT_MAX = '1';
  const { app } = await import('../index.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/notes`)).status, 200);
    const limited = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, 'RATE_LIMITED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(storage, { recursive: true, force: true });
  }
});
