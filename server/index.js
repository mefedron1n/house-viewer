import "dotenv/config";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import cors from "cors";
import multer from "multer";

const root = path.resolve(process.env.MODEL_STORAGE_DIR || "./data/models");
const maxBytes = Number(process.env.MAX_UPLOAD_MB || 200) * 1024 * 1024;
const timeoutMs = Number(process.env.CONVERSION_TIMEOUT_MS || 300000);
const maxConcurrent = Number(process.env.MAX_CONCURRENT_CONVERSIONS || 1);
const ttlMs = Number(process.env.MODEL_TTL_HOURS || 24) * 3600_000;
const uploadPassword = process.env.UPLOAD_PASSWORD || "test123";
const roomRoot = path.join(root, "rooms");
const roomIds = new Set(["kitchen", "bedroom", "bathroom", "hall", "terrace"]);
const jobs = new Map(); let running = 0;
const safeId = (id) => /^[a-f0-9]{32}$/.test(id || "") ? id : null;
const stage = (job, status, text) => Object.assign(job, { status, stage: text });
const ifcHeader = (buffer) => /^ISO-10303-21/i.test(buffer.toString("utf8", 0, Math.min(buffer.length, 4096))) && buffer.includes(Buffer.from("FILE_SCHEMA"));
const typeWhitelist = new Set(["IfcWall", "IfcDoor", "IfcWindow", "IfcSlab", "IfcColumn", "IfcBuildingStorey", "IfcSpace"]);

export function extractMetadata(text) { const elements = {}; const re = /#\d+\s*=\s*(IFCWALL|IFCDOOR|IFCWINDOW|IFCSLAB|IFCCOLUMN|IFCBUILDINGSTOREY|IFCSPACE)\s*\(\s*'([^']*)'\s*,\s*(?:\$|'[^']*')\s*,\s*(?:\$|'([^']*)')/gi; for (const match of text.matchAll(re)) { const type = `Ifc${match[1].slice(3).toLowerCase().replace(/(^|_)([a-z])/g, (_, p, c) => c.toUpperCase())}`; if (typeWhitelist.has(type)) elements[match[2]] = { globalId: match[2], type, name: match[3] || type }; } return { elements, meshGlobalIdMapping: "not-guaranteed-by-IfcConvert" }; }
export function isIfc(buffer) { return ifcHeader(buffer); }
export function validUploadPassword(value) {
  const supplied = Buffer.from(String(value || ""));
  const expected = Buffer.from(uploadPassword);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
async function convert(job) { running++; const dir = path.join(root, job.id), input = path.join(dir, "input.ifc"), output = path.join(dir, "model.glb"), metadata = path.join(dir, "metadata.json"); try { stage(job, "validating", "Проверка IFC"); const source = await fs.readFile(input); if (!ifcHeader(source)) throw new Error("Файл не похож на корректный IFC (не найдена заголовочная структура STEP)."); await fs.writeFile(metadata, JSON.stringify(extractMetadata(source.toString("utf8")), null, 2)); stage(job, "converting", "Создание геометрии"); await new Promise((resolve, reject) => { const child = spawn(process.env.IFC_CONVERT_PATH || "IfcConvert", ["--center-model", input, output], { shell: false, windowsHide: true }); const timer = setTimeout(() => { child.kill(); reject(new Error("Превышено время преобразования IFC.")); }, timeoutMs); child.on("error", (e) => { clearTimeout(timer); reject(e.code === "ENOENT" ? new Error("IfcConvert не найден на сервере.") : e); }); child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("IfcConvert завершился с ошибкой.")); }); }); stage(job, "optimizing", "Подготовка модели"); await fs.rm(input, { force: true }); job.status = "ready"; job.stage = "Модель готова"; job.modelUrl = `/api/models/${job.id}/model.glb`; job.metadataUrl = `/api/models/${job.id}/metadata.json`; } catch (error) { job.status = "failed"; job.stage = "Ошибка преобразования"; job.error = error.message || "Не удалось преобразовать IFC."; } finally { running--; processQueue(); } }
function processQueue() { for (const job of jobs.values()) if (running < maxConcurrent && job.status === "queued") convert(job); }
export const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || false }));
const requireUploadPassword = (req, res, next) => validUploadPassword(req.get("x-upload-password")) ? next() : res.status(401).json({ error: "Неверный пароль для загрузки." });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes }, fileFilter: (_, file, cb) => cb(null, path.extname(file.originalname).toLowerCase() === ".ifc" && (!file.mimetype || /ifc|octet-stream|text\/plain/.test(file.mimetype))) });
app.post("/api/models", requireUploadPassword, upload.single("model"), async (req, res, next) => { try { if (!req.file) return res.status(400).json({ error: "Нужен IFC-файл в поле model." }); if (!ifcHeader(req.file.buffer)) return res.status(400).json({ error: "Файл не похож на корректный IFC." }); const id = crypto.randomBytes(16).toString("hex"), dir = path.join(root, id); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "input.ifc"), req.file.buffer); const job = { id, status: "queued", stage: "Файл принят", createdAt: Date.now() }; jobs.set(id, job); processQueue(); res.status(202).json({ jobId: id, status: "processing" }); } catch (e) { next(e); } });
app.get("/api/models/:jobId/status", (req, res) => { const job = jobs.get(safeId(req.params.jobId)); if (!job) return res.status(404).json({ error: "Задача не найдена." }); const { id, createdAt, ...publicJob } = job; res.json(publicJob); });
for (const [suffix, file, type] of [["model.glb", "model.glb", "model/gltf-binary"], ["metadata.json", "metadata.json", "application/json"]]) app.get(`/api/models/:jobId/${suffix}`, async (req, res) => { const id = safeId(req.params.jobId), job = jobs.get(id); if (!job || job.status !== "ready") return res.status(404).json({ error: "Результат ещё не готов." }); try { res.set({ "Content-Type": type, "Cache-Control": "private, max-age=86400, immutable" }); res.sendFile(file, { root: path.join(root, id) }); } catch { res.status(404).json({ error: "Результат не найден." }); } });

const roomUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes } });
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const imageMime = /^image\/(jpeg|png|webp)$/;
const publicRoomAsset = (room, filename) => `/api/rooms/${room}/assets/${encodeURIComponent(filename)}`;
async function roomManifest(room) {
  const dir = path.join(roomRoot, room);
  const files = await fs.readdir(dir).catch(() => []);
  const floorplan = files.find((name) => name.startsWith("floorplan."));
  const model = files.includes("model.glb") ? "model.glb" : null;
  const renderFiles = files.filter((name) => /^render-[a-f0-9]{16}\.(jpg|jpeg|png|webp)$/.test(name));
  const datedRenders = await Promise.all(renderFiles.map(async (name) => ({ name, modified: (await fs.stat(path.join(dir, name))).mtimeMs })));
  return {
    floorplanUrl: floorplan ? publicRoomAsset(room, floorplan) : null,
    modelUrl: model ? publicRoomAsset(room, model) : null,
    renderUrls: datedRenders.sort((a, b) => a.modified - b.modified || a.name.localeCompare(b.name)).map(({ name }) => publicRoomAsset(room, name))
  };
}
app.get("/api/rooms/:room", async (req, res) => {
  if (!roomIds.has(req.params.room)) return res.status(404).json({ error: "Комната не найдена." });
  res.json(await roomManifest(req.params.room));
});
app.get("/api/rooms/:room/assets/:filename", (req, res) => {
  if (!roomIds.has(req.params.room) || !/^(floorplan\.(jpg|jpeg|png|webp)|model\.glb|render-[a-f0-9]{16}\.(jpg|jpeg|png|webp))$/.test(req.params.filename)) return res.status(404).end();
  res.set("Cache-Control", "public, max-age=3600");
  res.sendFile(req.params.filename, { root: path.join(roomRoot, req.params.room) }, (error) => { if (error && !res.headersSent) res.status(404).end(); });
});
app.post("/api/rooms/:room/assets/:kind", requireUploadPassword, roomUpload.single("file"), async (req, res, next) => {
  try {
    const { room, kind } = req.params;
    if (!roomIds.has(room)) return res.status(404).json({ error: "Комната не найдена." });
    if (!req.file || !["floorplan", "render", "model"].includes(kind)) return res.status(400).json({ error: "Выберите тип материала и файл." });
    const ext = path.extname(req.file.originalname).toLowerCase();
    const isImage = imageExtensions.has(ext) && imageMime.test(req.file.mimetype);
    const isGlb = ext === ".glb" && req.file.buffer.subarray(0, 4).toString("ascii") === "glTF";
    if (kind === "model" ? !isGlb : !isImage) return res.status(400).json({ error: kind === "model" ? "Для модели комнаты нужен корректный файл GLB." : "Для изображения используйте JPG, PNG или WEBP." });
    const dir = path.join(roomRoot, room);
    await fs.mkdir(dir, { recursive: true });
    let filename;
    if (kind === "floorplan") {
      for (const old of await fs.readdir(dir)) if (old.startsWith("floorplan.")) await fs.rm(path.join(dir, old), { force: true });
      filename = `floorplan${ext}`;
    } else if (kind === "model") filename = "model.glb";
    else filename = `render-${crypto.randomBytes(8).toString("hex")}${ext}`;
    await fs.writeFile(path.join(dir, filename), req.file.buffer, { mode: 0o640 });
    res.status(201).json(await roomManifest(room));
  } catch (error) { next(error); }
});
app.get("/health", (_, res) => { const probe = spawnSync(process.env.IFC_CONVERT_PATH || "IfcConvert", ["--help"], { shell: false, timeout: 3000 }); res.json({ ok: true, ifcConvert: !probe.error }); });
app.use((err, _, res, __) => res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Размер файла превышает лимит." : "Некорректный запрос." }));
setInterval(async () => { const now = Date.now(); for (const [id, job] of jobs) if (now - job.createdAt > ttlMs) { jobs.delete(id); await fs.rm(path.join(root, id), { recursive: true, force: true }); } }, 3600_000).unref();
if (process.argv[1]?.endsWith("index.js")) fs.mkdir(roomRoot, { recursive: true }).then(() => app.listen(process.env.PORT || 3001, () => console.log("IFC API started")));
