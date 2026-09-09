const freeze = value => Object.freeze(value);

export const ENGINE_SETTINGS = freeze({
  render: freeze({
    maxPixelRatio: 2,
    alphaMode: "premultiplied",
    clearColor: freeze([0.953, 0.957, 0.957, 1]),
    depthFormat: "depth24plus",
  }),
  camera: freeze({
    isometric: freeze({ yaw: 0.78, pitch: -0.55, viewScale: 37.7, offset: freeze([0, -0.06]) }),
    qr: freeze({ yaw: 0, pitch: -1.5708, viewScale: 46.4, offset: freeze([0.015, 0.08]) }),
    portraitBoost: 1.2,
  }),
  qr: freeze({
    blockSize: 0.0245,
    errorCorrection: "M",
    colors: freeze({ dark: freeze([0.30, 0.25, 0.18]), light: freeze([0.94, 0.90, 0.80]) }),
  }),
  lighting: freeze({
    sunDirection: freeze([-0.405616, 0.861934, -0.304212]),
    sunIntensity: 1.2,
    ambient: freeze([0.28, 0.28, 0.30]),
    skyFillColor: freeze([0.9, 0.85, 0.95]),
    bounceColor: freeze([0.55, 0.6, 0.5]),
    skyStrength: 0.18,
    exposure: 1.15,
    gamma: 2.2,
  }),
  mesh: freeze({ defaultSegments: 12, maxSegments: 64 }),
  material: freeze({ defaultColor: freeze([1, 1, 1]), defaultOpacity: 1 }),
  scene: freeze({
    worldUnit: 1,
    defaultId: "fountain",
    defaultSeason: "spring",
    defaultUrl: "https://russo.kim",
    maxVoxelCount: 67240,
    maxJsonBytes: 15 * 1024 * 1024,
    maxAssets: 128,
    maxDraws: 512,
    maxVertices: 1_000_000,
    maxTextureDimension: 4096,
    maxTexturePixels: 4096 * 4096,
    maxTimerSeconds: 60,
    modules: freeze({
      three: freeze({ path: "./scenes/three.js", label: "Albero", icon: "m12 3 5 6h-3l4 5h-4l4 5H6l4-5H6l4-5H7zM12 19v2" }),
      fountain: freeze({ path: "./scenes/fountain.js", label: "Fontana", icon: "M12 3c-3 3-3 6 0 8 3-2 3-5 0-8ZM5 13c2 2 5 3 7 3s5-1 7-3M4 19c2-2 5-3 8-3s6 1 8 3M6 20h12" }),
      beach: freeze({ path: "./scenes/beach.js", label: "Spiaggia", icon: "M4 8c2-2 4-2 6 0s4 2 6 0 3-2 4-1M3 13c2-2 4-2 6 0s4 2 6 0 4-2 6 0M4 18c3-2 5-2 8 0s5 2 8 0" }),
    }),
  }),
  animation: freeze({ maxFrameDelta: .05, transitionResponse: 3.5, transitionSnap: .001 }),
});
