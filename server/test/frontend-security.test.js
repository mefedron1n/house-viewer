import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const rooms = readFileSync(new URL('../../scripts/rooms.js', import.meta.url), 'utf8');
const interfaceSource = readFileSync(new URL('../../scripts/interface.js', import.meta.url), 'utf8');
const payload = '\"><img src=x onerror="alert(1)">';

for (const tab of ['overview', 'floorplan', '3d', 'renders']) {
  test(`untrusted room names remain text in ${tab} markup`, () => {
    const content = { innerHTML: '' };
    const context = vm.createContext({
      content, selectedTab: tab, selectedRoom: { id: 'room', name: payload }, notes: [],
      absolute: (url) => url,
    });
    vm.runInContext(rooms.slice(rooms.indexOf('const esc ='), rooms.indexOf('const indexRooms =')), context);
    vm.runInContext(rooms.slice(rooms.indexOf('function renderTab(data)'), rooms.indexOf('  document.addEventListener("click", (event) => {\n    const noteStatus')), context);
    context.renderTab({ floorplanUrl: '/plan.png', modelUrl: '/model.glb', renderUrls: ['/render.png'] });
    assert.ok(content.innerHTML.includes('&lt;img'));
    assert.ok(!content.innerHTML.includes('<img src=x'));
    assert.ok(!content.innerHTML.includes('onerror="'));
  });
}

test('plan and media tiles escape IFC room names and identifiers', () => {
  const context = vm.createContext({
    roomNames: { [payload]: payload }, roomData: { [payload]: { photos: [{ url: '/photo.png' }] } },
    absoluteUrl: (value) => value,
  });
  vm.runInContext(interfaceSource.slice(interfaceSource.indexOf('const escapeHtml ='), interfaceSource.indexOf('function roomIconUrl')), context);
  vm.runInContext(interfaceSource.slice(interfaceSource.indexOf('function roomTile('), interfaceSource.indexOf('function renderPlan(')), context);
  vm.runInContext(interfaceSource.slice(interfaceSource.indexOf('function mediaRoomTile('), interfaceSource.indexOf('function galleryMarkup(')), context);
  for (const html of [context.roomTile(payload, { floorplanUrl: '/plan.png' }), context.mediaRoomTile(payload, 'photos')]) {
    assert.ok(html.includes('&lt;img'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('onerror="'));
  }
});
