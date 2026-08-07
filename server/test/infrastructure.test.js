import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConversionQueue } from "../conversion-queue.js";
import { LocalStorage } from "../storage/local-storage.js";

test("local storage confines keys to its root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "house-storage-test-")), storage = new LocalStorage(root);
  await storage.save("projects/demo/model.glb", Buffer.from("glTF"));
  assert.equal((await storage.get("projects/demo/model.glb")).toString(), "glTF");
  assert.equal(await storage.exists("projects/demo/model.glb"), true);
  assert.throws(() => storage.path("../outside"), /Invalid storage key/);
  await storage.delete("projects", { recursive: true });
  assert.equal(await storage.exists("projects/demo/model.glb"), false);
  await fs.rm(root, { recursive: true, force: true });
});

test("conversion queue respects its concurrency", async () => {
  let active = 0, peak = 0;
  const queue = new ConversionQueue({ concurrency: 2, worker: async (job) => { job.status = "running"; active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 15)); active--; job.status = "ready"; } });
  for (let index = 0; index < 5; index++) queue.enqueue({ id: String(index), status: "queued" });
  while (queue.running || queue.size) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(peak, 2);
  assert.equal([...queue.jobs.values()].every((job) => job.status === "ready"), true);
});

test("conversion queue rejects overflow and per-owner monopolization", async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const queue = new ConversionQueue({ concurrency: 1, maxQueue: 1, maxPerOwner: 1, worker: async (job) => { job.status = "validating"; await blocked; job.status = "ready"; } });
  queue.enqueue({ id: "running", status: "queued", ownerKey: "owner-a" });
  assert.throws(() => queue.enqueue({ id: "same-owner", status: "queued", ownerKey: "owner-a" }), { code: "OWNER_QUEUE_LIMIT" });
  queue.enqueue({ id: "queued", status: "queued", ownerKey: "owner-b" });
  assert.throws(() => queue.enqueue({ id: "overflow", status: "queued", ownerKey: "owner-c" }), { code: "QUEUE_FULL" });
  release();
  while (queue.running || queue.size) await new Promise((resolve) => setTimeout(resolve, 5));
});
