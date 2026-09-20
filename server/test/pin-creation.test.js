import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../scripts/app.js', import.meta.url), 'utf8');
const handlerSource = source.slice(
  source.indexOf('renderer.domElement.addEventListener("dblclick",'),
  source.indexOf('pinForm.addEventListener("submit",')
);

for (const [name, spatial] of [
  ['spatial script is unavailable', undefined],
  ['cached spatial script has no room helper', {}],
  ['room analysis cannot determine the room', { noteRoomId() { throw new Error('Room analysis unavailable'); } }],
]) {
  test(`double click opens the pin form when ${name}`, async () => {
    let doubleClick;
    const modal = { open: false, showModal() { this.open = true; } };
    const position = { x: 12, y: 2, z: -3 };
    const ctx = vm.createContext({
      house: {}, pageParams: new URLSearchParams(),
      renderer: { domElement: {
        addEventListener(type, callback) { assert.equal(type, 'dblclick'); doubleClick = callback; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
      } },
      pointer: { set() {} }, camera: {},
      raycaster: { setFromCamera() {}, intersectObjects() { return [{ point: position }]; } },
      selectable: [{ visible: true }], isolatedRoomId: null, selectedRoomId: 'room_001',
      window: { RoomarkSpatial: spatial, dispatchEvent() { return true; } },
      CustomEvent: class { constructor(type, options) { Object.assign(this, { type }, options); } },
      pinModal: modal, pinForm: { reset() {} },
      pinModalTitle: {}, pinModalDescription: {}, pinNameField: {},
      pinNameInput: { focus() {} }, pinSubmit: {}, pinPasswordInput: {}, pinModalStatus: {},
      document: { getElementById() { return null; } }, requestAnimationFrame(callback) { callback(); },
    });
    vm.runInContext('let pendingPinPosition = null, pendingPinRoomId = null, pendingPinDeleteId = null;', ctx);
    vm.runInContext(handlerSource, ctx);
    await doubleClick({ clientX: 400, clientY: 300, preventDefault() {}, stopPropagation() {} });
    assert.equal(modal.open, true);
    assert.equal(vm.runInContext('pendingPinRoomId', ctx), 'room_001');
    assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(pendingPinPosition)', ctx)), position);
    assert.equal(ctx.pinNameInput.required, true);
    assert.equal(ctx.pinSubmit.textContent, 'Добавить пин');
  });
}
