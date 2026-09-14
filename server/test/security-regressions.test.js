import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

test('project ownership, sessions and request defenses', async (t) => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'roomark-security-'));
  process.env.MODEL_STORAGE_DIR = storage;
  process.env.TEMP_DIR = path.join(storage, 'tmp');
  process.env.UPLOAD_PASSWORD = 'security-test-password';
  process.env.LOGIN_RATE_LIMIT_MAX = '6';
  const { app } = await import('../index.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (body, cookie, extra = {}) => ({
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra },
    body: JSON.stringify(body),
  });
  const password = { 'X-Upload-Password': 'security-test-password' };
  const register = async (email) => {
    const response = await fetch(`${base}/api/auth/register`, {
      method: 'POST', ...json({ name: 'Security test', email, password: 'testPass123' }),
    });
    assert.equal(response.status, 201);
    return response.headers.get('set-cookie').split(';')[0];
  };
  try {
    const owner = await register('owner@example.test');
    const stranger = await register('stranger@example.test');
    const created = await fetch(`${base}/api/projects`, {
      method: 'POST', ...json({ name: 'Private room' }, owner),
    });
    assert.equal(created.status, 201);
    const project = await created.json();
    const query = `?project=${project.id}`;
    const noteResponse = await fetch(`${base}/api/notes${query}`, {
      method: 'POST', ...json({ text: 'Private note', coordinateSpace: 'model-world-v1', position: { x: 1, y: 2, z: 3 } }, owner, password),
    });
    assert.equal(noteResponse.status, 201);
    const note = await noteResponse.json();
    const spatialRoot = path.join(storage, 'project-spatial', project.id);
    await fs.mkdir(spatialRoot, { recursive: true });
    await fs.writeFile(path.join(spatialRoot, 'floorplan.png'), 'private fixture');

    await t.test('anonymous and other accounts cannot read or modify private project data', async () => {
      for (const cookie of [null, stranger]) {
        const expected = cookie ? 404 : 401;
        for (const route of [
          `/api/notes${query}`, `/api/project${query}`,
          `/api/project/${project.id}/floorplan/floorplan.png`,
          `/api/projects/${project.id}`, `/api/projects/${project.id}/model`,
        ]) {
          const response = await fetch(base + route, { headers: cookie ? { Cookie: cookie } : {} });
          assert.equal(response.status, expected, route);
        }
        for (const [method, route, body] of [
          ['POST', `/api/notes${query}`, { text: 'Unauthorized' }],
          ['PATCH', `/api/notes/${note.id}${query}`, { status: 'resolved' }],
          ['DELETE', `/api/notes/${note.id}${query}`, {}],
          ['PUT', `/api/project/floorplan-calibration${query}`, { version: 1 }],
          ['POST', `/api/project/floorplan${query}`, {}],
        ]) {
          const response = await fetch(base + route, { method, ...json(body, cookie, password) });
          assert.equal(response.status, expected, `${method} ${route}`);
        }
      }
      const ownNotes = await fetch(`${base}/api/notes${query}`, { headers: { Cookie: owner } });
      assert.equal(ownNotes.status, 200);
      assert.equal((await ownNotes.json())[0].status, 'new');
      assert.equal(ownNotes.headers.get('cache-control'), 'no-store');
      const plan = await fetch(`${base}/api/project/${project.id}/floorplan/floorplan.png`, { headers: { Cookie: owner } });
      assert.equal(plan.status, 200);
      assert.equal(plan.headers.get('cache-control'), 'private, no-store');
    });

    await t.test('ownership is checked before multipart processing', async () => {
      const response = await fetch(`${base}/api/projects/${project.id}/model`, {
        method: 'POST', headers: { Cookie: stranger, 'Content-Type': 'multipart/form-data' }, body: 'invalid multipart',
      });
      assert.equal(response.status, 404);
      await assert.rejects(fs.access(path.join(storage, 'tmp', 'uploads')));
    });

    await t.test('malformed cookies, compressed JSON, invalid scope and foreign origins fail safely', async () => {
      assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: 'roomark_session=%ZZ' } })).status, 401);
      const compressed = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: gzipSync('{}'),
      });
      assert.equal(compressed.status, 415);
      for (const scope of ['project=', 'project[]=bad', 'project=bad']) {
        assert.equal((await fetch(`${base}/api/notes?${scope}`, { headers: { Cookie: owner } })).status, 400);
      }
      const csrf = await fetch(`${base}/api/notes${query}`, {
        method: 'POST', ...json({ text: 'CSRF' }, owner, { ...password, Origin: 'https://attacker.example' }),
      });
      assert.equal(csrf.status, 403);
    });

    await t.test('changing the password revokes every old session and issues a fresh one', async () => {
      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST', ...json({ email: 'owner@example.test', password: 'testPass123' }),
      });
      assert.equal(login.status, 200);
      const otherSession = login.headers.get('set-cookie').split(';')[0];
      const changed = await fetch(`${base}/api/auth/password`, {
        method: 'PATCH', ...json({ currentPassword: 'testPass123', newPassword: 'newPass12345' }, owner),
      });
      assert.equal(changed.status, 204);
      const fresh = changed.headers.get('set-cookie').split(';')[0];
      for (const cookie of [owner, otherSession]) {
        assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })).status, 401);
      }
      assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: fresh } })).status, 200);
    });

    await t.test('upload password guessing is limited across endpoints', async () => {
      for (let i = 0; i < 6; i++) {
        const route = i % 2 ? '/api/notes' : '/api/upload-password/validate';
        const response = await fetch(base + route, { method: 'POST', ...json({ text: 'guess' }, null, { 'X-Upload-Password': 'wrong' }) });
        assert.equal(response.status, 401);
      }
      const limited = await fetch(`${base}/api/upload-password/validate`, { method: 'POST', headers: password });
      assert.equal(limited.status, 429);
      assert.ok(limited.headers.get('retry-after'));
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(storage, { recursive: true, force: true });
  }
});
