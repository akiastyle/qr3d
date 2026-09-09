import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createQrBounds, moduleToWorld } from "./bounds.js";
import { createBindGroup, createBindGroupLayout, createGpuSurface, createIndexBuffer, createVertexBuffer } from "./gpu.js";
import { createTransitionBlur } from "./blur.js";
import { createCamera } from "./camera.js";
import { QR_MODULE_VERTEX_COUNT } from "./qr-plane.js";
import { createPrimitive, PRIMITIVE } from "./mesh.js";
import { createMaterial } from "./material.js";
import { normalizeSeason } from "./season.js";
import { createQrRenderer, normalizeQrColors } from "./renderer.js";
import { defineScene } from "./scene-definition.js";
import { createSceneModule, createSceneRuntime } from "./scene-runtime.js";
import { SCENE_UNIFORM_WGSL, createIsometricTransformWgsl } from "./scene-wgsl.js";
import { writeSceneUniforms } from "./scene-uniforms.js";
import { advanceViewTransition, easeViewTransition } from "./view-transition.js";
import { SCENE as BEACH_SCENE } from "../scenes/beach.js";
import { ENGINE_SETTINGS } from "./settings.js";
import { mountQr3d } from "../player.js";
import { validateQrUrl } from "./qr.js";
import { createSceneFromJson, loadSceneJson, parseSceneJson } from "./scene-json.js";

const bounds = createQrBounds(21, .0245);
assert.equal(moduleToWorld(10, 10, bounds).x, 0);
assert.equal(QR_MODULE_VERTEX_COUNT, 36);
assert.equal(createCamera().yaw, .78);
assert.equal(createCamera("qr").pitch, -1.5708);
assert.equal(ENGINE_SETTINGS.qr.blockSize, .0245);
assert.equal(createPrimitive(PRIMITIVE.CYLINDER).segments, 12);
assert.equal(createMaterial({ opacity: .5 }).transparent, true);
assert.equal(normalizeSeason("winter"), "winter");
assert.deepEqual(normalizeQrColors({ dark: [0, 0, 0], light: [1, 1, 1] }), { dark: [0, 0, 0], light: [1, 1, 1] });
const testScene = defineScene({ id: "test", label: "Test", colors: { qr: {}, elements: {} }, elements: ["base"], seasons: { summer: ["summer"] } });
assert.deepEqual(Object.keys(testScene.seasons), ["spring", "summer", "autumn", "winter"]);
assert.deepEqual(testScene.elements, ["base"]);
assert.deepEqual(testScene.seasons.summer, ["summer"]);
assert.equal(BEACH_SCENE.id, "beach");
await assert.rejects(mountQr3d(null), /At least one scene is required/);
await assert.rejects(mountQr3d(null, { scenes: [{}], viewInteraction: "drag" }), /viewInteraction/);
await assert.rejects(mountQr3d(null, { scenes: [{}], autoplaySeconds: 61 }), /autoplaySeconds/);
assert.equal(validateQrUrl("https://russo.kim"), "https://russo.kim");
assert.throws(() => validateQrUrl("http://example.com"), /HTTPS/);
assert.throws(() => validateQrUrl("javascript:alert(1)"), /HTTPS/);
assert.throws(() => validateQrUrl(`https://example.com/${"x".repeat(50)}`), /50/);
const jsonSceneDocument = {
  version: 1,
  id: "json-scene",
  label: "JSON scene",
  settings: { seasons: ["spring"], defaultSeason: "spring", qrUrl: "https://russo.kim" },
  colors: { qr: { dark: [.1, .2, .3], light: [.8, .9, 1] } },
  textures: [],
  assets: [{ name: "triangle", placements: { spring: { x: 0, z: 0, height: 0, scale: 1, rotation: 0, tilt: 0 } }, draws: [{ color: [1, 1, 1, 1], texture: -1, vertices: [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1] }] }],
};
const jsonScene = createSceneFromJson(jsonSceneDocument);
assert.equal(jsonScene.id, "json-scene");
assert.equal(jsonScene.createFrameGeometry({ season: "spring" }).texturedOpaque[0].vertices.length, 24);
assert.throws(() => createSceneFromJson({ ...jsonSceneDocument, script: "alert(1)" }), /not allowed/);
assert.throws(() => parseSceneJson("x".repeat(ENGINE_SETTINGS.scene.maxJsonBytes + 1)), /exceed/);
globalThis.document = { baseURI: "https://example.com/app/" };
globalThis.location = { origin: "https://example.com" };
globalThis.fetch = async () => new Response(JSON.stringify(jsonSceneDocument), { headers: { "content-type": "application/json" } });
assert.equal((await loadSceneJson("./scene.json")).id, "json-scene");
await assert.rejects(loadSceneJson("https://invalid.example/scene.json"), /page origin/);
globalThis.fetch = async () => new Response("{}", { headers: { "content-type": "text/plain" } });
await assert.rejects(loadSceneJson("./scene.json"), /application\/json/);
delete globalThis.document;
delete globalThis.location;
delete globalThis.fetch;
assert.equal(advanceViewTransition(.9995, true, .016), 1);
assert.equal(easeViewTransition(.5), .5);
assert.match(SCENE_UNIFORM_WGSL, /beachSeason: f32/);
assert.match(createIsometricTransformWgsl("point"), /point\.x/);
const gpuCalls = [];
const fakeDevice = {
  createBindGroupLayout(descriptor) { gpuCalls.push(["layout", descriptor]); return "layout"; },
  createBindGroup(descriptor) { gpuCalls.push(["group", descriptor]); return "group"; },
};
assert.equal(createBindGroupLayout(fakeDevice, { entries: [] }), "layout");
assert.equal(createBindGroup(fakeDevice, { layout: "layout", entries: [] }), "group");
assert.deepEqual(gpuCalls.map(([kind]) => kind), ["layout", "group"]);
globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2 };
globalThis.GPUBufferUsage ??= { UNIFORM: 1, STORAGE: 2, COPY_DST: 4, VERTEX: 8, INDEX: 16 };
globalThis.GPUTextureUsage ??= { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 };
globalThis.devicePixelRatio ??= 1;
let configured = false, unconfigured = false;
const sharedDevice = {};
const sharedSurface = await createGpuSurface({
  clientWidth: 10,
  clientHeight: 5,
  getContext() { return { configure({ device }) { configured = device === sharedDevice; }, unconfigure() { unconfigured = true; } }; },
}, { adapter: {}, device: sharedDevice, format: "rgba8unorm" });
assert.equal(sharedSurface.resize(), true);
assert.equal(configured, true);
sharedSurface.setTransparent(true);
assert.equal(sharedSurface.transparent, true);
assert.equal(sharedSurface.clearColor[3], 0);
sharedSurface.destroy();
assert.equal(unconfigured, true);
let pipelineCreations = 0;
const pipelineDevice = {
  createShaderModule() { return {}; },
  createRenderPipeline() { pipelineCreations++; return { getBindGroupLayout() { return {}; } }; },
  createSampler() { return {}; },
  createTexture() { return { createView() { return {}; }, destroy() {} }; },
  createBuffer() { return { destroy() {} }; },
  queue: { writeTexture() {} },
};
const pipelineSurface = { device: pipelineDevice, context: {}, format: "rgba8unorm" };
const firstQrRenderer = await createQrRenderer({}, pipelineSurface);
const secondQrRenderer = await createQrRenderer({}, pipelineSurface);
assert.equal(pipelineCreations, 6);
firstQrRenderer.destroy();
secondQrRenderer.destroy();
const uploadedBuffers = [];
const uploadDevice = {
  createBuffer(descriptor) { uploadedBuffers.push(["buffer", descriptor]); return descriptor; },
  queue: { writeBuffer(buffer, offset, data) { uploadedBuffers.push(["write", buffer, offset, data.byteLength]); } },
};
createVertexBuffer(uploadDevice, new Float32Array([1, 2, 3]));
createIndexBuffer(uploadDevice, new Uint16Array([0, 1, 2]));
assert.deepEqual(uploadedBuffers.map(([kind]) => kind), ["buffer", "write", "buffer", "write"]);
assert.ok(uploadedBuffers.filter(([kind]) => kind === "write").every(([, , , byteLength]) => byteLength % 4 === 0));
const blurCalls = [];
const blurDevice = {
  createSampler: descriptor => ({ descriptor }),
  createBindGroupLayout: descriptor => ({ descriptor }),
  createBindGroup: descriptor => { blurCalls.push(descriptor); return { descriptor }; },
  createPipelineLayout: descriptor => ({ descriptor }),
  createShaderModule: descriptor => ({ descriptor }),
  createRenderPipeline: descriptor => ({ descriptor }),
};
const blur = createTransitionBlur(blurDevice, "rgba8unorm", "uniforms", "scene-view");
assert.ok(blur.pipeline);
assert.equal(blurCalls.length, 1);
blur.createBindGroup("resized-scene-view");
assert.equal(blurCalls.length, 2);
const writes = [];
const uniformRenderer = { aspectRatio: 2, counts: { gridSize: 21, blocks: 42 }, _uniformArr: new Float32Array(16), device: { queue: { writeBuffer(buffer, offset, values) { writes.push([buffer, offset, [...values]]); } } } };
writeSceneUniforms(uniformRenderer, { time: 3, season: 1, customStrength: 1 }, [
  { buffer: "blocks", count: "blocks" },
  { buffer: "leaves", count: 7, overrides: { season: 2, customStrength: 0 } },
]);
assert.deepEqual(writes.map(([buffer, , values]) => [buffer, values[1], values[2], values[7], values[12]]), [["blocks", 3, 42, 1, 1], ["leaves", 3, 7, 2, 0]]);

const lifecycle = [];
const runtimeScene = createSceneModule({
  id: "runtime",
  settings: { seasons: ["spring", "summer"], defaultSeason: "summer" },
  createRuntime(options) {
    lifecycle.push(["start", options.content, options.season]);
    return {
      dispose() { lifecycle.push(["dispose"]); },
      setSeason(value) { lifecycle.push(["season", value]); },
      setFlat(value) { lifecycle.push(["flat", value]); },
    };
  },
});
assert.deepEqual(runtimeScene.settings.seasons, ["spring", "summer"]);
assert.equal(runtimeScene.settings.defaultSeason, "summer");
runtimeScene.mount({ canvas: {}, url: "a", season: "spring", gpuSurface: {}, qrRenderer: {} });
runtimeScene.setSeason("autumn");
runtimeScene.toggleFlat();
runtimeScene.setFlat(false);
runtimeScene.setUrl("b");
runtimeScene.unmount();
assert.deepEqual(lifecycle, [
  ["start", "a", 0], ["season", 2], ["flat", true], ["flat", false], ["dispose"], ["start", "b", 2], ["dispose"],
]);

let cleaned = false;
const runtime = createSceneRuntime({ canvas: { clientWidth: 8, clientHeight: 4 }, content: "x", season: 1, isFlat: { current: false } }, state => {
  assert.equal(state.canvasWidth, 8);
  assert.equal(state.canvasHeight, 4);
  state.runSetup(() => () => { cleaned = true; });
});
runtime.setSeason(2);
runtime.setFlat(true);
runtime.dispose();
assert.equal(cleaned, true);

const beachSource = readFileSync(new URL("../scenes/beach.js", import.meta.url), "utf8");
const rendererSource = readFileSync(new URL("./renderer.js", import.meta.url), "utf8");
const sceneSources = ["three.js", "fountain.js", "beach.js"].map(file => readFileSync(new URL(`../scenes/${file}`, import.meta.url), "utf8"));
assert.ok(
  beachSource.indexOf("qrRenderer.renderQrPass({ encoder: commandEncoder") <
    beachSource.indexOf("mainRenderPass.setPipeline(pipelines.beach)"),
  "Beach: il QR deve essere disegnato prima del terreno",
);
assert.ok(
  beachSource.indexOf("mainRenderPass.setPipeline(pipelines.beach)") <
    beachSource.indexOf("mainRenderPass.setPipeline(pipelines.beachWater)"),
  "Beach: la sabbia deve essere disegnata prima dell'acqua trasparente",
);
assert.match(beachSource, /beachMode && sceneState\.rainMode > 0\.01 && counts\.rainCount > 0 && pipelines\.rain/);
assert.match(rendererSource, /progress: sceneState\.progress/);
assert.match(rendererSource, /time: sceneState\.time/);
assert.match(rendererSource, /renderTargets\?\.resize\?\.\(\)/);
for (const sceneSource of sceneSources) {
  assert.match(sceneSource, /createRenderTargets/);
  assert.match(sceneSource, /createScenePipeline/);
  assert.match(sceneSource, /createUniformBuffer/);
  assert.match(sceneSource, /createStorageBuffer/);
  assert.match(sceneSource, /createFrameLoop/);
  assert.match(sceneSource, /renderTargets\.resize\(\)/);
  assert.doesNotMatch(sceneSource, /_surfaceWidth|_surfaceHeight/);
  assert.doesNotMatch(sceneSource, /function createRenderPipeline/);
  assert.doesNotMatch(sceneSource, /function renderScene/);
  assert.doesNotMatch(sceneSource, /export function create(?:Tree|Fountain|Beach)Renderer/);
  assert.doesNotMatch(sceneSource, /function create(?:Tree|Fountain|Beach)Runtime/);
  assert.doesNotMatch(sceneSource, /function createUniformBuffer|function createStorageBuffer/);
  assert.doesNotMatch(sceneSource, /m\.use|cleanupStack/);
  assert.doesNotMatch(sceneSource, /(?:deviceAt354206|gpuDeviceAt354206|rendererState(?:At220be7)?\.device)\.createBindGroup(?:Layout)?\(/);
  assert.doesNotMatch(sceneSource, /(?:var|const) ye\s*=|function we\s*\(/);
  assert.match(sceneSource, /createSceneModule/);
  assert.match(sceneSource, /createSceneRuntime/);
  assert.match(sceneSource, /SCENE_UNIFORM_WGSL/);
  assert.match(sceneSource, /createIsometricTransformWgsl/);
  assert.match(sceneSource, /createBindGroup/);
  assert.match(sceneSource, /createTransitionBlur/);
  assert.match(sceneSource, /writeSceneUniforms/);
  assert.match(sceneSource, /renderSceneFrame/);
}
