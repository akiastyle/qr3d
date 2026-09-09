export function createHeightField(sample) {
  if (typeof sample !== "function") throw new TypeError("sample deve essere una funzione");
  return Object.freeze({ sample: (x, z, time = 0) => Number(sample(x, z, time)) || 0 });
}
