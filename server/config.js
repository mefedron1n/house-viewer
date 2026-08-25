import "dotenv/config";
import path from "node:path";

const env = process.env;
const nodeEnv = env.NODE_ENV || "development";
if (!["development", "test", "production"].includes(nodeEnv))
  throw new Error("NODE_ENV must be development, test, or production");

function integer(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = env[name] === undefined || env[name] === "" ? fallback : Number(env[name]);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}
function origins() {
  const raw = env.ALLOWED_ORIGINS || env.CORS_ORIGINS || env.FRONTEND_ORIGIN || "";
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const value of values) {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== value)
      throw new Error(`Invalid ALLOWED_ORIGINS entry: ${value}`);
  }
  return values;
}
function hosts() {
  const values = String(env.ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (values.some((value) => !/^[a-z0-9.-]+(?::\d{1,5})?$/.test(value)))
    throw new Error("ALLOWED_HOSTS contains an invalid host");
  return values;
}

const isProduction = nodeEnv === "production";
if (isProduction && !env.UPLOAD_PASSWORD)
  throw new Error("UPLOAD_PASSWORD is required in production");
const allowedOrigins = origins();
if (isProduction && allowedOrigins.length === 0)
  throw new Error("ALLOWED_ORIGINS is required in production");
const allowedHosts = hosts();
if (isProduction && allowedHosts.length === 0)
  throw new Error("ALLOWED_HOSTS is required in production");

export const config = Object.freeze({
  nodeEnv,
  isProduction,
  port: integer("PORT", 3001, { min: 1, max: 65535 }),
  host: env.HOST || "0.0.0.0",
  allowedOrigins,
  allowedHosts,
  trustProxyHops: integer("TRUST_PROXY_HOPS", 0, { max: 10 }),
  storageDriver: env.STORAGE_DRIVER || "local",
  storageRoot: path.resolve(env.MODEL_STORAGE_DIR || "./data/models"),
  tempRoot: path.resolve(env.TEMP_DIR || "./data/tmp"),
  uploadPassword: env.UPLOAD_PASSWORD || "",
  ifcConvertPath: env.IFC_CONVERT_PATH || "IfcConvert",
  pythonPath: env.PYTHON_PATH || "python3",
  maxIfcBytes: integer("MAX_IFC_UPLOAD_MB", 100, { min: 1, max: 2048 }) * 1024 * 1024,
  maxGlbBytes: integer("MAX_GLB_UPLOAD_MB", 100, { min: 1, max: 2048 }) * 1024 * 1024,
  maxImageBytes: integer("MAX_IMAGE_UPLOAD_MB", 15, { min: 1, max: 100 }) * 1024 * 1024,
  maxImageWidth: integer("MAX_IMAGE_WIDTH", 10000, { min: 1, max: 50000 }),
  maxImageHeight: integer("MAX_IMAGE_HEIGHT", 10000, { min: 1, max: 50000 }),
  maxImagePixels: integer("MAX_IMAGE_PIXELS", 40_000_000, { min: 1, max: 250_000_000 }),
  jsonLimit: env.JSON_BODY_LIMIT || "32kb",
  conversionTimeoutMs: integer("CONVERSION_TIMEOUT_MS", 300000, { min: 1000, max: 3600000 }),
  maxConcurrentConversions: integer("MAX_CONCURRENT_CONVERSIONS", 1, { min: 1, max: 16 }),
  maxConversionQueue: integer("MAX_CONVERSION_QUEUE", 10, { min: 0, max: 1000 }),
  maxUserConversionJobs: integer("MAX_USER_CONVERSION_JOBS", 2, { min: 1, max: 100 }),
  modelTtlMs: integer("MODEL_TTL_HOURS", 24, { min: 1, max: 8760 }) * 3600_000,
  tempTtlMs: integer("TEMP_FILE_TTL_HOURS", 24, { min: 1, max: 168 }) * 3600_000,
  sessionMaxAgeMs: integer("SESSION_MAX_AGE_HOURS", 720, { min: 1, max: 8760 }) * 3600_000,
  shutdownTimeoutMs: integer("SHUTDOWN_TIMEOUT_MS", 15000, { min: 1000, max: 120000 }),
  apiRate: {
    windowMs: integer("API_RATE_LIMIT_WINDOW_MS", 900000, { min: 1000 }),
    max: integer("API_RATE_LIMIT_MAX", 300, { min: 1 }),
  },
  loginRate: {
    windowMs: integer("LOGIN_RATE_LIMIT_WINDOW_MS", 900000, { min: 1000 }),
    max: integer("LOGIN_RATE_LIMIT_MAX", 10, { min: 1 }),
  },
  registerRate: {
    windowMs: integer("REGISTER_RATE_LIMIT_WINDOW_MS", 3600000, { min: 1000 }),
    max: integer("REGISTER_RATE_LIMIT_MAX", 5, { min: 1 }),
  },
  conversionRate: {
    windowMs: integer("CONVERSION_RATE_LIMIT_WINDOW_MS", 3600000, { min: 1000 }),
    max: integer("CONVERSION_RATE_LIMIT_MAX", 5, { min: 1 }),
  },
});
