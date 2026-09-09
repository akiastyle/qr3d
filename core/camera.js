import { ENGINE_SETTINGS } from "./settings.js";

export function createCamera(view = "isometric", overrides = {}) {
  const pose = ENGINE_SETTINGS.camera[view];
  if (!pose) throw new RangeError(`Vista camera non supportata: ${view}`);
  return Object.freeze({ ...pose, portraitBoost: ENGINE_SETTINGS.camera.portraitBoost, ...overrides });
}
