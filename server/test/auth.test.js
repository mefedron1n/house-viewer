import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("registration creates a durable account and cookie session", async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "house-auth-test-"));
  process.env.MODEL_STORAGE_DIR = storage;
  process.env.MAX_GLB_UPLOAD_MB = "1";
  const { app } = await import(`../index.js?auth=${Date.now()}`);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const registered = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Анна Смирнова", email: "ANNA@example.com", password: "house2026" }) });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get("set-cookie").split(";")[0];
    assert.match(cookie, /^hr_session=/);
    assert.equal((await registered.json()).user.email, "anna@example.com");
    const stored = JSON.parse(await fs.readFile(path.join(storage, "users.json"), "utf8"));
    assert.match(stored[0].passwordHash, /^scrypt:/);
    assert.equal("password" in stored[0], false);

    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    const createdProjectResponse = await fetch(`${base}/api/projects`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Дом у сосен", area: 128, rooms: 5, theme: "Тёплый" }) });
    assert.equal(createdProjectResponse.status, 201);
    const createdProject = await createdProjectResponse.json();
    assert.match(createdProject.id, /^[a-f0-9]{24}$/);
    const updatedProject = await fetch(`${base}/api/projects/${createdProject.id}`, { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Дом у озера", area: 130, rooms: 6, theme: "Нейтральный" }) });
    assert.equal(updatedProject.status, 200);
    assert.equal((await updatedProject.json()).name, "Дом у озера");
    const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" } }).padEnd(28, " ")), header = Buffer.alloc(20);
    header.write("glTF", 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(48, 8); header.writeUInt32LE(28, 12); header.writeUInt32LE(0x4e4f534a, 16);
    const modelData = new FormData(); modelData.append("model", new Blob([Buffer.concat([header, json])], { type: "model/gltf-binary" }), "model.glb");
    assert.equal((await fetch(`${base}/api/projects/${createdProject.id}/model`, { method: "POST", headers: { Cookie: cookie }, body: modelData })).status, 201);
    assert.equal((await fetch(`${base}/api/projects/${createdProject.id}/model`, { headers: { Cookie: cookie } })).status, 200);
    const oversized = new FormData(); oversized.append("model", new Blob([Buffer.alloc(1024 * 1024 + 1)], { type: "model/gltf-binary" }), "large.glb");
    assert.equal((await fetch(`${base}/api/projects/${createdProject.id}/model`, { method: "POST", headers: { Cookie: cookie }, body: oversized })).status, 413);
    const projects = await fetch(`${base}/api/projects`, { headers: { Cookie: cookie } }).then((response) => response.json());
    assert.equal(projects.length, 1);
    assert.equal("ownerId" in projects[0], false);
    assert.equal((await fetch(`${base}/api/projects/${createdProject.id}`, { headers: { Cookie: "hr_session=invalid" } })).status, 401);
    const expiredToken = "expired-session-token", sessions = JSON.parse(await fs.readFile(path.join(storage, "sessions.json"), "utf8"));
    const { createHash } = await import("node:crypto"); sessions.push({ tokenHash: createHash("sha256").update(expiredToken).digest("hex"), userId: stored[0].id, expiresAt: Date.now() - 1 });
    await fs.writeFile(path.join(storage, "sessions.json"), JSON.stringify(sessions));
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: `hr_session=${expiredToken}` } })).status, 401);
    assert.equal((await fetch(`${base}/api/projects/${createdProject.id}`, { headers: { Cookie: cookie, Origin: "https://evil.example" } })).status, 403);
    const otherResponse = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Иван Петров", email: "ivan@example.com", password: "house2027" }) });
    const otherCookie = otherResponse.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(`${base}/api/projects/${createdProject.id}`, { headers: { Cookie: otherCookie } })).status, 404);
    const duplicate = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Другая Анна", email: "anna@example.com", password: "house2026" }) });
    assert.equal(duplicate.status, 409);
    const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
    assert.equal(logout.status, 204);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "anna@example.com", password: "wrong" }) })).status, 401);
    assert.equal((await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "anna@example.com", password: "house2026" }) })).status, 200);
    const attempts = []; for (let index = 0; index < 9; index++) attempts.push((await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "nobody@example.com", password: "wrong-password-1" }) })).status);
    assert.equal(attempts.includes(429), true);
  } finally {
    server.close();
    await fs.rm(storage, { recursive: true, force: true });
  }
});
