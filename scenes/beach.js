import { encodeQrMatrix } from "../core/qr.js";
import { ALPHA_BLEND_STATE, createBindGroup, createBindGroupLayout, createIndexBuffer, createRenderTargets, createScenePipeline, createStorageBuffer, createUniformBuffer, createVertexBuffer } from "../core/gpu.js";
import { ENGINE_SETTINGS } from "../core/settings.js";
import { createSceneModule, createSceneRuntime } from "../core/scene-runtime.js";
import { SCENE_UNIFORM_WGSL, createIsometricTransformWgsl } from "../core/scene-wgsl.js";
import { createTransitionBlur } from "../core/blur.js";
import { writeSceneUniforms } from "../core/scene-uniforms.js";
import { BEACH_CRAB_INDEX_COUNT, BEACH_CRAB_INDICES, BEACH_CRAB_VERTICES } from "../assets/meshes/beach-crab.js";
import { BEACH_CASTLE_INDEX_COUNT, BEACH_CASTLE_INDICES, BEACH_CASTLE_VERTICES } from "../assets/meshes/beach-castle.js";
import { BEACH_LOUNGER_INDEX_COUNT, BEACH_LOUNGER_INDICES, BEACH_LOUNGER_VERTICES } from "../assets/meshes/beach-lounger.js";
import { BEACH_FISHING_ROD_INDEX_COUNT, BEACH_FISHING_ROD_INDICES, BEACH_FISHING_ROD_VERTICES } from "../assets/meshes/beach-fishing-rod.js";

const $ = ENGINE_SETTINGS.qr.blockSize, q = $, G = ENGINE_SETTINGS.scene.maxVoxelCount, CANOPY_RADIUS_RATIO = .38;
const Z = ENGINE_SETTINGS.lighting.skyFillColor, Q = ENGINE_SETTINGS.lighting.bounceColor;
const createRef = value => ({ current: value });

function toWgslVec3([red, green, blue]) {
  return (
    "vec3f(" +
    red.toFixed(6) +
    ", " +
    green.toFixed(6) +
    ", " +
    blue.toFixed(6) +
    ")"
  );
}

function legacyBuildQrMatrix(qrContentAt225d6f) {
  try {
    const { modules: qrCode } = Y.create(qrContentAt225d6f || "https://icqr.com/", {
        errorCorrectionLevel: "M",
      }),
      { size: qrGridSizeAt270f47 } = qrCode,
      qrRows = [];
    for (let qrRowIndexAt2e1755 = 0; qrRowIndexAt2e1755 < qrGridSizeAt270f47; qrRowIndexAt2e1755++) {
      const qrRowValues = [];
      for (let qrColumnIndexAt18f8c6 = 0; qrColumnIndexAt18f8c6 < qrGridSizeAt270f47; qrColumnIndexAt18f8c6++)
        qrRowValues.push(1 === qrCode.get(qrColumnIndexAt18f8c6, qrRowIndexAt2e1755));
      qrRows.push(qrRowValues);
    }
    return qrRows;
  } catch {
    return legacyBuildQrMatrix(ENGINE_SETTINGS.scene.defaultUrl);
  }
}

var BlockType = (function (blockTypeMap) {
  return (
    (blockTypeMap[(blockTypeMap.Dirt = 0)] = "Dirt"),
    (blockTypeMap[(blockTypeMap.FountainWater = 1)] = "FountainWater"),
    (blockTypeMap[(blockTypeMap.FountainStone = 2)] = "FountainStone"),
    (blockTypeMap[(blockTypeMap.Grass = 3)] = "Grass"),
    (blockTypeMap[(blockTypeMap.FallenPetals = 4)] = "FallenPetals"),
    (blockTypeMap[(blockTypeMap.Branch = 5)] = "Branch"),
    (blockTypeMap[(blockTypeMap.PebbleBed = 6)] = "PebbleBed"),
    (blockTypeMap[(blockTypeMap.BeachQrSand = 7)] = "BeachQrSand"),
    blockTypeMap
  );
})({});

const BEACH_QR_APPEARANCE = {
  colors: { qr: { dark: [.42, .31, .17], light: [.78, .66, .40] } },
  qrPalette: [[.78, .66, .40], [.42, .31, .17], [.14, .43, .51]],
  createQrModules(matrix) {
    const size = matrix.length;
    const modules = new Uint32Array(size * size);
    const halfGrid = size * q * .5;
    for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
      if (!matrix[row][column]) continue;
      const sourceX = halfGrid - (column + .5) * q;
      const sourceZ = halfGrid - (row + .5) * q;
      const beachU = sourceX / (size * q) + .5;
      const shorelineZ = -halfGrid + halfGrid * 1.035 + (Math.sin(beachU * 12.566371) * .70 + Math.sin(beachU * 31.415928 + .8) * .30) * q;
      modules[row * size + column] = sourceZ <= shorelineZ ? 2 : 1;
    }
    return modules;
  },
};

function noise(noiseX, noiseY = 0, noiseSalt = 0) {
  const noiseValue =
    43758.5 *
    Math.sin(127.1 * noiseX + 311.7 * noiseY + 43.7 * noiseSalt);
  return noiseValue - Math.floor(noiseValue);
}

var re = 0;

function setNoiseSeed(noiseSeed) {
  re = noiseSeed;
}

function seededNoise(seededNoiseX, seededNoiseY = 0, seededNoiseSalt = 0) {
  const seededNoiseValue =
    43758.5 *
    Math.sin(
      127.1 * seededNoiseX + 311.7 * seededNoiseY + 43.7 * seededNoiseSalt + 7919 * re,
    );
  return seededNoiseValue - Math.floor(seededNoiseValue);
}

function createFountainVoxelBlocks(qrMatrix) {
  const gridSize = qrMatrix.length;
  const moduleCount = gridSize * gridSize;
  const positions = new Float32Array(moduleCount * 4);
  const heights = new Float32Array(moduleCount);
  const baseY = new Float32Array(moduleCount);
  const types = new Uint32Array(moduleCount);
  let blockCount = 0;
  const qrOnlyMode = globalThis.__ICQR_QR_ONLY__ === true;

  for (let row = 0; row < gridSize; row++) {
    for (let column = 0; column < gridSize; column++, blockCount++) {
      const positionOffset = blockCount * 4;
      const distanceFromCenter = Math.hypot(
        column - gridSize * 0.5,
        row - gridSize * 0.5,
      ) / gridSize;
      positions[positionOffset] = column;
      positions[positionOffset + 1] = row;
      heights[blockCount] = q;
      // The beach route reuses this validated UI/QR pass without the fountain.
      if (qrOnlyMode) {
        types[blockCount] = qrMatrix[row][column]
          ? BlockType.BeachQrSand
          : BlockType.Dirt;
      } else if (!qrMatrix[row][column]) {
        types[blockCount] = BlockType.Dirt;
      } else if (distanceFromCenter < 0.07 ||
                 (distanceFromCenter >= 0.145 && distanceFromCenter < 0.165) ||
                 (distanceFromCenter >= 0.215 && distanceFromCenter < 0.235) ||
                 (distanceFromCenter >= 0.36 && distanceFromCenter < 0.41)) {
        types[blockCount] = BlockType.FountainStone;
      } else if (distanceFromCenter < 0.36) {
        types[blockCount] = BlockType.FountainWater;
      } else {
        types[blockCount] = BlockType.PebbleBed;
      }
    }
  }
  return { positions, heights, baseY, types, gridSize, numBlocks: blockCount };
}

// The QR remains readable through the placement of the stones, not through
// a second layer of QR-sized cubes.
const FOUNTAIN_PEBBLE_CLEARANCE_RATIO = 0.48;

function generatePebbleData(qrMatrix) {
  const gridSize = qrMatrix.length,
    center = gridSize / 2,
    fountainClearanceRadius = gridSize * FOUNTAIN_PEBBLE_CLEARANCE_RATIO,
    fountainClearanceRadiusSquared = fountainClearanceRadius * fountainClearanceRadius,
    pebbles = [];
  for (let row = 0; row < gridSize; row++)
    for (let column = 0; column < gridSize; column++) {
      if (!qrMatrix[row][column]) continue;
      const deltaColumn = column - center,
        deltaRow = row - center,
        distanceSquared = deltaColumn * deltaColumn + deltaRow * deltaRow;
      if (distanceSquared < fountainClearanceRadiusSquared) continue;
      const pebbleCount = 1 + Math.floor(noise(column, row, 6300) * 3);
      for (let pebbleIndex = 0; pebbleIndex < pebbleCount; pebbleIndex++) {
        const seed = noise(column, row, 6400 + pebbleIndex),
          size = .32 + noise(column, row, 6500 + pebbleIndex) * .18;
        pebbles.push(
          column + (noise(column, row, 6600 + pebbleIndex) - .5) * .68,
          row + (noise(column, row, 6700 + pebbleIndex) - .5) * .68,
          seed,
          size,
        );
      }
    }
  return { positions: new Float32Array(pebbles), count: pebbles.length / 4 };
}

function analyzeQrMatrix(qrModules) {
  const qrGridSizeAt2d105a = qrModules.length;
  let darkModuleCount = 0,
    qrEdgeModuleCount = 0;
  for (let qrRowIndexAt3a59be = 0; qrRowIndexAt3a59be < qrGridSizeAt2d105a; qrRowIndexAt3a59be++)
    for (let qrColumnIndexAt5170e7 = 0; qrColumnIndexAt5170e7 < qrGridSizeAt2d105a; qrColumnIndexAt5170e7++)
      (qrModules[qrRowIndexAt3a59be][qrColumnIndexAt5170e7] && darkModuleCount++,
        qrColumnIndexAt5170e7 > 0 &&
          qrModules[qrRowIndexAt3a59be][qrColumnIndexAt5170e7] !==
            qrModules[qrRowIndexAt3a59be][qrColumnIndexAt5170e7 - 1] &&
          qrEdgeModuleCount++,
        qrRowIndexAt3a59be > 0 &&
          qrModules[qrRowIndexAt3a59be][qrColumnIndexAt5170e7] !==
            qrModules[qrRowIndexAt3a59be - 1][qrColumnIndexAt5170e7] &&
          qrEdgeModuleCount++);
  const qrDensity = darkModuleCount / (qrGridSizeAt2d105a * qrGridSizeAt2d105a),
    qrEdgeRatio = qrEdgeModuleCount / (2 * qrGridSizeAt2d105a * (qrGridSizeAt2d105a - 1)),
    treeScale = qrGridSizeAt2d105a / 29;
  return {
    gridSize: qrGridSizeAt2d105a,
    density: qrDensity,
    edgeRatio: qrEdgeRatio,
    trunkHeight: (0.26 + 0.08 * qrDensity) * treeScale,
    trunkRadius: (0.024 + 0.008 * qrDensity) * treeScale,
    trunkLean: (0.04 + 0.03 * noise(qrDensity, qrEdgeRatio)) * treeScale,
    mainBranches: 4 + Math.floor(4 * qrDensity),
    branchSpread: 0.5 + 0.5 * qrEdgeRatio,
    branchLengthScale: 0.55 + 0.25 * qrDensity,
    maxDepth: qrEdgeRatio > 0.28 ? 5 : 4,
    canopyDensity: 0.5 + 0.5 * qrDensity,
  };
}

function createTreeBranches(treeConfigAt260926, gridSizeAt3c69a6) {
  const canopyRadiusAt6160f6 = gridSizeAt3c69a6 * CANOPY_RADIUS_RATIO * $,
    branchSegmentValues = [],
    canopyTipsAt4b29cb = [],
    {
      trunkHeight: trunkHeight,
      trunkRadius: trunkRadius,
      trunkLean: trunkLean,
      mainBranches: mainBranchCount,
      branchLengthScale: branchLengthScale,
      maxDepth: maxBranchDepth,
    } = treeConfigAt260926;
  let branchSegmentCount = 0;
  function appendBranchSegment(
    branchStartXAt1f6df9,
    branchStartYAt480503,
    branchStartZAt1f2f3a,
    branchStartRadiusAt3c041a,
    branchEndX,
    branchEndY,
    branchSeedAtecf8a2,
    branchEndRadiusAt2bd5e9,
    branchDepthAt58102a,
    branchSeedAt5b1ff7,
  ) {
    (branchSegmentValues.push(
      branchStartXAt1f6df9,
      branchStartYAt480503,
      branchStartZAt1f2f3a,
      branchStartRadiusAt3c041a,
      branchEndX,
      branchEndY,
      branchSeedAtecf8a2,
      branchEndRadiusAt2bd5e9,
      branchDepthAt58102a,
      branchSeedAt5b1ff7,
      0,
      0,
    ),
      branchSegmentCount++);
  }
  for (let trunkSegmentIndex = 0; trunkSegmentIndex < 10; trunkSegmentIndex++) {
    const trunkSegmentStartT = trunkSegmentIndex / 10,
      trunkSegmentEndT = (trunkSegmentIndex + 1) / 10,
      trunkSegmentStartRadius =
        trunkRadius *
        (1 - 0.55 * trunkSegmentStartT) *
        (1 + 0.08 * Math.sin(trunkSegmentStartT * Math.PI * 0.8)),
      trunkSegmentEndRadius =
        trunkRadius *
        (1 - 0.55 * trunkSegmentEndT) *
        (1 + 0.08 * Math.sin(trunkSegmentEndT * Math.PI * 0.8)),
      trunkSegmentStartX =
        trunkLean * trunkSegmentStartT * trunkSegmentStartT +
        0.3 * trunkLean * Math.sin(trunkSegmentStartT * Math.PI * 1.5),
      trunkSegmentStartZ = 0.5 * trunkLean * Math.sin(trunkSegmentStartT * Math.PI * 0.8),
      trunkSegmentEndX =
        trunkLean * trunkSegmentEndT * trunkSegmentEndT +
        0.3 * trunkLean * Math.sin(trunkSegmentEndT * Math.PI * 1.5),
      trunkSegmentEndZ = 0.5 * trunkLean * Math.sin(trunkSegmentEndT * Math.PI * 0.8);
    appendBranchSegment(
      trunkSegmentStartX,
      trunkSegmentStartT * trunkHeight,
      trunkSegmentStartZ,
      trunkSegmentStartRadius,
      trunkSegmentEndX,
      trunkSegmentEndT * trunkHeight,
      trunkSegmentEndZ,
      trunkSegmentEndRadius,
      0,
      0.5 * trunkSegmentStartT,
    );
  }
  function trunkPointAt(trunkT) {
    return {
      x:
        trunkLean * trunkT * trunkT +
        0.3 * trunkLean * Math.sin(trunkT * Math.PI * 1.5),
      y: trunkHeight * trunkT,
      z: 0.5 * trunkLean * Math.sin(trunkT * Math.PI * 0.8),
    };
  }
  const maximumBranchY = trunkHeight + 1.5 * canopyRadiusAt6160f6,
    minimumBranchY = 0.5 * trunkHeight;
  function createChildBranch(
    branchStartXAt4261de,
    branchStartYAt4002bb,
    branchStartZAt43217d,
    branchStartRadiusAt1e4b6d,
    branchStartXAt26c4b7,
    branchStartYAt20295f,
    branchStartZAt588b5d,
    branchEndRadiusAt309d6,
    parentBranchAzimuth,
    branchDepthAt2bad0a,
  ) {
    if (branchSegmentCount >= 485) return;
    appendBranchSegment(
      branchStartXAt4261de,
      branchStartYAt4002bb,
      branchStartZAt43217d,
      branchStartRadiusAt1e4b6d,
      branchStartXAt26c4b7,
      branchStartYAt20295f,
      branchStartZAt588b5d,
      branchEndRadiusAt309d6,
      branchDepthAt2bad0a,
      seededNoise(branchSegmentCount, 0, 400),
    );
    const childBranchCount = 1 + Math.floor(2 * seededNoise(branchSegmentCount, 0, 500));
    for (
      let childBranchIndex = 0;
      childBranchIndex < childBranchCount && branchSegmentCount < 485;
      childBranchIndex++
    ) {
      const childBranchAzimuthAt2938b6 =
          parentBranchAzimuth + 2.2 * (seededNoise(branchSegmentCount, childBranchIndex, 600) - 0.5),
        childBranchLengthAt384ca9 =
          canopyRadiusAt6160f6 *
          (0.15 + 0.2 * seededNoise(branchSegmentCount, childBranchIndex, 700)) *
          branchLengthScale,
        branchElevationAngle = 0.1 + 0.45 * seededNoise(branchSegmentCount, childBranchIndex, 750),
        childBranchStartRadius =
          branchEndRadiusAt309d6 * (0.5 + 0.2 * seededNoise(branchSegmentCount, childBranchIndex, 800));
      let childBranchXAt4547c6 =
          branchStartXAt26c4b7 + Math.cos(childBranchAzimuthAt2938b6) * Math.cos(branchElevationAngle) * childBranchLengthAt384ca9,
        childBranchYAt36cf0f = Math.max(
          Math.min(branchStartYAt20295f + Math.sin(branchElevationAngle) * childBranchLengthAt384ca9, maximumBranchY),
          minimumBranchY,
        ),
        childBranchZAt24ed2b =
          branchStartZAt588b5d + Math.sin(childBranchAzimuthAt2938b6) * Math.cos(branchElevationAngle) * childBranchLengthAt384ca9;
      const childBranchRadiusAt34167f = 0.4 * childBranchStartRadius,
        childBranchPlanarDistanceAt316203 = Math.sqrt(childBranchXAt4547c6 * childBranchXAt4547c6 + childBranchZAt24ed2b * childBranchZAt24ed2b);
      if (
        (childBranchPlanarDistanceAt316203 > 0.95 * canopyRadiusAt6160f6 &&
          ((childBranchXAt4547c6 *= (0.95 * canopyRadiusAt6160f6) / childBranchPlanarDistanceAt316203),
          (childBranchZAt24ed2b *= (0.95 * canopyRadiusAt6160f6) / childBranchPlanarDistanceAt316203)),
        appendBranchSegment(
          branchStartXAt26c4b7,
          branchStartYAt20295f,
          branchStartZAt588b5d,
          childBranchStartRadius,
          childBranchXAt4547c6,
          childBranchYAt36cf0f,
          childBranchZAt24ed2b,
          childBranchRadiusAt34167f,
          branchDepthAt2bad0a + 1,
          seededNoise(branchSegmentCount, childBranchIndex, 850),
        ),
        canopyTipsAt4b29cb.push({
          x: childBranchXAt4547c6,
          y: childBranchYAt36cf0f,
          z: childBranchZAt24ed2b,
          radius: 25 * childBranchRadiusAt34167f,
        }),
        maxBranchDepth >= 4 && branchSegmentCount < 485)
      ) {
        const childBranchAzimuthAt48aa2a =
            childBranchAzimuthAt2938b6 + 2.2 * (seededNoise(branchSegmentCount, childBranchIndex, 860) - 0.5),
          childBranchLengthAt304fd6 = 0.45 * childBranchLengthAt384ca9,
          childBranchElevation = 0.1 + 0.35 * seededNoise(branchSegmentCount, childBranchIndex, 870),
          childBranchRadiusAt172573 = 0.5 * childBranchRadiusAt34167f;
        let childBranchXAt20f6bb =
          childBranchXAt4547c6 + Math.cos(childBranchAzimuthAt48aa2a) * Math.cos(childBranchElevation) * childBranchLengthAt304fd6;
        const childBranchYAt58eeb9 = Math.max(
          Math.min(childBranchYAt36cf0f + Math.sin(childBranchElevation) * childBranchLengthAt304fd6, maximumBranchY),
          minimumBranchY,
        );
        let childBranchZAt1617a4 =
          childBranchZAt24ed2b + Math.sin(childBranchAzimuthAt48aa2a) * Math.cos(childBranchElevation) * childBranchLengthAt304fd6;
        const childBranchPlanarDistanceAt11026a = Math.sqrt(
          childBranchXAt20f6bb * childBranchXAt20f6bb + childBranchZAt1617a4 * childBranchZAt1617a4,
        );
        (childBranchPlanarDistanceAt11026a > 0.95 * canopyRadiusAt6160f6 &&
          ((childBranchXAt20f6bb *= (0.95 * canopyRadiusAt6160f6) / childBranchPlanarDistanceAt11026a),
          (childBranchZAt1617a4 *= (0.95 * canopyRadiusAt6160f6) / childBranchPlanarDistanceAt11026a)),
          appendBranchSegment(
            childBranchXAt4547c6,
            childBranchYAt36cf0f,
            childBranchZAt24ed2b,
            childBranchRadiusAt34167f,
            childBranchXAt20f6bb,
            childBranchYAt58eeb9,
            childBranchZAt1617a4,
            0.3 * childBranchRadiusAt172573,
            branchDepthAt2bad0a + 2,
            seededNoise(branchSegmentCount, childBranchIndex, 880),
          ),
          canopyTipsAt4b29cb.push({
            x: childBranchXAt20f6bb,
            y: childBranchYAt58eeb9,
            z: childBranchZAt1617a4,
            radius: 15 * childBranchRadiusAt172573,
          }));
      }
    }
  }
  const secondaryBranchCount = 3 + Math.floor(2 * seededNoise(0, 0, 2e3)),
    trunkTopPoint = trunkPointAt(0.95);
  for (
    let mainBranchIndexAt115bc7 = 0;
    mainBranchIndexAt115bc7 < secondaryBranchCount && branchSegmentCount < 470;
    mainBranchIndexAt115bc7++
  ) {
    const secondaryBranchAzimuth =
        (mainBranchIndexAt115bc7 / secondaryBranchCount) * Math.PI * 2 +
        0.5 * seededNoise(mainBranchIndexAt115bc7, 0, 2100),
      secondaryBranchLength = canopyRadiusAt6160f6 * (0.1 + 0.25 * seededNoise(mainBranchIndexAt115bc7, 0, 2200)),
      mainBranchRadiusAt13374c = trunkRadius * (0.3 + 0.12 * seededNoise(mainBranchIndexAt115bc7, 0, 2300)),
      secondaryBranchSegmentCount = 2 + Math.floor(seededNoise(mainBranchIndexAt115bc7, 0, 2400));
    let mainBranchXAt2beda2 = trunkTopPoint.x,
      mainBranchYAt52a541 = trunkTopPoint.y,
      mainBranchZAt362b73 = trunkTopPoint.z,
      secondaryBranchRadius = mainBranchRadiusAt13374c;
    for (
      let secondaryBranchSegmentIndex = 0;
      secondaryBranchSegmentIndex < secondaryBranchSegmentCount && branchSegmentCount < 475;
      secondaryBranchSegmentIndex++
    ) {
      const secondaryBranchT = (secondaryBranchSegmentIndex + 1) / secondaryBranchSegmentCount,
        secondaryBranchXJitter = 0.01 * (seededNoise(mainBranchIndexAt115bc7, secondaryBranchSegmentIndex, 2500) - 0.5),
        secondaryBranchZJitter = 0.01 * (seededNoise(mainBranchIndexAt115bc7, secondaryBranchSegmentIndex, 2600) - 0.5),
        secondaryBranchX =
          trunkTopPoint.x + Math.cos(secondaryBranchAzimuth) * secondaryBranchLength * secondaryBranchT + secondaryBranchXJitter,
        secondaryBranchYAt99854e =
          trunkTopPoint.y +
          (maximumBranchY - trunkTopPoint.y) *
            secondaryBranchT *
            (0.7 + 0.3 * seededNoise(mainBranchIndexAt115bc7, secondaryBranchSegmentIndex, 2700)),
        secondaryBranchYAt566802 =
          trunkTopPoint.z + Math.sin(secondaryBranchAzimuth) * secondaryBranchLength * secondaryBranchT + secondaryBranchZJitter,
        secondaryBranchZ =
          secondaryBranchRadius * (0.5 + 0.1 * seededNoise(mainBranchIndexAt115bc7, secondaryBranchSegmentIndex, 2800));
      (appendBranchSegment(
        mainBranchXAt2beda2,
        mainBranchYAt52a541,
        mainBranchZAt362b73,
        secondaryBranchRadius,
        secondaryBranchX,
        secondaryBranchYAt99854e,
        secondaryBranchYAt566802,
        secondaryBranchZ,
        1,
        seededNoise(mainBranchIndexAt115bc7, secondaryBranchSegmentIndex, 2900),
      ),
        (mainBranchXAt2beda2 = secondaryBranchX),
        (mainBranchYAt52a541 = secondaryBranchYAt99854e),
        (mainBranchZAt362b73 = secondaryBranchYAt566802),
        (secondaryBranchRadius = secondaryBranchZ));
    }
    (canopyTipsAt4b29cb.push({
      x: mainBranchXAt2beda2,
      y: mainBranchYAt52a541,
      z: mainBranchZAt362b73,
      radius: 35 * secondaryBranchRadius,
    }),
      createChildBranch(
        mainBranchXAt2beda2,
        mainBranchYAt52a541,
        mainBranchZAt362b73,
        0.7 * secondaryBranchRadius,
        mainBranchXAt2beda2 + (seededNoise(mainBranchIndexAt115bc7, 0, 3e3) - 0.5) * canopyRadiusAt6160f6 * 0.35,
        Math.max(Math.min(mainBranchYAt52a541 + 0.08 * canopyRadiusAt6160f6, maximumBranchY), minimumBranchY),
        mainBranchZAt362b73 + (seededNoise(mainBranchIndexAt115bc7, 0, 3100) - 0.5) * canopyRadiusAt6160f6 * 0.35,
        0.3 * secondaryBranchRadius,
        secondaryBranchAzimuth,
        2,
      ));
  }
  for (
    let mainBranchIndexAt4fdf60 = 0;
    mainBranchIndexAt4fdf60 < mainBranchCount && branchSegmentCount < 470;
    mainBranchIndexAt4fdf60++
  ) {
    const mainBranchStartPoint = trunkPointAt(0.7 + 0.25 * seededNoise(mainBranchIndexAt4fdf60, 0, 1200)),
      mainBranchAzimuth =
        (mainBranchIndexAt4fdf60 / mainBranchCount) * Math.PI * 2 +
        0.4 * (seededNoise(mainBranchIndexAt4fdf60, 0, 900) - 0.5),
      mainBranchLength = canopyRadiusAt6160f6 * (0.6 + 0.35 * seededNoise(mainBranchIndexAt4fdf60, 0, 1e3)),
      targetBranchY = trunkHeight * (0.8 + 0.2 * seededNoise(mainBranchIndexAt4fdf60, 0, 1050)),
      mainBranchTargetX = Math.cos(mainBranchAzimuth) * mainBranchLength,
      mainBranchTargetZ = Math.sin(mainBranchAzimuth) * mainBranchLength;
    let mainBranchXAt1c5da0 = mainBranchStartPoint.x,
      mainBranchYAt40fdb7 = mainBranchStartPoint.y,
      mainBranchZAt60b8f0 = mainBranchStartPoint.z,
      mainBranchRadiusAt558439 = trunkRadius * (0.4 + 0.15 * seededNoise(mainBranchIndexAt4fdf60, 0, 1100));
    for (let mainBranchSegmentIndex = 0; mainBranchSegmentIndex < 3 && branchSegmentCount < 475; mainBranchSegmentIndex++) {
      const mainBranchSegmentT = (mainBranchSegmentIndex + 1) / 3,
        mainBranchArcHeight = Math.sin(mainBranchSegmentT * Math.PI) * canopyRadiusAt6160f6 * 0.3,
        mainBranchXJitter = 0.015 * (seededNoise(mainBranchIndexAt4fdf60, mainBranchSegmentIndex, 150) - 0.5),
        childBranchZJitter = 0.015 * (seededNoise(mainBranchIndexAt4fdf60, mainBranchSegmentIndex, 250) - 0.5),
        mainBranchXAt54680e =
          mainBranchStartPoint.x + (mainBranchTargetX - mainBranchStartPoint.x) * mainBranchSegmentT + mainBranchXJitter,
        mainBranchYAt33aa08 =
          mainBranchStartPoint.y +
          (targetBranchY - mainBranchStartPoint.y) * mainBranchSegmentT +
          mainBranchArcHeight * (1 - mainBranchSegmentT),
        mainBranchZAtfed78a =
          mainBranchStartPoint.z + (mainBranchTargetZ - mainBranchStartPoint.z) * mainBranchSegmentT + childBranchZJitter,
        mainBranchSegmentRadius =
          mainBranchRadiusAt558439 * (0.55 + 0.1 * seededNoise(mainBranchIndexAt4fdf60, mainBranchSegmentIndex, 350));
      (appendBranchSegment(
        mainBranchXAt1c5da0,
        mainBranchYAt40fdb7,
        mainBranchZAt60b8f0,
        mainBranchRadiusAt558439,
        mainBranchXAt54680e,
        mainBranchYAt33aa08,
        mainBranchZAtfed78a,
        mainBranchSegmentRadius,
        1,
        seededNoise(mainBranchIndexAt4fdf60, mainBranchSegmentIndex, 400),
      ),
        mainBranchSegmentIndex >= 1 &&
          branchSegmentCount < 470 &&
          createChildBranch(
            mainBranchXAt54680e,
            mainBranchYAt33aa08,
            mainBranchZAtfed78a,
            0.6 * mainBranchSegmentRadius,
            mainBranchXAt54680e +
              (seededNoise(mainBranchIndexAt4fdf60, mainBranchSegmentIndex, 610) - 0.5) * canopyRadiusAt6160f6 * 0.45,
            Math.max(
              Math.min(
                mainBranchYAt33aa08 +
                  canopyRadiusAt6160f6 *
                    (0.05 + 0.1 * seededNoise(mainBranchIndexAt4fdf60, mainBranchSegmentIndex, 620)),
                maximumBranchY,
              ),
              minimumBranchY,
            ),
            mainBranchZAtfed78a +
              (seededNoise(mainBranchIndexAt4fdf60, mainBranchSegmentIndex, 630) - 0.5) * canopyRadiusAt6160f6 * 0.45,
            0.25 * mainBranchSegmentRadius,
            mainBranchAzimuth,
            2,
          ),
        (mainBranchXAt1c5da0 = mainBranchXAt54680e),
        (mainBranchYAt40fdb7 = mainBranchYAt33aa08),
        (mainBranchZAt60b8f0 = mainBranchZAtfed78a),
        (mainBranchRadiusAt558439 = mainBranchSegmentRadius));
    }
    canopyTipsAt4b29cb.push({
      x: mainBranchXAt1c5da0,
      y: mainBranchYAt40fdb7,
      z: mainBranchZAt60b8f0,
      radius: 30 * mainBranchRadiusAt558439,
    });
  }
  return {
    segments: new Float32Array(branchSegmentValues),
    segmentCount: branchSegmentCount,
    tips: canopyTipsAt4b29cb,
  };
}

// Profile traced from the supplied reference: outer basin, plinth, lower cup,
// upper cup and finial. Values are relative to the QR grid, not model units.
function createFountainGeometry(gridSize) {
  const scale = gridSize * $ * FOUNTAIN_MODEL_SCALE;
  // Each independent profile is revolved separately. This keeps the cavities
  // of the three bowls open instead of joining them into one solid mound.
  const fountainProfiles = [
    // Vasca 1: parete esterna, labbro, interno concavo e fondo.
    [[0.0, 0.43], [0.012, 0.45], [0.10, 0.45], [0.12, 0.44], [0.09, 0.39], [0.055, 0.33], [0.045, 0.11]],
    // Piedistallo che nasce dal fondo della vasca 1.
    [[0.045, 0.11], [0.145, 0.18], [0.25, 0.16], [0.29, 0.09]],
    // Vasca 2: coppa distinta, larga ma bassa.
    [[0.29, 0.09], [0.315, 0.17], [0.338, 0.215], [0.35, 0.23], [0.365, 0.21], [0.35, 0.13], [0.335, 0.085]],
    // Colonna tra vasca 2 e vasca 3.
    [[0.335, 0.085], [0.46, 0.08], [0.49, 0.06]],
    // Vasca 3: coppa alta e più raccolta.
    [[0.49, 0.06], [0.51, 0.115], [0.53, 0.15], [0.545, 0.162], [0.56, 0.145], [0.545, 0.085], [0.535, 0.05]],
    // Colonna e pinnacolo / ugello superiore.
    [[0.535, 0.05], [0.67, 0.045], [0.72, 0.07], [0.77, 0.043], [0.81, 0.028], [0.86, 0.042], [0.91, 0.022]],
  ];
  const segments = [];
  let segmentIndex = 0;
  for (const profile of fountainProfiles) {
    for (let index = 0; index < profile.length - 1; index++, segmentIndex++) {
      const [startY, startRadius] = profile[index];
      const [endY, endRadius] = profile[index + 1];
      segments.push(
        0, startY * scale, 0, startRadius * scale,
        0, endY * scale, 0, endRadius * scale,
        segmentIndex, 0, 0, 0,
      );
    }
  }
  return { segments: new Float32Array(segments), segmentCount: segmentIndex, tips: [] };
}

function generateCanopyFlowers(canopyTipsAt30d94b, treeConfigAt35f9df) {
  const gridSizeAt35802f = treeConfigAt35f9df.gridSize,
    halfGridWorldSizeAt36d446 = gridSizeAt35802f * $ * 0.5,
    canopyFlowerValues = [];
  let canopyFlowerCountAt5db29d = 0;
  const maxCanopyFlowers = 1e5;
  function worldToQrCell(worldX, worldZ) {
    return {
      col: (worldX + halfGridWorldSizeAt36d446) / $,
      row: (worldZ + halfGridWorldSizeAt36d446) / $,
    };
  }
  function appendFlower(flowerColumn, flowerRow, flowerHeight, flowerVariation) {
    canopyFlowerCountAt5db29d >= maxCanopyFlowers ||
      (canopyFlowerValues.push(flowerColumn, flowerRow, flowerHeight, flowerVariation), canopyFlowerCountAt5db29d++);
  }
  for (let canopyTipIndexAt184843 = 0; canopyTipIndexAt184843 < canopyTipsAt30d94b.length; canopyTipIndexAt184843++) {
    const canopyTipAt3373e7 = canopyTipsAt30d94b[canopyTipIndexAt184843];
    if (seededNoise(canopyTipIndexAt184843, 0, 780) < 0.01) continue;
    const canopyTipDistance = Math.sqrt(
        canopyTipAt3373e7.x * canopyTipAt3373e7.x + canopyTipAt3373e7.z * canopyTipAt3373e7.z,
      ),
      canopyEdgeDensityFactor = 1 + 0.45 * (1 - Math.min(1, canopyTipDistance / (halfGridWorldSizeAt36d446 * CANOPY_RADIUS_RATIO))),
      canopyFlowerDensityFactor = (1 + 0.3 * seededNoise(canopyTipIndexAt184843, 3, 790)) * canopyEdgeDensityFactor,
      canopyFlowerCountAt41ada6 = Math.max(
        40,
        Math.floor(60 * canopyTipAt3373e7.radius * treeConfigAt35f9df.canopyDensity * canopyFlowerDensityFactor),
      ),
      canopyFlowerRadius = canopyTipAt3373e7.radius * $ * 9 * canopyFlowerDensityFactor;
    for (let canopyFlowerIndex = 0; canopyFlowerIndex < canopyFlowerCountAt41ada6; canopyFlowerIndex++) {
      const canopyFlowerVariation = seededNoise(canopyTipIndexAt184843, canopyFlowerIndex, 800),
        canopyFlowerAngleAt235fa8 = seededNoise(canopyTipIndexAt184843, canopyFlowerIndex, 810) * Math.PI * 2,
        canopyFlowerVerticalDirection = 2 * seededNoise(canopyTipIndexAt184843, canopyFlowerIndex, 820) - 1,
        canopyFlowerPlanarRadius = Math.sqrt(1 - canopyFlowerVerticalDirection * canopyFlowerVerticalDirection),
        canopyFlowerDistance =
          canopyFlowerRadius * Math.cbrt(seededNoise(canopyTipIndexAt184843, canopyFlowerIndex, 830)),
        canopyFlowerWorldX =
          canopyTipAt3373e7.x + canopyFlowerDistance * canopyFlowerPlanarRadius * Math.cos(canopyFlowerAngleAt235fa8) * 1.5,
        canopyFlowerHeightAt4ef0fb = canopyTipAt3373e7.y + canopyFlowerDistance * canopyFlowerVerticalDirection * 1.1 + 0.1 * canopyFlowerRadius,
        canopyFlowerCellAt31f8e6 = worldToQrCell(
          canopyFlowerWorldX,
          canopyTipAt3373e7.z + canopyFlowerDistance * canopyFlowerPlanarRadius * Math.sin(canopyFlowerAngleAt235fa8) * 1.5,
        );
      appendFlower(canopyFlowerCellAt31f8e6.col, canopyFlowerCellAt31f8e6.row, canopyFlowerHeightAt4ef0fb, canopyFlowerVariation);
    }
    const hangingFlowerCount = 6 + Math.floor(6 * seededNoise(canopyTipIndexAt184843, 0, 1500));
    for (let hangingFlowerIndex = 0; hangingFlowerIndex < hangingFlowerCount; hangingFlowerIndex++) {
      const hangingFlowerVariation = seededNoise(canopyTipIndexAt184843, hangingFlowerIndex, 1600),
        hangingFlowerAngle = seededNoise(canopyTipIndexAt184843, hangingFlowerIndex, 1700) * Math.PI * 2,
        hangingFlowerRadius = 0.5 * canopyFlowerRadius,
        hangingFlowerWorldX = canopyTipAt3373e7.x + Math.cos(hangingFlowerAngle) * hangingFlowerRadius,
        hangingFlowerWorldZ = canopyTipAt3373e7.z + Math.sin(hangingFlowerAngle) * hangingFlowerRadius,
        hangingFlowerHeight =
          canopyTipAt3373e7.y - q * (0.5 + 2 * seededNoise(canopyTipIndexAt184843, hangingFlowerIndex, 1900)),
        hangingFlowerCell = worldToQrCell(hangingFlowerWorldX, hangingFlowerWorldZ);
      appendFlower(hangingFlowerCell.col, hangingFlowerCell.row, hangingFlowerHeight, hangingFlowerVariation);
    }
    if (seededNoise(canopyTipIndexAt184843, 2, 900) < 0.5) {
      const canopyFlowerVariant = seededNoise(canopyTipIndexAt184843, 0, 910) + 1,
        canopyFlowerAngleAt5301ad = seededNoise(canopyTipIndexAt184843, 0, 920) * Math.PI * 2,
        canopyFlowerXAt29f800 = canopyTipAt3373e7.x + Math.cos(canopyFlowerAngleAt5301ad) * canopyFlowerRadius * 0.4,
        canopyFlowerWorldZAt9e84e0 = canopyTipAt3373e7.z + Math.sin(canopyFlowerAngleAt5301ad) * canopyFlowerRadius * 0.4,
        canopyFlowerHeightAt5ad4d2 = canopyTipAt3373e7.y - 0.01225,
        canopyFlowerCellAt4d80de = worldToQrCell(canopyFlowerXAt29f800, canopyFlowerWorldZAt9e84e0);
      appendFlower(canopyFlowerCellAt4d80de.col, canopyFlowerCellAt4d80de.row, canopyFlowerHeightAt5ad4d2, canopyFlowerVariant);
    }
  }
  if (canopyTipsAt30d94b.length > 0 && canopyFlowerCountAt5db29d < maxCanopyFlowers) {
    let highestCanopyY = -1 / 0;
    for (let canopyTipIndexAtb0003e = 0; canopyTipIndexAtb0003e < canopyTipsAt30d94b.length; canopyTipIndexAtb0003e++)
      canopyTipsAt30d94b[canopyTipIndexAtb0003e].y > highestCanopyY &&
        (highestCanopyY = canopyTipsAt30d94b[canopyTipIndexAtb0003e].y);
    const canopyTopFlowerCount = Math.floor(120 * Math.max(0.75, treeConfigAt35f9df.canopyDensity)),
      canopyTopFlowerRadius = halfGridWorldSizeAt36d446 * CANOPY_RADIUS_RATIO * 0.2,
      canopyTopY = highestCanopyY - 0.049;
    for (let canopyTopFlowerIndex = 0; canopyTopFlowerIndex < canopyTopFlowerCount; canopyTopFlowerIndex++) {
      const canopyTopFlowerAngle = seededNoise(canopyTopFlowerIndex, 0, 5100) * Math.PI * 2,
        canopyTopFlowerDistance = canopyTopFlowerRadius * Math.sqrt(seededNoise(canopyTopFlowerIndex, 0, 5200)),
        canopyFlowerXAt2e6c41 = Math.cos(canopyTopFlowerAngle) * canopyTopFlowerDistance,
        canopyTopFlowerWorldZ = Math.sin(canopyTopFlowerAngle) * canopyTopFlowerDistance,
        canopyTopFlowerHeight =
          canopyTopY + (seededNoise(canopyTopFlowerIndex, 0, 5300) - 0.35) * q * 8,
        canopyTopFlowerVariation = seededNoise(canopyTopFlowerIndex, 0, 5400),
        canopyTopFlowerCell = worldToQrCell(canopyFlowerXAt2e6c41, canopyTopFlowerWorldZ);
      appendFlower(canopyTopFlowerCell.col, canopyTopFlowerCell.row, canopyTopFlowerHeight, canopyTopFlowerVariation);
    }
  }
  const canopyRadiusAt1bab2b = gridSizeAt35802f * CANOPY_RADIUS_RATIO * $;
  for (let outerCanopyFlowerIndex = 0; outerCanopyFlowerIndex < 80; outerCanopyFlowerIndex++) {
    const outerFlowerAngle = seededNoise(outerCanopyFlowerIndex, 0, 4e3) * Math.PI * 2,
      canopyRadialRandom = seededNoise(outerCanopyFlowerIndex, 0, 4100),
      outerFlowerDistance = canopyRadiusAt1bab2b * (0.1 + canopyRadialRandom * canopyRadialRandom * 0.75),
      outerFlowerWorldX = Math.cos(outerFlowerAngle) * outerFlowerDistance,
      canopyFlowerWorldZAt245336 = Math.sin(outerFlowerAngle) * outerFlowerDistance,
      outerFlowerVariation = seededNoise(outerCanopyFlowerIndex, 0, 4200),
      outerFlowerCell = worldToQrCell(outerFlowerWorldX, canopyFlowerWorldZAt245336);
    appendFlower(outerFlowerCell.col, outerFlowerCell.row, 0.0294, outerFlowerVariation);
  }
  const canopyFlowerPositions = new Float32Array(4e5);
  return (
    canopyFlowerPositions.set(new Float32Array(canopyFlowerValues)),
    {
      positions: canopyFlowerPositions,
      count: canopyFlowerCountAt5db29d,
    }
  );
}

function generateQrFlowers(qrMatrixAt2c1df4) {
  const qrGridSizeAt4c9653 = qrMatrixAt2c1df4.length,
    qrCenterColumn = qrGridSizeAt4c9653 / 2,
    qrCenterRow = qrGridSizeAt4c9653 / 2,
    qrScale = qrGridSizeAt4c9653 / 29,
    qrFlowerBaseY = Math.round(12 * qrScale) * q,
    canopyRadiusCellsAt51b315 = qrGridSizeAt4c9653 * CANOPY_RADIUS_RATIO,
    qrFlowerValues = [];
  let qrFlowerCountAt27f743 = 0;
  const canopyRadiusSquaredAt563a2c = canopyRadiusCellsAt51b315 * canopyRadiusCellsAt51b315;
  for (let qrFlowerRowIndex = 0; qrFlowerRowIndex < qrGridSizeAt4c9653; qrFlowerRowIndex++)
    for (let qrFlowerColumnIndex = 0; qrFlowerColumnIndex < qrGridSizeAt4c9653; qrFlowerColumnIndex++) {
      const qrColumnOffset = qrFlowerColumnIndex - qrCenterColumn,
        qrRowOffset = qrFlowerRowIndex - qrCenterRow,
        qrDistanceSquared = qrColumnOffset * qrColumnOffset + qrRowOffset * qrRowOffset;
      if (qrDistanceSquared < canopyRadiusSquaredAt563a2c && qrDistanceSquared >= 6.25) {
        const canopyRadialFalloff = 1 - Math.sqrt(qrDistanceSquared) / canopyRadiusCellsAt51b315,
          baseQrFlowerLayerCount = Math.round(18 * qrScale),
          qrFlowerLayerCount =
            Math.max(
              4,
              Math.round(baseQrFlowerLayerCount * (0.25 + 0.75 * canopyRadialFalloff * canopyRadialFalloff)),
            ) + Math.floor(6 * noise(qrFlowerColumnIndex, qrFlowerRowIndex, 500) * qrScale),
          qrFlowerHeightOffset = Math.floor(4.5 * canopyRadialFalloff * qrScale) * q,
          qrFlowerBaseHeight = qrFlowerBaseY + (qrFlowerLayerCount - 1) * q + qrFlowerHeightOffset + q,
          qrFlowersPerCell = 4 + Math.floor(3 * noise(qrFlowerColumnIndex, qrFlowerRowIndex, 600));
        for (let qrFlowerIndex = 0; qrFlowerIndex < qrFlowersPerCell; qrFlowerIndex++) {
          const qrFlowerVariation = noise(qrFlowerColumnIndex, qrFlowerRowIndex, 777 + qrFlowerIndex),
            qrFlowerColumnJitter =
              1.2 * (noise(qrFlowerColumnIndex, qrFlowerRowIndex, 800 + qrFlowerIndex) - 0.5),
            qrFlowerRowJitterAt49e756 =
              1.2 * (noise(qrFlowerColumnIndex, qrFlowerRowIndex, 900 + qrFlowerIndex) - 0.5),
            qrFlowerHeightJitter =
              (noise(qrFlowerColumnIndex, qrFlowerRowIndex, 1e3 + qrFlowerIndex) - 0.6) * q * 2;
          (qrFlowerValues.push(
            qrFlowerColumnIndex + qrFlowerColumnJitter,
            qrFlowerRowIndex + qrFlowerRowJitterAt49e756,
            qrFlowerBaseHeight + qrFlowerHeightJitter,
            qrFlowerVariation,
          ),
            qrFlowerCountAt27f743++);
        }
        if (noise(qrFlowerColumnIndex, qrFlowerRowIndex, 1100) < 0.35) {
          const qrFlowerVariant = noise(qrFlowerColumnIndex, qrFlowerRowIndex, 1200) + 1,
            qrFlowerXJitter = 0.5 * (noise(qrFlowerColumnIndex, qrFlowerRowIndex, 1300) - 0.5),
            qrFlowerRowJitterAt46b429 = 0.5 * (noise(qrFlowerColumnIndex, qrFlowerRowIndex, 1400) - 0.5);
          (qrFlowerValues.push(
            qrFlowerColumnIndex + qrFlowerXJitter,
            qrFlowerRowIndex + qrFlowerRowJitterAt46b429,
            qrFlowerBaseHeight - 0.0245,
            qrFlowerVariant,
          ),
            qrFlowerCountAt27f743++);
        }
      }
    }
  return {
    positions: qrFlowerValues,
    count: qrFlowerCountAt27f743,
  };
}

function generateLegacyGrass(grassGridSize, qrMatrixAt484328) {
  const grassVertexValues = [];
  let grassBladeCount = 0;
  const grassCenterColumn = grassGridSize / 2,
    grassCenterRow = grassGridSize / 2,
    canopyRadiusCellsAt495ceb = grassGridSize * CANOPY_RADIUS_RATIO,
    canopyRadiusSquaredAta70fe9 = canopyRadiusCellsAt495ceb * canopyRadiusCellsAt495ceb;
  for (let grassRowIndex = 0; grassRowIndex < grassGridSize; grassRowIndex++)
    for (
      let grassColumnIndex = 0;
      grassColumnIndex < grassGridSize && grassBladeCount < 5e4;
      grassColumnIndex++
    ) {
      const grassColumnOffset = grassColumnIndex - grassCenterColumn,
        grassRowOffset = grassRowIndex - grassCenterRow,
        grassDistanceSquared = grassColumnOffset * grassColumnOffset + grassRowOffset * grassRowOffset;
      if (grassDistanceSquared < 25) continue;
      if (!qrMatrixAt484328?.[grassRowIndex]?.[grassColumnIndex]) continue;
      if (grassDistanceSquared < canopyRadiusSquaredAta70fe9) continue;
      const grassBladesPerCell = 14 + Math.floor(8 * noise(grassColumnIndex, grassRowIndex, 5100));
      for (
        let grassBladeIndex = 0;
        grassBladeIndex < grassBladesPerCell && grassBladeCount < 5e4;
        grassBladeIndex++
      ) {
        const grassBladeVariation = noise(grassColumnIndex, grassRowIndex, 5200 + grassBladeIndex),
          grassColumnJitter =
            0.85 * (noise(grassColumnIndex, grassRowIndex, 5300 + grassBladeIndex) - 0.5),
          grassRowJitter =
            0.85 * (noise(grassColumnIndex, grassRowIndex, 5400 + grassBladeIndex) - 0.5),
          grassBladeHeight =
            $ * (0.5 + 1.2 * noise(grassColumnIndex, grassRowIndex, 5500 + grassBladeIndex));
        (grassVertexValues.push(
          grassColumnIndex + grassColumnJitter,
          grassRowIndex + grassRowJitter,
          grassBladeVariation,
          grassBladeHeight,
        ),
          grassBladeCount++);
      }
    }
  const grassPositions = new Float32Array(2e5);
  return (
    grassPositions.set(new Float32Array(grassVertexValues)),
    {
      positions: grassPositions,
      count: grassBladeCount,
    }
  );
}

function generateFallingPetals(canopyTipsAt5136b8, gridSizeAt5db166, fallingPetalLimit = 10) {
  const halfGridWorldSizeAt563a89 = gridSizeAt5db166 * $ * 0.5,
    fallingPetalValues = [];
  let fallingPetalCount = 0;
  if (0 === canopyTipsAt5136b8.length)
    return {
      positions: new Float32Array(4 * fallingPetalLimit),
      count: 0,
    };
  for (let fallingPetalIndex = 0; fallingPetalIndex < fallingPetalLimit; fallingPetalIndex++) {
    const canopyTipAtbca67b =
        canopyTipsAt5136b8[
          Math.floor(seededNoise(fallingPetalIndex, 0, 5e3) * canopyTipsAt5136b8.length) %
            canopyTipsAt5136b8.length
        ],
      fallingPetalSeed = seededNoise(fallingPetalIndex, 0, 5100),
      fallingPetalAngle = seededNoise(fallingPetalIndex, 0, 5200) * Math.PI * 2,
      fallingPetalRadius = canopyTipAtbca67b.radius * $ * 1.5 * seededNoise(fallingPetalIndex, 0, 5300),
      fallingPetalWorldX = canopyTipAtbca67b.x + Math.cos(fallingPetalAngle) * fallingPetalRadius,
      fallingPetalWorldZ = canopyTipAtbca67b.z + Math.sin(fallingPetalAngle) * fallingPetalRadius,
      fallingPetalHeight = canopyTipAtbca67b.y + q * (0.5 + 1 * seededNoise(fallingPetalIndex, 0, 5400)),
      fallingPetalColumn = (fallingPetalWorldX + halfGridWorldSizeAt563a89) / $,
      fallingPetalRow = (fallingPetalWorldZ + halfGridWorldSizeAt563a89) / $;
    (fallingPetalValues.push(fallingPetalColumn, fallingPetalRow, fallingPetalHeight, fallingPetalSeed), fallingPetalCount++);
  }
  const fallingPetalPositions = new Float32Array(4 * fallingPetalLimit);
  return (
    fallingPetalPositions.set(new Float32Array(fallingPetalValues)),
    {
      positions: fallingPetalPositions,
      count: fallingPetalCount,
    }
  );
}

function generateRain(rainGridSize) {
  const rainParticleValues = new Float32Array(2e3);
  for (let rainParticleIndex = 0; rainParticleIndex < 500; rainParticleIndex++) {
    // Use the same cloud centers and extents as the autumn cloud shader, so
    // every streak starts underneath an actual cloud instead of in open sky.
    const cloudPart = rainParticleIndex % 120,
      cloudSeed = cloudPart * 17.31,
      cloudColumn = cloudPart % 13,
      columnT = cloudColumn / 12,
      edgeDistance = Math.min(columnT, 1 - columnT),
      spreadX =
        -1 +
        2 * columnT +
        (Math.sin(cloudSeed) * 43758.5 - Math.floor(Math.sin(cloudSeed) * 43758.5) - .5) *
          Math.min(.055, edgeDistance * .22),
      spreadZ =
        Math.sin(cloudSeed * 1.71 + 4.2) * 43758.5 -
        Math.floor(Math.sin(cloudSeed * 1.71 + 4.2) * 43758.5),
      widthSeed =
        Math.sin(cloudSeed * 3.11 + 2.4) * 43758.5 -
        Math.floor(Math.sin(cloudSeed * 3.11 + 2.4) * 43758.5),
      depthSeed =
        Math.sin(cloudSeed * 7.07 + 8.6) * 43758.5 -
        Math.floor(Math.sin(cloudSeed * 7.07 + 8.6) * 43758.5),
      rainWorldX = Math.max(
        0,
        Math.min(
          rainGridSize,
          (spreadX * .5 + .5) * rainGridSize +
            (seededNoise(rainParticleIndex, 0, 8e3) - .5) * (2.3 + widthSeed * 4.2),
        ),
      ),
      rainWorldZ = Math.max(
        rainGridSize * .5,
        Math.min(
          rainGridSize,
          (spreadZ * .5 + .5) * rainGridSize +
            (seededNoise(rainParticleIndex, 0, 8100) - .5) * (1.5 + depthSeed * 2.6),
        ),
      ),
      rainParticleSpeed = seededNoise(rainParticleIndex, 0, 8200),
      rainParticleSeed = seededNoise(rainParticleIndex, 0, 8300);
    ((rainParticleValues[4 * rainParticleIndex] = rainWorldX),
      (rainParticleValues[4 * rainParticleIndex + 1] = rainWorldZ),
      (rainParticleValues[4 * rainParticleIndex + 2] = rainParticleSpeed),
      (rainParticleValues[4 * rainParticleIndex + 3] = rainParticleSeed));
  }
  return {
    positions: rainParticleValues,
    count: 500,
  };
}

function generateFountainWater(gridSize) {
  const streams = new Float32Array(99 * 4);
  const tiers = [
    [0, 0.23, 36], // vasca 2 rim to vasca 1 water
    [1, 0.162, 28], // vasca 3 rim to vasca 2 water
    [2, 0.055, 6], // six distinct arcs from the crown to the upper cup
  ];
  let streamIndex = 0;
  for (const [tier, radiusRatio, streamCount] of tiers) {
    for (let stream = 0; stream < streamCount; streamIndex++, stream++) {
      const seed = seededNoise(streamIndex, tier, 12000);
      streams.set([
        tier,
        radiusRatio * gridSize,
        (stream + (seed - 0.5) * 0.72) / streamCount,
        seed,
      ], streamIndex * 4);
    }
  }
  // Stationary water surfaces for the basin and the two cups.
  for (const [surfaceType, radiusRatio, heightRatio] of [[3, 0.36, 0.105], [4, 0.205, 0.358], [5, 0.14, 0.553]]) {
    streams.set([surfaceType, radiusRatio * gridSize, heightRatio, 0], streamIndex * 4);
    streamIndex++;
  }
  return { positions: streams, count: streamIndex };
}

const KOI_VERTICES_PER_FISH = 39;
const AUTUMN_RIPPLE_VERTICES = 144;
// Beach decorations are deliberately tiny and independent of QR modules.
const BEACH_SHELL_COUNT = 8;
const BEACH_SHELL_VERTICES = 18;
const BEACH_STAR_VERTICES = 30;
const BEACH_FISH_COUNT = 3;
const BEACH_FISH_VERTICES = 36;
const BEACH_SPRING_CRAB_VERTICES = 0;
const BEACH_SPRING_KITE_VERTICES = 18;
const BEACH_AUTUMN_CLOUD_VERTICES = 120 * 576;
const BEACH_AUTUMN_BUCKET_FISH_VERTICES = 2 * 36;
const BEACH_SPRING_SURFBOARD_VERTICES = 288 + BEACH_AUTUMN_CLOUD_VERTICES + BEACH_AUTUMN_BUCKET_FISH_VERTICES;
const BEACH_AUTUMN_FLOAT_VERTICES = 1452;
const BEACH_SUMMER_UMBRELLA_VERTICES = 294;
// These counts deliberately keep the beach assets faceted but recognisable.
// They are rebuilt from the supplied kit's silhouettes, not texture planes.
// Keep the proven summer geometry active until the imported mesh pass has
// been visually validated.  These counts also preserve the draw offsets of
// bucket, shovel, lifebuoy and ball.
const BEACH_SUMMER_LOUNGER_VERTICES = 864;
const BEACH_SUMMER_CASTLE_VERTICES = 450;
const BEACH_SUMMER_BUCKET_VERTICES = 336;
const BEACH_SUMMER_SHOVEL_VERTICES = 12;
const BEACH_SUMMER_LIFEBUOY_VERTICES = 1440;
const BEACH_SUMMER_BALL_VERTICES = 576;
const BEACH_SUMMER_GROUNDED_TOY_VERTICES = BEACH_SUMMER_CASTLE_VERTICES + BEACH_SUMMER_BUCKET_VERTICES + BEACH_SUMMER_SHOVEL_VERTICES;
const BEACH_SUMMER_TOY_VERTICES = BEACH_SUMMER_GROUNDED_TOY_VERTICES + BEACH_SUMMER_LIFEBUOY_VERTICES + BEACH_SUMMER_BALL_VERTICES;
const BEACH_DECOR_VERTEX_COUNT = BEACH_SHELL_COUNT * BEACH_SHELL_VERTICES + BEACH_STAR_VERTICES + BEACH_FISH_COUNT * BEACH_FISH_VERTICES + BEACH_SPRING_CRAB_VERTICES + BEACH_SPRING_KITE_VERTICES + BEACH_SPRING_SURFBOARD_VERTICES + BEACH_SUMMER_UMBRELLA_VERTICES + BEACH_SUMMER_LOUNGER_VERTICES + BEACH_SUMMER_TOY_VERTICES + BEACH_AUTUMN_FLOAT_VERTICES;
const BEACH_STATIC_DECOR_VERTEX_COUNT = BEACH_DECOR_VERTEX_COUNT - BEACH_SPRING_KITE_VERTICES - BEACH_SPRING_SURFBOARD_VERTICES - BEACH_SUMMER_UMBRELLA_VERTICES - BEACH_SUMMER_LOUNGER_VERTICES - BEACH_SUMMER_TOY_VERTICES - BEACH_AUTUMN_FLOAT_VERTICES;
const BEACH_LIFEBUOY_VERTEX_START = BEACH_STATIC_DECOR_VERTEX_COUNT + BEACH_SPRING_KITE_VERTICES + BEACH_SPRING_SURFBOARD_VERTICES + BEACH_SUMMER_UMBRELLA_VERTICES + BEACH_SUMMER_LOUNGER_VERTICES + BEACH_SUMMER_GROUNDED_TOY_VERTICES;
const BEACH_BALL_VERTEX_START = BEACH_LIFEBUOY_VERTEX_START + BEACH_SUMMER_LIFEBUOY_VERTICES;

function generateKoi(gridSize) {
  // radius (QR modules), signed angular velocity, scale, initial phase.
  const koi = new Float32Array([
    gridSize * 0.23, 0.16, 0.945, 0.15,
    gridSize * 0.17, 0.11, 0.738, 0.56,
    gridSize * 0.29, -0.09, 0.828, 0.84,
  ]);
  return { positions: koi, count: 3 };
}

function generateSpringButterflies(gridSize) {
  return generateButterflies(gridSize);
}

function generateAutumnWaterLeaves(gridSize) {
  const leafCount = 18;
  const fountainScale = gridSize * $ * FOUNTAIN_MODEL_SCALE;
  const positions = new Float32Array(leafCount * 4);
  for (let index = 0; index < leafCount; index++) {
    const seed = seededNoise(index, 0, 16000);
    const angle = seed * Math.PI * 2;
    const radius = gridSize * (0.10 + seededNoise(index, 1, 16001) * 0.20);
    positions.set([
      gridSize * 0.5 + Math.cos(angle) * radius,
      gridSize * 0.5 + Math.sin(angle) * radius,
      fountainScale * (0.48 + seededNoise(index, 2, 16002) * 0.24),
      seed,
    ], index * 4);
  }
  return { positions, count: leafCount };
}

function generateButterflies(autumnCloudData) {
  const autumnCloudRadius = 0.46 * autumnCloudData,
    autumnCloudValuesAt4a0282 = new Float32Array(40);
  for (let autumnCloudIndex = 0; autumnCloudIndex < 10; autumnCloudIndex++) {
    const autumnCloudX =
        autumnCloudRadius * (0.35 + 0.55 * seededNoise(autumnCloudIndex, 0, 9e3)),
      autumnCloudY = 0.25 + 0.3 * seededNoise(autumnCloudIndex, 0, 9100),
      autumnCloudHeight = 4 + 9 * seededNoise(autumnCloudIndex, 0, 9200),
      autumnCloudSeed = seededNoise(autumnCloudIndex, 0, 9300);
    ((autumnCloudValuesAt4a0282[4 * autumnCloudIndex] = autumnCloudX),
      (autumnCloudValuesAt4a0282[4 * autumnCloudIndex + 1] = autumnCloudY),
      (autumnCloudValuesAt4a0282[4 * autumnCloudIndex + 2] = autumnCloudHeight),
      (autumnCloudValuesAt4a0282[4 * autumnCloudIndex + 3] = autumnCloudSeed));
  }
  return {
    positions: autumnCloudValuesAt4a0282,
    count: 10,
  };
}

 const WGSL_BLOCK_SIZE = "0.0245";
const FOUNTAIN_MODEL_SCALE = 0.90;
const FOUNTAIN_WATER_VERTICES_PER_ELEMENT = 120;
const FOUNTAIN_QR_WATER_COLOR = [0.32, 0.62, 0.82];
// Simplified from experience_the_tranquility_of_the_seaside.glb: five water
// planes animated through 15 morph targets over a 0.5 second loop.
const BEACH_WATER_COLUMNS = 32;
const BEACH_WATER_ROWS = 22;
const BEACH_SAND_COLUMNS = 32;
const BEACH_SAND_ROWS = 18;
const BEACH_WATER_VERTEX_COUNT = BEACH_WATER_COLUMNS * BEACH_WATER_ROWS * 6;
const BEACH_SAND_VERTEX_COUNT = BEACH_SAND_COLUMNS * BEACH_SAND_ROWS * 6;
// L2 and L3 are the two exposed cut faces of the beach diorama.
const BEACH_WALL_SEGMENTS = 32;
const BEACH_WALL_VERTEX_COUNT = BEACH_WALL_SEGMENTS * 2 * 6;
const WGSL_ACES_FILM = `
fn acesFilm(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
`;
function uploadSceneData(renderer, voxelBlocks, fountainGeometry, canopyFlowers, qrFlowerPositions, qrFlowerCount, pebbleData, fallingPetals, fountainWater, koi, butterflies, autumnWaterLeaves) {
  const { device, buffers, counts } = renderer;
  device.queue.writeBuffer(buffers.typeBuffer, 0, voxelBlocks.types);
  device.queue.writeBuffer(buffers.posBuffer, 0, voxelBlocks.positions);
  device.queue.writeBuffer(buffers.heightBuffer, 0, voxelBlocks.heights);
  device.queue.writeBuffer(buffers.baseYBuffer, 0, voxelBlocks.baseY);
  counts.numBlocks = voxelBlocks.numBlocks;
  counts.gridSize = voxelBlocks.gridSize;

  const fountainProfileUpload = renderer._fountainProfileUpload;
  fountainProfileUpload.fill(0);
  fountainProfileUpload.set(fountainGeometry.segments);
  device.queue.writeBuffer(buffers.fountainProfileBuffer, 0, fountainProfileUpload);
  counts.fountainBandCount = fountainGeometry.segmentCount;

  const totalFlowerCount = canopyFlowers.count + qrFlowerCount;
  const flowerUpload = renderer._flowerUpload;
  flowerUpload.fill(0);
  flowerUpload.set(canopyFlowers.positions);
  flowerUpload.set(qrFlowerPositions, 4 * canopyFlowers.count);
  device.queue.writeBuffer(buffers.flowerBuffer, 0, flowerUpload);
  counts.flowerCount = totalFlowerCount;
  flowerUpload.fill(0);
  flowerUpload.set(autumnWaterLeaves.positions);
  device.queue.writeBuffer(buffers.flowerBuffer, 0, flowerUpload);
  counts.autumnLeafCount = autumnWaterLeaves.count;

  device.queue.writeBuffer(buffers.pebbleBuffer, 0, pebbleData.positions);
  counts.pebbleCount = pebbleData.count;

  const fallingPetalUpload = renderer._petalUpload;
  fallingPetalUpload.fill(0);
  fallingPetalUpload.set(fallingPetals.positions);
  device.queue.writeBuffer(buffers.fallingPetalBuffer, 0, fallingPetalUpload);
  counts.petalCount = fallingPetals.count;

  if (fountainWater) {
    const fountainWaterUpload = renderer._rainUpload;
    fountainWaterUpload.fill(0);
    fountainWaterUpload.set(fountainWater.positions);
    device.queue.writeBuffer(buffers.rainBuffer, 0, fountainWaterUpload);
    counts.fountainWaterCount = fountainWater.count;
  }
  if (koi) {
    const butterflyUpload = renderer._butterflyUpload;
    butterflyUpload.fill(0);
    butterflyUpload.set(koi.positions);
    device.queue.writeBuffer(buffers.butterflyBuffer, 0, butterflyUpload);
    counts.koiCount = koi.count;
  }
  if (butterflies) {
    const butterflyUpload = renderer._springButterflyUpload;
    butterflyUpload.fill(0);
    butterflyUpload.set(butterflies.positions);
    device.queue.writeBuffer(buffers.springButterflyBuffer, 0, butterflyUpload);
    counts.butterflyCount = butterflies.count;
  }
}

function drawBeachModels(pass, renderer, sceneState) {
  const { beachModels, device, pipelines } = renderer;
  if (!beachModels?.length || !pipelines.beachModels) return;
  const halfPlane = renderer.counts.gridSize * q * .5;
  const loop = (sceneState.time * .030 + .18) % 1;
  const towardL2 = loop < .5;
  const travel = towardL2 ? loop * 2 : (1 - loop) * 2;
  const crab = beachModels[0];
  crab.uniformValues[0] = (-.62 + 1.20 * travel) * halfPlane;
  crab.uniformValues[2] = -.42 * halfPlane + (Math.sin(sceneState.time * .31) + Math.sin(sceneState.time * .13 + 1.7) * .60) * q * 1.8;
  crab.uniformValues[4] = towardL2 ? Math.PI * .5 : -Math.PI * .5;
  const castle = beachModels[1];
  castle.uniformValues[0] = -.82 * halfPlane;
  castle.uniformValues[2] = -.72 * halfPlane;
  const lounger = beachModels[2];
  lounger.uniformValues[0] = -.12 * halfPlane + q * 3;
  lounger.uniformValues[2] = -.54 * halfPlane;
  const rodA = beachModels[3];
  rodA.uniformValues[0] = -.28 * halfPlane;
  rodA.uniformValues[2] = -.12 * halfPlane;
  rodA.uniformValues[4] = -.32;
  const rodB = beachModels[4];
  rodB.uniformValues[0] = .08 * halfPlane;
  rodB.uniformValues[2] = -.12 * halfPlane;
  rodB.uniformValues[4] = .32;
  pass.setPipeline(pipelines.beachModels);
  // Castle and lounger stay on their established summer pass for now: it
  // owns their exact silhouette and their original draw ordering.
  for (const model of [beachModels[0], beachModels[3], beachModels[4]]) {
    if (!model) continue;
    device.queue.writeBuffer(model.uniformBuffer, 0, model.uniformValues);
    pass.setBindGroup(0, model.bindGroup);
    pass.setVertexBuffer(0, model.vertexBuffer);
    pass.setIndexBuffer(model.indexBuffer, model.indexFormat);
    pass.drawIndexed(model.indexCount);
  }
}

function drawBeachScene(renderer, sceneState) {
  renderer.qrScene = BEACH_QR_APPEARANCE;
  const {
      buffers,
      pipelines,
      bindGroups,
      counts,
    } = renderer;

  // Keep the QR material palette stable: station/season controls belong to
  // the inherited tree experience, not to this fountain scene.
  const beachMode = globalThis.__ICQR_BEACH_MODE__ === true;
  renderer.uniformDefaults ??= {
    season: 0,
    customR: FOUNTAIN_QR_WATER_COLOR[0], customG: FOUNTAIN_QR_WATER_COLOR[1], customB: FOUNTAIN_QR_WATER_COLOR[2], customStrength: 1,
    beachSeason: 0,
  };
  renderer.uniformDefaults.beachSeason = beachMode ? sceneState.season : 0;
  renderer.uniformTargets ??= [
    { buffer: buffers.blockUniforms, count: "numBlocks" },
    { buffer: buffers.fountainUniforms, count: "fountainBandCount" },
    { buffer: buffers.pebbleUniforms, count: "pebbleCount" },
    { buffer: buffers.petalUniforms, count: "petalCount" },
    { buffer: buffers.rainUniforms, count: "fountainWaterCount" },
    { buffer: buffers.butterflyUniforms, count: "koiCount" },
    { buffer: buffers.springButterflyUniforms, count: "butterflyCount", overrides: { season: 1 } },
    { buffer: buffers.autumnLeafUniforms, count: "autumnLeafCount", overrides: { season: 2, customStrength: 0 } },
  ];
  renderer.uniformTargets[4].count = beachMode ? "rainCount" : "fountainWaterCount";
  writeSceneUniforms(renderer, sceneState, renderer.uniformTargets);

  const qrOnlyMode = globalThis.__ICQR_QR_ONLY__ === true;
  renderSceneFrame(renderer, sceneState, { qrPlacement: beachMode ? "before" : "after", blur: true, draw(mainRenderPass) {

  if (!qrOnlyMode && !renderer.gpuSurface.transparent) {
    mainRenderPass.setPipeline(pipelines.sky);
    mainRenderPass.setBindGroup(0, bindGroups.sky);
    mainRenderPass.draw(3);
  }
  if (!qrOnlyMode) {
    mainRenderPass.setPipeline(pipelines.shadow);
    mainRenderPass.setBindGroup(0, bindGroups.shadow);
    mainRenderPass.draw(6);
  }

  if (beachMode && pipelines.beach) {
    mainRenderPass.setPipeline(pipelines.beach);
    mainRenderPass.setBindGroup(0, bindGroups.beach);
    // Sand first, fixed decorations next, then transparent water over them.
    mainRenderPass.draw(BEACH_SAND_VERTEX_COUNT + BEACH_WALL_VERTEX_COUNT, 1, BEACH_WATER_VERTEX_COUNT);
    if (pipelines.beachDecor) {
      mainRenderPass.setPipeline(pipelines.beachDecor);
      mainRenderPass.setBindGroup(0, bindGroups.beachDecor);
      mainRenderPass.draw(BEACH_STATIC_DECOR_VERTEX_COUNT);
    }
    mainRenderPass.setPipeline(pipelines.beachWater);
    mainRenderPass.setBindGroup(0, bindGroups.beachWater);
    mainRenderPass.draw(BEACH_WATER_VERTEX_COUNT);
    drawBeachModels(mainRenderPass, renderer, sceneState);
    // The kite is airborne: draw it last so transparent water never tints it.
    if (pipelines.beachDecor) {
      mainRenderPass.setPipeline(pipelines.beachDecor);
      mainRenderPass.setBindGroup(0, bindGroups.beachDecor);
      mainRenderPass.draw(BEACH_SPRING_KITE_VERTICES + BEACH_SPRING_SURFBOARD_VERTICES + BEACH_SUMMER_UMBRELLA_VERTICES + BEACH_SUMMER_LOUNGER_VERTICES + BEACH_SUMMER_GROUNDED_TOY_VERTICES + BEACH_SUMMER_LIFEBUOY_VERTICES, 1, BEACH_STATIC_DECOR_VERTEX_COUNT);
      mainRenderPass.draw(BEACH_SUMMER_BALL_VERTICES, 1, BEACH_BALL_VERTEX_START);
      mainRenderPass.draw(BEACH_AUTUMN_FLOAT_VERTICES, 1, BEACH_BALL_VERTEX_START + BEACH_SUMMER_BALL_VERTICES);
    }
  }
  if (beachMode && sceneState.rainMode > 0.01 && counts.rainCount > 0 && pipelines.rain) {
    mainRenderPass.setPipeline(pipelines.rain);
    mainRenderPass.setBindGroup(0, bindGroups.rain);
    mainRenderPass.draw(6 * counts.rainCount);
  }

  if (!qrOnlyMode && counts.pebbleCount > 0 && pipelines.pebbles) {
    mainRenderPass.setPipeline(pipelines.pebbles);
    mainRenderPass.setBindGroup(0, bindGroups.pebbles);
    mainRenderPass.draw(54 * counts.pebbleCount);
  }
  if (!qrOnlyMode && counts.fountainBandCount > 0 && pipelines.fountain) {
    mainRenderPass.setPipeline(pipelines.fountain);
    mainRenderPass.setBindGroup(0, bindGroups.fountain);
    mainRenderPass.draw(96 * counts.fountainBandCount);
  }
  // The fountain scene has no tree canopy or falling-petal layer.  The
  // inherited flower buffers remain allocated, but are intentionally never
  // rendered here so stale GPU data cannot appear inside the basins.
  if (!qrOnlyMode && counts.fountainWaterCount > 0 && pipelines.fountainWater && sceneState.rainMode > 0.01) {
    mainRenderPass.setPipeline(pipelines.fountainWater);
    mainRenderPass.setBindGroup(0, bindGroups.fountainWater);
    mainRenderPass.draw(FOUNTAIN_WATER_VERTICES_PER_ELEMENT * counts.fountainWaterCount);
  }
  if (!qrOnlyMode && counts.koiCount > 0 && pipelines.koi) {
    mainRenderPass.setPipeline(pipelines.koi);
    mainRenderPass.setBindGroup(0, bindGroups.koi);
    mainRenderPass.draw(KOI_VERTICES_PER_FISH * counts.koiCount);
  }
  if (!qrOnlyMode && sceneState.season < 0.5 && counts.butterflyCount > 0 && pipelines.butterflies) {
    mainRenderPass.setPipeline(pipelines.butterflies);
    mainRenderPass.setBindGroup(0, bindGroups.butterflies);
    mainRenderPass.draw(6 * counts.butterflyCount);
  }
  if (!qrOnlyMode && sceneState.season > 1.5 && counts.autumnLeafCount > 0) {
    if (pipelines.autumnRipples) {
      mainRenderPass.setPipeline(pipelines.autumnRipples);
      mainRenderPass.setBindGroup(0, bindGroups.autumnLeaves);
      mainRenderPass.draw(AUTUMN_RIPPLE_VERTICES * counts.autumnLeafCount);
    }
    mainRenderPass.setPipeline(pipelines.fallingPetals);
    mainRenderPass.setBindGroup(0, bindGroups.autumnLeaves);
    mainRenderPass.draw(150 * counts.autumnLeafCount);
  }
  }});
}

function hashSeed(seedText) {
  let hashValue = 0;
  for (let hashCharacterIndex = 0; hashCharacterIndex < seedText.length; hashCharacterIndex++)
    hashValue = (Math.imul(31, hashValue) + seedText.charCodeAt(hashCharacterIndex)) | 0;
  return (Math.abs(hashValue) % 99991) + 1;
}
function buildQrMatrix(content) { return encodeQrMatrix(content); }

function setupBeachRuntime(runtime) {
  const { canvasRef, canvasWidth, canvasHeight, qrContent, isFlat, seasonRef, customColorRef, treeSeed, gpuSurface, qrRenderer, runSetup } = runtime;
  const beachYawRef = { current:0 }, beachDragRef = { current:false };
    (function (rendererOptions) {
      const {
          canvasRef: canvasRef,
          canvasWidth: canvasWidth,
          canvasHeight: canvasHeightAt41144e,
          qrContent: qrContentAt2d7f10,
          isFlat: isFlat,
          seasonRef: seasonRef,
          customColorRef: customColorRef,
          treeSeed: treeSeedRef,
          qrSnapshotRef: qrSnapshotRef,
          onFlatSettled: onFlatSettled,
          onQrSnapshotUpdated: onQrSnapshotUpdated,
          beachYawRef,
          beachDragRef,
        } = rendererOptions,
        frameLoopRef = createRef(null),
        rendererInitializing = createRef(!1),
        rendererCanvasRef = createRef(null),
        sceneStartTime = createRef(Date.now()),
        rendererRef = createRef(null),
        rendererGenerationRef = createRef(0),
        flatProgressRefAt3efc2e = createRef(0),
        flatProgressRefAt5e63cf = createRef(0),
        previousFrameTime = createRef(Date.now()),
        qrContentRef = createRef(qrContentAt2d7f10);
      qrContentRef.current = qrContentAt2d7f10;
      const previousQrContentRef = createRef(qrContentAt2d7f10),
        previousSeasonRef = createRef(0),
        qrMatrixRef = createRef(null),
        qrAnalysisRef = createRef(null),
        treeGridSizeRef = createRef(0),
        trunkSeed = (hashSeed(treeSeedRef.current) - 1) / 99990,
        burstStartTime = createRef(0),
        previousFlatState = createRef(!1),
        rainTransition = createRef(0);
      runSetup(() => {
        const renderer = rendererRef.current;
        if (!renderer) return;
        const qrMatrixAt1db22b = buildQrMatrix(qrContentAt2d7f10),
          voxelBlocksAt311b94 = createFountainVoxelBlocks(qrMatrixAt1db22b),
          qrAnalysisAte480db = analyzeQrMatrix(qrMatrixAt1db22b);
        ((qrMatrixRef.current = qrMatrixAt1db22b),
          (qrAnalysisRef.current = qrAnalysisAte480db),
          (treeGridSizeRef.current = voxelBlocksAt311b94.gridSize),
          setNoiseSeed(hashSeed(treeSeedRef.current)));
        const fountainGeometry = createFountainGeometry(voxelBlocksAt311b94.gridSize),
          emptyFountainFlowers = generateCanopyFlowers([], qrAnalysisAte480db),
          emptyQrFlowers = { positions: new Float32Array(0), count: 0 },
          pebbleData = generatePebbleData(qrMatrixAt1db22b),
          emptyFallingPetals = generateFallingPetals([], voxelBlocksAt311b94.gridSize),
          fountainWater = generateFountainWater(voxelBlocksAt311b94.gridSize),
          koi = generateKoi(voxelBlocksAt311b94.gridSize),
          springButterflies = generateSpringButterflies(voxelBlocksAt311b94.gridSize),
          autumnWaterLeaves = generateAutumnWaterLeaves(voxelBlocksAt311b94.gridSize);
        (uploadSceneData(
          renderer,
          voxelBlocksAt311b94,
          fountainGeometry,
          emptyFountainFlowers,
          emptyQrFlowers.positions,
          emptyQrFlowers.count,
          pebbleData,
          emptyFallingPetals,
          fountainWater,
          koi,
          springButterflies,
          autumnWaterLeaves,
        ),
          (previousQrContentRef.current = qrContentAt2d7f10));
      });
      const initializeRenderer = async () => {
        try {
          if (rendererRef.current || rendererInitializing.current) return;
          if (canvasWidth <= 0 || canvasHeightAt41144e <= 0) return;
          const canvasElement = canvasRef.current;
          if (!canvasElement) return;
          rendererInitializing.current = !0;
          const initializationGeneration = ++rendererGenerationRef.current,
            isCurrentInitialization = () =>
              initializationGeneration === rendererGenerationRef.current &&
              canvasRef.current === canvasElement;
          const rendererStateAtf2509b = await (async function (
            canvas,
            requestedCanvasWidthAt3e3d49,
            requestedCanvasHeightAt40a891,
          ) {
            const gpuContext = gpuSurface.context,
              deviceAt354206 = gpuSurface.device,
              textureFormat = gpuSurface.format;
            if (!isCurrentInitialization()) return null;
            gpuSurface.resize();
            const blockUniforms = createUniformBuffer(deviceAt354206, 64),
              branchUniforms = createUniformBuffer(deviceAt354206, 64),
              pebbleUniforms = createUniformBuffer(deviceAt354206, 64),
              petalUniforms = createUniformBuffer(deviceAt354206, 64),
              autumnLeafUniforms = createUniformBuffer(deviceAt354206, 64),
              rainUniforms = createUniformBuffer(deviceAt354206, 64),
              butterflyUniforms = createUniformBuffer(deviceAt354206, 64),
              springButterflyUniforms = createUniformBuffer(deviceAt354206, 64),
              typeBuffer = createStorageBuffer(deviceAt354206, 268960),
              positionBuffer = createStorageBuffer(deviceAt354206, 1075840),
              heightBuffer = createStorageBuffer(deviceAt354206, 268960),
              baseYBuffer = createStorageBuffer(deviceAt354206, 268960),
              flowerBuffer = createStorageBuffer(deviceAt354206, 16e5),
              fountainProfileBuffer = createStorageBuffer(deviceAt354206, 24e3),
              pebbleBuffer = createStorageBuffer(deviceAt354206, 8e5),
              fallingPetalBuffer = createStorageBuffer(deviceAt354206, 160),
              rainBuffer = createStorageBuffer(deviceAt354206, 8e3),
              butterflyBuffer = createStorageBuffer(deviceAt354206, 160),
              springButterflyBuffer = createStorageBuffer(deviceAt354206, 160),
              blocksBindGroupLayout = createBindGroupLayout(deviceAt354206, {
                entries: [
                  {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: {
                      type: "uniform",
                    },
                  },
                  {
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {
                      type: "read-only-storage",
                    },
                  },
                  {
                    binding: 2,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {
                      type: "read-only-storage",
                    },
                  },
                  {
                    binding: 3,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {
                      type: "read-only-storage",
                    },
                  },
                  {
                    binding: 4,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {
                      type: "read-only-storage",
                    },
                  },
                ],
              }),
              sceneBindGroupLayoutAt9c7a29 = createBindGroupLayout(deviceAt354206, {
                entries: [
                  {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: {
                      type: "uniform",
                    },
                  },
                ],
              }),
              sceneBindGroupLayoutAt3d73c0 = createBindGroupLayout(deviceAt354206, {
                entries: [
                  {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: {
                      type: "uniform",
                    },
                  },
                  {
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {
                      type: "read-only-storage",
                    },
                  },
                ],
              }),
              blocksBindGroup = createBindGroup(deviceAt354206, {
                layout: blocksBindGroupLayout,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: blockUniforms,
                    },
                  },
                  {
                    binding: 1,
                    resource: {
                      buffer: typeBuffer,
                    },
                  },
                  {
                    binding: 2,
                    resource: {
                      buffer: positionBuffer,
                    },
                  },
                  {
                    binding: 3,
                    resource: {
                      buffer: heightBuffer,
                    },
                  },
                  {
                    binding: 4,
                    resource: {
                      buffer: baseYBuffer,
                    },
                  },
                ],
              }),
              skyBindGroup = createBindGroup(deviceAt354206, {
                layout: sceneBindGroupLayoutAt9c7a29,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: blockUniforms,
                    },
                  },
                ],
              }),
              flowersBindGroup = createBindGroup(deviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: blockUniforms,
                    },
                  },
                  {
                    binding: 1,
                    resource: {
                      buffer: flowerBuffer,
                    },
                  },
                ],
              }),
              autumnLeafBindGroup = createBindGroup(deviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  { binding: 0, resource: { buffer: autumnLeafUniforms } },
                  { binding: 1, resource: { buffer: flowerBuffer } },
                ],
              }),
              fountainBindGroup = createBindGroup(deviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: branchUniforms,
                    },
                  },
                  {
                    binding: 1,
                    resource: {
                      buffer: fountainProfileBuffer,
                    },
                  },
                ],
              }),
              pebblesBindGroup = createBindGroup(deviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: pebbleUniforms,
                    },
                  },
                  {
                    binding: 1,
                    resource: {
                      buffer: pebbleBuffer,
                    },
                  },
                ],
              }),
              fallingPetalsBindGroup = createBindGroup(deviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: petalUniforms,
                    },
                  },
                  {
                    binding: 1,
                    resource: {
                      buffer: fallingPetalBuffer,
                    },
                  },
                ],
              }),
              fountainWaterBindGroup = createBindGroup(deviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: rainUniforms,
                    },
                  },
                  {
                    binding: 1,
                    resource: {
                      buffer: rainBuffer,
                    },
                  },
                ],
              }),
              koiBindGroup = createBindGroup(deviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: butterflyUniforms,
                    },
                  },
                  {
                    binding: 1,
                    resource: {
                      buffer: butterflyBuffer,
                    },
                  },
                ],
              }),
              springButterflyBindGroup = createBindGroup(deviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  { binding: 0, resource: { buffer: springButterflyUniforms } },
                  { binding: 1, resource: { buffer: springButterflyBuffer } },
                ],
              }),
              skyPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt9c7a29, {
                vertex:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct SkyOut {\n  @builtin(position) position: vec4f,\n  @location(0) uv: vec2f,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n\n@vertex\nfn main(@builtin(vertex_index) vi: u32) -> SkyOut {\n  var tri = array<vec2f, 3>(\n    vec2f(-1.0, -1.0),\n    vec2f(3.0, -1.0),\n    vec2f(-1.0, 3.0)\n  );\n  let p = tri[vi];\n  var o: SkyOut;\n  o.position = vec4f(p, 1.0, 1.0);\n  o.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);\n  return o;\n}\n",
                fragment:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n\n@fragment\nfn main(@location(0) uv: vec2f) -> @location(0) vec4f {\n  return vec4f(0.965, 0.945, 0.906, 1.0);\n}\n",
                depthWrite: !1,
                depthCompare: "always",
              }),
              shadowPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt9c7a29, {
                vertex:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct ShadowOut {\n  @builtin(position) position: vec4f,\n  @location(0) uv: vec2f,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n\n@vertex\nfn main(@builtin(vertex_index) vi: u32) -> ShadowOut {\n  var quadVerts = array<vec2f, 6>(\n    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),\n    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)\n  );\n\n  let qv = quadVerts[vi];\n  var o: ShadowOut;\n  o.uv = qv * 0.5 + 0.5;\n\n  let gridSize = uniforms.gridSize;\n  let blockSize = 0.0245;\n  let halfGrid = gridSize * blockSize * 0.5;\n  let shadowScale = 0.85;\n\n  let progress = uniforms.progress;\n  let shadowHeight = 0.48;\n  let lightDirXZ = vec2f(-0.5, -0.5);\n  let shadowOffset = -lightDirXZ * shadowHeight * 0.35 * (1.0 - progress);\n\n  let localX = qv.x * halfGrid * shadowScale + shadowOffset.x;\n  let localY = -shadowHeight;\n  let localZ = qv.y * halfGrid * shadowScale + shadowOffset.y;\n\n  let isoAngleY = mix(0.78, 0, progress) + uniforms.cameraBobX;\n  let isoAngleX = mix(-0.55, -1.5708, progress) + uniforms.cameraBobY;\n\n  let cy = cos(isoAngleY); let sy = sin(isoAngleY);\n  let cx = cos(isoAngleX); let sx = sin(isoAngleX);\n\n  let ry_x = localX * cy - localZ * sy;\n  let ry_z = localX * sy + localZ * cy;\n  let rx_y = localY * cx - ry_z * sx;\n  let rx_z = localY * sx + ry_z * cx;\n\n  let viewScale = mix(1.3, 1.6, progress);\n  let ar = uniforms.aspectRatio;\n  let scaleX = viewScale / max(ar, 1.0);\n  let scaleY = viewScale / max(1.0 / ar, 1.0);\n\n  let yOffsetScene = mix(0.0, 0.08, progress);\n  let xOffsetScene = mix(0.0, 0.015, progress);\n\n  o.position = vec4f(\n    (ry_x + xOffsetScene) * scaleX,\n    (rx_y + yOffsetScene) * scaleY,\n    0.99,\n    1.0\n  );\n\n  return o;\n}\n",
                fragment:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n\n@fragment\nfn main(@location(0) uv: vec2f) -> @location(0) vec4f {\n  return vec4f(0.0, 0.0, 0.0, 0.0);\n}\n",
                depthWrite: !1,
                depthCompare: "always",
                blend: {
                  color: {
                    srcFactor: "src-alpha",
                    dstFactor: "one-minus-src-alpha",
                    operation: "add",
                  },
                  alpha: {
                    srcFactor: "one",
                    dstFactor: "one-minus-src-alpha",
                    operation: "add",
                  },
                },
              }),
              blocksPipeline = createScenePipeline(deviceAt354206, textureFormat, blocksBindGroupLayout, {
                vertex:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct BlockOutput {\n  @builtin(position) position: vec4f,\n  @location(0) uv: vec2f,\n  @location(1) faceNx: f32,\n  @location(2) faceNy: f32,\n  @location(3) faceNz: f32,\n  @location(4) blockType: f32,\n  @location(5) blockH: f32,\n  @location(6) col: f32,\n  @location(7) row: f32,\n  @location(8) layer: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n@group(0) @binding(1) var<storage, read> blockTypes: array<u32>;\n@group(0) @binding(2) var<storage, read> blockPositions: array<vec4f>;\n@group(0) @binding(3) var<storage, read> blockHeights: array<f32>;\n@group(0) @binding(4) var<storage, read> blockBaseY: array<f32>;\n\n@vertex\nfn main(@builtin(vertex_index) vertexIndex: u32) -> BlockOutput {\n  var output: BlockOutput;\n  let blockIdx = vertexIndex / 36u;\n  let localVertIdx = vertexIndex % 36u;\n  let faceIdx = localVertIdx / 6u;\n  let vertIdx = localVertIdx % 6u;\n\n  let blockCount = u32(uniforms.blockCount);\n  if (blockIdx >= blockCount) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let posData = blockPositions[blockIdx];\n  let col = posData.x;\n  let row = posData.y;\n  output.col = col;\n  output.row = row;\n  output.layer = blockBaseY[blockIdx] / " +
                  WGSL_BLOCK_SIZE +
                  ";\n\n  let gridSize = uniforms.gridSize;\n  let blockSize = " +
                  WGSL_BLOCK_SIZE +
                  ";\n  let halfGrid = gridSize * blockSize * 0.5;\n  let cubeSize = blockSize;\n\n  let baseX = col * blockSize - halfGrid;\n  let baseY = blockBaseY[blockIdx];\n  let baseZ = row * blockSize - halfGrid;\n  let h = cubeSize;\n  output.blockH = h;\n\n  let typePacked = blockTypes[blockIdx];\n  output.blockType = f32(typePacked);\n\n  let quadVerts = array<vec2f, 6>(\n    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),\n    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)\n  );\n  let qv = quadVerts[vertIdx];\n  let hw = cubeSize * 0.5;\n  let hd = cubeSize * 0.5;\n\n  var localPos = vec3f(0.0);\n  var normal = vec3f(0.0);\n\n  var swayX = 0.0;\n  var swayZ = 0.0;\n  if (typePacked == 1u && h > 0.15) {\n    let time = uniforms.time;\n    swayX = sin(time * 0.8 + col * 0.3 + row * 0.2) * 0.002 * h;\n    swayZ = sin(time * 0.6 + col * 0.2 + row * 0.4) * 0.0015 * h;\n  }\n\n  if (faceIdx == 0u) {\n    localPos = vec3f(baseX + (qv.x - 0.5) * cubeSize + swayX, baseY + h, baseZ + (qv.y - 0.5) * cubeSize + swayZ);\n    normal = vec3f(0.0, 1.0, 0.0);\n  } else if (faceIdx == 1u) {\n    localPos = vec3f(baseX + (qv.x - 0.5) * cubeSize, baseY, baseZ + (0.5 - qv.y) * cubeSize);\n    normal = vec3f(0.0, -1.0, 0.0);\n  } else if (faceIdx == 2u) {\n    localPos = vec3f(baseX + (qv.x - 0.5) * cubeSize + swayX * qv.y, baseY + qv.y * h, baseZ + hd + swayZ * qv.y);\n    normal = vec3f(0.0, 0.0, 1.0);\n  } else if (faceIdx == 3u) {\n    localPos = vec3f(baseX + (0.5 - qv.x) * cubeSize + swayX * qv.y, baseY + qv.y * h, baseZ - hd + swayZ * qv.y);\n    normal = vec3f(0.0, 0.0, -1.0);\n  } else if (faceIdx == 4u) {\n    localPos = vec3f(baseX + hw + swayX * qv.y, baseY + qv.y * h, baseZ + (qv.x - 0.5) * cubeSize + swayZ * qv.y);\n    normal = vec3f(1.0, 0.0, 0.0);\n  } else {\n    localPos = vec3f(baseX - hw + swayX * qv.y, baseY + qv.y * h, baseZ + (0.5 - qv.x) * cubeSize + swayZ * qv.y);\n    normal = vec3f(-1.0, 0.0, 0.0);\n  }\n\n  output.uv = qv;\n  output.faceNx = normal.x;\n  output.faceNy = normal.y;\n  output.faceNz = normal.z;\n\n  let progress = uniforms.progress;\n\n  if (typePacked == 2u && baseY > 0.001) {\n    let trunkVis = smoothstep(0.2, 0.6, progress);\n    localPos = vec3f(\n      baseX + (localPos.x - baseX) * trunkVis,\n      baseY + (localPos.y - baseY) * trunkVis,\n      baseZ + (localPos.z - baseZ) * trunkVis,\n    );\n  }\n\n  if (typePacked == 1u) {\n    let cubeVis = smoothstep(0.15, 0.6, progress);\n    localPos = vec3f(\n      baseX + (localPos.x - baseX) * cubeVis,\n      baseY + (localPos.y - baseY) * cubeVis,\n      baseZ + (localPos.z - baseZ) * cubeVis,\n    );\n  }\n\n  if (typePacked == 5u) {\n    let branchVis = smoothstep(0.0, 0.4, 1.0 - progress);\n    localPos = vec3f(\n      baseX + (localPos.x - baseX) * branchVis,\n      baseY + (localPos.y - baseY) * branchVis,\n      baseZ + (localPos.z - baseZ) * branchVis,\n    );\n  }\n\n  " +
                  createIsometricTransformWgsl() +
                  "\n  \n  output.position = vec4f(\n    (ry_x + xOffsetScene) * scaleX,\n    (rx_y + yOffsetScene) * scaleY,\n    rx_z * 0.01 + 0.5,\n    1.0\n  );\n\n  return output;\n}\n",
                fragment:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct BlockInput {\n  @location(0) uv: vec2f,\n  @location(1) faceNx: f32,\n  @location(2) faceNy: f32,\n  @location(3) faceNz: f32,\n  @location(4) blockType: f32,\n  @location(5) blockH: f32,\n  @location(6) col: f32,\n  @location(7) row: f32,\n  @location(8) layer: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n\n" +
                  WGSL_ACES_FILM +
                  "\n\n@fragment\nfn main(input: BlockInput) -> @location(0) vec4f {\n  let uv = input.uv;\n  let N = normalize(vec3f(input.faceNx, input.faceNy, input.faceNz));\n  let blockType = i32(input.blockType + 0.5);\n  let progress = uniforms.progress;\n  let season = uniforms.season;\n\n  var dirtLight = vec3f(0.86, 0.80, 0.68);\n  var dirtMid = vec3f(0.80, 0.74, 0.62);\n  var dirtDark = vec3f(0.72, 0.66, 0.54);\n\n  // Summer: dirty earthy brown-beige soil\n  if (season > 0.5 && season < 1.5) {\n    dirtLight = vec3f(0.78, 0.66, 0.52);\n    dirtMid   = vec3f(0.68, 0.57, 0.43);\n    dirtDark  = vec3f(0.56, 0.46, 0.34);\n  }\n\n  var sakuraLight = vec3f(0.88, 0.48, 0.55);\n  var sakuraMid = vec3f(0.78, 0.34, 0.42);\n  var sakuraDeep = vec3f(0.65, 0.24, 0.32);\n  var sakuraRich = vec3f(0.52, 0.16, 0.24);\n\n  // Custom color tint for canopy blocks — saturated\n  let customStr = uniforms.customStrength;\n  if (customStr > 0.01) {\n    let cc = vec3f(uniforms.customR, uniforms.customG, uniforms.customB);\n    sakuraLight = mix(sakuraLight, cc * 1.15, customStr);\n    sakuraMid   = mix(sakuraMid,   cc * 0.90, customStr);\n    sakuraDeep  = mix(sakuraDeep,  cc * 0.70, customStr);\n    sakuraRich  = mix(sakuraRich,  cc * 0.55, customStr);\n  }\n\n  var grassDark = vec3f(0.10, 0.30, 0.06);\n  var grassMid = vec3f(0.16, 0.42, 0.10);\n  var grassBright = vec3f(0.24, 0.52, 0.14);\n\n  if (season > 0.5 && season < 1.5) {\n    sakuraLight = vec3f(0.10, 0.24, 0.03);\n    sakuraMid   = vec3f(0.06, 0.18, 0.02);\n    sakuraDeep  = vec3f(0.04, 0.13, 0.01);\n    sakuraRich  = vec3f(0.02, 0.08, 0.01);\n    grassDark   = vec3f(0.04, 0.16, 0.01);\n    grassMid    = vec3f(0.08, 0.26, 0.02);\n    grassBright = vec3f(0.14, 0.36, 0.04);\n  } else if (season > 1.5 && season < 2.5) {\n    sakuraLight = vec3f(0.74, 0.36, 0.10);\n    sakuraMid   = vec3f(0.62, 0.23, 0.07);\n    sakuraDeep  = vec3f(0.50, 0.15, 0.05);\n    sakuraRich  = vec3f(0.38, 0.10, 0.03);\n    grassDark   = vec3f(0.42, 0.26, 0.08);\n    grassMid    = vec3f(0.56, 0.34, 0.10);\n    grassBright = vec3f(0.68, 0.42, 0.12);\n  }\n\n  let barkLight = vec3f(0.42, 0.24, 0.14);\n  let barkMid = vec3f(0.34, 0.18, 0.10);\n  let barkDark = vec3f(0.24, 0.12, 0.06);\n  let barkDeep = vec3f(0.18, 0.08, 0.04);\n\n  const sunDir = vec3f(-0.405616, 0.861934, -0.304212);\n  let sunCol = vec3f(1.20, 1.20, 1.20);\n  let ambient = vec3f(0.28, 0.28, 0.30);\n  let skyFill = " +
                  toWgslVec3(Z) +
                  ";\n  let bounce = " +
                  toWgslVec3(Q) +
                  ";\n\n  let NdSun = max(dot(N, sunDir), 0.0);\n  let NdUp = max(dot(N, vec3f(0.0, 1.0, 0.0)), 0.0);\n\n  let layer = input.layer;\n  let seed = vec2f(input.col, input.row);\n  let blockSeed = seed.x * 17.3 + seed.y * 31.1 + layer * 73.7;\n  let noise1 = fract(sin(blockSeed) * 43758.5);\n  let noise2 = fract(sin(blockSeed * 1.7 + 127.1) * 43758.5);\n  let noise3 = fract(sin(blockSeed * 2.3 + 311.7) * 43758.5);\n\n  let gridSize = uniforms.gridSize;\n  let blockSize = 0.0245;\n  let halfGrid = gridSize * blockSize * 0.5;\n  let cx = gridSize * 0.5;\n  let cy = gridSize * 0.5;\n  let shadowOffsetX = 1.5;\n  let shadowOffsetY = 1.5;\n  let dx = input.col - (cx + shadowOffsetX);\n  let dy = input.row - (cy + shadowOffsetY);\n  let distFromShadowCenter = sqrt(dx * dx + dy * dy);\n  let canopyRadius = gridSize * 0.38;\n  let trunkRadius = 2.5;\n  let shadowT = 1.0 - smoothstep(trunkRadius, canopyRadius, distFromShadowCenter);\n  let trunkAO = (1.0 - smoothstep(0.0, trunkRadius * 1.5, distFromShadowCenter)) * 0.20;\n  let treeShadow = 1.0 - shadowT * 0.35 - trunkAO;\n\n  let maxCanopyLayer = 15.0;\n  let layerRatio = min(layer / maxCanopyLayer, 1.0);\n  let canopyAO = 0.65 + layerRatio * 0.35;\n\n  var albedo = vec3f(0.5);\n\n  if (input.faceNy > 0.5) {\n    let topWarmTint = vec3f(1.1, 1.08, 1.02);\n    let isDarkModule = step(0.5, f32(blockType));\n\n    if (blockType == 0) {\n      var dirtColor = dirtMid;\n      let t = noise1;\n      if (t < 0.4) { dirtColor = mix(dirtLight, dirtMid, t / 0.4); }\n      else if (t < 0.7) { dirtColor = mix(dirtMid, dirtDark, (t - 0.4) / 0.3); }\n      else { dirtColor = mix(dirtDark, dirtDark * 0.85, (t - 0.7) / 0.3); }\n      let shift = (noise2 - 0.5) * 0.18;\n      let grain = (noise3 - 0.5) * 0.08;\n      dirtColor = dirtColor * (1.0 + shift + grain) * treeShadow;\n\n      let distFromCenter = sqrt((input.col - cx) * (input.col - cx) + (input.row - cy) * (input.row - cy));\n      let underCanopy = step(distFromCenter, canopyRadius);\n      let speckleChance = noise3 * underCanopy;\n\n      if (season < 0.5) {\n        let petalTint = vec3f(0.90, 0.72, 0.70);\n        dirtColor = mix(dirtColor, petalTint, step(0.85, speckleChance) * 0.4);\n      } else if (season < 1.5) {\n        let greenSpeck = vec3f(0.55, 0.68, 0.42);\n        dirtColor = mix(dirtColor, greenSpeck, step(0.92, speckleChance) * 0.2);\n      } else if (season < 2.5) {\n        let leafSpeck = mix(vec3f(0.85, 0.52, 0.15), vec3f(0.72, 0.35, 0.10), noise1);\n        dirtColor = mix(dirtColor, leafSpeck, step(0.70, speckleChance) * 0.5);\n      }\n      albedo = dirtColor * topWarmTint;\n\n    } else if (blockType == 1) {\n      var cherryColor = sakuraMid;\n      let t = noise1;\n      if (t < 0.33) { cherryColor = mix(sakuraLight, sakuraMid, t / 0.33); }\n      else if (t < 0.66) { cherryColor = mix(sakuraMid, sakuraDeep, (t - 0.33) / 0.33); }\n      else { cherryColor = mix(sakuraDeep, sakuraRich, (t - 0.66) / 0.34); }\n      let shift = (noise2 - 0.5) * 0.15;\n      cherryColor = cherryColor * (1.0 + shift);\n\n      let edgeX = min(uv.x, 1.0 - uv.x);\n      let edgeY = min(uv.y, 1.0 - uv.y);\n      let edgeDist = min(edgeX, edgeY);\n      let roundedEdge = smoothstep(0.0, 0.12, edgeDist);\n      let edgeDarken = mix(0.88, 1.0, roundedEdge);\n      let finalEdge = mix(edgeDarken, 1.0, progress);\n      albedo = cherryColor * topWarmTint * canopyAO * finalEdge;\n\n    } else if (blockType == 2) {\n      let trunkMaxLayer = 18.0;\n      let heightRatio = min(layer / trunkMaxLayer, 1.0);\n      let sandColor = vec3f(0.85, 0.78, 0.64);\n      let sandShift = (noise1 - 0.5) * 0.1;\n      let groundSand = sandColor * (1.0 + sandShift) * treeShadow;\n\n      var barkColor = mix(barkMid, barkLight, noise1 * 0.4);\n      let shift = (noise2 - 0.5) * 0.15;\n      barkColor = barkColor * (1.0 + shift);\n      let aoShadow = 0.6 + heightRatio * 0.4;\n      let sandBlend = smoothstep(0.0, 0.15, heightRatio);\n      albedo = mix(groundSand, barkColor * aoShadow, sandBlend) * topWarmTint;\n\n    } else if (blockType == 3) {\n      let grassBrown = vec3f(0.28, 0.25, 0.12);\n      let grassOlive = vec3f(0.32, 0.35, 0.15);\n      var grassColor = grassMid;\n      let t = noise1;\n      if (t < 0.3) { grassColor = mix(grassBright, grassMid, t / 0.3); }\n      else if (t < 0.6) { grassColor = mix(grassMid, grassDark, (t - 0.3) / 0.3); }\n      else if (t < 0.8) { grassColor = mix(grassDark, grassBrown, (t - 0.6) / 0.2); }\n      else { grassColor = mix(grassBrown, grassOlive, (t - 0.8) / 0.2); }\n      let shift = (noise2 - 0.5) * 0.2;\n      grassColor = grassColor * (1.0 + shift);\n      albedo = grassColor * topWarmTint;\n\n    } else if (blockType == 5) {\n      var branchColor = mix(barkMid, barkLight, noise1 * 0.5);\n      let bShift = (noise2 - 0.5) * 0.12;\n      branchColor = branchColor * (1.0 + bShift);\n      let ringNoise = sin(noise1 * 12.0 + noise2 * 6.0) * 0.06 + 0.94;\n      albedo = branchColor * ringNoise * topWarmTint * canopyAO;\n\n    } else if (blockType == 7) {\n      // Beach QR modules inherit the material directly above them.\n      let localX = input.col * blockSize - halfGrid;\n      let localZ = input.row * blockSize - halfGrid;\n      let sourceX = -localX - blockSize * .5;\n      let sourceZ = -localZ - blockSize * .5;\n      let beachU = sourceX / (gridSize * blockSize) + .5;\n      let shorelineZ = -halfGrid + halfGrid * 1.035 + (sin(beachU * 12.566371) * .70 + sin(beachU * 31.415928 + .8) * .30) * blockSize;\n      let sandTone = mix(vec3f(.52,.39,.20), vec3f(.79,.66,.40), noise1 * .55 + .25);\n      let seaTone = mix(vec3f(.16,.52,.61), vec3f(.28,.72,.77), noise1);\n      albedo = select(sandTone, seaTone, sourceZ <= shorelineZ) * topWarmTint;\n\n    } else {\n      let sandA = vec3f(0.84, 0.77, 0.63);\n      let sandB = vec3f(0.80, 0.73, 0.60);\n      let sandPink = vec3f(0.84, 0.74, 0.66);\n      var fallenColor = sandA;\n      if (noise1 < 0.4) { fallenColor = mix(sandA, sandB, noise2); }\n      else if (noise1 < 0.75) { fallenColor = mix(sandB, sandPink, noise2 * 0.5); }\n      else { fallenColor = mix(sandA, sandPink, noise2 * 0.4); }\n      let shift = (noise2 - 0.5) * 0.12;\n      fallenColor = fallenColor * (1.0 + shift) * treeShadow;\n      if (blockType == 6) { fallenColor = fallenColor * 0.48; }\n      albedo = fallenColor * topWarmTint;\n    }\n\n    let qrBoost = progress * progress;\n    // Stronger darkening for spring & autumn QR contrast\n    let seasonDark = select(0.0, 0.08, season < 0.5 || season > 1.5);\n    // Extra darkening for light custom colors (Snow) in QR mode\n    let albedoBright = dot(albedo, vec3f(0.299, 0.587, 0.114));\n    let snowExtraDark = mix(0.0, 0.12, smoothstep(0.55, 0.8, albedoBright) * customStr);\n    let darkFactor = mix(0.48, 0.43 - snowExtraDark - seasonDark, qrBoost);\n    // Prevent light QR modules from washing out to gray/white in 2D mode\n    let lightFactor = mix(0.20, 0.36, qrBoost);\n    let lightTarget = vec3f(0.78, 0.70, 0.56);\n    let darkened = albedo * darkFactor;\n    let brightened = mix(albedo, lightTarget, lightFactor);\n    albedo = mix(brightened, darkened, isDarkModule);\n\n  } else if (abs(input.faceNz) > 0.5 || abs(input.faceNx) > 0.5) {\n    let faceN = normalize(vec3f(input.faceNx, input.faceNy, input.faceNz));\n    let sunLight = max(dot(faceN, sunDir), 0.0);\n    let shade = 0.3 + sunLight * 0.65;\n    let tint = vec3f(0.95, 0.95, 0.98);\n\n    if (layer < 1.0 && (blockType == 0 || blockType == 3 || blockType == 4)) {\n      let stoneLight = vec3f(0.78, 0.72, 0.64);\n      let stoneMid = vec3f(0.68, 0.62, 0.54);\n      let stoneDark = vec3f(0.58, 0.52, 0.45);\n      var stoneColor = stoneMid;\n      if (noise1 < 0.35) { stoneColor = mix(stoneLight, stoneMid, noise2); }\n      else if (noise1 < 0.7) { stoneColor = mix(stoneMid, stoneDark, noise2 * 0.6); }\n      else { stoneColor = mix(stoneDark, stoneLight, noise2 * 0.3); }\n      let stoneShift = (noise3 - 0.5) * 0.08;\n      stoneColor = stoneColor * (1.0 + stoneShift);\n      albedo = stoneColor * shade * tint;\n\n    } else if (blockType == 0) {\n      var dirtColor = dirtMid;\n      let t = noise1;\n      if (t < 0.4) { dirtColor = mix(dirtLight, dirtMid, t / 0.4); }\n      else if (t < 0.7) { dirtColor = mix(dirtMid, dirtDark, (t - 0.4) / 0.3); }\n      else { dirtColor = dirtDark * (1.0 - (t - 0.7) * 0.2); }\n      let shift = (noise2 - 0.5) * 0.2;\n      dirtColor = dirtColor * (1.0 + shift);\n      albedo = dirtColor * shade * tint;\n\n    } else if (blockType == 1) {\n      var cherryColor = sakuraMid;\n      let t = noise1;\n      if (t < 0.33) { cherryColor = mix(sakuraLight, sakuraMid, t / 0.33); }\n      else if (t < 0.66) { cherryColor = mix(sakuraMid, sakuraDeep, (t - 0.33) / 0.33); }\n      else { cherryColor = mix(sakuraDeep, sakuraRich, (t - 0.66) / 0.34); }\n      let shift = (noise2 - 0.5) * 0.25;\n      cherryColor = cherryColor * (1.0 + shift);\n      let edgeX = min(uv.x, 1.0 - uv.x);\n      let edgeY = min(uv.y, 1.0 - uv.y);\n      let edgeDist = min(edgeX, edgeY);\n      let roundedEdge = smoothstep(0.0, 0.12, edgeDist);\n      let edgeDarken = mix(0.7, 1.0, roundedEdge);\n      albedo = cherryColor * shade * tint * canopyAO * edgeDarken;\n\n    } else if (blockType == 2) {\n      let trunkCx = gridSize * 0.5;\n      let trunkCy = gridSize * 0.5;\n      let radX = input.col - trunkCx;\n      let radZ = input.row - trunkCy;\n      let radLen = max(sqrt(radX * radX + radZ * radZ), 0.01);\n      let cylNormalX = radX / radLen;\n      let cylNormalZ = radZ / radLen;\n      let cylN = normalize(vec3f(cylNormalX * 0.8 + faceN.x * 0.2, faceN.y * 0.15, cylNormalZ * 0.8 + faceN.z * 0.2));\n      let cylSunLight = max(dot(cylN, sunDir), 0.0);\n\n      let trunkMaxLayer = 18.0;\n      let heightRatio = min(layer / trunkMaxLayer, 1.0);\n\n      let ts = uniforms.trunkSeed;  // 0..1 per-session bark variation\n\n      let barkAngle = atan2(radZ, radX);\n      let groove1 = sin(barkAngle * (9.0 + ts * 7.0) + noise1 * 2.0) * 0.5 + 0.5;\n      let groove2 = sin(barkAngle * (5.0 + ts * 5.0) + noise2 * 3.5 + 1.7) * 0.5 + 0.5;\n      let groove3 = sin(barkAngle * (16.0 + ts * 8.0) + noise1 * 5.0) * 0.5 + 0.5;\n      let grooveDepth = (groove1 * 0.5 + groove2 * 0.3 + groove3 * 0.2) * 0.25 + 0.75;\n\n      let spiralAngle = barkAngle + heightRatio * (1.8 + ts * 2.0) + noise1 * 0.5;\n      let woodGrain = sin(spiralAngle * (6.0 + ts * 5.0) + layer * 2.0) * 0.08 + 0.92;\n      let ringPattern = sin(layer * (2.0 + ts * 3.5) + noise2 * 4.0) * 0.10 + 0.90;\n      let knotNoise = sin(barkAngle * 3.0 + layer * 5.0 + noise3 * 6.0);\n      let knot = smoothstep(0.85, 0.95, knotNoise) * 0.15;\n\n      var barkColor = mix(barkDark, barkMid, heightRatio * 0.7);\n      barkColor = mix(barkColor, barkLight, groove1 * 0.3);\n      let purpleUndertone = vec3f(0.08, 0.02, 0.10) * heightRatio * 0.3;\n      barkColor = barkColor + purpleUndertone;\n      let shift = (noise2 - 0.5) * 0.18;\n      barkColor = barkColor * (1.0 + shift);\n      barkColor = barkColor - knot;\n      // Seed-based hue variation: warm reddish (ts→1) to cool gray-brown (ts→0)\n      let hueShift = (ts - 0.5) * 0.10;\n      barkColor = clamp(barkColor + vec3f(hueShift, -abs(hueShift) * 0.25, -hueShift * 0.45), vec3f(0.0), vec3f(1.0));\n\n      let edgeFade = 1.0 - smoothstep(0.6, 1.0, abs(dot(cylN, normalize(vec3f(faceN.x, 0.0, faceN.z)))));\n      let cylAO = 0.7 + edgeFade * 0.3;\n      let vertAO = 0.60 + heightRatio * 0.40;\n      let trunkShade = 0.22 + cylSunLight * 0.75;\n      var trunkAlbedo = barkColor * trunkShade * grooveDepth * woodGrain * ringPattern * cylAO * vertAO * tint;\n\n      let sandSideColor = vec3f(0.78, 0.72, 0.58) * shade * tint;\n      let sideBlend = smoothstep(0.0, 0.15, heightRatio);\n      albedo = mix(sandSideColor, trunkAlbedo, sideBlend);\n\n    } else if (blockType == 3) {\n      let grassBrown = vec3f(0.28, 0.25, 0.12);\n      let grassOlive = vec3f(0.32, 0.35, 0.15);\n      var grassColor = grassMid;\n      let t = noise1;\n      if (t < 0.3) { grassColor = mix(grassBright, grassMid, t / 0.3); }\n      else if (t < 0.6) { grassColor = mix(grassMid, grassDark, (t - 0.6) / 0.3); }\n      else if (t < 0.8) { grassColor = mix(grassDark, grassBrown, (t - 0.6) / 0.2); }\n      else { grassColor = mix(grassBrown, grassOlive, (t - 0.8) / 0.2); }\n      let shift = (noise2 - 0.5) * 0.2;\n      grassColor = grassColor * (1.0 + shift);\n      albedo = grassColor * shade * tint;\n\n    } else if (blockType == 5) {\n      var branchColor = mix(barkDark, barkMid, noise1 * 0.6);\n      let grooveSide = sin(layer * 5.0 + noise1 * 3.0) * 0.08 + 0.92;\n      let bShift = (noise2 - 0.5) * 0.15;\n      branchColor = branchColor * (1.0 + bShift) * grooveSide;\n      albedo = branchColor * shade * tint;\n\n    } else if (blockType == 7) {\n      let localX = input.col * blockSize - halfGrid;\n      let localZ = input.row * blockSize - halfGrid;\n      let sourceX = -localX - blockSize * .5;\n      let sourceZ = -localZ - blockSize * .5;\n      let beachU = sourceX / (gridSize * blockSize) + .5;\n      let shorelineZ = -halfGrid + halfGrid * 1.035 + (sin(beachU * 12.566371) * .70 + sin(beachU * 31.415928 + .8) * .30) * blockSize;\n      let sandSide = vec3f(.62,.48,.26);\n      let seaSide = vec3f(.14,.43,.51);\n      albedo = select(sandSide, seaSide, sourceZ <= shorelineZ) * shade * tint;\n\n    } else {\n      let sandSide = vec3f(0.72, 0.66, 0.52);\n      let sandSideDark = vec3f(0.62, 0.56, 0.44);\n      var fallenColor = mix(sandSide, sandSideDark, noise1 * 0.5);\n      let shift = (noise2 - 0.5) * 0.12;\n      fallenColor = fallenColor * (1.0 + shift);\n      albedo = fallenColor * shade * tint;\n    }\n\n  } else {\n    let bottomTint = vec3f(0.65, 0.62, 0.58);\n    let fallenBottom = vec3f(0.50, 0.45, 0.38);\n\n    if (blockType == 0) { albedo = dirtDark * 0.5 * bottomTint; }\n    else if (blockType == 1) { albedo = sakuraDeep * 0.5 * bottomTint; }\n    else if (blockType == 2) { albedo = barkDark * 0.5 * bottomTint; }\n    else if (blockType == 3) { albedo = grassDark * 0.5 * bottomTint; }\n    else if (blockType == 5) { albedo = barkDark * 0.5 * bottomTint; }\n    else if (blockType == 7) { albedo = vec3f(.34,.40,.35) * bottomTint; }\n    else { albedo = fallenBottom * 0.6 * bottomTint; }\n  }\n\n  const viewDir = vec3f(0.398015, 0.597022, 0.696526);\n  let rimDot = 1.0 - max(dot(N, viewDir), 0.0);\n  let rimLight = pow(rimDot, 4.0) * 0.06 * vec3f(0.85, 0.75, 0.95);\n\n  let diffuse = albedo * (ambient + sunCol * NdSun * 0.85 + skyFill * NdUp * 0.18 + bounce * 0.15) + rimLight;\n  var hdr = diffuse;\n  hdr = acesFilm(hdr * 1.15);\n  hdr = pow(hdr, vec3f(1.0 / 2.2));\n\n  let grayB = dot(hdr, vec3f(0.299, 0.587, 0.114));\n  hdr = mix(vec3f(grayB), hdr, 1.25);\n\n  // Rain wet ground effect (hide in QR mode)\n  let rainVis = uniforms.rainMode * (1.0 - progress);\n  if (rainVis > 0.01 && input.faceNy > 0.5 && blockType != 1) {\n    let rainMode = rainVis;\n    // Wet specular highlight\n    let specDir = normalize(vec3f(0.4, 0.9, 0.3));\n    let viewD = normalize(vec3f(0.4, 0.6, 0.7));\n    let half = normalize(specDir + viewD);\n    let spec = pow(max(dot(N, half), 0.0), 32.0) * 0.16 * rainMode;\n    hdr = hdr + vec3f(spec);\n\n    // Darken for wetness\n    hdr = hdr * mix(1.0, 0.88, rainMode);\n\n    // Ripple rings on ground blocks\n    if (blockType == 0 || blockType == 3 || blockType == 4) {\n      let rippleCenter1 = vec2f(input.col + sin(uniforms.time * 1.3 + noise1 * 5.0) * 3.0,\n                                 input.row + cos(uniforms.time * 1.1 + noise2 * 4.0) * 3.0);\n      let rippleCenter2 = vec2f(input.col + sin(uniforms.time * 0.9 + noise2 * 7.0) * 4.0,\n                                 input.row + cos(uniforms.time * 1.5 + noise1 * 3.0) * 4.0);\n      let rd1 = length(vec2f(input.col, input.row) - rippleCenter1);\n      let rd2 = length(vec2f(input.col, input.row) - rippleCenter2);\n      let ripple1 = sin(rd1 * 4.0 - uniforms.time * 6.0) * 0.5 + 0.5;\n      let ripple2 = sin(rd2 * 3.5 - uniforms.time * 5.0) * 0.5 + 0.5;\n      let rippleIntensity = (smoothstep(0.4, 0.6, ripple1) + smoothstep(0.4, 0.6, ripple2)) * 0.015 * rainMode;\n      hdr = hdr + vec3f(rippleIntensity * 0.8, rippleIntensity * 0.85, rippleIntensity);\n    }\n  }\n\n  return vec4f(hdr, 1.0);\n}\n",
                depthWrite: !0,
                depthCompare: "less",
              }),
              flowersPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
                vertex:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct FlowerOutput {\n  @builtin(position) position: vec4f,\n  @location(0) petalT: f32,\n  @location(1) normalX: f32,\n  @location(2) normalY: f32,\n  @location(3) normalZ: f32,\n  @location(4) seed: f32,\n  @location(5) isCenter: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n@group(0) @binding(1) var<storage, read> flowerPositions: array<vec4f>;\n\n@vertex\nfn main(@builtin(vertex_index) vertexIndex: u32) -> FlowerOutput {\n  var output: FlowerOutput;\n\n  let vertsPerFlower = 150u;\n  let flowerIdx = vertexIndex / vertsPerFlower;\n  let localVert = vertexIndex % vertsPerFlower;\n\n  let flowerData = flowerPositions[flowerIdx];\n  let col = flowerData.x;\n  let row = flowerData.y;\n  let topY = flowerData.z;\n  let rawSeed = flowerData.w;\n\n  let isLeaf = step(1.0, rawSeed);\n  let seed = rawSeed - isLeaf;\n  output.seed = rawSeed;\n\n  let progress = uniforms.progress;\n\n  let vis = smoothstep(0.0, 0.6, 1.0 - progress);\n  if (vis < 0.01) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let blockSize = f32(" +
                  WGSL_BLOCK_SIZE +
                  ");\n  let gridSize = uniforms.gridSize;\n  let halfGrid = gridSize * blockSize * 0.5;\n\n  // In summer, cull ~60% of low-lying ground flowers\n  let season = uniforms.season;\n  let groundThreshold = blockSize * gridSize * 0.22;\n  if (season > 0.5 && season < 1.5 && topY < groundThreshold && fract(seed * 7.13) < 0.82) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let centerX = col * blockSize - halfGrid;\n  let centerY = topY;\n  let centerZ = row * blockSize - halfGrid;\n\n  let time = uniforms.time;\n  let isGroundPetal = step(topY, blockSize * 2.5);\n  let windFactor = (1.0 - isGroundPetal) * vis;\n  let windBase = sin(time * 0.45 + col * 0.25 + row * 0.15) * 0.028;\n  let windTurb = sin(time * 1.1 + col * 0.8 + row * 0.6) * 0.008;\n  let swayX = (windBase + windTurb) * windFactor;\n  let swayZ = sin(time * 0.35 + col * 0.15 + row * 0.25) * 0.018 * windFactor;\n\n  let baseScale = blockSize * (0.7 + seed * 0.3) * vis;\n  let flowerScale = mix(baseScale, baseScale * 0.9, isLeaf);\n  let petalLength = mix(flowerScale * 0.85, flowerScale * 1.3, isLeaf);\n  let petalWidth = mix(flowerScale * 0.38, flowerScale * 0.18, isLeaf);\n  let curlHeight = mix(blockSize * 0.18, blockSize * 0.08, isLeaf) * vis;\n  let centerRadius = mix(blockSize * 0.12, blockSize * 0.04, isLeaf) * vis;\n\n  let baseRotation = seed * 6.28318;\n\n  let tiltAngle = (seed * 0.25 + 0.05) * (1.0 - isLeaf * 0.5);\n  let tiltDir = seed * 6.28318 * 3.17;\n  let tiltCos = cos(tiltAngle);\n  let tiltSin = sin(tiltAngle);\n  let tiltAxisX = cos(tiltDir);\n  let tiltAxisZ = sin(tiltDir);\n\n  var localPos = vec3f(0.0);\n  var normal = vec3f(0.0, 1.0, 0.0);\n  output.isCenter = 0.0;\n  output.petalT = 0.0;\n\n  if (localVert < 120u) {\n    let petalIdx = localVert / 24u;\n    let segVert = localVert % 24u;\n    let segIdx = segVert / 6u;\n    let triVert = segVert % 6u;\n\n    let petalAngle = f32(petalIdx) * 1.25664 + baseRotation;\n    let cosA = cos(petalAngle);\n    let sinA = sin(petalAngle);\n\n    var petalScale = 1.0;\n    if (isLeaf > 0.5 && petalIdx >= 3u) {\n      petalScale = 0.0;\n    }\n\n    var rowIdx: u32;\n    var side: f32;\n    if (triVert == 0u) { rowIdx = segIdx;     side = -1.0; }\n    else if (triVert == 1u) { rowIdx = segIdx;     side =  1.0; }\n    else if (triVert == 2u) { rowIdx = segIdx + 1u; side = -1.0; }\n    else if (triVert == 3u) { rowIdx = segIdx + 1u; side = -1.0; }\n    else if (triVert == 4u) { rowIdx = segIdx;     side =  1.0; }\n    else { rowIdx = segIdx + 1u; side =  1.0; }\n\n    let t = f32(rowIdx) * 0.25;\n    output.petalT = t;\n\n    let dist = t * petalLength * petalScale;\n    let hw = petalWidth * sin(t * 3.14159) * sqrt(1.0 - t * 0.3) * petalScale;\n    let curl = curlHeight * 4.0 * t * (1.0 - t);\n\n    let alongX = dist * cosA;\n    let alongZ = dist * sinA;\n    let perpX = side * hw * (-sinA);\n    let perpZ = side * hw * cosA;\n\n    localPos = vec3f(\n      centerX + alongX + perpX + swayX,\n      centerY + curl,\n      centerZ + alongZ + perpZ + swayZ,\n    );\n\n    let curlSlope = curlHeight * 4.0 * (1.0 - 2.0 * t);\n    normal = normalize(vec3f(\n      -curlSlope * cosA + side * 0.2 * sinA,\n      1.0,\n      -curlSlope * sinA - side * 0.2 * cosA,\n    ));\n  } else {\n    output.isCenter = 1.0;\n    let diskVert = localVert - 120u;\n    let triIdx = diskVert / 3u;\n    let triV = diskVert % 3u;\n\n    let centerElevation = curlHeight * 0.8;\n\n    if (triV == 0u) {\n      localPos = vec3f(centerX + swayX, centerY + centerElevation, centerZ + swayZ);\n      normal = vec3f(0.0, 1.0, 0.0);\n    } else {\n      let angleIdx = select(triIdx, triIdx + 1u, triV == 2u);\n      let angle = f32(angleIdx) * 0.62832 + baseRotation;\n      localPos = vec3f(\n        centerX + cos(angle) * centerRadius + swayX,\n        centerY + centerElevation * 0.9,\n        centerZ + sin(angle) * centerRadius + swayZ,\n      );\n      normal = vec3f(0.0, 1.0, 0.0);\n    }\n  }\n\n  // Apply tilt (Rodrigues rotation)\n  let offX = localPos.x - centerX - swayX;\n  let offY = localPos.y - centerY;\n  let offZ = localPos.z - centerZ - swayZ;\n\n  let dotAO = tiltAxisX * offX + tiltAxisZ * offZ;\n  let crossX = -tiltAxisZ * offY;\n  let crossY = tiltAxisZ * offX - tiltAxisX * offZ;\n  let crossZ = tiltAxisX * offY;\n\n  let rotX = offX * tiltCos + crossX * tiltSin + tiltAxisX * dotAO * (1.0 - tiltCos);\n  let rotY = offY * tiltCos + crossY * tiltSin;\n  let rotZ = offZ * tiltCos + crossZ * tiltSin + tiltAxisZ * dotAO * (1.0 - tiltCos);\n\n  localPos = vec3f(\n    centerX + swayX + rotX,\n    centerY + rotY,\n    centerZ + swayZ + rotZ,\n  );\n\n  // Also rotate normal\n  let nDotA = tiltAxisX * normal.x + tiltAxisZ * normal.z;\n  let nCrossX = -tiltAxisZ * normal.y;\n  let nCrossY = tiltAxisZ * normal.x - tiltAxisX * normal.z;\n  let nCrossZ = tiltAxisX * normal.y;\n  normal = normalize(vec3f(\n    normal.x * tiltCos + nCrossX * tiltSin + tiltAxisX * nDotA * (1.0 - tiltCos),\n    normal.y * tiltCos + nCrossY * tiltSin,\n    normal.z * tiltCos + nCrossZ * tiltSin + tiltAxisZ * nDotA * (1.0 - tiltCos),\n  ));\n\n  // Scale toward center for 2D transition\n  localPos = vec3f(\n    centerX + swayX + (localPos.x - centerX - swayX) * vis,\n    centerY + (localPos.y - centerY) * vis,\n    centerZ + swayZ + (localPos.z - centerZ - swayZ) * vis,\n  );\n\n  output.normalX = normal.x;\n  output.normalY = normal.y;\n  output.normalZ = normal.z;\n\n  " +
                  createIsometricTransformWgsl() +
                  "\n  \n  output.position = vec4f(\n    (ry_x + xOffsetScene) * scaleX,\n    (rx_y + yOffsetScene) * scaleY,\n    rx_z * 0.01 + 0.5,\n    1.0\n  );\n\n  return output;\n}\n",
                fragment:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct FlowerInput {\n  @location(0) petalT: f32,\n  @location(1) normalX: f32,\n  @location(2) normalY: f32,\n  @location(3) normalZ: f32,\n  @location(4) seed: f32,\n  @location(5) isCenter: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n\n" +
                  WGSL_ACES_FILM +
                  "\n\n@fragment\nfn main(input: FlowerInput) -> @location(0) vec4f {\n  let N = normalize(vec3f(input.normalX, input.normalY, input.normalZ));\n  let t = input.petalT;\n  let rawSeed = input.seed;\n  let origIsLeaf = step(1.0, rawSeed);\n  let seed = rawSeed - origIsLeaf;\n\n  let season = uniforms.season;\n\n  let leafChance = fract(seed * 4.37);\n  var isLeaf = origIsLeaf;\n  let isGroundFlower = step(input.petalT, 0.01) * (1.0 - origIsLeaf);\n\n  if (season > 0.5 && season < 1.5) {\n    isLeaf = 1.0;\n  } else if (season > 1.5 && season < 2.5) {\n    isLeaf = 1.0;\n    if (leafChance < 0.40) { discard; }\n  }\n\n  var leafDark   = vec3f(0.25, 0.40, 0.22);\n  var leafMedium = vec3f(0.40, 0.55, 0.30);\n  var leafLight  = vec3f(0.55, 0.68, 0.38);\n  var leafOlive  = vec3f(0.48, 0.52, 0.28);\n\n  if (season > 0.5 && season < 1.5) {\n    leafDark   = vec3f(0.03, 0.12, 0.01);\n    leafMedium = vec3f(0.06, 0.20, 0.02);\n    leafLight  = vec3f(0.12, 0.28, 0.03);\n    leafOlive  = vec3f(0.08, 0.18, 0.02);\n  } else if (season > 1.5 && season < 2.5) {\n    leafDark   = vec3f(0.42, 0.12, 0.05);\n    leafMedium = vec3f(0.58, 0.21, 0.07);\n    leafLight  = vec3f(0.70, 0.34, 0.09);\n    leafOlive  = vec3f(0.62, 0.40, 0.07);\n  }\n\n  var shadeDeep   = vec3f(0.85, 0.22, 0.38);\n  var shadeMedium = vec3f(0.92, 0.40, 0.52);\n  var shadeLight  = vec3f(0.96, 0.58, 0.66);\n  var shadePale   = vec3f(0.98, 0.75, 0.80);\n  var shadeBlush  = vec3f(0.97, 0.65, 0.72);\n  var shadeWhite  = vec3f(0.99, 0.88, 0.90);\n  var stamenGold  = vec3f(0.92, 0.78, 0.35);\n\n  if (season > 0.5 && season < 1.5) {\n    shadeDeep   = vec3f(0.88, 0.90, 0.82);\n    shadeMedium = vec3f(0.92, 0.93, 0.85);\n    shadeLight  = vec3f(0.95, 0.95, 0.88);\n    shadePale   = vec3f(0.96, 0.96, 0.92);\n    shadeBlush  = vec3f(0.93, 0.94, 0.86);\n    shadeWhite  = vec3f(0.97, 0.97, 0.94);\n    stamenGold  = vec3f(0.82, 0.78, 0.35);\n  } else if (season > 1.5 && season < 2.5) {\n    shadeDeep   = vec3f(0.52, 0.08, 0.03);\n    shadeMedium = vec3f(0.64, 0.18, 0.05);\n    shadeLight  = vec3f(0.72, 0.32, 0.07);\n    shadePale   = vec3f(0.78, 0.46, 0.12);\n    shadeBlush  = vec3f(0.68, 0.25, 0.07);\n    shadeWhite  = vec3f(0.80, 0.58, 0.20);\n    stamenGold  = vec3f(0.62, 0.42, 0.08);\n  }\n\n  var baseColor = vec3f(0.0);\n\n  if (isLeaf > 0.5) {\n    let leafTier = fract(seed * 5.17);\n    var leafBase: vec3f;\n    var leafTip: vec3f;\n    if (leafTier < 0.35) { leafBase = leafDark; leafTip = leafMedium; }\n    else if (leafTier < 0.6) { leafBase = leafMedium; leafTip = leafLight; }\n    else if (leafTier < 0.85) { leafBase = leafOlive; leafTip = leafLight; }\n    else { leafBase = leafDark; leafTip = leafOlive; }\n    baseColor = mix(leafBase, leafTip, t);\n  } else if (input.isCenter > 0.5) {\n    let goldVar = fract(seed * 13.3) * 0.15;\n    let goldColor = stamenGold * (0.9 + goldVar);\n    let centerLeaf = mix(leafDark, leafMedium, fract(seed * 5.17));\n    baseColor = mix(goldColor, centerLeaf, min(season, 1.0));\n  } else {\n    if (season > 0.5 && season < 2.5) {\n      let leafTier2 = fract(seed * 8.13);\n      var lBase: vec3f;\n      var lTip: vec3f;\n      if (leafTier2 < 0.3) { lBase = leafDark; lTip = leafMedium; }\n      else if (leafTier2 < 0.6) { lBase = leafMedium; lTip = leafLight; }\n      else if (leafTier2 < 0.85) { lBase = leafOlive; lTip = leafLight; }\n      else { lBase = leafDark; lTip = leafOlive; }\n      baseColor = mix(lBase, lTip, t);\n    } else {\n      let tier = fract(seed * 7.31);\n      var petalBase: vec3f;\n      var petalTip: vec3f;\n      if (tier < 0.2) { petalBase = shadeDeep; petalTip = shadeMedium; }\n      else if (tier < 0.35) { petalBase = shadeMedium; petalTip = shadeLight; }\n      else if (tier < 0.50) { petalBase = shadeLight; petalTip = shadePale; }\n      else if (tier < 0.65) { petalBase = shadeBlush; petalTip = shadePale; }\n      else if (tier < 0.80) { petalBase = shadePale; petalTip = shadeWhite; }\n      else { petalBase = shadeDeep; petalTip = shadeBlush; }\n      baseColor = mix(petalBase, petalTip, t);\n\n      let veinT = abs(t - 0.5) * 2.0;\n      let veinDarken = 1.0 - (1.0 - veinT) * 0.08;\n      baseColor = baseColor * veinDarken;\n    }\n  }\n\n  // Custom color override — preserve tonal variation from original shading\n  let customStrength = uniforms.customStrength;\n  if (customStrength > 0.01) {\n    let customCol = vec3f(uniforms.customR, uniforms.customG, uniforms.customB);\n    let luma = dot(baseColor, vec3f(0.299, 0.587, 0.114));\n    // Keep original brightness deltas — shift hue while preserving shade variety\n    let baseLuma = dot(customCol, vec3f(0.299, 0.587, 0.114));\n    let lumaDelta = luma - 0.5;\n    let tinted = customCol * (0.7 + lumaDelta * 1.2) + vec3f(lumaDelta * 0.15);\n    baseColor = mix(baseColor, tinted, customStrength);\n  }\n\n  const sunDir = vec3f(-0.405616, 0.861934, -0.304212);\n  let sunColor = vec3f(1.20, 1.20, 1.20);\n  let ambient = vec3f(0.28, 0.28, 0.30);\n  let NdotL = max(dot(N, sunDir), 0.0);\n\n  let NdotLBack = max(dot(-N, sunDir), 0.0);\n  let sssColor = mix(vec3f(1.0, 0.55, 0.65), vec3f(0.6, 0.8, 0.4), isLeaf);\n  let subsurface = NdotLBack * 0.22 * sssColor;\n\n  let skyFill = vec3f(0.90, 0.85, 0.88);\n  let skyContrib = max(N.y, 0.0) * 0.12 * skyFill;\n\n  let depthDarken = mix(0.92, 1.0, fract(seed * 11.3));\n  let undersideDarken = mix(0.55, 1.0, max(N.y, 0.0)) * depthDarken;\n\n  const viewDir = vec3f(0.398015, 0.597022, 0.696526);\n  let rimDot = 1.0 - max(dot(N, viewDir), 0.0);\n  let rim = pow(rimDot, 3.0) * 0.10 * vec3f(1.0, 0.85, 0.88);\n\n  let lit = baseColor * undersideDarken * (ambient + sunColor * NdotL * 0.88) + subsurface + skyContrib + rim;\n\n  let hdr = acesFilm(lit * 1.05);\n  var ldr = pow(hdr, vec3f(1.0 / 2.2));\n\n  let gray = dot(ldr, vec3f(0.299, 0.587, 0.114));\n  ldr = mix(vec3f(gray), ldr, 1.9);\n\n  // Darken spring flowers in QR transition for better contrast\n  if (season < 0.5 && isLeaf < 0.5) {\n    let qrDarken = uniforms.progress * uniforms.progress;\n    // Extra darkening for light/snow custom colors\n    let brightness = dot(ldr, vec3f(0.299, 0.587, 0.114));\n    let extraDark = mix(0.55, 0.42, smoothstep(0.5, 0.8, brightness) * customStrength);\n    ldr = ldr * mix(1.0, extraDark, qrDarken);\n  }\n\n  return vec4f(ldr, 1.0);\n}\n",
                depthWrite: !0,
                depthCompare: "less",
              });
            let fountainPipeline = null;
            try {
              fountainPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
                vertex:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct BranchOutput {\n  @builtin(position) position: vec4f,\n  @location(0) normalX: f32,\n  @location(1) normalY: f32,\n  @location(2) normalZ: f32,\n  @location(3) depth: f32,\n  @location(4) vSeed: f32,\n  @location(5) ringT: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n@group(0) @binding(1) var<storage, read> branchData: array<vec4f>;\n\nconst VERTS_PER_SEG: u32 = 48u;\nconst RADIAL: u32 = 8u;\nconst PI: f32 = 3.14159265;\n\n@vertex\nfn main(@builtin(vertex_index) vertexIndex: u32) -> BranchOutput {\n  var output: BranchOutput;\n\n  let segIdx = vertexIndex / VERTS_PER_SEG;\n  let localVert = vertexIndex % VERTS_PER_SEG;\n\n  let segCount = u32(uniforms.blockCount);\n  if (segIdx >= segCount) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let startData = branchData[segIdx * 3u + 0u];\n  let endData   = branchData[segIdx * 3u + 1u];\n  let segMeta   = branchData[segIdx * 3u + 2u];\n\n  let startPos = startData.xyz;\n  let startR   = startData.w;\n  let endPos   = endData.xyz;\n  let endR     = endData.w;\n  let depth    = segMeta.x;\n  let seed     = segMeta.y;\n\n  output.depth = depth;\n  output.vSeed = seed;\n\n  let progress = uniforms.progress;\n  let branchVis = smoothstep(0.0, 0.4, 1.0 - progress);\n  if (branchVis < 0.01) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let quadIdx = localVert / 6u;\n  let triVert = localVert % 6u;\n\n  let angle0 = f32(quadIdx) / f32(RADIAL) * 2.0 * PI;\n  let angle1 = f32(quadIdx + 1u) / f32(RADIAL) * 2.0 * PI;\n\n  var ringT: f32;\n  var angle: f32;\n  if (triVert == 0u) { ringT = 0.0; angle = angle0; }\n  else if (triVert == 1u) { ringT = 0.0; angle = angle1; }\n  else if (triVert == 2u) { ringT = 1.0; angle = angle0; }\n  else if (triVert == 3u) { ringT = 1.0; angle = angle0; }\n  else if (triVert == 4u) { ringT = 0.0; angle = angle1; }\n  else { ringT = 1.0; angle = angle1; }\n\n  output.ringT = ringT;\n\n  let pos = mix(startPos, endPos, ringT);\n  let radius = mix(startR, endR, ringT) * branchVis;\n\n  let dir = normalize(endPos - startPos);\n  var refUp = vec3f(0.0, 1.0, 0.0);\n  if (abs(dot(dir, refUp)) > 0.95) {\n    refUp = vec3f(1.0, 0.0, 0.0);\n  }\n  let right = normalize(cross(dir, refUp));\n  let up = normalize(cross(right, dir));\n\n  let time = uniforms.time;\n  let windAmount = min(depth / 4.0, 1.0) * 0.016 * branchVis;\n  let windBase = sin(time * 0.45 + pos.x * 15.0 + pos.z * 10.0) * windAmount;\n  let windTurb = sin(time * 1.1 + pos.x * 40.0 + pos.z * 30.0) * windAmount * 0.25;\n  let windOffX = windBase + windTurb;\n  let windOffZ = sin(time * 0.35 + pos.z * 12.0 + pos.x * 8.0) * windAmount * 0.6;\n  let windedPos = pos + vec3f(windOffX, 0.0, windOffZ);\n\n  let localPos = windedPos + right * cos(angle) * radius + up * sin(angle) * radius;\n\n  let normal = normalize(right * cos(angle) + up * sin(angle));\n  output.normalX = normal.x;\n  output.normalY = normal.y;\n  output.normalZ = normal.z;\n\n  " +
                  createIsometricTransformWgsl() +
                  "\n  \n  output.position = vec4f(\n    (ry_x + xOffsetScene) * scaleX,\n    (rx_y + yOffsetScene) * scaleY,\n    rx_z * 0.01 + 0.5,\n    1.0\n  );\n\n\n  return output;\n}\n",
                fragment:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct BranchInput {\n  @location(0) normalX: f32,\n  @location(1) normalY: f32,\n  @location(2) normalZ: f32,\n  @location(3) depth: f32,\n  @location(4) vSeed: f32,\n  @location(5) ringT: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n\n" +
                  WGSL_ACES_FILM +
                  "\n\n@fragment\nfn main(input: BranchInput) -> @location(0) vec4f {\n  let N = normalize(vec3f(input.normalX, input.normalY, input.normalZ));\n  let depth = input.depth;\n  let seed = input.vSeed;\n  let t = input.ringT;\n\n  let barkBase  = vec3f(0.28, 0.16, 0.10);\n  let barkLight = vec3f(0.40, 0.26, 0.18);\n  let barkDark  = vec3f(0.16, 0.09, 0.05);\n  let barkHighlight = vec3f(0.50, 0.34, 0.24);\n\n  let depthT = min(depth / 5.0, 1.0);\n  var bark = mix(barkBase, barkLight, depthT * 0.5);\n  bark = mix(bark, barkHighlight, depthT * depthT * 0.2);\n\n  let noise1 = fract(sin(seed * 43.7 + depth * 17.3) * 43758.5);\n  let noise2 = fract(sin(seed * 73.1 + depth * 31.1 + 127.1) * 43758.5);\n\n  let grooveAngle = fract(sin(seed * 127.1 + t * 31.1) * 43758.5) * 6.28;\n  let groove1 = sin(grooveAngle * 8.0 + noise1 * 3.0) * 0.5 + 0.5;\n  let groove2 = sin(grooveAngle * 14.0 + noise2 * 5.0 + 1.7) * 0.5 + 0.5;\n  let groove3 = sin(grooveAngle * 22.0 + noise1 * 7.0) * 0.5 + 0.5;\n  let grooveEffect = (groove1 * 0.5 + groove2 * 0.3 + groove3 * 0.2) * 0.18 + 0.82;\n\n  let ring = sin(t * 18.0 + noise2 * 6.0) * 0.07 + 0.93;\n\n  let knotNoise = sin(seed * 47.3 + t * 13.0 + noise1 * 8.0);\n  let knot = smoothstep(0.88, 0.95, knotNoise) * 0.10;\n\n  let colorShift = (noise1 - 0.5) * 0.12;\n  bark = bark * (1.0 + colorShift) * grooveEffect * ring - knot;\n\n  const sunDir = vec3f(-0.405616, 0.861934, -0.304212);\n  let sunCol = vec3f(1.20, 1.20, 1.20);\n  let ambient = vec3f(0.25, 0.25, 0.28);\n  let NdotL = max(dot(N, sunDir), 0.0);\n\n  let NdotLBack = max(dot(-N, sunDir), 0.0);\n  let sss = NdotLBack * depthT * 0.06 * vec3f(0.6, 0.3, 0.2);\n\n  let skyFill = vec3f(0.85, 0.80, 0.90);\n  let skyContrib = max(N.y, 0.0) * 0.08 * skyFill;\n\n  let ao = 0.75 + depthT * 0.25;\n\n  let lit = bark * (ambient + sunCol * NdotL * 0.82) * ao + sss + skyContrib;\n\n  let hdr = acesFilm(lit * 1.05);\n  var ldr = pow(hdr, vec3f(1.0 / 2.2));\n\n  let gray = dot(ldr, vec3f(0.299, 0.587, 0.114));\n  ldr = mix(vec3f(gray), ldr, 1.25);\n\n  return vec4f(ldr, 1.0);\n}\n",
                depthWrite: !0,
                depthCompare: "less",
              });
            } catch (branchPipelineError) {
              console.error("Branch pipeline failed (non-fatal):", branchPipelineError);
            }
            // Reuse the branch storage layout: each record is one segment of
            // the fountain's traced radial profile, rather than a tree limb.
            const FOUNTAIN_VERTEX_SHADER = `${SCENE_UNIFORM_WGSL}
struct FountainOutput {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) height: f32,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> profile: array<vec4f>;
const SIDES: u32 = 16u;
@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> FountainOutput {
  var output: FountainOutput;
  let verticesPerBand = SIDES * 6u;
  let bandIndex = vertexIndex / verticesPerBand;
  if (bandIndex >= u32(uniforms.blockCount)) {
    output.position = vec4f(0.0, 0.0, -10.0, 1.0);
    return output;
  }
  let corner = vertexIndex % 6u;
  let side = (vertexIndex % verticesPerBand) / 6u;
  let nextSide = (side + 1u) % SIDES;
  let firstAngle = f32(side) / f32(SIDES) * 6.2831853;
  let secondAngle = f32(nextSide) / f32(SIDES) * 6.2831853;
  let start = profile[bandIndex * 3u];
  let end = profile[bandIndex * 3u + 1u];
  let isEnd = corner == 2u || corner == 3u || corner == 5u;
  let isNext = corner == 1u || corner == 4u || corner == 5u;
  let point = select(start, end, isEnd);
  let angle = select(firstAngle, secondAngle, isNext);
  let progress = uniforms.progress;
  let visibility = smoothstep(0.0, 0.35, 1.0 - progress);
  let localPos = vec3f(cos(angle) * point.w * visibility, point.y * visibility, sin(angle) * point.w * visibility);
  let slope = normalize(vec2f(end.w - start.w, end.y - start.y));
  output.normal = normalize(vec3f(cos(angle) * slope.y, -slope.x, sin(angle) * slope.y));
  output.height = point.y;
  ${createIsometricTransformWgsl()}
  output.position = vec4f((ry_x + xOffsetScene) * scaleX, (rx_y + yOffsetScene) * scaleY, rx_z * 0.01 + 0.5, 1.0);
  return output;
}`;
            const FOUNTAIN_FRAGMENT_SHADER = `${SCENE_UNIFORM_WGSL}
struct FountainInput { @location(0) normal: vec3f, @location(1) height: f32 }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
${WGSL_ACES_FILM}
@fragment
fn main(input: FountainInput) -> @location(0) vec4f {
  let light = normalize(vec3f(-0.405616, 0.861934, -0.304212));
  let normal = normalize(input.normal);
  let ndotl = max(dot(normal, light), 0.0);
  let warmStone = mix(vec3f(0.56, 0.46, 0.30), vec3f(0.92, 0.81, 0.57), clamp(input.height * 1.8, 0.0, 1.0));
  // Darken undersides and inward-facing bowl walls so the three cavities read.
  let upwardFacing = smoothstep(-0.45, 0.65, normal.y);
  let cavityOcclusion = mix(0.48, 1.0, upwardFacing);
  let rimHighlight = pow(max(normal.y, 0.0), 7.0) * 0.10;
  let lit = warmStone * (vec3f(0.20) + vec3f(1.15) * ndotl * 0.82) * cavityOcclusion + vec3f(rimHighlight);
  return vec4f(pow(acesFilm(lit * 1.05), vec3f(1.0 / 2.2)), 1.0);
}`;
            try {
              fountainPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
                vertex: FOUNTAIN_VERTEX_SHADER,
                fragment: FOUNTAIN_FRAGMENT_SHADER,
                depthWrite: !0,
                depthCompare: "less",
              });
            } catch (fountainPipelineError) {
              console.error("Fountain pipeline failed (non-fatal):", fountainPipelineError);
            }
            let beachPipeline = null;
            const BEACH_VERTEX_SHADER = `${SCENE_UNIFORM_WGSL}
struct BeachOutput { @builtin(position) position: vec4f, @location(0) color: vec3f, @location(1) alpha: f32, @location(2) normal: vec3f }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
const WATER_VERTICES: u32 = ${BEACH_WATER_VERTEX_COUNT}u;
const SAND_VERTICES: u32 = ${BEACH_SAND_VERTEX_COUNT}u;
const WALL_VERTICES: u32 = ${BEACH_WALL_VERTEX_COUNT}u;
const WALL_SEGMENTS: u32 = ${BEACH_WALL_SEGMENTS}u;
fn corner(index: u32) -> vec2f { let corners = array<vec2f, 6>(vec2f(0.,0.),vec2f(1.,0.),vec2f(0.,1.),vec2f(0.,1.),vec2f(1.,0.),vec2f(1.,1.)); return corners[index]; }
@vertex fn main(@builtin(vertex_index) vertexIndex: u32) -> BeachOutput {
  var output: BeachOutput;
  if (uniforms.progress > .98) { output.position = vec4f(0.,0.,-10.,1.); return output; }
  let water = vertexIndex < WATER_VERTICES;
  let localIndex = select(vertexIndex - WATER_VERTICES, vertexIndex, water);
  let columns = select(${BEACH_SAND_COLUMNS}u, ${BEACH_WATER_COLUMNS}u, water);
  let rows = select(${BEACH_SAND_ROWS}u, ${BEACH_WATER_ROWS}u, water);
  let cell = localIndex / 6u; let c = cell % columns; let r = cell / columns; let p = corner(localIndex % 6u);
  let u = (f32(c) + p.x) / f32(columns); let v = (f32(r) + p.y) / f32(rows);
  let planeHalf = uniforms.gridSize * f32(${WGSL_BLOCK_SIZE}) * .5;
  let blockSize = f32(${WGSL_BLOCK_SIZE});
  let qrPlaneOffset = blockSize * .5;
  // Fixed against the labels visible in beach/index.html: L2 is z=min and
  // L3 is x=min. These are the only two cut faces of the beach diorama.
  if (vertexIndex >= WATER_VERTICES + SAND_VERTICES) {
    let wallIndex = vertexIndex - WATER_VERTICES - SAND_VERTICES;
    let wallSide = wallIndex / (WALL_SEGMENTS * 6u);
    let wallVertex = wallIndex % (WALL_SEGMENTS * 6u);
    let wallSegment = wallVertex / 6u;
    let wallCorner = corner(wallVertex % 6u);
    let isL3Wall = wallSide == 1u;
    let edgeT = (f32(wallSegment) + wallCorner.x) / f32(WALL_SEGMENTS);
    let outerMin = -planeHalf - qrPlaneOffset;
    let outerMax = planeHalf - qrPlaneOffset;
    var wallX = mix(outerMin, outerMax, edgeT);
    var wallZ = outerMin;
    if (isL3Wall) {
      // L3 spans the complete beach section, including the sea where present.
      wallX = outerMin;
      wallZ = mix(outerMin, outerMax, edgeT);
    }
    let wallSourceX = -wallX - qrPlaneOffset;
    let wallSourceZ = -wallZ - qrPlaneOffset;
    let wallU = wallSourceX / (planeHalf * 2.0) + .5;
    let wallV = wallSourceZ / (planeHalf * 2.0) + .5;
    let wallWobble = sin(wallU * 12.566371) * .70 + sin(wallU * 31.415928 + .8) * .30;
    let wallShorelineZ = -planeHalf + planeHalf * 1.035 + wallWobble * blockSize;
    let wallShorelineV = (wallShorelineZ + planeHalf) / (planeHalf * 2.0);
    let wallWetSlope = (.055 - blockSize) * smoothstep(0.0, wallShorelineV, wallV);
    let wallDryRise = .045 * smoothstep(wallShorelineV, 1.0, wallV);
    let wallSubmergedBar = .015 * smoothstep(wallShorelineV * .08, wallShorelineV * .28, wallV) * (1.0 - smoothstep(wallShorelineV * .55, wallShorelineV * .78, wallV));
    let wallWetT = wallV / max(wallShorelineV, .001);
    let wallOriginalSandHeight = blockSize + wallWetSlope + wallDryRise + wallSubmergedBar;
    let wallWaveFloor = .055 - mix(.006, .018, smoothstep(.18, .88, wallWetT)) - .006;
    let wallSubmerged = 1.0 - smoothstep(.92, 1.0, wallWetT);
    let wallSandHeight = mix(wallOriginalSandHeight, min(wallOriginalSandHeight, wallWaveFloor), wallSubmerged);
    let wallMorphFrame = fract(uniforms.time * .30) * 14.0;
    let wallMorphStrength = sin(wallMorphFrame * .224399);
    let wallSideFade = smoothstep(.03, .18, wallU) * (1.0 - smoothstep(.82, .97, wallU));
    let wallShoreFade = smoothstep(.02, .16, wallWetT) * (1.0 - smoothstep(.93, .99, wallWetT));
    let wallWaveAmplitude = mix(.006, .018, smoothstep(.18, .88, wallWetT));
    let wallWave = wallSideFade * wallShoreFade * wallMorphStrength * (sin(wallSourceZ * 42.0 - wallMorphFrame * .448799 + wallSourceX * 5.0) * wallWaveAmplitude + sin(wallSourceX * 31.0 + wallSourceZ * 13.0 - wallMorphFrame * .224399) * .004);
    let isWaterWall = wallSourceZ <= wallShorelineZ;
    let wallTop = select(wallSandHeight, .055 + wallWave, isWaterWall);
    let wallSandColor = mix(vec3f(.52,.39,.20), vec3f(.79,.66,.40), smoothstep(.25, 1.0, wallV));
    let wallColor = select(wallSandColor, vec3f(.20,.66,.72), isWaterWall);
    let localPos = vec3f(wallX, mix(blockSize, wallTop, wallCorner.y), wallZ);
    output.color = wallColor;
    output.alpha = select(.92, .52, isWaterWall);
    output.normal = select(vec3f(0.,0.,1.), vec3f(-1.,0.,0.), isL3Wall);
    let progress = uniforms.progress;
    ${createIsometricTransformWgsl("localPos")}
    output.position = vec4f((ry_x + xOffsetScene) * scaleX, (rx_y + yOffsetScene) * scaleY, rx_z * .01 + .499, 1.0);
    return output;
  }
  let sourceX = (u - .5) * planeHalf * 2.0;
  // The sand remains a full plane. Only the water's final edge meanders,
  // producing a natural shoreline while sand continues underneath it.
  let shorelineWobble = sin(u * 12.566371) * .70 + sin(u * 31.415928 + .8) * .30;
  let shorelineZ = -planeHalf + planeHalf * 1.035 + shorelineWobble * blockSize;
  let sourceZ = select(-planeHalf + v * planeHalf * 2.0, -planeHalf + v * (shorelineZ + planeHalf), water);
  // The source has 15 morph frames over 0.5 s: displacement grows to the
  // middle frames, then returns to the neutral frame. Keep both coast edges
  // fixed so this reads as a water surface, never as a waving sheet.
  let morphFrame = fract(uniforms.time * .30) * 14.0;
  let morphStrength = sin(morphFrame * .224399);
  let sideFade = smoothstep(.03, .18, u) * (1.0 - smoothstep(.82, .97, u));
  let shoreFade = smoothstep(.02, .16, v) * (1.0 - smoothstep(.93, .99, v));
  let surfaceFade = sideFade * shoreFade;
  let travellingCrest = sin(sourceZ * 42.0 - morphFrame * .448799 + sourceX * 5.0);
  let crossRipple = sin(sourceX * 31.0 + sourceZ * 13.0 - morphFrame * .224399);
  // The swell gets stronger while it approaches shore, then vanishes exactly
  // at the shoreline; this keeps the edge attached to the sand.
  let shoreApproach = smoothstep(.18, .88, v);
  let waveAmplitude = mix(.006, .018, shoreApproach);
  let wave = surfaceFade * morphStrength * (travellingCrest * waveAmplitude + crossRipple * .004);
  // The sand uses the very same irregular coastline. At that line it reaches
  // the water level exactly, then rises smoothly toward L2; no suspended edge.
  let shorelineV = (shorelineZ + planeHalf) / (planeHalf * 2.0);
  let submergedBar = .015 * smoothstep(shorelineV * .08, shorelineV * .28, v) * (1.0 - smoothstep(shorelineV * .55, shorelineV * .78, v));
  let wetT = v / max(shorelineV, .001);
  let wetSlope = (.055 - blockSize) * smoothstep(0.0, shorelineV, v);
  let dryRise = .045 * smoothstep(shorelineV, 1.0, v);
  let originalSandHeight = blockSize + wetSlope + dryRise + submergedBar;
  // Only underwater sand is clamped below the lowest possible wave trough.
  // Dry sand and the final shoreline keep the original smooth profile.
  let waveFloor = .055 - mix(.006, .018, smoothstep(.18, .88, wetT)) - .006;
  let submerged = 1.0 - smoothstep(.92, 1.0, wetT);
  let sandHeight = mix(originalSandHeight, min(originalSandHeight, waveFloor), submerged);
  let height = select(sandHeight, .055 + wave, water);
  // QR cells are centred at col/row * blockSize - halfPlane. Their outer
  // boundary is therefore half a module beyond the first/last cell centre.
  // Use that exact origin for the beach, instead of the former +1-module shift.
  let localPos = vec3f(-sourceX - qrPlaneOffset, height, -sourceZ - qrPlaneOffset);
  // Broken foam only on advancing crests: it appears, spreads near shore,
  // then disappears with the same slow morph cycle as the water.
  let foamPattern = max(sin(sourceZ * 58.0 - morphFrame * .78 + sin(sourceX * 7.0) * 1.1), 0.0);
  let foam = smoothstep(.70, .96, v) * smoothstep(.42, .88, foamPattern) * smoothstep(.16, .82, morphStrength);
  let sandColor = mix(vec3f(.52,.39,.20), vec3f(.79,.66,.40), smoothstep(.25, 1.0, v));
  var waterColor = mix(vec3f(.20,.66,.72), vec3f(.78,.91,.88), foam * .82);
  if (uniforms.beachSeason > 1.5) {
    waterColor = mix(vec3f(.10,.34,.42), vec3f(.52,.68,.69), foam * .82);
  }
  output.color = select(sandColor, waterColor, water);
  output.alpha = select(.68, mix(.48, .70, foam), water);
  let sandNormal = normalize(vec3f(0.0, 1.0, .22 * (1.0 - smoothstep(.35, 1.0, v))));
  let waterNormal = normalize(vec3f(-cos(sourceX * 31.0) * waveAmplitude * 12.0, 1.0, -cos(sourceZ * 42.0) * waveAmplitude * 16.0));
  output.normal = select(sandNormal, waterNormal, water);
  let progress = uniforms.progress;
  ${createIsometricTransformWgsl("localPos")}
  output.position = vec4f((ry_x + xOffsetScene) * scaleX, (rx_y + yOffsetScene) * scaleY, rx_z * .01 + .499, 1.0);
  return output;
}`;
            const BEACH_FRAGMENT_SHADER = `${SCENE_UNIFORM_WGSL}
struct BeachInput { @location(0) color: vec3f, @location(1) alpha: f32, @location(2) normal: vec3f }
@fragment fn main(input: BeachInput) -> @location(0) vec4f {
  let lightDirection = normalize(vec3f(-.45, .80, .35));
  let diffuse = max(dot(normalize(input.normal), lightDirection), 0.0);
  let lit = input.color * (.42 + diffuse * .72);
  return vec4f(lit * input.alpha, input.alpha);
}`;
            let beachWaterPipeline = null;
            try {
              beachPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, { vertex: BEACH_VERTEX_SHADER, fragment: BEACH_FRAGMENT_SHADER, depthWrite: true, depthCompare: "less-equal", blend: ALPHA_BLEND_STATE });
              beachWaterPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, { vertex: BEACH_VERTEX_SHADER, fragment: BEACH_FRAGMENT_SHADER, depthWrite: false, depthCompare: "less", blend: ALPHA_BLEND_STATE });
            } catch (beachPipelineError) { console.error("Beach pipeline failed:", beachPipelineError); }
            let beachDecorPipeline = null;
            const BEACH_DECOR_VERTEX_SHADER = `${SCENE_UNIFORM_WGSL}
struct BeachDecorOutput { @builtin(position) position: vec4f, @location(0) color: vec3f, @location(1) alpha: f32, @location(2) normal: vec3f }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
const SHELL_VERTICES: u32 = ${BEACH_SHELL_VERTICES}u;
const STAR_VERTICES: u32 = ${BEACH_STAR_VERTICES}u;
const FISH_VERTICES: u32 = ${BEACH_FISH_VERTICES}u;
const CRAB_VERTICES: u32 = ${BEACH_SPRING_CRAB_VERTICES}u;
const KITE_VERTICES: u32 = ${BEACH_SPRING_KITE_VERTICES}u;
const SURFBOARD_VERTICES: u32 = ${BEACH_SPRING_SURFBOARD_VERTICES}u;
const UMBRELLA_VERTICES: u32 = ${BEACH_SUMMER_UMBRELLA_VERTICES}u;
const LOUNGER_VERTICES: u32 = ${BEACH_SUMMER_LOUNGER_VERTICES}u;
const CASTLE_VERTICES: u32 = ${BEACH_SUMMER_CASTLE_VERTICES}u;
const BUCKET_VERTICES: u32 = ${BEACH_SUMMER_BUCKET_VERTICES}u;
const SHOVEL_VERTICES: u32 = ${BEACH_SUMMER_SHOVEL_VERTICES}u;
const LIFEBUOY_VERTICES: u32 = ${BEACH_SUMMER_LIFEBUOY_VERTICES}u;
const BALL_VERTICES: u32 = ${BEACH_SUMMER_BALL_VERTICES}u;
const BEACH_STRAW_COLOR = vec3f(.60,.40,.14);
const BEACH_CANVAS_COLOR = vec3f(.94,.92,.82);
const BEACH_WOOD_COLOR = vec3f(.33,.20,.08);
fn shellVertex(index: u32) -> vec3f {
  let shell = array<vec3f, 18>(
    vec3f(0.,.18,0.),vec3f(-.52,0.,-.42),vec3f(.52,0.,-.42), vec3f(0.,.18,0.),vec3f(.52,0.,-.42),vec3f(.62,0.,.12),
    vec3f(0.,.18,0.),vec3f(.62,0.,.12),vec3f(.28,0.,.54), vec3f(0.,.18,0.),vec3f(.28,0.,.54),vec3f(-.28,0.,.54),
    vec3f(0.,.18,0.),vec3f(-.28,0.,.54),vec3f(-.62,0.,.12), vec3f(0.,.18,0.),vec3f(-.62,0.,.12),vec3f(-.52,0.,-.42)
  );
  return shell[index];
}
fn fishVertex(index: u32) -> vec2f {
  // Eight body/fins facets and two tail facets: still low-poly, but no
  // longer a four-triangle silhouette.
  let fish = array<vec2f, 36>(
    vec2f(.64,0.),vec2f(.33,.15),vec2f(-.05,.27), vec2f(.64,0.),vec2f(-.05,.27),vec2f(-.36,.16),
    vec2f(.64,0.),vec2f(-.36,.16),vec2f(-.48,0.), vec2f(.64,0.),vec2f(-.48,0.),vec2f(-.36,-.16),
    vec2f(.64,0.),vec2f(-.36,-.16),vec2f(-.05,-.27), vec2f(.64,0.),vec2f(-.05,-.27),vec2f(.33,-.15),
    vec2f(-.05,.27),vec2f(-.27,.52),vec2f(-.34,.13), vec2f(-.05,-.27),vec2f(-.27,-.52),vec2f(-.34,-.13),
    vec2f(-.42,.08),vec2f(-.92,.36),vec2f(-.82,0.), vec2f(-.42,-.08),vec2f(-.82,0.),vec2f(-.92,-.36),
    vec2f(.22,.12),vec2f(.40,.24),vec2f(.06,.20), vec2f(.22,-.12),vec2f(.06,-.20),vec2f(.40,-.24)
  );
  return fish[index];
}
fn crabVertex(index: u32) -> vec3f {
  // Rebuilt from the supplied Japanese freshwater crab: a low carapace,
  // three articulated legs per side, and two split pincers.
  if (index < 576u) {
    return ballVertex(index) * vec3f(.92,.38,.68) + vec3f(0.,.24,.05);
  }
  let crabBox = boxVertex(index % 36u);
  let component = (index - 576u) / 36u;
  var start = vec3f(0.);
  var end = vec3f(0.);
  var thickness = .08;
  if (component < 12u) {
    let leg = component / 2u;
    let side = select(-1., 1., leg >= 3u);
    let row = f32(leg % 3u) - 1.;
    let hip = vec3f(side * .42, .18, row * .32 + .12);
    let knee = vec3f(side * .82, .09, row * .42 + .10);
    let foot = vec3f(side * 1.10, .01, row * .46 - .08);
    start = select(knee, hip, component % 2u == 0u);
    end = select(foot, knee, component % 2u == 0u);
    thickness = .075;
  } else {
    let clawPart = component - 12u;
    let side = select(-1., 1., clawPart >= 3u);
    let piece = clawPart % 3u;
    let shoulder = vec3f(side * .43, .18, -.31);
    let wrist = vec3f(side * .72, .14, -.58);
    let upperPincer = vec3f(side * 1.05, .16, -.84);
    let lowerPincer = vec3f(side * .88, .05, -.97);
    start = select(select(wrist, shoulder, piece == 0u), wrist, piece == 2u);
    end = select(select(upperPincer, wrist, piece == 0u), lowerPincer, piece == 2u);
    thickness = select(.13, .085, piece == 0u);
  }
  let axis = end - start;
  let sideAxis = normalize(vec3f(-axis.z, 0., axis.x));
  return (start + end) * .5 + axis * crabBox.z + sideAxis * crabBox.x * thickness + vec3f(0., crabBox.y * thickness, 0.);
}
fn kiteVertex(index: u32) -> vec3f {
  let kite = array<vec3f, 12>(
    vec3f(0.,.34,0.),vec3f(.23,0.,0.),vec3f(0.,-.34,0.), vec3f(0.,.34,0.),vec3f(0.,-.34,0.),vec3f(-.23,0.,0.),
    vec3f(0.,-.34,0.),vec3f(-.05,-.57,0.),vec3f(.05,-.57,0.), vec3f(-.05,-.57,0.),vec3f(.05,-.57,0.),vec3f(0.,-.75,0.)
  );
  return kite[index];
}
fn boxVertex(index: u32) -> vec3f {
  let box = array<vec3f, 36>(
    vec3f(-.5,-.5,.5),vec3f(.5,-.5,.5),vec3f(.5,.5,.5), vec3f(-.5,-.5,.5),vec3f(.5,.5,.5),vec3f(-.5,.5,.5),
    vec3f(.5,-.5,-.5),vec3f(-.5,-.5,-.5),vec3f(-.5,.5,-.5), vec3f(.5,-.5,-.5),vec3f(-.5,.5,-.5),vec3f(.5,.5,-.5),
    vec3f(-.5,-.5,-.5),vec3f(-.5,-.5,.5),vec3f(-.5,.5,.5), vec3f(-.5,-.5,-.5),vec3f(-.5,.5,.5),vec3f(-.5,.5,-.5),
    vec3f(.5,-.5,.5),vec3f(.5,-.5,-.5),vec3f(.5,.5,-.5), vec3f(.5,-.5,.5),vec3f(.5,.5,-.5),vec3f(.5,.5,.5),
    vec3f(-.5,.5,.5),vec3f(.5,.5,.5),vec3f(.5,.5,-.5), vec3f(-.5,.5,.5),vec3f(.5,.5,-.5),vec3f(-.5,.5,-.5),
    vec3f(-.5,-.5,-.5),vec3f(.5,-.5,-.5),vec3f(.5,-.5,.5), vec3f(-.5,-.5,-.5),vec3f(.5,-.5,.5),vec3f(-.5,-.5,.5)
  );
  return box[index];
}
// 12-sided primitives are the same low-poly density used by the kit's ball,
// buoy and castle turrets: curved silhouettes without an excessive mesh.
fn cylinderVertex(index: u32) -> vec3f {
  let segment = index / 12u;
  let corner = index % 12u;
  let a = f32(segment) * .52359878;
  let b = f32(segment + 1u) * .52359878;
  let bottomA = vec3f(cos(a) * .5, 0., sin(a) * .5);
  let bottomB = vec3f(cos(b) * .5, 0., sin(b) * .5);
  let topA = bottomA + vec3f(0.,1.,0.);
  let topB = bottomB + vec3f(0.,1.,0.);
  let vertices = array<vec3f, 12>(bottomA,bottomB,topB,bottomA,topB,topA, vec3f(0.,1.,0.),topA,topB, vec3f(0.,0.,0.),bottomB,bottomA);
  return vertices[corner];
}
fn coneVertex(index: u32) -> vec3f {
  let segment = index / 6u;
  let corner = index % 6u;
  let a = f32(segment) * .52359878;
  let b = f32(segment + 1u) * .52359878;
  let bottomA = vec3f(cos(a) * .5, 0., sin(a) * .5);
  let bottomB = vec3f(cos(b) * .5, 0., sin(b) * .5);
  let vertices = array<vec3f, 6>(bottomA,bottomB,vec3f(0.,1.,0.), vec3f(0.),bottomB,bottomA);
  return vertices[corner];
}
fn torusVertex(index: u32) -> vec3f {
  let cell = index / 6u;
  let corner = index % 6u;
  let majorSegment = cell / 6u;
  let tubeSegment = cell % 6u;
  let quad = array<vec2f, 6>(vec2f(0.,0.),vec2f(1.,0.),vec2f(0.,1.),vec2f(0.,1.),vec2f(1.,0.),vec2f(1.,1.));
  let q = quad[corner];
  let majorAngle = (f32(majorSegment) + q.x) * .52359878;
  let tubeAngle = (f32(tubeSegment) + q.y) * 1.04719755;
  let radius = .5 + cos(tubeAngle) * .17;
  return vec3f(cos(majorAngle) * radius, sin(tubeAngle) * .17, sin(majorAngle) * radius);
}
fn lifebuoyVertex(index: u32) -> vec3f {
  let cell = index / 6u;
  let corner = index % 6u;
  let majorSegment = cell / 10u;
  let tubeSegment = cell % 10u;
  let quad = array<vec2f, 6>(vec2f(0.,0.),vec2f(1.,0.),vec2f(0.,1.),vec2f(0.,1.),vec2f(1.,0.),vec2f(1.,1.));
  let q = quad[corner];
  let majorAngle = (f32(majorSegment) + q.x) * .26179939;
  let tubeAngle = (f32(tubeSegment) + q.y) * .62831853;
  let radius = .5 + cos(tubeAngle) * .17;
  return vec3f(cos(majorAngle) * radius, sin(tubeAngle) * .17, sin(majorAngle) * radius);
}
fn ballVertex(index: u32) -> vec3f {
  let cell = index / 6u;
  let corner = index % 6u;
  let longitudeSegment = cell / 8u;
  let latitudeSegment = cell % 8u;
  let quad = array<vec2f, 6>(vec2f(0.,0.),vec2f(1.,0.),vec2f(0.,1.),vec2f(0.,1.),vec2f(1.,0.),vec2f(1.,1.));
  let q = quad[corner];
  let longitude = (f32(longitudeSegment) + q.x) * .52359878;
  let latitude = (f32(latitudeSegment) + q.y) * .39269908;
  return vec3f(cos(longitude) * sin(latitude), cos(latitude), sin(longitude) * sin(latitude)) * .5;
}
fn beachSandHeightAt(localX: f32, localZ: f32, halfPlane: f32, blockSize: f32) -> f32 {
  let sourceX = -localX - blockSize * .5;
  let sourceZ = -localZ - blockSize * .5;
  let u = sourceX / (halfPlane * 2.0) + .5;
  let v = sourceZ / (halfPlane * 2.0) + .5;
  let shorelineZ = -halfPlane + halfPlane * 1.035 + (sin(u * 12.566371) * .70 + sin(u * 31.415928 + .8) * .30) * blockSize;
  let shorelineV = (shorelineZ + halfPlane) / (halfPlane * 2.0);
  let wetSlope = (.055 - blockSize) * smoothstep(0.0, shorelineV, v);
  let dryRise = .045 * smoothstep(shorelineV, 1.0, v);
  let submergedBar = .015 * smoothstep(shorelineV * .08, shorelineV * .28, v) * (1.0 - smoothstep(shorelineV * .55, shorelineV * .78, v));
  let wetT = v / max(shorelineV, .001);
  let originalSandHeight = blockSize + wetSlope + dryRise + submergedBar;
  let waveFloor = .055 - mix(.006, .018, smoothstep(.18, .88, wetT)) - .006;
  let submerged = 1.0 - smoothstep(.92, 1.0, wetT);
  return mix(originalSandHeight, min(originalSandHeight, waveFloor), submerged);
}
@vertex fn main(@builtin(vertex_index) vertexIndex: u32) -> BeachDecorOutput {
  var output: BeachDecorOutput;
  if (uniforms.progress > .98) { output.position = vec4f(0.,0.,-10.,1.); return output; }
  let blockSize = f32(${WGSL_BLOCK_SIZE});
  let halfPlane = uniforms.gridSize * blockSize * .5;
  var localPos = vec3f(0.); var color = vec3f(.86,.73,.56); var alpha = 1.;
  if (vertexIndex < SHELL_VERTICES * ${BEACH_SHELL_COUNT}u) {
    let shellIndex = vertexIndex / SHELL_VERTICES;
    let shellPositions = array<vec2f, 8>(
      vec2f(-.48,.34),vec2f(-.15,.08),vec2f(.32,.45),vec2f(-.56,-.54),
      vec2f(.58,.22),vec2f(-.66,.34),vec2f(.08,.51),vec2f(-.58,.08)
    );
    let shellScales = array<f32, 8>(.72,.52,.66,.84,.58,.70,.48,.62);
    let shellOnBeach = shellIndex == 3u || shellIndex == 5u;
    let baseHeight = select(.049, .118, shellOnBeach);
    localPos = vec3f(shellPositions[shellIndex].x * halfPlane, baseHeight, shellPositions[shellIndex].y * halfPlane) + shellVertex(vertexIndex % SHELL_VERTICES) * blockSize * shellScales[shellIndex];
    color = select(vec3f(.86,.72,.57), vec3f(.95,.83,.63), shellOnBeach);
  } else if (vertexIndex < SHELL_VERTICES * ${BEACH_SHELL_COUNT}u + STAR_VERTICES) {
    let pointIndex = (vertexIndex - SHELL_VERTICES * ${BEACH_SHELL_COUNT}u) / 3u;
    let cornerIndex = (vertexIndex - SHELL_VERTICES * ${BEACH_SHELL_COUNT}u) % 3u;
    let point = select(pointIndex + 1u, pointIndex, cornerIndex == 1u);
    let radius = select(.24, .62, point % 2u == 0u) * blockSize;
    let angle = f32(point) * .62831853;
    let starPoint = select(vec2f(0.), vec2f(cos(angle), sin(angle)) * radius, cornerIndex > 0u);
    localPos = vec3f(.16 * halfPlane + starPoint.x, .052, .58 * halfPlane + starPoint.y);
    color = vec3f(.88,.43,.16);
  } else if (vertexIndex < SHELL_VERTICES * ${BEACH_SHELL_COUNT}u + STAR_VERTICES + FISH_VERTICES * ${BEACH_FISH_COUNT}u) {
    if (uniforms.beachSeason > 1.5) { output.position = vec4f(0.,0.,-10.,1.); return output; }
    let fishIndex = (vertexIndex - SHELL_VERTICES * ${BEACH_SHELL_COUNT}u - STAR_VERTICES) / FISH_VERTICES;
    let fishPart = (vertexIndex - SHELL_VERTICES * ${BEACH_SHELL_COUNT}u - STAR_VERTICES) % FISH_VERTICES;
    let swimRadiusX = array<f32, 3>(.56,.68,.48)[fishIndex] * halfPlane;
    let swimRadiusZ = array<f32, 3>(.32,.42,.25)[fishIndex] * halfPlane;
    let swimSpeed = array<f32, 3>(.18,-.13,.23)[fishIndex];
    let fishScale = array<f32, 3>(.72,.58,.66)[fishIndex];
    let phase = array<f32, 3>(.4,2.2,4.6)[fishIndex];
    let angle = uniforms.time * swimSpeed + phase;
    // Broad elliptical routes cover the usable sea while staying inside its
    // shore and the two cut faces.
    let center = vec2f(cos(angle) * swimRadiusX, .50 * halfPlane + sin(angle) * swimRadiusZ);
    let direction = normalize(vec2f(-sin(angle) * swimRadiusX * sign(swimSpeed), cos(angle) * swimRadiusZ * sign(swimSpeed)));
    let side = vec2f(-direction.y, direction.x);
    // The three supplied fish have distinct proportions: slender, rounder,
    // and longer. Keep that distinction in the texture-free low-poly forms.
    let profile = fishVertex(fishPart) * blockSize * fishScale * 1.15;
    let shape = profile * array<vec2f, 3>(vec2f(1.12,.74),vec2f(.78,1.16),vec2f(1.02,.92))[fishIndex];
    let tailWag = select(0., sin(uniforms.time * (2. + fishScale) + phase) * blockSize * .14, fishPart >= 30u);
    localPos = vec3f(center.x + direction.x * shape.x + side.x * (shape.y + tailWag), .070, center.y + direction.y * shape.x + side.y * (shape.y + tailWag));
    color = array<vec3f, 3>(vec3f(.95,.55,.18),vec3f(.18,.62,.70),vec3f(.93,.78,.24))[fishIndex];
  } else {
    let seasonalIndex = vertexIndex - SHELL_VERTICES * ${BEACH_SHELL_COUNT}u - STAR_VERTICES - FISH_VERTICES * ${BEACH_FISH_COUNT}u;
    if (seasonalIndex < CRAB_VERTICES) {
      if (uniforms.beachSeason > .5) { output.position = vec4f(0.,0.,-10.,1.); return output; }
      // The crab repeatedly crosses the dry beach from L3 to L2. Its small,
      // deterministic drift avoids a mechanical straight-line walk.
      let crabLoop = fract(uniforms.time * .030 + .18);
      let walkingTowardL2 = crabLoop < .5;
      let crabTravel = select((1.0 - crabLoop) * 2.0, crabLoop * 2.0, walkingTowardL2);
      let crabX = mix(-.62 * halfPlane, .58 * halfPlane, crabTravel);
      let crabZ = -.42 * halfPlane + (sin(uniforms.time * .31) + sin(uniforms.time * .13 + 1.7) * .60) * blockSize * 1.8;
      // Sample the exact beach profile at the crab's location so its feet
      // remain above sand regardless of the shoreline irregularity.
      let crabSandHeight = beachSandHeightAt(crabX, crabZ, halfPlane, blockSize);
      let crabShape = crabVertex(seasonalIndex) * blockSize * 1.15;
      let walkingDirection = select(-1.0, 1.0, walkingTowardL2);
      // Crabs traverse the shore sideways: keep their body perpendicular to
      // L3→L2, turning 180° only when they reverse at either endpoint.
      let crabFacing = vec3f(crabShape.x * walkingDirection, crabShape.y, crabShape.z * walkingDirection);
      localPos = vec3f(crabX, crabSandHeight + .003, crabZ) + crabFacing;
      color = vec3f(.86,.22,.12);
    } else if (seasonalIndex < CRAB_VERTICES + KITE_VERTICES) {
      let kiteIndex = seasonalIndex - CRAB_VERTICES;
      if (uniforms.beachSeason > 1.5) {
        output.position = vec4f(0.,0.,-10.,1.); return output;
      } else {
      if (uniforms.beachSeason > .5) { output.position = vec4f(0.,0.,-10.,1.); return output; }
      let kiteViewRight = vec3f(cos(.78), 0., -sin(.78));
      let kiteViewUp = vec3f(sin(.78) * .522687, cos(.55), cos(.78) * .522687);
      let kitePhase = uniforms.time * .16;
      let kiteFigureEight = kiteViewRight * (sin(kitePhase) * blockSize * 3.0) + kiteViewUp * (sin(kitePhase * 2.0) * blockSize * 1.5);
      let kiteOrigin = vec3f(-.04 * halfPlane, .38, -.04 * halfPlane) + kiteFigureEight;
      if (kiteIndex < 12u) {
        // Build the diamond in the camera-facing vertical plane. The previous
        // world-plane rotation was nearly edge-on in the isometric view.
        let flatKite = kiteVertex(kiteIndex) * blockSize * 5.0;
        let kiteX = (flatKite.x - flatKite.y) * .70710678;
        let kiteY = (flatKite.x + flatKite.y) * .70710678;
        localPos = kiteOrigin + kiteViewRight * kiteX + kiteViewUp * kiteY;
        color = select(vec3f(.94,.30,.12), vec3f(.98,.78,.16), kiteIndex >= 6u);
      } else {
        // A thin two-triangle string runs from the kite's tail beyond the view.
        let stringCorner = kiteIndex - 12u;
        let stringQuad = array<vec2f, 6>(vec2f(0.,0.),vec2f(1.,0.),vec2f(0.,1.),vec2f(0.,1.),vec2f(1.,0.),vec2f(1.,1.));
        let q = stringQuad[stringCorner];
        let tailOffset = blockSize * 5.0 * .75 * .70710678;
        let stringStart = kiteOrigin + kiteViewRight * tailOffset - kiteViewUp * tailOffset;
        // The string ends above a real QR module, rather than beyond the scene.
        let stringEndX = -.18 * halfPlane;
        let stringEndZ = -halfPlane - blockSize * .5; // vertical plane L2
        let stringEndY = beachSandHeightAt(stringEndX, stringEndZ, halfPlane, blockSize) + blockSize * 5.0;
        let stringEnd = vec3f(stringEndX, stringEndY, stringEndZ);
        let stringDirection = normalize(stringEnd - stringStart);
        let stringSide = normalize(cross(stringDirection, vec3f(0.,1.,0.))) * blockSize * .025;
        localPos = mix(stringStart, stringEnd, q.x) + stringSide * (q.y - .5);
        color = vec3f(.48,.36,.20);
      }
      }
    } else if (seasonalIndex < CRAB_VERTICES + KITE_VERTICES + SURFBOARD_VERTICES) {
      if (uniforms.beachSeason > 1.5) {
        let autumnIndex = seasonalIndex - CRAB_VERTICES - KITE_VERTICES;
        let bucketCenter = vec3f(.38 * halfPlane, 0., -.22 * halfPlane);
        let bucketBase = beachSandHeightAt(bucketCenter.x, bucketCenter.z, halfPlane, blockSize);
        if (autumnIndex < 144u) {
          let bucket = cylinderVertex(autumnIndex);
          localPos = vec3f(bucketCenter.x + bucket.x * blockSize * 1.6, bucketBase + bucket.y * blockSize * 2.0, bucketCenter.z + bucket.z * blockSize * 1.6);
          color = vec3f(.20,.46,.66);
        } else if (autumnIndex < 288u) {
          let handle = torusVertex(autumnIndex - 144u);
          localPos = vec3f(bucketCenter.x + handle.x * blockSize * 1.55, bucketBase + blockSize * 2.0 + handle.y * blockSize * .8, bucketCenter.z + handle.z * blockSize * .28);
          color = vec3f(.14,.33,.52);
        } else if (autumnIndex < 288u + ${BEACH_AUTUMN_CLOUD_VERTICES}u) {
          let cloudVertex = autumnIndex - 288u;
          let cloudPart = cloudVertex / 576u;
          let cloud = ballVertex(cloudVertex % 576u);
          let cloudSeed = f32(cloudPart) * 17.31;
          let cloudColumn = cloudPart % 13u;
          let columnT = f32(cloudColumn) / 12.0;
          let edgeDistance = min(columnT, 1.0 - columnT);
          // Compensate the isometric projection: end columns reach L3/L1.
          let spreadX = mix(-1., 1., columnT) + (fract(sin(cloudSeed) * 43758.5) - .5) * min(.055, edgeDistance * .22);
          // Only the sea half: Z=0 (midpoint) through L4 (+Z).
          let spreadZ = fract(sin(cloudSeed * 1.71 + 4.2) * 43758.5);
          let heightOffset = fract(sin(cloudSeed * 2.37 + 9.1) * 43758.5) * .010;
          let widthSeed = fract(sin(cloudSeed * 3.11 + 2.4) * 43758.5);
          let heightSeed = fract(sin(cloudSeed * 5.17 + 1.3) * 43758.5);
          let depthSeed = fract(sin(cloudSeed * 7.07 + 8.6) * 43758.5);
          let shadeSeed = fract(sin(cloudSeed * 4.23 + 6.8) * 43758.5);
          let cloudCenter = vec3f(spreadX * halfPlane, .44 + heightOffset, spreadZ * halfPlane);
          let cloudScale = vec3f(2.3 + widthSeed * 4.2, 1.05 + heightSeed * 1.15, 1.5 + depthSeed * 2.6) * blockSize;
          localPos = cloudCenter + cloud * cloudScale;
          color = mix(vec3f(.52,.57,.61), vec3f(.73,.76,.76), shadeSeed);
          // Random cloud groups flash twice per lightning event.
          let flashCycle = floor(uniforms.time * .72);
          let flashSeed = fract(sin(cloudSeed * 9.71 + flashCycle * 41.13) * 43758.5);
          let flashTime = fract(uniforms.time * .72);
          let firstBlink = smoothstep(.015, .045, flashTime) * (1. - smoothstep(.085, .125, flashTime));
          let secondBlink = smoothstep(.155, .185, flashTime) * (1. - smoothstep(.225, .275, flashTime));
          let flash = step(.946, flashSeed) * max(firstBlink, secondBlink);
          let flashColor = mix(color, vec3f(1.0), .50);
          color = mix(color, flashColor, flash * .85);
        } else {
          // Two static catches rest just above the bucket rim.
          let fishIndex = (autumnIndex - 288u - ${BEACH_AUTUMN_CLOUD_VERTICES}u) / FISH_VERTICES;
          let fishPart = (autumnIndex - 288u - ${BEACH_AUTUMN_CLOUD_VERTICES}u) % FISH_VERTICES;
          let profile = fishVertex(fishPart) * blockSize * .78;
          let fishOffset = array<vec2f, 2>(vec2f(-.16,.05), vec2f(.16,-.08))[fishIndex] * blockSize;
          localPos = vec3f(bucketCenter.x + profile.x + fishOffset.x, bucketBase + blockSize * 2.045 + f32(fishIndex) * blockSize * .08, bucketCenter.z + profile.y + fishOffset.y);
          color = array<vec3f, 2>(vec3f(.80,.62,.30), vec3f(.44,.66,.58))[fishIndex];
        }
      } else {
      if (uniforms.beachSeason > .5) { output.position = vec4f(0.,0.,-10.,1.); return output; }
      // Same long, rounded silhouette as the surf mesh in the supplied kit.
      let surfIndex = seasonalIndex - CRAB_VERTICES - KITE_VERTICES;
      if (surfIndex >= 576u) { output.position = vec4f(0.,0.,-10.,1.); return output; }
      let surfCenter = vec3f(.26 * halfPlane + blockSize * 5.0, 0., -.18 * halfPlane - blockSize * 6.0);
      let surfBase = beachSandHeightAt(surfCenter.x, surfCenter.z, halfPlane, blockSize);
      let surfShape = ballVertex(surfIndex);
      let surfAngle = -.58;
      let surfWidth = surfShape.x * blockSize * 2.75;
      let surfThickness = surfShape.z * blockSize * .42;
      let surfHeight = (surfShape.y + .5) * blockSize * 8.0;
      let surfY = surfBase - .020 + surfHeight;
      // The lower 0.020 is genuinely below the sand, not merely offset there.
      if (surfY < surfBase) { output.position = vec4f(0.,0.,-10.,1.); return output; }
      localPos = vec3f(surfCenter.x + cos(surfAngle) * surfWidth - sin(surfAngle) * surfThickness, surfY, surfCenter.z + sin(surfAngle) * surfWidth + cos(surfAngle) * surfThickness);
      let blueRail = smoothstep(.37,.48,abs(surfShape.x));
      let blueStringer = 1.0 - smoothstep(.055,.12,abs(surfShape.x));
      color = mix(vec3f(.94,.94,.89), vec3f(.08,.42,.68), max(blueRail, blueStringer));
      }
    } else if (seasonalIndex < CRAB_VERTICES + KITE_VERTICES + SURFBOARD_VERTICES + UMBRELLA_VERTICES) {
      // Summer only: a fixed straw umbrella rooted in the dry beach.
      if (uniforms.beachSeason < .5 || uniforms.beachSeason > 1.5) { output.position = vec4f(0.,0.,-10.,1.); return output; }
      let umbrellaIndex = seasonalIndex - CRAB_VERTICES - KITE_VERTICES - SURFBOARD_VERTICES;
      // Shift toward L2, leaving a clear strip between the umbrella and lounger.
      let umbrellaBase = vec3f(.47 * halfPlane, .108, -.58 * halfPlane);
      // Draw the mast first: the arched canopy naturally covers the portion
      // that passes through its middle instead of looking perched on top.
      if (umbrellaIndex < 6u) {
        let mastCorner = umbrellaIndex;
        let mastQuad = array<vec2f, 6>(vec2f(0.,0.),vec2f(1.,0.),vec2f(0.,1.),vec2f(0.,1.),vec2f(1.,0.),vec2f(1.,1.));
        let q = mastQuad[mastCorner];
        localPos = umbrellaBase + vec3f((q.x - .5) * blockSize * .3995, q.y * .24905, 0.);
        color = BEACH_WOOD_COLOR;
      } else {
        let canopyVertex = umbrellaIndex - 6u;
        let segment = canopyVertex / 24u;
        let band = (canopyVertex % 24u) / 6u;
        let corner = canopyVertex % 6u;
        let canopyQuad = array<vec2f, 6>(vec2f(0.,0.),vec2f(1.,0.),vec2f(0.,1.),vec2f(0.,1.),vec2f(1.,0.),vec2f(1.,1.));
        let q = canopyQuad[corner];
        let innerT = f32(band) * .25;
        let outerT = innerT + .25;
        let radialT = mix(innerT, outerT, q.x);
        let angle = (f32(segment) + q.y) * .52359878;
        let canopyRadius = blockSize * 4.675 * radialT;
        let canopyHeight = .2601 - .0799 * radialT * radialT;
        localPos = umbrellaBase + vec3f(cos(angle) * canopyRadius, canopyHeight, sin(angle) * canopyRadius);
        color = mix(BEACH_STRAW_COLOR, BEACH_CANVAS_COLOR, f32(segment % 2u) * .82 + radialT * .12);
      }
    } else if (seasonalIndex < CRAB_VERTICES + KITE_VERTICES + SURFBOARD_VERTICES + UMBRELLA_VERTICES + LOUNGER_VERTICES) {
      // Summer lounger, based on the kit's separate wooden slats and frame.
      if (uniforms.beachSeason < .5 || uniforms.beachSeason > 1.5) { output.position = vec4f(0.,0.,-10.,1.); return output; }
      let loungerIndex = seasonalIndex - CRAB_VERTICES - KITE_VERTICES - SURFBOARD_VERTICES - UMBRELLA_VERTICES;
      let loungerCenter = vec3f(-.12 * halfPlane + blockSize * 3.0, 0., -.54 * halfPlane);
      let loungerBase = vec3f(loungerCenter.x, beachSandHeightAt(loungerCenter.x, loungerCenter.z, halfPlane, blockSize), loungerCenter.z);
      let loungerLegHeight = .020;
      // The frame is emitted first. This is important in the transparent
      // decoration pass: the slatted bed must remain visibly in front of it.
      if (loungerIndex < 144u) {
        let frameIndex = loungerIndex / 36u;
        let frame = boxVertex(loungerIndex % 36u);
        let frameOffsets = array<vec2f, 4>(vec2f(-1.82,3.7),vec2f(1.82,3.7),vec2f(-1.82,-3.3),vec2f(1.82,-3.3));
        let frameOffset = frameOffsets[frameIndex] * blockSize;
        localPos = loungerBase + vec3f((frameOffset.x + frame.x * blockSize * .20) * .8, (frame.y + .5) * loungerLegHeight, (frameOffset.y + frame.z * blockSize * .20) * .8);
        color = BEACH_WOOD_COLOR;
      } else {
        // Reversing Z turns the chair 180°: its reclined end now faces away
        // from the previous orientation while retaining its position.
        let slatIndex = (loungerIndex - 144u) / 36u;
        let slat = boxVertex((loungerIndex - 144u) % 36u);
        let isBack = slatIndex >= 12u;
        let localSlat = select(slatIndex, slatIndex - 12u, isBack);
        let slatZ = -select((f32(localSlat) - 5.5) * blockSize * .68, blockSize * 4.25 + f32(localSlat) * blockSize * .53, isBack);
        let backRise = select(0., f32(localSlat) * blockSize * .32, isBack);
        let slatScale = select(vec3f(blockSize * 4.0,.016,blockSize * .52), vec3f(blockSize * 4.0,.016,blockSize * .48), isBack);
        localPos = loungerBase + vec3f(slat.x * slatScale.x, .033 + backRise + slat.y * slatScale.y, slatZ + slat.z * slatScale.z) * .8;
        color = mix(BEACH_STRAW_COLOR, BEACH_CANVAS_COLOR, f32(slatIndex % 2u) * .38);
      }
    } else if (seasonalIndex < CRAB_VERTICES + KITE_VERTICES + SURFBOARD_VERTICES + UMBRELLA_VERTICES + LOUNGER_VERTICES + ${BEACH_SUMMER_TOY_VERTICES}u) {
      // Summer toys use rounded, multi-face forms derived from the asset kit.
      if (uniforms.beachSeason < .5 || uniforms.beachSeason > 1.5) { output.position = vec4f(0.,0.,-10.,1.); return output; }
      let toyIndex = seasonalIndex - CRAB_VERTICES - KITE_VERTICES - SURFBOARD_VERTICES - UMBRELLA_VERTICES - LOUNGER_VERTICES;
      if (toyIndex < CASTLE_VERTICES) {
        let castleCenter = vec3f(-.82 * halfPlane, 0., -.72 * halfPlane);
        let castleBase = vec3f(castleCenter.x, beachSandHeightAt(castleCenter.x, castleCenter.z, halfPlane, blockSize), castleCenter.z);
        let castleTowerHeight = .045;
        let castleRoofHeight = .0216;
        if (toyIndex < 144u) {
          let tower = cylinderVertex(toyIndex);
          localPos = castleBase + vec3f(tower.x * blockSize * 2.025, tower.y * castleTowerHeight, tower.z * blockSize * 2.025);
          color = mix(vec3f(.70,.50,.24), vec3f(.87,.68,.38), tower.y * .26);
        } else if (toyIndex < 216u) {
          let roof = coneVertex(toyIndex - 144u);
          localPos = castleBase + vec3f(roof.x * blockSize * 2.205, castleTowerHeight + roof.y * castleRoofHeight, roof.z * blockSize * 2.205);
          color = vec3f(.78,.57,.29);
        } else if (toyIndex < 432u) {
          let merlonIndex = (toyIndex - 216u) / 36u;
          let merlon = boxVertex((toyIndex - 216u) % 36u);
          let merlonAngle = f32(merlonIndex) * 1.04719755;
          let merlonOffset = vec2f(cos(merlonAngle), sin(merlonAngle)) * blockSize * .846;
          localPos = castleBase + vec3f(merlonOffset.x + merlon.x * blockSize * .342, castleTowerHeight + (merlon.y + .5) * .015, merlonOffset.y + merlon.z * blockSize * .342);
          color = vec3f(.74,.53,.27);
        } else {
          // Door faces the L3-L2 corner: negative X and negative Z.
          let doorIndex = toyIndex - 432u;
          let doorArch = array<vec2f, 18>(
            vec2f(-.5,0.),vec2f(.5,0.),vec2f(.5,.65), vec2f(-.5,0.),vec2f(.5,.65),vec2f(-.5,.65),
            vec2f(0.,.65),vec2f(-.5,.65),vec2f(-.353,1.003), vec2f(0.,.65),vec2f(-.353,1.003),vec2f(0.,1.15),
            vec2f(0.,.65),vec2f(0.,1.15),vec2f(.353,1.003), vec2f(0.,.65),vec2f(.353,1.003),vec2f(.5,.65)
          );
          let q = doorArch[doorIndex];
          let doorDirection = normalize(vec2f(-1., -1.));
          let doorTangent = vec2f(-doorDirection.y, doorDirection.x);
          let doorCenter = vec2f(castleCenter.x, castleCenter.z) + doorDirection * blockSize * 1.03;
          localPos = vec3f(doorCenter.x + doorTangent.x * q.x * blockSize * .805, castleBase.y + q.y * .02016, doorCenter.y + doorTangent.y * q.x * blockSize * .805);
          color = vec3f(.35,.24,.12);
        }
      } else if (toyIndex < CASTLE_VERTICES + BUCKET_VERTICES) {
        let bucketIndex = toyIndex - CASTLE_VERTICES;
        let bucketCenter = vec3f(-.54 * halfPlane + blockSize, 0., -.65 * halfPlane - blockSize);
        let bucketSurfaceHeight = beachSandHeightAt(bucketCenter.x, bucketCenter.z, halfPlane, blockSize);
        let bucketHeight = .05625;
        if (bucketIndex < 144u) {
          let bucket = cylinderVertex(bucketIndex);
          let taperedRadius = mix(.86, 1.12, bucket.y);
          localPos = vec3f(bucketCenter.x + bucket.x * blockSize * 2.025 * taperedRadius, bucketSurfaceHeight + bucket.y * bucketHeight, bucketCenter.z + bucket.z * blockSize * 2.025 * taperedRadius);
          color = vec3f(.15,.58,.69);
        } else {
          let handle = torusVertex(bucketIndex - 144u);
          localPos = vec3f(bucketCenter.x + handle.x * blockSize * 2.115, bucketSurfaceHeight + bucketHeight + handle.y * blockSize * 1.10, bucketCenter.z + handle.z * blockSize * .27);
          color = vec3f(.12,.43,.55);
        }
      } else if (toyIndex < CASTLE_VERTICES + BUCKET_VERTICES + SHOVEL_VERTICES) {
        let shovelIndex = toyIndex - CASTLE_VERTICES - BUCKET_VERTICES;
        let shovelCenter = vec3f(-.36 * halfPlane, 0., -.82 * halfPlane);
        let shovel = array<vec3f, 12>(
          vec3f(-.05,0.,-.44),vec3f(.05,0.,-.44),vec3f(-.05,0.,.20),vec3f(-.05,0.,.20),vec3f(.05,0.,-.44),vec3f(.05,0.,.20),
          vec3f(-.23,0.,.20),vec3f(.23,0.,.20),vec3f(.15,0.,.52),vec3f(-.23,0.,.20),vec3f(.15,0.,.52),vec3f(-.15,0.,.52)
        );
        let shovelSurfaceHeight = beachSandHeightAt(shovelCenter.x, shovelCenter.z, halfPlane, blockSize);
        let shovelScale = blockSize * 2.7;
        let shovelShape = shovel[shovelIndex];
        // The scoop tip (z=.52) enters the sand. Its handle rises 20° away
        // from vertical, rather than lying flat on the beach.
        let heightFromSand = (.52 - shovelShape.z) * shovelScale;
        localPos = vec3f(shovelCenter.x + shovelShape.x * shovelScale, shovelSurfaceHeight + heightFromSand * .93969262, shovelCenter.z + heightFromSand * .34202014);
        color = vec3f(.94,.42,.12);
      } else if (toyIndex < CASTLE_VERTICES + BUCKET_VERTICES + SHOVEL_VERTICES + LIFEBUOY_VERTICES) {
        let buoy = lifebuoyVertex(toyIndex - CASTLE_VERTICES - BUCKET_VERTICES - SHOVEL_VERTICES);
        // A buoy floats independently on the water, away from the sand toys.
        let wavePhase = fract(uniforms.time * .30) * 3.14159265;
        let buoyCenterHeight = .045 + sin(wavePhase) * .007;
        localPos = vec3f(-.55 * halfPlane + buoy.x * blockSize * 2.88, buoyCenterHeight + buoy.y * blockSize * 2.88, .48 * halfPlane + buoy.z * blockSize * 2.88);
        color = select(BEACH_CANVAS_COLOR, BEACH_STRAW_COLOR, (toyIndex / 240u) % 2u == 0u);
      } else {
        let ball = ballVertex(toyIndex - CASTLE_VERTICES - BUCKET_VERTICES - SHOVEL_VERTICES - LIFEBUOY_VERTICES);
        // Sample the same sand profile used by the terrain before placing the
        // sphere, so its lowest point always rests on the beach.
        let ballCenterX = .47 * halfPlane + blockSize * 3.5;
        let ballCenterZ = -.58 * halfPlane + blockSize * .9;
        let ballSurfaceHeight = beachSandHeightAt(ballCenterX, ballCenterZ, halfPlane, blockSize);
        localPos = vec3f(ballCenterX + ball.x * blockSize * 2.07, ballSurfaceHeight + (ball.y + .5) * blockSize * 2.07, ballCenterZ + ball.z * blockSize * 2.07);
        color = select(BEACH_CANVAS_COLOR, BEACH_STRAW_COLOR, (toyIndex / 48u) % 2u == 0u);
      }
    } else {
      // Two autumn fishing floats, each with an expanding, fading ripple.
      if (uniforms.beachSeason < 1.5) { output.position = vec4f(0.,0.,-10.,1.); return output; }
      let floatIndex = seasonalIndex - CRAB_VERTICES - KITE_VERTICES - SURFBOARD_VERTICES - UMBRELLA_VERTICES - LOUNGER_VERTICES - ${BEACH_SUMMER_TOY_VERTICES}u;
      let floatNumber = floatIndex / 726u;
      let floatPart = floatIndex % 726u;
      // The rods start on the sand; their lines end on the water half.
      let floatCenter = array<vec2f, 2>(vec2f(-.28, .42), vec2f(.08, .42))[floatNumber] * halfPlane;
      let wavePhase = uniforms.time * .30 + f32(floatNumber) * 2.4;
      let waterY = .045 + sin(wavePhase) * .007;
      if (floatPart < 576u) {
        let bobber = ballVertex(floatPart);
        localPos = vec3f(floatCenter.x + bobber.x * blockSize * .42, waterY + bobber.y * blockSize * .68, floatCenter.y + bobber.z * blockSize * .42);
        color = select(vec3f(.94,.92,.82), vec3f(.86,.20,.12), bobber.y > 0.);
      } else if (floatPart < 720u) {
        let ringIndex = floatPart - 576u;
        let segment = ringIndex / 6u;
        let corner = ringIndex % 6u;
        let rippleQuad = array<vec2f, 6>(vec2f(0.,0.),vec2f(1.,0.),vec2f(0.,1.),vec2f(0.,1.),vec2f(1.,0.),vec2f(1.,1.));
        let rippleCorner = rippleQuad[corner];
        let rippleAngle = (f32(segment) + rippleCorner.x) / 24. * 6.2831853;
        let rippleCycle = fract(uniforms.time * .30 + f32(floatNumber) * .382);
        let rippleRadius = blockSize * (.16 + rippleCycle * 1.65) + (rippleCorner.y - .5) * blockSize * .045;
        localPos = vec3f(floatCenter.x + cos(rippleAngle) * rippleRadius, .045 + blockSize * .014, floatCenter.y + sin(rippleAngle) * rippleRadius);
        alpha = smoothstep(.0, .07, rippleCycle) * (1. - smoothstep(.58, .96, rippleCycle)) * .38;
        color = vec3f(.72,.92,1.0);
      } else {
        let lineCorner = floatPart - 720u;
        let lineQuad = array<vec2f, 6>(vec2f(0.,0.),vec2f(1.,0.),vec2f(0.,1.),vec2f(0.,1.),vec2f(1.,0.),vec2f(1.,1.));
        let lineQ = lineQuad[lineCorner];
        let rodYaw = select(.32, -.32, floatNumber == 0u);
        let rodRoot = array<vec2f, 2>(vec2f(-.28, -.12), vec2f(.08, -.12))[floatNumber] * halfPlane;
        let rodTip = vec3f(rodRoot.x - sin(rodYaw) * .040, .105, rodRoot.y + cos(rodYaw) * .040);
        let floatTop = vec3f(floatCenter.x, waterY + blockSize * .34, floatCenter.y);
        let lineDirection = normalize(rodTip - floatTop);
        let lineSide = normalize(cross(lineDirection, vec3f(0.,1.,0.))) * blockSize * .018;
        localPos = mix(floatTop, rodTip, lineQ.x) + lineSide * (lineQ.y - .5);
        color = vec3f(.16,.18,.16);
      }
    }
  }
  // Decorations share the same QR-cell origin as the terrain surface.
  localPos += vec3f(-blockSize * .5, 0., -blockSize * .5);
  output.color = color; output.alpha = alpha; output.normal = vec3f(0.,1.,0.);
  let progress = uniforms.progress;
  ${createIsometricTransformWgsl("localPos")}
  output.position = vec4f((ry_x + xOffsetScene) * scaleX, (rx_y + yOffsetScene) * scaleY, rx_z * .01 + .498, 1.0);
  return output;
}`;
            const BEACH_DECOR_FRAGMENT_SHADER = `${SCENE_UNIFORM_WGSL}
struct BeachDecorInput { @location(0) color: vec3f, @location(1) alpha: f32, @location(2) normal: vec3f }
@fragment fn main(input: BeachDecorInput) -> @location(0) vec4f {
  let light = .48 + max(dot(normalize(input.normal), normalize(vec3f(-.45,.80,.35))), 0.) * .72;
  return vec4f(input.color * light * input.alpha, input.alpha);
}`;
            try { beachDecorPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, { vertex: BEACH_DECOR_VERTEX_SHADER, fragment: BEACH_DECOR_FRAGMENT_SHADER, depthWrite: true, depthCompare: "less-equal", blend: ALPHA_BLEND_STATE }); }
            catch (beachDecorPipelineError) { console.error("Beach decorations pipeline failed:", beachDecorPipelineError); }
            const BEACH_MODEL_VERTEX_SHADER = `${SCENE_UNIFORM_WGSL}
struct ModelUniform { positionScale: vec4f, rotationSeason: vec4f, color: vec4f }
struct ModelInput { @location(0) position: vec3f, @location(1) normal: vec3f }
struct ModelOutput { @builtin(position) position: vec4f, @location(0) color: vec3f, @location(1) normal: vec3f }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<uniform> model: ModelUniform;
fn beachModelHeight(localX: f32, localZ: f32, halfPlane: f32, blockSize: f32) -> f32 {
  let sourceX = -localX - blockSize * .5;
  let sourceZ = -localZ - blockSize * .5;
  let u = sourceX / (halfPlane * 2.) + .5;
  let v = sourceZ / (halfPlane * 2.) + .5;
  let shorelineZ = -halfPlane + halfPlane * 1.035 + (sin(u * 12.566371) * .70 + sin(u * 31.415928 + .8) * .30) * blockSize;
  let shorelineV = (shorelineZ + halfPlane) / (halfPlane * 2.);
  let wetT = v / max(shorelineV, .001);
  let originalHeight = blockSize + (.055 - blockSize) * smoothstep(0., shorelineV, v) + .045 * smoothstep(shorelineV, 1., v) + .015 * smoothstep(shorelineV * .08, shorelineV * .28, v) * (1. - smoothstep(shorelineV * .55, shorelineV * .78, v));
  let waveFloor = .055 - mix(.006, .018, smoothstep(.18, .88, wetT)) - .006;
  return mix(originalHeight, min(originalHeight, waveFloor), 1. - smoothstep(.92, 1., wetT));
}
@vertex fn main(input: ModelInput) -> ModelOutput {
  var output: ModelOutput;
  if (abs(uniforms.beachSeason - model.rotationSeason.y) > .49) { output.position = vec4f(0., 0., -10., 1.); return output; }
  let scale = model.positionScale.w;
  let tilt = model.rotationSeason.z;
  let tiltCos = cos(tilt); let tiltSin = sin(tilt);
  let tilted = vec3f(input.position.x, input.position.y * tiltCos - input.position.z * tiltSin, input.position.y * tiltSin + input.position.z * tiltCos);
  let tiltedNormal = vec3f(input.normal.x, input.normal.y * tiltCos - input.normal.z * tiltSin, input.normal.y * tiltSin + input.normal.z * tiltCos);
  let yaw = model.rotationSeason.x;
  let yawCos = cos(yaw); let yawSin = sin(yaw);
  let rotated = vec3f(tilted.x * yawCos - tilted.z * yawSin, tilted.y, tilted.x * yawSin + tilted.z * yawCos);
  let normal = normalize(vec3f(tiltedNormal.x * yawCos - tiltedNormal.z * yawSin, tiltedNormal.y, tiltedNormal.x * yawSin + tiltedNormal.z * yawCos));
  let halfPlane = uniforms.gridSize * ${WGSL_BLOCK_SIZE} * .5;
  let base = beachModelHeight(model.positionScale.x, model.positionScale.z, halfPlane, ${WGSL_BLOCK_SIZE});
  var localPos = vec3f(model.positionScale.x, base + model.positionScale.y, model.positionScale.z) + rotated * scale - vec3f(${WGSL_BLOCK_SIZE} * .5, 0., ${WGSL_BLOCK_SIZE} * .5);
  let progress = uniforms.progress;
  ${createIsometricTransformWgsl("localPos")}
  output.position = vec4f((ry_x + xOffsetScene) * scaleX, (rx_y + yOffsetScene) * scaleY, rx_z * .01 + .496, 1.);
  output.color = model.color.rgb; output.normal = normal; return output;
}`;
            const BEACH_MODEL_FRAGMENT_SHADER = `${SCENE_UNIFORM_WGSL}
struct ModelOutput { @builtin(position) position: vec4f, @location(0) color: vec3f, @location(1) normal: vec3f }
@fragment fn main(input: ModelOutput) -> @location(0) vec4f {
  let light = .42 + max(dot(normalize(input.normal), normalize(vec3f(-.45,.80,.35))), 0.) * .72;
  return vec4f(input.color * light, 1.);
}`;
            let beachModelPipeline = null;
            try { beachModelPipeline = createScenePipeline(deviceAt354206, textureFormat, createBindGroupLayout(deviceAt354206, { entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }, { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }] }), { vertex: BEACH_MODEL_VERTEX_SHADER, fragment: BEACH_MODEL_FRAGMENT_SHADER, depthWrite: true, depthCompare: "less-equal", blend: ALPHA_BLEND_STATE, vertexBuffers: [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x3" }] }] }); }
            catch (beachModelPipelineError) { console.error("Beach model pipeline failed:", beachModelPipelineError); }
            const createBeachModel = (vertices, indices, indexCount, uniformValues) => {
              if (!beachModelPipeline) return null;
              const uniformBuffer = createUniformBuffer(deviceAt354206, 48);
              deviceAt354206.queue.writeBuffer(uniformBuffer, 0, uniformValues);
              return { vertexBuffer: createVertexBuffer(deviceAt354206, vertices), indexBuffer: createIndexBuffer(deviceAt354206, indices), indexCount, indexFormat: indices instanceof Uint32Array ? "uint32" : "uint16", uniformBuffer, uniformValues, bindGroup: createBindGroup(deviceAt354206, { layout: beachModelPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: blockUniforms } }, { binding: 1, resource: { buffer: uniformBuffer } }] }) };
            };
            const beachModels = [
              createBeachModel(BEACH_CRAB_VERTICES, BEACH_CRAB_INDICES, BEACH_CRAB_INDEX_COUNT, new Float32Array([0, .003, 0, .060, 0, 0, 0, 0, .78, .14, .06, 1])),
              createBeachModel(BEACH_CASTLE_VERTICES, BEACH_CASTLE_INDICES, BEACH_CASTLE_INDEX_COUNT, new Float32Array([0, 0, 0, .092, 0, 1, 0, 0, .76, .56, .28, 1])),
              createBeachModel(BEACH_LOUNGER_VERTICES, BEACH_LOUNGER_INDICES, BEACH_LOUNGER_INDEX_COUNT, new Float32Array([0, 0, 0, .145, 3.14159, 1, 0, 0, .84, .67, .35, 1])),
              createBeachModel(BEACH_FISHING_ROD_VERTICES, BEACH_FISHING_ROD_INDICES, BEACH_FISHING_ROD_INDEX_COUNT, new Float32Array([0, 0, 0, .22, 0, 2, -1.20, 0, .20, .12, .05, 1])),
              createBeachModel(BEACH_FISHING_ROD_VERTICES, BEACH_FISHING_ROD_INDICES, BEACH_FISHING_ROD_INDEX_COUNT, new Float32Array([0, 0, 0, .22, 0, 2, -1.20, 0, .20, .12, .05, 1])),
            ].filter(Boolean);
            const PEBBLE_VERTEX_SHADER = `${SCENE_UNIFORM_WGSL}
struct PebbleOutput {
  @builtin(position) position: vec4f,
  @location(0) heightT: f32,
  @location(1) normalY: f32,
  @location(2) seed: f32,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> pebbleData: array<vec4f>;
@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> PebbleOutput {
  var output: PebbleOutput;
  let pebbleIndex = vertexIndex / 54u;
  let vertexInPebble = vertexIndex % 54u;
  if (pebbleIndex >= u32(uniforms.blockCount)) {
    output.position = vec4f(0.0, 0.0, -10.0, 1.0);
    return output;
  }
  let progress = uniforms.progress;
  let visible = smoothstep(0.0, 0.3, 1.0 - progress);
  let data = pebbleData[pebbleIndex];
  let blockSize = f32(${WGSL_BLOCK_SIZE});
  let baseX = data.x * blockSize - uniforms.gridSize * blockSize * 0.5;
  let baseZ = data.y * blockSize - uniforms.gridSize * blockSize * 0.5;
  let angle = data.z * 6.2831853;
  let radius = data.w * blockSize * visible;
  let height = radius * (0.78 + fract(data.z * 11.7) * 0.68);
  let triangleIndex = vertexInPebble / 3u;
  let cornerIndex = vertexInPebble % 3u;
  var ringIndex: u32;
  var ringLevel: u32;
  var isApex = false;
  if (triangleIndex < 12u) {
    let sideIndex = triangleIndex / 2u;
    let isSecondSideTriangle = triangleIndex % 2u == 1u;
    if (cornerIndex == 0u) {
      ringIndex = select(sideIndex, (sideIndex + 1u) % 6u, isSecondSideTriangle);
      ringLevel = 0u;
    } else if (cornerIndex == 1u) {
      ringIndex = (sideIndex + 1u) % 6u;
      ringLevel = select(0u, 1u, isSecondSideTriangle);
    } else {
      ringIndex = sideIndex;
      ringLevel = 1u;
    }
  } else {
    ringIndex = (triangleIndex - 12u + cornerIndex) % 6u;
    ringLevel = 1u;
    isApex = cornerIndex == 2u;
  }
  let irregularity = 0.86 + fract(data.z * 83.1 + f32(ringIndex) * 17.3) * 0.28;
  let ringRadius = radius * irregularity * select(1.0, 0.66, ringLevel == 1u);
  let ringAngle = angle + f32(ringIndex) * 1.0471976;
  let ringHeight = blockSize * 1.02 + select(0.0, height * 0.62, ringLevel == 1u);
  var localPos = vec3f(baseX + cos(ringAngle) * ringRadius, ringHeight, baseZ + sin(ringAngle) * ringRadius);
  if (isApex) { localPos = vec3f(baseX, blockSize * 1.02 + height, baseZ); }
  output.heightT = select(f32(ringLevel) * 0.62, 1.0, isApex);
  output.normalY = mix(0.52, 0.94, output.heightT);
  output.seed = data.z;
  ${createIsometricTransformWgsl()}
  output.position = vec4f((ry_x + xOffsetScene) * scaleX, (rx_y + yOffsetScene) * scaleY, rx_z * 0.01 + 0.5, 1.0);
  return output;
}`;
            const PEBBLE_FRAGMENT_SHADER = `${SCENE_UNIFORM_WGSL}
struct PebbleInput {
  @location(0) heightT: f32,
  @location(1) normalY: f32,
  @location(2) seed: f32,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
${WGSL_ACES_FILM}
@fragment
fn main(input: PebbleInput) -> @location(0) vec4f {
  let shade = fract(input.seed * 7.31);
  let darkStone = vec3f(0.26, 0.22, 0.19);
  let warmStone = vec3f(0.47, 0.34, 0.24);
  let coolStone = vec3f(0.33, 0.37, 0.36);
  var stone = mix(darkStone, warmStone, shade);
  if (shade > 0.72) { stone = mix(stone, coolStone, 0.62); }
  stone = mix(stone * 0.82, stone * 1.12, input.heightT);
  let sun = max(dot(normalize(vec3f(0.0, input.normalY, 0.4)), vec3f(-0.405616, 0.861934, -0.304212)), 0.0);
  let lit = stone * (vec3f(0.24) + vec3f(1.2) * sun * 0.82);
  let hdr = acesFilm(lit * 1.05);
  return vec4f(pow(hdr, vec3f(1.0 / 2.2)), 1.0);
}`;
            let pebblePipeline = null;
            try {
              pebblePipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
                vertex: PEBBLE_VERTEX_SHADER, /*
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct GrassOutput {\n  @builtin(position) position: vec4f,\n  @location(0) greenT: f32,\n  @location(1) normalY: f32,\n  @location(2) seed: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n@group(0) @binding(1) var<storage, read> grassData: array<vec4f>;\n\nconst PI: f32 = 3.14159265;\n\n@vertex\nfn main(@builtin(vertex_index) vertexIndex: u32) -> GrassOutput {\n  var output: GrassOutput;\n\n  let bladeIdx = vertexIndex / 3u;\n  let vertIdx = vertexIndex % 3u;\n\n  let grassCount = u32(uniforms.blockCount);\n  if (bladeIdx >= grassCount) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let progress = uniforms.progress;\n  let vis = smoothstep(0.0, 0.3, 1.0 - progress);\n  if (vis < 0.01) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let data = grassData[bladeIdx];\n  let col = data.x;\n  let row = data.y;\n  let seed = data.z;\n  let bladeHeight = data.w * vis;\n\n  output.seed = seed;\n\n  let blockSize = f32(" +
                  WGSL_BLOCK_SIZE +
                  ");\n  let gridSize = uniforms.gridSize;\n  let halfGrid = gridSize * blockSize * 0.5;\n\n  let baseX = col * blockSize - halfGrid;\n  let baseY = 0.0;\n  let baseZ = row * blockSize - halfGrid;\n\n  let angle = seed * PI * 2.0;\n  let cosA = cos(angle);\n  let sinA = sin(angle);\n\n  let halfWidth = blockSize * 0.22;\n\n  var localPos = vec3f(0.0);\n\n  let tiltX = (seed - 0.5) * 0.4;\n  let tiltZ = (fract(seed * 7.13) - 0.5) * 0.4;\n  let time = uniforms.time;\n  let windBase = sin(time * 0.45 + col * 0.25 + row * 0.15) * 0.02;\n  let windTurb = sin(time * 1.1 + col * 0.8 + row * 0.6) * 0.005;\n  let windX = windBase + windTurb;\n  let windZ = sin(time * 0.35 + col * 0.15 + row * 0.25) * 0.012;\n  let tipOffX = (tiltX + windX) * bladeHeight * 4.0;\n  let tipOffZ = (tiltZ + windZ) * bladeHeight * 4.0;\n\n  let yLift = blockSize * 1.0;\n\n  if (vertIdx == 0u) {\n    localPos = vec3f(baseX - halfWidth * cosA, baseY + yLift, baseZ - halfWidth * sinA);\n    output.greenT = 0.0;\n    output.normalY = 0.3;\n  } else if (vertIdx == 1u) {\n    localPos = vec3f(baseX + halfWidth * cosA, baseY + yLift, baseZ + halfWidth * sinA);\n    output.greenT = 0.0;\n    output.normalY = 0.3;\n  } else {\n    let curlDroop = bladeHeight * seed * 0.15;\n    localPos = vec3f(baseX + tipOffX, baseY + yLift + bladeHeight - curlDroop, baseZ + tipOffZ);\n    output.greenT = 1.0;\n    output.normalY = 0.9;\n  }\n\n  " +
                  createIsometricTransformWgsl() +
                  "\n  \n  output.position = vec4f(\n    (ry_x + xOffsetScene) * scaleX,\n    (rx_y + yOffsetScene) * scaleY,\n    rx_z * 0.01 + 0.5,\n    1.0\n  );\n\n\n  return output;\n}\n",
                */ fragment: PEBBLE_FRAGMENT_SHADER, /*
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct GrassInput {\n  @location(0) greenT: f32,\n  @location(1) normalY: f32,\n  @location(2) seed: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n\n" +
                  WGSL_ACES_FILM +
                  "\n\n@fragment\nfn main(input: GrassInput) -> @location(0) vec4f {\n  let season = uniforms.season;\n\n  var darkGreen  = vec3f(0.12, 0.32, 0.06);\n  var midGreen   = vec3f(0.22, 0.48, 0.12);\n  var lightGreen = vec3f(0.35, 0.58, 0.20);\n  var coralPink  = vec3f(0.65, 0.28, 0.30);\n  var dustyRose  = vec3f(0.55, 0.32, 0.28);\n  var mossGreen  = vec3f(0.30, 0.40, 0.15);\n  var yellowFlower = vec3f(0.75, 0.68, 0.20);\n  var whiteFlower = vec3f(0.88, 0.86, 0.78);\n  var lavender = vec3f(0.55, 0.42, 0.62);\n\n  if (season > 0.5 && season < 1.5) {\n    darkGreen  = vec3f(0.03, 0.16, 0.01);\n    midGreen   = vec3f(0.08, 0.28, 0.02);\n    lightGreen = vec3f(0.16, 0.38, 0.04);\n    mossGreen  = vec3f(0.10, 0.22, 0.02);\n    coralPink  = vec3f(0.12, 0.28, 0.03);\n    dustyRose  = vec3f(0.08, 0.22, 0.02);\n    yellowFlower = vec3f(0.44, 0.48, 0.10);\n    whiteFlower = vec3f(0.58, 0.64, 0.42);\n    lavender = vec3f(0.18, 0.30, 0.08);\n  } else if (season > 1.5 && season < 2.5) {\n    darkGreen  = vec3f(0.42, 0.24, 0.08);\n    midGreen   = vec3f(0.56, 0.32, 0.10);\n    lightGreen = vec3f(0.70, 0.42, 0.12);\n    mossGreen  = vec3f(0.50, 0.30, 0.08);\n    coralPink  = vec3f(0.62, 0.26, 0.10);\n    dustyRose  = vec3f(0.55, 0.28, 0.12);\n    yellowFlower = vec3f(0.76, 0.52, 0.14);\n    whiteFlower = vec3f(0.74, 0.62, 0.42);\n    lavender = vec3f(0.52, 0.32, 0.18);\n  }\n\n  let tier = fract(input.seed * 7.31);\n  var baseColor: vec3f;\n  var tipColor: vec3f;\n  if (tier < 0.22) { baseColor = darkGreen; tipColor = midGreen; }\n  else if (tier < 0.42) { baseColor = midGreen; tipColor = lightGreen; }\n  else if (tier < 0.55) { baseColor = mossGreen; tipColor = lightGreen; }\n  else if (tier < 0.68) { baseColor = dustyRose; tipColor = coralPink; }\n  else if (tier < 0.76) { baseColor = coralPink; tipColor = vec3f(0.72, 0.35, 0.35); }\n  else if (tier < 0.84) { baseColor = midGreen; tipColor = yellowFlower; }\n  else if (tier < 0.92) { baseColor = mossGreen; tipColor = whiteFlower; }\n  else { baseColor = dustyRose; tipColor = lavender; }\n\n  let color = mix(baseColor, tipColor, input.greenT);\n\n  const sunDir = vec3f(-0.405616, 0.861934, -0.304212);\n  let N = normalize(vec3f(0.0, input.normalY, 0.3));\n  let NdotL = max(dot(N, sunDir), 0.0);\n  let ambient = vec3f(0.22, 0.24, 0.18);\n  let sunCol = vec3f(1.20, 1.20, 1.20);\n\n  let lit = color * (ambient + sunCol * NdotL * 0.85);\n\n  let hdr = acesFilm(lit * 1.1);\n  var ldr = pow(hdr, vec3f(1.0 / 2.2));\n\n  let gray = dot(ldr, vec3f(0.299, 0.587, 0.114));\n  ldr = mix(vec3f(gray), ldr, 1.6);\n\n  return vec4f(ldr, 1.0);\n}\n",
                */ depthWrite: !0,
                depthCompare: "less",
              });
            } catch (pebblePipelineError) {
              console.error("Pebble pipeline failed (non-fatal):", pebblePipelineError);
            }
            let fallingPetalsPipeline = null;
            try {
              fallingPetalsPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
                vertex:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct FlowerOutput {\n  @builtin(position) position: vec4f,\n  @location(0) petalT: f32,\n  @location(1) normalX: f32,\n  @location(2) normalY: f32,\n  @location(3) normalZ: f32,\n  @location(4) seed: f32,\n  @location(5) isCenter: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n@group(0) @binding(1) var<storage, read> petalData: array<vec4f>;\n\nconst PI: f32 = 3.14159265;\n\n@vertex\nfn main(@builtin(vertex_index) vertexIndex: u32) -> FlowerOutput {\n  var output: FlowerOutput;\n\n  let vertsPerFlower = 150u;\n  let flowerIdx = vertexIndex / vertsPerFlower;\n  let localVert = vertexIndex % vertsPerFlower;\n\n  let petalCount = u32(uniforms.blockCount);\n  if (flowerIdx >= petalCount) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let progress = uniforms.progress;\n  let vis = smoothstep(0.0, 0.4, 1.0 - progress);\n  if (vis < 0.01) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let data = petalData[flowerIdx];\n  let col = data.x;\n  let row = data.y;\n  let topY = data.z;\n  let seed = data.w;\n  output.seed = seed;\n\n  let blockSize = f32(" +
                  WGSL_BLOCK_SIZE +
                  ");\n  let gridSize = uniforms.gridSize;\n  let halfGrid = gridSize * blockSize * 0.5;\n  let time = uniforms.time;\n\n  let cyclePeriod = 8.0 + seed * 6.0;\n  let phaseOffset = seed * 100.0;\n  let rawCycle = (time + phaseOffset) / cyclePeriod;\n  let cycleT = fract(rawCycle);\n\n  let fadeIn = smoothstep(0.0, 0.05, cycleT);\n  let fadeOut = 1.0 - smoothstep(0.95, 1.0, cycleT);\n  let fallVis = fadeIn * fadeOut * vis;\n\n  if (fallVis < 0.01) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let fallT = cycleT;\n  let groundY = blockSize * 1.5;\n  let fallHeight = mix(topY, groundY, fallT);\n\n  let originX = col * blockSize - halfGrid;\n  let originZ = row * blockSize - halfGrid;\n\n  let driftX = sin(time * 0.45 + seed * 5.0) * 0.045 * fallT\n             + sin(time * 1.1 + seed * 12.0) * 0.012 * fallT;\n  let driftZ = sin(time * 0.35 + seed * 8.0) * 0.03 * fallT\n             + cos(time * 0.8 + seed * 3.0) * 0.01 * fallT;\n\n  // Burst effect on toggle\n  let burstAge = time - uniforms.burstTime;\n  let burstIntensity = smoothstep(2.5, 0.0, burstAge) * step(0.0, uniforms.burstTime);\n  let burstAngle = seed * 6.28318 * 3.0 + f32(flowerIdx) * 0.618 * 6.28318;\n  let burstRadius = burstIntensity * blockSize * gridSize * 0.25 * (0.4 + seed * 0.6);\n  let burstDx = cos(burstAngle) * burstRadius;\n  let burstDy = burstIntensity * burstIntensity * blockSize * gridSize * 0.12 * (seed * 0.5 + 0.3);\n  let burstDz = sin(burstAngle) * burstRadius;\n\n  let centerX = originX + driftX + burstDx;\n  let centerY = fallHeight + burstDy;\n  let centerZ = originZ + driftZ + burstDz;\n\n  let flowerScale = blockSize * (0.5 + seed * 0.3) * fallVis;\n  let petalLength = flowerScale * 0.85;\n  let petalWidth = flowerScale * 0.38;\n  let curlHeight = blockSize * 0.15 * fallVis;\n  let centerRadius = blockSize * 0.10 * fallVis;\n\n  let baseRotation = seed * 6.28318 + time * (0.8 + seed * 1.2);\n\n  let tiltAngle = 0.3 + fallT * 1.2 + sin(time * 0.9 + seed * 7.0) * 0.4;\n  let tiltDir = time * (0.5 + seed * 0.8) + seed * PI * 2.0;\n  let tiltCos = cos(tiltAngle);\n  let tiltSin = sin(tiltAngle);\n  let tiltAxisX = cos(tiltDir);\n  let tiltAxisZ = sin(tiltDir);\n\n  var localPos = vec3f(0.0);\n  var normal = vec3f(0.0, 1.0, 0.0);\n  output.isCenter = 0.0;\n  output.petalT = 0.0;\n\n  if (localVert < 120u) {\n    let petalIdx = localVert / 24u;\n    let segVert = localVert % 24u;\n    let segIdx = segVert / 6u;\n    let triVert = segVert % 6u;\n\n    let petalAngle = f32(petalIdx) * 1.25664 + baseRotation;\n    let cosA = cos(petalAngle);\n    let sinA = sin(petalAngle);\n\n    var rowIdx: u32;\n    var side: f32;\n    if (triVert == 0u) { rowIdx = segIdx;     side = -1.0; }\n    else if (triVert == 1u) { rowIdx = segIdx;     side =  1.0; }\n    else if (triVert == 2u) { rowIdx = segIdx + 1u; side = -1.0; }\n    else if (triVert == 3u) { rowIdx = segIdx + 1u; side = -1.0; }\n    else if (triVert == 4u) { rowIdx = segIdx;     side =  1.0; }\n    else { rowIdx = segIdx + 1u; side =  1.0; }\n\n    let t = f32(rowIdx) * 0.25;\n    output.petalT = t;\n\n    let dist = t * petalLength;\n    let hw = petalWidth * sin(t * 3.14159) * sqrt(1.0 - t * 0.3);\n    let curl = curlHeight * 4.0 * t * (1.0 - t);\n\n    let alongX = dist * cosA;\n    let alongZ = dist * sinA;\n    let perpX = side * hw * (-sinA);\n    let perpZ = side * hw * cosA;\n\n    localPos = vec3f(alongX + perpX, curl, alongZ + perpZ);\n\n    let curlSlope = curlHeight * 4.0 * (1.0 - 2.0 * t);\n    normal = normalize(vec3f(\n      -curlSlope * cosA + side * 0.2 * sinA,\n      1.0,\n      -curlSlope * sinA - side * 0.2 * cosA,\n    ));\n  } else {\n    output.isCenter = 1.0;\n    let diskVert = localVert - 120u;\n    let triIdx = diskVert / 3u;\n    let triV = diskVert % 3u;\n\n    let centerElevation = curlHeight * 0.8;\n\n    if (triV == 0u) {\n      localPos = vec3f(0.0, centerElevation, 0.0);\n      normal = vec3f(0.0, 1.0, 0.0);\n    } else {\n      let angleIdx = select(triIdx, triIdx + 1u, triV == 2u);\n      let diskAngle = f32(angleIdx) * 0.62832 + baseRotation;\n      localPos = vec3f(cos(diskAngle) * centerRadius, centerElevation * 0.9, sin(diskAngle) * centerRadius);\n      normal = vec3f(0.0, 1.0, 0.0);\n    }\n  }\n\n  // Apply tumbling tilt (Rodrigues rotation)\n  let dotAO = tiltAxisX * localPos.x + tiltAxisZ * localPos.z;\n  let crossX = -tiltAxisZ * localPos.y;\n  let crossY = tiltAxisZ * localPos.x - tiltAxisX * localPos.z;\n  let crossZ = tiltAxisX * localPos.y;\n\n  let rotX = localPos.x * tiltCos + crossX * tiltSin + tiltAxisX * dotAO * (1.0 - tiltCos);\n  let rotY = localPos.y * tiltCos + crossY * tiltSin;\n  let rotZ = localPos.z * tiltCos + crossZ * tiltSin + tiltAxisZ * dotAO * (1.0 - tiltCos);\n\n  localPos = vec3f(centerX + rotX, centerY + rotY, centerZ + rotZ);\n\n  let nDotA = tiltAxisX * normal.x + tiltAxisZ * normal.z;\n  let nCrossX = -tiltAxisZ * normal.y;\n  let nCrossY = tiltAxisZ * normal.x - tiltAxisX * normal.z;\n  let nCrossZ = tiltAxisX * normal.y;\n  normal = normalize(vec3f(\n    normal.x * tiltCos + nCrossX * tiltSin + tiltAxisX * nDotA * (1.0 - tiltCos),\n    normal.y * tiltCos + nCrossY * tiltSin,\n    normal.z * tiltCos + nCrossZ * tiltSin + tiltAxisZ * nDotA * (1.0 - tiltCos),\n  ));\n\n  output.normalX = normal.x;\n  output.normalY = normal.y;\n  output.normalZ = normal.z;\n\n  " +
                  createIsometricTransformWgsl() +
                  "\n  \n  output.position = vec4f(\n    (ry_x + xOffsetScene) * scaleX,\n    (rx_y + yOffsetScene) * scaleY,\n    rx_z * 0.01 + 0.5,\n    1.0\n  );\n\n  return output;\n}\n",
                fragment:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct FlowerInput {\n  @location(0) petalT: f32,\n  @location(1) normalX: f32,\n  @location(2) normalY: f32,\n  @location(3) normalZ: f32,\n  @location(4) seed: f32,\n  @location(5) isCenter: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n\n" +
                  WGSL_ACES_FILM +
                  "\n\n@fragment\nfn main(input: FlowerInput) -> @location(0) vec4f {\n  let N = normalize(vec3f(input.normalX, input.normalY, input.normalZ));\n  let t = input.petalT;\n  let seed = input.seed;\n\n  let season = uniforms.season;\n\n  let fallChance = fract(seed * 4.37);\n  // Spring: show only ~25% of petals (gentle), fewer with custom colors for consistent feel\n  let springThreshold = mix(0.25, 0.15, uniforms.customStrength);\n  if (season < 0.5 && fallChance > springThreshold) { discard; }\n  if (season > 0.5 && season < 1.5) { discard; }\n\n  var shadeDeep    = vec3f(0.85, 0.22, 0.38);\n  var shadeMedium  = vec3f(0.92, 0.40, 0.52);\n  var shadeLight   = vec3f(0.96, 0.58, 0.66);\n  var shadePale    = vec3f(0.98, 0.75, 0.80);\n  var shadeBlush   = vec3f(0.97, 0.65, 0.72);\n  var shadeWhite   = vec3f(0.99, 0.88, 0.90);\n  var stamenGold   = vec3f(0.92, 0.78, 0.35);\n\n  if (season > 0.5 && season < 1.5) {\n    shadeDeep = vec3f(0.04, 0.14, 0.01); shadeMedium = vec3f(0.08, 0.24, 0.02);\n    shadeLight = vec3f(0.14, 0.34, 0.04); shadePale = vec3f(0.22, 0.40, 0.06);\n    shadeBlush = vec3f(0.10, 0.28, 0.03); shadeWhite = vec3f(0.28, 0.42, 0.08);\n    stamenGold = vec3f(0.34, 0.36, 0.06);\n  } else if (season > 1.5 && season < 2.5) {\n    shadeDeep = vec3f(0.62, 0.10, 0.04); shadeMedium = vec3f(0.75, 0.22, 0.06);\n    shadeLight = vec3f(0.85, 0.38, 0.08); shadePale = vec3f(0.90, 0.55, 0.15);\n    shadeBlush = vec3f(0.80, 0.30, 0.08); shadeWhite = vec3f(0.92, 0.68, 0.25);\n    stamenGold = vec3f(0.72, 0.50, 0.10);\n  }\n\n  var baseColor = vec3f(0.0);\n\n  if (input.isCenter > 0.5) {\n    let goldVar = fract(seed * 13.3) * 0.15;\n    baseColor = stamenGold * (0.9 + goldVar);\n  } else {\n    let tier = fract(seed * 7.31);\n    var petalBase: vec3f;\n    var petalTip: vec3f;\n    if (tier < 0.2) { petalBase = shadeDeep; petalTip = shadeMedium; }\n    else if (tier < 0.35) { petalBase = shadeMedium; petalTip = shadeLight; }\n    else if (tier < 0.50) { petalBase = shadeLight; petalTip = shadePale; }\n    else if (tier < 0.65) { petalBase = shadeBlush; petalTip = shadePale; }\n    else if (tier < 0.80) { petalBase = shadePale; petalTip = shadeWhite; }\n    else { petalBase = shadeDeep; petalTip = shadeBlush; }\n    baseColor = mix(petalBase, petalTip, t);\n\n    let veinT = abs(t - 0.5) * 2.0;\n    let veinDarken = 1.0 - (1.0 - veinT) * 0.08;\n    baseColor = baseColor * veinDarken;\n  }\n\n  // Custom color override — preserve tonal variation\n  let customStrength = uniforms.customStrength;\n  if (customStrength > 0.01) {\n    let customCol = vec3f(uniforms.customR, uniforms.customG, uniforms.customB);\n    let luma = dot(baseColor, vec3f(0.299, 0.587, 0.114));\n    let lumaDelta = luma - 0.5;\n    let tinted = customCol * (0.7 + lumaDelta * 1.2) + vec3f(lumaDelta * 0.15);\n    baseColor = mix(baseColor, tinted, customStrength);\n  }\n\n  const sunDir = vec3f(-0.405616, 0.861934, -0.304212);\n  let sunColor = vec3f(1.20, 1.20, 1.20);\n  let ambient = vec3f(0.28, 0.28, 0.30);\n  let NdotL = max(dot(N, sunDir), 0.0);\n\n  let NdotLBack = max(dot(-N, sunDir), 0.0);\n  let sssColor = vec3f(1.0, 0.55, 0.65);\n  let subsurface = NdotLBack * 0.22 * sssColor;\n\n  let skyFill = vec3f(0.90, 0.85, 0.88);\n  let skyContrib = max(N.y, 0.0) * 0.12 * skyFill;\n\n  let undersideDarken = mix(0.55, 1.0, max(N.y, 0.0));\n\n  const viewDir = vec3f(0.398015, 0.597022, 0.696526);\n  let rimDot = 1.0 - max(dot(N, viewDir), 0.0);\n  let rim = pow(rimDot, 3.0) * 0.10 * vec3f(1.0, 0.85, 0.88);\n\n  let lit = baseColor * undersideDarken * (ambient + sunColor * NdotL * 0.88) + subsurface + skyContrib + rim;\n\n  let hdr = acesFilm(lit * 1.05);\n  var ldr = pow(hdr, vec3f(1.0 / 2.2));\n\n  let gray = dot(ldr, vec3f(0.299, 0.587, 0.114));\n  ldr = mix(vec3f(gray), ldr, 1.6);\n\n  return vec4f(ldr, 1.0);\n}\n",
                depthWrite: !0,
                depthCompare: "less",
              });
            } catch (fallingPetalsPipelineError) {
              console.error(
                "Falling petal pipeline failed (non-fatal):",
                fallingPetalsPipelineError,
              );
            }
            let rainPipeline = null;
            try {
              rainPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
                vertex:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct RainOutput {\n  @builtin(position) position: vec4f,\n  @location(0) alpha: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n@group(0) @binding(1) var<storage, read> rainData: array<vec4f>;\n\n@vertex\nfn main(@builtin(vertex_index) vertexIndex: u32) -> RainOutput {\n  var output: RainOutput;\n\n  let vertsPerDrop = 6u;\n  let dropIdx = vertexIndex / vertsPerDrop;\n  let localVert = vertexIndex % vertsPerDrop;\n\n  let count = u32(uniforms.blockCount);\n  if (dropIdx >= count) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let rainMode = uniforms.rainMode;\n  let progress = uniforms.progress;\n  // Hide rain in QR mode\n  let vis = smoothstep(0.0, 0.3, 1.0 - progress) * rainMode;\n\n  if (vis < 0.01) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let data = rainData[dropIdx];\n  let col = data.x;\n  let row = data.y;\n  let phase = data.z;\n  let seed = data.w;\n\n  let blockSize = f32(" +
                  WGSL_BLOCK_SIZE +
                  ");\n  let gridSize = uniforms.gridSize;\n  let halfGrid = gridSize * blockSize * 0.5;\n  let time = uniforms.time;\n\n  let fallSpeed = 1.5 + seed * 1.0;\n  let cycleT = fract((time * fallSpeed + phase * 10.0) * 0.3);\n\n  // Cloud bases are at y≈.44: start below them and end on the water.\n  let topY = .41;\n  let botY = .045;\n  let dropY = mix(topY, botY, cycleT);\n\n  // Slight fixed wind angle for rain\n  let windDrift = 0.015 * cycleT;\n\n  let baseX = col * blockSize - halfGrid + windDrift;\n  let baseZ = row * blockSize - halfGrid + 0.008 * cycleT;\n\n  let streakLength = blockSize * (2.5 + seed * 1.5);\n  let streakWidth = blockSize * 0.06;\n\n  let quadVerts = array<vec2f, 6>(\n    vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 1.0),\n    vec2f(-1.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)\n  );\n  let qv = quadVerts[localVert];\n\n  let fadeTop = smoothstep(0.0, 0.1, cycleT);\n  let fadeBot = 1.0 - smoothstep(0.85, 1.0, cycleT);\n  output.alpha = fadeTop * fadeBot * vis * (0.06 + seed * 0.05);\n\n  var localPos = vec3f(\n    baseX + qv.x * streakWidth,\n    dropY + qv.y * streakLength,\n    baseZ\n  );\n\n  " +
                  createIsometricTransformWgsl() +
                  "\n  output.position = vec4f(\n    (ry_x + xOffsetScene) * scaleX,\n    (rx_y + yOffsetScene) * scaleY,\n    rx_z * 0.01 + 0.5,\n    1.0\n  );\n\n  return output;\n}\n",
                fragment:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct RainInput {\n  @location(0) alpha: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n\n@fragment\nfn main(input: RainInput) -> @location(0) vec4f {\n  if (input.alpha < 0.01) { discard; }\n  let color = vec3f(0.72, 0.78, 0.9);\n  return vec4f(color * input.alpha, input.alpha);\n}\n",
                depthWrite: !1,
                depthCompare: "less",
                blend: {
                  color: {
                    srcFactor: "src-alpha",
                    dstFactor: "one-minus-src-alpha",
                    operation: "add",
                  },
                  alpha: {
                    srcFactor: "one",
                    dstFactor: "one-minus-src-alpha",
                    operation: "add",
                  },
                },
              });
            } catch (rainPipelineError) {
              console.error("Rain pipeline failed (non-fatal):", rainPipelineError);
            }
            const FOUNTAIN_WATER_VERTEX_SHADER = `${SCENE_UNIFORM_WGSL}
struct WaterOutput { @builtin(position) position: vec4f, @location(0) alpha: f32 }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> streams: array<vec4f>;
@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> WaterOutput {
  var output: WaterOutput;
  let streamIndex = vertexIndex / ${FOUNTAIN_WATER_VERTICES_PER_ELEMENT}u;
  if (streamIndex >= u32(uniforms.blockCount)) {
    output.position = vec4f(0.0, 0.0, -10.0, 1.0);
    return output;
  }
  let stream = streams[streamIndex];
  let localVertex = vertexIndex % ${FOUNTAIN_WATER_VERTICES_PER_ELEMENT}u;
  let tier = stream.x;
  let angle = stream.z * 6.2831853;
  let blockSize = f32(${WGSL_BLOCK_SIZE});
  let scale = uniforms.gridSize * blockSize * ${FOUNTAIN_MODEL_SCALE};
  var topY = scale * 0.35;
  var bottomY = scale * 0.105;
  let streamRadius = stream.y * blockSize * ${FOUNTAIN_MODEL_SCALE};
  var topRadius = streamRadius;
  var bottomRadius = streamRadius;
  if (tier > 0.5) { topY = scale * 0.545; bottomY = scale * 0.358; topRadius = streamRadius; bottomRadius = streamRadius; }
  if (tier > 1.5) { topY = scale * 0.91; bottomY = scale * 0.553; topRadius = streamRadius; bottomRadius = streamRadius; }
  let progress = uniforms.progress;
  let visible = smoothstep(0.0, 0.35, 1.0 - progress);
  var localPos = vec3f(0.0);
  output.alpha = 0.0;
  if (tier < 1.5 && localVertex < 6u) {
    let quad = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
    let flow = fract(uniforms.time * (0.82 + stream.w * 0.32) + stream.z);
    let q = quad[localVertex];
    let flowY = mix(topY, bottomY, q.y);
    let flowRadius = mix(topRadius, bottomRadius, q.y);
    let tangent = vec2f(-sin(angle), cos(angle));
    // Adjacent strips overlap into a continuous vertical spillway instead of
    // reading as a second crown of individual water jets.
    let width = blockSize * (0.12 + stream.w * 0.42);
    let cascadePhase = uniforms.time * (5.5 + stream.w * 2.0) + stream.z * 6.2831853;
    let lateralSway = 0.0;
    let radialSway = 0.0;
    localPos = vec3f(cos(angle) * (flowRadius + radialSway) + tangent.x * (q.x * width + lateralSway), flowY, sin(angle) * (flowRadius + radialSway) + tangent.y * (q.x * width + lateralSway));
    let streamPresence = step(0.16, fract(stream.w * 19.7));
    output.alpha = streamPresence * (0.10 + stream.w * 0.32) * visible * (0.60 + 0.40 * sin(flow * 6.2831853));
  } else if (tier < 2.5) {
    // The crown is a low, overlapping water veil from the central nozzle.
    let arcSegment = localVertex / 6u;
    let arcVertex = localVertex % 6u;
    let quad = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
    let q = quad[arcVertex];
    let startT = f32(arcSegment) / 20.0;
    let endT = f32(arcSegment + 1u) / 20.0;
    let arcT = mix(startT, endT, q.y);
    let arcPortion = 0.50;
    let arcProgress = min(arcT / arcPortion, 1.0);
    let arcRise = sin(arcProgress * 3.14159265) * scale * (0.160 + stream.w * 0.030);
    let landingRadius = scale * (0.080 + stream.w * 0.025);
    let nozzleRadius = 0.0;
    let arcRadius = mix(nozzleRadius, landingRadius, smoothstep(0.0, 1.0, arcProgress));
    let arcExitY = scale * 0.70;
    let curvedY = mix(scale * 0.905, arcExitY, arcProgress) + arcRise;
    let verticalProgress = clamp((arcT - arcPortion) / (1.0 - arcPortion), 0.0, 1.0);
    let verticalY = mix(arcExitY, scale * 0.548, verticalProgress);
    let waterY = select(verticalY, curvedY, arcT < arcPortion);
    let tangent = vec2f(-sin(angle), cos(angle));
    let width = blockSize * (0.020 + stream.w * 0.050);
    let crownSway = sin(uniforms.time * (3.2 + stream.w) + stream.z * 6.2831853) * blockSize * 0.006;
    let flowPhase = uniforms.time * (3.0 + stream.w) - arcT * 15.0;
    let flowRipple = sin(flowPhase) * blockSize * 0.012;
    let animatedRadius = arcRadius + flowRipple;
    localPos = vec3f(cos(angle) * animatedRadius + tangent.x * (q.x * width + crownSway), waterY + flowRipple * 0.45, sin(angle) * animatedRadius + tangent.y * (q.x * width + crownSway));
    output.alpha = (0.16 + stream.w * 0.12) * visible * (0.78 + 0.22 * sin(flowPhase));
  } else if (tier >= 2.5) {
    let triangle = localVertex / 3u;
    let corner = localVertex % 3u;
    let firstAngle = f32(triangle) / 20.0 * 6.2831853;
    let secondAngle = f32(triangle + 1u) / 20.0 * 6.2831853;
    let surfaceRadius = stream.y * blockSize;
    let surfaceY = stream.z * scale;
    if (corner == 0u) { localPos = vec3f(0.0, surfaceY, 0.0); }
    else { let surfaceAngle = select(firstAngle, secondAngle, corner == 2u); localPos = vec3f(cos(surfaceAngle) * surfaceRadius, surfaceY, sin(surfaceAngle) * surfaceRadius); }
    output.alpha = select(0.38, 0.24, tier == 3.0) * visible;
  }
  ${createIsometricTransformWgsl()}
  output.position = vec4f((ry_x + xOffsetScene) * scaleX, (rx_y + yOffsetScene) * scaleY, rx_z * 0.01 + 0.5, 1.0);
  return output;
}`;
            const FOUNTAIN_WATER_FRAGMENT_SHADER = `${SCENE_UNIFORM_WGSL}
struct WaterInput { @location(0) alpha: f32 }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@fragment
fn main(input: WaterInput) -> @location(0) vec4f {
  if (input.alpha < 0.01) { discard; }
  return vec4f(vec3f(0.32, 0.62, 0.82) * input.alpha, input.alpha);
}`;
            let fountainWaterPipeline = null;
            try {
              fountainWaterPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
                vertex: FOUNTAIN_WATER_VERTEX_SHADER,
                fragment: FOUNTAIN_WATER_FRAGMENT_SHADER,
                depthWrite: !1,
                depthCompare: "less",
                blend: ALPHA_BLEND_STATE,
              });
            } catch (fountainWaterPipelineError) {
              console.error("Fountain water pipeline failed (non-fatal):", fountainWaterPipelineError);
            }
            let autumnRipplePipeline = null;
            const AUTUMN_RIPPLE_VERTEX_SHADER = `${SCENE_UNIFORM_WGSL}
struct RippleOutput { @builtin(position) position: vec4f, @location(0) alpha: f32 }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> leafData: array<vec4f>;
@vertex fn main(@builtin(vertex_index) vertexIndex: u32) -> RippleOutput {
  var output: RippleOutput;
  let leafIndex = vertexIndex / ${AUTUMN_RIPPLE_VERTICES}u;
  let localVertex = vertexIndex % ${AUTUMN_RIPPLE_VERTICES}u;
  if (leafIndex >= u32(uniforms.blockCount)) { output.position = vec4f(0.0, 0.0, -10.0, 1.0); return output; }
  let leaf = leafData[leafIndex]; let blockSize = f32(${WGSL_BLOCK_SIZE});
  let cyclePeriod = 8.0 + leaf.w * 6.0;
  let fallT = fract((uniforms.time + leaf.w * 100.0) / cyclePeriod);
  let fountainScale = uniforms.gridSize * blockSize * ${FOUNTAIN_MODEL_SCALE};
  let waterHeight = fountainScale * .105;
  let groundHeight = blockSize * 1.5;
  let impactT = clamp((leaf.z - waterHeight) / max(leaf.z - groundHeight, .001), 0.0, 1.0);
  var rippleAge = (fallT - impactT) * cyclePeriod;
  if (rippleAge < 0.0) { rippleAge += cyclePeriod; }
  let segment = localVertex / 6u; let corner = localVertex % 6u;
  let quad = array<vec2f, 6>(vec2f(0.0,0.0),vec2f(1.0,0.0),vec2f(0.0,1.0),vec2f(0.0,1.0),vec2f(1.0,0.0),vec2f(1.0,1.0));
  let q = quad[corner]; let angle = (f32(segment) + q.x) / 24.0 * 6.2831853;
  let radius = blockSize * (0.25 + rippleAge * 2.6); let thickness = blockSize * 0.090;
  let ringRadius = radius + (q.y - 0.5) * thickness;
  let halfGrid = uniforms.gridSize * blockSize * 0.5;
  let localPos = vec3f(leaf.x * blockSize - halfGrid + cos(angle) * ringRadius, waterHeight + blockSize * .012, leaf.y * blockSize - halfGrid + sin(angle) * ringRadius);
  output.alpha = (1.0 - smoothstep(.55, 1.0, rippleAge)) * smoothstep(0.0, .06, rippleAge) * .80;
  let progress = uniforms.progress;
  ${createIsometricTransformWgsl()}
  output.position = vec4f((ry_x + xOffsetScene) * scaleX, (rx_y + yOffsetScene) * scaleY, rx_z * .01 + .5, 1.0); return output;
}`;
            const AUTUMN_RIPPLE_FRAGMENT_SHADER = `${SCENE_UNIFORM_WGSL}
struct RippleInput { @location(0) alpha: f32 }
@fragment fn main(input: RippleInput) -> @location(0) vec4f { if (input.alpha < .01) { discard; } return vec4f(vec3f(.62,.86,1.0) * input.alpha, input.alpha); }`;
            try { autumnRipplePipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, { vertex: AUTUMN_RIPPLE_VERTEX_SHADER, fragment: AUTUMN_RIPPLE_FRAGMENT_SHADER, depthWrite: !1, depthCompare: "less", blend: ALPHA_BLEND_STATE }); }
            catch (autumnRipplePipelineError) { console.error("Autumn ripple pipeline failed (non-fatal):", autumnRipplePipelineError); }
            let koiPipeline = null;
            const KOI_VERTEX_SHADER = `${SCENE_UNIFORM_WGSL}
struct KoiOutput { @builtin(position) position: vec4f, @location(0) fishIndex: f32, @location(1) part: f32 }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> koiData: array<vec4f>;
@vertex fn main(@builtin(vertex_index) vertexIndex: u32) -> KoiOutput {
  var output: KoiOutput;
  let fishIndex = vertexIndex / ${KOI_VERTICES_PER_FISH}u;
  let localVertex = vertexIndex % ${KOI_VERTICES_PER_FISH}u;
  if (fishIndex >= u32(uniforms.blockCount)) { output.position = vec4f(0.0, 0.0, -10.0, 1.0); return output; }
  let fish = koiData[fishIndex]; let blockSize = f32(${WGSL_BLOCK_SIZE});
  let gridSize = uniforms.gridSize; let scale = gridSize * blockSize * ${FOUNTAIN_MODEL_SCALE};
  let angle = uniforms.time * fish.y + fish.w * 6.2831853;
  let centerX = cos(angle) * fish.x * blockSize; let centerZ = sin(angle) * fish.x * blockSize;
  let direction = vec2f(-sin(angle) * sign(fish.y), cos(angle) * sign(fish.y));
  let side = vec2f(-direction.y, direction.x);
  let body = array<vec3f, 39>(
    vec3f(.55,0,0),vec3f(.10,.22,0),vec3f(.10,0,.18), vec3f(.55,0,0),vec3f(.10,0,.18),vec3f(.10,-.16,0), vec3f(.55,0,0),vec3f(.10,-.16,0),vec3f(.10,0,-.18), vec3f(.55,0,0),vec3f(.10,0,-.18),vec3f(.10,.22,0),
    vec3f(.10,.22,0),vec3f(-.45,0,.11),vec3f(.10,0,.18), vec3f(.10,0,.18),vec3f(-.45,0,.11),vec3f(-.45,-.10,0), vec3f(.10,-.16,0),vec3f(-.45,-.10,0),vec3f(.10,0,-.18), vec3f(.10,0,-.18),vec3f(-.45,-.10,0),vec3f(-.45,0,.11),
    vec3f(-.42,0,0),vec3f(-.78,.17,0),vec3f(-.72,0,.20), vec3f(-.42,0,0),vec3f(-.72,0,.20),vec3f(-.78,-.17,0), vec3f(-.42,.10,0),vec3f(-.18,.30,0),vec3f(-.05,.08,0), vec3f(.05,0,.12),vec3f(-.22,-.05,.42),vec3f(-.28,-.04,.10), vec3f(.05,0,-.12),vec3f(-.22,-.05,-.42),vec3f(-.28,-.04,-.10)
  );
  let local = body[localVertex] * blockSize * fish.z * 3.2;
  let tailWave = sin(uniforms.time * (2.2 + fish.z) + fish.w * 9.0) * blockSize * .095 * fish.z;
  let isTailVertex = localVertex >= 24u && localVertex < 30u;
  let localX = local.x; let localZ = local.z + select(0.0, tailWave, isTailVertex);
  let localPos = vec3f(centerX + direction.x * localX + side.x * localZ, scale * .103 + local.y, centerZ + direction.y * localX + side.y * localZ);
  output.fishIndex = f32(fishIndex); output.part = select(0.0, 1.0, localVertex >= 24u);
  let progress = uniforms.progress;
  ${createIsometricTransformWgsl()}
  output.position = vec4f((ry_x + xOffsetScene) * scaleX, (rx_y + yOffsetScene) * scaleY, rx_z * .01 + .5, 1.0); return output;
}`;
            const KOI_FRAGMENT_SHADER = `${SCENE_UNIFORM_WGSL}
struct KoiInput { @location(0) fishIndex: f32, @location(1) part: f32 }
@fragment fn main(input: KoiInput) -> @location(0) vec4f {
  var color = vec3f(.93,.35,.08);
  if (input.fishIndex > .5 && input.fishIndex < 1.5) { color = mix(vec3f(.94,.86,.68), vec3f(.85,.22,.08), input.part); }
  if (input.fishIndex > 1.5) { color = vec3f(.88,.62,.18); }
  return vec4f(color, 1.0);
}`;
            try { koiPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, { vertex: KOI_VERTEX_SHADER, fragment: KOI_FRAGMENT_SHADER, depthWrite: !0, depthCompare: "less" }); }
            catch (koiPipelineError) { console.error("Koi pipeline failed (non-fatal):", koiPipelineError); }
            let legacyButterflyPipeline = null;
            try {
              legacyButterflyPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
                vertex:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct ButterflyOutput {\n  @builtin(position) position: vec4f,\n  @location(0) wingT: f32,\n  @location(1) seed: f32,\n  @location(2) wingSide: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n@group(0) @binding(1) var<storage, read> butterflyData: array<vec4f>;\n\nconst PI: f32 = 3.14159265;\n\n@vertex\nfn main(@builtin(vertex_index) vertexIndex: u32) -> ButterflyOutput {\n  var output: ButterflyOutput;\n\n  let vertsPerButterfly = 6u;\n  let bIdx = vertexIndex / vertsPerButterfly;\n  let localVert = vertexIndex % vertsPerButterfly;\n\n  let count = u32(uniforms.blockCount);\n  if (bIdx >= count) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let progress = uniforms.progress;\n  let season = uniforms.season;\n\n  // Summer only (season 1)\n  let summerVis = 1.0 - abs(season - 1.0);\n  let vis = smoothstep(0.0, 0.4, 1.0 - progress) * smoothstep(0.0, 0.5, summerVis);\n  if (vis < 0.01) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let data = butterflyData[bIdx];\n  let orbitRadius = data.x;\n  let orbitSpeed = data.y;\n  let heightOffset = data.z;\n  let seed = data.w;\n  output.seed = seed;\n\n  let blockSize = f32(" +
                  WGSL_BLOCK_SIZE +
                  ");\n  let gridSize = uniforms.gridSize;\n  let halfGrid = gridSize * blockSize * 0.5;\n  let time = uniforms.time;\n\n  // Faster erratic orbit with wobble\n  let phase = seed * PI * 2.0;\n  let orbitAngle = time * orbitSpeed + phase;\n  let wobble = sin(time * 2.5 + seed * 8.0) * 0.3;\n  let bobY = sin(time * 1.8 + seed * 5.0) * blockSize * 2.0;\n\n  let centerCol = gridSize * 0.5 + cos(orbitAngle + wobble) * orbitRadius;\n  let centerRow = gridSize * 0.5 + sin(orbitAngle + wobble) * orbitRadius;\n  let centerY = blockSize * heightOffset + bobY;\n\n  let centerX = centerCol * blockSize - halfGrid;\n  let centerZ = centerRow * blockSize - halfGrid;\n\n  // Direction of travel (tangent to orbit)\n  let dirX = -sin(orbitAngle + wobble);\n  let dirZ = cos(orbitAngle + wobble);\n\n  // Rapid wing flapping — butterfly flutter\n  let flapSpeed = 14.0 + seed * 10.0;\n  let flapAngle = sin(time * flapSpeed + seed * 10.0) * 0.9;\n\n  // Square-ish wings — width ≈ length\n  let wingSpan = blockSize * (0.82 + seed * 0.32) * vis;\n  let wingLength = blockSize * (0.74 + seed * 0.24) * vis;\n\n  // Perpendicular to flight direction (wing axis)\n  let perpX = dirZ;\n  let perpZ = -dirX;\n\n  let isRightWing = localVert >= 3u;\n  let wingVert = localVert % 3u;\n  let wingSign = select(-1.0, 1.0, isRightWing);\n  output.wingSide = wingSign;\n\n  var localPos = vec3f(0.0);\n  output.wingT = 0.0;\n\n  if (wingVert == 0u) {\n    // Body center\n    localPos = vec3f(centerX, centerY, centerZ);\n    output.wingT = 0.0;\n  } else if (wingVert == 1u) {\n    // Front-outer corner — forward + outward\n    let wingUp = sin(flapAngle * wingSign) * wingSpan * 0.7;\n    let wingOut = cos(flapAngle * wingSign) * wingSpan;\n    localPos = vec3f(\n      centerX + perpX * wingOut * wingSign + dirX * wingLength * 0.55,\n      centerY + wingUp,\n      centerZ + perpZ * wingOut * wingSign + dirZ * wingLength * 0.55,\n    );\n    output.wingT = 1.0;\n  } else {\n    // Back-outer corner — backward + outward\n    let wingUp = sin(flapAngle * wingSign) * wingSpan * 0.5;\n    let wingOut = cos(flapAngle * wingSign) * wingSpan * 0.85;\n    localPos = vec3f(\n      centerX + perpX * wingOut * wingSign - dirX * wingLength * 0.55,\n      centerY + wingUp,\n      centerZ + perpZ * wingOut * wingSign - dirZ * wingLength * 0.55,\n    );\n    output.wingT = 0.7;\n  }\n\n  " +
                  createIsometricTransformWgsl() +
                  "\n  \n  output.position = vec4f(\n    (ry_x + xOffsetScene) * scaleX,\n    (rx_y + yOffsetScene) * scaleY,\n    rx_z * 0.01 + 0.5,\n    1.0\n  );\n\n  return output;\n}\n",
                fragment:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct ButterflyInput {\n  @location(0) wingT: f32,\n  @location(1) seed: f32,\n  @location(2) wingSide: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n\n" +
                  WGSL_ACES_FILM +
                  "\n\n@fragment\nfn main(input: ButterflyInput) -> @location(0) vec4f {\n  let seed = input.seed;\n  let t = input.wingT;\n\n  // Bright vivid butterfly colors for summer\n  var wingBase: vec3f;\n  var wingTip: vec3f;\n\n  let tier = fract(seed * 3.17);\n  if (tier < 0.25) {\n    // Electric blue\n    wingBase = vec3f(0.15, 0.40, 0.95);\n    wingTip = vec3f(0.35, 0.65, 1.0);\n  } else if (tier < 0.5) {\n    // Vivid orange monarch\n    wingBase = vec3f(0.95, 0.45, 0.05);\n    wingTip = vec3f(1.0, 0.70, 0.20);\n  } else if (tier < 0.75) {\n    // Bright yellow\n    wingBase = vec3f(0.95, 0.85, 0.15);\n    wingTip = vec3f(1.0, 0.95, 0.50);\n  } else {\n    // Hot pink/magenta\n    wingBase = vec3f(0.90, 0.20, 0.55);\n    wingTip = vec3f(1.0, 0.50, 0.70);\n  }\n\n  var color = mix(wingBase, wingTip, t);\n\n  // Dark wing edge markings\n  let edgeDark = mix(0.6, 1.0, smoothstep(0.0, 0.25, t));\n  color = color * edgeDark;\n\n  // Wing spots — small dark dots\n  let spotChance = fract(seed * 7.3 + t * 3.1);\n  if (spotChance > 0.8 && t > 0.4) {\n    color = color * 0.3;\n  }\n\n  // Bright lighting\n  let ambient = vec3f(0.40, 0.40, 0.42);\n  const sunDir = vec3f(-0.405616, 0.861934, -0.304212);\n  let N = vec3f(0.0, 1.0, 0.0);\n  let NdotL = max(dot(N, sunDir), 0.0);\n  let lit = color * (ambient + vec3f(1.3) * NdotL * 0.8);\n\n  let hdr = acesFilm(lit * 1.8);\n  var ldr = pow(hdr, vec3f(1.0 / 2.2));\n  // Extra saturation boost for vivid butterflies\n  let gray = dot(ldr, vec3f(0.299, 0.587, 0.114));\n  ldr = mix(vec3f(gray), ldr, 2.2);\n\n  return vec4f(ldr, 1.0);\n}\n",
                depthWrite: !0,
                depthCompare: "less",
              });
            } catch (butterflyPipelineError) {
              console.error(
                "Butterfly pipeline failed (non-fatal):",
                butterflyPipelineError,
              );
            }
            const renderTargets = createRenderTargets(gpuSurface);
            renderTargets.resize();
            const blur = createTransitionBlur(deviceAt354206, textureFormat, blockUniforms, renderTargets.sceneTextureView),
              blurPipeline = blur.pipeline,
              blurBindGroup = blur.bindGroup;
            return {
              device: deviceAt354206,
              context: gpuContext,
              buffers: {
                blockUniforms: blockUniforms,
                fountainUniforms: branchUniforms,
                pebbleUniforms: pebbleUniforms,
                petalUniforms: petalUniforms,
                autumnLeafUniforms,
                typeBuffer: typeBuffer,
                posBuffer: positionBuffer,
                heightBuffer: heightBuffer,
                baseYBuffer: baseYBuffer,
                flowerBuffer: flowerBuffer,
                fountainProfileBuffer: fountainProfileBuffer,
                pebbleBuffer: pebbleBuffer,
                fallingPetalBuffer: fallingPetalBuffer,
                rainUniforms: rainUniforms,
                rainBuffer: rainBuffer,
                butterflyUniforms: butterflyUniforms,
                butterflyBuffer: butterflyBuffer,
                springButterflyUniforms,
                springButterflyBuffer,
              },
              pipelines: {
                sky: skyPipeline,
                shadow: shadowPipeline,
                blocks: blocksPipeline,
                flowers: flowersPipeline,
                fountain: fountainPipeline,
                rain: rainPipeline,
                beach: beachPipeline,
                beachWater: beachWaterPipeline,
                beachDecor: beachDecorPipeline,
                beachModels: beachModelPipeline,
                pebbles: pebblePipeline,
                fallingPetals: fallingPetalsPipeline,
                fountainWater: fountainWaterPipeline,
                autumnRipples: autumnRipplePipeline,
                koi: koiPipeline,
                butterflies: legacyButterflyPipeline,
                blur: blurPipeline,
              },
              bindGroups: {
                sky: skyBindGroup,
                shadow: skyBindGroup,
                blocks: blocksBindGroup,
                beach: beachPipeline
                  ? createBindGroup(deviceAt354206, {
                      layout: beachPipeline.getBindGroupLayout(0),
                      entries: [
                        { binding: 0, resource: { buffer: blockUniforms } },
                        { binding: 1, resource: { buffer: positionBuffer } },
                      ],
                  })
                  : null,
                beachWater: beachWaterPipeline
                  ? createBindGroup(deviceAt354206, {
                      layout: beachWaterPipeline.getBindGroupLayout(0),
                      entries: [
                        { binding: 0, resource: { buffer: blockUniforms } },
                        { binding: 1, resource: { buffer: positionBuffer } },
                      ],
                    })
                  : null,
                beachDecor: beachDecorPipeline
                  ? createBindGroup(deviceAt354206, {
                      layout: beachDecorPipeline.getBindGroupLayout(0),
                      entries: [
                        { binding: 0, resource: { buffer: blockUniforms } },
                        { binding: 1, resource: { buffer: positionBuffer } },
                      ],
                    })
                  : null,
                flowers: flowersBindGroup,
                autumnLeaves: autumnLeafBindGroup,
                fountain: fountainBindGroup,
                rain: fountainWaterBindGroup,
                pebbles: pebblesBindGroup,
                fallingPetals: fallingPetalsBindGroup,
                fountainWater: fountainWaterBindGroup,
                koi: koiBindGroup,
                butterflies: springButterflyBindGroup,
                blur: blurBindGroup,
              },
              renderTargets,
              beachModels,
              get depthTextureView() { return renderTargets.depthTextureView; },
              get sceneTextureView() { return renderTargets.sceneTextureView; },
              blur,
              aspectRatio: canvas.width / canvas.height,
              gpuSurface,
              qrRenderer,
              isMobile:
                "ontouchstart" in globalThis || navigator.maxTouchPoints > 0,
              counts: {
                numBlocks: 0,
                gridSize: 0,
                flowerCount: 0,
                fountainBandCount: 0,
                pebbleCount: 0,
                petalCount: 0,
                fountainWaterCount: 0,
                rainCount: 0,
                koiCount: 0,
                butterflyCount: 0,
                autumnLeafCount: 0,
              },
              _uniformArr: new Float32Array(16),
              _fountainProfileUpload: new Float32Array(6e3),
              _flowerUpload: new Float32Array(4e5),
              _petalUpload: new Float32Array(40),
              _rainUpload: new Float32Array(2e3),
              _butterflyUpload: new Float32Array(40),
              _springButterflyUpload: new Float32Array(40),
            };
          })(canvasElement, canvasWidth, canvasHeightAt41144e);
          if (!rendererStateAtf2509b || !isCurrentInitialization()) return;
          ((rendererRef.current = rendererStateAtf2509b), (rendererCanvasRef.current = canvasElement));
          const qrMatrixAt529187 = buildQrMatrix(qrContentRef.current),
            voxelBlocksAt508cc4 = createFountainVoxelBlocks(qrMatrixAt529187),
            qrAnalysisAt4c4fbc = analyzeQrMatrix(qrMatrixAt529187);
          ((qrMatrixRef.current = qrMatrixAt529187),
            (qrAnalysisRef.current = qrAnalysisAt4c4fbc),
            (treeGridSizeRef.current = voxelBlocksAt508cc4.gridSize),
            setNoiseSeed(hashSeed(treeSeedRef.current)));
          const fountainGeometry = createFountainGeometry(voxelBlocksAt508cc4.gridSize),
            emptyFountainFlowers = generateCanopyFlowers([], qrAnalysisAt4c4fbc),
            emptyQrFlowers = { positions: new Float32Array(0), count: 0 },
            pebbleData = generatePebbleData(qrMatrixAt529187),
            emptyFallingPetals = generateFallingPetals([], voxelBlocksAt508cc4.gridSize),
            fountainWater = generateFountainWater(voxelBlocksAt508cc4.gridSize),
            koi = generateKoi(voxelBlocksAt508cc4.gridSize),
            springButterflies = generateSpringButterflies(voxelBlocksAt508cc4.gridSize),
            autumnWaterLeaves = generateAutumnWaterLeaves(voxelBlocksAt508cc4.gridSize),
            rain = generateRain(voxelBlocksAt508cc4.gridSize);
          uploadSceneData(
            rendererStateAtf2509b,
            voxelBlocksAt508cc4,
            fountainGeometry,
            emptyFountainFlowers,
            emptyQrFlowers.positions,
            emptyQrFlowers.count,
            pebbleData,
            emptyFallingPetals,
            fountainWater,
            koi,
            springButterflies,
            autumnWaterLeaves,
          );
          rendererStateAtf2509b._rainUpload.set(rain.positions);
          rendererStateAtf2509b.device.queue.writeBuffer(rendererStateAtf2509b.buffers.rainBuffer, 0, rendererStateAtf2509b._rainUpload);
          rendererStateAtf2509b.counts.rainCount = rain.count;
          previousQrContentRef.current = qrContentRef.current;
          let previousSeason = -1,
            previousQrContent = "",
            previousTreeSeed = "",
            previousCanvasWidth = 0,
            previousCanvasHeight = 0,
            customColorChanged = !1;
          const updateQrSnapshot = () => {
            if (!qrSnapshotRef) return;
            if (previousQrContentRef.current !== qrContentRef.current) return;
            const customColorSignature = customColorRef.current.join(","),
              canvasPixelWidth = canvasElement.width,
              canvasHeightAt183e55 = canvasElement.height,
              canvasSizeChanged = previousCanvasWidth !== canvasPixelWidth || previousCanvasHeight !== canvasHeightAt183e55,
              seasonChanged =
                previousSeason !== seasonRef.current ||
                previousQrContent !== customColorSignature ||
                previousTreeSeed !== qrContentRef.current;
            if (!canvasSizeChanged && !seasonChanged && !customColorChanged) return;
            if (canvasSizeChanged && previousCanvasWidth > 0)
              return (
                (previousCanvasWidth = canvasPixelWidth),
                (previousCanvasHeight = canvasHeightAt183e55),
                (qrSnapshotRef.current = ""),
                onQrSnapshotUpdated?.current?.(""),
                void (customColorChanged = !0)
              );
            ((customColorChanged = !1),
              (previousSeason = seasonRef.current),
              (previousQrContent = customColorSignature),
              (previousTreeSeed = qrContentRef.current),
              (previousCanvasWidth = canvasPixelWidth),
              (previousCanvasHeight = canvasHeightAt183e55));
            const rainMode = 2 === seasonRef.current ? 1 : 0;
            drawBeachScene(rendererStateAtf2509b, {
              time: 0,
              progress: 1,
              season: seasonRef.current,
              cameraBobX: beachYawRef.current,
              cameraBobY: 0,
              burstTime: 0,
              customR: customColorRef.current[0],
              customG: customColorRef.current[1],
              customB: customColorRef.current[2],
              customStrength: customColorRef.current[3],
              rainMode,
              trunkSeed: trunkSeed,
            });
            const snapshotCanvas = document.createElement("canvas");
            ((snapshotCanvas.width = canvasPixelWidth), (snapshotCanvas.height = canvasHeightAt183e55));
            const snapshotContext = snapshotCanvas.getContext("2d");
            if (snapshotContext) {
              snapshotContext.drawImage(canvasElement, 0, 0);
              const qrSnapshotDataUrl = snapshotCanvas.toDataURL("image/png");
              ((qrSnapshotRef.current = qrSnapshotDataUrl),
                onQrSnapshotUpdated?.current?.(qrSnapshotDataUrl));
            }
          };
          setTimeout(updateQrSnapshot, 50);
          let lastFlatSettledState = !1;
          const renderFrame = () => {
            if (!isCurrentInitialization()) return;
            const frameTimestamp = Date.now(),
              deltaSeconds = Math.min((frameTimestamp - previousFrameTime.current) / 1e3, 0.05);
            previousFrameTime.current = frameTimestamp;
            const flatTarget = isFlat.current ? 1 : 0;
            var previousFlatProgress;
            ((flatProgressRefAt3efc2e.current +=
              (flatTarget - flatProgressRefAt3efc2e.current) * Math.min(1, 3.5 * deltaSeconds)),
              Math.abs(flatProgressRefAt3efc2e.current - flatTarget) < 0.001 &&
                (flatProgressRefAt3efc2e.current = flatTarget),
              (flatProgressRefAt5e63cf.current =
                (previousFlatProgress = flatProgressRefAt3efc2e.current) < 0.5
                  ? 4 * previousFlatProgress * previousFlatProgress * previousFlatProgress
                  : 1 - (-2 * previousFlatProgress + 2) ** 3 / 2));
            const flatSettled = flatProgressRefAt3efc2e.current >= 0.9 && 1 === flatTarget;
            flatSettled !== lastFlatSettledState &&
              ((lastFlatSettledState = flatSettled), onFlatSettled?.current?.(flatSettled));
            const sceneTime = (frameTimestamp - sceneStartTime.current) / 1e3,
              flatProgress = flatProgressRefAt5e63cf.current,
              sceneVisibility = 1 - flatProgress,
              burstElapsedTime = sceneTime - burstStartTime.current,
              burstOffset =
                Math.exp(6 * -burstElapsedTime) * Math.sin(12 * burstElapsedTime) * 0.008,
              cameraBobX = 0.003 * Math.sin(0.15 * sceneTime) * sceneVisibility,
              cameraBobY =
                0.002 * Math.sin(0.11 * sceneTime + 1) * sceneVisibility + burstOffset;
            isFlat.current !== previousFlatState.current &&
              ((previousFlatState.current = isFlat.current),
              (burstStartTime.current = sceneTime));
            const targetRainMode = 2 === seasonRef.current ? 1 : 0;
            if (
              ((rainTransition.current +=
                (targetRainMode - rainTransition.current) * Math.min(1, 3 * deltaSeconds)),
              Math.abs(rainTransition.current - targetRainMode) < 0.001 &&
                (rainTransition.current = targetRainMode),
              false && seasonRef.current !== previousSeasonRef.current && qrAnalysisRef.current)
            ) {
              ((previousSeasonRef.current = seasonRef.current),
                setNoiseSeed(hashSeed(treeSeedRef.current)));
              const treeConfigAt35f428 = qrAnalysisRef.current,
                treeGridSize = treeGridSizeRef.current,
                treeBranchesAt562ec3 = createTreeBranches(treeConfigAt35f428, treeGridSize),
                canopyFlowersAt3fa020 = generateCanopyFlowers(treeBranchesAt562ec3.tips, treeConfigAt35f428),
                qrFlowers = generateQrFlowers(qrMatrixRef.current),
                fallingPetalsAt3d438e = generateFallingPetals(treeBranchesAt562ec3.tips, treeGridSize);
              !(function (
                rendererStateAt2e4fd9,
                treeBranchesAt1d2393,
                canopyFlowersAt17c7bd,
                qrFlowerPositions,
                qrFlowerCountAt21d3e5,
                fallingPetalsAt30ab7f,
              ) {
                const { device: deviceAt3f4ff5, buffers: buffers } = rendererStateAt2e4fd9,
                  branchUploadBuffer = rendererStateAt2e4fd9._branchUpload;
                (branchUploadBuffer.fill(0),
                  branchUploadBuffer.set(treeBranchesAt1d2393.segments),
                  deviceAt3f4ff5.queue.writeBuffer(
                    buffers.branchBuffer,
                    0,
                    branchUploadBuffer,
                  ),
                  (rendererStateAt2e4fd9.counts.segmentCount = treeBranchesAt1d2393.segmentCount));
                const flowerCount = canopyFlowersAt17c7bd.count + qrFlowerCountAt21d3e5,
                  flowerUploadBuffer = rendererStateAt2e4fd9._flowerUpload;
                (flowerUploadBuffer.fill(0), flowerUploadBuffer.set(canopyFlowersAt17c7bd.positions));
                for (let qrFlowerBufferIndex = 0; qrFlowerBufferIndex < 4 * qrFlowerCountAt21d3e5; qrFlowerBufferIndex++)
                  flowerUploadBuffer[4 * canopyFlowersAt17c7bd.count + qrFlowerBufferIndex] =
                    qrFlowerPositions[qrFlowerBufferIndex];
                (deviceAt3f4ff5.queue.writeBuffer(
                  buffers.flowerBuffer,
                  0,
                  flowerUploadBuffer,
                ),
                  (rendererStateAt2e4fd9.counts.flowerCount = flowerCount));
                const petalUploadBuffer = rendererStateAt2e4fd9._petalUpload;
                (petalUploadBuffer.fill(0),
                  petalUploadBuffer.set(fallingPetalsAt30ab7f.positions),
                  deviceAt3f4ff5.queue.writeBuffer(
                    buffers.fallingPetalBuffer,
                    0,
                    petalUploadBuffer,
                  ),
                  (rendererStateAt2e4fd9.counts.petalCount = fallingPetalsAt30ab7f.count));
              })(
                rendererStateAtf2509b,
                treeBranchesAt562ec3,
                canopyFlowersAt3fa020,
                qrFlowers.positions,
                qrFlowers.count,
                fallingPetalsAt3d438e,
              );
            }
            updateQrSnapshot();
            drawBeachScene(rendererStateAtf2509b, {
                time: sceneTime,
                progress: flatProgress,
                season: seasonRef.current,
                cameraBobX: cameraBobX + beachYawRef.current,
                cameraBobY: cameraBobY,
                burstTime: burstStartTime.current,
                customR: customColorRef.current[0],
                customG: customColorRef.current[1],
                customB: customColorRef.current[2],
                customStrength: customColorRef.current[3],
                rainMode: rainTransition.current,
                trunkSeed: trunkSeed,
              });
          };
          frameLoopRef.current = createFrameLoop(renderFrame);
          frameLoopRef.current.start();
        } catch (webgpuInitializationError) {
          console.error("WebGPU init failed:", webgpuInitializationError);
        } finally {
          rendererInitializing.current = !1;
        }
      };
      (runSetup(() => {
        const initializationTimer = setTimeout(initializeRenderer, 100);
        return () => {
          clearTimeout(initializationTimer);
        };
      }),
        runSetup(() => {
          const currentCanvas = canvasRef.current;
          !currentCanvas ||
            canvasWidth <= 0 ||
            canvasHeightAt41144e <= 0 ||
            (rendererRef.current &&
              rendererCanvasRef.current !== currentCanvas &&
              (frameLoopRef.current &&
                (frameLoopRef.current.stop(),
                (frameLoopRef.current = null)),
              (rendererRef.current = null),
              (rendererCanvasRef.current = null),
              (sceneStartTime.current = Date.now()),
              (previousFrameTime.current = Date.now())),
            rendererRef.current || initializeRenderer());
        }),
        runSetup(() => {
          const activeRenderer = rendererRef.current,
            sceneCanvasElement = canvasRef.current;
          activeRenderer &&
            sceneCanvasElement &&
            (canvasWidth <= 0 ||
              canvasHeightAt41144e <= 0 ||
              (function (rendererStateAt220be7) {
                if (!rendererStateAt220be7.renderTargets.resize()) return;
                rendererStateAt220be7.bindGroups.blur = rendererStateAt220be7.blur.createBindGroup(rendererStateAt220be7.sceneTextureView);
                rendererStateAt220be7.aspectRatio = gpuSurface.width / gpuSurface.height;
              })(activeRenderer));
        }),
        runSetup(() => () => {
          rendererGenerationRef.current++;
          frameLoopRef.current?.stop();
        }));
    })({ canvasRef, canvasWidth, canvasHeight, qrContent, isFlat, seasonRef, customColorRef, treeSeed, qrSnapshotRef: null, onFlatSettled: null, onQrSnapshotUpdated: null, beachYawRef, beachDragRef });
}

import { createFrameLoop, renderSceneFrame } from "../core/renderer.js";

export const SCENE = createSceneModule({
  id: "beach",
  settings: {
    seasons: ["spring", "summer", "autumn"],
    defaultSeason: "spring",
  },
  createRuntime: options => createSceneRuntime(options, setupBeachRuntime),
  beforeMount() {
    globalThis.__ICQR_QR_ONLY__ = true;
    globalThis.__ICQR_BEACH_MODE__ = true;
  },
  afterUnmount() {
    globalThis.__ICQR_QR_ONLY__ = false;
    globalThis.__ICQR_BEACH_MODE__ = false;
  },
});
