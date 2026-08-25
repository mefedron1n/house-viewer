import test from "node:test";
import assert from "node:assert/strict";
import {
  pointInPolygon,
  polygonArea,
  simplifyPolygon,
} from "../../scripts/room-analyzer/geometry/polygonUtils.js";
import {
  assignRoomNames,
  classifyRoom,
} from "../../scripts/room-analyzer/classification/classifyRoom.js";

test("room polygons retain area and containment", () => {
  const polygon = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ];
  assert.equal(polygonArea(polygon), 12);
  assert.equal(pointInPolygon([2, 1], polygon), true);
  assert.equal(pointInPolygon([5, 1], polygon), false);
  assert.deepEqual(
    simplifyPolygon(
      [
        [0, 0],
        [2, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      0.01
    ),
    polygon
  );
});

test("room classification recognizes combined kitchen and living room", () => {
  const result = classifyRoom([{ name: "Секция кухни" }, { name: "Диван и TV" }]);
  assert.equal(result.type, "kitchen_living");
  const rooms = assignRoomNames([{ type: "bedroom" }, { type: "bedroom" }, { type: "unknown" }]);
  assert.deepEqual(
    rooms.map(({ name }) => name),
    ["Спальня", "Спальня 2", "Комната"]
  );
});
