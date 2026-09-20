import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ window: {} });
vm.runInContext(readFileSync(new URL('../../scripts/spatial.js', import.meta.url), 'utf8'), context);
const { noteRoomId, roomContainsPoint } = context.window.RoomarkSpatial;
const room = (id, x, floorY = 0) => ({
  id, floorY, ceilingY: floorY + 3,
  boundingBox: { min: { x, z: 0 }, max: { x: x + 4, z: 4 } },
});
const rooms = [room('a', 0), room('b', 4), room('upstairs', 0, 3)];
const note = (x, y = 1, z = 2, roomId = null) => ({
  coordinateSpace: 'model-world-v1', position: { x, y, z }, roomId,
});

test('room assignment uses world coordinates, floor elevation and wall boundaries', () => {
  assert.equal(noteRoomId(note(2), rooms), 'a');
  assert.equal(noteRoomId(note(6), rooms), 'b');
  assert.equal(noteRoomId(note(2, 4), rooms), 'upstairs');
  assert.equal(noteRoomId(note(-0.05), rooms), 'a');
  assert.equal(noteRoomId(note(-2), rooms), null);
  assert.equal(noteRoomId(note(4, 1, 2, 'b'), rooms), 'b');
  assert.equal(noteRoomId(note(6, 1, 2, 'a'), rooms), 'b');
  assert.equal(noteRoomId(note(-2, 1, 2, 'a'), rooms), 'a');
  assert.equal(noteRoomId({ roomId: 'manual' }, rooms), 'manual');
});

test('concave rooms exclude points in their bounding box but outside their polygon', () => {
  const concave = { ...rooms[0], polygon: [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]] };
  assert.equal(roomContainsPoint(concave, { x: 3, y: 1, z: 3 }), false);
  assert.equal(roomContainsPoint(concave, { x: 0.5, y: 1, z: 3 }), true);
  assert.equal(roomContainsPoint(concave, { x: 1.05, y: 1, z: 3 }), true);
  assert.equal(roomContainsPoint(concave, { x: NaN, y: 1, z: 3 }), false);
});

test('plan room and status filters intersect and room counts ignore the status filter', () => {
  context.window.RoomarkRooms = { rooms };
  const source = readFileSync(new URL('../../scripts/interface.js', import.meta.url), 'utf8');
  const ctx = vm.createContext({ window: context.window, notes: [
    { ...note(2), id: 'a-open' },
    { ...note(2), id: 'a-done', status: 'resolved' },
    { ...note(6), id: 'b-open' },
    { ...note(-2), id: 'outside' },
    { ...note(2), id: 'media', source: 'room-media' },
    { ...note(2), id: 'legacy', coordinateSpace: 'legacy-normalized-v1' },
  ] });
  vm.runInContext("let planRoomFilter = 'a', planNoteFilter = 'open';", ctx);
  vm.runInContext(source.slice(source.indexOf('  function visiblePlanNotes('), source.indexOf('  function renderPlanWorkspace()')), ctx);
  assert.equal(vm.runInContext('visiblePlanNotes().map(n => n.id).join() ', ctx), 'a-open');
  assert.equal(vm.runInContext('visiblePlanNotes("all").length', ctx), 2);
  vm.runInContext("planRoomFilter = 'b'", ctx);
  assert.equal(vm.runInContext('visiblePlanNotes()[0].id', ctx), 'b-open');
  vm.runInContext("planRoomFilter = 'unassigned'", ctx);
  assert.equal(vm.runInContext('visiblePlanNotes()[0].id', ctx), 'outside');
  vm.runInContext("planRoomFilter = 'all'; planNoteFilter = 'all'", ctx);
  assert.equal(vm.runInContext('visiblePlanNotes().length', ctx), 4);
});
