import { SEASONS } from "./season.js";

export function defineScene({ id, label, colors, elements = [], seasons = {}, createStaticGeometry = null, createFrameGeometry = null, createQrModules = null, qrPalette = null, createRenderer = null }) {
  if (typeof id !== "string" || !id) throw new TypeError("La scena richiede un id");
  if (typeof label !== "string" || !label) throw new TypeError("La scena richiede un label");
  if (!colors?.qr || !colors?.elements) throw new TypeError("La scena richiede colors.qr e colors.elements");
  if (!Array.isArray(elements)) throw new TypeError("Gli elementi base devono essere un array");
  if (createStaticGeometry !== null && typeof createStaticGeometry !== "function") throw new TypeError("createStaticGeometry deve essere una funzione");
  if (createFrameGeometry !== null && typeof createFrameGeometry !== "function") throw new TypeError("createFrameGeometry deve essere una funzione");
  if (createQrModules !== null && typeof createQrModules !== "function") throw new TypeError("createQrModules deve essere una funzione");
  if (createRenderer !== null && typeof createRenderer !== "function") throw new TypeError("createRenderer deve essere una funzione");
  if (qrPalette !== null && (!Array.isArray(qrPalette) || !qrPalette.every(color => Array.isArray(color) && color.length === 3))) throw new TypeError("qrPalette richiede colori RGB");
  for (const season of SEASONS) if (!Array.isArray(seasons[season] ?? [])) throw new TypeError(`Gli elementi ${season} devono essere un array`);
  return Object.freeze({
    id,
    label,
    colors,
    elements: Object.freeze([...elements]),
    seasons: Object.freeze(Object.fromEntries(SEASONS.map(season => [season, Object.freeze(seasons[season] ?? [])]))),
    createStaticGeometry,
    createFrameGeometry,
    createQrModules,
    qrPalette: qrPalette && Object.freeze(qrPalette.map(color => Object.freeze([...color]))),
    createRenderer,
  });
}
