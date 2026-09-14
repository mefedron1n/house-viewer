import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../../vendor/three/build/three.core.js';

const source = readFileSync(new URL('../../scripts/app.js', import.meta.url), 'utf8');
const focusSource = source.slice(source.indexOf('window.focusRoom ='), source.indexOf('window.highlightRoom ='));

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
