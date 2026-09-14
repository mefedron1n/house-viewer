import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const passwordHeader = (value) => `roomark-uri:${encodeURIComponent(value)}`;

test("project document trash removes model and source files", async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "roomark-document-test-"));
  process.env.MODEL_STORAGE_DIR = storage;
  process.env.UPLOAD_PASSWORD = "document-test";
  const { app } = await import(`../index.js?project-documents=${Date.now()}`);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const registered = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Мария", email: "media@example.com", password: "house2026" }),
    });
    const cookie = registered.headers.get("set-cookie").split(";")[0];
    const projectResponse = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Дом", area: 100, rooms: 4 }),
    });
    const project = await projectResponse.json(),
      projects = JSON.parse(await fs.readFile(path.join(storage, "user-projects.json"), "utf8")),
      ownerId = projects.find((item) => item.id === project.id).ownerId,
      directory = path.join(storage, "user-projects", ownerId, project.id);
    await fs.mkdir(directory, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(directory, "model.glb"), "model"),
      fs.writeFile(path.join(directory, "source.ifc"), "source"),
    ]);
    for (const asset of ["model", "source"]) {
      const response = await fetch(`${base}/api/projects/${project.id}/assets/${asset}`, {
        method: "DELETE",
        headers: { Cookie: cookie, "X-Upload-Password": passwordHeader("document-test") },
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).deleted, asset);
    }
    await assert.rejects(fs.access(path.join(directory, "model.glb")));
    await assert.rejects(fs.access(path.join(directory, "source.ifc")));
  } finally {
    server.close();
    await fs.rm(storage, { recursive: true, force: true });
  }
});
