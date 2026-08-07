import fs from "node:fs/promises";
import sharp from "sharp";

export async function validateIfcFile(file) {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    return /^ISO-10303-21\s*;/i.test(text) && /HEADER\s*;/i.test(text) && /FILE_SCHEMA\s*\(\s*\(\s*['"]IFC(?:2X3|4(?:X[123])?)['"]/i.test(text);
  } finally { await handle.close(); }
}

export async function validateGlbFile(file, { maxJsonBytes = 8 * 1024 * 1024 } = {}) {
  const stat = await fs.stat(file);
  if (stat.size < 20) return false;
  const handle = await fs.open(file, "r");
  try {
    const header = Buffer.alloc(12); await handle.read(header, 0, 12, 0);
    if (header.toString("ascii", 0, 4) !== "glTF" || header.readUInt32LE(4) !== 2 || header.readUInt32LE(8) !== stat.size) return false;
    let offset = 12, first = true;
    while (offset < stat.size) {
      if (offset + 8 > stat.size) return false;
      const chunk = Buffer.alloc(8); await handle.read(chunk, 0, 8, offset);
      const length = chunk.readUInt32LE(0), type = chunk.readUInt32LE(4);
      if (length % 4 !== 0 || offset + 8 + length > stat.size) return false;
      if (first) {
        if (type !== 0x4e4f534a || length === 0 || length > maxJsonBytes) return false;
        const json = Buffer.alloc(length); await handle.read(json, 0, length, offset + 8);
        try { JSON.parse(json.toString("utf8").trimEnd()); } catch { return false; }
      } else if (type !== 0x004e4942) return false;
      first = false; offset += 8 + length;
    }
    return !first && offset === stat.size;
  } finally { await handle.close(); }
}

export async function normalizeImage(input, output, limits) {
  const image = sharp(input, { limitInputPixels: limits.maxPixels, sequentialRead: true, failOn: "warning" });
  const metadata = await image.metadata();
  if (!["jpeg", "png", "webp"].includes(metadata.format) || !metadata.width || !metadata.height || metadata.width > limits.maxWidth || metadata.height > limits.maxHeight || metadata.width * metadata.height > limits.maxPixels) throw Object.assign(new Error("Unsupported or oversized image"), { status: 400, code: "INVALID_IMAGE" });
  const format = metadata.format === "jpeg" ? "jpeg" : metadata.format;
  await image.rotate()[format]().toFile(output);
  return { extension: format === "jpeg" ? ".jpg" : `.${format}` };
}
