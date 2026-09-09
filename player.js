import { createGpuSurface } from "./core/gpu.js";
import { encodeQrMatrix, validateQrUrl } from "./core/qr.js";
import { createQrRenderer } from "./core/renderer.js";
import { loadSceneJson } from "./core/scene-json.js";
import { ENGINE_SETTINGS } from "./core/settings.js";
import { advanceViewTransition, easeViewTransition } from "./core/view-transition.js";

const seasonIcons = Object.freeze({ spring: "✿", summer: "☼", autumn: "♧", winter: "❄" });
let qrEncoderPromise = null;

function loadQrEncoder() {
  if (typeof globalThis.qrcode === "function") return Promise.resolve();
  if (!qrEncoderPromise) qrEncoderPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("./core/vendor/qrcode.js", import.meta.url);
    script.onload = resolve;
    script.onerror = () => reject(new Error("Unable to load the QR encoder"));
    document.head.append(script);
  });
  return qrEncoderPromise;
}

function playerTarget(target) {
  const element = typeof target === "string" ? document.querySelector(target) : target;
  if (!(element instanceof Element)) throw new TypeError("A valid player target is required");
  return element;
}

const sceneFrom = source => {
  if (typeof source !== "string" && !(source instanceof URL)) throw new TypeError("Each scene must be a JSON URL");
  return loadSceneJson(source);
};

function timerSeconds(value, name) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > ENGINE_SETTINGS.scene.maxTimerSeconds || (seconds > 0 && seconds < 1)) throw new RangeError(`${name} must be 0 or between 1 and ${ENGINE_SETTINGS.scene.maxTimerSeconds}`);
  return seconds;
}

export async function mountQr3d(target, {
  scenes,
  url = null,
  autoplaySeconds = 0,
  transparent = false,
  viewInteraction = "click",
  qrAutoplaySeconds = 0,
  qrHoldSeconds = 2,
} = {}) {
  if (!Array.isArray(scenes) || !scenes.length) throw new TypeError("At least one scene is required");
  if (!["click", "hover", "none"].includes(viewInteraction)) throw new RangeError("viewInteraction must be click, hover, or none");
  autoplaySeconds = timerSeconds(autoplaySeconds, "autoplaySeconds");
  qrAutoplaySeconds = timerSeconds(qrAutoplaySeconds, "qrAutoplaySeconds");
  qrHoldSeconds = timerSeconds(qrHoldSeconds, "qrHoldSeconds");
  const host = playerTarget(target);
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  root.replaceChildren();

  const style = document.createElement("style");
  style.textContent = `
    :host{display:block;min-height:240px;--ui-bg:#f3f4f4;--ui-ground:#eeeff0;--ui-muted:#65707b;--ui-accent:#263b48;--ui-on-accent:#fff;--ui-panel:#fff;--ui-hover:#edf0f2;--ui-focus:#263b48;--ui-panel-shadow:0 4px 8px #18253612;--ui-control-shadow:0 2px 4px #18253610}
    *{box-sizing:border-box}
    .shell{position:relative;width:100%;height:100%;min-height:240px;overflow:hidden;background:${transparent ? "transparent" : "radial-gradient(at 51% 43%,transparent 35%,#83919e0f 100%),linear-gradient(to bottom,var(--ui-bg) 46%,var(--ui-ground) 46%)"}}
    canvas{display:block;width:100%;height:100%;min-height:240px;background:transparent}
    nav{position:absolute;right:10px;top:50%;display:flex;flex-direction:column;gap:2px;padding:5px;border-radius:13px;background:var(--ui-panel);box-shadow:var(--ui-panel-shadow);transform:translateY(-50%)}
    button{display:grid;width:40px;min-height:44px;padding:0;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--ui-muted);cursor:pointer;font:500 20px/1 system-ui,sans-serif;transition:background 160ms cubic-bezier(.4,0,.2,1),color 160ms cubic-bezier(.4,0,.2,1),transform 160ms cubic-bezier(.4,0,.2,1),box-shadow 160ms cubic-bezier(.4,0,.2,1)}
    button:hover{background:var(--ui-hover);transform:translateY(-2px);box-shadow:var(--ui-control-shadow)}
    button:active{transform:scale(.94)}
    button[aria-pressed="true"]{background:var(--ui-accent);color:var(--ui-on-accent);box-shadow:var(--ui-control-shadow)}
    button:focus-visible{outline:2px solid var(--ui-focus);outline-offset:2px}
    .error{position:absolute;inset:0;display:grid;place-items:center;margin:0;padding:24px;color:var(--ui-muted);font:600 18px/1.4 system-ui,sans-serif;text-align:center}
    [hidden]{display:none}
    @media(max-width:480px){nav{right:4px}}
    @media(prefers-reduced-motion:reduce){button{transition:none}}
  `;
  const shell = document.createElement("div");
  shell.className = "shell";
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", "3D QR scene");
  const controls = document.createElement("nav");
  controls.setAttribute("aria-label", "Seasons");
  const error = document.createElement("p");
  error.className = "error";
  error.hidden = true;
  shell.append(canvas, controls, error);
  root.append(style, shell);

  let surface, renderer;
  try {
    await loadQrEncoder();
    surface = await createGpuSurface(canvas);
    surface.setTransparent(true);
    renderer = await createQrRenderer(canvas, surface);
  } catch (cause) {
    showError();
    throw cause;
  }
  const sceneCache = new Map();
  let scene = null;
  let sceneIndex = 0;
  let season = null;
  let content = url === null ? null : validateQrUrl(url);
  let useSceneQr = url === null;
  let autoplayTimer = 0;
  let qrAutoplayTimer = 0;
  let qrReturnTimer = 0;
  let flatTarget = false;
  let flatProgress = 0;
  let transitionFrame = 0;
  let previousFrameTime = 0;

  const resolveScene = index => {
    if (!sceneCache.has(index)) sceneCache.set(index, sceneFrom(scenes[index]));
    return sceneCache.get(index);
  };

  function render(time = performance.now() / 1000) {
    if (!scene?.mount) renderer.render({ matrix: encodeQrMatrix(content), scene, season, progress: easeViewTransition(flatProgress), time, onTextureLoad: render });
  }

  function scheduleAutoplay() {
    clearTimeout(autoplayTimer);
    autoplayTimer = autoplaySeconds > 0 ? setTimeout(() => advance().catch(showError), autoplaySeconds * 1000) : 0;
  }

  function scheduleQrAutoplay() {
    clearTimeout(qrAutoplayTimer);
    clearTimeout(qrReturnTimer);
    qrAutoplayTimer = qrAutoplaySeconds > 0 ? setTimeout(() => {
      showQr(true, false);
      qrReturnTimer = setTimeout(() => { showQr(false, false); scheduleQrAutoplay(); }, Math.max(0, qrHoldSeconds) * 1000);
    }, qrAutoplaySeconds * 1000) : 0;
  }

  function showError() {
    error.textContent = navigator.gpu ? "Unable to start the WebGPU scene." : "WebGPU is not available in this browser.";
    error.hidden = false;
  }

  function setSeason(nextSeason, reschedule = true) {
    if (!scene.settings.seasons.includes(nextSeason)) throw new RangeError("Season not available in the active scene");
    season = nextSeason;
    for (const button of controls.children) button.setAttribute("aria-pressed", String(button.dataset.season === season));
    scene.setSeason?.(season);
    render();
    if (reschedule) scheduleAutoplay();
  }

  function buildSeasonControls() {
    controls.replaceChildren(...scene.settings.seasons.map(name => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.season = name;
      button.setAttribute("aria-label", name[0].toUpperCase() + name.slice(1));
      button.textContent = seasonIcons[name] ?? "•";
      button.addEventListener("click", () => setSeason(name));
      return button;
    }));
    controls.hidden = scene.settings.seasons.length < 2;
  }

  async function setScene(index, preferredSeason = null, reschedule = true) {
    if (!Number.isInteger(index) || index < 0 || index >= scenes.length) throw new RangeError("Scene index not available");
    const nextScene = await resolveScene(index);
    scene?.unmount?.();
    scene = nextScene;
    sceneIndex = index;
    flatTarget = false;
    flatProgress = 0;
    season = scene.settings.seasons.includes(preferredSeason) ? preferredSeason : scene.settings.defaultSeason ?? scene.settings.seasons[0];
    if (useSceneQr) content = validateQrUrl(scene.settings.qrUrl ?? ENGINE_SETTINGS.scene.defaultUrl);
    renderer.setMatrix(encodeQrMatrix(content));
    renderer.setScene(scene);
    buildSeasonControls();
    if (scene.mount) await scene.mount({ canvas, url: content, season, gpuSurface: surface, qrRenderer: renderer });
    setSeason(season, false);
    if (reschedule) scheduleAutoplay();
  }

  async function advance() {
    const seasons = scene.settings.seasons;
    const nextSeasonIndex = seasons.indexOf(season) + 1;
    if (nextSeasonIndex < seasons.length) setSeason(seasons[nextSeasonIndex], false);
    else if (scenes.length > 1) await setScene((sceneIndex + 1) % scenes.length, null, false);
    else setSeason(seasons[0], false);
    scheduleAutoplay();
  }

  function animateFlatTransition(time) {
    const deltaSeconds = Math.min((time - previousFrameTime) / 1000, ENGINE_SETTINGS.animation.maxFrameDelta);
    previousFrameTime = time;
    flatProgress = advanceViewTransition(flatProgress, flatTarget, deltaSeconds);
    render();
    transitionFrame = flatProgress === (flatTarget ? 1 : 0) ? 0 : requestAnimationFrame(animateFlatTransition);
  }

  function showQr(value, reschedule = true) {
    flatTarget = Boolean(value);
    if (scene?.mount) scene.setFlat?.(flatTarget);
    else if (!transitionFrame) {
      previousFrameTime = performance.now();
      transitionFrame = requestAnimationFrame(animateFlatTransition);
    }
    if (reschedule) scheduleQrAutoplay();
  }

  if (viewInteraction === "click") canvas.addEventListener("click", () => showQr(!flatTarget));
  if (viewInteraction === "hover") {
    canvas.addEventListener("pointerenter", () => showQr(true));
    canvas.addEventListener("pointerleave", () => showQr(false));
  }
  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(canvas);

  try { await setScene(0); scheduleQrAutoplay(); }
  catch (cause) {
    showError();
    renderer.destroy();
    surface.destroy();
    throw cause;
  }

  return Object.freeze({
    get scene() { return scene; },
    get season() { return season; },
    setScene,
    setSeason,
    async setUrl(nextUrl) {
      content = validateQrUrl(nextUrl);
      useSceneQr = false;
      renderer.setMatrix(encodeQrMatrix(content));
      scene.setUrl?.(content);
      render();
    },
    play(seconds = autoplaySeconds) { autoplaySeconds = timerSeconds(seconds, "seconds"); scheduleAutoplay(); },
    pause() { autoplaySeconds = 0; clearTimeout(autoplayTimer); autoplayTimer = 0; },
    showQr,
    advance,
    destroy() {
      clearTimeout(autoplayTimer);
      clearTimeout(qrAutoplayTimer);
      clearTimeout(qrReturnTimer);
      cancelAnimationFrame(transitionFrame);
      resizeObserver.disconnect();
      scene?.unmount?.();
      renderer.destroy();
      surface.destroy();
      root.replaceChildren();
    },
  });
}
