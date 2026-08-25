import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("calibration and world-space pins are isolated by project", async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "roomark-spatial-test-"));
  process.env.MODEL_STORAGE_DIR = storage;
  process.env.UPLOAD_PASSWORD = "spatial-test";
  const { app } = await import(`../index.js?spatial=${Date.now()}`),
    server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`,
    projectA = "aaaaaaaaaaaaaaaaaaaaaaaa",
    projectB = "bbbbbbbbbbbbbbbbbbbbbbbb",
    headers = {
      "Content-Type": "application/json",
      "X-Upload-Password": "spatial-test",
    };
  try {
    const calibration = {
      version: 1,
      matrix: { a: 10, b: 0, c: 4, d: 0, e: -8, f: 3 },
      imagePoints: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }],
      worldPoints: [{ x: 4, z: 3 }, { x: 14, z: 3 }, { x: 4, z: -5 }],
      floorY: 0.2,
    };
    const calibrationResponse = await fetch(
      `${base}/api/project/floorplan-calibration?project=${projectA}`,
      { method: "PUT", headers, body: JSON.stringify(calibration) }
    );
    assert.equal(calibrationResponse.status, 200);
    assert.equal(
      (await fs.stat(path.join(storage, "project-spatial", projectA, "floorplan-calibration.json"))).isFile(),
      true
    );

    const position = { x: 8.5, y: 0.32, z: -1.25 };
    const noteResponse = await fetch(`${base}/api/notes?project=${projectA}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "Проверить стену", position, coordinateSpace: "model-world-v1" }),
    });
    assert.equal(noteResponse.status, 201);
    const note = await noteResponse.json();
    assert.deepEqual(note.position, position);
    assert.equal(note.coordinateSpace, "model-world-v1");
    assert.equal(note.projectId, projectA);
    const resolvedResponse = await fetch(`${base}/api/notes/${note.id}?project=${projectA}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "resolved" }),
    });
    assert.equal(resolvedResponse.status, 200);
    assert.equal((await resolvedResponse.json()).status, "resolved");
    assert.equal((await fetch(`${base}/api/notes?project=${projectA}`).then((r) => r.json())).length, 1);
    assert.equal((await fetch(`${base}/api/notes?project=${projectB}`).then((r) => r.json())).length, 0);
  } finally {
    server.close();
    await fs.rm(storage, { recursive: true, force: true });
  }
});
