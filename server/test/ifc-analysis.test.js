import test from "node:test";
import assert from "node:assert/strict";
import { buildRoomConnections, isUsableRoom, linkBoundary, linkNearbyElements, resolveProxyType } from "../ifc-analysis.js";

const box = (min, max) => ({ min, max });
test("different touching IfcSpace entities remain separate rooms", () => {
  const rooms = [
    { id: "kitchen", name: "Кухня", bounds: box([0,0,0],[4,3,4]) },
    { id: "hall", name: "Прихожая", bounds: box([4,0,0],[8,3,4]) },
  ];
  assert.equal(rooms.filter((room) => isUsableRoom(room, rooms)).length, 2);
  assert.notEqual(rooms[0].id, rooms[1].id);
});

test("aggregate total area is kept out of usable rooms", () => {
  const rooms = [
    { id:"total", name:"Общая площадь", bounds:box([0,0,0],[8,3,4]) },
    { id:"a", name:"Кухня", bounds:box([0,0,0],[4,3,4]) },
    { id:"b", name:"Прихожая", bounds:box([4,0,0],[8,3,4]) },
  ];
  assert.equal(isUsableRoom(rooms[0], rooms), false);
  assert.equal(rooms.slice(1).every((room) => isUsableRoom(room, rooms)), true);
});

test("Archicad proxy classification reports evidence and confidence", () => {
  const result = resolveProxyType({ name:"Наружная стена", properties:{ Classification:"Wall" } });
  assert.equal(result.type, "wall");
  assert.ok(result.confidence > .5);
  assert.ok(result.source.length > 0);
});

test("Archicad door code wins over words such as partition and leaf", () => {
  assert.equal(resolveProxyType({ name:"ДВ-7 перегородка 3 полотна" }).type, "door");
});

test("unnamed thin vertical proxy is classified as a wall from geometry", () => {
  const result = resolveProxyType({ bounds: box([0, 0, 0], [5, 2.7, 0.2]) });
  assert.equal(result.type, "wall");
  assert.deepEqual(result.source, ["geometry"]);
});

test("deep Archicad partition block is hidden with walls", () => {
  assert.equal(resolveProxyType({ name: "Гардеробная", bounds: box([0, 0, 0], [0.6, 2.52, 2.11]) }).type, "wall");
});

test("one boundary element can be adjacent to two rooms", () => {
  const wall = { id:"wall-1", resolvedType:"wall", adjacentRoomIds:[] };
  const a = { id:"a" }, b = { id:"b" };
  linkBoundary(a, wall); linkBoundary(b, wall);
  assert.deepEqual(wall.adjacentRoomIds, ["a","b"]);
  assert.equal(buildRoomConnections([wall]).length, 1);
});

test("spatial fallback uses nearby elements when boundaries are absent", () => {
  const room = { id:"room", bounds:box([0,0,0],[4,3,4]) };
  const wall = { id:"wall", resolvedType:"wall", bounds:box([3.95,0,0],[4.1,3,4]) };
  const far = { id:"far", resolvedType:"wall", bounds:box([20,0,20],[21,3,21]) };
  linkNearbyElements([room], [wall,far]);
  assert.deepEqual(room.wallIds, ["wall"]);
  assert.deepEqual(wall.adjacentRoomIds, ["room"]);
  assert.deepEqual(far.adjacentRoomIds, undefined);
});

test("storey association retains rooms on multiple floors", () => {
  const rooms = [{ id:"a", storeyId:"floor-1" }, { id:"b", storeyId:"floor-2" }];
  const storeys = ["floor-1","floor-2"].map((id) => ({ id, roomIds:rooms.filter((room) => room.storeyId === id).map((room) => room.id) }));
  assert.deepEqual(storeys.map((item) => item.roomIds), [["a"],["b"]]);
});
