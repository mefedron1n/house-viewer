import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const validRoomId = (id) => typeof id === "string" && /^[A-Za-z0-9_$-]{1,128}$/.test(id);

// Keep project rooms beside their model. The public demo catalog stays separate.
export class ProjectRoomStore {
  constructor(root) {
    this.root = root;
    this.scopes = new Map();
  }

  async get(projectId, ownerId) {
    const key = `${ownerId}/${projectId}`;
    if (!this.scopes.has(key)) {
      const loading = this.load(projectId, ownerId).catch((error) => {
        this.scopes.delete(key);
        throw error;
      });
      this.scopes.set(key, loading);
    }
    return this.scopes.get(key);
  }

  async load(projectId, ownerId) {
    const directory = path.join(this.root, "user-projects", ownerId, projectId);
    const scope = {
      projectId, directory, root: path.join(directory, "room-assets"),
      file: path.join(directory, "room-catalog.json"),
      catalog: new Map(), ids: new Set(), deleted: new Set(), write: Promise.resolve(),
    };
    let metadata = {}, saved = {};
    for (const [filename, assign] of [
      [path.join(directory, "metadata.json"), (value) => { metadata = value; }],
      // The 3D viewer reads /api/projects/:id/metadata, served from project.json.
      // metadata.json remains a fallback for older stored projects.
      [path.join(directory, "project.json"), (value) => { metadata = value; }],
      [scope.file, (value) => { saved = value; }],
    ]) {
      try { assign(JSON.parse(await fs.readFile(filename, "utf8"))); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    for (const room of metadata.rooms || []) {
      if (!validRoomId(room.id)) continue;
      scope.catalog.set(room.id, {
        id: room.id, slug: room.id, name: String(room.name || "Помещение"),
        area: Number(room.area) || 0, type: room.type || "ifc-space", automatic: true,
        storeyId: room.storeyId,
      });
    }
    for (const room of saved.rooms || []) {
      if (validRoomId(room.id)) scope.catalog.set(room.id, room);
    }
    scope.deleted = new Set((saved.deleted || []).filter(validRoomId));
    for (const id of scope.deleted) scope.catalog.delete(id);
    scope.ids = new Set(scope.catalog.keys());
    return scope;
  }

  save(scope) {
    const contents = JSON.stringify({
      version: 1, rooms: [...scope.catalog.values()], deleted: [...scope.deleted],
    }, null, 2);
    const write = scope.write.then(async () => {
      await fs.mkdir(scope.directory, { recursive: true });
      const temporary = `${scope.file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
      await fs.writeFile(temporary, contents, { mode: 0o640 });
      await fs.rename(temporary, scope.file);
    });
    scope.write = write.catch(() => {});
    return write;
  }
}
