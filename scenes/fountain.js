import { encodeQrMatrix } from "../core/qr.js";
import { ALPHA_BLEND_STATE, createBindGroup, createBindGroupLayout, createIndexBuffer, createRenderTargets, createScenePipeline, createStorageBuffer, createUniformBuffer, createVertexBuffer } from "../core/gpu.js";
import { ENGINE_SETTINGS } from "../core/settings.js";
import { createSceneModule, createSceneRuntime } from "../core/scene-runtime.js";
import { SCENE_UNIFORM_WGSL, createIsometricTransformWgsl } from "../core/scene-wgsl.js";
import { createTransitionBlur } from "../core/blur.js";
import { writeSceneUniforms } from "../core/scene-uniforms.js";
import { KOI_INDEX_COUNT, KOI_INDICES, KOI_VERTEX_DATA, KOI_VERTEX_STRIDE } from "../assets/meshes/koi.js";
import { BIRD_BASE_COLOR_TEXTURE, BIRD_BONE_COUNT, BIRD_CLIPS, BIRD_INDEX_COUNT, BIRD_INDICES, BIRD_JOINTS, BIRD_NORMALS, BIRD_POSITIONS, BIRD_UVS, BIRD_WEIGHTS } from "../assets/meshes/bird.js";

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
    blockTypeMap
  );
})({});

const FOUNTAIN_QR_APPEARANCE = {
  colors: { qr: { dark: [.26, .52, .62], light: [.80, .74, .62] } },
  qrPalette: [[.80, .74, .62], [.26, .52, .62], [.48, .45, .38], [.34, .40, .35]],
  createQrModules(matrix) {
    const size = matrix.length;
    const modules = new Uint32Array(size * size);
    for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
      if (!matrix[row][column]) continue;
      const distance = Math.hypot(column - size * .5, row - size * .5) / size;
      modules[row * size + column] = distance < .07 || (distance >= .145 && distance < .165) || (distance >= .215 && distance < .235) || (distance >= .36 && distance < .41) ? 2 : distance < .36 ? 1 : 3;
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
      if (!qrMatrix[row][column]) {
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
    // Modanature sovrapposte, riprese dalla colonna decorata del riferimento.
    [[0.125, 0.175], [0.140, 0.195], [0.158, 0.195], [0.173, 0.175]],
    [[0.370, 0.088], [0.386, 0.112], [0.405, 0.112], [0.421, 0.088]],
    [[0.645, 0.052], [0.660, 0.074], [0.680, 0.074], [0.695, 0.052]],
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

function generateGrass(grassGridSize, qrMatrixAt484328) {
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
      if (noise(grassColumnIndex, grassRowIndex, 5000) > 0.15) continue;
      const grassBladesPerCell = 7 + Math.floor(4 * noise(grassColumnIndex, grassRowIndex, 5100));
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
  const rainParticleValues = new Float32Array(2e3),
    rainSpan = 1.2 * rainGridSize;
  for (let rainParticleIndex = 0; rainParticleIndex < 500; rainParticleIndex++) {
    const rainWorldX =
        seededNoise(rainParticleIndex, 0, 8e3) * rainSpan -
        0.5 * (rainSpan - rainGridSize),
      rainWorldZ =
        seededNoise(rainParticleIndex, 0, 8100) * rainSpan -
        0.5 * (rainSpan - rainGridSize),
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
      const angularJitter = tier < 2 ? (seed - .5) * 1.35 : (seed - .5) * .72;
      streams.set([
        tier,
        radiusRatio * gridSize,
        (stream + angularJitter) / streamCount,
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

function generateKoi(gridSize) {
  return {
    positions: new Float32Array([
      gridSize * 0.23, 0.16, 0.945, 0.15,
      gridSize * 0.17, 0.11, 0.738, 0.56,
      gridSize * 0.29, -0.09, 0.828, 0.84,
    ]),
    count: 3,
  };
}

function generateButterflies(gridSize) {
  const positions = new Float32Array(40);
  for (let index = 0; index < 10; index++) {
    positions.set([
      gridSize * 0.46 * (0.35 + 0.55 * seededNoise(index, 0, 9000)),
      0.25 + 0.3 * seededNoise(index, 0, 9100),
      4 + 9 * seededNoise(index, 0, 9200),
      seededNoise(index, 0, 9300),
    ], index * 4);
  }
  return { positions, count: 10 };
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

 const WGSL_BLOCK_SIZE = String(ENGINE_SETTINGS.qr.blockSize);
const WGSL_ACES_FILM = `
fn acesFilm(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
`;
const FOUNTAIN_MODEL_SCALE = 0.90;
const AUTUMN_RIPPLE_VERTICES = 144;
const FOUNTAIN_RIPPLE_VERTICES = 144;
const FOUNTAIN_RADIAL_SIDES = 32;
// Beach decorations are deliberately tiny and independent of QR modules.
const FOUNTAIN_WATER_VERTICES_PER_ELEMENT = 120;
const FOUNTAIN_QR_WATER_COLOR = [0.32, 0.62, 0.82];
const BIRD_MAX_INSTANCE_COUNT = 4;
const BIRD_FLIGHTS = [
  ["fly1_bird", 0.93, 0.00],
  ["fly1_bird", 1.07, 0.27],
  ["fly1_bird", 0.88, 0.53],
  ["fly1_bird", 1.12, 0.74],
];

async function createBirdTexture(device) {
  const image = await createImageBitmap(await (await fetch(BIRD_BASE_COLOR_TEXTURE)).blob());
  const texture = device.createTexture({ size: [image.width, image.height], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  device.queue.copyExternalImageToTexture({ source: image }, { texture }, [image.width, image.height]);
  image.close();
  return { view: texture.createView(), sampler: device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" }) };
}

function updateBirdSkin(renderer, time) {
  const skinMatrices = renderer._birdSkinUpload;
  for (let birdIndex = 0; birdIndex < renderer.counts.birdCount; birdIndex++) {
    const [clipName, speed, phase] = BIRD_FLIGHTS[birdIndex];
    const clip = BIRD_CLIPS[clipName];
    const sample = ((time * speed + phase * clip.duration) % clip.duration) / clip.duration * (clip.frames - 1);
    const firstFrame = Math.floor(sample);
    const secondFrame = Math.min(firstFrame + 1, clip.frames - 1);
    const mix = sample - firstFrame;
    const firstOffset = firstFrame * BIRD_BONE_COUNT * 16;
    const secondOffset = secondFrame * BIRD_BONE_COUNT * 16;
    const targetOffset = birdIndex * BIRD_BONE_COUNT * 16;
    for (let index = 0; index < BIRD_BONE_COUNT * 16; index++) {
      skinMatrices[targetOffset + index] = clip.matrices[firstOffset + index] * (1 - mix) + clip.matrices[secondOffset + index] * mix;
    }
  }
  renderer.device.queue.writeBuffer(renderer.buffers.birdBoneBuffer, 0, skinMatrices);
}
// Simplified from experience_the_tranquility_of_the_seaside.glb: five water
// planes animated through 15 morph targets over a 0.5 second loop.
function uploadSceneData(renderer, voxelBlocks, fountainGeometry, canopyFlowers, qrFlowerPositions, qrFlowerCount, grass, groundFlowers, pebbleData, fallingPetals, fountainWater, koi, butterflies, autumnWaterLeaves, rain) {
  const { device, buffers, counts } = renderer;
  device.queue.writeBuffer(buffers.typeBuffer, 0, voxelBlocks.types);
  device.queue.writeBuffer(buffers.posBuffer, 0, voxelBlocks.positions);
  device.queue.writeBuffer(buffers.heightBuffer, 0, voxelBlocks.heights);
  device.queue.writeBuffer(buffers.baseYBuffer, 0, voxelBlocks.baseY);
  counts.numBlocks = voxelBlocks.numBlocks;
  counts.gridSize = voxelBlocks.gridSize;

  const profileUpload = renderer._fountainProfileUpload;
  profileUpload.fill(0);
  profileUpload.set(fountainGeometry.segments);
  device.queue.writeBuffer(buffers.fountainProfileBuffer, 0, profileUpload);
  counts.fountainBandCount = fountainGeometry.segmentCount;

  const flowerUpload = renderer._flowerUpload;
  flowerUpload.fill(0);
  flowerUpload.set(canopyFlowers.positions);
  flowerUpload.set(qrFlowerPositions, 4 * canopyFlowers.count);
  device.queue.writeBuffer(buffers.flowerBuffer, 0, flowerUpload);
  counts.flowerCount = canopyFlowers.count + qrFlowerCount;
  flowerUpload.fill(0);
  flowerUpload.set(autumnWaterLeaves.positions);
  device.queue.writeBuffer(buffers.flowerBuffer, 0, flowerUpload);
  counts.autumnLeafCount = autumnWaterLeaves.count;

  device.queue.writeBuffer(buffers.grassBuffer, 0, grass.positions);
  counts.grassCount = grass.count;
  device.queue.writeBuffer(buffers.groundFlowerBuffer, 0, groundFlowers.positions);
  counts.groundFlowerCount = groundFlowers.count;

  device.queue.writeBuffer(buffers.pebbleBuffer, 0, pebbleData.positions);
  counts.pebbleCount = pebbleData.count;

  const petalUpload = renderer._petalUpload;
  petalUpload.fill(0);
  petalUpload.set(fallingPetals.positions);
  device.queue.writeBuffer(buffers.fallingPetalBuffer, 0, petalUpload);
  counts.petalCount = fallingPetals.count;

  if (fountainWater) {
    const waterUpload = renderer._rainUpload;
    waterUpload.fill(0);
    waterUpload.set(fountainWater.positions);
    device.queue.writeBuffer(buffers.rainBuffer, 0, waterUpload);
    counts.fountainWaterCount = fountainWater.count;
  }
  if (koi) {
    const koiUpload = renderer._butterflyUpload;
    koiUpload.fill(0);
    koiUpload.set(koi.positions);
    device.queue.writeBuffer(buffers.butterflyBuffer, 0, koiUpload);
    counts.koiCount = koi.count;
  }
  if (butterflies) {
    const butterflyUpload = renderer._springButterflyUpload;
    butterflyUpload.fill(0);
    butterflyUpload.set(butterflies.positions);
    device.queue.writeBuffer(buffers.springButterflyBuffer, 0, butterflyUpload);
    counts.butterflyCount = butterflies.count;
  }
  if (rain) {
    device.queue.writeBuffer(buffers.weatherRainBuffer, 0, rain.positions);
    counts.rainCount = rain.count;
  }
}

function drawFountainScene(renderer, sceneState) {
  renderer.qrScene = FOUNTAIN_QR_APPEARANCE;
  const {
      buffers,
      pipelines,
      bindGroups,
      counts,
    } = renderer;

  // Keep the QR material palette stable: station/season controls belong to
  // the inherited tree experience, not to this fountain scene.
  renderer.uniformDefaults ??= {
    customR: FOUNTAIN_QR_WATER_COLOR[0], customG: FOUNTAIN_QR_WATER_COLOR[1], customB: FOUNTAIN_QR_WATER_COLOR[2], customStrength: 1,
  };
  renderer.uniformTargets ??= [
    { buffer: buffers.blockUniforms, count: "numBlocks" },
    { buffer: buffers.fountainUniforms, count: "fountainBandCount" },
    { buffer: buffers.pebbleUniforms, count: "pebbleCount" },
    { buffer: buffers.petalUniforms, count: "petalCount" },
    { buffer: buffers.rainUniforms, count: "fountainWaterCount" },
    { buffer: buffers.weatherRainUniforms, count: "rainCount" },
    { buffer: buffers.butterflyUniforms, count: "koiCount" },
    { buffer: buffers.grassUniforms, count: "grassCount" },
    { buffer: buffers.groundFlowerUniforms, count: "groundFlowerCount", overrides: { season: 0, customStrength: 0 } },
    { buffer: buffers.springButterflyUniforms, count: "butterflyCount", overrides: { season: 1 } },
    { buffer: buffers.autumnLeafUniforms, count: "autumnLeafCount", overrides: { season: 2, customStrength: 0 } },
    { buffer: buffers.birdUniforms, count: "birdCount", overrides: { season: 0 } },
  ];
  writeSceneUniforms(renderer, sceneState, renderer.uniformTargets);

  const qrOnlyMode = globalThis.__ICQR_QR_ONLY__ === true;
  renderSceneFrame(renderer, sceneState, { blur: true, draw(mainRenderPass) {
  if (!renderer.gpuSurface.transparent) {
    mainRenderPass.setPipeline(pipelines.sky);
    mainRenderPass.setBindGroup(0, bindGroups.sky);
    mainRenderPass.draw(3);
  }
  if (!qrOnlyMode) {
    mainRenderPass.setPipeline(pipelines.shadow);
    mainRenderPass.setBindGroup(0, bindGroups.shadow);
    mainRenderPass.draw(6);
  }

  if (!qrOnlyMode && counts.pebbleCount > 0 && pipelines.pebbles) {
    mainRenderPass.setPipeline(pipelines.pebbles);
    mainRenderPass.setBindGroup(0, bindGroups.pebbles);
    mainRenderPass.draw(54 * counts.pebbleCount);
  }
  if (!qrOnlyMode && sceneState.season < 2.5 && counts.grassCount > 0 && pipelines.grass) {
    mainRenderPass.setPipeline(pipelines.grass);
    mainRenderPass.setBindGroup(0, bindGroups.grass);
    mainRenderPass.draw(3 * counts.grassCount);
  }
  if (!qrOnlyMode && sceneState.season > .5 && sceneState.season < 2.5 && counts.groundFlowerCount > 0 && pipelines.flowers) {
    mainRenderPass.setPipeline(pipelines.flowers);
    mainRenderPass.setBindGroup(0, bindGroups.groundFlowers);
    mainRenderPass.draw(150 * counts.groundFlowerCount);
  }
  if (!qrOnlyMode && counts.fountainBandCount > 0 && pipelines.fountain) {
    mainRenderPass.setPipeline(pipelines.fountain);
    mainRenderPass.setBindGroup(0, bindGroups.fountain);
    mainRenderPass.draw(FOUNTAIN_RADIAL_SIDES * 6 * counts.fountainBandCount);
  }
  // The fountain scene has no tree canopy or falling-petal layer.  The
  // inherited flower buffers remain allocated, but are intentionally never
  // rendered here so stale GPU data cannot appear inside the basins.
  if (!qrOnlyMode && sceneState.season < 2.5 && counts.fountainWaterCount > 0 && pipelines.fountainWater && sceneState.rainMode > 0.01) {
    mainRenderPass.setPipeline(pipelines.fountainWater);
    mainRenderPass.setBindGroup(0, bindGroups.fountainWater);
    mainRenderPass.draw(FOUNTAIN_WATER_VERTICES_PER_ELEMENT * counts.fountainWaterCount);
  }
  if (!qrOnlyMode && sceneState.season < 2.5 && counts.fountainWaterCount > 0 && pipelines.fountainRipples && sceneState.rainMode > 0.01) {
    mainRenderPass.setPipeline(pipelines.fountainRipples);
    mainRenderPass.setBindGroup(0, bindGroups.fountainWater);
    mainRenderPass.draw(FOUNTAIN_RIPPLE_VERTICES * counts.fountainWaterCount);
  }
  if (!qrOnlyMode && sceneState.season < 2.5 && counts.koiCount > 0 && pipelines.koi) {
    mainRenderPass.setPipeline(pipelines.koi);
    mainRenderPass.setBindGroup(0, bindGroups.koi);
    mainRenderPass.setVertexBuffer(0, renderer.koiVertexBuffer);
    mainRenderPass.setIndexBuffer(renderer.koiIndexBuffer, "uint16");
    mainRenderPass.drawIndexed(KOI_INDEX_COUNT, counts.koiCount);
  }
  if (!qrOnlyMode && sceneState.season > 0.5 && sceneState.season < 1.5 && counts.butterflyCount > 0 && pipelines.butterflies) {
    mainRenderPass.setPipeline(pipelines.butterflies);
    mainRenderPass.setBindGroup(0, bindGroups.butterflies);
    mainRenderPass.draw(6 * counts.butterflyCount);
  }
  if (!qrOnlyMode && sceneState.season < .5 && pipelines.birds) {
    updateBirdSkin(renderer, sceneState.time);
    mainRenderPass.setPipeline(pipelines.birds);
    mainRenderPass.setBindGroup(0, bindGroups.birds);
    mainRenderPass.setVertexBuffer(0, renderer.birdPositionBuffer);
    mainRenderPass.setVertexBuffer(1, renderer.birdNormalBuffer);
    mainRenderPass.setVertexBuffer(2, renderer.birdJointBuffer);
    mainRenderPass.setVertexBuffer(3, renderer.birdWeightBuffer);
    mainRenderPass.setVertexBuffer(4, renderer.birdUvBuffer);
    mainRenderPass.setIndexBuffer(renderer.birdIndexBuffer, "uint16");
    mainRenderPass.drawIndexed(BIRD_INDEX_COUNT, counts.birdCount);
  }
  if (!qrOnlyMode && sceneState.season > 1.5 && sceneState.season < 2.5 && counts.autumnLeafCount > 0) {
    if (pipelines.autumnRipples) {
      mainRenderPass.setPipeline(pipelines.autumnRipples);
      mainRenderPass.setBindGroup(0, bindGroups.autumnLeaves);
      mainRenderPass.draw(AUTUMN_RIPPLE_VERTICES * counts.autumnLeafCount);
    }
    mainRenderPass.setPipeline(pipelines.fallingPetals);
    mainRenderPass.setBindGroup(0, bindGroups.autumnLeaves);
    mainRenderPass.draw(150 * counts.autumnLeafCount);
  }
  if (!qrOnlyMode && sceneState.season > 2.5 && counts.rainCount > 0 && pipelines.rain) {
    mainRenderPass.setPipeline(pipelines.rain);
    mainRenderPass.setBindGroup(0, bindGroups.rain);
    mainRenderPass.draw(6 * counts.rainCount);
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

function setupFountainRuntime(runtime) {
  const { canvasRef, canvasWidth, canvasHeight, qrContent, isFlat, seasonRef, customColorRef, treeSeed, gpuSurface, qrRenderer, runSetup } = runtime;
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
          emptyFountainFlowers = { positions: new Float32Array(0), count: 0 },
          emptyQrFlowers = { positions: new Float32Array(0), count: 0 },
          grass = generateGrass(voxelBlocksAt311b94.gridSize, qrMatrixAt1db22b),
          groundFlowers = generateCanopyFlowers([], qrAnalysisAte480db),
          pebbleData = generatePebbleData(qrMatrixAt1db22b),
          emptyFallingPetals = generateFallingPetals([], voxelBlocksAt311b94.gridSize),
          fountainWater = generateFountainWater(voxelBlocksAt311b94.gridSize),
          koi = generateKoi(voxelBlocksAt311b94.gridSize),
          springButterflies = generateButterflies(voxelBlocksAt311b94.gridSize),
          autumnWaterLeaves = generateAutumnWaterLeaves(voxelBlocksAt311b94.gridSize),
          rain = generateRain(voxelBlocksAt311b94.gridSize);
        (uploadSceneData(
          renderer,
          voxelBlocksAt311b94,
          fountainGeometry,
          emptyFountainFlowers,
          emptyQrFlowers.positions,
          emptyQrFlowers.count,
          grass,
          groundFlowers,
          pebbleData,
          emptyFallingPetals,
          fountainWater,
          koi,
          springButterflies,
          autumnWaterLeaves,
          rain,
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
            const birdTexture = await createBirdTexture(deviceAt354206);
            const blockUniforms = createUniformBuffer(deviceAt354206, 64),
              branchUniforms = createUniformBuffer(deviceAt354206, 64),
              pebbleUniforms = createUniformBuffer(deviceAt354206, 64),
              petalUniforms = createUniformBuffer(deviceAt354206, 64),
              autumnLeafUniforms = createUniformBuffer(deviceAt354206, 64),
              rainUniforms = createUniformBuffer(deviceAt354206, 64),
              weatherRainUniforms = createUniformBuffer(deviceAt354206, 64),
              butterflyUniforms = createUniformBuffer(deviceAt354206, 64),
              springButterflyUniforms = createUniformBuffer(deviceAt354206, 64),
              grassUniforms = createUniformBuffer(deviceAt354206, 64),
              groundFlowerUniforms = createUniformBuffer(deviceAt354206, 64),
              birdUniforms = createUniformBuffer(deviceAt354206, 64),
              typeBuffer = createStorageBuffer(deviceAt354206, 268960),
              positionBuffer = createStorageBuffer(deviceAt354206, 1075840),
              heightBuffer = createStorageBuffer(deviceAt354206, 268960),
              baseYBuffer = createStorageBuffer(deviceAt354206, 268960),
              flowerBuffer = createStorageBuffer(deviceAt354206, 16e5),
              fountainProfileBuffer = createStorageBuffer(deviceAt354206, 24e3),
              pebbleBuffer = createStorageBuffer(deviceAt354206, 8e5),
              fallingPetalBuffer = createStorageBuffer(deviceAt354206, 160),
              rainBuffer = createStorageBuffer(deviceAt354206, 8e3),
              weatherRainBuffer = createStorageBuffer(deviceAt354206, 8e3),
              butterflyBuffer = createStorageBuffer(deviceAt354206, 160),
              springButterflyBuffer = createStorageBuffer(deviceAt354206, 160),
              grassBuffer = createStorageBuffer(deviceAt354206, 8e5),
              groundFlowerBuffer = createStorageBuffer(deviceAt354206, 16e5),
              birdBoneBuffer = createStorageBuffer(deviceAt354206, BIRD_MAX_INSTANCE_COUNT * BIRD_BONE_COUNT * 16 * 4),
              koiVertexBuffer = createVertexBuffer(deviceAt354206, KOI_VERTEX_DATA),
              koiIndexBuffer = createIndexBuffer(deviceAt354206, KOI_INDICES),
              birdPositionBuffer = createVertexBuffer(deviceAt354206, BIRD_POSITIONS),
              birdNormalBuffer = createVertexBuffer(deviceAt354206, BIRD_NORMALS),
              birdJointBuffer = createVertexBuffer(deviceAt354206, BIRD_JOINTS),
              birdWeightBuffer = createVertexBuffer(deviceAt354206, BIRD_WEIGHTS),
              birdUvBuffer = createVertexBuffer(deviceAt354206, BIRD_UVS),
              birdIndexBuffer = createIndexBuffer(deviceAt354206, BIRD_INDICES),
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
              birdBindGroupLayout = createBindGroupLayout(deviceAt354206, {
                entries: [
                  { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
                  { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
                  { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
                  { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
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
              weatherRainBindGroup = createBindGroup(deviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  { binding: 0, resource: { buffer: weatherRainUniforms } },
                  { binding: 1, resource: { buffer: weatherRainBuffer } },
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
              grassBindGroup = createBindGroup(deviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [{ binding: 0, resource: { buffer: grassUniforms } }, { binding: 1, resource: { buffer: grassBuffer } }],
              }),
              groundFlowersBindGroup = createBindGroup(deviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [{ binding: 0, resource: { buffer: groundFlowerUniforms } }, { binding: 1, resource: { buffer: groundFlowerBuffer } }],
              }),
              springButterflyBindGroup = createBindGroup(deviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  { binding: 0, resource: { buffer: springButterflyUniforms } },
                  { binding: 1, resource: { buffer: springButterflyBuffer } },
                ],
              }),
              birdBindGroup = createBindGroup(deviceAt354206, {
                layout: birdBindGroupLayout,
                entries: [
                  { binding: 0, resource: { buffer: birdUniforms } },
                  { binding: 1, resource: { buffer: birdBoneBuffer } },
                  { binding: 2, resource: birdTexture.view },
                  { binding: 3, resource: birdTexture.sampler },
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
                  "\n\n@fragment\nfn main(input: FlowerInput) -> @location(0) vec4f {\n  let N = normalize(vec3f(input.normalX, input.normalY, input.normalZ));\n  let t = input.petalT;\n  let rawSeed = input.seed;\n  let origIsLeaf = step(1.0, rawSeed);\n  let seed = rawSeed - origIsLeaf;\n\n  let season = uniforms.season;\n\n  let leafChance = fract(seed * 4.37);\n  var isLeaf = origIsLeaf;\n  let isGroundFlower = step(input.petalT, 0.01) * (1.0 - origIsLeaf);\n\n  if (season > 0.5 && season < 1.5) {\n    isLeaf = 1.0;\n  } else if (season > 1.5 && season < 2.5) {\n    isLeaf = 1.0;\n    if (leafChance < 0.40) { discard; }\n  }\n\n  var leafDark   = vec3f(0.25, 0.40, 0.22);\n  var leafMedium = vec3f(0.40, 0.55, 0.30);\n  var leafLight  = vec3f(0.55, 0.68, 0.38);\n  var leafOlive  = vec3f(0.48, 0.52, 0.28);\n\n  if (season > 0.5 && season < 1.5) {\n    leafDark   = vec3f(0.03, 0.12, 0.01);\n    leafMedium = vec3f(0.06, 0.20, 0.02);\n    leafLight  = vec3f(0.12, 0.28, 0.03);\n    leafOlive  = vec3f(0.08, 0.18, 0.02);\n  } else if (season > 1.5 && season < 2.5) {\n    leafDark   = vec3f(0.42, 0.12, 0.05);\n    leafMedium = vec3f(0.58, 0.21, 0.07);\n    leafLight  = vec3f(0.70, 0.34, 0.09);\n    leafOlive  = vec3f(0.62, 0.40, 0.07);\n  }\n\n  var shadeDeep   = vec3f(0.48, 0.035, 0.025);\n  var shadeMedium = vec3f(0.68, 0.060, 0.035);\n  var shadeLight  = vec3f(0.82, 0.100, 0.055);\n  var shadePale   = vec3f(0.92, 0.160, 0.090);\n  var shadeBlush  = vec3f(0.76, 0.075, 0.040);\n  var shadeWhite  = vec3f(0.96, 0.230, 0.130);\n  var stamenGold  = vec3f(0.40, 0.020, 0.010);\n\n  if (season > 0.5 && season < 1.5) {\n    shadeDeep   = vec3f(0.88, 0.90, 0.82);\n    shadeMedium = vec3f(0.92, 0.93, 0.85);\n    shadeLight  = vec3f(0.95, 0.95, 0.88);\n    shadePale   = vec3f(0.96, 0.96, 0.92);\n    shadeBlush  = vec3f(0.93, 0.94, 0.86);\n    shadeWhite  = vec3f(0.97, 0.97, 0.94);\n    stamenGold  = vec3f(0.82, 0.78, 0.35);\n  } else if (season > 1.5 && season < 2.5) {\n    shadeDeep   = vec3f(0.52, 0.08, 0.03);\n    shadeMedium = vec3f(0.64, 0.18, 0.05);\n    shadeLight  = vec3f(0.72, 0.32, 0.07);\n    shadePale   = vec3f(0.78, 0.46, 0.12);\n    shadeBlush  = vec3f(0.68, 0.25, 0.07);\n    shadeWhite  = vec3f(0.80, 0.58, 0.20);\n    stamenGold  = vec3f(0.62, 0.42, 0.08);\n  }\n\n  var baseColor = vec3f(0.0);\n\n  if (isLeaf > 0.5) {\n    let leafTier = fract(seed * 5.17);\n    var leafBase: vec3f;\n    var leafTip: vec3f;\n    if (leafTier < 0.35) { leafBase = leafDark; leafTip = leafMedium; }\n    else if (leafTier < 0.6) { leafBase = leafMedium; leafTip = leafLight; }\n    else if (leafTier < 0.85) { leafBase = leafOlive; leafTip = leafLight; }\n    else { leafBase = leafDark; leafTip = leafOlive; }\n    baseColor = mix(leafBase, leafTip, t);\n  } else if (input.isCenter > 0.5) {\n    let goldVar = fract(seed * 13.3) * 0.15;\n    let goldColor = stamenGold * (0.9 + goldVar);\n    let centerLeaf = mix(leafDark, leafMedium, fract(seed * 5.17));\n    baseColor = mix(goldColor, centerLeaf, min(season, 1.0));\n  } else {\n    if (season > 0.5 && season < 2.5) {\n      let leafTier2 = fract(seed * 8.13);\n      var lBase: vec3f;\n      var lTip: vec3f;\n      if (leafTier2 < 0.3) { lBase = leafDark; lTip = leafMedium; }\n      else if (leafTier2 < 0.6) { lBase = leafMedium; lTip = leafLight; }\n      else if (leafTier2 < 0.85) { lBase = leafOlive; lTip = leafLight; }\n      else { lBase = leafDark; lTip = leafOlive; }\n      baseColor = mix(lBase, lTip, t);\n    } else {\n      let tier = fract(seed * 7.31);\n      var petalBase: vec3f;\n      var petalTip: vec3f;\n      if (tier < 0.2) { petalBase = shadeDeep; petalTip = shadeMedium; }\n      else if (tier < 0.35) { petalBase = shadeMedium; petalTip = shadeLight; }\n      else if (tier < 0.50) { petalBase = shadeLight; petalTip = shadePale; }\n      else if (tier < 0.65) { petalBase = shadeBlush; petalTip = shadePale; }\n      else if (tier < 0.80) { petalBase = shadePale; petalTip = shadeWhite; }\n      else { petalBase = shadeDeep; petalTip = shadeBlush; }\n      baseColor = mix(petalBase, petalTip, t);\n\n      let veinT = abs(t - 0.5) * 2.0;\n      let veinDarken = 1.0 - (1.0 - veinT) * 0.08;\n      baseColor = baseColor * veinDarken;\n    }\n  }\n\n  // Custom color override — preserve tonal variation from original shading\n  let customStrength = uniforms.customStrength;\n  if (customStrength > 0.01) {\n    let customCol = vec3f(uniforms.customR, uniforms.customG, uniforms.customB);\n    let luma = dot(baseColor, vec3f(0.299, 0.587, 0.114));\n    // Keep original brightness deltas — shift hue while preserving shade variety\n    let baseLuma = dot(customCol, vec3f(0.299, 0.587, 0.114));\n    let lumaDelta = luma - 0.5;\n    let tinted = customCol * (0.7 + lumaDelta * 1.2) + vec3f(lumaDelta * 0.15);\n    baseColor = mix(baseColor, tinted, customStrength);\n  }\n\n  const sunDir = vec3f(-0.405616, 0.861934, -0.304212);\n  let sunColor = vec3f(1.20, 1.20, 1.20);\n  let ambient = vec3f(0.28, 0.28, 0.30);\n  let NdotL = max(dot(N, sunDir), 0.0);\n\n  let NdotLBack = max(dot(-N, sunDir), 0.0);\n  let sssColor = mix(vec3f(1.0, 0.55, 0.65), vec3f(0.6, 0.8, 0.4), isLeaf);\n  let subsurface = NdotLBack * 0.22 * sssColor;\n\n  let skyFill = vec3f(0.90, 0.85, 0.88);\n  let skyContrib = max(N.y, 0.0) * 0.12 * skyFill;\n\n  let depthDarken = mix(0.92, 1.0, fract(seed * 11.3));\n  let undersideDarken = mix(0.55, 1.0, max(N.y, 0.0)) * depthDarken;\n\n  const viewDir = vec3f(0.398015, 0.597022, 0.696526);\n  let rimDot = 1.0 - max(dot(N, viewDir), 0.0);\n  let rim = pow(rimDot, 3.0) * 0.10 * vec3f(1.0, 0.85, 0.88);\n\n  let lit = baseColor * undersideDarken * (ambient + sunColor * NdotL * 0.88) + subsurface + skyContrib + rim;\n\n  let hdr = acesFilm(lit * 1.05);\n  var ldr = pow(hdr, vec3f(1.0 / 2.2));\n\n  let gray = dot(ldr, vec3f(0.299, 0.587, 0.114));\n  ldr = mix(vec3f(gray), ldr, 1.9);\n\n  // Darken spring flowers in QR transition for better contrast\n  if (season < 0.5 && isLeaf < 0.5) {\n    let qrDarken = uniforms.progress * uniforms.progress;\n    // Extra darkening for light/snow custom colors\n    let brightness = dot(ldr, vec3f(0.299, 0.587, 0.114));\n    let extraDark = mix(0.55, 0.42, smoothstep(0.5, 0.8, brightness) * customStrength);\n    ldr = ldr * mix(1.0, extraDark, qrDarken);\n  }\n\n  return vec4f(ldr, 1.0);\n}\n",
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
  @location(2) band: f32,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> profile: array<vec4f>;
const SIDES: u32 = ${FOUNTAIN_RADIAL_SIDES}u;
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
  output.band = f32(bandIndex);
  ${createIsometricTransformWgsl()}
  output.position = vec4f((ry_x + xOffsetScene) * scaleX, (rx_y + yOffsetScene) * scaleY, rx_z * 0.01 + 0.5, 1.0);
  return output;
}`;
            const FOUNTAIN_FRAGMENT_SHADER = `${SCENE_UNIFORM_WGSL}
struct FountainInput { @location(0) normal: vec3f, @location(1) height: f32, @location(2) band: f32 }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
${WGSL_ACES_FILM}
@fragment
fn main(input: FountainInput) -> @location(0) vec4f {
  let light = normalize(vec3f(-0.405616, 0.861934, -0.304212));
  let normal = normalize(input.normal);
  let ndotl = max(dot(normal, light), 0.0);
  var warmStone = mix(vec3f(0.56, 0.46, 0.30), vec3f(0.92, 0.81, 0.57), clamp(input.height * 1.8, 0.0, 1.0));
  // Bands 3–5 are the concave wall and floor of the lowest basin.
  if (input.band > 2.5 && input.band < 5.5) {
    let innerWall = vec3f(.34, .28, .18);
    let innerFloor = vec3f(.20, .24, .18);
    warmStone = select(innerWall, innerFloor, input.band > 4.5);
  }
  // Darken undersides and inward-facing bowl walls so the three cavities read.
  let upwardFacing = smoothstep(-0.45, 0.65, normal.y);
  var cavityOcclusion = mix(0.48, 1.0, upwardFacing);
  if (input.band > 2.5 && input.band < 5.5) { cavityOcclusion *= .72; }
  let rimHighlight = pow(max(normal.y, 0.0), 7.0) * 0.10;
  var lit = warmStone * (vec3f(0.20) + vec3f(1.15) * ndotl * 0.82) * cavityOcclusion + vec3f(rimHighlight);
  let winter = smoothstep(2.5, 3.0, uniforms.season);
  let snow = winter * smoothstep(0.32, 0.76, normal.y);
  let snowLit = vec3f(0.92, 0.96, 1.0) * (0.82 + ndotl * 0.28);
  lit = mix(lit, snowLit, snow);
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
  var lit = stone * (vec3f(0.24) + vec3f(1.2) * sun * 0.82);
  let winter = smoothstep(2.5, 3.0, uniforms.season);
  let snow = winter * smoothstep(0.52, 0.80, input.normalY);
  lit = mix(lit, vec3f(0.92, 0.96, 1.0) * (0.82 + sun * 0.28), snow);
  let hdr = acesFilm(lit * 1.05);
  return vec4f(pow(hdr, vec3f(1.0 / 2.2)), 1.0);
}`;
            let pebblePipeline = null;
            try {
              pebblePipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
                vertex: PEBBLE_VERTEX_SHADER,
                fragment: PEBBLE_FRAGMENT_SHADER,
                depthWrite: !0,
                depthCompare: "less",
              });
            } catch (pebblePipelineError) {
              console.error("Pebble pipeline failed (non-fatal):", pebblePipelineError);
            }
            // Copied from three.js: same grass geometry and palette.
            let grassPipeline = null;
            try {
              grassPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
                vertex: `${SCENE_UNIFORM_WGSL}
struct GrassOutput {
  @builtin(position) position: vec4f,
  @location(0) greenT: f32,
  @location(1) normalY: f32,
  @location(2) seed: f32,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> grassData: array<vec4f>;
const PI: f32 = 3.14159265;
@vertex fn main(@builtin(vertex_index) vertexIndex: u32) -> GrassOutput {
  var output: GrassOutput;
  let bladeIdx = vertexIndex / 3u;
  let vertIdx = vertexIndex % 3u;
  if (bladeIdx >= u32(uniforms.blockCount)) { output.position = vec4f(0.0, 0.0, -10.0, 1.0); return output; }
  let progress = uniforms.progress;
  let vis = smoothstep(0.0, 0.3, 1.0 - progress);
  if (vis < 0.01) { output.position = vec4f(0.0, 0.0, -10.0, 1.0); return output; }
  let data = grassData[bladeIdx]; let col = data.x; let row = data.y; let seed = data.z; let bladeHeight = data.w * vis;
  output.seed = seed;
  let blockSize = f32(${WGSL_BLOCK_SIZE});
  let halfGrid = uniforms.gridSize * blockSize * 0.5;
  let baseX = col * blockSize - halfGrid; let baseZ = row * blockSize - halfGrid;
  let angle = seed * PI * 2.0; let cosA = cos(angle); let sinA = sin(angle); let halfWidth = blockSize * 0.22;
  let tiltX = (seed - 0.5) * 0.4; let tiltZ = (fract(seed * 7.13) - 0.5) * 0.4;
  let windBase = sin(uniforms.time * 0.45 + col * 0.25 + row * 0.15) * 0.02;
  let windTurb = sin(uniforms.time * 1.1 + col * 0.8 + row * 0.6) * 0.005;
  let windX = windBase + windTurb;
  let windZ = sin(uniforms.time * 0.35 + col * 0.15 + row * 0.25) * 0.012;
  let tipOffX = (tiltX + windX) * bladeHeight * 4.0;
  let tipOffZ = (tiltZ + windZ) * bladeHeight * 4.0;
  var localPos = vec3f(0.0);
  if (vertIdx == 0u) { localPos = vec3f(baseX - halfWidth * cosA, blockSize, baseZ - halfWidth * sinA); output.greenT = 0.0; output.normalY = 0.3; }
  else if (vertIdx == 1u) { localPos = vec3f(baseX + halfWidth * cosA, blockSize, baseZ + halfWidth * sinA); output.greenT = 0.0; output.normalY = 0.3; }
  else { let curlDroop = bladeHeight * seed * 0.15; localPos = vec3f(baseX + tipOffX, blockSize + bladeHeight - curlDroop, baseZ + tipOffZ); output.greenT = 1.0; output.normalY = 0.9; }
  ${createIsometricTransformWgsl()}
  output.position = vec4f((ry_x + xOffsetScene) * scaleX, (rx_y + yOffsetScene) * scaleY, rx_z * 0.01 + 0.5, 1.0);
  return output;
}`,
                fragment: `${SCENE_UNIFORM_WGSL}
struct GrassInput { @location(0) greenT: f32, @location(1) normalY: f32, @location(2) seed: f32 }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
${WGSL_ACES_FILM}
@fragment fn main(input: GrassInput) -> @location(0) vec4f {
  let season = uniforms.season;
  var darkGreen = vec3f(0.12, 0.32, 0.06); var midGreen = vec3f(0.22, 0.48, 0.12); var lightGreen = vec3f(0.35, 0.58, 0.20);
  var coralPink = vec3f(0.65, 0.28, 0.30); var dustyRose = vec3f(0.55, 0.32, 0.28); var mossGreen = vec3f(0.30, 0.40, 0.15);
  var yellowFlower = vec3f(0.75, 0.68, 0.20); var whiteFlower = vec3f(0.88, 0.86, 0.78); var lavender = vec3f(0.55, 0.42, 0.62);
  if (season > 0.5 && season < 1.5) { darkGreen = vec3f(0.03, 0.16, 0.01); midGreen = vec3f(0.08, 0.28, 0.02); lightGreen = vec3f(0.16, 0.38, 0.04); mossGreen = vec3f(0.10, 0.22, 0.02); coralPink = vec3f(0.12, 0.28, 0.03); dustyRose = vec3f(0.08, 0.22, 0.02); yellowFlower = vec3f(0.44, 0.48, 0.10); whiteFlower = vec3f(0.58, 0.64, 0.42); lavender = vec3f(0.18, 0.30, 0.08); }
  else if (season > 1.5 && season < 2.5) { darkGreen = vec3f(0.42, 0.24, 0.08); midGreen = vec3f(0.56, 0.32, 0.10); lightGreen = vec3f(0.70, 0.42, 0.12); mossGreen = vec3f(0.50, 0.30, 0.08); coralPink = vec3f(0.62, 0.26, 0.10); dustyRose = vec3f(0.55, 0.28, 0.12); yellowFlower = vec3f(0.76, 0.52, 0.14); whiteFlower = vec3f(0.74, 0.62, 0.42); lavender = vec3f(0.52, 0.32, 0.18); }
  let tier = fract(input.seed * 7.31); var baseColor: vec3f; var tipColor: vec3f;
  if (tier < 0.22) { baseColor = darkGreen; tipColor = midGreen; } else if (tier < 0.42) { baseColor = midGreen; tipColor = lightGreen; } else if (tier < 0.55) { baseColor = mossGreen; tipColor = lightGreen; } else if (tier < 0.68) { baseColor = dustyRose; tipColor = coralPink; } else if (tier < 0.76) { baseColor = coralPink; tipColor = vec3f(0.72, 0.35, 0.35); } else if (tier < 0.84) { baseColor = midGreen; tipColor = yellowFlower; } else if (tier < 0.92) { baseColor = mossGreen; tipColor = whiteFlower; } else { baseColor = dustyRose; tipColor = lavender; }
  let color = mix(baseColor, tipColor, input.greenT); let N = normalize(vec3f(0.0, input.normalY, 0.3));
  let lit = color * (vec3f(0.22, 0.24, 0.18) + vec3f(1.20) * max(dot(N, vec3f(-0.405616, 0.861934, -0.304212)), 0.0) * 0.85);
  let hdr = acesFilm(lit * 1.1); var ldr = pow(hdr, vec3f(1.0 / 2.2)); let gray = dot(ldr, vec3f(0.299, 0.587, 0.114)); ldr = mix(vec3f(gray), ldr, 1.6);
  return vec4f(ldr, 1.0);
}`,
                depthWrite: !0, depthCompare: "less",
              });
            } catch (grassPipelineError) { console.error("Grass pipeline failed (non-fatal):", grassPipelineError); }
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
                  "\n\nstruct RainOutput {\n  @builtin(position) position: vec4f,\n  @location(0) alpha: f32,\n  @location(1) flakeUv: vec2f,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n@group(0) @binding(1) var<storage, read> rainData: array<vec4f>;\n\n@vertex\nfn main(@builtin(vertex_index) vertexIndex: u32) -> RainOutput {\n  var output: RainOutput;\n\n  let vertsPerDrop = 6u;\n  let dropIdx = vertexIndex / vertsPerDrop;\n  let localVert = vertexIndex % vertsPerDrop;\n\n  let count = u32(uniforms.blockCount);\n  if (dropIdx >= count) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let vis = smoothstep(0.0, 0.3, 1.0 - uniforms.progress) * uniforms.rainMode;\n  if (vis < 0.01) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let data = rainData[dropIdx];\n  let blockSize = f32(" +
                  WGSL_BLOCK_SIZE +
                  ");\n  let halfGrid = uniforms.gridSize * blockSize * 0.5;\n  let cycleT = fract((uniforms.time * (0.35 + data.w * 0.20) + data.z * 10.0) * 0.08);\n  let qv = array<vec2f, 6>(\n    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),\n    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)\n  )[localVert];\n  let flakeSize = blockSize * (0.13 + data.w * 0.12);\n  let drift = sin(uniforms.time * 0.55 + data.w * 12.0) * blockSize * 0.55;\n  let fade = smoothstep(0.0, 0.08, cycleT) * (1.0 - smoothstep(0.90, 1.0, cycleT));\n  output.alpha = fade * vis * (0.60 + data.w * 0.25);\n  output.flakeUv = qv;\n  let localPos = vec3f(\n    data.x * blockSize - halfGrid + drift + qv.x * flakeSize,\n    mix(blockSize * 45.0, blockSize * 0.5, cycleT) + qv.y * flakeSize,\n    data.y * blockSize - halfGrid + cos(uniforms.time * 0.40 + data.z * 9.0) * blockSize * 0.25\n  );\n\n  " +
                  createIsometricTransformWgsl() +
                  "\n  output.position = vec4f(\n    (ry_x + xOffsetScene) * scaleX,\n    (rx_y + yOffsetScene) * scaleY,\n    rx_z * 0.01 + 0.5,\n    1.0\n  );\n\n  return output;\n}\n",
                fragment:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct RainInput {\n  @location(0) alpha: f32,\n  @location(1) flakeUv: vec2f,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n\n@fragment\nfn main(input: RainInput) -> @location(0) vec4f {\n  let edge = 1.0 - smoothstep(0.72, 1.0, length(input.flakeUv));\n  let alpha = input.alpha * edge;\n  if (alpha < 0.01) { discard; }\n  return vec4f(vec3f(0.88, 0.93, 1.0) * alpha, alpha);\n}\n",
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
    let flow = fract(uniforms.time * (0.41 + stream.w * 0.16) + stream.z);
    let q = quad[localVertex];
    let flowY = mix(topY, bottomY, q.y);
    let flowRadius = mix(topRadius, bottomRadius, q.y);
    let tangent = vec2f(-sin(angle), cos(angle));
    // Narrow independent falls, with a different static width each.
    let width = blockSize * (.035 + stream.w * .12);
    let cascadePhase = uniforms.time * (5.5 + stream.w * 2.0) + stream.z * 6.2831853;
    let lateralSway = 0.0;
    let radialSway = 0.0;
    localPos = vec3f(cos(angle) * (flowRadius + radialSway) + tangent.x * (q.x * width + lateralSway), flowY, sin(angle) * (flowRadius + radialSway) + tangent.y * (q.x * width + lateralSway));
    // Each fall has a slow, independent active window; soft edges prevent
    // the artificial on/off flicker of a shared cycle.
    let presenceCycle = fract(uniforms.time * (.07 + stream.w * .06) + stream.z * 13.7);
    let activeDuration = .38 + fract(stream.w * 5.1) * .40;
    let streamPresence = smoothstep(.0, .09, presenceCycle) * (1.0 - smoothstep(activeDuration, min(activeDuration + .12, .99), presenceCycle));
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
    let crownSway = sin(uniforms.time * (1.6 + stream.w * .5) + stream.z * 6.2831853) * blockSize * 0.006;
    let flowPhase = uniforms.time * (1.5 + stream.w * .5) - arcT * 15.0;
    let flowRipple = sin(flowPhase) * blockSize * 0.012;
    // Six near-continuous bands move from the nozzle toward the cup; their
    // short soft gaps give the arc a rain-like flow without breaking it.
    let segmentPhase = fract(arcT * 6.0 - uniforms.time * (1.15 + stream.w * .32) + stream.z);
    let segmentPresence = smoothstep(.02, .10, segmentPhase) * (1.0 - smoothstep(.84, .96, segmentPhase));
    let animatedRadius = arcRadius + flowRipple;
    localPos = vec3f(cos(angle) * animatedRadius + tangent.x * (q.x * width + crownSway), waterY + flowRipple * 0.45, sin(angle) * animatedRadius + tangent.y * (q.x * width + crownSway));
    output.alpha = (0.16 + stream.w * 0.12) * visible * (0.78 + 0.22 * sin(flowPhase)) * segmentPresence;
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
            let fountainRipplePipeline = null;
            const FOUNTAIN_RIPPLE_VERTEX_SHADER = `${SCENE_UNIFORM_WGSL}
struct RippleOutput { @builtin(position) position: vec4f, @location(0) alpha: f32 }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> streamData: array<vec4f>;
@vertex fn main(@builtin(vertex_index) vertexIndex: u32) -> RippleOutput {
  var output: RippleOutput;
  let streamIndex = vertexIndex / ${FOUNTAIN_RIPPLE_VERTICES}u;
  let localVertex = vertexIndex % ${FOUNTAIN_RIPPLE_VERTICES}u;
  if (streamIndex >= u32(uniforms.blockCount)) { output.position = vec4f(0.0, 0.0, -10.0, 1.0); return output; }
  let stream = streamData[streamIndex];
  let tier = stream.x;
  if (tier > 2.5) { output.position = vec4f(0.0, 0.0, -10.0, 1.0); return output; }
  let blockSize = f32(${WGSL_BLOCK_SIZE});
  let scale = uniforms.gridSize * blockSize * ${FOUNTAIN_MODEL_SCALE};
  var flowSpeed = .41 + stream.w * .16;
  if (tier > 1.5) { flowSpeed = 1.5 + stream.w * .5; }
  let phase = fract(uniforms.time * flowSpeed + stream.z);
  let rippleAge = phase;
  let segment = localVertex / 6u;
  let corner = localVertex % 6u;
  let quad = array<vec2f, 6>(vec2f(0.,0.), vec2f(1.,0.), vec2f(0.,1.), vec2f(0.,1.), vec2f(1.,0.), vec2f(1.,1.));
  let q = quad[corner];
  let angle = (f32(segment) + q.x) / 24.0 * 6.2831853;
  let streamAngle = stream.z * 6.2831853;
  var impactRadius = stream.y * blockSize * ${FOUNTAIN_MODEL_SCALE};
  var impactY = scale * .105;
  if (tier > .5 && tier < 1.5) { impactY = scale * .358; }
  if (tier > 1.5) { impactRadius = scale * (.080 + stream.w * .025); impactY = scale * .553; }
  let ringRadius = blockSize * (.16 + rippleAge * (1.3 + stream.w * .8)) + (q.y - .5) * blockSize * .045;
  let localPos = vec3f(cos(streamAngle) * impactRadius + cos(angle) * ringRadius, impactY + blockSize * .014, sin(streamAngle) * impactRadius + sin(angle) * ringRadius);
  output.alpha = smoothstep(.0, .07, rippleAge) * (1.0 - smoothstep(.58, .96, rippleAge)) * (.26 + stream.w * .20);
  let progress = uniforms.progress;
  ${createIsometricTransformWgsl()}
  output.position = vec4f((ry_x + xOffsetScene) * scaleX, (rx_y + yOffsetScene) * scaleY, rx_z * .01 + .5, 1.0);
  return output;
}`;
            const FOUNTAIN_RIPPLE_FRAGMENT_SHADER = `${SCENE_UNIFORM_WGSL}
struct RippleInput { @location(0) alpha: f32 }
@fragment fn main(input: RippleInput) -> @location(0) vec4f {
  if (input.alpha < .01) { discard; }
  return vec4f(vec3f(.72, .92, 1.0) * input.alpha, input.alpha);
}`;
            try { fountainRipplePipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, { vertex: FOUNTAIN_RIPPLE_VERTEX_SHADER, fragment: FOUNTAIN_RIPPLE_FRAGMENT_SHADER, depthWrite: !1, depthCompare: "less", blend: ALPHA_BLEND_STATE }); }
            catch (fountainRipplePipelineError) { console.error("Fountain ripple pipeline failed (non-fatal):", fountainRipplePipelineError); }
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
struct KoiVertex { @location(0) position: vec3f, @location(1) normal: vec3f, @location(2) material: f32 }
struct KoiOutput { @builtin(position) position: vec4f, @location(0) normal: vec3f, @location(1) fishIndex: f32, @location(2) material: f32 }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> koiData: array<vec4f>;
@vertex fn main(@builtin(instance_index) fishIndex: u32, input: KoiVertex) -> KoiOutput {
  var output: KoiOutput;
  if (fishIndex >= u32(uniforms.blockCount)) { output.position = vec4f(0.0, 0.0, -10.0, 1.0); return output; }
  let fish = koiData[fishIndex]; let blockSize = f32(${WGSL_BLOCK_SIZE});
  let gridSize = uniforms.gridSize; let scale = gridSize * blockSize * ${FOUNTAIN_MODEL_SCALE};
  let angle = uniforms.time * fish.y + fish.w * 6.2831853;
  let centerX = cos(angle) * fish.x * blockSize; let centerZ = sin(angle) * fish.x * blockSize;
  let direction = vec2f(-sin(angle) * sign(fish.y), cos(angle) * sign(fish.y));
  let side = vec2f(-direction.y, direction.x);
  let modelScale = blockSize * fish.z * 4.0;
  let tailWeight = smoothstep(.04, .20, input.position.y);
  let tailWave = sin(uniforms.time * (2.2 + fish.z) + fish.w * 9.0) * tailWeight * blockSize * .16 * fish.z;
  let forward = -input.position.y * modelScale;
  let sideways = input.position.x * modelScale + tailWave;
  let height = input.position.z * modelScale * .36;
  let localPos = vec3f(centerX + direction.x * forward + side.x * sideways, scale * .118 + height, centerZ + direction.y * forward + side.y * sideways);
  output.normal = normalize(vec3f(direction.x * -input.normal.y + side.x * input.normal.x, input.normal.z, direction.y * -input.normal.y + side.y * input.normal.x));
  output.fishIndex = f32(fishIndex); output.material = input.material;
  let progress = uniforms.progress;
  ${createIsometricTransformWgsl()}
  output.position = vec4f((ry_x + xOffsetScene) * scaleX, (rx_y + yOffsetScene) * scaleY, rx_z * .01 + .5, 1.0); return output;
}`;
            const KOI_FRAGMENT_SHADER = `${SCENE_UNIFORM_WGSL}
struct KoiInput { @location(0) normal: vec3f, @location(1) fishIndex: f32, @location(2) material: f32 }
@fragment fn main(input: KoiInput) -> @location(0) vec4f {
  var body = vec3f(.93,.35,.08);
  if (input.fishIndex > .5 && input.fishIndex < 1.5) { body = vec3f(.94,.86,.68); }
  if (input.fishIndex > 1.5) { body = vec3f(.88,.62,.18); }
  var color = body;
  if (input.material > .5 && input.material < 1.5) { color = vec3f(.82,.16,.06); }
  if (input.material > 1.5 && input.material < 2.5) { color = vec3f(.08,.06,.04); }
  if (input.material > 2.5) { color = mix(body, vec3f(.92,.92,.86), .72); }
  let light = .38 + max(dot(normalize(input.normal), normalize(vec3f(-.4,.86,-.3))), 0.0) * .62;
  return vec4f(color * light, 1.0);
}`;
            try { koiPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, { vertex: KOI_VERTEX_SHADER, fragment: KOI_FRAGMENT_SHADER, depthWrite: !0, depthCompare: "less", vertexBuffers: [{ arrayStride: KOI_VERTEX_STRIDE, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x3" }, { shaderLocation: 2, offset: 24, format: "float32" }] }] }); }
            catch (koiPipelineError) { console.error("Koi pipeline failed (non-fatal):", koiPipelineError); }
            let butterflyPipeline = null;
            try {
              butterflyPipeline = createScenePipeline(deviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
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
            let birdPipeline = null;
            const BIRD_VERTEX_SHADER = `${SCENE_UNIFORM_WGSL}
struct BirdInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) joints: vec4u,
  @location(3) weights: vec4f,
  @location(4) uv: vec2f,
}
struct BirdOutput { @builtin(position) position: vec4f, @location(0) normal: vec3f, @location(1) uv: vec2f }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> birdBones: array<mat4x4f>;
@vertex fn main(@builtin(instance_index) birdIndex: u32, input: BirdInput) -> BirdOutput {
  let boneOffset = birdIndex * ${BIRD_BONE_COUNT}u;
  let skinPosition =
    birdBones[boneOffset + input.joints.x] * vec4f(input.position, 1.0) * input.weights.x +
    birdBones[boneOffset + input.joints.y] * vec4f(input.position, 1.0) * input.weights.y +
    birdBones[boneOffset + input.joints.z] * vec4f(input.position, 1.0) * input.weights.z +
    birdBones[boneOffset + input.joints.w] * vec4f(input.position, 1.0) * input.weights.w;
  let skinNormal = normalize(
    (birdBones[boneOffset + input.joints.x] * vec4f(input.normal, 0.0)).xyz * input.weights.x +
    (birdBones[boneOffset + input.joints.y] * vec4f(input.normal, 0.0)).xyz * input.weights.y +
    (birdBones[boneOffset + input.joints.z] * vec4f(input.normal, 0.0)).xyz * input.weights.z +
    (birdBones[boneOffset + input.joints.w] * vec4f(input.normal, 0.0)).xyz * input.weights.w
  );
  let halfGrid = uniforms.gridSize * f32(${WGSL_BLOCK_SIZE}) * .5;
  let outer = halfGrid * 2.60;
  var flight = fract(uniforms.time * .105 + .07);
  if (birdIndex == 1u) { flight = fract(uniforms.time * .083 + .31); }
  if (birdIndex == 2u) { flight = fract(uniforms.time * .126 + .58); }
  if (birdIndex == 3u) { flight = fract(uniforms.time * .071 + .82); }
  let arc = sin(flight * 3.14159265);
  var centerX = mix(-outer, outer, flight);
  var centerZ = sin(flight * 6.2831853) * outer * .30;
  var tangentX = outer * 2.0;
  var tangentZ = cos(flight * 6.2831853) * outer * 1.8849556;
  if (birdIndex == 1u) {
    centerZ = mix(outer, -outer, flight); centerX = sin(flight * 6.2831853) * outer * .28;
    tangentX = cos(flight * 6.2831853) * outer * 1.7592919; tangentZ = -outer * 2.0;
  }
  if (birdIndex == 2u) {
    centerX = mix(outer, -outer, flight); centerZ = cos(flight * 6.2831853) * outer * .34;
    tangentX = -outer * 2.0; tangentZ = -sin(flight * 6.2831853) * outer * 2.1362830;
  }
  if (birdIndex == 3u) {
    centerZ = mix(-outer, outer, flight); centerX = cos(flight * 6.2831853) * outer * .25;
    tangentX = -sin(flight * 6.2831853) * outer * 1.5707963; tangentZ = outer * 2.0;
  }
  let heading = atan2(tangentX, tangentZ);
  let birdScale = f32(${WGSL_BLOCK_SIZE}) * .10;
  // GLB bird: X is wing span, Y is beak-to-tail, Z is vertical.
  let worldX = skinPosition.x * birdScale * cos(heading) - skinPosition.y * birdScale * sin(heading);
  let worldZ = -skinPosition.x * birdScale * sin(heading) - skinPosition.y * birdScale * cos(heading);
  let fountainScale = uniforms.gridSize * f32(${WGSL_BLOCK_SIZE}) * ${FOUNTAIN_MODEL_SCALE};
  let localPos = vec3f(centerX + worldX, fountainScale * (.94 + arc * .28) + skinPosition.z * birdScale, centerZ + worldZ);
  let progress = uniforms.progress;
  ${createIsometricTransformWgsl()}
  var output: BirdOutput;
  output.position = vec4f((ry_x + xOffsetScene) * scaleX, (rx_y + yOffsetScene) * scaleY, rx_z * .01 + .5, 1.0);
  output.normal = normalize(vec3f(skinNormal.x * cos(heading) - skinNormal.y * sin(heading), skinNormal.z, -skinNormal.x * sin(heading) - skinNormal.y * cos(heading)));
  output.uv = input.uv;
  return output;
}`;
            const BIRD_FRAGMENT_SHADER = `${SCENE_UNIFORM_WGSL}
struct BirdInput { @location(0) normal: vec3f, @location(1) uv: vec2f }
@group(0) @binding(2) var birdTexture: texture_2d<f32>;
@group(0) @binding(3) var birdSampler: sampler;
@fragment fn main(input: BirdInput) -> @location(0) vec4f {
  let light = .38 + max(dot(normalize(input.normal), normalize(vec3f(-.4,.86,-.3))), 0.0) * .62;
  let texel = textureSample(birdTexture, birdSampler, input.uv);
  if (texel.a < .01) { discard; }
  return vec4f(texel.rgb * .943241 * light, texel.a);
}`;
            try {
              birdPipeline = createScenePipeline(deviceAt354206, textureFormat, birdBindGroupLayout, {
                vertex: BIRD_VERTEX_SHADER, fragment: BIRD_FRAGMENT_SHADER, depthWrite: !0, depthCompare: "less",
                vertexBuffers: [
                  { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
                  { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] },
                  { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: "uint16x4" }] },
                  { arrayStride: 16, attributes: [{ shaderLocation: 3, offset: 0, format: "float32x4" }] },
                  { arrayStride: 8, attributes: [{ shaderLocation: 4, offset: 0, format: "float32x2" }] },
                ],
              });
            } catch (birdPipelineError) { console.error("Bird pipeline failed:", birdPipelineError); }
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
                groundFlowerBuffer,
                fountainProfileBuffer: fountainProfileBuffer,
                pebbleBuffer: pebbleBuffer,
                fallingPetalBuffer: fallingPetalBuffer,
                rainUniforms: rainUniforms,
                rainBuffer: rainBuffer,
                weatherRainUniforms,
                weatherRainBuffer,
                butterflyUniforms: butterflyUniforms,
                butterflyBuffer: butterflyBuffer,
                grassUniforms,
                grassBuffer,
                groundFlowerUniforms,
                springButterflyUniforms,
                springButterflyBuffer,
                birdUniforms,
                birdBoneBuffer,
              },
              pipelines: {
                sky: skyPipeline,
                shadow: shadowPipeline,
                blocks: blocksPipeline,
                flowers: flowersPipeline,
                grass: grassPipeline,
                fountain: fountainPipeline,
                pebbles: pebblePipeline,
                fallingPetals: fallingPetalsPipeline,
                fountainWater: fountainWaterPipeline,
                fountainRipples: fountainRipplePipeline,
                autumnRipples: autumnRipplePipeline,
                koi: koiPipeline,
                butterflies: butterflyPipeline,
                birds: birdPipeline,
                rain: rainPipeline,
                blur: blurPipeline,
              },
              bindGroups: {
                sky: skyBindGroup,
                shadow: skyBindGroup,
                blocks: blocksBindGroup,
                flowers: flowersBindGroup,
                groundFlowers: groundFlowersBindGroup,
                grass: grassBindGroup,
                autumnLeaves: autumnLeafBindGroup,
                fountain: fountainBindGroup,
                pebbles: pebblesBindGroup,
                fallingPetals: fallingPetalsBindGroup,
                fountainWater: fountainWaterBindGroup,
                rain: weatherRainBindGroup,
                koi: koiBindGroup,
                butterflies: springButterflyBindGroup,
                birds: birdBindGroup,
                blur: blurBindGroup,
              },
              renderTargets,
              get depthTextureView() { return renderTargets.depthTextureView; },
              get sceneTextureView() { return renderTargets.sceneTextureView; },
              blur,
              koiVertexBuffer,
              koiIndexBuffer,
              birdPositionBuffer,
              birdNormalBuffer,
              birdJointBuffer,
              birdWeightBuffer,
              birdUvBuffer,
              birdIndexBuffer,
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
                koiCount: 0,
                grassCount: 0,
                groundFlowerCount: 0,
                butterflyCount: 0,
                autumnLeafCount: 0,
                birdCount: 3 + Math.floor(Math.random() * 2),
                rainCount: 0,
              },
              _uniformArr: new Float32Array(16),
              _fountainProfileUpload: new Float32Array(6e3),
              _flowerUpload: new Float32Array(4e5),
              _petalUpload: new Float32Array(40),
              _rainUpload: new Float32Array(2e3),
              _butterflyUpload: new Float32Array(40),
              _springButterflyUpload: new Float32Array(40),
              _birdSkinUpload: new Float32Array(BIRD_MAX_INSTANCE_COUNT * BIRD_BONE_COUNT * 16),
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
            emptyFountainFlowers = { positions: new Float32Array(0), count: 0 },
            emptyQrFlowers = { positions: new Float32Array(0), count: 0 },
            grass = generateGrass(voxelBlocksAt508cc4.gridSize, qrMatrixAt529187),
            groundFlowers = generateCanopyFlowers([], qrAnalysisAt4c4fbc),
            pebbleData = generatePebbleData(qrMatrixAt529187),
            emptyFallingPetals = generateFallingPetals([], voxelBlocksAt508cc4.gridSize),
            fountainWater = generateFountainWater(voxelBlocksAt508cc4.gridSize),
            koi = generateKoi(voxelBlocksAt508cc4.gridSize),
            springButterflies = generateButterflies(voxelBlocksAt508cc4.gridSize),
            autumnWaterLeaves = generateAutumnWaterLeaves(voxelBlocksAt508cc4.gridSize),
            rain = generateRain(voxelBlocksAt508cc4.gridSize);
          (uploadSceneData(
            rendererStateAtf2509b,
            voxelBlocksAt508cc4,
            fountainGeometry,
            emptyFountainFlowers,
            emptyQrFlowers.positions,
            emptyQrFlowers.count,
            grass,
            groundFlowers,
            pebbleData,
            emptyFallingPetals,
            fountainWater,
            koi,
            springButterflies,
            autumnWaterLeaves,
            rain,
          ),
            (previousQrContentRef.current = qrContentRef.current));
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
            drawFountainScene(rendererStateAtf2509b, {
              time: 0,
              progress: 1,
              season: seasonRef.current,
              cameraBobX: 0,
              cameraBobY: 0,
              burstTime: 0,
              customR: customColorRef.current[0],
              customG: customColorRef.current[1],
              customB: customColorRef.current[2],
              customStrength: customColorRef.current[3],
              rainMode: 1,
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
            drawFountainScene(rendererStateAtf2509b, {
                time: sceneTime,
                progress: flatProgress,
                season: seasonRef.current,
                cameraBobX: cameraBobX,
                cameraBobY: cameraBobY,
                burstTime: burstStartTime.current,
                customR: customColorRef.current[0],
                customG: customColorRef.current[1],
                customB: customColorRef.current[2],
                customStrength: customColorRef.current[3],
                rainMode: 1,
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
    })({ canvasRef, canvasWidth, canvasHeight, qrContent, isFlat, seasonRef, customColorRef, treeSeed, qrSnapshotRef: null, onFlatSettled: null, onQrSnapshotUpdated: null });
}

import { createFrameLoop, renderSceneFrame } from "../core/renderer.js";

export const SCENE = createSceneModule({
  id: "fountain",
  settings: {
    seasons: ["spring", "summer", "autumn", "winter"],
    defaultSeason: "spring",
  },
  createRuntime: options => createSceneRuntime(options, setupFountainRuntime),
});
