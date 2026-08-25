import * as THREE from "three";
import {
  pointInPolygon,
  polygonArea,
  polygonBounds,
  simplifyPolygon,
} from "./geometry/polygonUtils.js";
import { assignRoomNames, classifyRoom } from "./classification/classifyRoom.js";

const defaults = {
  mode: "fast",
  sliceHeight: 1.2,
  unitScale: 1,
  minRoomArea: 1.5,
  maxGridCells: 220,
  minResolution: 0.04,
  maxResolution: 0.18,
  estimatedRoomHeight: 2.8,
  debugRooms: false,
};
const architecturalName =
  /wall|стен|partition|перегород|column|колон|door|двер|window|окн|slab|floor|пол|ceiling|потол|ifcwall|ifcslab/i;
const doorName = /door|двер|opening|про[её]м/i;
const spaceName = /ifcspace|space|room|помещ|комнат/i;

export class RoomAnalyzer {
  constructor(options = {}) {
    this.options = { ...defaults, ...options };
    this.debugGroup = null;
  }
  analyze(model) {
    try {
      model.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(model),
        size = bounds.getSize(new THREE.Vector3());
      if (bounds.isEmpty() || !Number.isFinite(size.length())) return this.failure("EMPTY_MODEL");
      const floorY = this.detectFloor(model, bounds),
        ceilingY = this.detectCeiling(model, floorY, bounds),
        resolution = THREE.MathUtils.clamp(
          Math.max(size.x, size.z) / this.options.maxGridCells,
          this.options.minResolution,
          this.options.maxResolution
        );
      const grid = this.createOccupancy(
        model,
        bounds,
        floorY + this.options.sliceHeight / this.options.unitScale,
        resolution
      );
      let candidates = this.detectComponents(grid, bounds, resolution).filter(
        (room) => room.area * this.options.unitScale ** 2 >= this.options.minRoomArea
      );
      if (!candidates.length) candidates = this.detectSpaceNodes(model, floorY, ceilingY);
      if (!candidates.length)
        return this.failure("ROOM_DETECTION_FAILED", { floorY, ceilingY, bounds, grid });
      candidates.sort((a, b) => a.center.z - b.center.z || a.center.x - b.center.x);
      const meshes = [];
      model.traverse((object) => {
        if (object.isMesh) meshes.push(object);
      });
      const rooms = candidates.map((candidate, index) => ({
        ...candidate,
        area: candidate.area * this.options.unitScale ** 2,
        id: `room_${String(index + 1).padStart(3, "0")}`,
        floorY,
        ceilingY,
        objectIds: [],
        type: "unknown",
        confidence: 0.2,
      }));
      this.assignObjects(meshes, rooms);
      for (const room of rooms) {
        const objects = meshes.filter((mesh) =>
            room.objectIds.includes(mesh.userData.roomAnalyzerId)
          ),
          classification = classifyRoom(objects);
        Object.assign(room, classification);
      }
      assignRoomNames(rooms);
      const confidence = rooms.reduce((sum, room) => sum + room.confidence, 0) / rooms.length;
      const result = {
        success: true,
        version: 1,
        mode: this.options.mode,
        axis: "Y",
        unitScale: this.options.unitScale,
        buildingMinY: bounds.min.y,
        buildingMaxY: bounds.max.y,
        buildingHeight: size.y,
        floorY,
        ceilingY,
        resolution,
        analysisConfidence: Number(confidence.toFixed(3)),
        rooms,
      };
      if (this.options.debugRooms)
        result.debug = {
          grid,
          group: this.createDebugGroup(rooms, floorY, grid, bounds, resolution),
        };
      return result;
    } catch (error) {
      console.warn("RoomAnalyzer failed", error);
      return this.failure("ROOM_DETECTION_FAILED", { error: error.message });
    }
  }
  failure(reason, extra = {}) {
    return { success: false, version: 1, rooms: [], reason, ...extra };
  }
  detectFloor(model, bounds) {
    const bins = new Map(),
      binSize = Math.max((bounds.max.y - bounds.min.y) / 160, 0.025);
    let visited = 0;
    model.traverse((mesh) => {
      if (!mesh.isMesh || visited > 180000) return;
      const position = mesh.geometry?.attributes?.position,
        index = mesh.geometry?.index;
      if (!position) return;
      const a = new THREE.Vector3(),
        b = new THREE.Vector3(),
        c = new THREE.Vector3(),
        ab = new THREE.Vector3(),
        ac = new THREE.Vector3(),
        normal = new THREE.Vector3();
      for (
        let offset = 0, count = index ? index.count : position.count;
        offset + 2 < count && visited++ < 180000;
        offset += 3
      ) {
        const read = (target, at) =>
          target
            .fromBufferAttribute(position, index ? index.getX(at) : at)
            .applyMatrix4(mesh.matrixWorld);
        read(a, offset);
        read(b, offset + 1);
        read(c, offset + 2);
        normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
        const area = normal.length() * 0.5;
        if (area < 1e-5 || normal.normalize().y < 0.82) continue;
        const y = (a.y + b.y + c.y) / 3,
          key = Math.round(y / binSize);
        bins.set(key, (bins.get(key) || 0) + area);
      }
    });
    const lowerLimit = bounds.min.y + (bounds.max.y - bounds.min.y) * 0.35,
      candidates = [...bins]
        .map(([key, area]) => ({ y: key * binSize, area }))
        .filter(({ y }) => y <= lowerLimit)
        .sort((a, b) => b.area - a.area);
    return candidates[0]?.y ?? bounds.min.y;
  }
  detectCeiling(model, floorY, bounds) {
    let wallTop = floorY;
    model.traverse((object) => {
      if (!object.isMesh) return;
      const box = new THREE.Box3().setFromObject(object),
        size = box.getSize(new THREE.Vector3());
      if (
        (architecturalName.test(object.name) || size.y > Math.max(size.x, size.z) * 0.7) &&
        box.min.y <= floorY + 0.4
      )
        wallTop = Math.max(wallTop, box.max.y);
    });
    return Math.min(
      bounds.max.y,
      wallTop > floorY + 1.8
        ? wallTop
        : floorY + this.options.estimatedRoomHeight / this.options.unitScale
    );
  }
  createOccupancy(model, bounds, sliceY, resolution) {
    const pad = 3,
      width = Math.ceil((bounds.max.x - bounds.min.x) / resolution) + pad * 2,
      height = Math.ceil((bounds.max.z - bounds.min.z) / resolution) + pad * 2,
      cells = new Uint8Array(width * height),
      segments = [];
    const mark = (x, z, radius = 1) => {
      const gx = Math.round((x - bounds.min.x) / resolution) + pad,
        gz = Math.round((z - bounds.min.z) / resolution) + pad;
      for (let dz = -radius; dz <= radius; dz++)
        for (let dx = -radius; dx <= radius; dx++)
          if (gx + dx >= 0 && gx + dx < width && gz + dz >= 0 && gz + dz < height)
            cells[(gz + dz) * width + gx + dx] = 1;
    };
    const line = (a, b, radius = 1) => {
      const length = Math.hypot(b.x - a.x, b.z - a.z),
        steps = Math.max(1, Math.ceil(length / (resolution * 0.45)));
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        mark(THREE.MathUtils.lerp(a.x, b.x, t), THREE.MathUtils.lerp(a.z, b.z, t), radius);
      }
      segments.push([
        [a.x, a.z],
        [b.x, b.z],
      ]);
    };
    model.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const box = new THREE.Box3().setFromObject(mesh),
        dimensions = box.getSize(new THREE.Vector3()),
        namedArchitecture = architecturalName.test(`${mesh.name} ${mesh.userData?.ifcType || ""}`),
        likelyWall =
          dimensions.y > 0.8 &&
          Math.min(dimensions.x, dimensions.z) < Math.max(dimensions.x, dimensions.z) * 0.28;
      if (sliceY < box.min.y || sliceY > box.max.y || (!namedArchitecture && !likelyWall)) return;
      const position = mesh.geometry?.attributes?.position,
        index = mesh.geometry?.index;
      if (!position) return;
      const a = new THREE.Vector3(),
        b = new THREE.Vector3(),
        c = new THREE.Vector3();
      const read = (target, at) =>
        target
          .fromBufferAttribute(position, index ? index.getX(at) : at)
          .applyMatrix4(mesh.matrixWorld);
      for (
        let offset = 0, count = index ? index.count : position.count;
        offset + 2 < count;
        offset += 3
      ) {
        read(a, offset);
        read(b, offset + 1);
        read(c, offset + 2);
        const hits = [],
          edges = [
            [a, b],
            [b, c],
            [c, a],
          ];
        for (const [start, end] of edges)
          if ((start.y <= sliceY && end.y >= sliceY) || (end.y <= sliceY && start.y >= sliceY)) {
            const delta = end.y - start.y;
            if (Math.abs(delta) < 1e-8) continue;
            hits.push(start.clone().lerp(end, (sliceY - start.y) / delta));
          }
        if (hits.length >= 2) line(hits[0], hits[1]);
      }
      if (doorName.test(mesh.name) && segments.length) {
        const center = box.getCenter(new THREE.Vector3());
        if (dimensions.x > dimensions.z)
          line(
            new THREE.Vector3(box.min.x, sliceY, center.z),
            new THREE.Vector3(box.max.x, sliceY, center.z),
            2
          );
        else
          line(
            new THREE.Vector3(center.x, sliceY, box.min.z),
            new THREE.Vector3(center.x, sliceY, box.max.z),
            2
          );
      }
    });
    return { width, height, cells, pad, segments };
  }
  detectComponents(grid, bounds, resolution) {
    const { width, height, cells, pad } = grid,
      seen = new Uint8Array(cells.length),
      rooms = [],
      directions = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
    for (let start = 0; start < cells.length; start++) {
      if (cells[start] || seen[start]) continue;
      const queue = [start],
        component = [];
      seen[start] = 1;
      let exterior = false;
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const current = queue[cursor],
          x = current % width,
          z = Math.floor(current / width);
        component.push(current);
        if (!x || !z || x === width - 1 || z === height - 1) exterior = true;
        for (const [dx, dz] of directions) {
          const nx = x + dx,
            nz = z + dz,
            next = nz * width + nx;
          if (nx >= 0 && nx < width && nz >= 0 && nz < height && !cells[next] && !seen[next]) {
            seen[next] = 1;
            queue.push(next);
          }
        }
      }
      if (exterior || component.length < 12) continue;
      const set = new Set(component),
        edges = new Map(),
        addEdge = (a, b) => {
          const key = `${a[0]},${a[1]}`;
          if (!edges.has(key)) edges.set(key, []);
          edges.get(key).push(b);
        };
      for (const cell of component) {
        const x = cell % width,
          z = Math.floor(cell / width);
        if (!set.has(cell - width)) addEdge([x, z], [x + 1, z]);
        if (!set.has(cell + 1)) addEdge([x + 1, z], [x + 1, z + 1]);
        if (!set.has(cell + width)) addEdge([x + 1, z + 1], [x, z + 1]);
        if (!set.has(cell - 1)) addEdge([x, z + 1], [x, z]);
      }
      let point = [...edges.keys()][0]?.split(",").map(Number),
        polygon = [];
      const first = point?.join(",");
      while (point && polygon.length < edges.size + 4) {
        polygon.push(point);
        const next = edges.get(point.join(","))?.shift();
        if (!next) break;
        point = next;
        if (point.join(",") === first) break;
      }
      if (polygon.length < 3) continue;
      polygon = simplifyPolygon(
        polygon.map(([x, z]) => [
          bounds.min.x + (x - pad) * resolution,
          bounds.min.z + (z - pad) * resolution,
        ]),
        resolution * 1.2
      );
      const area = polygonArea(polygon),
        pb = polygonBounds(polygon),
        center = { x: (pb.minX + pb.maxX) / 2, y: 0, z: (pb.minZ + pb.maxZ) / 2 };
      rooms.push({
        polygon,
        center,
        area,
        boundingBox: {
          min: { x: pb.minX, y: 0, z: pb.minZ },
          max: { x: pb.maxX, y: 0, z: pb.maxZ },
        },
      });
    }
    return rooms;
  }
  detectSpaceNodes(model, floorY, ceilingY) {
    const rooms = [];
    model.traverse((object) => {
      if (!object.isMesh || !spaceName.test(`${object.name} ${object.userData?.ifcType || ""}`))
        return;
      const box = new THREE.Box3().setFromObject(object),
        size = box.getSize(new THREE.Vector3());
      if (size.x * size.z < this.options.minRoomArea) return;
      const polygon = [
          [box.min.x, box.min.z],
          [box.max.x, box.min.z],
          [box.max.x, box.max.z],
          [box.min.x, box.max.z],
        ],
        center = box.getCenter(new THREE.Vector3());
      rooms.push({
        polygon,
        center: { x: center.x, y: (floorY + ceilingY) / 2, z: center.z },
        area: size.x * size.z,
        boundingBox: {
          min: { x: box.min.x, y: floorY, z: box.min.z },
          max: { x: box.max.x, y: ceilingY, z: box.max.z },
        },
      });
    });
    return rooms;
  }
  assignObjects(meshes, rooms) {
    meshes.forEach((mesh, index) => {
      const id = mesh.userData.roomAnalyzerId || `mesh_${String(index + 1).padStart(4, "0")}`;
      mesh.userData.roomAnalyzerId = id;
      const box = new THREE.Box3().setFromObject(mesh),
        center = box.getCenter(new THREE.Vector3()),
        points = [
          [center.x, center.z],
          [box.min.x, box.min.z],
          [box.max.x, box.min.z],
          [box.max.x, box.max.z],
          [box.min.x, box.max.z],
        ],
        roomIds = rooms
          .filter(
            (room) =>
              box.max.y >= room.floorY &&
              box.min.y <= room.ceilingY &&
              points.some((point) => pointInPolygon(point, room.polygon))
          )
          .map((room) => room.id);
      mesh.userData.roomIds = roomIds;
      if (roomIds.length === 1) mesh.userData.roomId = roomIds[0];
      else delete mesh.userData.roomId;
      for (const room of rooms) if (roomIds.includes(room.id)) room.objectIds.push(id);
    });
  }
  createDebugGroup(rooms, floorY, grid, bounds, resolution) {
    const group = new THREE.Group();
    group.name = "RoomAnalyzerDebug";
    const occupied = [];
    for (let index = 0; index < grid.cells.length; index++)
      if (grid.cells[index]) {
        const x = index % grid.width,
          z = Math.floor(index / grid.width);
        occupied.push(
          bounds.min.x + (x - grid.pad) * resolution,
          floorY + 0.02,
          bounds.min.z + (z - grid.pad) * resolution
        );
      }
    if (occupied.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(occupied, 3));
      group.add(
        new THREE.Points(
          geometry,
          new THREE.PointsMaterial({
            color: 0xef4444,
            size: Math.max(resolution * 0.8, 0.025),
            transparent: true,
            opacity: 0.55,
          })
        )
      );
    }
    const segmentVertices = grid.segments.flatMap(([a, b]) => [
      a[0],
      floorY + 0.06,
      a[1],
      b[0],
      floorY + 0.06,
      b[1],
    ]);
    if (segmentVertices.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(segmentVertices, 3));
      group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xff3355 })));
    }
    rooms.forEach((room, index) => {
      const color = new THREE.Color().setHSL((index * 0.618) % 1, 0.68, 0.52),
        shape = new THREE.Shape(room.polygon.map(([x, z]) => new THREE.Vector2(x, z))),
        geometry = new THREE.ShapeGeometry(shape),
        material = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.24,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
        mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = floorY + 0.035;
      mesh.name = `Polygon_${room.id}`;
      group.add(mesh);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(resolution * 1.8, 0.06), 12, 8),
        new THREE.MeshBasicMaterial({ color })
      );
      marker.position.set(room.center.x, floorY + 0.1, room.center.z);
      marker.name = `Center_${room.id}`;
      group.add(marker);
      const box = new THREE.Box3(
        new THREE.Vector3(room.boundingBox.min.x, floorY, room.boundingBox.min.z),
        new THREE.Vector3(room.boundingBox.max.x, room.ceilingY, room.boundingBox.max.z)
      );
      const helper = new THREE.Box3Helper(box, color);
      helper.name = `Bounds_${room.id}`;
      group.add(helper);
    });
    return group;
  }
}

export default RoomAnalyzer;
