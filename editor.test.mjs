// editor.test.mjs v1.0.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { ENGINE_SETTINGS } from './core/settings.js';
import { createSceneFromJson, parseSceneJson, SCENE_JSON_VERSION } from './core/scene-json.js';

// Exercise the editor's actual functions without starting a GPU or importing a GLB.
const source = readFileSync(new URL('./editor.js', import.meta.url), 'utf8');
function definition(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n}', start);
  return source.slice(start, end + 2);
}
const context = vm.createContext({ ENGINE_SETTINGS, Float32Array });
vm.runInContext(`
  const placementGeometry = new WeakMap();
  const selectedAssets = new Set();
  let activeAsset = null;
  const assetList = { children: [] };
  let refreshes = 0;
  function updateCopyControl() {}
  function updateMeshCount() {}
  function refreshEditorScenes() { refreshes++; }
  function captureEdit() { return []; }
  function commitEdit() {}
  ${['boundsForDraws', 'assetBounds', 'assetDraws', 'syncSelection', 'selectAsset', 'toggleAsset', 'clearSelection', 'removePlacements', 'trackPointer'].map(definition).join('\n')}
`, context);

vm.runInContext(`
  const asset = { draws: [{ vertices: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0]) }], placements: { spring: { x: 0, z: 0, height: 0, scale: 1, rotation: 0, tilt: 0 }, summer: { x: 2, z: 0, height: 0, scale: 1, rotation: 0, tilt: 0 } } };
  const placement = asset.placements.spring;
  const first = assetDraws(asset, placement);
  globalThis.sameGeometry = first === assetDraws(asset, placement);
  const before = assetBounds(asset, placement).minX;
  placement.x = 2;
  globalThis.moved = assetBounds(asset, placement).minX - before;
  globalThis.invalidated = first !== assetDraws(asset, placement);
  selectAsset(asset);
  removePlacements([asset], 'spring');
  globalThis.removal = [Boolean(asset.placements.spring), asset.placements.summer.x, selectedAssets.size, activeAsset];
`, context);
assert.equal(context.sameGeometry, true);
assert.equal(context.invalidated, true);
assert.equal(context.moved, 2);
assert.deepEqual(Array.from(context.removal), [false, 2, 0, null]);

const createElement = () => ({
  dataset: {}, style: {}, children: [], listeners: {},
  setAttribute() {},
  addEventListener(type, listener) { this.listeners[type] = listener; },
  append(child) { this.children.push(child); },
  remove() {},
});
context.document = { createElement };
vm.runInContext(`
  const canvas = { getBoundingClientRect: () => ({ left: 0, right: 800, top: 0, bottom: 600 }) };
  const views = ['spring', 'summer'].map(season => ({ dataset: { season }, querySelector: () => canvas }));
  let activeSeason = 0;
  let colorTarget = null;
  const meshControlGroups = new Map();
  const meshControlsLayer = document.createElement('div');
  function projectedBounds() { return { right: 300, top: 200 }; }
  function beginMeshTransform(_event, placement) { globalThis.transformPlacement = placement; }
  ${definition('positionMeshControls')}
  ${definition('updateMeshControls')}
  asset.placements.spring = { x: 0, z: 0, height: 0, scale: 1, rotation: 0, tilt: 0 };
  selectAsset(asset);
  updateMeshControls();
  const controls = meshControlGroups.get(asset);
  updateMeshControls();
  globalThis.reusedControls = controls === meshControlGroups.get(asset);
  activeSeason = 1;
  updateMeshControls();
  controls.children.find(button => button.dataset.meshAction === 'height').listeners.pointerdown({});
  globalThis.correctTransform = transformPlacement === asset.placements.summer;
  controls.children.find(button => button.dataset.meshAction === 'delete').listeners.click({ preventDefault() {}, stopPropagation() {} });
  globalThis.correctSeason = Boolean(asset.placements.spring) && !asset.placements.summer;
  updateMeshControls();
  globalThis.remainingControls = meshControlGroups.size;
`, context);
assert.equal(context.reusedControls, true);
assert.equal(context.correctSeason, true);
assert.equal(context.correctTransform, true);
assert.equal(context.remainingControls, 0);

for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  const listeners = new Map();
  let captured = false, updates = 0, cancelled;
  const target = {
    setPointerCapture() { captured = true; },
    hasPointerCapture() { return captured; },
    releasePointerCapture() { captured = false; },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
  };
  context.trackPointer({ currentTarget: target, pointerId: 1 }, () => updates++, (_event, value) => { cancelled = value; });
  listeners.get('pointermove')({ pointerId: 2 });
  listeners.get('pointermove')({ pointerId: 1 });
  listeners.get(ending)({ pointerId: 1, type: ending });
  assert.equal(updates, 1);
  assert.equal(cancelled, ending !== 'pointerup');
  assert.equal(listeners.size, 0);
  assert.equal(captured, false);
}
context.Element = class Element {};
context.window = { addEventListener(type, handler) { context.keydown = handler; } };
context.wheelCanvas = { parentElement: { dataset: { season: 'spring' } }, addEventListener(type, handler) { context.wheel = handler; } };
vm.runInContext(`
  const qrStep = ENGINE_SETTINGS.qr.blockSize;
  const rotationStep = Math.PI / 12;
  ${['snapToQr', 'dragPlacement', 'setPlacementHeight', 'setPlacementScale'].map(definition).join('\n')}
  activeSeason = 0;
  const otherAsset = { placements: { spring: { x: 0, z: 0, height: 0, scale: 1, rotation: 0, tilt: 0 } } };
  selectedAssets.add(asset);
  selectedAssets.add(otherAsset);
  ${source.slice(source.indexOf('window.addEventListener("keydown"'))}
  ${source.slice(source.indexOf('  canvas.addEventListener("wheel"'), source.indexOf('  function pointerToPlane')).replace('canvas.addEventListener', 'wheelCanvas.addEventListener').replace('canvas.parentElement', 'wheelCanvas.parentElement')}
  const testDrag = { x: .31, z: -.12 };
  dragPlacement(testDrag, { ...testDrag }, { x: .4, z: .2 }, { x: .4, z: .2 });
  globalThis.dragStart = { ...testDrag };
  dragPlacement(testDrag, { ...testDrag }, { x: .4, z: .2 }, { x: .4 + qrStep, z: .2 });
  globalThis.dragEnd = testDrag;
`, context);
assert.deepEqual(JSON.parse(JSON.stringify(context.dragStart)), { x: .31, z: -.12 });
assert.ok(Math.abs(context.dragEnd.x - .31 - ENGINE_SETTINGS.qr.blockSize) < 1e-8);

// Focus remains on a button: keyboard transforms must still reach every selection.
const focusedButton = new context.Element();
focusedButton.closest = selector => selector === 'button' ? focusedButton : null;
context.keydown({ target: focusedButton, key: '+', preventDefault() {} });
context.wheel({ deltaY: -100, preventDefault() {} });
assert.equal(vm.runInContext('asset.placements.spring.scale === otherAsset.placements.spring.scale', context), true);
assert.ok(vm.runInContext('asset.placements.spring.scale > 1.1', context));
vm.runInContext('asset.placements.spring.height = .499; otherAsset.placements.spring.height = .499;', context);
context.keydown({ target: focusedButton, key: 'ArrowUp', shiftKey: true, preventDefault() {} });
assert.equal(vm.runInContext('asset.placements.spring.height', context), .5);
context.wheel({ deltaY: 10000, ctrlKey: true, preventDefault() {} });
assert.equal(vm.runInContext('otherAsset.placements.spring.height', context), -.5);

vm.runInContext(`
  const copyApply = { disabled: false };
  const copySeasonButtons = [{ hidden: false, pressed: 'false', getAttribute() { return this.pressed; } }];
  ${definition('copySourceSeason')}
  ${definition('updateCopyApply')}
  updateCopyApply();
  globalThis.copyWithoutTarget = copyApply.disabled;
  copySeasonButtons[0].pressed = 'true';
  updateCopyApply();
  globalThis.copyWithTarget = copyApply.disabled;
  activeSeason = 1;
  updateCopyApply();
  globalThis.copyWithoutSource = copyApply.disabled;
`, context);
assert.equal(context.copyWithoutTarget, true);
assert.equal(context.copyWithTarget, false);
assert.equal(context.copyWithoutSource, true);
vm.runInContext(`
  ${definition('beginMeshTransform')}
  const originalTrackPointer = trackPointer;
  trackPointer = (_event, move) => { globalThis.transformMove = move; };
  const rotationPlacement = { height: 0, scale: 1, rotation: .13 };
  beginMeshTransform({ button: 0, clientX: 100, clientY: 100, currentTarget: { classList: { add() {} } }, preventDefault() {}, stopPropagation() {} }, rotationPlacement, 'rotate');
  transformMove({ clientX: 102, clientY: 100 });
  globalThis.rotationBeforeStep = rotationPlacement.rotation;
  transformMove({ clientX: 122, clientY: 100 });
  globalThis.rotationAfterStep = rotationPlacement.rotation;
  trackPointer = originalTrackPointer;
`, context);
assert.equal(context.rotationBeforeStep, .13);
assert.ok(Math.abs(context.rotationAfterStep - .13 - Math.PI / 12) < 1e-8);
// Mount the actual view wiring with GPU/browser boundaries replaced by small fakes.
const frames = new Map();
const renders = [];
let nextFrame = 0;
let failRender = false;
const renderContext = vm.createContext({
  ENGINE_SETTINGS,
  requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
  ResizeObserver: class { observe() {} },
  createGpuSurface: async () => ({ device: { addEventListener() {}, lost: new Promise(() => {}) } }),
  createQrRenderer: async () => ({ render(options) { if (failRender) throw new Error('Frame failed'); renders.push(options); } }),
});
vm.runInContext(`
  const seasons = ['spring', 'summer', 'autumn', 'winter'];
  const canvases = seasons.map(season => ({
    parentElement: { dataset: { season }, classList: { add() {} } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; },
  }));
  const views = canvases.map(canvas => ({ dataset: canvas.parentElement.dataset }));
  const seasonButtons = [];
  const copySeasons = { hidden: false };
  const renderPlanes = new Map(), planeDropTargets = new Map(), editorScenes = new Map();
  const editorGpu = {};
  const selectedAssets = new Set(), editorAssets = [];
  const editorCamera = { yaw: .78, pitch: -.55, viewScale: 37.7, offset: [0, -.38] };
  const editorThemes = { light: { qr: { dark: [0,0,0], light: [1,1,1] }, clearColor: [1,1,1,1] }, dark: { qr: { dark: [.2,.2,.2], light: [.8,.8,.8] }, clearColor: [0,0,0,1] } };
  let editorTheme = 'light', activeSeason = 0;
  const matrix = Array.from({ length: 29 }, () => Array(29).fill(0));
  const qrStep = ENGINE_SETTINGS.qr.blockSize;
  function updateMeshControls() {}
  function updatePlacementIndicators() {}
  function reportRenderError(cause) { globalThis.renderFailure = cause; }
  function captureEdit() { return []; }
  function commitEdit() {}
  function createSeasonLabelGeometry() { return { opaque: [] }; }
  const dragAsset = { placements: { spring: { x: .1, z: .2 } } };
  let activeAsset = dragAsset;
  function assetAt() { return dragAsset; }
  function trackPointer(_event, move) { globalThis.dragMove = move; }
  ${['sceneForSeason', 'refreshEditorScenes', 'redrawPlanes', 'setActiveSeason', 'snapToQr', 'dragPlacement', 'pointerViewPosition'].map(definition).join('\n')}
  async ${definition('mountPlane')}
`, renderContext);
const flushFrames = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); };
await vm.runInContext('Promise.all(canvases.map(mountPlane))', renderContext);
assert.equal(frames.size, 1);
flushFrames();
assert.deepEqual(renders.map(frame => frame.season), ['spring']);
assert.deepEqual(Array.from(renders[0].clearColor), [0,0,0,0]);
const originalScene = renders[0].scene;
vm.runInContext('refreshEditorScenes(); refreshEditorScenes(); refreshEditorScenes();', renderContext);
assert.equal(frames.size, 1);
flushFrames();
assert.equal(renders.at(-1).scene, originalScene);
vm.runInContext('setActiveSeason(1)', renderContext);
flushFrames();
assert.equal(renders.at(-1).season, 'summer');
vm.runInContext('editorTheme = "dark"; editorScenes.clear(); refreshEditorScenes(); setActiveSeason(0);', renderContext);
flushFrames();
assert.equal(renders.at(-1).season, 'spring');
assert.equal(renders.at(-1).clearColor[0], 0);
assert.notEqual(renders.at(-1).scene, originalScene);
vm.runInContext(`
  canvases[0].listeners.pointerdown({ button: 0, clientX: 400, clientY: 400, preventDefault() {} });
  dragMove({ clientX: 450, clientY: 400 });
  globalThis.away = dragAsset.placements.spring.x;
  dragMove({ clientX: 400, clientY: 400 });
  globalThis.returned = { ...dragAsset.placements.spring };
`, renderContext);
assert.notEqual(renderContext.away, .1);
assert.equal(renderContext.returned.x, .1);
assert.equal(renderContext.returned.z, .2);
failRender = true;
vm.runInContext('refreshEditorScenes()', renderContext);
assert.doesNotThrow(flushFrames);
assert.equal(renderContext.renderFailure.message, 'Frame failed');

// Picking uses actual projected triangles and nearest depth, not the X/Z footprint.
const pickContext = vm.createContext({ Float64Array });
vm.runInContext(`
  const editorCamera = { yaw: 0, pitch: 0 };
  const triangle = z => ({ placements: { spring: {} }, draws: [{ vertices: [0,4,z,0,0,0,0,0, 2,4,z,0,0,0,0,0, 0,6,z,0,0,0,0,0] }] });
  const near = triangle(-2), far = triangle(2);
  const editorAssets = [near, far];
  function assetDraws(asset) { return asset.draws; }
  ${definition('assetAt')}
  globalThis.elevated = assetAt('spring', {x:.5,y:4.5}) === near;
  globalThis.emptyCorner = assetAt('spring', {x:1.9,y:5.9});
  editorAssets.reverse();
  globalThis.orderIndependent = assetAt('spring', {x:.5,y:4.5}) === near;
  editorCamera.yaw = .78; editorCamera.pitch = -.55;
  const x = .5, y = 4.5, z = -2;
  const rz = x * Math.sin(editorCamera.yaw) + z * Math.cos(editorCamera.yaw);
  globalThis.rotated = assetAt('spring', {x:x*Math.cos(editorCamera.yaw)-z*Math.sin(editorCamera.yaw),y:y*Math.cos(editorCamera.pitch)-rz*Math.sin(editorCamera.pitch)}) === near;
`, pickContext);
assert.equal(pickContext.elevated, true);
assert.equal(pickContext.emptyCorner, null);
assert.equal(pickContext.orderIndependent, true);
assert.equal(pickContext.rotated, true);
vm.runInContext('near.hidden = true; far.hidden = true;', pickContext);
assert.equal(pickContext.assetAt('spring', {x:.5,y:4.5}), null);

// Real import flow: an error after parsing converted JSON must retain its error card.
const importContext = vm.createContext({
  console: { error() {} }, Date, Float32Array, TextEncoder, ENGINE_SETTINGS,
  FormData: class { append() {} },
});
vm.runInContext(`
  const editorAssets = [];
  const loading = { removed: false, failed: false, stages: [], item: { remove() { loading.removed = true; } }, setStage(stage) { this.stages.push(stage); }, fail() { this.failed = true; } };
  function appendLoadingAsset() { return loading; }
  async function uploadModel(_data, uploaded) { uploaded(); return '{"version":1,"meshes":[{"draws":[]}]}'; }
  function createPreviewDraws() { globalThis.normalizationReached = true; throw new Error('Invalid converted mesh'); }
  ${definition('parseConvertedModel')}
  async ${definition('importFile')}
`, importContext);
await vm.runInContext("importFile({name:'test.glb'})", importContext);
assert.equal(vm.runInContext('loading.failed && !loading.removed && editorAssets.length === 0', importContext), true);
assert.equal(importContext.normalizationReached, undefined);

let request;
const uploadContext = vm.createContext({ XMLHttpRequest: class {
  constructor() { request = this; this.events = {}; this.uploadEvents = {}; this.upload = { addEventListener: (type, callback) => { this.uploadEvents[type] = callback; } }; }
  open() {} send() {}
  addEventListener(type, callback) { this.events[type] = callback; }
} });
vm.runInContext(definition('uploadModel'), uploadContext);
let converting = false;
const upload = uploadContext.uploadModel({}, () => { converting = true; });
assert.equal(converting, false);
request.uploadEvents.load();
assert.equal(converting, true);
request.status = 200; request.response = '{"version":1,"meshes":[]}'; request.events.load();
assert.equal(await upload, '{"version":1,"meshes":[]}');
const rejectedUpload = uploadContext.uploadModel({}, () => {});
request.status = 500; request.response = '{"error":"Conversion failed"}'; request.events.load();
await assert.rejects(rejectedUpload, /Conversion failed/);

// Preview readiness waits for textures/GPU; resize re-renders and removal disconnects.
let resizePreview, previewFrames = 0, disconnected = false, surfaceDestroyed = false, rendererDestroyed = false;
let previewTick, latestPreview;
let finishTextures;
const texturesReady = new Promise(resolve => { finishTextures = resolve; });
const previewContext = vm.createContext({
  AbortController, cancelAnimationFrame() { previewTick = null; },
  requestAnimationFrame(callback) { previewTick = callback; return 1; },
  console: { error() {} },
  ResizeObserver: class { constructor(callback) { resizePreview = callback; } observe() {} disconnect() { disconnected = true; } },
  createGpuSurface: async () => ({ destroy() { surfaceDestroyed = true; }, device: { pushErrorScope() {}, popErrorScope: async () => null, queue: { onSubmittedWorkDone: async () => {} } } }),
  createQrRenderer: async () => ({ destroy() { rendererDestroyed = true; }, prepareTextures: () => texturesReady, render(options) { previewFrames++; latestPreview = options; } }),
});
vm.runInContext(`
  const matrix = [[1]], editorGpu = {}, editorTheme = 'light', editorThemes = { light: {clearColor:[1,1,1,1]} };
  const reducedMotion = false;
  const asset = {item:{listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}}}, canvas = {clientWidth:52,clientHeight:52}, loading = { removed:false, failed:false, remove() { this.removed=true; }, fail() {this.failed=true;} };
  function assetDraws() { return []; }
  function boundsForDraws() { return {minX:-1,maxX:1,minZ:-1,maxZ:1}; }
  function fitPreviewCamera() { return {yaw:.78,pitch:-.55,viewScale:52,offset:[0,0]}; }
  async ${definition('mountAssetPreview')}
`, previewContext);
const previewReady = vm.runInContext('mountAssetPreview(canvas, asset, loading)', previewContext);
await new Promise(resolve => setImmediate(resolve));
assert.equal(vm.runInContext('loading.removed', previewContext), false);
finishTextures();
await previewReady;
assert.equal(vm.runInContext('loading.removed && !loading.failed', previewContext), true);
assert.equal(previewFrames, 1);
resizePreview();
assert.equal(previewFrames, 2);
vm.runInContext("asset.item.listeners.pointerover({pointerType:'mouse',target:{closest(){return null;}}})", previewContext);
for (let time=50;time<=2000;time+=50) { const tick=previewTick; previewTick=null; tick(time); }
assert.ok(Math.abs(latestPreview.camera.isometric.viewScale / 52 - 1.2) < .001);
assert.ok(latestPreview.camera.isometric.yaw > .78);
vm.runInContext("asset.item.listeners.pointerover({pointerType:'mouse',target:{closest(){return {};}}})", previewContext);
for (let time=2050;time<=5000 && previewTick;time+=50) { const tick=previewTick; previewTick=null; tick(time); }
assert.equal(latestPreview.camera.isometric.viewScale, 52);
assert.equal(latestPreview.camera.isometric.yaw, .78);
assert.equal(previewTick, null);
const completedPreviewFrames = previewFrames;
vm.runInContext('asset.disposePreview()', previewContext);
resizePreview();
assert.equal(previewFrames, completedPreviewFrames);
assert.equal(disconnected && surfaceDestroyed && rendererDestroyed, true);

const rendererSource = readFileSync(new URL('./core/renderer.js', import.meta.url), 'utf8');
const rendererDefinition = name => {
  const start = rendererSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return rendererSource.slice(start, rendererSource.indexOf('\n}', start) + 2);
};
const textureValidationContext = vm.createContext({ ENGINE_SETTINGS });
vm.runInContext(`${rendererDefinition('textureBlob')}\n${rendererDefinition('validateTextureDimensions')}`, textureValidationContext);
assert.throws(() => textureValidationContext.textureBlob({ ok: true, headers: { get: () => 'image/svg+xml' }, blob: async () => null }), /PNG, JPEG or WebP/);
assert.throws(() => textureValidationContext.validateTextureDimensions({ width: 4097, height: 1 }), /4096/);
assert.doesNotThrow(() => textureValidationContext.validateTextureDimensions({ width: 4096, height: 4096 }));
const prepareStart = rendererSource.indexOf('async function prepareTextures(');
const prepareSource = rendererSource.slice(prepareStart, rendererSource.indexOf('\n  }', prepareStart) + 4);
const textureContext = vm.createContext({});
vm.runInContext(`
  const textureCache = new Map();
  function textureViewFor(url) { textureCache.set(url, { promise: Promise.resolve(), error: url === 'broken' ? new Error('Texture failed') : null }); }
  ${prepareSource}
`, textureContext);
await textureContext.prepareTextures([{textureUrl:'ok'}, {textureUrl:'ok'}, {textureUrl:null}]);
assert.equal(vm.runInContext('textureCache.size', textureContext), 1);
await assert.rejects(textureContext.prepareTextures([{textureUrl:'broken'}]), /Texture failed/);

// History stores placements only; material edits preserve geometry, alpha and other seasons.
const historyContext = vm.createContext({ structuredClone, performance, Float32Array });
vm.runInContext(`
  const undoStack = [], redoStack = [], editorAssets = [], selectedAssets = new Set();
  const undoButton = {}, redoButton = {};
  function closeColorPanel() {}
  function syncSelection() {}
  function appendAsset(asset) { asset.mounted = true; }
  function assetDraws(asset) { return asset.draws; }
  ${['captureEdit','commitEdit','updateHistoryControls','restoreEdit','rgbToHex','hexToRgb','colorToRgb','applyMaterialColor','placementDraws'].map(definition).join('\n')}
  const asset = { draws: [{color:[.2,.3,.4,.7], textureUrl:'original.png', vertices: new Float32Array([1,2,3])}], placements: {spring:{x:0,z:0,height:0,scale:1,rotation:0,tilt:0}}, item:{remove(){}}, disposePreview(){} };
  editorAssets.push(asset);
  const start = captureEdit([asset]);
  asset.placements.spring.x = 1;
  commitEdit(start);
  restoreEdit(undoStack,redoStack,'before');
  globalThis.undoMove = asset.placements.spring.x;
  restoreEdit(redoStack,undoStack,'after');
  globalThis.redoMove = asset.placements.spring.x;
  asset.placements.summer = structuredClone(asset.placements.spring);
  const beforeColor = captureEdit([asset]);
  applyMaterialColor(asset,asset.placements.spring,0,[255,128,0]);
  commitEdit(beforeColor);
  globalThis.roundTrip = rgbToHex(colorToRgb(asset.placements.spring.colors[0]));
  globalThis.originalUnchanged = asset.draws[0].color[0] === .2 && !asset.placements.summer.colors;
  const rendered = placementDraws(asset,asset.placements.spring)[0];
  globalThis.preserved = rendered.vertices === asset.draws[0].vertices && rendered.textureUrl === 'original.png' && rendered.color[3] === .7;
  restoreEdit(undoStack,redoStack,'before');
  globalThis.undoColor = !asset.placements.spring.colors;
  restoreEdit(redoStack,undoStack,'after');
  globalThis.redoColor = asset.placements.spring.colors[0][0] === 1;
  const beforeCopy = captureEdit([asset]);
  asset.placements.summer = structuredClone(asset.placements.spring);
  commitEdit(beforeCopy);
  asset.placements.spring.colors[0][0] = .5;
  globalThis.independentCopy = asset.placements.summer.colors[0][0] === 1;
  restoreEdit(undoStack,redoStack,'before');
  globalThis.undoCopy = !asset.placements.summer.colors;
  const beforeRemove = captureEdit([asset]);
  editorAssets.splice(0,1);
  commitEdit(beforeRemove);
  restoreEdit(undoStack,redoStack,'before');
  globalThis.undoRemove = editorAssets[0] === asset && asset.mounted;
  restoreEdit(redoStack,undoStack,'after');
  globalThis.redoRemove = editorAssets.length === 0;
  restoreEdit(undoStack,redoStack,'before');
  const oldLength = undoStack.length;
  for (let i=0;i<3;i++) { const before = captureEdit([asset]); asset.placements.spring.scale += .1; commitEdit(before,'wheel'); }
  globalThis.grouped = undoStack.length === oldLength + 1 && !redoStack.length;
`, historyContext);
assert.equal(historyContext.undoMove, 0);
assert.equal(historyContext.redoMove, 1);
assert.equal(historyContext.roundTrip, '#ff8000');
for (const key of ['originalUnchanged','preserved','undoColor','redoColor','independentCopy','undoCopy','undoRemove','redoRemove','grouped']) assert.equal(historyContext[key], true, key);
assert.equal(historyContext.hexToRgb('invalid'), null);
assert.deepEqual(Array.from(historyContext.hexToRgb('#aAbBcC')), [170,187,204]);
vm.runInContext(`
  const beforeHide = captureEdit([asset]);
  asset.hidden = true;
  commitEdit(beforeHide);
  restoreEdit(undoStack,redoStack,'before');
  globalThis.undoHide = !asset.hidden;
  restoreEdit(redoStack,undoStack,'after');
  globalThis.redoHide = asset.hidden && !selectedAssets.has(asset);
`, historyContext);
assert.equal(historyContext.undoHide, true);
assert.equal(historyContext.redoHide, true);

const metadataCheck = spawnSync('python3', ['-c', `
import io, json, struct
from pathlib import Path
source = Path('tools/export_static_mesh_module.py').read_text()
code = source[source.index('# Preserve source labels'):source.index('meshes = [obj')]
document = {'nodes': [
  {'name':'Crab', 'mesh':0, 'extras':{'description':'A red crab'}},
  {'name':'Bucket', 'mesh':1, 'extras':[]},
  {'mesh':2},
], 'meshes':[{}, {'extras':{'description':'Small bucket'}}, {}]}
payload = json.dumps(document).encode()
blob = b'glTF' + struct.pack('<II', 2, 20 + len(payload)) + struct.pack('<II', len(payload), 0x4e4f534a) + payload
scope = {'source_path':'fixture.glb', 'struct':struct, 'json':json, 'open':lambda *_:io.BytesIO(blob)}
exec(code, scope)
assert scope['source_labels']['Crab'] == ('Crab','A red crab')
assert scope['source_labels']['Bucket'] == ('Bucket','Small bucket')
assert len(scope['source_labels']) == 2
`], { cwd: new URL('.', import.meta.url), encoding: 'utf8' });
assert.equal(metadataCheck.status, 0, metadataCheck.stderr);

const panelContext = vm.createContext({ window: { innerWidth: 800, innerHeight: 600 } });
vm.runInContext(`
  const meshPanel = {style:{},dataset:{},offsetWidth:320,offsetHeight:400};
  const meshCount = {}, editorAssets = [{},{}];
  ${definition('positionMeshPanel')}
  ${definition('updateMeshCount')}
  positionMeshPanel(900,-100);
  updateMeshCount();
  globalThis.panelResult = [meshPanel.style.left,meshPanel.style.top,meshCount.value];
  meshPanel.offsetHeight = 100;
  positionMeshPanel(100,550);
  globalThis.collapsedTop = meshPanel.style.top;
`, panelContext);
assert.deepEqual(Array.from(panelContext.panelResult), ['472px','8px','2']);
assert.equal(panelContext.collapsedTop, '492px');

const indicatorContext = vm.createContext({});
vm.runInContext(`
  const views = [{dataset:{season:'spring'}},{dataset:{season:'summer'}}]; let activeSeason=0;
  const editorAssets = [{name:'Ghost',placements:{spring:{}},item:{classList:{toggle(_name,value){globalThis.placed=value;}},querySelector(){return {setAttribute(_name,value){globalThis.label=value;}};}}}];
  ${definition('updatePlacementIndicators')}
  updatePlacementIndicators();
`, indicatorContext);
assert.equal(indicatorContext.placed, true);
assert.equal(indicatorContext.label, 'Ghost — on spring plane');
vm.runInContext('activeSeason=1; updatePlacementIndicators();', indicatorContext);
assert.equal(indicatorContext.placed, false);

const titleContext = vm.createContext({ document: {}, titleDisplay: { setAttribute() {} }, renderBitmapText() {} });
vm.runInContext(`const composition = {title:'Untitled'}, titleFields = [{},{}]; ${definition('setAnimationTitle')}`, titleContext);
titleContext.setAnimationTitle('  My   animation  ');
assert.equal(vm.runInContext('composition.title', titleContext), 'My animation');
assert.equal(vm.runInContext('titleFields.every(field => field.value === composition.title)', titleContext), true);
titleContext.setAnimationTitle('   ');
assert.equal(vm.runInContext('composition.title', titleContext), 'Untitled');
titleContext.setAnimationTitle('x'.repeat(150));
assert.equal(vm.runInContext('composition.title.length', titleContext), 20);
assert.equal(titleContext.document.title, `${'x'.repeat(20)} · qr3d`);
const sceneExportContext = vm.createContext({ ENGINE_SETTINGS, parseSceneJson, SCENE_JSON_VERSION });
const sceneExportStart = source.indexOf('function createSceneJsonSource(');
const sceneExportDefinition = source.slice(sceneExportStart, source.indexOf('\n\nfunction downloadSceneJson', sceneExportStart));
vm.runInContext(`
  const composition = {title:'Test Scene',qrUrl:'https://russo.kim/test'}, activeSeason = 0, views = [{dataset:{season:'spring'}}], editorTheme = 'light';
  const editorThemes = {light:{qr:{dark:[.1,.2,.3],light:[.8,.9,1]}}};
  const editorAssets = [{name:'Model',hidden:false,placements:{spring:{x:0,z:0,height:0,scale:1,rotation:0,tilt:0}},draws:[{color:[1,.5,0,1],textureUrl:'data:image/png;base64,AA==',vertices:new Float32Array([0,.0245,0,0,1,0,0,0, 1,.0245,0,0,1,0,1,0, 0,.0245,1,0,1,0,0,1])}]}];
  ${sceneExportDefinition}
`, sceneExportContext);
const downloadedSceneJson = sceneExportContext.createSceneJsonSource();
const downloadedScene = createSceneFromJson(JSON.parse(downloadedSceneJson));
assert.equal(downloadedScene.id, 'test-scene');
assert.deepEqual(downloadedScene.settings.seasons, ['spring']);
assert.equal(downloadedScene.settings.qrUrl, 'https://russo.kim/test');
assert.equal(downloadedScene.createFrameGeometry({season:'spring'}).texturedOpaque[0].textureUrl, 'data:image/png;base64,AA==');
assert.equal(downloadedScene.createFrameGeometry({season:'summer'}).texturedOpaque.length, 0);
const exportControlContext = vm.createContext({});
vm.runInContext(`
  const exportSceneButton = {}, exportPanel = {hidden:false}, editorAssets = [];
  function syncPanelOverlay() {}
  ${definition('updateExportControl')}
  updateExportControl();
  globalThis.emptyDisabled = exportSceneButton.disabled && exportPanel.hidden;
  editorAssets.push({hidden:false,placements:{spring:{}}});
  updateExportControl();
  globalThis.placedEnabled = !exportSceneButton.disabled;
`, exportControlContext);
assert.equal(exportControlContext.emptyDisabled, true);
assert.equal(exportControlContext.placedEnabled, true);
const bitmapContext = vm.createContext({ document: {
  createElementNS(namespace, tag) { return { tag, attributes: {}, children: [], setAttribute(key, value) { this.attributes[key] = value; }, append(child) { this.children.push(child); } }; }
} });
const fontStart = source.indexOf('const bitmapFont =');
vm.runInContext(source.slice(fontStart, source.indexOf('\n});', fontStart) + 4) + '\n' + definition('renderBitmapText'), bitmapContext);
for (const label of ['qr3d', 'Untitled', 'Spring', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789']) {
  const target = { replaceChildren(svg) { this.svg = svg; } };
  bitmapContext.renderBitmapText(target, label);
  assert.equal(target.svg.children.length, label.length);
  assert.ok(target.svg.children.every(glyph => glyph.tag === 'path' && glyph.attributes.d.length > 0));
}
vm.runInContext('activeSeason=0; delete editorAssets[0].placements.spring; updatePlacementIndicators();', indicatorContext);
assert.equal(indicatorContext.placed, false);

const framingContext = vm.createContext({ ENGINE_SETTINGS });
vm.runInContext(`const matrix = Array(29); ${definition('fitPreviewCamera')}`, framingContext);
const points = [[3,5,1],[4,5,1],[3,8,2]];
const previewDraws = [{vertices: points.flatMap(point => [...point,0,1,0,0,0])}];
for (const aspect of [.6, 1, 2]) {
  const camera = framingContext.fitPreviewCamera(previewDraws, aspect);
  const projected = points.map(([x,y,z]) => [
    (x*Math.cos(camera.yaw)-z*Math.sin(camera.yaw)+camera.offset[0])*camera.viewScale/29/Math.max(aspect,1),
    (y*Math.cos(camera.pitch)-(x*Math.sin(camera.yaw)+z*Math.cos(camera.yaw))*Math.sin(camera.pitch)+camera.offset[1])*camera.viewScale/29/Math.max(1/aspect,1),
  ]);
  const extents = [0,1].map(axis => { const values = projected.map(point => point[axis]); return [Math.min(...values),Math.max(...values)]; });
  for (const [min,max] of extents) assert.ok(Math.abs(min+max)<1e-9);
  assert.ok(Math.abs(Math.max(...extents.map(([min,max])=>max-min))-2)<1e-9);
}

// Canvas colors follow CSS tokens in both themes, including after toggling back.
const uiCss = readFileSync(new URL('./core/ui.css', import.meta.url), 'utf8');
const lightTokens = uiCss.match(/:root \{\n([\s\S]*?)\n\}/)[1];
const darkTokens = uiCss.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)[1];
const root = { dataset: {} };
const themeContext = vm.createContext({
  document: { documentElement: root, querySelector: () => ({ setAttribute() {} }) },
  localStorage: { setItem() {} },
  getComputedStyle: () => ({ getPropertyValue(token) {
    const tokens = root.dataset.theme === 'dark' ? darkTokens : lightTokens;
    return tokens.match(new RegExp(`${token}: ([^;]+);`))[1];
  } }),
});
vm.runInContext(`const editorThemes = {}; let editorTheme; const themeToggle = {setAttribute(){}}; ${definition('hexToRgb')} ${definition('applyEditorTheme')}`, themeContext);
for (const theme of ['light','dark','light']) {
  themeContext.applyEditorTheme(theme);
  const colors = vm.runInContext('editorThemes[editorTheme]', themeContext);
  const expected = theme === 'light' ? [243,244,244] : [24,33,39];
  assert.deepEqual(Array.from(colors.clearColor.slice(0,3), value => Math.round(value * 255)), expected);
  assert.equal(colors.selection.length, 3);
}
