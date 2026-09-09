import { validateQrUrl } from "./qr.js";
import { SEASONS } from "./season.js";
import { ENGINE_SETTINGS } from "./settings.js";

export const SCENE_JSON_VERSION = 1;

const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
const exactKeys = (value, allowed, name) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${name} must be an object`);
  for (const key of Object.keys(value)) {
    if (forbiddenKeys.has(key) || !allowed.includes(key)) throw new TypeError(`${name}.${key} is not allowed`);
  }
  return value;
};
const finite = (value, name) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
  return value;
};
const text = (value, name, maxLength) => {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new TypeError(`${name} must contain between 1 and ${maxLength} characters`);
  return value.trim();
};
const color = (value, name, channels) => {
  if (!Array.isArray(value) || value.length !== channels) throw new TypeError(`${name} must contain ${channels} channels`);
  return Object.freeze(value.map((channel, index) => {
    finite(channel, `${name}[${index}]`);
    if (channel < 0 || channel > 1) throw new RangeError(`${name}[${index}] must be between 0 and 1`);
    return channel;
  }));
};
const numericArray = (value, name) => {
  if (!Array.isArray(value) || !value.length || value.length % 24) throw new TypeError(`${name} must contain complete triangles with position, normal and UV data`);
  return new Float32Array(value.map((number, index) => finite(number, `${name}[${index}]`)));
};
const textureUrl = (value, baseUrl, name) => {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  if (value.length > ENGINE_SETTINGS.scene.maxJsonBytes) throw new RangeError(`${name} is too large`);
  if (/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(value)) return value;
  const url = new URL(value, baseUrl);
  const origin = new URL(baseUrl).origin;
  if (url.protocol !== "https:" || url.origin !== origin) throw new TypeError(`${name} must use HTTPS on the scene origin`);
  return url.href;
};
const placement = (value, name, drawCount) => {
  exactKeys(value, ["x", "z", "height", "scale", "rotation", "tilt", "colors"], name);
  const result = {
    x: finite(value.x, `${name}.x`),
    z: finite(value.z, `${name}.z`),
    height: finite(value.height, `${name}.height`),
    scale: finite(value.scale, `${name}.scale`),
    rotation: finite(value.rotation, `${name}.rotation`),
    tilt: finite(value.tilt, `${name}.tilt`),
  };
  if (result.scale <= 0) throw new RangeError(`${name}.scale must be greater than zero`);
  if (value.colors !== undefined) {
    if (!Array.isArray(value.colors) || value.colors.length > drawCount) throw new TypeError(`${name}.colors is invalid`);
    result.colors = Object.freeze(value.colors.map((entry, index) => entry === null ? null : color(entry, `${name}.colors[${index}]`, 4)));
  }
  return Object.freeze(result);
};

function transformDraw(draw, transform, index) {
  const { blockSize } = ENGINE_SETTINGS.qr;
  const cosine = Math.cos(transform.rotation), sine = Math.sin(transform.rotation);
  const tiltCosine = Math.cos(transform.tilt), tiltSine = Math.sin(transform.tilt);
  let floor = Infinity;
  for (let i = 0; i < draw.vertices.length; i += 8) {
    const localY = draw.vertices[i + 1] - blockSize;
    floor = Math.min(floor, localY * tiltCosine - draw.vertices[i + 2] * tiltSine);
  }
  const output = new Float32Array(draw.vertices.length);
  for (let i = 0; i < draw.vertices.length; i += 8) {
    const x = draw.vertices[i] * transform.scale;
    const localY = draw.vertices[i + 1] - blockSize;
    const z = (localY * tiltSine + draw.vertices[i + 2] * tiltCosine) * transform.scale;
    output[i] = x * cosine - z * sine + transform.x;
    output[i + 1] = blockSize + transform.height + (localY * tiltCosine - draw.vertices[i + 2] * tiltSine - floor) * transform.scale;
    output[i + 2] = x * sine + z * cosine + transform.z;
    const normalY = draw.vertices[i + 4] * tiltCosine - draw.vertices[i + 5] * tiltSine;
    const normalZ = draw.vertices[i + 4] * tiltSine + draw.vertices[i + 5] * tiltCosine;
    output[i + 3] = draw.vertices[i + 3] * cosine - normalZ * sine;
    output[i + 4] = normalY;
    output[i + 5] = draw.vertices[i + 3] * sine + normalZ * cosine;
    output[i + 6] = draw.vertices[i + 6];
    output[i + 7] = draw.vertices[i + 7];
  }
  return Object.freeze({ vertices: output, color: transform.colors?.[index] ?? draw.color, textureUrl: draw.textureUrl });
}

export function createSceneFromJson(document, { baseUrl = globalThis.document?.baseURI ?? "https://localhost/" } = {}) {
  exactKeys(document, ["version", "id", "label", "settings", "colors", "textures", "assets"], "scene");
  if (document.version !== SCENE_JSON_VERSION) throw new RangeError(`Unsupported scene version: ${document.version}`);
  const id = text(document.id, "scene.id", 64);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new TypeError("scene.id is invalid");
  const label = text(document.label, "scene.label", 20);
  const settings = exactKeys(document.settings, ["seasons", "defaultSeason", "qrUrl"], "scene.settings");
  if (!Array.isArray(settings.seasons) || !settings.seasons.length || settings.seasons.length > SEASONS.length || new Set(settings.seasons).size !== settings.seasons.length || settings.seasons.some(season => !SEASONS.includes(season))) throw new TypeError("scene.settings.seasons is invalid");
  if (!settings.seasons.includes(settings.defaultSeason)) throw new TypeError("scene.settings.defaultSeason is invalid");
  const colors = exactKeys(document.colors, ["qr"], "scene.colors");
  const qr = exactKeys(colors.qr, ["dark", "light"], "scene.colors.qr");
  if (!Array.isArray(document.textures) || document.textures.length > ENGINE_SETTINGS.scene.maxDraws) throw new RangeError(`scene.textures cannot exceed ${ENGINE_SETTINGS.scene.maxDraws}`);
  const textures = Object.freeze(document.textures.map((value, index) => textureUrl(value, baseUrl, `scene.textures[${index}]`)));
  if (!Array.isArray(document.assets) || document.assets.length > ENGINE_SETTINGS.scene.maxAssets) throw new RangeError(`scene.assets cannot exceed ${ENGINE_SETTINGS.scene.maxAssets}`);
  let drawCount = 0, vertexCount = 0;
  const assets = document.assets.map((asset, assetIndex) => {
    const name = `scene.assets[${assetIndex}]`;
    exactKeys(asset, ["name", "placements", "draws"], name);
    if (!Array.isArray(asset.draws) || !asset.draws.length) throw new TypeError(`${name}.draws must not be empty`);
    drawCount += asset.draws.length;
    if (drawCount > ENGINE_SETTINGS.scene.maxDraws) throw new RangeError(`scene draws cannot exceed ${ENGINE_SETTINGS.scene.maxDraws}`);
    const draws = Object.freeze(asset.draws.map((draw, drawIndex) => {
      const drawName = `${name}.draws[${drawIndex}]`;
      exactKeys(draw, ["color", "texture", "vertices"], drawName);
      if (!Number.isInteger(draw.texture) || draw.texture < -1 || draw.texture >= textures.length) throw new RangeError(`${drawName}.texture is invalid`);
      if (!Array.isArray(draw.vertices) || vertexCount + draw.vertices.length / 8 > ENGINE_SETTINGS.scene.maxVertices) throw new RangeError(`scene vertices cannot exceed ${ENGINE_SETTINGS.scene.maxVertices}`);
      const vertices = numericArray(draw.vertices, `${drawName}.vertices`);
      vertexCount += vertices.length / 8;
      return Object.freeze({ vertices, color: color(draw.color, `${drawName}.color`, 4), textureUrl: draw.texture < 0 ? null : textures[draw.texture] });
    }));
    const placementsSource = exactKeys(asset.placements, SEASONS, `${name}.placements`);
    const placements = Object.fromEntries(Object.entries(placementsSource).map(([season, value]) => [season, placement(value, `${name}.placements.${season}`, draws.length)]));
    return Object.freeze({ name: text(asset.name, `${name}.name`, 100), draws, placements: Object.freeze(placements) });
  });
  const cache = new Map();
  return Object.freeze({
    id,
    label,
    settings: Object.freeze({ seasons: Object.freeze([...settings.seasons]), defaultSeason: settings.defaultSeason, qrUrl: validateQrUrl(settings.qrUrl) }),
    colors: Object.freeze({ qr: Object.freeze({ dark: color(qr.dark, "scene.colors.qr.dark", 3), light: color(qr.light, "scene.colors.qr.light", 3) }), elements: Object.freeze({}) }),
    elements: Object.freeze(assets.map(asset => asset.name)),
    seasons: Object.freeze(Object.fromEntries(SEASONS.map(season => [season, Object.freeze([])]))),
    createFrameGeometry({ season }) {
      if (!cache.has(season)) {
        const texturedOpaque = [];
        for (const asset of assets) {
          const activePlacement = asset.placements[season];
          if (activePlacement) asset.draws.forEach((draw, index) => texturedOpaque.push(transformDraw(draw, activePlacement, index)));
        }
        cache.set(season, Object.freeze({ texturedOpaque: Object.freeze(texturedOpaque) }));
      }
      return cache.get(season);
    },
  });
}

export function parseSceneJson(source, options) {
  if (typeof source !== "string" || new TextEncoder().encode(source).byteLength > ENGINE_SETTINGS.scene.maxJsonBytes) throw new RangeError(`Scene JSON cannot exceed ${ENGINE_SETTINGS.scene.maxJsonBytes} bytes`);
  return createSceneFromJson(JSON.parse(source), options);
}

export async function loadSceneJson(source) {
  const url = new URL(source, document.baseURI);
  if (url.protocol !== "https:" || url.origin !== location.origin) throw new TypeError("Scene JSON must use HTTPS on the page origin");
  const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Unable to load scene JSON: ${response.status}`);
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new TypeError("Scene response must use application/json");
  const blob = await response.blob();
  if (blob.size > ENGINE_SETTINGS.scene.maxJsonBytes) throw new RangeError(`Scene JSON cannot exceed ${ENGINE_SETTINGS.scene.maxJsonBytes} bytes`);
  return parseSceneJson(await blob.text(), { baseUrl: url });
}
