import { ENGINE_SETTINGS } from "./settings.js";

export const SEASONS = Object.freeze(["spring", "summer", "autumn", "winter"]);

export function normalizeSeason(value) {
  return SEASONS.includes(value) ? value : ENGINE_SETTINGS.scene.defaultSeason;
}
