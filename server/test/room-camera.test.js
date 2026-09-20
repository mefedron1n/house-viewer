import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../../vendor/three/build/three.core.js';

const source = readFileSync(new URL('../../scripts/app.js', import.meta.url), 'utf8');
const focusSource = source.slice(source.indexOf('window.focusRoom ='), source.indexOf('window.highlightRoom ='));

test('room overview replaces the distant model frame and cancels its pending animation', () => {
  const camera = new THREE.PerspectiveCamera(45, 1.9, 0.01, 500);
  camera.position.set(80, 60, 80);
  const controls = { target: new THREE.Vector3(), update() {} };
  const originalPosition = new THREE.Vector3(), originalTarget = new THREE.Vector3();
  const room = {
    id: 'room', name: 'Room', objectIds: [], floorY: 0.2,
    boundingBox: { min: { x: 4.5, z: -2.4 }, max: { x: 21.3, z: 3.8 } },
  };
  const context = vm.createContext({
    THREE, camera, controls, originalPosition, originalTarget,
    roomsAnalysis: { rooms: [room] }, window: { dispatchEvent() {} },
    cameraAnimation: { from: camera.position.clone(), to: new THREE.Vector3(70, 50, 70) },
    defaultMinDistance: 1, defaultMaxDistance: 100,
    initialModelUrl: 'model.glb', pageParams: new URLSearchParams(),
    localStorage: { setItem() {} }, console: { table() {} },
    CustomEvent: class {}, renderModelNotes() {}, positionModelNotes() {},
  });
  vm.runInContext(source.slice(source.indexOf('function publishRoomsAnalysis()'),
    source.indexOf('window.getRoomsMetadata =')), context);
  context.publishRoomsAnalysis();
  assert.equal(context.cameraAnimation, null, 'the render loop must not restore the old distant frame');
  assert.ok(camera.position.distanceTo(controls.target) < 35);
  assert.ok(camera.position.x > controls.target.x && camera.position.z > controls.target.z);
  assert.deepEqual(originalPosition, camera.position, 'Home restores the initial overview');
  assert.deepEqual(originalTarget, controls.target);
  camera.lookAt(controls.target);
  camera.updateMatrixWorld();
  for (const x of [room.boundingBox.min.x, room.boundingBox.max.x])
    for (const z of [room.boundingBox.min.z, room.boundingBox.max.z]) {
      const corner = new THREE.Vector3(x, room.floorY, z).project(camera);
      assert.ok(Math.abs(corner.x) < 1 && Math.abs(corner.y) < 1);
    }
});

for (const [name, width, depth, aspect] of [
  ['living room', 4, 3.1, 1.5],
  ['small bathroom', 1.4, 2, 1.5],
  ['long hall', 1.5, 9, 1.5],
  ['wide room', 9, 2, 1.5],
  ['narrow viewport', 4, 5, 0.6],
]) {
  test(`room camera frames ${name} from above`, () => {
    const room = { floorY: 2, ceilingY: 5, boundingBox: {
      min: { x: 10, z: -6 }, max: { x: 10 + width, z: -6 + depth },
    } };
    const camera = new THREE.PerspectiveCamera(45, 2, 0.01, 500);
    const controls = {};
    let frame;
    let destination;
    const context = vm.createContext({
      THREE, camera, controls, window: {}, house: {},
      resolveRoom: () => room,
      defaultMinDistance: 4, defaultMaxDistance: 100,
      requestAnimationFrame: (callback) => { frame = callback; },
      resizeViewer: () => { camera.aspect = aspect; camera.updateProjectionMatrix(); },
      animate: (position, target) => { destination = { position, target }; },
    });
    vm.runInContext(focusSource, context);
    context.window.focusRoom(name);
    assert.equal(destination, undefined);
    frame();
    const { position, target } = destination;
    assert.ok(position.y > room.ceilingY);
    const direction = position.clone().sub(target);
    const elevation = Math.atan2(direction.y, Math.hypot(direction.x, direction.z)) * 180 / Math.PI;
    assert.ok(elevation > 44 && elevation < 46);
    assert.ok(direction.length() >= controls.minDistance && direction.length() <= controls.maxDistance);
    camera.position.copy(position);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    for (const x of [room.boundingBox.min.x, room.boundingBox.max.x])
      for (const y of [room.floorY, room.ceilingY])
        for (const z of [room.boundingBox.min.z, room.boundingBox.max.z]) {
          const point = new THREE.Vector3(x, y, z).project(camera);
          assert.ok(Math.abs(point.x) <= 0.850001 && Math.abs(point.y) <= 0.850001);
          assert.ok(point.z > -1 && point.z < 1);
        }
  });
}
