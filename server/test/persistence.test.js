import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("room assets and notes are shared, persisted, and removable", async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "house-viewer-test-"));
  const roomDirectory = path.join(storage, "rooms", "kitchen");
  const renderFilename = "render-0123456789abcdef.png";
  const photoFilename = "photo-fedcba9876543210.jpg";
  await fs.mkdir(roomDirectory, { recursive: true });
  await fs.writeFile(path.join(roomDirectory, renderFilename), "photo");
  await fs.writeFile(path.join(roomDirectory, photoFilename), "photo");
  await fs.writeFile(path.join(roomDirectory, "media.json"), JSON.stringify([{ id: "photo-fedcba9876543210", filename: photoFilename, roomId: "kitchen", type: "construction", date: "2026-07-28", comment: "Установлены шкафы", createdAt: "2026-07-28T12:00:00.000Z" }]));
  process.env.MODEL_STORAGE_DIR = storage;
  process.env.UPLOAD_PASSWORD = "persistence-test";
  const { deleteRoomAsset, readNotes, roomManifest, updateNotes } = await import(`../index.js?test=${Date.now()}`);
  const shared = await roomManifest("kitchen");
  assert.equal(shared.renderUrls.length, 1);
  assert.equal(shared.photos[0].roomId, "kitchen");
  assert.equal(shared.photos[0].type, "construction");
  assert.equal(shared.photos[0].comment, "Установлены шкафы");
  assert.equal(await deleteRoomAsset("kitchen", renderFilename), true);
  assert.deepEqual((await roomManifest("kitchen")).renderUrls, []);
  assert.equal(await deleteRoomAsset("kitchen", photoFilename), true);
  assert.deepEqual((await roomManifest("kitchen")).photos, []);

  const note = { id: "0123456789abcdef01234567", text: "Общая заметка", createdAt: new Date().toISOString() };
  await updateNotes((notes) => [...notes, note]);
  const stored = JSON.parse(await fs.readFile(path.join(storage, "site-notes.json"), "utf8"));
  assert.equal(stored[0].text, "Общая заметка");
  await updateNotes((notes) => notes.filter(({ id }) => id !== note.id));
  assert.deepEqual(await readNotes(), []);
  await fs.rm(storage, { recursive: true, force: true });
});
