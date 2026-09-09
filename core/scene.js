import { createMaterial } from "./material.js";

export function createScene({ terrain = null, objects = [], update = () => {} } = {}) {
  if (!Array.isArray(objects)) throw new TypeError("objects deve essere un array");
  if (typeof update !== "function") throw new TypeError("update deve essere una funzione");
  return { terrain, objects, update };
}

export { createMaterial };
