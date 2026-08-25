import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("rooms can be edited and deleted with their data", async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "roomark-rooms-test-"));
  process.env.MODEL_STORAGE_DIR = storage;
  process.env.UPLOAD_PASSWORD = "rooms-test";
  const { app } = await import(`../index.js?rooms=${Date.now()}`);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`,
    headers = {
      "Content-Type": "application/json",
      "X-Upload-Password": "rooms-test",
    };
  try {
    const updatedResponse = await fetch(`${base}/api/rooms/kitchen`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        name: "Большая кухня",
        area: 31.5,
        icon: "kitchen",
        description: "Кухня с выходом на террасу",
      }),
    });
    assert.equal(updatedResponse.status, 200);
    const updated = await updatedResponse.json();
    assert.equal(updated.name, "Большая кухня");
    assert.equal(updated.area, 31.5);
    assert.equal(updated.description, "Кухня с выходом на террасу");

    const deletedResponse = await fetch(`${base}/api/rooms/kitchen`, {
      method: "DELETE",
      headers: { "X-Upload-Password": "rooms-test" },
    });
    assert.equal(deletedResponse.status, 204);
    const rooms = await fetch(`${base}/api/rooms`).then((response) => response.json());
    assert.equal(
      rooms.some((room) => room.id === "kitchen"),
      false
    );
    const stored = JSON.parse(await fs.readFile(path.join(storage, "rooms.json"), "utf8"));
    assert.equal(
      stored.some((room) => room.id === "kitchen"),
      false
    );
  } finally {
    server.close();
    await fs.rm(storage, { recursive: true, force: true });
  }
});
