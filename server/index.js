import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import cors from "cors";
import multer from "multer";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { promisify } from "node:util";
import { ConversionQueue } from "./conversion-queue.js";
import { createStorage } from "./storage/index.js";
import { config } from "./config.js";
import { normalizeImage, validateGlbFile, validateIfcFile } from "./file-validation.js";
import { buildRoomConnections, linkBoundary, linkNearbyElements, resolveProxyType, runIfcAnalyzer } from "./ifc-analysis.js";

const { nodeEnv, isProduction } = config;
const root = config.storageRoot;
const tempRoot = config.tempRoot;
const storageDriver = config.storageDriver;
const storage = createStorage({ driver: storageDriver, root });
const timeoutMs = config.conversionTimeoutMs;
const maxConcurrent = config.maxConcurrentConversions;
const ttlMs = config.modelTtlMs;
const uploadPassword = config.uploadPassword;
const log = (level, event, fields = {}) => {
  const entry = { time: new Date().toISOString(), level, event, ...fields };
  (level === "error" ? console.error : console.log)(JSON.stringify(entry));
};
const roomRoot = path.join(root, "rooms");
const notesFile = path.join(root, "site-notes.json");
const roomsFile = path.join(root, "rooms.json");
const usersFile = path.join(root, "users.json");
const sessionsFile = path.join(root, "sessions.json");
const userProjectsFile = path.join(root, "user-projects.json");
const projectRoot = path.join(root, "project");
const defaultRooms = [
  { id: "kitchen", slug: "kitchen", name: "Кухня-гостиная", area: 28.4 },
  { id: "bedroom", slug: "bedroom", name: "Спальня", area: 16.2 },
  { id: "bathroom", slug: "bathroom", name: "Санузел", area: 6.8 },
  { id: "hall", slug: "hallway", name: "Прихожая", area: 10.5 },
  { id: "terrace", slug: "balcony", name: "Балкон / терраса", area: 14.1 },
];
const plainLabel = (value, max = 80) =>
  String(value || "")
    .trim()
    .replace(/[<>"'&\u0000-\u001f]/g, "")
    .slice(0, max);
const roomCatalog = new Map(defaultRooms.map((room) => [room.id, room]));
try {
  const savedRooms = JSON.parse(await fs.readFile(roomsFile, "utf8"));
  if (Array.isArray(savedRooms)) {
    roomCatalog.clear();
    savedRooms.forEach(
      (room) =>
        room?.id &&
        room?.slug &&
        roomCatalog.set(room.id, { ...room, name: plainLabel(room.name, 60) })
    );
  }
} catch (error) {
  if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
}
const roomIds = new Set(roomCatalog.keys());
const activeChildren = new Set();
const safeId = (id) => (/^[a-f0-9]{32}$/.test(id || "") ? id : null);
const stage = (job, status, text) => {
  if (job.status !== status) job.stageStartedAt = Date.now();
  return Object.assign(job, { status, stage: text });
};
const ifcHeader = (buffer) =>
  /^ISO-10303-21/i.test(buffer.toString("utf8", 0, Math.min(buffer.length, 4096))) &&
  buffer.includes(Buffer.from("FILE_SCHEMA"));
const typeWhitelist = new Set([
  "IfcWall",
  "IfcDoor",
  "IfcWindow",
  "IfcSlab",
  "IfcColumn",
  "IfcBuildingStorey",
  "IfcSpace",
]);

export function extractMetadata(text) {
  const elements = {};
  const re =
    /#\d+\s*=\s*(IFCWALL|IFCDOOR|IFCWINDOW|IFCSLAB|IFCCOLUMN|IFCBUILDINGSTOREY|IFCSPACE)\s*\(\s*'([^']*)'\s*,\s*(?:\$|'[^']*')\s*,\s*(?:\$|'([^']*)')/gi;
  for (const match of text.matchAll(re)) {
    const type = `Ifc${match[1]
      .slice(3)
      .toLowerCase()
      .replace(/(^|_)([a-z])/g, (_, p, c) => c.toUpperCase())}`;
    if (typeWhitelist.has(type))
      elements[match[2]] = { globalId: match[2], type, name: match[3] || type };
  }
  return { elements, meshGlobalIdMapping: "not-guaranteed-by-IfcConvert" };
}
export function isIfc(buffer) {
  return ifcHeader(buffer);
}
export function validUploadPassword(value) {
  if (!uploadPassword) return false;
  const supplied = Buffer.from(String(value || ""));
  const expected = Buffer.from(uploadPassword);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
async function convert(job) {
  const startedAt = Date.now(),
    directory = path.join(tempRoot, job.id),
    input = path.join(directory, "input.ifc"),
    output = path.join(directory, "model.glb");
  log("info", "conversion_started", {
    jobId: job.id,
    bytes: job.size,
    queueSize: conversionQueue.size,
  });
  try {
    stage(job, "validating", "Проверка IFC");
    if (!(await validateIfcFile(input)))
      throw Object.assign(new Error("Файл не похож на корректный IFC."), { code: "INVALID_IFC" });
    stage(job, "analyzing", "Анализ BIM-структуры");
    const analysisFile = path.join(directory, "analysis.json");
    await runIfcAnalyzer(input, analysisFile, {
      python: config.pythonPath,
      timeoutMs,
    });
    const analysis = JSON.parse(await fs.readFile(analysisFile, "utf8"));
    for (const element of analysis.elements || []) {
      if (element.ifcType !== "IfcBuildingElementProxy") continue;
      const classification = resolveProxyType(element);
      Object.assign(element, {
        resolvedType: classification.type,
        confidence: classification.confidence,
        classificationSignals: classification.source,
      });
    }
    const roomIndex = new Map((analysis.spaces || []).map((room) => [room.id, room]));
    const elementIndex = new Map((analysis.elements || []).map((element) => [element.id, element]));
    for (const boundary of analysis.boundaries || []) {
      const room = roomIndex.get(boundary.roomId), element = elementIndex.get(boundary.elementId);
      if (room && element) {
        boundary.type = element.resolvedType;
        linkBoundary(room, element);
      }
    }
    if (!(analysis.boundaries || []).length) {
      linkNearbyElements(analysis.rooms, analysis.elements);
      analysis.analysis.warnings.push("IfcRelSpaceBoundary отсутствует: связи построены пространственным fallback");
    }
    analysis.connections = buildRoomConnections(analysis.elements);
    analysis.analysis.resolvedTypes = Object.fromEntries(
      Object.entries(
        (analysis.elements || []).reduce((counts, item) => {
          counts[item.resolvedType] = (counts[item.resolvedType] || 0) + 1;
          return counts;
        }, {})
      )
    );
    log("info", "ifc_analysis_completed", {
      jobId: job.id,
      schema: analysis.analysis.schema,
      storeys: analysis.analysis.storeys,
      spaces: analysis.analysis.spaces,
      usableRooms: analysis.analysis.usableRooms,
      aggregateSpaces: analysis.analysis.aggregateSpaces,
      ifcTypes: analysis.analysis.ifcTypes,
      resolvedTypes: analysis.analysis.resolvedTypes,
    });
    const targetPrefix = job.projectId && job.userId
      ? `user-projects/${job.userId}/${job.projectId}`
      : job.id;
    await Promise.all([
      storage.copyFrom(input, `${targetPrefix}/source.ifc`),
      storage.save(`${targetPrefix}/project.json`, JSON.stringify(analysis, null, 2), { mode: 0o640 }),
      storage.save(`${targetPrefix}/metadata.json`, JSON.stringify(analysis, null, 2), { mode: 0o640 }),
      storage.save(`${targetPrefix}/rooms.json`, JSON.stringify({ storeys: analysis.storeys, rooms: analysis.rooms, connections: analysis.connections }, null, 2), { mode: 0o640 }),
      storage.save(`${targetPrefix}/analysis.json`, JSON.stringify(analysis.analysis, null, 2), { mode: 0o640 }),
    ]);
    stage(job, "converting", "Создание геометрии");
    await new Promise((resolve, reject) => {
      const child = spawn(config.ifcConvertPath, ["--center-model", input, output], {
        shell: false,
        windowsHide: true,
      });
      activeChildren.add(child);
      let stderr = "",
        settled = false,
        timedOut = false,
        killTimer;
      child.stderr?.on("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-4000);
      });
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(killTimer);
        activeChildren.delete(child);
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 3000);
        killTimer.unref();
      }, timeoutMs);
      child.on("error", (error) =>
        finish(
          Object.assign(
            new Error(
              error.code === "ENOENT"
                ? "IfcConvert не найден на сервере."
                : "Не удалось запустить IfcConvert."
            ),
            { code: "CONVERTER_START_FAILED" }
          )
        )
      );
      child.on("close", (code) =>
        finish(
          timedOut
            ? Object.assign(new Error("Превышено время преобразования IFC."), {
                code: "CONVERSION_TIMEOUT",
              })
            : code === 0
              ? null
              : Object.assign(new Error("IfcConvert завершился с ошибкой."), {
                  code: "CONVERSION_FAILED",
                  converterExitCode: code,
                  stderr: stderr.slice(-500),
                })
        )
      );
    });
    stage(job, "optimizing", "Подготовка модели");
    if (job.projectId && job.userId) {
      await storage.moveFrom(output, `user-projects/${job.userId}/${job.projectId}/model.glb`);
      await updateUserProjects((projects) =>
        projects.map((project) =>
          project.id === job.projectId && project.ownerId === job.userId
            ? {
                ...project,
                modelUrl: `/api/projects/${project.id}/model`,
                metadataUrl: `/api/projects/${project.id}/metadata`,
                rooms: analysis.rooms.length,
                status: "Модель готова",
                updatedAt: new Date().toISOString(),
              }
            : project
        )
      );
      Object.assign(job, {
        status: "ready",
        stage: "Модель готова",
        modelUrl: `/api/projects/${job.projectId}/model`,
        metadataUrl: `/api/projects/${job.projectId}/metadata`,
        rooms: analysis.rooms,
        storeys: analysis.storeys,
      });
    } else {
      await storage.moveFrom(output, `${job.id}/model.glb`);
      Object.assign(job, {
        status: "ready",
        stage: "Модель готова",
        modelUrl: `/api/models/${job.id}/model.glb`,
        metadataUrl: `/api/models/${job.id}/metadata.json`,
        roomsUrl: `/api/models/${job.id}/rooms.json`,
        analysisUrl: `/api/models/${job.id}/analysis.json`,
        rooms: analysis.rooms,
        storeys: analysis.storeys,
      });
    }
    log("info", "conversion_completed", { jobId: job.id, durationMs: Date.now() - startedAt });
  } catch (error) {
    Object.assign(job, {
      status: "failed",
      stage: "Ошибка преобразования",
      error:
        error.code === "CONVERSION_TIMEOUT"
          ? "Превышено время преобразования IFC."
          : "Не удалось преобразовать IFC.",
    });
    log("error", "conversion_failed", {
      jobId: job.id,
      code: error.code || "CONVERSION_FAILED",
      durationMs: Date.now() - startedAt,
      converterExitCode: error.converterExitCode,
    });
  } finally {
    await fs
      .rm(directory, { recursive: true, force: true })
      .catch((error) => log("error", "temp_cleanup_failed", { jobId: job.id, code: error.code }));
  }
}
const conversionQueue = new ConversionQueue({
  concurrency: maxConcurrent,
  maxQueue: config.maxConversionQueue,
  maxPerOwner: config.maxUserConversionJobs,
  worker: convert,
  onStateChange: (queue) =>
    log("info", "queue_state", { running: queue.running, queued: queue.size }),
});
const jobs = conversionQueue.jobs;
export const app = express();
const trustProxyHops = config.trustProxyHops;
if (trustProxyHops) app.set("trust proxy", trustProxyHops);
const localOrigins = [
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];
const allowedOrigins = new Set([...config.allowedOrigins, ...(isProduction ? [] : localOrigins)]);
const allowedHosts = new Set([
  ...config.allowedHosts,
  ...config.allowedOrigins.map((origin) => new URL(origin).host.toLowerCase()),
  ...(isProduction
    ? []
    : [
        "localhost",
        "127.0.0.1",
        "localhost:3001",
        "127.0.0.1:3001",
        "localhost:8080",
        "127.0.0.1:8080",
      ]),
]);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    strictTransportSecurity: isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: "no-referrer" },
  })
);
app.use((_, res, next) => {
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.set("X-Request-Id", req.id);
  next();
});
app.use((req, res, next) => {
  const host = String(req.get("host") || "").toLowerCase();
  if (allowedHosts.has(host) || (!isProduction && /^(localhost|127\.0\.0\.1):\d+$/.test(host)))
    return next();
  res.status(421).json({ error: "Недопустимый Host.", code: "HOST_DENIED", requestId: req.id });
});
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      callback(
        Object.assign(new Error("Origin is not allowed"), { status: 403, code: "ORIGIN_DENIED" })
      );
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);
app.use(express.json({ limit: config.jsonLimit }));
app.use(express.urlencoded({ extended: false, limit: config.jsonLimit }));
app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || !req.headers.cookie)
    return next();
  const origin = req.get("origin");
  if ((origin && allowedOrigins.has(origin)) || (!origin && !isProduction)) return next();
  res.status(403).json({
    error: "Запрос отклонён проверкой источника.",
    code: "CSRF_ORIGIN_DENIED",
    requestId: req.id,
  });
});
const limiter = (options) =>
  rateLimit({
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({ error: options.message, code: "RATE_LIMITED", requestId: req.id }),
    ...options,
  });
const apiRateLimit = limiter({
  ...config.apiRate,
  message: "Слишком много API-запросов. Попробуйте позже.",
});
const conversionRateLimit = limiter({
  ...config.conversionRate,
  message: "Слишком много конвертаций. Попробуйте позже.",
});
const loginRateLimit = limiter({
  ...config.loginRate,
  message: "Слишком много попыток входа. Попробуйте позже.",
});
const registerRateLimit = limiter({
  ...config.registerRate,
  message: "Слишком много регистраций. Попробуйте позже.",
});
app.use("/api", apiRateLimit);

const scrypt = promisify(crypto.scrypt);
const sessionMaxAge = config.sessionMaxAgeMs;
const normalizeEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const publicUser = ({ id, name, email, createdAt }) => ({ id, name, email, createdAt });
const publicProject = ({ ownerId: _, ...project }) => project;
const safeProjectId = (value) => (/^[a-f0-9]{24}$/.test(value || "") ? value : null);
const safeUserId = (value) => (/^[a-f0-9]{32}$/.test(value || "") ? value : null);
async function readJsonArray(file) {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return [];
    throw error;
  }
}
async function writeJsonArray(file, value) {
  await fs.mkdir(root, { recursive: true });
  const temporary = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(temporary, file);
}
async function moveFile(source, target) {
  try {
    await fs.rename(source, target);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    const temporary = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      await fs.copyFile(source, temporary);
      await fs.rename(temporary, target);
      await fs.unlink(source);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
}
let authWrite = Promise.resolve();
function updateAuth(operation) {
  const result = authWrite.then(operation);
  authWrite = result.catch(() => {});
  return result;
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}
async function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored).split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex"),
    actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim().split(/=(.*)/s).slice(0, 2))
      .filter(([key]) => key)
      .map(([key, value]) => [key, decodeURIComponent(value || "")])
  );
}
function cookiePolicy() {
  return isProduction ? "SameSite=None; Secure" : "SameSite=Lax";
}
function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `roomark_session=${encodeURIComponent(token)}; HttpOnly; Path=/; ${cookiePolicy()}; Max-Age=${sessionMaxAge / 1000}`
  );
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `roomark_session=; HttpOnly; Path=/; ${cookiePolicy()}; Max-Age=0`);
}
async function createSession(userId, res) {
  const token = crypto.randomBytes(32).toString("hex"),
    tokenHash = crypto.createHash("sha256").update(token).digest("hex"),
    expiresAt = Date.now() + sessionMaxAge;
  await updateAuth(async () => {
    const sessions = (await readJsonArray(sessionsFile)).filter(
      (item) => item.expiresAt > Date.now()
    );
    sessions.push({ tokenHash, userId, expiresAt });
    await writeJsonArray(sessionsFile, sessions);
  });
  setSessionCookie(res, token);
}
async function currentUser(req) {
  const token = cookies(req).roomark_session;
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex"),
    sessions = await readJsonArray(sessionsFile),
    session = sessions.find(
      (item) =>
        item.tokenHash.length === tokenHash.length &&
        crypto.timingSafeEqual(Buffer.from(item.tokenHash), Buffer.from(tokenHash)) &&
        item.expiresAt > Date.now()
    );
  if (!session) return null;
  return (await readJsonArray(usersFile)).find((user) => user.id === session.userId) || null;
}
async function requireUser(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Требуется вход." });
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

app.post("/api/auth/register", registerRateLimit, async (req, res, next) => {
  try {
    const name = String(req.body.name || "")
        .trim()
        .replace(/\s+/g, " "),
      email = normalizeEmail(req.body.email),
      password = String(req.body.password || "");
    if (name.length < 2 || name.length > 80)
      return res.status(400).json({ error: "Укажите имя длиной от 2 до 80 символов." });
    if (!validEmail(email))
      return res.status(400).json({ error: "Укажите корректный адрес электронной почты." });
    if (
      password.length < 8 ||
      password.length > 128 ||
      !/[a-zа-яё]/i.test(password) ||
      !/\d/.test(password)
    )
      return res
        .status(400)
        .json({ error: "Пароль должен содержать не менее 8 символов, букву и цифру." });
    let user;
    await updateAuth(async () => {
      const users = await readJsonArray(usersFile);
      if (users.some((item) => item.email === email)) {
        const error = new Error("EMAIL_EXISTS");
        error.status = 409;
        throw error;
      }
      user = {
        id: crypto.randomBytes(16).toString("hex"),
        name,
        email,
        passwordHash: await hashPassword(password),
        createdAt: new Date().toISOString(),
      };
      users.push(user);
      await writeJsonArray(usersFile, users);
    });
    await createSession(user.id, res);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.message === "EMAIL_EXISTS")
      return res.status(409).json({ error: "Аккаунт с такой почтой уже существует." });
    next(error);
  }
});
app.post("/api/auth/login", loginRateLimit, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email),
      password = String(req.body.password || ""),
      user = (await readJsonArray(usersFile)).find((item) => item.email === email);
    const valid = user
      ? await verifyPassword(password, user.passwordHash)
      : (await scrypt(password || "invalid-password", Buffer.alloc(16), 64), false);
    if (!valid) return res.status(401).json({ error: "Неверная почта или пароль." });
    await createSession(user.id, res);
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});
app.get("/api/auth/me", async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Требуется вход." });
    res.set("Cache-Control", "no-store").json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const token = cookies(req).roomark_session;
    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await updateAuth(async () =>
        writeJsonArray(
          sessionsFile,
          (await readJsonArray(sessionsFile)).filter((item) => item.tokenHash !== tokenHash)
        )
      );
    }
    clearSessionCookie(res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.patch("/api/auth/profile", requireUser, async (req, res, next) => {
  try {
    const name = String(req.body.name || "")
        .trim()
        .replace(/\s+/g, " "),
      email = normalizeEmail(req.body.email);
    if (name.length < 2 || name.length > 80)
      return res.status(400).json({ error: "Укажите имя длиной от 2 до 80 символов." });
    if (!validEmail(email))
      return res.status(400).json({ error: "Укажите корректный адрес электронной почты." });
    let updated;
    await updateAuth(async () => {
      const users = await readJsonArray(usersFile);
      if (users.some((item) => item.id !== req.user.id && item.email === email)) {
        const error = new Error("EMAIL_EXISTS");
        error.status = 409;
        throw error;
      }
      await writeJsonArray(
        usersFile,
        users.map((item) =>
          item.id === req.user.id
            ? (updated = { ...item, name, email, updatedAt: new Date().toISOString() })
            : item
        )
      );
    });
    res.json({ user: publicUser(updated) });
  } catch (error) {
    if (error.message === "EMAIL_EXISTS")
      return res.status(409).json({ error: "Аккаунт с такой почтой уже существует." });
    next(error);
  }
});
app.patch("/api/auth/password", requireUser, async (req, res, next) => {
  try {
    const currentPassword = String(req.body.currentPassword || ""),
      newPassword = String(req.body.newPassword || "");
    if (!(await verifyPassword(currentPassword, req.user.passwordHash)))
      return res.status(401).json({ error: "Неверный текущий пароль." });
    if (
      newPassword.length < 8 ||
      newPassword.length > 128 ||
      !/[a-zа-яё]/i.test(newPassword) ||
      !/\d/.test(newPassword)
    )
      return res
        .status(400)
        .json({ error: "Новый пароль должен содержать не менее 8 символов, букву и цифру." });
    const passwordHash = await hashPassword(newPassword);
    await updateAuth(async () =>
      writeJsonArray(
        usersFile,
        (await readJsonArray(usersFile)).map((item) =>
          item.id === req.user.id
            ? { ...item, passwordHash, updatedAt: new Date().toISOString() }
            : item
        )
      )
    );
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

let projectsWrite = Promise.resolve();
function updateUserProjects(operation) {
  const result = projectsWrite.then(async () => {
    const projects = await readJsonArray(userProjectsFile);
    const updated = await operation(projects);
    await writeJsonArray(userProjectsFile, updated);
    return updated;
  });
  projectsWrite = result.catch(() => {});
  return result;
}
app.delete("/api/auth/account", requireUser, async (req, res, next) => {
  try {
    const userId = req.user.id;
    await updateUserProjects((projects) =>
      projects.filter((project) => project.ownerId !== userId)
    );
    await updateAuth(async () => {
      await writeJsonArray(
        usersFile,
        (await readJsonArray(usersFile)).filter((user) => user.id !== userId)
      );
      await writeJsonArray(
        sessionsFile,
        (await readJsonArray(sessionsFile)).filter((session) => session.userId !== userId)
      );
    });
    await storage.delete(`user-projects/${userId}`, { recursive: true }).catch(() => {});
    clearSessionCookie(res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
const cleanProjectFields = (body) => ({
  name: String(body.name || "")
    .trim()
    .slice(0, 100),
  area: Math.max(0, Math.min(100000, Number(body.area) || 0)),
  rooms: Math.max(1, Math.min(1000, Math.trunc(Number(body.rooms) || 1))),
  theme: ["Тёплый", "Ночной", "Нейтральный"].includes(body.theme) ? body.theme : "Тёплый",
});
app.get("/api/projects", requireUser, async (req, res, next) => {
  try {
    res
      .set("Cache-Control", "no-store")
      .json(
        (await readJsonArray(userProjectsFile))
          .filter((project) => project.ownerId === req.user.id)
          .map(publicProject)
      );
  } catch (error) {
    next(error);
  }
});
app.post("/api/projects", requireUser, async (req, res, next) => {
  try {
    const fields = cleanProjectFields(req.body);
    if (fields.name.length < 2)
      return res
        .status(400)
        .json({ error: "Название проекта должно содержать не менее 2 символов." });
    const project = {
      id: crypto.randomBytes(12).toString("hex"),
      ownerId: req.user.id,
      ...fields,
      status: "Черновик",
      modelUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await updateUserProjects((projects) => [...projects, project]);
    res.status(201).json(publicProject(project));
  } catch (error) {
    next(error);
  }
});
app.get("/api/projects/:id", requireUser, async (req, res, next) => {
  try {
    const project = (await readJsonArray(userProjectsFile)).find(
      (item) => item.id === req.params.id && item.ownerId === req.user.id
    );
    if (!project) return res.status(404).json({ error: "Проект не найден." });
    res.set("Cache-Control", "no-store").json(publicProject(project));
  } catch (error) {
    next(error);
  }
});
app.patch("/api/projects/:id", requireUser, async (req, res, next) => {
  try {
    const fields = cleanProjectFields(req.body);
    if (fields.name.length < 2)
      return res
        .status(400)
        .json({ error: "Название проекта должно содержать не менее 2 символов." });
    let updated;
    await updateUserProjects((projects) =>
      projects.map((project) =>
        project.id === req.params.id && project.ownerId === req.user.id
          ? (updated = { ...project, ...fields, updatedAt: new Date().toISOString() })
          : project
      )
    );
    if (!updated) return res.status(404).json({ error: "Проект не найден." });
    res.json(publicProject(updated));
  } catch (error) {
    next(error);
  }
});
app.delete("/api/projects/:id", requireUser, async (req, res, next) => {
  try {
    const projectId = safeProjectId(req.params.id),
      userId = safeUserId(req.user.id);
    if (!projectId || !userId) return res.status(404).json({ error: "Проект не найден." });
    let removed = false;
    await updateUserProjects((projects) =>
      projects.filter((project) => {
        if (project.id === projectId && project.ownerId === userId) {
          removed = true;
          return false;
        }
        return true;
      })
    );
    if (!removed) return res.status(404).json({ error: "Проект не найден." });
    await storage
      .delete(`user-projects/${userId}/${projectId}`, { recursive: true })
      .catch(() => {});
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.post("/api/account/import", requireUser, async (req, res, next) => {
  try {
    const source = req.body;
    if (!source || !Array.isArray(source.projects) || source.projects.length > 100)
      return res
        .status(400)
        .json({ error: "Выберите экспорт Roomark, содержащий не более 100 проектов." });
    const imported = source.projects.map((item) => {
      if (!item || typeof item !== "object") return null;
      const fields = cleanProjectFields(item),
        sourceId = safeProjectId(item.id);
      return fields.name.length >= 2 ? { sourceId, fields } : null;
    });
    if (imported.some((item) => !item))
      return res.status(400).json({ error: "Файл содержит некорректные данные проектов." });
    const now = new Date().toISOString();
    let added = 0,
      updated = 0;
    await updateUserProjects((projects) => {
      const result = [...projects];
      for (const item of imported) {
        const index = item.sourceId
          ? result.findIndex(
              (project) => project.id === item.sourceId && project.ownerId === req.user.id
            )
          : -1;
        if (index >= 0) {
          result[index] = { ...result[index], ...item.fields, updatedAt: now };
          updated++;
          continue;
        }
        const id =
          item.sourceId && !result.some((project) => project.id === item.sourceId)
            ? item.sourceId
            : crypto.randomBytes(12).toString("hex");
        result.push({
          id,
          ownerId: req.user.id,
          ...item.fields,
          status: "Импортирован",
          modelUrl: null,
          createdAt: now,
          updatedAt: now,
        });
        added++;
      }
      return result;
    });
    res.json({ added, updated, total: imported.length, modelsImported: false });
  } catch (error) {
    next(error);
  }
});
const decodeUploadPasswordHeader = (value) => {
  const source = String(value || "");
  if (!source.startsWith("roomark-uri:")) return source;
  try {
    return decodeURIComponent(source.slice("roomark-uri:".length));
  } catch {
    return "";
  }
};
const requireUploadPassword = (req, res, next) =>
  validUploadPassword(decodeUploadPasswordHeader(req.get("x-upload-password")))
    ? next()
    : res.status(401).json({ error: "Неверный пароль для загрузки." });
const uploadRoot = path.join(tempRoot, "uploads");
const diskStorage = multer.diskStorage({
  destination: (_, __, callback) =>
    fs.mkdir(uploadRoot, { recursive: true }).then(() => callback(null, uploadRoot), callback),
  filename: (_, __, callback) => callback(null, crypto.randomBytes(24).toString("hex")),
});
const diskUpload = (maxBytes) =>
  multer({ storage: diskStorage, limits: { fileSize: maxBytes, files: 1, fields: 10, parts: 12 } });
const ifcUpload = diskUpload(config.maxIfcBytes),
  glbUpload = diskUpload(config.maxGlbBytes),
  imageUpload = diskUpload(config.maxImageBytes);
const unlinkUpload = (file) => (file?.path ? fs.rm(file.path, { force: true }) : Promise.resolve());
app.post(
  "/api/models",
  conversionRateLimit,
  requireUploadPassword,
  ifcUpload.single("model"),
  async (req, res, next) => {
    let accepted = false;
    try {
      if (!conversionQueue.accepting)
        return res.status(503).json({ error: "Сервис завершает работу.", code: "SHUTTING_DOWN" });
      if (!req.file || path.extname(req.file.originalname).toLowerCase() !== ".ifc")
        return res
          .status(400)
          .json({ error: "Нужен IFC-файл в поле model.", code: "IFC_FILE_REQUIRED" });
      if (!(await validateIfcFile(req.file.path)))
        return res
          .status(400)
          .json({ error: "Файл не похож на корректный IFC.", code: "INVALID_IFC" });
      const id = crypto.randomBytes(16).toString("hex"),
        directory = path.join(tempRoot, id),
        input = path.join(directory, "input.ifc");
      await fs.mkdir(directory, { recursive: true });
      await fs.rename(req.file.path, input);
      accepted = true;
      const job = {
        id,
        status: "queued",
        stage: "В очереди на обработку",
        createdAt: Date.now(),
        size: req.file.size,
        ownerKey: req.ip || req.socket.remoteAddress || "unknown",
      };
      try {
        conversionQueue.enqueue(job);
      } catch (error) {
        await fs.rm(directory, { recursive: true, force: true });
        accepted = false;
        if (["QUEUE_FULL", "OWNER_QUEUE_LIMIT"].includes(error.code))
          return res
            .status(error.code === "QUEUE_FULL" ? 503 : 429)
            .json({ error: "Очередь конвертации занята. Попробуйте позже.", code: error.code });
        throw error;
      }
      res.status(202).json({ jobId: id, status: "processing" });
    } catch (error) {
      next(error);
    } finally {
      if (!accepted) await unlinkUpload(req.file);
    }
  }
);
app.get("/api/models/:jobId/status", (req, res) => {
  const job = jobs.get(safeId(req.params.jobId));
  if (!job) return res.status(404).json({ error: "Задача не найдена." });
  const { id, createdAt, ownerKey, userId, ...publicJob } = job;
  const queuedJobs = [...jobs.values()].filter((item) => item.status === "queued"),
    queuePosition =
      job.status === "queued" ? queuedJobs.findIndex((item) => item.id === job.id) + 1 : 0;
  res.set("Cache-Control", "no-store").json({
    ...publicJob,
    ...(queuePosition ? { queuePosition } : {}),
    elapsedSeconds: Math.max(0, Math.round((Date.now() - createdAt) / 1000)),
    stageElapsedSeconds: Math.max(
      0,
      Math.round((Date.now() - (job.stageStartedAt || createdAt)) / 1000)
    ),
  });
});
for (const [suffix, file, type] of [
  ["model.glb", "model.glb", "model/gltf-binary"],
  ["metadata.json", "metadata.json", "application/json"],
  ["rooms.json", "rooms.json", "application/json"],
  ["analysis.json", "analysis.json", "application/json"],
])
  app.get(`/api/models/:jobId/${suffix}`, async (req, res) => {
    const id = safeId(req.params.jobId),
      job = jobs.get(id);
    if (!job || job.status !== "ready")
      return res.status(404).json({ error: "Результат ещё не готов." });
    try {
      res.set({ "Content-Type": type, "Cache-Control": "private, max-age=86400, immutable" });
      res.sendFile(file, { root: path.join(root, id) });
    } catch {
      res.status(404).json({ error: "Результат не найден." });
    }
  });

app.post(
  "/api/projects/:id/model",
  requireUser,
  ifcUpload.single("model"),
  async (req, res, next) => {
    let accepted = false;
    try {
      const projects = await readJsonArray(userProjectsFile),
        project = projects.find(
          (item) => item.id === req.params.id && item.ownerId === req.user.id
        );
      if (!project) return res.status(404).json({ error: "Проект не найден." });
      const existingJob = [...jobs.values()].find(
        (item) =>
          item.projectId === project.id &&
          item.userId === req.user.id &&
          ["queued", "validating", "analyzing", "converting", "optimizing"].includes(item.status)
      );
      if (existingJob)
        return res.status(202).json({
          jobId: existingJob.id,
          status: existingJob.status,
          stage: existingJob.stage,
          alreadyProcessing: true,
        });
      const extension = path.extname(req.file?.originalname || "").toLowerCase();
      if (extension === ".glb") {
        if (req.file.size > config.maxGlbBytes)
          return res.status(413).json({ error: "GLB-файл слишком большой." });
        if (!(await validateGlbFile(req.file.path)))
          return res.status(400).json({ error: "Загрузите корректную GLB-модель." });
        await storage.moveFrom(
          req.file.path,
          `user-projects/${req.user.id}/${project.id}/model.glb`
        );
        req.file.path = null;
        let updated;
        await updateUserProjects((items) =>
          items.map((item) =>
            item.id === project.id
              ? (updated = {
                  ...item,
                  modelUrl: `/api/projects/${item.id}/model`,
                  status: "Модель готова",
                  updatedAt: new Date().toISOString(),
                })
              : item
          )
        );
        return res.status(201).json(publicProject(updated));
      }
      if (extension !== ".ifc" || !req.file || !(await validateIfcFile(req.file.path)))
        return res.status(400).json({ error: "Загрузите корректную модель IFC или GLB." });
      if (!conversionQueue.accepting)
        return res.status(503).json({ error: "Сервис конвертации временно недоступен." });
      const jobId = crypto.randomBytes(16).toString("hex"),
        directory = path.join(tempRoot, jobId),
        input = path.join(directory, "input.ifc");
      await fs.mkdir(directory, { recursive: true });
      await fs.rename(req.file.path, input);
      accepted = true;
      const job = {
        id: jobId,
        projectId: project.id,
        userId: req.user.id,
        status: "queued",
        stage: "В очереди на обработку",
        createdAt: Date.now(),
        size: req.file.size,
        ownerKey: req.user.id,
      };
      try {
        conversionQueue.enqueue(job);
      } catch (error) {
        await fs.rm(directory, { recursive: true, force: true });
        accepted = false;
        if (["QUEUE_FULL", "OWNER_QUEUE_LIMIT"].includes(error.code))
          return res
            .status(error.code === "QUEUE_FULL" ? 503 : 429)
            .json({ error: "Очередь конвертации занята. Попробуйте позже.", code: error.code });
        throw error;
      }
      await updateUserProjects((items) =>
        items.map((item) =>
          item.id === project.id
            ? { ...item, status: "Обработка IFC", updatedAt: new Date().toISOString() }
            : item
        )
      );
      res.status(202).json({ jobId, status: "processing" });
    } catch (error) {
      next(error);
    } finally {
      if (!accepted) await unlinkUpload(req.file);
    }
  }
);
app.get("/api/projects/:id/model", requireUser, async (req, res, next) => {
  try {
    const projectId = safeProjectId(req.params.id),
      userId = safeUserId(req.user.id);
    if (!projectId || !userId) return res.status(404).end();
    const project = (await readJsonArray(userProjectsFile)).find(
      (item) => item.id === projectId && item.ownerId === userId && item.modelUrl
    );
    if (!project) return res.status(404).end();
    res.sendFile(
      "model.glb",
      { root: path.join(root, "user-projects", userId, projectId) },
      (error) => {
        if (error && !res.headersSent) res.status(404).end();
      }
    );
  } catch (error) {
    next(error);
  }
});
for (const [route, file] of [
  ["metadata", "project.json"],
  ["rooms", "rooms.json"],
  ["analysis", "analysis.json"],
  ["source", "source.ifc"],
])
  app.get(`/api/projects/:id/${route}`, requireUser, async (req, res, next) => {
    try {
      const projectId = safeProjectId(req.params.id), userId = safeUserId(req.user.id);
      const project = (await readJsonArray(userProjectsFile)).find(
        (item) => item.id === projectId && item.ownerId === userId
      );
      if (!project) return res.status(404).end();
      res.set("Cache-Control", "private, no-cache");
      if (route === "source") res.set("Content-Disposition", 'attachment; filename="source.ifc"');
      res.sendFile(file, { root: path.join(root, "user-projects", userId, projectId) }, (error) => {
        if (error && !res.headersSent) res.status(404).end();
      });
    } catch (error) { next(error); }
  });
const publicRoomAsset = (room, filename, version) =>
  `/api/rooms/${room}/assets/${encodeURIComponent(filename)}${version ? `?v=${Math.trunc(version)}` : ""}`;
const projectFloorplanName = (name) => /^floorplan\.(jpg|jpeg|png|webp)$/.test(name);
const spatialProjectRoot = (projectId) =>
  projectId ? path.join(root, "project-spatial", projectId) : projectRoot;
export async function projectManifest(projectId = null) {
  const spatialRoot = spatialProjectRoot(projectId),
    calibrationFile = path.join(spatialRoot, "floorplan-calibration.json"),
    files = await fs.readdir(spatialRoot).catch(() => []),
    floorplan = files.find(projectFloorplanName);
  let calibration = null;
  try {
    const saved = JSON.parse(await fs.readFile(calibrationFile, "utf8"));
    if (saved?.version === 1) calibration = saved;
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  if (!floorplan) return { floorplanUrl: null, calibration: null };
  const modified = (await fs.stat(path.join(spatialRoot, floorplan))).mtimeMs;
  return {
    floorplanUrl: projectId
      ? `/api/project/${projectId}/floorplan/${encodeURIComponent(floorplan)}?v=${Math.trunc(modified)}`
      : `/api/project/floorplan/${encodeURIComponent(floorplan)}?v=${Math.trunc(modified)}`,
    calibration,
  };
}
app.get("/api/project", async (req, res, next) => {
  try {
    const projectId = req.query.project ? safeProjectId(req.query.project) : null;
    if (req.query.project && !projectId) return res.status(400).json({ error: "Некорректный проект." });
    res.set("Cache-Control", "no-store");
    res.json(await projectManifest(projectId));
  } catch (error) {
    next(error);
  }
});
app.get("/api/project/:projectId/floorplan/:filename", (req, res) => {
  const projectId = safeProjectId(req.params.projectId);
  if (!projectId || !projectFloorplanName(req.params.filename)) return res.status(404).end();
  res.set("Cache-Control", "public, max-age=3600");
  res.sendFile(req.params.filename, { root: spatialProjectRoot(projectId) }, (error) => {
    if (error && !res.headersSent) res.status(404).end();
  });
});
app.get("/api/project/floorplan/:filename", (req, res) => {
  if (!projectFloorplanName(req.params.filename)) return res.status(404).end();
  res.set("Cache-Control", "public, max-age=3600");
  res.sendFile(req.params.filename, { root: projectRoot }, (error) => {
    if (error && !res.headersSent) res.status(404).end();
  });
});
app.post(
  "/api/project/floorplan",
  requireUploadPassword,
  imageUpload.single("file"),
  async (req, res, next) => {
    let normalized;
    try {
      const projectId = req.query.project ? safeProjectId(req.query.project) : null,
        destinationRoot = spatialProjectRoot(projectId),
        calibrationFile = path.join(destinationRoot, "floorplan-calibration.json");
      if (req.query.project && !projectId) return res.status(400).json({ error: "Некорректный проект." });
      if (!req.file) return res.status(400).json({ error: "Выберите файл планировки." });
      normalized = `${req.file.path}.normalized`;
      const { extension: ext } = await normalizeImage(req.file.path, normalized, {
        maxWidth: config.maxImageWidth,
        maxHeight: config.maxImageHeight,
        maxPixels: config.maxImagePixels,
      });
      await fs.mkdir(destinationRoot, { recursive: true });
      for (const old of await fs.readdir(destinationRoot))
        if (projectFloorplanName(old)) await fs.rm(path.join(destinationRoot, old), { force: true });
      await fs.rm(calibrationFile, { force: true });
      await moveFile(normalized, path.join(destinationRoot, `floorplan${ext}`));
      normalized = null;
      res.status(201).json(await projectManifest(projectId));
    } catch (error) {
      next(error);
    } finally {
      await Promise.all([
        unlinkUpload(req.file),
        normalized ? fs.rm(normalized, { force: true }) : Promise.resolve(),
      ]);
    }
  }
);
app.put("/api/project/floorplan-calibration", requireUploadPassword, async (req, res, next) => {
  try {
    const projectId = req.query.project ? safeProjectId(req.query.project) : null,
      destinationRoot = spatialProjectRoot(projectId),
      calibrationFile = path.join(destinationRoot, "floorplan-calibration.json");
    if (req.query.project && !projectId) return res.status(400).json({ error: "Некорректный проект." });
    const calibration = req.body,
      matrix = calibration?.matrix,
      values = matrix && ["a", "b", "c", "d", "e", "f"].map((key) => Number(matrix[key])),
      determinant = values ? values[0] * values[4] - values[1] * values[3] : 0;
    if (
      calibration?.version !== 1 ||
      !values ||
      values.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e9) ||
      Math.abs(determinant) < 1e-10 ||
      !Array.isArray(calibration.imagePoints) ||
      !Array.isArray(calibration.worldPoints) ||
      calibration.imagePoints.length !== 3 ||
      calibration.worldPoints.length !== 3
    )
      return res.status(400).json({ error: "Некорректные данные привязки планировки." });
    const pointsAreValid = [...calibration.imagePoints, ...calibration.worldPoints].every(
      (point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.z))
    );
    if (!pointsAreValid)
      return res.status(400).json({ error: "Точки привязки должны содержать координаты X и Z." });
    const saved = {
      version: 1,
      coordinateSpace: "model-world-v1",
      matrix: Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((key, index) => [key, values[index]])),
      imagePoints: calibration.imagePoints.map(({ x, z }) => ({ x: Number(x), z: Number(z) })),
      worldPoints: calibration.worldPoints.map(({ x, z }) => ({ x: Number(x), z: Number(z) })),
      floorY: Number.isFinite(Number(calibration.floorY)) ? Number(calibration.floorY) : 0,
      modelKey: String(calibration.modelKey || "").slice(0, 200),
      updatedAt: new Date().toISOString(),
    };
    await fs.mkdir(destinationRoot, { recursive: true });
    const temporary = `${calibrationFile}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(saved, null, 2), { mode: 0o640 });
    await fs.rename(temporary, calibrationFile);
    res.json(saved);
  } catch (error) {
    next(error);
  }
});
async function saveRooms() {
  await fs.mkdir(root, { recursive: true });
  const temporary = `${roomsFile}.${crypto.randomBytes(5).toString("hex")}.tmp`;
  await fs.writeFile(temporary, JSON.stringify([...roomCatalog.values()], null, 2), {
    mode: 0o640,
  });
  await fs.rename(temporary, roomsFile);
}
async function readRoomMedia(room) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(roomRoot, room, "media.json"), "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return [];
    throw error;
  }
}
async function writeRoomMedia(room, media) {
  const dir = path.join(roomRoot, room);
  await fs.mkdir(dir, { recursive: true });
  const temporary = path.join(dir, `media-${crypto.randomBytes(5).toString("hex")}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(media, null, 2), { mode: 0o640 });
  await fs.rename(temporary, path.join(dir, "media.json"));
}
export async function roomManifest(room) {
  const dir = path.join(roomRoot, room);
  const files = await fs.readdir(dir).catch(() => []);
  const floorplan = files.find((name) => name.startsWith("floorplan."));
  const model = files.includes("model.glb") ? "model.glb" : null;
  const renderFiles = files.filter((name) =>
    /^render-[a-f0-9]{16}\.(jpg|jpeg|png|webp)$/.test(name)
  );
  const photoFiles = files.filter((name) => /^photo-[a-f0-9]{16}\.(jpg|jpeg|png|webp)$/.test(name));
  const datedRenders = await Promise.all(
    renderFiles.map(async (name) => ({
      name,
      modified: (await fs.stat(path.join(dir, name))).mtimeMs,
    }))
  );
  const floorplanModified = floorplan ? (await fs.stat(path.join(dir, floorplan))).mtimeMs : null;
  const modelModified = model ? (await fs.stat(path.join(dir, model))).mtimeMs : null;
  const metadata = await readRoomMedia(room);
  const photos = await Promise.all(
    photoFiles.map(async (name) => {
      const modified = (await fs.stat(path.join(dir, name))).mtimeMs,
        saved = metadata.find((item) => item.filename === name) || {};
      return {
        id: saved.id || path.parse(name).name,
        roomId: room,
        url: publicRoomAsset(room, name, modified),
        thumbnailUrl: publicRoomAsset(room, name, modified),
        type: saved.type || "other",
        date: saved.date || new Date(modified).toISOString().slice(0, 10),
        comment: saved.comment || "",
        createdAt: saved.createdAt || new Date(modified).toISOString(),
      };
    })
  );
  return {
    floorplanUrl: floorplan ? publicRoomAsset(room, floorplan, floorplanModified) : null,
    modelUrl: model ? publicRoomAsset(room, model, modelModified) : null,
    renderUrls: datedRenders
      .sort((a, b) => a.modified - b.modified || a.name.localeCompare(b.name))
      .map(({ name, modified }) => publicRoomAsset(room, name, modified)),
    photos: photos.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    photoUrls: photos.map(({ url }) => url),
  };
}
app.get("/api/rooms", (_, res) => {
  res.set("Cache-Control", "no-store");
  res.json([...roomCatalog.values()]);
});
app.post("/api/rooms", requireUploadPassword, async (req, res, next) => {
  try {
    const name = plainLabel(req.body.name, 60),
      area = Number(req.body.area || 0),
      allowedIcons = new Set([
        "living-room",
        "kitchen",
        "kitchen-living",
        "bedroom",
        "nursery",
        "office",
        "bathroom",
        "toilet",
        "entryway",
        "hallway",
        "wardrobe",
        "pantry",
        "laundry",
        "balcony",
        "terrace",
      ]),
      icon = allowedIcons.has(req.body.icon) ? req.body.icon : "living-room",
      description = plainLabel(req.body.description, 500);
    if (!name || name.length > 60 || area < 0 || area > 10000)
      return res.status(400).json({ error: "Укажите название комнаты и корректную площадь." });
    const translit = {
      а: "a",
      б: "b",
      в: "v",
      г: "g",
      д: "d",
      е: "e",
      ё: "e",
      ж: "zh",
      з: "z",
      и: "i",
      й: "y",
      к: "k",
      л: "l",
      м: "m",
      н: "n",
      о: "o",
      п: "p",
      р: "r",
      с: "s",
      т: "t",
      у: "u",
      ф: "f",
      х: "h",
      ц: "ts",
      ч: "ch",
      ш: "sh",
      щ: "sch",
      ы: "y",
      э: "e",
      ю: "yu",
      я: "ya",
    };
    const base =
      [...name.toLowerCase()]
        .map((letter) => translit[letter] || letter)
        .join("")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 34) || "room";
    let slug = base,
      suffix = 2;
    while ([...roomCatalog.values()].some((room) => room.slug === slug))
      slug = `${base}-${suffix++}`;
    const id = slug,
      room = { id, slug, name, area, icon, description, createdAt: new Date().toISOString() };
    roomCatalog.set(id, room);
    roomIds.add(id);
    await saveRooms();
    await fs.mkdir(path.join(roomRoot, id), { recursive: true });
    res.status(201).json(room);
  } catch (error) {
    next(error);
  }
});
app.patch("/api/rooms/:room", requireUploadPassword, async (req, res, next) => {
  try {
    const current = roomCatalog.get(req.params.room);
    if (!current) return res.status(404).json({ error: "Комната не найдена." });
    const name = plainLabel(req.body.name, 60),
      description = plainLabel(req.body.description, 500),
      area = Number(req.body.area),
      allowedIcons = new Set([
        "living-room",
        "kitchen",
        "kitchen-living",
        "bedroom",
        "nursery",
        "office",
        "bathroom",
        "toilet",
        "entryway",
        "hallway",
        "wardrobe",
        "pantry",
        "laundry",
        "balcony",
        "terrace",
      ]),
      icon = allowedIcons.has(req.body.icon) ? req.body.icon : current.icon;
    if (!name || !Number.isFinite(area) || area < 0 || area > 10000)
      return res.status(400).json({ error: "Укажите название комнаты и корректную площадь." });
    const room = { ...current, name, area, icon, description };
    roomCatalog.set(room.id, room);
    await saveRooms();
    res.json(room);
  } catch (error) {
    next(error);
  }
});
app.delete("/api/rooms/:room", requireUploadPassword, async (req, res, next) => {
  try {
    if (!roomCatalog.has(req.params.room))
      return res.status(404).json({ error: "Комната не найдена." });
    roomCatalog.delete(req.params.room);
    roomIds.delete(req.params.room);
    await saveRooms();
    await fs.rm(path.join(roomRoot, req.params.room), { recursive: true, force: true });
    await updateNotes((notes) => notes.filter((note) => note.roomId !== req.params.room));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.get("/api/rooms/:room", async (req, res) => {
  if (!roomIds.has(req.params.room)) return res.status(404).json({ error: "Комната не найдена." });
  res.set("Cache-Control", "no-store");
  res.json(await roomManifest(req.params.room));
});
app.get("/api/rooms/:room/assets/:filename", (req, res) => {
  if (
    !roomIds.has(req.params.room) ||
    !/^(floorplan\.(jpg|jpeg|png|webp)|model\.glb|(render|photo)-[a-f0-9]{16}\.(jpg|jpeg|png|webp))$/.test(
      req.params.filename
    )
  )
    return res.status(404).end();
  res.set("Cache-Control", "public, max-age=3600");
  res.sendFile(req.params.filename, { root: path.join(roomRoot, req.params.room) }, (error) => {
    if (error && !res.headersSent) res.status(404).end();
  });
});
app.post(
  "/api/rooms/:room/assets/:kind",
  requireUploadPassword,
  (req, res, next) =>
    (req.params.kind === "model" ? glbUpload : imageUpload).single("file")(req, res, next),
  async (req, res, next) => {
    let normalized;
    try {
      const { room, kind } = req.params;
      if (!roomIds.has(room)) return res.status(404).json({ error: "Комната не найдена." });
      if (!req.file || !["floorplan", "render", "photo", "model"].includes(kind))
        return res.status(400).json({ error: "Выберите тип материала и файл." });
      let ext;
      if (kind === "model") {
        ext = ".glb";
        if (
          path.extname(req.file.originalname).toLowerCase() !== ext ||
          !(await validateGlbFile(req.file.path))
        )
          return res.status(400).json({ error: "Для модели комнаты нужен корректный файл GLB." });
      } else {
        normalized = `${req.file.path}.normalized`;
        ({ extension: ext } = await normalizeImage(req.file.path, normalized, {
          maxWidth: config.maxImageWidth,
          maxHeight: config.maxImageHeight,
          maxPixels: config.maxImagePixels,
        }));
      }
      const dir = path.join(roomRoot, room);
      await fs.mkdir(dir, { recursive: true });
      let filename;
      if (kind === "floorplan") {
        for (const old of await fs.readdir(dir))
          if (old.startsWith("floorplan.")) await fs.rm(path.join(dir, old), { force: true });
        filename = `floorplan${ext}`;
      } else if (kind === "model") filename = "model.glb";
      else filename = `${kind}-${crypto.randomBytes(8).toString("hex")}${ext}`;
      await moveFile(kind === "model" ? req.file.path : normalized, path.join(dir, filename));
      if (kind === "model") req.file.path = null;
      else normalized = null;
      if (kind === "photo") {
        const allowedTypes = new Set(["construction", "completed", "defect", "control", "other"]),
          media = await readRoomMedia(room),
          createdAt = new Date().toISOString();
        media.push({
          id: path.parse(filename).name,
          filename,
          roomId: room,
          type: allowedTypes.has(req.body.type) ? req.body.type : "other",
          date: /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || "")
            ? req.body.date
            : createdAt.slice(0, 10),
          comment: String(req.body.comment || "")
            .trim()
            .slice(0, 500),
          createdAt,
        });
        await writeRoomMedia(room, media);
      }
      res.status(201).json(await roomManifest(room));
    } catch (error) {
      next(error);
    } finally {
      await Promise.all([
        unlinkUpload(req.file),
        normalized ? fs.rm(normalized, { force: true }) : Promise.resolve(),
      ]);
    }
  }
);
export async function deleteRoomAsset(room, filename) {
  if (
    !roomIds.has(room) ||
    !/^(floorplan\.(jpg|jpeg|png|webp)|model\.glb|(render|photo)-[a-f0-9]{16}\.(jpg|jpeg|png|webp))$/.test(
      filename
    )
  )
    return false;
  try {
    await fs.unlink(path.join(roomRoot, room, filename));
    if (filename.startsWith("photo-"))
      await writeRoomMedia(
        room,
        (await readRoomMedia(room)).filter((item) => item.filename !== filename)
      );
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
app.delete("/api/rooms/:room/assets/:filename", requireUploadPassword, async (req, res, next) => {
  try {
    const { room, filename } = req.params;
    if (!(await deleteRoomAsset(room, filename)))
      return res.status(404).json({ error: "Материал не найден." });
    res.json(await roomManifest(room));
  } catch (error) {
    next(error);
  }
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
const noteProjectId = (req) => (req.query.project ? safeProjectId(req.query.project) : null);
app.get("/api/notes", async (req, res, next) => {
  try {
    const projectId = noteProjectId(req);
    if (req.query.project && !projectId) return res.status(400).json({ error: "Некорректный проект." });
    res.json((await readNotes()).filter((note) => (note.projectId || null) === projectId));
  } catch (error) {
    next(error);
  }
});
app.post("/api/notes", requireUploadPassword, async (req, res, next) => {
  try {
    const projectId = noteProjectId(req);
    if (req.query.project && !projectId) return res.status(400).json({ error: "Некорректный проект." });
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!text || text.length > 500)
      return res.status(400).json({ error: "Заметка должна содержать от 1 до 500 символов." });
    const roomId = roomIds.has(req.body.roomId) ? req.body.roomId : null;
    const coordinateSpace = req.body.coordinateSpace === "model-world-v1" ? "model-world-v1" : "legacy-normalized-v1";
    const position =
      req.body.position &&
      ["x", "y", "z"].every((key) => Number.isFinite(Number(req.body.position[key])))
        ? Object.fromEntries(["x", "y", "z"].map((key) => [key, Number(req.body.position[key])]))
        : { x: 0.5, y: 0.5, z: 0.5 };
    if (
      coordinateSpace === "legacy-normalized-v1" &&
      Object.values(position).some((value) => value < 0 || value > 1)
    )
      return res.status(400).json({ error: "Некорректная нормализованная позиция пина." });
    if (Object.values(position).some((value) => Math.abs(value) > 1e7))
      return res.status(400).json({ error: "Координаты пина выходят за допустимые пределы." });
    const note = {
      id: crypto.randomBytes(12).toString("hex"),
      text,
      projectId,
      roomId,
      position,
      coordinateSpace,
      status: "new",
      createdAt: new Date().toISOString(),
    };
    await updateNotes((notes) => [...notes, note]);
    res.status(201).json(note);
  } catch (error) {
    next(error);
  }
});
app.patch("/api/notes/:id", requireUploadPassword, async (req, res, next) => {
  try {
    const projectId = noteProjectId(req);
    if (req.query.project && !projectId) return res.status(400).json({ error: "Некорректный проект." });
    if (!/^[a-f0-9]{24}$/.test(req.params.id))
      return res.status(404).json({ error: "Заметка не найдена." });
    const source = req.body.position,
      values = source && ["x", "y", "z"].map((key) => Number(source[key])),
      requestedStatus = ["new", "resolved"].includes(req.body.status) ? req.body.status : null;
    const coordinateSpace = req.body.coordinateSpace === "model-world-v1" ? "model-world-v1" : null;
    if (!values && !requestedStatus)
      return res.status(400).json({ error: "Укажите положение или статус пина." });
    if (values && values.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e7))
      return res.status(400).json({ error: "Некорректная позиция пина." });
    let updated;
    await updateNotes((notes) =>
      notes.map((note) =>
        note.id === req.params.id && (note.projectId || null) === projectId
          ? (updated = {
              ...note,
              ...(values
                ? {
                    position: { x: values[0], y: values[1], z: values[2] },
                    coordinateSpace: coordinateSpace || note.coordinateSpace || "legacy-normalized-v1",
                  }
                : {}),
              ...(requestedStatus ? { status: requestedStatus, updatedAt: new Date().toISOString() } : {}),
            })
          : note
      )
    );
    if (!updated) return res.status(404).json({ error: "Заметка не найдена." });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});
app.delete("/api/notes/:id", requireUploadPassword, async (req, res, next) => {
  try {
    const projectId = noteProjectId(req);
    if (req.query.project && !projectId) return res.status(400).json({ error: "Некорректный проект." });
    if (!/^[a-f0-9]{24}$/.test(req.params.id))
      return res.status(404).json({ error: "Заметка не найдена." });
    let removed = false;
    const notes = await updateNotes((current) =>
      current.filter((note) => {
        if (note.id === req.params.id && (note.projectId || null) === projectId) {
          removed = true;
          return false;
        }
        return true;
      })
    );
    if (!removed) return res.status(404).json({ error: "Заметка не найдена." });
    res.json(notes.filter((note) => (note.projectId || null) === projectId));
  } catch (error) {
    next(error);
  }
});
app.get("/health", (_, res) => res.json({ ok: true }));
app.use("/api", (req, res) =>
  res.status(404).json({ error: "API endpoint не найден.", code: "NOT_FOUND", requestId: req.id })
);
app.use((error, req, res, __) => {
  const isLimit = error.code === "LIMIT_FILE_SIZE",
    status = isLimit ? 413 : Number(error.status) || (error instanceof SyntaxError ? 400 : 500),
    code = isLimit ? "UPLOAD_TOO_LARGE" : status === 400 ? "BAD_REQUEST" : "INTERNAL_ERROR";
  log("error", "request_failed", {
    requestId: req.id,
    method: req.method,
    path: req.path,
    status,
    code: error.code || code,
  });
  res.status(status).json({
    error: isLimit
      ? "Размер файла превышает допустимый лимит."
      : status >= 500
        ? "Внутренняя ошибка сервера."
        : "Некорректный запрос.",
    code,
    requestId: req.id,
  });
});
setInterval(async () => {
  const now = Date.now();
  for (const [id, job] of jobs)
    if (now - job.createdAt > ttlMs && ["ready", "failed"].includes(job.status)) {
      conversionQueue.delete(id);
      await storage
        .delete(id, { recursive: true })
        .catch((error) => log("error", "result_cleanup_failed", { jobId: id, code: error.code }));
    }
}, 3600_000).unref();
setInterval(
  () =>
    updateAuth(async () =>
      writeJsonArray(
        sessionsFile,
        (await readJsonArray(sessionsFile)).filter((session) => session.expiresAt > Date.now())
      )
    ).catch((error) => log("error", "session_cleanup_failed", { code: error.code })),
  3600_000
).unref();

let httpServer;
async function start() {
  await Promise.all([
    fs.mkdir(roomRoot, { recursive: true }),
    fs.mkdir(tempRoot, { recursive: true }),
  ]);
  for (const entry of await fs.readdir(tempRoot)) {
    await fs.rm(path.join(tempRoot, entry), { recursive: true, force: true });
  }
  const port = config.port,
    host = config.host;
  httpServer = app.listen(port, host, () =>
    log("info", "server_started", { port, host, nodeEnv, storageDriver, maxConcurrent })
  );
}
async function shutdown(signal) {
  if (!conversionQueue.accepting) return;
  conversionQueue.stop();
  log("info", "shutdown_started", {
    signal,
    running: conversionQueue.running,
    queued: conversionQueue.size,
  });
  httpServer?.close();
  const deadline = Date.now() + config.shutdownTimeoutMs;
  while (conversionQueue.running && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 200));
  if (conversionQueue.running) {
    for (const child of activeChildren) child.kill("SIGTERM");
    const killDeadline = Date.now() + 3_000;
    while (conversionQueue.running && Date.now() < killDeadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    for (const child of activeChildren) child.kill("SIGKILL");
  }
  log("info", "shutdown_completed", { running: conversionQueue.running });
  process.exit(0);
}
if (process.argv[1]?.endsWith("index.js")) {
  start().catch((error) => {
    log("error", "startup_failed", { code: error.code || "STARTUP_FAILED" });
    process.exit(1);
  });
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
