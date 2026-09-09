const seasonIndex = Object.freeze({ spring: 0, summer: 1, autumn: 2, winter: 3 });

export function createSceneRuntime(options, setup) {
  const cleanups = [];
  const runSetup = callback => {
    const cleanup = callback();
    if (typeof cleanup === "function") cleanups.push(cleanup);
  };
  const runtime = {
    cleanups,
    canvasRef: { current: options.canvas },
    canvasWidth: options.canvas.clientWidth || globalThis.innerWidth || 1,
    canvasHeight: options.canvas.clientHeight || globalThis.innerHeight || 1,
    qrContent: options.content,
    isFlat: options.isFlat,
    seasonRef: { current: options.season },
    customColorRef: { current: [0, 0, 0, 0] },
    treeSeed: { current: options.content },
    gpuSurface: options.gpuSurface,
    qrRenderer: options.qrRenderer,
    runSetup,
  };
  setup(runtime);
  return {
    setSeason(value) { runtime.seasonRef.current = value; },
    setFlat(value) { runtime.isFlat.current = value; },
    dispose() { for (const cleanup of cleanups.reverse()) cleanup(); },
  };
}

export function createSceneModule({ id, settings = {}, createRuntime, beforeMount = null, afterUnmount = null }) {
  if (typeof id !== "string" || !id) throw new TypeError("La scena richiede un id");
  if (typeof createRuntime !== "function") throw new TypeError("La scena richiede createRuntime");
  const seasons = Object.freeze([...(settings.seasons ?? [])]);
  const sceneSettings = Object.freeze({
    seasons,
    defaultSeason: seasons.includes(settings.defaultSeason) ? settings.defaultSeason : seasons[0] ?? null,
  });
  let runtime = null;
  let flat = { current: false };
  let canvas = null, content = "", season = 0, gpuSurface = null, qrRenderer = null;

  function start() {
    runtime = createRuntime({ canvas, content, season, isFlat: flat, gpuSurface, qrRenderer });
  }

  return Object.freeze({
    id,
    settings: sceneSettings,
    mount(options) {
      beforeMount?.();
      canvas = options.canvas;
      content = options.url;
      season = seasonIndex[options.season] ?? 0;
      gpuSurface = options.gpuSurface;
      qrRenderer = options.qrRenderer;
      flat = { current: false };
      start();
    },
    unmount() {
      runtime?.dispose();
      runtime = null;
      afterUnmount?.();
    },
    setUrl(url) {
      if (!url || url === content) return;
      content = url;
      runtime?.dispose();
      start();
    },
    setSeason(value) {
      season = seasonIndex[value] ?? 0;
      runtime?.setSeason(season);
    },
    setFlat(value) {
      flat.current = Boolean(value);
      runtime?.setFlat(flat.current);
    },
    toggleFlat() {
      flat.current = !flat.current;
      runtime?.setFlat(flat.current);
    },
  });
}
