import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PerspectiveCamera, Vector3 } from '../../vendor/three/build/three.core.js';

const source = readFileSync(new URL('../../scripts/app.js', import.meta.url), 'utf8');

test('room panel resizes camera and canvas together without fixing CSS canvas dimensions', () => {
  const viewer = { clientWidth: 1100, clientHeight: 700 };
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  let onResize;
  let canvasWidth;
  const renderer = {
    setSize(width, height, updateStyle = true) {
      assert.equal(updateStyle, false, 'canvas must retain its CSS width: 100%');
      canvasWidth = width;
      assert.equal(height, viewer.clientHeight);
    },
  };
  const context = vm.createContext({
    viewer, camera, renderer,
    addEventListener() {},
    ResizeObserver: class {
      constructor(callback) { onResize = callback; }
      observe(element) { assert.equal(element, viewer); }
    },
  });
  vm.runInContext(source.match(/renderer\.setSize\([^;]+;/)[0], context);
  vm.runInContext(source.slice(source.indexOf('function resizeViewer()'), source.indexOf('function positionModelNotes()')), context);
  for (const width of [1100, 756, 1100]) {
    viewer.clientWidth = width;
    onResize();
    assert.equal(camera.aspect, width / 700);
    assert.equal(canvasWidth, width);
    // Existing world-space anchors must match canvas pixels across an orbit.
    for (const angle of [0, 0.5, 1, 2]) {
      camera.position.set(8 * Math.sin(angle), 4, 8 * Math.cos(angle));
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      const projected = new Vector3(1, 0, 1).project(camera);
      const pinX = (projected.x + 1) * viewer.clientWidth / 2;
      const modelX = (projected.x + 1) * canvasWidth / 2;
      assert.equal(pinX, modelX);
    }
  }
  viewer.clientHeight = 0;
  onResize();
  assert.ok(Number.isFinite(camera.aspect));
});
