import { createQrRenderer } from "./core/renderer.js";
import { createGpuSurface } from "./core/gpu.js";
import { encodeQrMatrix } from "./core/qr.js";
import { normalizeSeason } from "./core/season.js";
import { loadSceneJson } from "./core/scene-json.js";
import { ENGINE_SETTINGS } from "./core/settings.js";
import { advanceViewTransition, easeViewTransition } from "./core/view-transition.js";

const { defaultId: defaultScene, defaultSeason, defaultUrl } = ENGINE_SETTINGS.scene;
const form = document.querySelector("[data-url-form]");
const input = form.elements.url;
const sceneControls = document.querySelector("[data-scene-controls]");
const sceneToggle = document.querySelector("[data-scene-toggle]");
const sceneRow = document.querySelector("[data-scene-row]");
const seasonButtons = [...document.querySelectorAll("[data-season]")];
const seasonControls = document.querySelector("[data-season-controls]");
const seasonToggle = document.querySelector("[data-season-toggle]");
const sceneLoaders = Object.fromEntries(Object.entries(ENGINE_SETTINGS.scene.modules).map(([id, definition]) => [id, definition.path.endsWith(".json") ? () => loadSceneJson(definition.path) : () => import(definition.path).then(module => module.SCENE)]));
const sceneButtons = Object.entries(ENGINE_SETTINGS.scene.modules).map(([id, definition]) => {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.scene = id;
  button.setAttribute("aria-label", definition.label);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", definition.icon);
  svg.append(path);
  button.append(svg);
  button.addEventListener("click", () => loadScene(id));
  sceneRow.append(button);
  return button;
});
const canvas = document.querySelector("canvas");
const webgpuError = document.querySelector("[data-webgpu-error]");
const sceneStateKey = "icqr.scene-state";
const savedSceneState = (() => {
  try { return JSON.parse(localStorage.getItem(sceneStateKey) || "null"); }
  catch { return null; }
})();
let renderer = null;
let gpuSurface = null;
let scene = null;
let activeSceneId = null;
let season = normalizeSeason(savedSceneState?.season ?? defaultSeason);
let flatTarget = false;
let flatProgress = 0;
let animationFrame = 0;
let previousFrameTime = 0;
let transientScene = false;

function saveSceneState() {
  if (!activeSceneId || transientScene) return;
  try { localStorage.setItem(sceneStateKey, JSON.stringify({ scene: activeSceneId, season })); }
  catch { /* Storage can be disabled by the browser. */ }
}

async function ensureQrRenderer() {
  if (renderer) return renderer;
  gpuSurface ??= await createGpuSurface(canvas);
  gpuSurface.setTransparent(true);
  renderer = await createQrRenderer(canvas, gpuSurface);
  new ResizeObserver(render).observe(canvas);
  return renderer;
}

function render(time = performance.now() / 1000) {
  if (scene?.mount) return;
  renderer?.render({ matrix: encodeQrMatrix(input.value), scene, season, progress: easeViewTransition(flatProgress), time, onTextureLoad: render });
}

function animateFlatTransition(time) {
  const deltaSeconds = Math.min((time - previousFrameTime) / 1000, .05);
  previousFrameTime = time;
  flatProgress = advanceViewTransition(flatProgress, flatTarget, deltaSeconds);
  render();
  animationFrame = flatProgress === (flatTarget ? 1 : 0) ? 0 : requestAnimationFrame(animateFlatTransition);
}

function selectSeason(nextSeason) {
  if (scene?.settings && !scene.settings.seasons.includes(nextSeason)) return;
  season = nextSeason;
  for (const button of seasonButtons) button.setAttribute("aria-pressed", String(button.dataset.season === season));
  scene?.setSeason?.(season);
  saveSceneState();
  seasonControls.classList.remove("is-open");
  seasonToggle.setAttribute("aria-expanded", "false");
  render();
}

function configureSeasonControls(settings) {
  const availableSeasons = settings?.seasons ?? [];
  const interactive = availableSeasons.length > 1;
  seasonControls.hidden = !interactive;
  seasonControls.classList.remove("is-open");
  seasonToggle.setAttribute("aria-expanded", "false");
  for (const button of seasonButtons) button.hidden = !availableSeasons.includes(button.dataset.season);
  if (availableSeasons.length) selectSeason(availableSeasons.includes(season) ? season : settings.defaultSeason);
}

async function loadScene(sceneId) {
  sceneControls.classList.remove("is-open");
  sceneToggle.setAttribute("aria-expanded", "false");
  const loader = sceneLoaders[sceneId];
  if (!loader) throw new RangeError("Scena non disponibile");
  await activateScene(await loader(), sceneId);
}

async function activateScene(nextScene, sceneId, transient = false) {
  scene?.unmount?.();
  scene = nextScene;
  activeSceneId = sceneId;
  transientScene = transient;
  if (transient && scene.settings.qrUrl) input.value = scene.settings.qrUrl;
  gpuSurface ??= await createGpuSurface(canvas);
  const qrRenderer = await ensureQrRenderer();
  qrRenderer.setMatrix(encodeQrMatrix(input.value));
  configureSeasonControls(scene.settings);
  if (scene.mount) await scene.mount({ canvas, url: input.value, season, gpuSurface, qrRenderer });
  else qrRenderer.setScene(scene);
  for (const button of sceneButtons) button.setAttribute("aria-pressed", String(!transient && button.dataset.scene === sceneId));
  saveSceneState();
  render();
}

export function activateTransientScene(nextScene) {
  document.documentElement.classList.add("plugin-player");
  return activateScene(nextScene, nextScene.id, true);
}

input.value = defaultUrl;
form.addEventListener("submit", event => { event.preventDefault(); renderer?.setMatrix(encodeQrMatrix(input.value)); scene?.setUrl?.(input.value); render(); });
sceneToggle.addEventListener("click", () => {
  const open = sceneControls.classList.toggle("is-open");
  sceneToggle.setAttribute("aria-expanded", String(open));
});
for (const button of seasonButtons) button.addEventListener("click", () => selectSeason(button.dataset.season));
seasonToggle.addEventListener("click", () => {
  const open = seasonControls.classList.toggle("is-open");
  seasonToggle.setAttribute("aria-expanded", String(open));
});
selectSeason(season);
canvas.addEventListener("click", () => {
  if (scene?.mount) return scene.toggleFlat();
  flatTarget = !flatTarget;
  if (!animationFrame) { previousFrameTime = performance.now(); animationFrame = requestAnimationFrame(animateFlatTransition); }
});
try {
  await loadScene(sceneLoaders[savedSceneState?.scene] ? savedSceneState.scene : defaultScene);
} catch (error) {
  console.error("Avvio scena fallito:", error);
  webgpuError.textContent = navigator.gpu
    ? "Impossibile avviare la scena WebGPU. Controlla la console."
    : "WebGPU non è disponibile in questo browser.";
  webgpuError.hidden = false;
}
