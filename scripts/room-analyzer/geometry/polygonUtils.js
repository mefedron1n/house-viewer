export function polygonArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index],
      next = points[(index + 1) % points.length];
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(sum) / 2;
}

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [xi, zi] = polygon[index],
      [xj, zj] = polygon[previous];
    if (
      zi > point[1] !== zj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - zi)) / (zj - zi || Number.EPSILON) + xi
    )
      inside = !inside;
  }
  return inside;
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0],
    dz = end[1] - start[1];
  if (!dx && !dz) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / (dx * dx + dz * dz))
  );
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dz));
}

export function simplifyPolygon(points, tolerance) {
  if (points.length < 4) return points;
  const simplify = (values) => {
    let max = 0,
      split = 0;
    for (let index = 1; index < values.length - 1; index++) {
      const distance = distanceToSegment(values[index], values[0], values.at(-1));
      if (distance > max) {
        max = distance;
        split = index;
      }
    }
    if (max <= tolerance) return [values[0], values.at(-1)];
    const left = simplify(values.slice(0, split + 1)),
      right = simplify(values.slice(split));
    return [...left.slice(0, -1), ...right];
  };
  const closed = [...points, points[0]],
    result = simplify(closed);
  result.pop();
  return result;
}

export function polygonBounds(polygon) {
  const xs = polygon.map(([x]) => x),
    zs = polygon.map(([, z]) => z);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}
