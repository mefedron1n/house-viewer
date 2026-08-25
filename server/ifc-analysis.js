import { spawn } from "node:child_process";

const TYPE_PATTERNS = {
  door: [/\bdoor\b/i, /двер/i, /(?:^|\s)дв[-\s]?\d/i],
  window: [/\bwindow\b/i, /окн/i],
  wall: [/\bwall\b/i, /стен/i, /перегород/i],
  floor: [/\bfloor\b/i, /\bslab\b/i, /перекрыт/i, /(?:^|\s)пол(?:ы|а|у|ом|е)?(?:\s|$)/i],
  ceiling: [/\bceiling\b/i, /потол/i, /натяжное полотно/i],
  roof: [/\broof\b/i, /крыш/i, /кровл/i],
  column: [/\bcolumn\b/i, /колонн/i],
  furniture: [/\bfurniture\b/i, /мебел/i],
};

export function resolveProxyType(element = {}) {
  const fields = [
    ["name", element.name],
    ["objectType", element.objectType],
    ["tag", element.tag],
    ["predefinedType", element.predefinedType],
    ["classification", element.classification],
    ["material", element.material],
    ["property", element.properties && JSON.stringify(element.properties)],
  ];
  const scores = new Map();
  for (const [source, raw] of fields) {
    const value = String(raw || "").toLocaleLowerCase("ru");
    for (const [type, patterns] of Object.entries(TYPE_PATTERNS)) {
      if (!patterns.some((pattern) => pattern.test(value))) continue;
      const item = scores.get(type) || { score: 0, source: [] };
      item.score += source === "classification" ? 0.55 : source === "property" ? 0.35 : 0.45;
      if (!item.source.includes(source)) item.source.push(source);
      scores.set(type, item);
    }
  }
  const [textType, textMatch] = [...scores.entries()].sort(
    (a, b) => b[1].score - a[1].score
  )[0] || [];
  if (textType)
    return {
      type: textType,
      confidence: Math.min(0.98, textMatch.score),
      source: textMatch.source,
    };
  const bounds = element.bounds;
  if (bounds) {
    const size = bounds.max.map((value, index) => Math.abs(value - bounds.min[index])),
      height = size[1],
      horizontal = [size[0], size[2]].sort((a, b) => a - b),
      thickness = horizontal[0],
      length = horizontal[1];
    if (height >= 1.8 && thickness <= 0.7 && length >= 1.6)
      return { type: "wall", confidence: 0.58, source: ["geometry"] };
    if (height >= 1.8 && height <= 3.2 && thickness <= 0.35 && length >= 0.55 && length < 1.6)
      return { type: "door", confidence: 0.48, source: ["geometry"] };
  }
  return { type: "other", confidence: 0.15, source: [] };
}

export function linkNearbyElements(rooms = [], elements = [], { cellSize = 4, tolerance = 0.2 } = {}) {
  const grid = new Map(), supported = new Set(["wall", "door", "window", "floor", "ceiling"]);
  const cells = (bounds, padding = 0) => {
    const result = [];
    for (let x = Math.floor((bounds.min[0] - padding) / cellSize); x <= Math.floor((bounds.max[0] + padding) / cellSize); x++)
      for (let z = Math.floor((bounds.min[2] - padding) / cellSize); z <= Math.floor((bounds.max[2] + padding) / cellSize); z++) result.push(`${x}:${z}`);
    return result;
  };
  for (const element of elements) {
    if (!element.bounds || !supported.has(element.resolvedType)) continue;
    for (const key of cells(element.bounds)) {
      const bucket = grid.get(key) || [];
      bucket.push(element); grid.set(key, bucket);
    }
  }
  for (const room of rooms) {
    if (!room.bounds) continue;
    const candidates = new Set(cells(room.bounds, tolerance).flatMap((key) => grid.get(key) || []));
    for (const element of candidates) {
      const a = room.bounds, b = element.bounds;
      const verticalOverlap = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
      const dx = Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0], 0);
      const dz = Math.max(a.min[2] - b.max[2], b.min[2] - a.max[2], 0);
      if (verticalOverlap < -tolerance || Math.hypot(dx, dz) > tolerance) continue;
      linkBoundary(room, element);
    }
  }
}

export function isUsableRoom(space, spaces = []) {
  const name = `${space?.name || ""} ${space?.longName || ""}`.trim().toLocaleLowerCase("ru");
  if (!space || space.area === 0 || /^(общая площадь|total area|gross area)$/i.test(name)) return false;
  if (!space.bounds) return true;
  const volume = (bounds) => bounds.max.reduce((n, value, index) => n * Math.max(0, value - bounds.min[index]), 1);
  const ownVolume = volume(space.bounds);
  if (!ownVolume) return true;
  const contained = spaces.filter((other) => {
    if (other === space || !other.bounds) return false;
    const intersection = other.bounds.min.map((value, index) => [
      Math.max(value, space.bounds.min[index]),
      Math.min(other.bounds.max[index], space.bounds.max[index]),
    ]);
    const overlap = intersection.reduce((n, [min, max]) => n * Math.max(0, max - min), 1);
    return overlap / Math.max(volume(other.bounds), 1e-9) > 0.9;
  });
  return contained.length < 2;
}

export function linkBoundary(room, element) {
  room.boundaryElementIds ||= [];
  element.adjacentRoomIds ||= [];
  if (!room.boundaryElementIds.includes(element.id)) room.boundaryElementIds.push(element.id);
  if (!element.adjacentRoomIds.includes(room.id)) element.adjacentRoomIds.push(room.id);
  const field = { wall: "wallIds", door: "doorIds", window: "windowIds", floor: "floorIds", ceiling: "ceilingIds" }[element.resolvedType];
  if (field) {
    room[field] ||= [];
    if (!room[field].includes(element.id)) room[field].push(element.id);
  }
}

export function buildRoomConnections(elements = []) {
  const result = [], seen = new Set();
  for (const element of elements) {
    if (!["door", "wall"].includes(element.resolvedType)) continue;
    const rooms = [...new Set(element.adjacentRoomIds || [])];
    for (let left = 0; left < rooms.length; left++) for (let right = left + 1; right < rooms.length; right++) {
      const pair = [rooms[left], rooms[right]].sort(), type = element.resolvedType === "door" ? "door" : "adjacent", key = `${pair.join(":")}:${type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ roomA: pair[0], roomB: pair[1], viaElementId: element.id, type });
    }
  }
  return result;
}

export function runIfcAnalyzer(input, output, { python = "python3", timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [new URL("./python/analyze_ifc.py", import.meta.url).pathname, input, output], {
      shell: false,
      windowsHide: true,
    });
    let stderr = "", settled = false;
    child.stderr.on("data", (chunk) => (stderr = `${stderr}${chunk}`.slice(-6000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (error) => finish(error));
    child.on("close", (code) =>
      finish(code === 0 ? null : Object.assign(new Error("IFC analyzer failed"), { code: "IFC_ANALYSIS_FAILED", stderr }))
    );
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    }
  });
}
