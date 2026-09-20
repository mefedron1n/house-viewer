import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ProjectRoomStore } from '../project-rooms.js';

test('different IFC projects have independent room catalogs, materials and notes', async (t) => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'roomark-project-rooms-'));
  process.env.MODEL_STORAGE_DIR = storage;
  process.env.TEMP_DIR = path.join(storage, 'tmp');
  process.env.UPLOAD_PASSWORD = 'project-rooms-test';
  const { app } = await import('../index.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const writeHeaders = { 'Content-Type': 'application/json', 'X-Upload-Password': 'project-rooms-test' };
  async function register(email) {
    const response = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ name: 'Test owner', email, password: 'TestPassword123' }),
    });
    assert.equal(response.status, 201);
    return { cookie: response.headers.get('set-cookie').split(';')[0], user: (await response.json()).user };
  }
  const roomId = '3Same$Ifc_Room';
  const roomPath = `/api/rooms/${encodeURIComponent(roomId)}`;
  let owner, stranger, first, second, photoUrl, renderFilename;
  const request = (url, method = 'GET', body, cookie = owner.cookie) => fetch(base + url, {
    method, headers: { ...writeHeaders, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  async function createProject(name) {
    const response = await request('/api/projects', 'POST', { name });
    assert.equal(response.status, 201);
    const project = await response.json();
    const directory = path.join(storage, 'user-projects', owner.user.id, project.id);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'project.json'), JSON.stringify({
      rooms: [{ id: roomId, name: `${name} — комната`, area: 18 }],
    }));
    return project;
  }
  async function upload(project, kind, bytes, filename, mimeType) {
    const body = new FormData();
    body.append('file', new Blob([bytes], { type: mimeType }), filename);
    const response = await fetch(`${base}${roomPath}/assets/${kind}?project=${project.id}`, {
      method: 'POST', body,
      headers: { Cookie: owner.cookie, 'X-Upload-Password': 'project-rooms-test' },
    });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  }
  try {
    owner = await register('room-owner@example.test');
    stranger = await register('room-stranger@example.test');
    first = await createProject('Первый IFC');
    second = await createProject('Второй IFC');

    await t.test('catalogs come from each IFC and exclude demo rooms', async () => {
      for (const project of [first, second]) {
        const response = await request(`/api/rooms?project=${project.id}`);
        assert.equal(response.status, 200);
        const rooms = await response.json();
        assert.equal(rooms.length, 1);
        assert.equal(rooms[0].name, `${project.name} — комната`);
        assert.equal(rooms[0].id, roomId);
        assert.equal(rooms[0].automatic, true);
        const metadata = await (await request(`/api/projects/${project.id}/metadata`)).json();
        assert.deepEqual(rooms.map(room => room.id), metadata.rooms.map(room => room.id));
      }
      assert.ok((await (await request('/api/rooms')).json()).some(room => room.id === 'kitchen'));
    });

    await t.test('room edits and manual rooms persist only within their project', async () => {
      const updated = await request(`${roomPath}?project=${first.id}`, 'PATCH', {
        name: 'Исправленная комната', area: 22, icon: 'bedroom', description: 'Только первый проект',
      });
      assert.equal(updated.status, 200);
      const manual = await request(`/api/rooms?project=${first.id}`, 'POST', { name: 'Кладовая', area: 3 });
      assert.equal(manual.status, 201);
      const reloaded = await new ProjectRoomStore(storage).get(first.id, owner.user.id);
      assert.equal(reloaded.catalog.get(roomId).name, 'Исправленная комната');
      assert.equal(reloaded.catalog.size, 2);
      const other = await (await request(`/api/rooms?project=${second.id}`)).json();
      assert.equal(other.length, 1);
      assert.equal(other[0].name, 'Второй IFC — комната');
    });

    await t.test('PDF, photo, render and room plan URLs retain project scope', async () => {
      const pdf = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n';
      let manifest = await upload(first, 'photo', pdf, 'inspection.pdf', 'application/pdf');
      photoUrl = manifest.photos[0].url;
      const image = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#336699' } }).png().toBuffer();
      await upload(first, 'photo', image, 'photo.png', 'image/png');
      await upload(first, 'render', image, 'render.png', 'image/png');
      manifest = await upload(first, 'floorplan', image, 'plan.png', 'image/png');
      assert.equal(manifest.photos.length, 2);
      assert.equal(manifest.renderUrls.length, 1);
      for (const url of [...manifest.photoUrls, ...manifest.renderUrls, manifest.floorplanUrl]) {
        assert.equal(new URL(url, base).searchParams.get('project'), first.id);
        const response = await request(url);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('cache-control'), /private/);
      }
      renderFilename = new URL(manifest.renderUrls[0], base).pathname.split('/').pop();
      const other = await (await request(`${roomPath}?project=${second.id}`)).json();
      assert.deepEqual(other.photos, []);
      assert.deepEqual(other.renderUrls, []);
      assert.equal(other.floorplanUrl, null);
      assert.equal((await request(photoUrl.replace(first.id, second.id))).status, 404);
      assert.equal((await request(new URL(photoUrl, base).pathname)).status, 404);
    });

    await t.test('room material notes retain IFC IDs and are scoped by project', async () => {
      for (const project of [first, second]) {
        const response = await request(`/api/notes?project=${project.id}`, 'POST', {
          text: project.name, source: 'room-media', roomId,
          coordinateSpace: 'legacy-normalized-v1', position: { x: .5, y: .5, z: .5 },
        });
        assert.equal(response.status, 201);
        assert.equal((await response.json()).roomId, roomId);
      }
    });

    await t.test('ownership checks cover catalog, synchronization, files and mutations', async () => {
      for (const cookie of [null, stranger.cookie]) {
        const expected = cookie ? 404 : 401;
        for (const [method, url, body] of [
          ['GET', `/api/rooms?project=${first.id}`], ['GET', `${roomPath}?project=${first.id}`],
          ['GET', photoUrl], ['POST', `/api/rooms?project=${first.id}`, { name: 'Denied' }],
          ['POST', `/api/rooms/analyzed?project=${first.id}`, { rooms: [] }],
          ['PATCH', `${roomPath}?project=${first.id}`, { name: 'Denied', area: 10 }],
          ['DELETE', `${roomPath}?project=${first.id}`],
          ['DELETE', `${roomPath}/assets/${renderFilename}?project=${first.id}`],
        ]) assert.equal((await request(url, method, body, cookie)).status, expected, `${method} ${url}`);
        const multipart = await fetch(`${base}${roomPath}/assets/photo?project=${first.id}`, {
          method: 'POST', body: 'invalid multipart',
          headers: { 'Content-Type': 'multipart/form-data', ...(cookie ? { Cookie: cookie } : {}) },
        });
        assert.equal(multipart.status, expected);
      }
    });

    await t.test('deleting a room removes only its own assets and notes and survives reanalysis', async () => {
      const removed = await request(`${roomPath}?project=${first.id}`, 'DELETE');
      assert.equal(removed.status, 204);
      const sync = await request(`/api/rooms/analyzed?project=${first.id}`, 'POST', {
        rooms: [{ id: roomId, name: 'Original IFC room', area: 18 }],
      });
      assert.equal(sync.status, 200);
      assert.equal((await sync.json()).some(room => room.id === roomId), false);
      assert.equal((await request(photoUrl)).status, 404);
      const reloaded = await new ProjectRoomStore(storage).get(first.id, owner.user.id);
      assert.equal(reloaded.catalog.has(roomId), false);
      assert.equal(reloaded.catalog.size, 1, 'the manual room remains');
      assert.deepEqual(await (await request(`/api/notes?project=${first.id}`)).json(), []);
      assert.equal((await (await request(`/api/notes?project=${second.id}`)).json()).length, 1);
      assert.equal((await request(`${roomPath}?project=${second.id}`)).status, 200);
    });

    await t.test('geometry fallback catalogs reject unsafe IDs and preserve saved edits', async () => {
      for (const id of ['../outside', 'a/b', '', 'x'.repeat(129)]) {
        assert.equal((await request(`/api/rooms/analyzed?project=${second.id}`, 'POST', {
          rooms: [{ id, name: 'Bad room', area: 2 }],
        })).status, 400);
      }
      const synced = await request(`/api/rooms/analyzed?project=${second.id}`, 'POST', {
        rooms: [{ id: 'room_001', name: 'Геометрическая комната', area: 9 }],
      });
      assert.equal(synced.status, 200);
      assert.equal((await synced.json()).length, 2);
      assert.equal((await request('/api/rooms?project=')).status, 400);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(storage, { recursive: true, force: true });
  }
});
