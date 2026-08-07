import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import cors from "cors";
import multer from "multer";
import helmet from "helmet";
import { promisify } from "node:util";
import { ConversionQueue } from "./conversion-queue.js";
import { createStorage } from "./storage/index.js";
import { config } from "./config.js";
import { normalizeImage, validateGlbFile, validateIfcFile } from "./file-validation.js";

const { nodeEnv, isProduction } = config;
const root = config.storageRoot;
const tempRoot = config.tempRoot;
const storageDriver = config.storageDriver;
const storage = createStorage({ driver: storageDriver, root });
const timeoutMs = config.conversionTimeoutMs;
const maxConcurrent = config.maxConcurrentConversions;
const ttlMs = config.modelTtlMs;
const uploadPassword = config.uploadPassword;
const log = (level, event, fields = {}) => { const entry = { time: new Date().toISOString(), level, event, ...fields }; (level === "error" ? console.error : console.log)(JSON.stringify(entry)); };
const roomRoot = path.join(root, "rooms");
const notesFile = path.join(root, "site-notes.json");
const roomsFile = path.join(root, "rooms.json");
const usersFile = path.join(root, "users.json");
const sessionsFile = path.join(root, "sessions.json");
const userProjectsFile = path.join(root, "user-projects.json");
const projectRoot = path.join(root, "project");
const defaultRooms = [
  { id: "kitchen", slug: "kitchen", name: "Кухня-гостиная", area: 28.4 }, { id: "bedroom", slug: "bedroom", name: "Спальня", area: 16.2 },
  { id: "bathroom", slug: "bathroom", name: "Санузел", area: 6.8 }, { id: "hall", slug: "hallway", name: "Прихожая", area: 10.5 }, { id: "terrace", slug: "balcony", name: "Балкон / терраса", area: 14.1 }
];
const plainLabel = (value, max = 80) => String(value || "").trim().replace(/[<>"'&\u0000-\u001f]/g, "").slice(0, max);
const roomCatalog = new Map(defaultRooms.map((room) => [room.id, room]));
try { const savedRooms = JSON.parse(await fs.readFile(roomsFile, "utf8")); if (Array.isArray(savedRooms)) savedRooms.forEach((room) => room?.id && room?.slug && roomCatalog.set(room.id, { ...room, name: plainLabel(room.name, 60) })); } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
const roomIds = new Set(roomCatalog.keys());
const activeChildren = new Set();
const safeId = (id) => /^[a-f0-9]{32}$/.test(id || "") ? id : null;
const stage = (job, status, text) => Object.assign(job, { status, stage: text });
const ifcHeader = (buffer) => /^ISO-10303-21/i.test(buffer.toString("utf8", 0, Math.min(buffer.length, 4096))) && buffer.includes(Buffer.from("FILE_SCHEMA"));
const typeWhitelist = new Set(["IfcWall", "IfcDoor", "IfcWindow", "IfcSlab", "IfcColumn", "IfcBuildingStorey", "IfcSpace"]);

export function extractMetadata(text) { const elements = {}; const re = /#\d+\s*=\s*(IFCWALL|IFCDOOR|IFCWINDOW|IFCSLAB|IFCCOLUMN|IFCBUILDINGSTOREY|IFCSPACE)\s*\(\s*'([^']*)'\s*,\s*(?:\$|'[^']*')\s*,\s*(?:\$|'([^']*)')/gi; for (const match of text.matchAll(re)) { const type = `Ifc${match[1].slice(3).toLowerCase().replace(/(^|_)([a-z])/g, (_, p, c) => c.toUpperCase())}`; if (typeWhitelist.has(type)) elements[match[2]] = { globalId: match[2], type, name: match[3] || type }; } return { elements, meshGlobalIdMapping: "not-guaranteed-by-IfcConvert" }; }
export function isIfc(buffer) { return ifcHeader(buffer); }
export function validUploadPassword(value) {
  if (!uploadPassword) return false;
  const supplied = Buffer.from(String(value || ""));
  const expected = Buffer.from(uploadPassword);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
async function convert(job) {
  const startedAt = Date.now(), directory = path.join(tempRoot, job.id), input = path.join(directory, "input.ifc"), output = path.join(directory, "model.glb");
  log("info", "conversion_started", { jobId: job.id, bytes: job.size, queueSize: conversionQueue.size });
  try {
    stage(job, "validating", "Проверка IFC");
    if (!await validateIfcFile(input)) throw Object.assign(new Error("Файл не похож на корректный IFC."), { code: "INVALID_IFC" });
    const metadataHandle = await fs.open(input, "r"), metadataBuffer = Buffer.alloc(Math.min(job.size, 8 * 1024 * 1024));
    try { await metadataHandle.read(metadataBuffer, 0, metadataBuffer.length, 0); } finally { await metadataHandle.close(); }
    await storage.save(`${job.id}/metadata.json`, JSON.stringify(extractMetadata(metadataBuffer.toString("utf8")), null, 2), { mode: 0o640 });
    stage(job, "converting", "Создание геометрии");
    await new Promise((resolve, reject) => {
      const child = spawn(config.ifcConvertPath, ["--center-model", input, output], { shell: false, windowsHide: true });
      activeChildren.add(child); let stderr = "", settled = false, timedOut = false, killTimer;
      child.stderr?.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
      const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); activeChildren.delete(child); error ? reject(error) : resolve(); };
      const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); killTimer = setTimeout(() => child.kill("SIGKILL"), 3000); killTimer.unref(); }, timeoutMs);
      child.on("error", (error) => finish(Object.assign(new Error(error.code === "ENOENT" ? "IfcConvert не найден на сервере." : "Не удалось запустить IfcConvert."), { code: "CONVERTER_START_FAILED" })));
      child.on("close", (code) => finish(timedOut ? Object.assign(new Error("Превышено время преобразования IFC."), { code: "CONVERSION_TIMEOUT" }) : code === 0 ? null : Object.assign(new Error("IfcConvert завершился с ошибкой."), { code: "CONVERSION_FAILED", converterExitCode: code, stderr: stderr.slice(-500) })));
    });
    stage(job, "optimizing", "Подготовка модели");
    await storage.moveFrom(output, `${job.id}/model.glb`);
    Object.assign(job, { status: "ready", stage: "Модель готова", modelUrl: `/api/models/${job.id}/model.glb`, metadataUrl: `/api/models/${job.id}/metadata.json` });
    log("info", "conversion_completed", { jobId: job.id, durationMs: Date.now() - startedAt });
  } catch (error) {
    Object.assign(job, { status: "failed", stage: "Ошибка преобразования", error: error.code === "CONVERSION_TIMEOUT" ? "Превышено время преобразования IFC." : "Не удалось преобразовать IFC." });
    log("error", "conversion_failed", { jobId: job.id, code: error.code || "CONVERSION_FAILED", durationMs: Date.now() - startedAt, converterExitCode: error.converterExitCode });
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch((error) => log("error", "temp_cleanup_failed", { jobId: job.id, code: error.code }));
  }
}
const conversionQueue = new ConversionQueue({ concurrency: maxConcurrent, maxQueue: config.maxConversionQueue, maxPerOwner: config.maxUserConversionJobs, worker: convert, onStateChange: (queue) => log("info", "queue_state", { running: queue.running, queued: queue.size }) });
const jobs = conversionQueue.jobs;
export const app = express();
const trustProxyHops = config.trustProxyHops;
if (trustProxyHops) app.set("trust proxy", trustProxyHops);
const localOrigins = [
  "http://localhost:8000", "http://127.0.0.1:8000",
  "http://localhost:8080", "http://127.0.0.1:8080"
];
const allowedOrigins = new Set([...config.allowedOrigins, ...(isProduction ? [] : localOrigins)]);
const allowedHosts = new Set([...config.allowedHosts, ...config.allowedOrigins.map((origin) => new URL(origin).host.toLowerCase()), ...(isProduction ? [] : ["localhost", "127.0.0.1", "localhost:3001", "127.0.0.1:3001", "localhost:8080", "127.0.0.1:8080"])]);
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] } }, crossOriginResourcePolicy: { policy: "same-site" }, strictTransportSecurity: isProduction ? { maxAge: 31536000, includeSubDomains: true } : false, referrerPolicy: { policy: "no-referrer" } }));
app.use((_, res, next) => { res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()"); next(); });
app.use((req, res, next) => { req.id = crypto.randomUUID(); res.set("X-Request-Id", req.id); next(); });
app.use((req, res, next) => { const host = String(req.get("host") || "").toLowerCase(); if (allowedHosts.has(host) || (!isProduction && /^(localhost|127\.0\.0\.1):\d+$/.test(host))) return next(); res.status(421).json({ error: "Недопустимый Host.", code: "HOST_DENIED", requestId: req.id }); });
app.use(cors({ origin(origin, callback) { if (!origin || allowedOrigins.has(origin)) return callback(null, true); callback(Object.assign(new Error("Origin is not allowed"), { status: 403, code: "ORIGIN_DENIED" })); }, credentials: true, methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"] }));
app.use(express.json({ limit: config.jsonLimit }));
app.use(express.urlencoded({ extended: false, limit: config.jsonLimit }));
app.use((req, res, next) => { if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || !req.headers.cookie) return next(); const origin = req.get("origin"); if ((origin && allowedOrigins.has(origin)) || (!origin && !isProduction)) return next(); res.status(403).json({ error: "Запрос отклонён проверкой источника.", code: "CSRF_ORIGIN_DENIED", requestId: req.id }); });
export function rateLimit({ windowMs, max, key = (req) => req.ip || req.socket.remoteAddress || "unknown", message = "Слишком много запросов. Попробуйте позже." }) {
  const clients = new Map();
  const cleanup = setInterval(() => { const now = Date.now(); for (const [key, value] of clients) if (value.resetAt <= now) clients.delete(key); }, Math.max(windowMs, 60_000)); cleanup.unref();
  return (req, res, next) => { const clientKey = key(req), now = Date.now(), current = clients.get(clientKey); if (!current || current.resetAt <= now) { clients.set(clientKey, { count: 1, resetAt: now + windowMs }); return next(); } current.count++; res.set("RateLimit-Limit", String(max)); res.set("RateLimit-Remaining", String(Math.max(0, max - current.count))); res.set("RateLimit-Reset", String(Math.ceil(current.resetAt / 1000))); if (current.count > max) return res.status(429).json({ error: message, code: "RATE_LIMITED", requestId: req.id }); next(); };
}
const conversionRateLimit = rateLimit({ ...config.conversionRate, message: "Слишком много конвертаций. Попробуйте позже." });
const loginRateLimit = rateLimit({ ...config.loginRate, message: "Слишком много попыток входа. Попробуйте позже." });
const registerRateLimit = rateLimit({ ...config.registerRate, message: "Слишком много регистраций. Попробуйте позже." });

const scrypt = promisify(crypto.scrypt);
const sessionMaxAge = config.sessionMaxAgeMs;
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const publicUser = ({ id, name, email, createdAt }) => ({ id, name, email, createdAt });
const publicProject = ({ ownerId: _, ...project }) => project;
async function readJsonArray(file) { try { const value = JSON.parse(await fs.readFile(file, "utf8")); return Array.isArray(value) ? value : []; } catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return []; throw error; } }
async function writeJsonArray(file, value) { await fs.mkdir(root, { recursive: true }); const temporary = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`; await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); await fs.rename(temporary, file); }
let authWrite = Promise.resolve();
function updateAuth(operation) { const result = authWrite.then(operation); authWrite = result.catch(() => {}); return result; }
async function hashPassword(password) { const salt = crypto.randomBytes(16); const derived = await scrypt(password, salt, 64); return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`; }
async function verifyPassword(password, stored) { const [, saltHex, hashHex] = String(stored).split(":"); if (!saltHex || !hashHex) return false; const expected = Buffer.from(hashHex, "hex"), actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length); return actual.length === expected.length && crypto.timingSafeEqual(actual, expected); }
function cookies(req) { return Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key]) => key).map(([key, value]) => [key, decodeURIComponent(value || "")])); }
function cookiePolicy() { return isProduction ? "SameSite=None; Secure" : "SameSite=Lax"; }
function setSessionCookie(res, token) { res.setHeader("Set-Cookie", `hr_session=${encodeURIComponent(token)}; HttpOnly; Path=/; ${cookiePolicy()}; Max-Age=${sessionMaxAge / 1000}`); }
function clearSessionCookie(res) { res.setHeader("Set-Cookie", `hr_session=; HttpOnly; Path=/; ${cookiePolicy()}; Max-Age=0`); }
async function createSession(userId, res) { const token = crypto.randomBytes(32).toString("hex"), tokenHash = crypto.createHash("sha256").update(token).digest("hex"), expiresAt = Date.now() + sessionMaxAge; await updateAuth(async () => { const sessions = (await readJsonArray(sessionsFile)).filter((item) => item.expiresAt > Date.now()); sessions.push({ tokenHash, userId, expiresAt }); await writeJsonArray(sessionsFile, sessions); }); setSessionCookie(res, token); }
async function currentUser(req) { const token = cookies(req).hr_session; if (!token) return null; const tokenHash = crypto.createHash("sha256").update(token).digest("hex"), sessions = await readJsonArray(sessionsFile), session = sessions.find((item) => item.tokenHash.length === tokenHash.length && crypto.timingSafeEqual(Buffer.from(item.tokenHash), Buffer.from(tokenHash)) && item.expiresAt > Date.now()); if (!session) return null; return (await readJsonArray(usersFile)).find((user) => user.id === session.userId) || null; }
async function requireUser(req, res, next) { try { const user = await currentUser(req); if (!user) return res.status(401).json({ error: "Требуется вход." }); req.user = user; next(); } catch (error) { next(error); } }

app.post("/api/auth/register", registerRateLimit, async (req, res, next) => { try { const name = String(req.body.name || "").trim().replace(/\s+/g, " "), email = normalizeEmail(req.body.email), password = String(req.body.password || ""); if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Укажите имя длиной от 2 до 80 символов." }); if (!validEmail(email)) return res.status(400).json({ error: "Укажите корректный адрес электронной почты." }); if (password.length < 8 || password.length > 128 || !/[a-zа-яё]/i.test(password) || !/\d/.test(password)) return res.status(400).json({ error: "Пароль должен содержать не менее 8 символов, букву и цифру." }); let user; await updateAuth(async () => { const users = await readJsonArray(usersFile); if (users.some((item) => item.email === email)) { const error = new Error("EMAIL_EXISTS"); error.status = 409; throw error; } user = { id: crypto.randomBytes(16).toString("hex"), name, email, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() }; users.push(user); await writeJsonArray(usersFile, users); }); await createSession(user.id, res); res.status(201).json({ user: publicUser(user) }); } catch (error) { if (error.message === "EMAIL_EXISTS") return res.status(409).json({ error: "Аккаунт с такой почтой уже существует." }); next(error); } });
app.post("/api/auth/login", loginRateLimit, async (req, res, next) => { try { const email = normalizeEmail(req.body.email), password = String(req.body.password || ""), user = (await readJsonArray(usersFile)).find((item) => item.email === email); const valid = user ? await verifyPassword(password, user.passwordHash) : (await scrypt(password || "invalid-password", Buffer.alloc(16), 64), false); if (!valid) return res.status(401).json({ error: "Неверная почта или пароль." }); await createSession(user.id, res); res.json({ user: publicUser(user) }); } catch (error) { next(error); } });
app.get("/api/auth/me", async (req, res, next) => { try { const user = await currentUser(req); if (!user) return res.status(401).json({ error: "Требуется вход." }); res.set("Cache-Control", "no-store").json({ user: publicUser(user) }); } catch (error) { next(error); } });
app.post("/api/auth/logout", async (req, res, next) => { try { const token = cookies(req).hr_session; if (token) { const tokenHash = crypto.createHash("sha256").update(token).digest("hex"); await updateAuth(async () => writeJsonArray(sessionsFile, (await readJsonArray(sessionsFile)).filter((item) => item.tokenHash !== tokenHash))); } clearSessionCookie(res); res.status(204).end(); } catch (error) { next(error); } });

let projectsWrite = Promise.resolve();
function updateUserProjects(operation) { const result = projectsWrite.then(async () => { const projects = await readJsonArray(userProjectsFile); const updated = await operation(projects); await writeJsonArray(userProjectsFile, updated); return updated; }); projectsWrite = result.catch(() => {}); return result; }
const cleanProjectFields = (body) => ({ name: String(body.name || "").trim().slice(0, 100), area: Math.max(0, Math.min(100000, Number(body.area) || 0)), rooms: Math.max(1, Math.min(1000, Math.trunc(Number(body.rooms) || 1))), theme: ["Тёплый", "Ночной", "Нейтральный"].includes(body.theme) ? body.theme : "Тёплый" });
app.get("/api/projects", requireUser, async (req, res, next) => { try { res.set("Cache-Control", "no-store").json((await readJsonArray(userProjectsFile)).filter((project) => project.ownerId === req.user.id).map(publicProject)); } catch (error) { next(error); } });
app.post("/api/projects", requireUser, async (req, res, next) => { try { const fields = cleanProjectFields(req.body); if (fields.name.length < 2) return res.status(400).json({ error: "Название проекта должно содержать не менее 2 символов." }); const project = { id: crypto.randomBytes(12).toString("hex"), ownerId: req.user.id, ...fields, status: "Черновик", modelUrl: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; await updateUserProjects((projects) => [...projects, project]); res.status(201).json(publicProject(project)); } catch (error) { next(error); } });
app.get("/api/projects/:id", requireUser, async (req, res, next) => { try { const project = (await readJsonArray(userProjectsFile)).find((item) => item.id === req.params.id && item.ownerId === req.user.id); if (!project) return res.status(404).json({ error: "Проект не найден." }); res.set("Cache-Control", "no-store").json(publicProject(project)); } catch (error) { next(error); } });
app.patch("/api/projects/:id", requireUser, async (req, res, next) => { try { const fields = cleanProjectFields(req.body); if (fields.name.length < 2) return res.status(400).json({ error: "Название проекта должно содержать не менее 2 символов." }); let updated; await updateUserProjects((projects) => projects.map((project) => project.id === req.params.id && project.ownerId === req.user.id ? (updated = { ...project, ...fields, updatedAt: new Date().toISOString() }) : project)); if (!updated) return res.status(404).json({ error: "Проект не найден." }); res.json(publicProject(updated)); } catch (error) { next(error); } });
const requireUploadPassword = (req, res, next) => validUploadPassword(req.get("x-upload-password")) ? next() : res.status(401).json({ error: "Неверный пароль для загрузки." });
const uploadRoot = path.join(tempRoot, "uploads");
const diskStorage = multer.diskStorage({ destination: (_, __, callback) => fs.mkdir(uploadRoot, { recursive: true }).then(() => callback(null, uploadRoot), callback), filename: (_, __, callback) => callback(null, crypto.randomBytes(24).toString("hex")) });
const diskUpload = (maxBytes) => multer({ storage: diskStorage, limits: { fileSize: maxBytes, files: 1, fields: 10, parts: 12 } });
const ifcUpload = diskUpload(config.maxIfcBytes), glbUpload = diskUpload(config.maxGlbBytes), imageUpload = diskUpload(config.maxImageBytes);
const unlinkUpload = (file) => file?.path ? fs.rm(file.path, { force: true }) : Promise.resolve();
app.post("/api/models", conversionRateLimit, requireUploadPassword, ifcUpload.single("model"), async (req, res, next) => { let accepted = false; try { if (!conversionQueue.accepting) return res.status(503).json({ error: "Сервис завершает работу.", code: "SHUTTING_DOWN" }); if (!req.file || path.extname(req.file.originalname).toLowerCase() !== ".ifc") return res.status(400).json({ error: "Нужен IFC-файл в поле model.", code: "IFC_FILE_REQUIRED" }); if (!await validateIfcFile(req.file.path)) return res.status(400).json({ error: "Файл не похож на корректный IFC.", code: "INVALID_IFC" }); const id = crypto.randomBytes(16).toString("hex"), directory = path.join(tempRoot, id), input = path.join(directory, "input.ifc"); await fs.mkdir(directory, { recursive: true }); await fs.rename(req.file.path, input); accepted = true; const job = { id, status: "queued", stage: "Файл принят", createdAt: Date.now(), size: req.file.size, ownerKey: req.ip || req.socket.remoteAddress || "unknown" }; try { conversionQueue.enqueue(job); } catch (error) { await fs.rm(directory, { recursive: true, force: true }); accepted = false; if (["QUEUE_FULL", "OWNER_QUEUE_LIMIT"].includes(error.code)) return res.status(error.code === "QUEUE_FULL" ? 503 : 429).json({ error: "Очередь конвертации занята. Попробуйте позже.", code: error.code }); throw error; } res.status(202).json({ jobId: id, status: "processing" }); } catch (error) { next(error); } finally { if (!accepted) await unlinkUpload(req.file); } });
app.get("/api/models/:jobId/status", (req, res) => { const job = jobs.get(safeId(req.params.jobId)); if (!job) return res.status(404).json({ error: "Задача не найдена." }); const { id, createdAt, ...publicJob } = job; res.json(publicJob); });
for (const [suffix, file, type] of [["model.glb", "model.glb", "model/gltf-binary"], ["metadata.json", "metadata.json", "application/json"]]) app.get(`/api/models/:jobId/${suffix}`, async (req, res) => { const id = safeId(req.params.jobId), job = jobs.get(id); if (!job || job.status !== "ready") return res.status(404).json({ error: "Результат ещё не готов." }); try { res.set({ "Content-Type": type, "Cache-Control": "private, max-age=86400, immutable" }); res.sendFile(file, { root: path.join(root, id) }); } catch { res.status(404).json({ error: "Результат не найден." }); } });

app.post("/api/projects/:id/model", requireUser, glbUpload.single("model"), async (req, res, next) => { try { const projects = await readJsonArray(userProjectsFile), project = projects.find((item) => item.id === req.params.id && item.ownerId === req.user.id); if (!project) return res.status(404).json({ error: "Проект не найден." }); if (!req.file || path.extname(req.file.originalname).toLowerCase() !== ".glb" || !await validateGlbFile(req.file.path)) return res.status(400).json({ error: "Загрузите корректную GLB-модель." }); await storage.moveFrom(req.file.path, `user-projects/${req.user.id}/${project.id}/model.glb`); req.file.path = null; let updated; await updateUserProjects((items) => items.map((item) => item.id === project.id ? (updated = { ...item, modelUrl: `/api/projects/${item.id}/model`, updatedAt: new Date().toISOString() }) : item)); res.status(201).json(publicProject(updated)); } catch (error) { next(error); } finally { await unlinkUpload(req.file); } });
app.get("/api/projects/:id/model", requireUser, async (req, res, next) => { try { const project = (await readJsonArray(userProjectsFile)).find((item) => item.id === req.params.id && item.ownerId === req.user.id && item.modelUrl); if (!project) return res.status(404).end(); res.sendFile(storage.path(`user-projects/${req.user.id}/${project.id}/model.glb`), (error) => { if (error && !res.headersSent) res.status(404).end(); }); } catch (error) { next(error); } });
const publicRoomAsset = (room, filename, version) => `/api/rooms/${room}/assets/${encodeURIComponent(filename)}${version ? `?v=${Math.trunc(version)}` : ""}`;
const projectFloorplanName = (name) => /^floorplan\.(jpg|jpeg|png|webp)$/.test(name);
export async function projectManifest() {
  const files = await fs.readdir(projectRoot).catch(() => []), floorplan = files.find(projectFloorplanName);
  if (!floorplan) return { floorplanUrl: null };
  const modified = (await fs.stat(path.join(projectRoot, floorplan))).mtimeMs;
  return { floorplanUrl: `/api/project/floorplan/${encodeURIComponent(floorplan)}?v=${Math.trunc(modified)}` };
}
app.get("/api/project", async (_, res, next) => { try { res.set("Cache-Control", "no-store"); res.json(await projectManifest()); } catch (error) { next(error); } });
app.get("/api/project/floorplan/:filename", (req, res) => {
  if (!projectFloorplanName(req.params.filename)) return res.status(404).end();
  res.set("Cache-Control", "public, max-age=3600");
  res.sendFile(req.params.filename, { root: projectRoot }, (error) => { if (error && !res.headersSent) res.status(404).end(); });
});
app.post("/api/project/floorplan", requireUploadPassword, imageUpload.single("file"), async (req, res, next) => {
  let normalized;
  try {
    if (!req.file) return res.status(400).json({ error: "Выберите файл планировки." });
    normalized = `${req.file.path}.normalized`; const { extension: ext } = await normalizeImage(req.file.path, normalized, { maxWidth: config.maxImageWidth, maxHeight: config.maxImageHeight, maxPixels: config.maxImagePixels });
    await fs.mkdir(projectRoot, { recursive: true });
    for (const old of await fs.readdir(projectRoot)) if (projectFloorplanName(old)) await fs.rm(path.join(projectRoot, old), { force: true });
    await fs.rename(normalized, path.join(projectRoot, `floorplan${ext}`)); normalized = null;
    res.status(201).json(await projectManifest());
  } catch (error) { next(error); } finally { await Promise.all([unlinkUpload(req.file), normalized ? fs.rm(normalized, { force: true }) : Promise.resolve()]); }
});
async function saveRooms() { await fs.mkdir(root, { recursive: true }); const temporary = `${roomsFile}.${crypto.randomBytes(5).toString("hex")}.tmp`; await fs.writeFile(temporary, JSON.stringify([...roomCatalog.values()], null, 2), { mode: 0o640 }); await fs.rename(temporary, roomsFile); }
async function readRoomMedia(room) {
  try { const value = JSON.parse(await fs.readFile(path.join(roomRoot, room, "media.json"), "utf8")); return Array.isArray(value) ? value : []; }
  catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return []; throw error; }
}
async function writeRoomMedia(room, media) {
  const dir = path.join(roomRoot, room); await fs.mkdir(dir, { recursive: true });
  const temporary = path.join(dir, `media-${crypto.randomBytes(5).toString("hex")}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(media, null, 2), { mode: 0o640 }); await fs.rename(temporary, path.join(dir, "media.json"));
}
export async function roomManifest(room) {
  const dir = path.join(roomRoot, room);
  const files = await fs.readdir(dir).catch(() => []);
  const floorplan = files.find((name) => name.startsWith("floorplan."));
  const model = files.includes("model.glb") ? "model.glb" : null;
  const renderFiles = files.filter((name) => /^render-[a-f0-9]{16}\.(jpg|jpeg|png|webp)$/.test(name));
  const photoFiles = files.filter((name) => /^photo-[a-f0-9]{16}\.(jpg|jpeg|png|webp)$/.test(name));
  const datedRenders = await Promise.all(renderFiles.map(async (name) => ({ name, modified: (await fs.stat(path.join(dir, name))).mtimeMs })));
  const floorplanModified = floorplan ? (await fs.stat(path.join(dir, floorplan))).mtimeMs : null;
  const modelModified = model ? (await fs.stat(path.join(dir, model))).mtimeMs : null;
  const metadata = await readRoomMedia(room);
  const photos = await Promise.all(photoFiles.map(async (name) => {
    const modified = (await fs.stat(path.join(dir, name))).mtimeMs, saved = metadata.find((item) => item.filename === name) || {};
    return { id: saved.id || path.parse(name).name, roomId: room, url: publicRoomAsset(room, name, modified), thumbnailUrl: publicRoomAsset(room, name, modified), type: saved.type || "other", date: saved.date || new Date(modified).toISOString().slice(0, 10), comment: saved.comment || "", createdAt: saved.createdAt || new Date(modified).toISOString() };
  }));
  return {
    floorplanUrl: floorplan ? publicRoomAsset(room, floorplan, floorplanModified) : null,
    modelUrl: model ? publicRoomAsset(room, model, modelModified) : null,
    renderUrls: datedRenders.sort((a, b) => a.modified - b.modified || a.name.localeCompare(b.name)).map(({ name, modified }) => publicRoomAsset(room, name, modified)),
    photos: photos.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    photoUrls: photos.map(({ url }) => url)
  };
}
app.get("/api/rooms", (_, res) => { res.set("Cache-Control", "no-store"); res.json([...roomCatalog.values()]); });
app.post("/api/rooms", requireUploadPassword, async (req, res, next) => {
  try {
    const name = plainLabel(req.body.name, 60), area = Number(req.body.area || 0), allowedIcons = new Set(["🏠","🛋️","🛏️","🍳","🚿","🚪","💻","🌿"]), icon = allowedIcons.has(req.body.icon) ? req.body.icon : "🏠";
    if (!name || name.length > 60 || area < 0 || area > 10000) return res.status(400).json({ error: "Укажите название комнаты и корректную площадь." });
    const translit = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ы:"y",э:"e",ю:"yu",я:"ya" };
    const base = [...name.toLowerCase()].map((letter) => translit[letter] || letter).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 34) || "room";
    let slug = base, suffix = 2; while ([...roomCatalog.values()].some((room) => room.slug === slug)) slug = `${base}-${suffix++}`;
    const id = slug, room = { id, slug, name, area, icon, createdAt: new Date().toISOString() }; roomCatalog.set(id, room); roomIds.add(id); await saveRooms(); await fs.mkdir(path.join(roomRoot, id), { recursive: true }); res.status(201).json(room);
  } catch (error) { next(error); }
});
app.get("/api/rooms/:room", async (req, res) => {
  if (!roomIds.has(req.params.room)) return res.status(404).json({ error: "Комната не найдена." });
  res.set("Cache-Control", "no-store");
  res.json(await roomManifest(req.params.room));
});
app.get("/api/rooms/:room/assets/:filename", (req, res) => {
  if (!roomIds.has(req.params.room) || !/^(floorplan\.(jpg|jpeg|png|webp)|model\.glb|(render|photo)-[a-f0-9]{16}\.(jpg|jpeg|png|webp))$/.test(req.params.filename)) return res.status(404).end();
  res.set("Cache-Control", "public, max-age=3600");
  res.sendFile(req.params.filename, { root: path.join(roomRoot, req.params.room) }, (error) => { if (error && !res.headersSent) res.status(404).end(); });
});
app.post("/api/rooms/:room/assets/:kind", requireUploadPassword, (req, res, next) => (req.params.kind === "model" ? glbUpload : imageUpload).single("file")(req, res, next), async (req, res, next) => {
  let normalized;
  try {
    const { room, kind } = req.params;
    if (!roomIds.has(room)) return res.status(404).json({ error: "Комната не найдена." });
    if (!req.file || !["floorplan", "render", "photo", "model"].includes(kind)) return res.status(400).json({ error: "Выберите тип материала и файл." });
    let ext;
    if (kind === "model") { ext = ".glb"; if (path.extname(req.file.originalname).toLowerCase() !== ext || !await validateGlbFile(req.file.path)) return res.status(400).json({ error: "Для модели комнаты нужен корректный файл GLB." }); }
    else { normalized = `${req.file.path}.normalized`; ({ extension: ext } = await normalizeImage(req.file.path, normalized, { maxWidth: config.maxImageWidth, maxHeight: config.maxImageHeight, maxPixels: config.maxImagePixels })); }
    const dir = path.join(roomRoot, room);
    await fs.mkdir(dir, { recursive: true });
    let filename;
    if (kind === "floorplan") {
      for (const old of await fs.readdir(dir)) if (old.startsWith("floorplan.")) await fs.rm(path.join(dir, old), { force: true });
      filename = `floorplan${ext}`;
    } else if (kind === "model") filename = "model.glb";
    else filename = `${kind}-${crypto.randomBytes(8).toString("hex")}${ext}`;
    await fs.rename(kind === "model" ? req.file.path : normalized, path.join(dir, filename)); if (kind === "model") req.file.path = null; else normalized = null;
    if (kind === "photo") {
      const allowedTypes = new Set(["construction", "completed", "defect", "control", "other"]), media = await readRoomMedia(room), createdAt = new Date().toISOString();
      media.push({ id: path.parse(filename).name, filename, roomId: room, type: allowedTypes.has(req.body.type) ? req.body.type : "other", date: /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || "") ? req.body.date : createdAt.slice(0, 10), comment: String(req.body.comment || "").trim().slice(0, 500), createdAt });
      await writeRoomMedia(room, media);
    }
    res.status(201).json(await roomManifest(room));
  } catch (error) { next(error); } finally { await Promise.all([unlinkUpload(req.file), normalized ? fs.rm(normalized, { force: true }) : Promise.resolve()]); }
});
export async function deleteRoomAsset(room, filename) {
  if (!roomIds.has(room) || !/^(floorplan\.(jpg|jpeg|png|webp)|model\.glb|(render|photo)-[a-f0-9]{16}\.(jpg|jpeg|png|webp))$/.test(filename)) return false;
  try { await fs.unlink(path.join(roomRoot, room, filename)); if (filename.startsWith("photo-")) await writeRoomMedia(room, (await readRoomMedia(room)).filter((item) => item.filename !== filename)); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
app.delete("/api/rooms/:room/assets/:filename", requireUploadPassword, async (req, res, next) => {
  try {
    const { room, filename } = req.params;
    if (!await deleteRoomAsset(room, filename)) return res.status(404).json({ error: "Материал не найден." });
    res.json(await roomManifest(room));
  } catch (error) { next(error); }
});
let notesWrite = Promise.resolve();
export async function readNotes() {
  try {
    const notes = JSON.parse(await fs.readFile(notesFile, "utf8"));
    return Array.isArray(notes) ? notes : [];
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return [];
    throw error;
  }
}
export function updateNotes(change) {
  const operation = notesWrite.then(async () => {
    const notes = await readNotes();
    const updated = change(notes);
    await fs.mkdir(root, { recursive: true });
    const temporary = `${notesFile}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(updated, null, 2), { mode: 0o640 });
    await fs.rename(temporary, notesFile);
    return updated;
  });
  notesWrite = operation.catch(() => {});
  return operation;
}
app.get("/api/notes", async (_, res, next) => { try { res.json(await readNotes()); } catch (error) { next(error); } });
app.post("/api/notes", requireUploadPassword, async (req, res, next) => {
  try {
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!text || text.length > 500) return res.status(400).json({ error: "Заметка должна содержать от 1 до 500 символов." });
    const roomId = roomIds.has(req.body.roomId) ? req.body.roomId : null;
    const position = req.body.position && ["x","y","z"].every((key) => Number.isFinite(Number(req.body.position[key]))) ? Object.fromEntries(["x","y","z"].map((key) => [key, Math.max(0,Math.min(1,Number(req.body.position[key])))])) : { x:.5, y:.5, z:.5 };
    const note = { id: crypto.randomBytes(12).toString("hex"), text, roomId, position, status: "new", createdAt: new Date().toISOString() };
    await updateNotes((notes) => [...notes, note]);
    res.status(201).json(note);
  } catch (error) { next(error); }
});
app.patch("/api/notes/:id", requireUploadPassword, async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{24}$/.test(req.params.id)) return res.status(404).json({ error:"Заметка не найдена." });
    const source = req.body.position, values = source && ["x","y","z"].map((key) => Number(source[key]));
    if (!values || values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) return res.status(400).json({ error:"Некорректная позиция пина." });
    let updated; await updateNotes((notes) => notes.map((note) => note.id === req.params.id ? (updated = { ...note, position:{ x:values[0], y:values[1], z:values[2] } }) : note));
    if (!updated) return res.status(404).json({ error:"Заметка не найдена." }); res.json(updated);
  } catch(error) { next(error); }
});
app.delete("/api/notes/:id", requireUploadPassword, async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{24}$/.test(req.params.id)) return res.status(404).json({ error: "Заметка не найдена." });
    let removed = false;
    const notes = await updateNotes((current) => current.filter((note) => { if (note.id === req.params.id) { removed = true; return false; } return true; }));
    if (!removed) return res.status(404).json({ error: "Заметка не найдена." });
    res.json(notes);
  } catch (error) { next(error); }
});
app.get("/health", (_, res) => res.json({ ok: true }));
app.use("/api", (req, res) => res.status(404).json({ error: "API endpoint не найден.", code: "NOT_FOUND", requestId: req.id }));
app.use((error, req, res, __) => {
  const isLimit = error.code === "LIMIT_FILE_SIZE", status = isLimit ? 413 : Number(error.status) || (error instanceof SyntaxError ? 400 : 500), code = isLimit ? "UPLOAD_TOO_LARGE" : status === 400 ? "BAD_REQUEST" : "INTERNAL_ERROR";
  log("error", "request_failed", { requestId: req.id, method: req.method, path: req.path, status, code: error.code || code });
  res.status(status).json({ error: isLimit ? "Размер файла превышает допустимый лимит." : status >= 500 ? "Внутренняя ошибка сервера." : "Некорректный запрос.", code, requestId: req.id });
});
setInterval(async () => { const now = Date.now(); for (const [id, job] of jobs) if (now - job.createdAt > ttlMs && ["ready", "failed"].includes(job.status)) { conversionQueue.delete(id); await storage.delete(id, { recursive: true }).catch((error) => log("error", "result_cleanup_failed", { jobId: id, code: error.code })); } }, 3600_000).unref();
setInterval(() => updateAuth(async () => writeJsonArray(sessionsFile, (await readJsonArray(sessionsFile)).filter((session) => session.expiresAt > Date.now()))).catch((error) => log("error", "session_cleanup_failed", { code: error.code })), 3600_000).unref();

let httpServer;
async function start() {
  await Promise.all([fs.mkdir(roomRoot, { recursive: true }), fs.mkdir(tempRoot, { recursive: true })]);
  for (const entry of await fs.readdir(tempRoot)) {
    await fs.rm(path.join(tempRoot, entry), { recursive: true, force: true });
  }
  const port = config.port, host = config.host;
  httpServer = app.listen(port, host, () => log("info", "server_started", { port, host, nodeEnv, storageDriver, maxConcurrent }));
}
async function shutdown(signal) {
  if (!conversionQueue.accepting) return;
  conversionQueue.stop(); log("info", "shutdown_started", { signal, running: conversionQueue.running, queued: conversionQueue.size });
  httpServer?.close();
  const deadline = Date.now() + config.shutdownTimeoutMs;
  while (conversionQueue.running && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
  if (conversionQueue.running) {
    for (const child of activeChildren) child.kill("SIGTERM");
    const killDeadline = Date.now() + 3_000;
    while (conversionQueue.running && Date.now() < killDeadline) await new Promise((resolve) => setTimeout(resolve, 100));
    for (const child of activeChildren) child.kill("SIGKILL");
  }
  log("info", "shutdown_completed", { running: conversionQueue.running });
  process.exit(0);
}
if (process.argv[1]?.endsWith("index.js")) { start().catch((error) => { log("error", "startup_failed", { code: error.code || "STARTUP_FAILED" }); process.exit(1); }); process.once("SIGTERM", () => shutdown("SIGTERM")); process.once("SIGINT", () => shutdown("SIGINT")); }
