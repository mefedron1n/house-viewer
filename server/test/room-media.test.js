import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const passwordHeader = (value) => `roomark-uri:${encodeURIComponent(value)}`;

test("room photo journal accepts, serves and deletes PDF materials", async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "roomark-media-test-"));
  process.env.MODEL_STORAGE_DIR = storage;
  process.env.UPLOAD_PASSWORD = "media-test";
  const { app } = await import(`../index.js?room-media=${Date.now()}`);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const body = new FormData();
    body.append(
      "file",
      new Blob(["%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"], { type: "application/pdf" }),
      "inspection.pdf"
    );
    body.append("comment", "Акт осмотра");
    const uploaded = await fetch(`${base}/api/rooms/kitchen/assets/photo`, {
      method: "POST",
      headers: { "X-Upload-Password": passwordHeader("media-test") },
      body,
    });
    assert.equal(uploaded.status, 201);
    const manifest = await uploaded.json();
    assert.equal(manifest.photos.length, 1);
    assert.equal(manifest.photos[0].mimeType, "application/pdf");
    assert.equal(manifest.photos[0].comment, "Акт осмотра");
    const url = new URL(manifest.photos[0].url, base);
    assert.equal((await fetch(url)).status, 200);
    const filename = decodeURIComponent(url.pathname.split("/").pop());
    const removed = await fetch(`${base}/api/rooms/kitchen/assets/${encodeURIComponent(filename)}`, {
      method: "DELETE",
      headers: { "X-Upload-Password": passwordHeader("media-test") },
    });
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).photos.length, 0);
  } finally {
    server.close();
    await fs.rm(storage, { recursive: true, force: true });
  }
});
