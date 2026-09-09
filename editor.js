// editor.js v1.0.0
import { createGpuDevice, createGpuSurface } from "./core/gpu.js";
import { encodeQrMatrix } from "./core/qr.js";
import { createQrRenderer } from "./core/renderer.js";
import { parseSceneJson, SCENE_JSON_VERSION } from "./core/scene-json.js";
import { ENGINE_SETTINGS } from "./core/settings.js";

let matrix = encodeQrMatrix(ENGINE_SETTINGS.scene.defaultUrl);
const composition = { title: "Untitled", qrUrl: ENGINE_SETTINGS.scene.defaultUrl };
const titleFields = [...document.querySelectorAll("[data-animation-title]")];
const titleHeading = document.querySelector("[data-title-heading]");
const titleDisplay = document.querySelector("[data-title-display]");

function setAnimationTitle(value) {
  composition.title = value.trim().replace(/\s+/g, " ").slice(0, 20) || "Untitled";
  for (const field of titleFields) field.value = composition.title;
  renderBitmapText(titleDisplay, composition.title);
  titleDisplay.setAttribute("aria-label", `${composition.title} — Edit title`);
  document.title = `${composition.title} · qr3d`;
}

function editAnimationTitle() {
  titleHeading.readOnly = false;
  titleHeading.focus();
  titleHeading.select();
}

titleHeading.addEventListener("dblclick", editAnimationTitle);
titleDisplay.addEventListener("dblclick", editAnimationTitle);
titleDisplay.addEventListener("click", event => { if (event.detail === 0) editAnimationTitle(); });
for (const field of titleFields) {
  field.addEventListener("change", () => setAnimationTitle(field.value));
  field.addEventListener("blur", () => {
    setAnimationTitle(field.value);
    if (field === titleHeading) field.readOnly = true;
  });
  field.addEventListener("keydown", event => {
    if (!["Enter", "Escape", "F2"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") { field.value = composition.title; field.blur(); }
    else if (field === titleHeading && field.readOnly) editAnimationTitle();
    else { setAnimationTitle(field.value); field.blur(); }
  });
}
const qrUrlField = document.querySelector("[data-qr-url]");
qrUrlField.value = composition.qrUrl;
qrUrlField.addEventListener("change", () => {
  if (!qrUrlField.reportValidity()) return;
  composition.qrUrl = qrUrlField.value.trim();
  matrix = encodeQrMatrix(composition.qrUrl);
  refreshEditorScenes();
});
const text = Object.freeze({ models: "Models", seasons: "Season planes", uploading: "Upload", converting: "Conversion", preview: "Preview", failed: "Model preparation failed", renderFailed: "Unable to render this view.", remove: "Remove" });
const seasonLabels = Object.freeze({ spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" });
document.documentElement.lang = "en";
const themeToggle = document.querySelector("[data-theme-toggle]");
const editorThemes = {};
const storedTheme = localStorage.getItem("qr3d-editor-theme");
let editorTheme = storedTheme === "dark" || (!storedTheme && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
function applyEditorTheme(theme) {
  editorTheme = theme;
  document.documentElement.dataset.theme = theme;
  const styles = getComputedStyle(document.documentElement);
  const rgb = token => hexToRgb(styles.getPropertyValue(token)).map(channel => channel / 255);
  editorThemes[theme] = {
    clearColor: [...rgb("--ui-bg"), 1],
    qr: { dark: rgb("--ui-qr-dark"), light: rgb("--ui-qr-light") },
    selection: rgb("--ui-danger"),
    label: rgb("--ui-accent"),
  };
  document.querySelector('meta[name="theme-color"]').setAttribute("content", styles.getPropertyValue("--ui-bg").trim());
  themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
  themeToggle.setAttribute("aria-label", theme === "dark" ? "Enable light theme" : "Enable dark theme");
  localStorage.setItem("qr3d-editor-theme", theme);
}
applyEditorTheme(editorTheme);
themeToggle.addEventListener("click", () => {
  applyEditorTheme(editorTheme === "dark" ? "light" : "dark");
  editorScenes.clear();
  refreshEditorScenes();
  for (const asset of editorAssets) asset.renderPreview?.();
});
for (const element of document.querySelectorAll("[data-i18n-aria]")) {
  const key = element.dataset.i18nAria;
  const season = key.replace("canvas", "").toLowerCase();
  element.setAttribute("aria-label", seasonLabels[key] ?? text[key] ?? (seasonLabels[season] && `${seasonLabels[season]} QR`) ?? element.getAttribute("aria-label"));
}
const seasonNames = Object.freeze({
  spring: "SPRING", summer: "SUMMER", autumn: "AUTUMN", winter: "WINTER",
});
const seasonIcons = Object.freeze({
  spring: ["00100", "10101", "01110", "11111", "01110", "10101", "00100"],
  summer: ["00100", "10101", "01110", "11111", "01110", "10101", "00100"],
  autumn: ["00100", "01100", "11110", "11111", "01110", "00100", "00100"],
  winter: ["10101", "01110", "11111", "01110", "11111", "01110", "10101"],
});
const bitmapFont = Object.freeze({
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  6: ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
});
const labelGeometryCache = new Map();

function renderBitmapText(element, value) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  const letters = [...value.toUpperCase()];
  svg.setAttribute("viewBox", `0 0 ${letters.length * 6 - 1} 7`);
  svg.setAttribute("aria-hidden", "true");
  letters.forEach((letter, index) => {
    const rows = bitmapFont[letter];
    if (rows) {
      let pixels = "";
      rows.forEach((row, y) => [...row].forEach((pixel, x) => {
        if (pixel === "1") pixels += `M${index * 6 + x} ${y}h1v1h-1z`;
      }));
      const path = document.createElementNS(namespace, "path");
      path.setAttribute("d", pixels);
      svg.append(path);
    } else if (letter !== " ") {
      const text = document.createElementNS(namespace, "text");
      text.setAttribute("x", index * 6);
      text.setAttribute("y", 7);
      text.setAttribute("font-size", 8);
      text.textContent = letter;
      svg.append(text);
    }
  });
  element.replaceChildren(svg);
}
renderBitmapText(document.querySelector("[data-editor-logo]"), "qr3d");
setAnimationTitle(composition.title);

function createSeasonLabelGeometry({ gridSize, season }) {
  const cacheKey = `${gridSize}:${season}:${editorTheme}`;
  if (labelGeometryCache.has(cacheKey)) return labelGeometryCache.get(cacheKey);
  const blockSize = ENGINE_SETTINGS.qr.blockSize;
  const halfGrid = gridSize * blockSize * .5;
  const cell = blockSize * .38;
  const y = blockSize * .35;
  const xStart = -halfGrid - blockSize * 1.5 - cell * .8;
  const zStart = halfGrid - cell * .8;
  const vertices = [];
  const addVertex = (x, z, labelY = y, color = editorThemes[editorTheme].label) => vertices.push(x, labelY, z, 0, 1, 0, ...color, 1);
  const addPixel = (x, z, labelY, color) => {
    addVertex(x, z, labelY, color); addVertex(x + cell, z, labelY, color); addVertex(x, z + cell, labelY, color);
    addVertex(x, z + cell, labelY, color); addVertex(x + cell, z, labelY, color); addVertex(x + cell, z + cell, labelY, color);
  };
  let glyphOffset = 0;
  for (const glyph of [seasonIcons[season], ...seasonNames[season]]) {
    for (let row = 0; row < 7; row++) for (let column = 0; column < 5; column++) {
      const glyphRows = Array.isArray(glyph) ? glyph : bitmapFont[glyph];
      if (glyphRows[row][column] === "1") addPixel(xStart - row * cell, zStart - (glyphOffset + column) * cell);
    }
    glyphOffset += glyphOffset ? 6 : 8;
  }
  const geometry = { opaque: [new Float32Array(vertices)] };
  labelGeometryCache.set(cacheKey, geometry);
  return geometry;
}

const editorAssets = [];
const editorScenes = new Map();
const planeDropTargets = new Map();
const qrStep = ENGINE_SETTINGS.qr.blockSize;
const rotationStep = Math.PI / 12;
let activeAsset = null;
const selectedAssets = new Set();
const placementGeometry = new WeakMap();
const undoStack = [], redoStack = [];

function captureEdit(assets) {
  return [...assets].map(asset => ({ asset, placements: structuredClone(asset.placements), hidden: !!asset.hidden, present: editorAssets.includes(asset) }));
}

function commitEdit(before, group = null) {
  const after = captureEdit(before.map(state => state.asset));
  const same = before.every((state, i) => state.present === after[i].present && state.hidden === after[i].hidden && JSON.stringify(state.placements) === JSON.stringify(after[i].placements));
  if (same) return;
  const previous = undoStack.at(-1), time = performance.now();
  if (group && !redoStack.length && previous?.group === group && time - previous.time < 500 && before.every((state, i) => state.asset === previous.after[i]?.asset) && before.length === previous.after.length) {
    previous.after = after; previous.time = time;
  } else undoStack.push({ before, after, group, time });
  redoStack.length = 0;
  updateHistoryControls();
}

function updateHistoryControls() {
  undoButton.disabled = !undoStack.length;
  redoButton.disabled = !redoStack.length;
}

function restoreEdit(from, to, key) {
  closeColorPanel();
  const edit = from.pop();
  if (!edit) return;
  selectedAssets.clear();
  for (const { asset, placements, hidden, present } of edit[key]) {
    asset.placements = structuredClone(placements);
    asset.hidden = hidden;
    const index = editorAssets.indexOf(asset);
    if (present && index === -1) { editorAssets.push(asset); appendAsset(asset); }
    if (!present && index !== -1) { asset.disposePreview?.(); asset.item.remove(); editorAssets.splice(index, 1); }
    if (present && !hidden) selectedAssets.add(asset);
  }
  to.push(edit);
  updateHistoryControls();
  syncSelection();
}

function placementDraws(asset, placement) {
  return assetDraws(asset, placement).map((draw, index) => ({ ...draw, color: placement.colors?.[index] ?? draw.color }));
}

function rgbToHex(rgb) {
  return "#" + rgb.map(value => value.toString(16).padStart(2, "0")).join("");
}

function hexToRgb(value) {
  const match = /^#?([\da-f]{6})$/i.exec(value.trim());
  return match ? [0, 2, 4].map(offset => parseInt(match[1].slice(offset, offset + 2), 16)) : null;
}

function colorToRgb(color) {
  return color.slice(0, 3).map(value => Math.round(Math.max(0, Math.min(1, value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055)) * 255));
}

function applyMaterialColor(asset, placement, index, rgb) {
  const linear = rgb.map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
  placement.colors ??= {};
  placement.colors[index] = [...linear, asset.draws[index].color[3]];
}

function finishColorEdit() {
  if (!colorTarget?.before) return;
  commitEdit(colorTarget.before);
  colorTarget.before = null;
}

function closeColorPanel() {
  finishColorEdit();
  if (colorTarget) colorTarget.button.setAttribute("aria-expanded", "false");
  colorTarget = null;
  colorPanel.hidden = true;
}

function toggleColorPanel(asset, season, button) {
  const same = colorTarget?.asset === asset && colorTarget.season === season;
  closeColorPanel();
  if (same) return;
  colorTarget = { asset, season, button, before: null };
  button.setAttribute("aria-expanded", "true");
  const placement = asset.placements[season];
  colorPanel.replaceChildren();
  asset.draws.forEach((draw, index) => {
    const row = document.createElement("div");
    row.className = "material-color";
    row.innerHTML = `<input type="color" aria-label="Material ${index + 1}"><label>HEX<input type="text" maxlength="7" spellcheck="false" aria-label="HEX ${index + 1}"></label><div class="material-rgb">${["R", "G", "B"].map(channel => `<label>${channel}<input type="number" min="0" max="255" step="1" aria-label="${channel} ${index + 1}"></label>`).join("")}</div>`;
    const [picker, hex, ...channels] = row.querySelectorAll("input");
    const sync = rgb => {
      picker.value = hex.value = rgbToHex(rgb);
      channels.forEach((input, i) => { input.value = rgb[i]; });
      hex.removeAttribute("aria-invalid");
    };
    const apply = rgb => {
      colorTarget.before ??= captureEdit([asset]);
      applyMaterialColor(asset, placement, index, rgb);
      sync(rgb);
      refreshEditorScenes({ updateControls: false });
    };
    sync(colorToRgb(placement.colors?.[index] ?? draw.color));
    picker.addEventListener("input", () => apply(hexToRgb(picker.value)));
    picker.addEventListener("change", finishColorEdit);
    hex.addEventListener("input", () => {
      const rgb = hexToRgb(hex.value);
      if (!rgb) { hex.setAttribute("aria-invalid", "true"); return; }
      apply(rgb);
    });
    hex.addEventListener("change", finishColorEdit);
    for (const input of channels) {
      input.addEventListener("input", () => {
        if (!channels.every(channel => channel.value !== "" && channel.checkValidity())) return;
        apply(channels.map(channel => Number(channel.value)));
      });
      input.addEventListener("change", finishColorEdit);
    }
    colorPanel.append(row);
  });
  colorPanel.hidden = false;
  const rect = button.getBoundingClientRect(), panel = colorPanel.getBoundingClientRect();
  colorPanel.style.left = `${Math.max(8, Math.min(window.innerWidth - panel.width - 8, rect.left))}px`;
  colorPanel.style.top = `${Math.max(8, Math.min(window.innerHeight - panel.height - 8, rect.bottom + 8))}px`;
}

function boundsForDraws(draws) {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const { vertices } of draws) for (let index = 0; index < vertices.length; index += 8) {
    bounds.minX = Math.min(bounds.minX, vertices[index]); bounds.maxX = Math.max(bounds.maxX, vertices[index]);
    bounds.minY = Math.min(bounds.minY, vertices[index + 1]); bounds.maxY = Math.max(bounds.maxY, vertices[index + 1]);
    bounds.minZ = Math.min(bounds.minZ, vertices[index + 2]); bounds.maxZ = Math.max(bounds.maxZ, vertices[index + 2]);
  }
  return bounds;
}

function assetBounds(asset, placement) {
  const draws = assetDraws(asset, placement);
  const cached = placementGeometry.get(placement);
  return cached.bounds ??= boundsForDraws(draws);
}

function selectionVertices(asset, placement) {
  let { minX, maxX, minY, maxY, minZ, maxZ } = assetBounds(asset, placement);
  const pad = ENGINE_SETTINGS.qr.blockSize * .5;
  const width = ENGINE_SETTINGS.qr.blockSize * .18;
  const output = [];
  const add = (x, y, z) => output.push(x, y, z, 0, 1, 0, ...editorThemes[editorTheme].selection, 1);
  const bar = (x, y, z, sx, sy, sz) => {
    const x0 = x - sx / 2, x1 = x + sx / 2, y0 = y - sy / 2, y1 = y + sy / 2, z0 = z - sz / 2, z1 = z + sz / 2;
    const quad = (a, b, c, d) => { add(...a); add(...b); add(...c); add(...c); add(...b); add(...d); };
    quad([x0,y0,z0],[x1,y0,z0],[x0,y1,z0],[x1,y1,z0]); quad([x1,y0,z1],[x0,y0,z1],[x1,y1,z1],[x0,y1,z1]);
    quad([x0,y0,z1],[x0,y0,z0],[x0,y1,z1],[x0,y1,z0]); quad([x1,y0,z0],[x1,y0,z1],[x1,y1,z0],[x1,y1,z1]);
    quad([x0,y1,z0],[x1,y1,z0],[x0,y1,z1],[x1,y1,z1]); quad([x0,y0,z1],[x1,y0,z1],[x0,y0,z0],[x1,y0,z0]);
  };
  minX -= pad; maxX += pad; minY -= pad; maxY += pad; minZ -= pad; maxZ += pad;
  for (const y of [minY, maxY]) { bar((minX+maxX)/2,y,minZ,maxX-minX,width,width); bar((minX+maxX)/2,y,maxZ,maxX-minX,width,width); bar(minX,y,(minZ+maxZ)/2,width,width,maxZ-minZ); bar(maxX,y,(minZ+maxZ)/2,width,width,maxZ-minZ); }
  for (const x of [minX, maxX]) for (const z of [minZ, maxZ]) bar(x,(minY+maxY)/2,z,width,maxY-minY,width);
  return new Float32Array(output);
}

function assetDraws(asset, placement) {
  // Placements are complete at creation; only cache freshness is checked here.
  const cached = placementGeometry.get(placement);
  const fields = ["x", "z", "height", "scale", "rotation", "tilt"];
  if (cached?.source === asset.draws && fields.every(field => cached.transform[field] === placement[field])) return cached.draws;
  const cosine = Math.cos(placement.rotation);
  const sine = Math.sin(placement.rotation);
  const tiltCosine = Math.cos(placement.tilt);
  const tiltSine = Math.sin(placement.tilt);
  let floor = Infinity;
  for (const draw of asset.draws) for (let index = 0; index < draw.vertices.length; index += 8) {
    const localY = draw.vertices[index + 1] - ENGINE_SETTINGS.qr.blockSize;
    floor = Math.min(floor, localY * tiltCosine - draw.vertices[index + 2] * tiltSine);
  }
  const draws = asset.draws.map(draw => {
    const output = new Float32Array(draw.vertices.length);
    for (let index = 0; index < draw.vertices.length; index += 8) {
      const x = draw.vertices[index] * placement.scale;
      const localY = draw.vertices[index + 1] - ENGINE_SETTINGS.qr.blockSize;
      const z = (localY * tiltSine + draw.vertices[index + 2] * tiltCosine) * placement.scale;
      output[index] = x * cosine - z * sine + placement.x;
      output[index + 1] = ENGINE_SETTINGS.qr.blockSize + placement.height + (localY * tiltCosine - draw.vertices[index + 2] * tiltSine - floor) * placement.scale;
      output[index + 2] = x * sine + z * cosine + placement.z;
      const normalY = draw.vertices[index + 4] * tiltCosine - draw.vertices[index + 5] * tiltSine;
      const normalZ = draw.vertices[index + 4] * tiltSine + draw.vertices[index + 5] * tiltCosine;
      output[index + 3] = draw.vertices[index + 3] * cosine - normalZ * sine;
      output[index + 4] = normalY;
      output[index + 5] = draw.vertices[index + 3] * sine + normalZ * cosine;
      output[index + 6] = draw.vertices[index + 6]; output[index + 7] = draw.vertices[index + 7];
    }
    return { ...draw, vertices: output };
  });
  placementGeometry.set(placement, { source: asset.draws, transform: { ...placement }, draws });
  return draws;
}

function sceneForSeason(season) {
  if (editorScenes.has(season)) return editorScenes.get(season);
  const scene = Object.freeze({
    colors: Object.freeze({
      qr: editorThemes[editorTheme].qr,
      elements: Object.freeze({ model: Object.freeze([.45, .40, .34]) }),
    }),
    createFrameGeometry: args => {
      const opaque = [...createSeasonLabelGeometry(args).opaque];
      const texturedOpaque = [];
      for (const asset of editorAssets) {
        const placement = asset.placements[season];
        if (!placement || asset.hidden) continue;
        texturedOpaque.push(...placementDraws(asset, placement));
        if (selectedAssets.has(asset)) opaque.push(selectionVertices(asset, placement));
      }
      return { opaque, texturedOpaque };
    },
  });
  editorScenes.set(season, scene);
  return scene;
}

function refreshEditorScenes({ updateControls = true } = {}) {
  redrawPlanes(updateControls);
}

function syncSelection() {
  updateMeshCount();
  if (!selectedAssets.has(activeAsset)) activeAsset = [...selectedAssets].at(-1) ?? null;
  for (const candidate of assetList.children) {
    candidate.classList.toggle("is-selected", selectedAssets.has(candidate._asset));
    if (candidate._asset) updateAssetVisibility(candidate._asset);
  }
  updateCopyControl();
  refreshEditorScenes();
}

function selectAsset(asset) {
  selectedAssets.add(asset);
  activeAsset = asset;
  syncSelection();
}

function toggleAsset(asset) {
  if (selectedAssets.has(asset)) selectedAssets.delete(asset);
  else { selectedAssets.add(asset); activeAsset = asset; }
  syncSelection();
}

function clearSelection() {
  selectedAssets.clear();
  syncSelection();
}

function assetAt(season, point) {
  const cy = Math.cos(editorCamera.yaw), sy = Math.sin(editorCamera.yaw);
  const cp = Math.cos(editorCamera.pitch), sp = Math.sin(editorCamera.pitch);
  let nearest = Infinity, selected = null;
  const projected = new Float64Array(9);
  for (const asset of editorAssets) {
    const placement = asset.placements[season];
    if (!placement || asset.hidden) continue;
    for (const { vertices } of assetDraws(asset, placement)) {
      for (let i = 0; i < vertices.length; i += 24) {
        for (let corner = 0; corner < 3; corner++) {
          const v = i + corner * 8, p = corner * 3;
          const x = vertices[v], y = vertices[v + 1], z = vertices[v + 2];
          const rz = x * sy + z * cy;
          projected[p] = x * cy - z * sy;
          projected[p + 1] = y * cp - rz * sp;
          projected[p + 2] = y * sp + rz * cp;
        }
        const [ax, ay, az, bx, by, bz, cx, cy2, cz] = projected;
        const determinant = (by - cy2) * (ax - cx) + (cx - bx) * (ay - cy2);
        if (Math.abs(determinant) < 1e-12) continue;
        const u = ((by - cy2) * (point.x - cx) + (cx - bx) * (point.y - cy2)) / determinant;
        const v = ((cy2 - ay) * (point.x - cx) + (ax - cx) * (point.y - cy2)) / determinant;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const depth = u * az + v * bz + (1 - u - v) * cz;
        if (depth < nearest) { nearest = depth; selected = asset; }
      }
    }
  }
  return selected;
}

function pointerViewPosition(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const aspect = rect.width / rect.height;
  const scale = editorCamera.viewScale / matrix.length * (aspect < .8 ? ENGINE_SETTINGS.camera.portraitBoost : 1);
  return {
    x: (((event.clientX - rect.left) / rect.width) * 2 - 1) * Math.max(aspect, 1) / scale - editorCamera.offset[0],
    y: (1 - ((event.clientY - rect.top) / rect.height) * 2) * Math.max(1 / aspect, 1) / scale - editorCamera.offset[1],
  };
}

function reportRenderError() {
  error.textContent = text.renderFailed;
  error.hidden = false;
}

function snapToQr(point) {
  return { x: Math.round(point.x / qrStep) * qrStep, z: Math.round(point.z / qrStep) * qrStep };
}

function setPlacementHeight(placement, height) {
  placement.height = Math.max(-.5, Math.min(.5, height));
}

function setPlacementScale(placement, scale) {
  placement.scale = Math.max(.15, Math.min(4, scale));
}

function dragPlacement(placement, start, origin, point) {
  const delta = snapToQr({ x: point.x - origin.x, z: point.z - origin.z });
  placement.x = start.x + delta.x;
  placement.z = start.z + delta.z;
}

// Every drag ends on release, cancellation or lost capture.
function trackPointer(event, move, finish) {
  const target = event.currentTarget;
  const pointerId = event.pointerId;
  const onMove = pointer => { if (pointer.pointerId === pointerId) move(pointer); };
  const onEnd = pointer => {
    if (pointer.pointerId !== pointerId) return;
    target.removeEventListener("pointermove", onMove);
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) target.removeEventListener(type, onEnd);
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    finish(pointer, pointer.type !== "pointerup");
  };
  target.setPointerCapture(pointerId);
  target.addEventListener("pointermove", onMove);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) target.addEventListener(type, onEnd);
}

function beginAssetDrag(event, asset) {
  if (event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX, startY = event.clientY;
  let ghost = null;
  const move = pointer => {
    if (!ghost && Math.hypot(pointer.clientX - startX, pointer.clientY - startY) < 6) return;
    if (!ghost) {
      selectAsset(asset);
      ghost = document.createElement("div");
      ghost.className = "asset-drag-ghost";
      ghost.setAttribute("aria-hidden", "true");
      const source = asset.item.querySelector("canvas");
      const image = document.createElement("canvas");
      image.width = source.width; image.height = source.height;
      image.getContext("2d").drawImage(source, 0, 0);
      ghost.append(image, asset.item.querySelector(".asset-label").cloneNode(true));
      document.body.append(ghost);
    }
    ghost.style.left = `${pointer.clientX}px`; ghost.style.top = `${pointer.clientY}px`;
  };
  trackPointer(event, move, (pointer, cancelled) => {
    if (!cancelled && !ghost) toggleAsset(asset);
    if (!cancelled && ghost) {
      const canvas = document.elementsFromPoint(pointer.clientX, pointer.clientY).find(element => planeDropTargets.has(element));
      const target = planeDropTargets.get(canvas);
      if (target) {
        const before = captureEdit([asset]);
        asset.placements[target.season] = { height: 0, scale: 1, rotation: 0, tilt: -Math.PI / 2, ...asset.placements[target.season], ...snapToQr(target.toPlane(pointer)) };
        commitEdit(before);
        refreshEditorScenes();
      }
    }
    ghost?.remove();
  });
}
const error = document.querySelector("[data-editor-error]");
const editorGpu = createGpuDevice().then(gpu => {
  gpu.device.addEventListener("uncapturederror", event => reportRenderError(event.error));
  gpu.device.lost.then(reportRenderError);
  return gpu;
});
const assetInput = document.querySelector("[data-asset-input]");
const assetList = document.querySelector("[data-asset-list]");
const meshPanel = document.querySelector(".layers-panel");
const meshCount = document.querySelector("[data-mesh-count]");
const panelToggle = document.querySelector("[data-panel-toggle]");
const panelDrag = document.querySelector("[data-panel-drag]");

function updateMeshCount() {
  meshCount.value = String(editorAssets.length);
}

function positionMeshPanel(x, y) {
  meshPanel.style.transform = "none";
  meshPanel.style.left = `${Math.max(8, Math.min(window.innerWidth - meshPanel.offsetWidth - 8, x))}px`;
  meshPanel.style.top = `${Math.max(8, Math.min(window.innerHeight - meshPanel.offsetHeight - 8, y))}px`;
  meshPanel.dataset.moved = "true";
}

panelToggle.addEventListener("click", () => {
  assetList.hidden = !assetList.hidden;
  panelToggle.setAttribute("aria-expanded", String(!assetList.hidden));
  panelToggle.setAttribute("aria-label", assetList.hidden ? "Expand mesh list" : "Collapse mesh list");
});
panelDrag.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  event.preventDefault();
  const rect = meshPanel.getBoundingClientRect();
  trackPointer(event, pointer => positionMeshPanel(rect.left + pointer.clientX - event.clientX, rect.top + pointer.clientY - event.clientY), () => {});
});
panelDrag.addEventListener("keydown", event => {
  const movement = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
  if (!movement) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = meshPanel.getBoundingClientRect();
  positionMeshPanel(rect.left + movement[0], rect.top + movement[1]);
});
function keepMeshPanelOnScreen() {
  if (!meshPanel.dataset.moved) return;
  const rect = meshPanel.getBoundingClientRect();
  positionMeshPanel(rect.left, rect.top);
}
new ResizeObserver(keepMeshPanelOnScreen).observe(meshPanel);
window.addEventListener("resize", keepMeshPanelOnScreen);
const transformHelp = document.querySelector("[data-transform-help]");
const transformHelpButton = document.querySelector("[data-transform-help-button]");
const viewCube = document.querySelector("[data-view-cube]");
const viewReset = document.querySelector("[data-view-reset]");
const copySelected = document.querySelector("[data-copy-selected]");
const copySeasons = document.querySelector("[data-copy-seasons]");
const copySeasonButtons = [...document.querySelectorAll("[data-copy-season]")];
const copyApply = document.querySelector("[data-copy-apply]");
const undoButton = document.querySelector("[data-undo]");
const redoButton = document.querySelector("[data-redo]");
const exportSceneButton = document.querySelector("[data-export-scene]");
const exportPanel = document.querySelector("[data-export-panel]");
const panelOverlay = document.querySelector("[data-panel-overlay]");
const exportSource = document.querySelector("[data-export-source]");
const exportCopy = document.querySelector("[data-export-copy]");
const exportDownload = document.querySelector("[data-export-download]");
const exportPlayer = document.querySelector("[data-export-player]");
const colorPanel = document.querySelector("[data-color-panel]");
let colorTarget = null;
undoButton.addEventListener("click", () => restoreEdit(undoStack, redoStack, "before"));
redoButton.addEventListener("click", () => restoreEdit(redoStack, undoStack, "after"));

function createSceneJsonSource() {
  const selectedSeason = views[activeSeason].dataset.season;
  const assets = editorAssets.filter(asset => !asset.hidden && Object.values(asset.placements).some(Boolean));
  const availableSeasons = ["spring", "summer", "autumn", "winter"].filter(season => assets.some(asset => asset.placements[season]));
  if (!availableSeasons.length) availableSeasons.push(selectedSeason);
  const textures = [...new Set(assets.flatMap(asset => asset.draws.map(draw => draw.textureUrl).filter(Boolean)))];
  const numbers = values => Array.from(values, value => Number(value.toFixed(6)));
  const id = composition.title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scene";
  const qrColors = editorThemes[editorTheme].qr;
  const source = JSON.stringify({
    version: SCENE_JSON_VERSION,
    id,
    label: composition.title,
    settings: { seasons: availableSeasons, defaultSeason: availableSeasons.includes(selectedSeason) ? selectedSeason : availableSeasons[0], qrUrl: composition.qrUrl },
    colors: { qr: { dark: qrColors.dark, light: qrColors.light } },
    textures,
    assets: assets.map(asset => ({
      name: asset.name,
      placements: asset.placements,
      draws: asset.draws.map(draw => ({ color: numbers(draw.color), texture: draw.textureUrl ? textures.indexOf(draw.textureUrl) : -1, vertices: numbers(draw.vertices) })),
    })),
  });
  parseSceneJson(source);
  return source;
}

function downloadSceneJson(source) {
  const url = URL.createObjectURL(new Blob([source], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${composition.title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scene"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

exportSceneButton.addEventListener("click", () => {
  const open = exportPanel.hidden;
  closeTransientPanels();
  exportPanel.hidden = !open;
  if (!exportPanel.hidden) exportSource.value = createSceneJsonSource();
  syncPanelOverlay();
});
exportCopy.addEventListener("click", () => navigator.clipboard.writeText(exportSource.value));
exportDownload.addEventListener("click", () => downloadSceneJson(exportSource.value));
let playerWindow = null;
exportPlayer.addEventListener("click", () => { playerWindow = window.open("./preview.html", "qr3d-player"); });
window.addEventListener("message", event => {
  if (event.origin === location.origin && event.source === playerWindow && event.data?.type === "qr3d:ready") {
    playerWindow.postMessage({ type: "qr3d:scene-json", source: exportSource.value }, location.origin);
  }
});

function updateExportControl() {
  exportSceneButton.disabled = !editorAssets.some(asset => !asset.hidden && Object.values(asset.placements).some(Boolean));
  if (exportSceneButton.disabled) exportPanel.hidden = true;
  syncPanelOverlay();
}
updateExportControl();
updateHistoryControls();
const carousel = document.querySelector("[data-season-carousel]");
const views = [...carousel.children];
const seasonButtons = [...document.querySelectorAll("[data-season-index]")];
const meshControlsLayer = document.createElement("div");
meshControlsLayer.className = "mesh-controls-layer";
document.querySelector(".season-stage").append(meshControlsLayer);
let activeSeason = 0;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const initialCamera = Object.freeze({ yaw: ENGINE_SETTINGS.camera.isometric.yaw, pitch: ENGINE_SETTINGS.camera.isometric.pitch, viewScale: ENGINE_SETTINGS.camera.isometric.viewScale, offset: Object.freeze([0, -.38]) });
const editorCamera = { ...initialCamera, offset: [...initialCamera.offset] };
const renderPlanes = new Map();
const meshControlGroups = new Map();

function redrawPlanes(updateControls = true) {
  updatePlacementIndicators();
  // A view registers its redraw after asynchronous GPU initialization.
  renderPlanes.get(views[activeSeason].dataset.season)?.();
  if (updateControls) updateMeshControls();
}

function updatePlacementIndicators() {
  const season = views[activeSeason].dataset.season;
  for (const asset of editorAssets) {
    const placed = !!asset.placements[season];
    asset.item.classList.toggle("is-placed", placed);
    asset.item.querySelector(".asset-label").setAttribute("aria-label", `${asset.name}${placed ? ` — on ${season} plane` : ""}`);
  }
}

function projectedBounds(asset, placement, canvas) {
  const { minX, maxX, minY, maxY, minZ, maxZ } = assetBounds(asset, placement);
  const rect = canvas.getBoundingClientRect();
  const aspect = rect.width / rect.height;
  const scale = editorCamera.viewScale / matrix.length;
  const boost = aspect < .8 ? ENGINE_SETTINGS.camera.portraitBoost : 1;
  const points = [];
  for (const x of [minX, maxX]) for (const y of [minY, maxY]) for (const z of [minZ, maxZ]) {
    const rotatedX = x * Math.cos(editorCamera.yaw) - z * Math.sin(editorCamera.yaw);
    const rotatedZ = x * Math.sin(editorCamera.yaw) + z * Math.cos(editorCamera.yaw);
    const rotatedY = y * Math.cos(editorCamera.pitch) - rotatedZ * Math.sin(editorCamera.pitch);
    points.push({ x: rect.left + ((rotatedX + editorCamera.offset[0]) * scale * boost / Math.max(aspect, 1) + 1) * rect.width * .5, y: rect.top + (1 - ((rotatedY + editorCamera.offset[1]) * scale * boost / Math.max(1 / aspect, 1) + 1) * .5) * rect.height });
  }
  return { left: Math.min(...points.map(point => point.x)), right: Math.max(...points.map(point => point.x)), top: Math.min(...points.map(point => point.y)), bottom: Math.max(...points.map(point => point.y)) };
}

function updateMeshControls() {
  const view = views[activeSeason];
  const season = view.dataset.season;
  if (colorTarget && (colorTarget.asset.hidden || !selectedAssets.has(colorTarget.asset) || colorTarget.season !== season || !colorTarget.asset.placements[season])) closeColorPanel();
  for (const [asset, controls] of meshControlGroups) {
    if (asset.hidden || !selectedAssets.has(asset) || !asset.placements[season]) {
      controls.remove();
      meshControlGroups.delete(asset);
    }
  }
  const canvas = view.querySelector("canvas");
  const canvasBounds = canvas.getBoundingClientRect();
  for (const asset of selectedAssets) {
    const placement = asset.placements[season];
    if (!placement || asset.hidden) continue;
    const bounds = projectedBounds(asset, placement, canvas);
    let controls = meshControlGroups.get(asset);
    if (controls) {
      controls.dataset.season = season;
      controls.placement = placement;
      positionMeshControls(controls, bounds, canvasBounds);
      continue;
    }
    controls = document.createElement("div");
    controls.dataset.season = season;
    controls.placement = placement;
    controls.className = "mesh-selection-controls";
    positionMeshControls(controls, bounds, canvasBounds);
    const actions = [
      ["height", `Move ${asset.name} vertically`, '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/></svg>'],
      ["scale", `Scale ${asset.name}`, '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="M10 7v6M7 10h6M14.5 14.5 20 20"/></svg>'],
      ["rotate", `Rotate ${asset.name}`, '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8V4l-3 3a7 7 0 1 0 2 8M19 8h-4"/></svg>'],
      ["color", `Color ${asset.name}`, '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4c-1-1 0-3 2-3h2c5 0 3-11-6-11Z"/><circle cx="7" cy="10" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/></svg>'],
      ["delete", `Remove ${asset.name} from current season`, '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M8 7l1-3h6l1 3M7 7l1 13h8l1-13"/></svg>'],
    ];
    for (const [action, label, icon] of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.meshAction = action;
      button.setAttribute("aria-label", label);
      button.title = ["delete", "color"].includes(action) ? label : `${label} — hold and drag ${action === "rotate" ? "← → (15°)" : "↑ ↓"}`;
      button.innerHTML = icon;
      if (action === "delete") button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        removePlacements([asset], controls.dataset.season);
      });
      else if (action === "color") {
        button.setAttribute("aria-expanded", "false");
        button.addEventListener("click", () => toggleColorPanel(asset, controls.dataset.season, button));
      } else button.addEventListener("pointerdown", event => beginMeshTransform(event, controls.placement, action, asset));
      controls.append(button);
    }
    meshControlsLayer.append(controls);
    meshControlGroups.set(asset, controls);
  }
}

function positionMeshControls(controls, bounds, canvasBounds) {
  controls.style.left = `${Math.max(canvasBounds.left, Math.min(canvasBounds.right - 168, bounds.right))}px`;
  controls.style.top = `${Math.max(canvasBounds.top + 50, Math.min(canvasBounds.bottom - 10, bounds.top))}px`;
}

function beginMeshTransform(event, placement, action, asset) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget;
  const startX = event.clientX;
  const startY = event.clientY;
  const start = { height: placement.height, scale: placement.scale, rotation: placement.rotation };
  const before = captureEdit([asset]);
  button.classList.add("is-adjusting");
  const move = pointer => {
    if (action === "height") setPlacementHeight(placement, start.height + (startY - pointer.clientY) * .002);
    if (action === "scale") setPlacementScale(placement, start.scale * Math.exp((startY - pointer.clientY) * .007));
    if (action === "rotate") placement.rotation = start.rotation + Math.round((pointer.clientX - startX) * .012 / rotationStep) * rotationStep;
    refreshEditorScenes({ updateControls: false });
  };
  trackPointer(event, move, () => {
    commitEdit(before);
    button.classList.remove("is-adjusting");
    updateMeshControls();
  });
}

function updateViewCube() {
  viewCube.style.setProperty("--cube-yaw", `${(editorCamera.yaw - initialCamera.yaw) * 57.3}deg`);
  viewCube.style.setProperty("--cube-pitch", `${(editorCamera.pitch - initialCamera.pitch) * 57.3}deg`);
}

function updateAssetVisibility(asset) {
  asset.item.classList.toggle("is-hidden", !!asset.hidden);
  asset.viewButton.setAttribute("aria-pressed", String(!asset.hidden));
  asset.viewButton.setAttribute("aria-label", `${asset.hidden ? "Show" : "Hide"} ${asset.name}`);
}

function toggleAssetVisibility(asset) {
  const before = captureEdit([asset]);
  asset.hidden = !asset.hidden;
  if (asset.hidden) selectedAssets.delete(asset);
  commitEdit(before);
  syncSelection();
}

function appendAsset(asset) {
  updateMeshCount();
  const { name, source } = asset;
  const item = document.createElement("article");
  item.className = "asset-item";
  item.style.setProperty("--asset-delay", `${Math.min(editorAssets.length, 6) * 100}ms`);
  item.dataset.source = source;
  item._asset = asset;
  asset.item = item;
  const preview = document.createElement("canvas");
  preview.className = "asset-preview";
  preview.setAttribute("aria-label", `Preview ${name}`);
  const label = document.createElement("button");
  label.type = "button";
  label.className = "asset-label";
  const title = document.createElement("span");
  title.textContent = name;
  label.append(title);
  if (asset.description) {
    const description = document.createElement("small");
    description.textContent = asset.description;
    label.append(description);
  }
  label.title = [name, asset.description].filter(Boolean).join("\n");
  label.addEventListener("pointerdown", event => beginAssetDrag(event, asset));
  label.addEventListener("click", event => { if (event.detail === 0) toggleAsset(asset); });
  const view = document.createElement("button");
  view.type = "button";
  view.className = "asset-action asset-view";
  view.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="eye-off" d="m3 3 18 18"/></svg>';
  asset.viewButton = view;
  view.addEventListener("click", () => toggleAssetVisibility(asset));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "asset-action asset-remove";
  remove.setAttribute("aria-label", `${text.remove} ${name}`);
  remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M8 7l1-3h6l1 3M7 7l1 13h8l1-13"/></svg>';
  const thumbnail = document.createElement("div");
  thumbnail.className = "asset-thumbnail";
  thumbnail.append(preview);
  item.append(thumbnail, label, view, remove);
  updateAssetVisibility(asset);
  const loading = createImportProgress(thumbnail);
  loading.setStage(2);
  preview.addEventListener("pointerdown", event => beginAssetDrag(event, asset));
  remove.addEventListener("click", () => {
    const before = captureEdit([asset]);
    asset.disposePreview?.();
    selectedAssets.delete(asset);
    editorAssets.splice(editorAssets.indexOf(asset), 1);
    item.remove();
    commitEdit(before);
    syncSelection();
  });
  assetList.prepend(item);
  return mountAssetPreview(preview, asset, loading);
}

transformHelpButton.addEventListener("click", () => {
  const open = transformHelp.hidden;
  closeTransientPanels();
  copySeasons.hidden = true;
  transformHelp.hidden = !open;
  transformHelpButton.setAttribute("aria-expanded", String(!transformHelp.hidden));
  syncPanelOverlay();
});

function syncPanelOverlay() {
  panelOverlay.hidden = transformHelp.hidden && exportPanel.hidden;
}

function closeTransientPanels() {
  closeColorPanel();
  transformHelp.hidden = true;
  transformHelpButton.setAttribute("aria-expanded", "false");
  copySeasons.hidden = true;
  exportPanel.hidden = true;
  syncPanelOverlay();
}

document.addEventListener("pointerdown", event => {
  if (!event.target.closest('[data-transform-help], [data-transform-help-button], [data-copy-selected], [data-copy-seasons], [data-color-panel], [data-mesh-action="color"], [data-export-scene], [data-export-panel]')) closeTransientPanels();
});

viewCube.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX, startY = event.clientY, startYaw = editorCamera.yaw, startPitch = editorCamera.pitch;
  const move = pointer => {
    editorCamera.yaw = startYaw + (pointer.clientX - startX) * .012;
    editorCamera.pitch = Math.max(-1.1, Math.min(-.2, startPitch + (pointer.clientY - startY) * .008));
    updateViewCube(); redrawPlanes();
  };
  trackPointer(event, move, () => {});
});

viewReset.addEventListener("click", () => {
  Object.assign(editorCamera, initialCamera, { offset: [...initialCamera.offset] });
  updateViewCube(); redrawPlanes();
});
updateViewCube();

function copySourceSeason() {
  return views[activeSeason].dataset.season;
}

function updateCopyControl() {
  copySelected.hidden = selectedAssets.size === 0;
  if (!selectedAssets.size) copySeasons.hidden = true;
  updateExportControl();
  updateCopyApply();
}

function updateCopyApply() {
  const hasSource = [...selectedAssets].some(asset => asset.placements[copySourceSeason()]);
  const hasTarget = copySeasonButtons.some(button => !button.hidden && button.getAttribute("aria-pressed") === "true");
  copyApply.disabled = !(hasSource && hasTarget);
}

function removePlacements(assets, season) {
  const before = captureEdit(assets);
  // Callers supply assets already placed in this season.
  for (const asset of assets) {
    delete asset.placements[season];
    selectedAssets.delete(asset);
  }
  commitEdit(before);
  syncSelection();
}

function toggleCopyPanel() {
  transformHelp.hidden = true;
  transformHelpButton.setAttribute("aria-expanded", "false");
  const source = copySourceSeason();
  for (const button of copySeasonButtons) {
    button.hidden = button.dataset.copySeason === source;
    button.setAttribute("aria-pressed", "false");
  }
  updateCopyApply();
  copySeasons.hidden = !copySeasons.hidden;
}

copySelected.addEventListener("click", toggleCopyPanel);
for (const button of copySeasonButtons) button.addEventListener("click", () => {
  button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
  updateCopyApply();
});
copyApply.addEventListener("click", () => {
  const before = captureEdit(selectedAssets);
  const source = copySourceSeason();
  const targets = copySeasonButtons.filter(button => button.getAttribute("aria-pressed") === "true").map(button => button.dataset.copySeason);
  for (const asset of selectedAssets) {
    const placement = asset.placements[source];
    if (!placement) continue;
    for (const season of targets) asset.placements[season] = structuredClone(placement);
  }
  copySeasons.hidden = true;
  commitEdit(before);
  refreshEditorScenes();
});
updateCopyControl();

function createImportProgress(item) {
  const progress = document.createElement("div");
  progress.className = "asset-progress";
  progress.setAttribute("role", "status");
  const paths = [
    '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
    '<path d="M20 7a9 9 0 0 0-15-2L2 8m0-6v6h6M4 17a9 9 0 0 0 15 2l3-3m0 6v-6h-6"/>',
    '<path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10 9-5M12 12 3 7m9 5v10"/>',
  ];
  const labels = [text.uploading, text.converting, text.preview];
  const steps = paths.map(path => {
    const step = document.createElement("span");
    step.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
    progress.append(step);
    return step;
  });
  item.append(progress);
  function setStage(index) {
    progress.setAttribute("aria-label", labels[index]);
    steps.forEach((step, i) => { step.dataset.state = i < index ? "done" : i === index ? "active" : "waiting"; });
  }
  setStage(0);
  return {
    setStage,
    remove: () => progress.remove(),
    fail() {
      item.append(progress);
      progress.classList.add("is-failed");
      progress.setAttribute("role", "alert");
      progress.setAttribute("aria-label", text.failed);
      progress.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 10 18H2Zm0 5v6m0 3v1"/></svg>';
    },
  };
}

function appendLoadingAsset() {
  const item = document.createElement("article");
  item.className = "asset-item";
  const progress = createImportProgress(item);
  assetList.prepend(item);
  return { item, ...progress };
}

function createPreviewDraws(draws) {
  if (!draws.length || draws.some(draw => !(draw.vertices instanceof Float32Array) || !draw.vertices.length || draw.vertices.length % 24 || !draw.vertices.every(Number.isFinite))) throw new TypeError("Invalid model triangles");
  const { minX, maxX, minY: minimumY, maxY, minZ, maxZ } = boundsForDraws(draws);
  const centerX = (minX + maxX) * .5, centerZ = (minZ + maxZ) * .5;
  const scale = matrix.length * ENGINE_SETTINGS.qr.blockSize * .5 / Math.max(maxX - minX, maxY - minimumY, maxZ - minZ, .0001);
  return draws.map(draw => {
    const output = new Float32Array(draw.vertices.length);
    for (let source = 0; source < draw.vertices.length; source += 8) {
      output[source] = (draw.vertices[source] - centerX) * scale;
      output[source + 1] = (draw.vertices[source + 1] - minimumY) * scale + ENGINE_SETTINGS.qr.blockSize;
      output[source + 2] = (draw.vertices[source + 2] - centerZ) * scale;
      output.set(draw.vertices.subarray(source + 3, source + 8), source + 3);
    }
    return { ...draw, vertices: output };
  });
}

function fitPreviewCamera(draws, aspect) {
  const { yaw, pitch } = ENGINE_SETTINGS.camera.isometric;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { vertices } of draws) for (let i = 0; i < vertices.length; i += 8) {
    const x = vertices[i] * cy - vertices[i + 2] * sy;
    const y = vertices[i + 1] * cp - (vertices[i] * sy + vertices[i + 2] * cy) * sp;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const scale = Math.min(2 * Math.max(aspect, 1) / Math.max(maxX - minX, .000001), 2 * Math.max(1 / aspect, 1) / Math.max(maxY - minY, .000001));
  return { yaw, pitch, viewScale: scale * matrix.length, portraitBoost: 1, offset: [-(minX + maxX) / 2, -(minY + maxY) / 2] };
}

async function mountAssetPreview(canvas, asset, loading) {
  let disposed = false, surface, renderer, observer, frame = 0;
  const events = new AbortController();
  asset.disposePreview = () => {
    disposed = true;
    cancelAnimationFrame(frame);
    events.abort();
    observer?.disconnect();
    renderer?.destroy();
    surface?.destroy();
  };
  try {
    const previewDraws = assetDraws(asset, { x: 0, z: 0, height: 0, scale: 1, rotation: 0, tilt: -Math.PI / 2 });
    const bounds = boundsForDraws(previewDraws);
    const centerX = (bounds.minX + bounds.maxX) / 2, centerZ = (bounds.minZ + bounds.maxZ) / 2;
    let hovered = false, zoom = 1, angle = 0, previousTime = 0, baseCamera;
    const updateCamera = () => { baseCamera = fitPreviewCamera(previewDraws, canvas.clientWidth / Math.max(1, canvas.clientHeight)); };
    updateCamera();
    const previewScene = () => {
      const background = editorThemes[editorTheme].clearColor.slice(0, 3);
      return {
        colors: { qr: { dark: background, light: background } },
        createFrameGeometry: () => ({ texturedOpaque: previewDraws }),
      };
    };
    surface = await createGpuSurface(canvas, await editorGpu);
    if (disposed) { surface.destroy(); return; }
    surface.device.pushErrorScope("validation");
    let validationError;
    const render = () => {
      const yaw = baseCamera.yaw + angle;
      const originalX = centerX * Math.cos(baseCamera.yaw) - centerZ * Math.sin(baseCamera.yaw);
      const originalZ = centerX * Math.sin(baseCamera.yaw) + centerZ * Math.cos(baseCamera.yaw);
      const rotatedX = centerX * Math.cos(yaw) - centerZ * Math.sin(yaw);
      const rotatedZ = centerX * Math.sin(yaw) + centerZ * Math.cos(yaw);
      const offset = [baseCamera.offset[0] + originalX - rotatedX, baseCamera.offset[1] + (rotatedZ - originalZ) * Math.sin(baseCamera.pitch)];
      renderer.render({ matrix, scene: previewScene(), showQr: false, clearColor: editorThemes[editorTheme].clearColor, camera: { isometric: { ...baseCamera, yaw, viewScale: baseCamera.viewScale * zoom, offset } } });
    };
    try {
      renderer = await createQrRenderer(canvas, surface);
      await renderer.prepareTextures(previewDraws);
      if (!disposed) render();
    } finally {
      validationError = await surface.device.popErrorScope();
    }
    if (validationError) throw validationError;
    if (disposed) return;
    await surface.device.queue.onSubmittedWorkDone();
    if (disposed) return;
    const fail = () => loading.fail();
    asset.renderPreview = () => {
      if (disposed) return;
      try { render(); } catch (cause) { fail(cause); }
    };
    const animate = time => {
      frame = 0;
      const dt = previousTime ? Math.min((time - previousTime) / 1000, .05) : 0;
      previousTime = time;
      const blend = 1 - Math.exp(-dt * 10);
      zoom += ((hovered ? 1.2 : 1) - zoom) * blend;
      if (hovered) angle = (angle + dt * .5) % (Math.PI * 2);
      else angle += (0 - angle) * blend;
      if (!hovered && Math.abs(zoom - 1) < .001 && Math.abs(angle) < .001) { zoom = 1; angle = 0; }
      asset.renderPreview();
      if (!disposed && (hovered || zoom !== 1 || angle !== 0)) frame = requestAnimationFrame(animate);
    };
    const setHover = value => {
      hovered = value;
      if (!value && angle > Math.PI) angle -= Math.PI * 2;
      if (reducedMotion) { zoom = value ? 1.2 : 1; angle = 0; asset.renderPreview(); return; }
      if (!frame) { previousTime = 0; frame = requestAnimationFrame(animate); }
    };
    asset.item.addEventListener("pointerover", event => {
      if (event.pointerType !== "touch") setHover(!event.target.closest(".asset-action"));
    }, { signal: events.signal });
    asset.item.addEventListener("pointerleave", () => setHover(false), { signal: events.signal });
    observer = new ResizeObserver(() => { updateCamera(); asset.renderPreview(); });
    observer.observe(canvas);
    loading.remove();
  } catch {
    if (!disposed) loading.fail();
  }
}

function uploadModel(formData, onUploaded) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "./editor-import.php");
    request.responseType = "text";
    request.upload.addEventListener("load", onUploaded);
    request.addEventListener("error", () => reject(new Error("Model upload failed")));
    request.addEventListener("abort", () => reject(new Error("Model upload cancelled")));
    request.addEventListener("load", () => {
      if (request.status < 200 || request.status >= 300 || !request.response) {
        let message = `Import HTTP ${request.status}`;
        try { message = JSON.parse(request.response).error ?? message; } catch { /* The server may return plain text. */ }
        reject(new Error(message));
      }
      else resolve(request.response);
    });
    request.send(formData);
  });
}

function parseConvertedModel(source) {
  if (typeof source !== "string" || new TextEncoder().encode(source).byteLength > ENGINE_SETTINGS.scene.maxJsonBytes) throw new RangeError("Converted model is too large");
  const model = JSON.parse(source);
  if (model?.version !== 1 || !Array.isArray(model.meshes) || !model.meshes.length || model.meshes.length > ENGINE_SETTINGS.scene.maxAssets) throw new TypeError("Invalid converted model");
  let drawCount = 0, vertexCount = 0;
  for (const part of model.meshes) {
    if (!Array.isArray(part?.draws) || !part.draws.length) throw new TypeError("Model has an invalid mesh");
    drawCount += part.draws.length;
    if (drawCount > ENGINE_SETTINGS.scene.maxDraws) throw new RangeError("Converted model has too many draws");
    for (const draw of part.draws) {
      if (!Array.isArray(draw?.vertices) || !draw.vertices.length || draw.vertices.length % 24) throw new TypeError("Invalid model triangles");
      vertexCount += draw.vertices.length / 8;
      if (vertexCount > ENGINE_SETTINGS.scene.maxVertices) throw new RangeError("Converted model has too many vertices");
    }
  }
  return model.meshes;
}

async function importFile(file) {
  if (file.name.split(".").pop()?.toLowerCase() !== "glb") return;
  const loading = appendLoadingAsset();
  const formData = new FormData();
  formData.append("model", file);
  try {
    const source = await uploadModel(formData, () => loading.setStage(1));
    const parts = parseConvertedModel(source);
    const assets = parts.map(part => ({ name: typeof part.name === "string" && part.name.trim() ? part.name.trim() : "Unknown", description: typeof part.description === "string" ? part.description.trim() : "", hidden: false, type: "glb", source: file.name, draws: createPreviewDraws(part.draws.map(draw => ({ color: draw.color, textureUrl: draw.textureUrl, vertices: new Float32Array(draw.vertices) }))), placements: {} }));
    loading.setStage(2);
    for (const asset of assets) {
      editorAssets.push(asset);
      await appendAsset(asset);
    }
    loading.item.remove();
  } catch {
    loading.fail();
  }
}

async function addFiles(files) {
  for (const file of files) {
    await importFile(file);
  }
}

document.querySelector("[data-asset-picker]").addEventListener("click", () => assetInput.click());
assetInput.addEventListener("change", () => {
  addFiles([...assetInput.files]);
  assetInput.value = "";
});

async function mountPlane(canvas) {
  const season = canvas.parentElement.dataset.season;
  const surface = await createGpuSurface(canvas, await editorGpu);
  const renderer = await createQrRenderer(canvas, surface);
  let frame = 0;
  const render = () => {
    frame = 0;
    if (views[activeSeason].dataset.season !== season) return;
    try {
      renderer.render({ matrix, scene: sceneForSeason(season), season, progress: 0, time: 0, clearColor: [0, 0, 0, 0], onTextureLoad: requestRender, camera: { isometric: editorCamera } });
      canvas.parentElement.classList.add("is-ready");
    } catch (cause) { reportRenderError(cause); }
  };
  function requestRender() {
    if (!frame && views[activeSeason].dataset.season === season) frame = requestAnimationFrame(render);
  }
  renderPlanes.set(season, requestRender);
  new ResizeObserver(() => {
    requestRender();
    if (views[activeSeason].dataset.season === season) updateMeshControls();
  }).observe(canvas);
  requestRender();
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const season = canvas.parentElement.dataset.season;
    const placements = [...selectedAssets].filter(asset => !asset.hidden).map(asset => asset.placements[season]).filter(Boolean);
    if (placements.length) {
      const before = captureEdit([...selectedAssets].filter(asset => !asset.hidden && asset.placements[season]));
      for (const placement of placements) {
        if (event.ctrlKey || event.metaKey) setPlacementHeight(placement, placement.height - event.deltaY * .0005);
        else if (event.shiftKey) placement.rotation += Math.sign(event.deltaY) * rotationStep;
        else setPlacementScale(placement, placement.scale * Math.exp(-event.deltaY * .001));
      }
      commitEdit(before, `wheel:${season}:${event.ctrlKey || event.metaKey ? "height" : event.shiftKey ? "rotate" : "scale"}`);
      refreshEditorScenes();
    } else {
      editorCamera.viewScale = Math.max(18, Math.min(70, editorCamera.viewScale * Math.exp(-event.deltaY * .001)));
      redrawPlanes();
    }
  }, { passive: false });

  function pointerToPlane(event) {
    const { x: rotatedX, y: rotatedY } = pointerViewPosition(canvas, event);
    const yaw = editorCamera.yaw;
    const pitch = editorCamera.pitch;
    const rotatedZ = (ENGINE_SETTINGS.qr.blockSize * Math.cos(pitch) - rotatedY) / Math.sin(pitch);
    const half = matrix.length * ENGINE_SETTINGS.qr.blockSize * .5;
    return {
      x: Math.max(-half, Math.min(half, rotatedX * Math.cos(yaw) + rotatedZ * Math.sin(yaw))),
      z: Math.max(-half, Math.min(half, -rotatedX * Math.sin(yaw) + rotatedZ * Math.cos(yaw))),
    };
  }
  canvas.addEventListener("pointerdown", event => {
    const season = canvas.parentElement.dataset.season;
    if (event.button !== 0) return;
    const origin = pointerToPlane(event);
    const asset = assetAt(season, pointerViewPosition(canvas, event));
    if (!asset) {
      if (selectedAssets.size) {
        clearSelection();
      }
      return;
    }
    event.preventDefault();
    const placement = asset.placements[season];
    const start = { x: placement.x, z: placement.z };
    const before = captureEdit([asset]);
    let dragging = false;
    const move = pointer => {
      if (!dragging && Math.hypot(pointer.clientX - event.clientX, pointer.clientY - event.clientY) < 4) return;
      dragging = true;
      if (activeAsset !== asset) selectAsset(asset);
      dragPlacement(placement, start, origin, pointerToPlane(pointer));
      refreshEditorScenes();
    };
    trackPointer(event, move, (_pointer, cancelled) => {
      commitEdit(before);
      if (!cancelled && !dragging) toggleAsset(asset);
    });
  });
  planeDropTargets.set(canvas, { season: canvas.parentElement.dataset.season, toPlane: pointerToPlane });
}

const results = await Promise.allSettled([...document.querySelectorAll(".season-view canvas")].map(mountPlane));
const initializationFailure = results.find(result => result.status === "rejected");
if (initializationFailure) {
  error.hidden = false;
}

function setActiveSeason(index) {
  if (index === activeSeason) return;
  activeSeason = index;
  copySeasons.hidden = true;
  for (const button of seasonButtons) button.setAttribute("aria-pressed", String(Number(button.dataset.seasonIndex) === activeSeason));
  redrawPlanes();
}

function scrollToSeason(index) {
  setActiveSeason(index);
  carousel.scrollTo({ left: carousel.clientWidth * activeSeason, behavior: reducedMotion ? "auto" : "smooth" });
}

for (const button of seasonButtons) button.addEventListener("click", () => scrollToSeason(Number(button.dataset.seasonIndex)));
carousel.addEventListener("scroll", () => {
  setActiveSeason(Math.max(0, Math.min(views.length - 1, Math.round(carousel.scrollLeft / Math.max(1, carousel.clientWidth)))));
  updateMeshControls();
}, { passive: true });

window.addEventListener("keydown", event => {
  if (event.key === "Escape" && !colorPanel.hidden) {
    const button = colorTarget.button;
    closeColorPanel();
    button.focus();
    event.preventDefault();
    return;
  }
  if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
  if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
    event.preventDefault();
    if (event.key.toLowerCase() === "y" || event.shiftKey) restoreEdit(redoStack, undoStack, "after");
    else restoreEdit(undoStack, redoStack, "before");
    return;
  }
  if (event.key === "Escape") {
    if (!transformHelp.hidden || !copySeasons.hidden || !colorPanel.hidden || !exportPanel.hidden) closeTransientPanels();
    else if (selectedAssets.size) {
      clearSelection();
    }
    event.preventDefault();
    return;
  }
  if (event.key === "Delete") {
    const season = views[activeSeason].dataset.season;
    const assets = [...selectedAssets].filter(asset => !asset.hidden && asset.placements[season]);
    if (!assets.length) return;
    removePlacements(assets, season);
    event.preventDefault();
    return;
  }
  const season = views[activeSeason].dataset.season;
  const placements = [...selectedAssets].filter(asset => !asset.hidden).map(asset => asset.placements[season]).filter(Boolean);
  if (!placements.length) return;
  const before = captureEdit([...selectedAssets].filter(asset => !asset.hidden && asset.placements[season]));
  let changed = false;
  if (event.shiftKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
    const amount = event.key === "ArrowUp" ? .005 : -.005;
    for (const placement of placements) setPlacementHeight(placement, placement.height + amount);
    changed = true;
  } else {
    const movement = { ArrowLeft: [-qrStep, 0], ArrowRight: [qrStep, 0], ArrowUp: [0, -qrStep], ArrowDown: [0, qrStep] }[event.key];
    if (movement) {
      for (const placement of placements) { placement.x += movement[0]; placement.z += movement[1]; }
      changed = true;
    } else if (["+", "=", "NumpadAdd"].includes(event.key) || event.code === "NumpadAdd") {
      for (const placement of placements) setPlacementScale(placement, placement.scale * 1.1);
      changed = true;
    } else if (["-", "_", "NumpadSubtract"].includes(event.key) || event.code === "NumpadSubtract") {
      for (const placement of placements) setPlacementScale(placement, placement.scale / 1.1);
      changed = true;
    }
  }
  if (changed) { commitEdit(before, `key:${season}:${event.key}:${event.shiftKey}`); event.preventDefault(); refreshEditorScenes(); }
});
