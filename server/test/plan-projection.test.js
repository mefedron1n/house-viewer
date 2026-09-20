import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({window: {}});
vm.runInContext(readFileSync(new URL('../../scripts/spatial.js', import.meta.url), 'utf8'), context);
const spatial = context.window.RoomarkSpatial;
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
test('three paired points map rotated, mirrored and offset plans without using model bounds', () => {
  for (const m of [
    {a: 0,b: 12,c: -30,d: 8,e: 0,f: 90},
    {a: 20,b: 3,c: 100,d: 2,e: -9,f: -50},
  ]) {
    const imagePoints = [{x:.12,z:.18},{x:.85,z:.22},{x:.25,z:.91}];
    const worldPoints = imagePoints.map(p => spatial.imageToWorld(m,p));
    const solved = spatial.solveAffine(imagePoints, worldPoints);
    assert.ok(solved);
    const expected = {x:.43,z:.61};
    const world = spatial.imageToWorld(m,expected);
    // Elevation does not affect the plan position.
    for (const y of [0,1,3]) {
      const actual = spatial.worldToImage(solved,{...world,y});
      close(actual.x, expected.x); close(actual.z, expected.z);
    }
  }
});
test('collinear, nearly collinear and non-finite reference points are rejected', () => {
  const good = [{x:0,z:0},{x:1,z:0},{x:0,z:1}];
  for (const bad of [
    [{x:0,z:0},{x:1,z:1},{x:2,z:2}],
    [{x:0,z:0},{x:1,z:0},{x:2,z:.00001}],
    [{x:NaN,z:0},good[1],good[2]],
  ]) {
    assert.equal(spatial.solveAffine(bad,good),null);
    assert.equal(spatial.solveAffine(good,bad),null);
  }
});
const source = readFileSync(new URL('../../scripts/interface.js', import.meta.url), 'utf8');
test('3D notes stay in the plan list; projection requires matching saved or preview calibration', () => {
  const ctx = vm.createContext({window: context.window});
  vm.runInContext(`let alignment=null, floorplanCalibration=null, planNoteFilter='all', planRoomFilter='all';
    let notes=[{id:'world', coordinateSpace:'model-world-v1', position:{x:14,y:3,z:6}},
      {id:'done',status:'resolved',coordinateSpace:'model-world-v1',position:{x:15,z:5}}];`,ctx);
  vm.runInContext(source.slice(source.indexOf('  function currentCalibration()'),source.indexOf('  function updateAlignmentUI()')),ctx);
  vm.runInContext(source.slice(source.indexOf('  function visiblePlanNotes('),source.indexOf('  function renderPlanWorkspace()')),ctx);
  assert.equal(vm.runInContext('visiblePlanNotes().length',ctx),2);
  assert.equal(vm.runInContext('notePlanPoint(notes[0])',ctx),null);
  vm.runInContext(`floorplanCalibration={version:1,matrix:{a:10,b:0,c:10,d:0,e:-10,f:10},modelKey:'model-a'};
    window.RoomarkModelKey='model-a';`,ctx);
  close(vm.runInContext('notePlanPoint(notes[0]).x',ctx),.4);
  close(vm.runInContext('notePlanPoint(notes[0]).y',ctx),.4);
  vm.runInContext(`window.RoomarkModelKey='model-b'`,ctx);
  assert.equal(vm.runInContext('notePlanPoint(notes[0])',ctx),null);
  vm.runInContext(`planNoteFilter='resolved'`,ctx);
  assert.equal(vm.runInContext('visiblePlanNotes()[0].id',ctx),'done');
});
test('image and pin share the same rectangle with letterboxing and zoom', () => {
  const ctx = vm.createContext({});
  vm.runInContext('let projectFloorplanAspect=2, planZoom=1;',ctx);
  vm.runInContext(source.slice(source.indexOf('  function planImageRect('),source.indexOf('  function visiblePlanNotes(')),ctx);
  for (const zoom of [.6,1,2.4]) {
    vm.runInContext(`planZoom=${zoom}`,ctx);
    const rect=vm.runInContext('planImageRect({clientWidth:800,clientHeight:600})',ctx);
    close(rect.width,800*zoom); close(rect.height,400*zoom);
    close(rect.left+rect.width/2,400); close(rect.top+rect.height/2,300);
  }
});
