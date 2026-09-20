import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../scripts/rooms.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../../scripts/app.js', import.meta.url), 'utf8');
const room = (id, name = id) => ({ id, slug: id, name, area: 12, automatic: true });
const response = (value) => ({ ok: true, json: async () => value });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function catalogHarness(fetch, analyzed = []) {
  const events = [], sidebars = [];
  const location = new URL('http://localhost/viewer.html?project=test');
  const node = { classList: { contains: () => false } };
  const window = {
    HOUSE_ROOMS: [], AUTO_ROOMS: analyzed, top: { location },
    dispatchEvent: event => events.push(event.detail.rooms),
  };
  const context = vm.createContext({
    window, location, URL, URLSearchParams, fetch, events, sidebars,
    localStorage: { getItem: () => null },
    document: { querySelectorAll: () => [], getElementById: () => node },
    CustomEvent: class { constructor(type, options) { Object.assign(this, { type }, options); } },
  });
  vm.runInContext(source.slice(0, source.indexOf('  function roomCounts(')) + `
    function renderSidebar() { sidebars.push(rooms.map(room => room.id)); }
    function renderProjectCard() {}
    function renderRoom() {}
    function openRoom(room) { selectedRoom = room; }
    function closeRoom() { selectedRoom = null; }
    window.catalogTest = {
      loadData,
      setRooms(next) { rooms = next; indexRooms(); },
      select(room) { selectedRoom = room; },
      get selected() { return selectedRoom; },
      get manifests() { return manifests; },
    };
  })();`, context);
  return { window, events, sidebars, ...window.catalogTest, api: window.catalogTest };
}

test('catalog keeps IFC IDs and geometry metadata together with saved room edits', async () => {
  const first = { ...room('ifc$one', 'IFC name'), storeyId: 'floor-2' };
  const saved = { ...room(first.id, 'Детская'), icon: 'nursery', area: 15 };
  const media = deferred();
  const h = catalogHarness(url => url.includes('/api/notes')
    ? Promise.resolve(response([])) : media.promise, [first]);
  h.api.select(first);
  const loading = h.api.loadData([saved, room('manual', 'Кладовая')]);
  assert.equal(h.window.HOUSE_ROOMS[0].id, first.id);
  assert.equal(h.window.HOUSE_ROOMS[0].name, 'Детская');
  assert.equal(h.window.HOUSE_ROOMS[0].storeyId, 'floor-2');
  assert.equal(h.window.HOUSE_ROOMS[0].icon, 'nursery');
  assert.equal(h.api.selected.name, 'Детская');
  assert.equal(h.sidebars.at(-1).join(), 'ifc$one,manual', 'sidebar updates before media arrives');
  assert.equal(h.events.at(-1), h.window.HOUSE_ROOMS, 'all tabs receive the same catalog');
  media.resolve(response({ photos: [] }));
  await loading;
});

test('late catalog JSON cannot restore a room removed while the request was in progress', async () => {
  const json = deferred(), started = deferred();
  const h = catalogHarness(async () => ({ ok: true, json: () => {
    started.resolve();
    return json.promise;
  } }));
  const loading = h.api.loadData();
  await started.promise;
  h.api.setRooms([room('remaining')]);
  json.resolve([room('deleted'), room('remaining')]);
  await loading;
  assert.equal(h.window.HOUSE_ROOMS.map(room => room.id).join(), 'remaining');
});

test('late media and notes cannot replace materials from a newer catalog load', async () => {
  const oldNotes = deferred(), notesStarted = deferred();
  let noteRequests = 0;
  const h = catalogHarness(async url => {
    if (url.includes('/api/notes') && ++noteRequests === 1) {
      notesStarted.resolve();
      return oldNotes.promise;
    }
    return response(url.includes('/api/notes') ? [] : { photos: [{ url }] });
  });
  const first = h.api.loadData([room('old')]);
  await notesStarted.promise;
  await h.api.loadData([room('new')]);
  oldNotes.resolve(response([]));
  await first;
  assert.equal(Object.keys(h.api.manifests).join(), 'new');
  assert.equal(h.window.HOUSE_ROOMS.map(room => room.id).join(), 'new');
});

test('3D uses the material room ID even when another room has the same name or type', () => {
  const context = vm.createContext({ roomsAnalysis: { success: true, rooms: [
    { ...room('first', 'bedroom'), type: 'bedroom' }, room('bedroom', 'Вторая спальня'),
  ] } });
  vm.runInContext(appSource.slice(appSource.indexOf('function resolveRoom('),
    appSource.indexOf('let selectedRoomId =')), context);
  assert.equal(context.resolveRoom('bedroom').id, 'bedroom');
  assert.equal(context.resolveRoom('first').id, 'first');
  assert.equal(context.resolveRoom('Вторая спальня'), null);
  assert.equal(context.resolveRoom('missing'), null);
});
