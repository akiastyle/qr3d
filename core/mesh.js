import { ENGINE_SETTINGS } from "./settings.js";

export const PRIMITIVE = Object.freeze({ BOX: "box", PLANE: "plane", CYLINDER: "cylinder", CONE: "cone", SPHERE: "sphere", TORUS: "torus", RIBBON: "ribbon" });

export function createPrimitive(type, options = {}) {
  if (!Object.values(PRIMITIVE).includes(type)) throw new RangeError(`Primitiva non supportata: ${type}`);
  return Object.freeze({ type, segments: options.segments ?? ENGINE_SETTINGS.mesh.defaultSegments, ...options });
}
