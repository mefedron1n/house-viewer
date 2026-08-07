import { LocalStorage } from "./local-storage.js";

export function createStorage({ driver = "local", root }) {
  if (driver !== "local") throw new Error(`Unsupported storage driver: ${driver}`);
  return new LocalStorage(root);
}
