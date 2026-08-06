import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("registration creates a durable account and cookie session", async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "house-auth-test-"));
  process.env.MODEL_STORAGE_DIR = storage;
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
    const projects = await fetch(`${base}/api/projects`, { headers: { Cookie: cookie } }).then((response) => response.json());
    assert.equal(projects.length, 1);
    const duplicate = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Другая Анна", email: "anna@example.com", password: "house2026" }) });
    assert.equal(duplicate.status, 409);
    const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
    assert.equal(logout.status, 204);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "anna@example.com", password: "wrong" }) })).status, 401);
    assert.equal((await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "anna@example.com", password: "house2026" }) })).status, 200);
  } finally {
    server.close();
    await fs.rm(storage, { recursive: true, force: true });
  }
});
