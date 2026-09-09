export function createQrBounds(gridSize, cellSize) {
  if (!Number.isInteger(gridSize) || gridSize < 1) throw new RangeError("gridSize deve essere un intero positivo");
  if (!(cellSize > 0)) throw new RangeError("cellSize deve essere positivo");
  const halfSize = gridSize * cellSize / 2;
  return Object.freeze({ gridSize, cellSize, halfSize, minX: -halfSize, maxX: halfSize, minZ: -halfSize, maxZ: halfSize });
}

export function moduleToWorld(column, row, bounds) {
  return Object.freeze({ x: (column + .5) * bounds.cellSize - bounds.halfSize, z: (row + .5) * bounds.cellSize - bounds.halfSize });
}
