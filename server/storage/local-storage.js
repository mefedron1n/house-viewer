import fs from "node:fs/promises";
import path from "node:path";

export class LocalStorage {
  constructor(baseDirectory) { this.baseDirectory = path.resolve(baseDirectory); }
  resolve(key) {
    const target = path.resolve(this.baseDirectory, String(key));
    if (target !== this.baseDirectory && !target.startsWith(`${this.baseDirectory}${path.sep}`)) throw new Error("Invalid storage key");
    return target;
  }
  async save(key, data, options = {}) { const target = this.resolve(key); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, data, options); return key; }
  async get(key) { return fs.readFile(this.resolve(key)); }
  async delete(key, options = {}) { await fs.rm(this.resolve(key), { force: true, ...options }); }
  async exists(key) { try { await fs.access(this.resolve(key)); return true; } catch { return false; } }
  async moveFrom(source, key) { const target = this.resolve(key); await fs.mkdir(path.dirname(target), { recursive: true }); try { await fs.rename(source, target); } catch (error) { if (error.code !== "EXDEV") throw error; await fs.copyFile(source, target); await fs.unlink(source); } return key; }
  path(key) { return this.resolve(key); }
}
