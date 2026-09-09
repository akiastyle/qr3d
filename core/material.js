import { ENGINE_SETTINGS } from "./settings.js";

export function createMaterial({ color = ENGINE_SETTINGS.material.defaultColor, opacity = ENGINE_SETTINGS.material.defaultOpacity, transparent = opacity < 1 } = {}) {
  if (!Array.isArray(color) || color.length !== 3 || color.some(component => component < 0 || component > 1)) throw new TypeError("color deve contenere tre valori tra 0 e 1");
  if (opacity < 0 || opacity > 1) throw new RangeError("opacity deve essere tra 0 e 1");
  return Object.freeze({ color: Object.freeze([...color]), opacity, transparent });
}
