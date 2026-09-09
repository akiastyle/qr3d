import { encodeQrMatrix } from "../core/qr.js";
import { createBindGroup, createBindGroupLayout, createRenderTargets, createScenePipeline, createStorageBuffer, createUniformBuffer } from "../core/gpu.js";
import { createFrameLoop, renderSceneFrame } from "../core/renderer.js";
import { createSceneModule, createSceneRuntime } from "../core/scene-runtime.js";
import { SCENE_UNIFORM_WGSL, createIsometricTransformWgsl } from "../core/scene-wgsl.js";
import { createTransitionBlur } from "../core/blur.js";
import { writeSceneUniforms } from "../core/scene-uniforms.js";
import { ENGINE_SETTINGS } from "../core/settings.js";

const $ = ENGINE_SETTINGS.qr.blockSize, q = $, G = ENGINE_SETTINGS.scene.maxVoxelCount, W = .46;
const Z = ENGINE_SETTINGS.lighting.skyFillColor;
const Q = ENGINE_SETTINGS.lighting.bounceColor;
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

function legacyBuildQrMatrix(qrContent) {
  try {
    const { modules: qrCodeModules } = Y.create(qrContent || "https://icqr.com/", {
        errorCorrectionLevel: "M",
      }),
      { size: qrGridSize } = qrCodeModules,
      qrMatrixRows = [];
    for (let qrRow = 0; qrRow < qrGridSize; qrRow++) {
      const qrRowValues = [];
      for (let qrColumnIndex = 0; qrColumnIndex < qrGridSize; qrColumnIndex++)
        qrRowValues.push(1 === qrCodeModules.get(qrColumnIndex, qrRow));
      qrMatrixRows.push(qrRowValues);
    }
    return qrMatrixRows;
  } catch {
    return legacyBuildQrMatrix(ENGINE_SETTINGS.scene.defaultUrl);
  }
}

var BlockType = (function (blockTypeMap) {
  return (
    (blockTypeMap[(blockTypeMap.Dirt = 0)] = "Dirt"),
    (blockTypeMap[(blockTypeMap.CherryBlossom = 1)] = "CherryBlossom"),
    (blockTypeMap[(blockTypeMap.Trunk = 2)] = "Trunk"),
    (blockTypeMap[(blockTypeMap.Grass = 3)] = "Grass"),
    (blockTypeMap[(blockTypeMap.FallenPetals = 4)] = "FallenPetals"),
    (blockTypeMap[(blockTypeMap.Branch = 5)] = "Branch"),
    blockTypeMap
  );
})({});

function createTreeQrAppearance(light, blossom, grass, fallen, createFrameGeometry = null) {
  return {
    colors: { qr: { dark: blossom, light } },
    qrPalette: [light, blossom, grass, fallen],
    createFrameGeometry,
    createQrModules(matrix) {
      const size = matrix.length;
      const modules = new Uint32Array(size * size);
      const radius = size * W;
      for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
        if (!matrix[row][column]) continue;
        const distanceSquared = (column - size * .5) ** 2 + (row - size * .5) ** 2;
        modules[row * size + column] = distanceSquared < 6.25 ? 1 : distanceSquared >= radius ** 2 ? 2 : 3;
      }
      return modules;
    },
  };
}

const winterTracksCache = new Map();

function createWinterTracksGeometry({ gridSize }) {
  if (winterTracksCache.has(gridSize)) return winterTracksCache.get(gridSize);
  const halfPlane = gridSize * ENGINE_SETTINGS.qr.blockSize * .5;
  const trackY = ENGINE_SETTINGS.qr.blockSize + .006;
  const vertices = [];
  const addTrackVertex = (x, z) => vertices.push(x, trackY, z, 0, 1, 0, .30, .36, .40, 1);
  const addMeshVertex = (x, y, z, nx, ny, nz, color) => vertices.push(x, y, z, nx, ny, nz, ...color, 1);
  const addOval = (centerX, centerZ, direction, width, length) => {
    for (let segment = 0; segment < 8; segment++) {
      const angleA = segment * Math.PI / 4, angleB = (segment + 1) * Math.PI / 4;
      const point = angle => [
        centerX + Math.cos(direction) * Math.cos(angle) * length - Math.sin(direction) * Math.sin(angle) * width,
        centerZ + Math.sin(direction) * Math.cos(angle) * length + Math.cos(direction) * Math.sin(angle) * width,
      ];
      const [ax, az] = point(angleA), [bx, bz] = point(angleB);
      addTrackVertex(centerX, centerZ); addTrackVertex(ax, az); addTrackVertex(bx, bz);
    }
  };

  const addBearPrint = (centerX, centerZ, direction) => {
    const forward = (distance, lateral = 0) => [
      centerX + Math.cos(direction) * distance - Math.sin(direction) * lateral,
      centerZ + Math.sin(direction) * distance + Math.cos(direction) * lateral,
    ];
    addOval(centerX, centerZ, direction, .014, .018);
    for (const lateral of [-.015, -.005, .005, .015]) {
      const [toeX, toeZ] = forward(.026 - Math.abs(lateral) * .18, lateral);
      addOval(toeX, toeZ, direction, .005, .007);
    }
  };

  // Three distinct animal tracks: each crosses two edges while avoiding the tree centre.
  for (const [startX, startZ, controlX, controlZ, endX, endZ] of [
    [-.86, -.48, -.08, -.78, .86, -.26],
    [-.52, -.86, -.78, .04, -.34, .86],
    [.44, -.86, .78, -.08, .38, .86],
  ]) {
    for (let step = 0; step < 12; step++) {
      const t = step / 11, inverseT = 1 - t;
      const x = (inverseT * inverseT * startX + 2 * inverseT * t * controlX + t * t * endX) * halfPlane;
      const z = (inverseT * inverseT * startZ + 2 * inverseT * t * controlZ + t * t * endZ) * halfPlane;
      const tangentX = 2 * inverseT * (controlX - startX) + 2 * t * (endX - controlX);
      const tangentZ = 2 * inverseT * (controlZ - startZ) + 2 * t * (endZ - controlZ);
      const direction = Math.atan2(tangentZ, tangentX);
      const side = step % 2 ? 1 : -1;
      addBearPrint(
        x - Math.sin(direction) * side * .10,
        z + Math.cos(direction) * side * .10,
        direction,
      );
    }
  }

  const addSphere = (centerX, centerY, centerZ, radius, color, segments = 12, rings = 8) => {
    for (let ring = 0; ring < rings; ring++) for (let segment = 0; segment < segments; segment++) {
      const vertex = (ringIndex, segmentIndex) => {
        const polar = ringIndex * Math.PI / rings, azimuth = segmentIndex * Math.PI * 2 / segments;
        const nx = Math.sin(polar) * Math.cos(azimuth), ny = Math.cos(polar), nz = Math.sin(polar) * Math.sin(azimuth);
        return [centerX + nx * radius, centerY + ny * radius, centerZ + nz * radius, nx, ny, nz];
      };
      const a = vertex(ring, segment), b = vertex(ring, segment + 1), c = vertex(ring + 1, segment), d = vertex(ring + 1, segment + 1);
      for (const point of [a, c, b, c, d, b]) addMeshVertex(...point, color);
    }
  };
  const addCarrot = (centerX, centerY, centerZ, scale) => {
    const radius = .026 * scale, length = .12 * scale, segments = 8;
    for (let segment = 0; segment < segments; segment++) {
      const a = segment * Math.PI * 2 / segments, b = (segment + 1) * Math.PI * 2 / segments;
      const baseA = [centerX + Math.cos(a) * radius, centerY + Math.sin(a) * radius, centerZ];
      const baseB = [centerX + Math.cos(b) * radius, centerY + Math.sin(b) * radius, centerZ];
      const tip = [centerX, centerY, centerZ - length];
      addMeshVertex(...baseA, Math.cos(a), Math.sin(a), .25, [.96, .24, .03]);
      addMeshVertex(...baseB, Math.cos(b), Math.sin(b), .25, [.96, .24, .03]);
      addMeshVertex(...tip, 0, 0, -1, [.96, .24, .03]);
    }
  };
  const snowmanX = halfPlane * .80, snowmanZ = -halfPlane * .70, baseY = ENGINE_SETTINGS.qr.blockSize, snowmanScale = .25;
  const scaled = value => value * snowmanScale;
  addSphere(snowmanX, baseY + scaled(.15), snowmanZ, scaled(.15), [.88, .93, .96]);
  addSphere(snowmanX, baseY + scaled(.39), snowmanZ, scaled(.105), [.92, .96, .98]);
  for (const eyeX of [-.040, .040]) addSphere(snowmanX + scaled(eyeX), baseY + scaled(.415), snowmanZ - scaled(.094), scaled(.014), [.08, .10, .12], 8, 6);
  addCarrot(snowmanX, baseY + scaled(.385), snowmanZ - scaled(.098), snowmanScale);
  for (const buttonY of [.19, .26, .33]) addSphere(snowmanX, baseY + scaled(buttonY), snowmanZ - scaled(.142), scaled(.012), [.12, .15, .17], 8, 6);
  const geometry = { opaque: [new Float32Array(vertices)] };
  winterTracksCache.set(gridSize, geometry);
  return geometry;
}

const TREE_QR_APPEARANCES = [
  createTreeQrAppearance([.80, .74, .62], [.52, .16, .24], [.10, .30, .06], [.55, .30, .33]),
  createTreeQrAppearance([.68, .57, .43], [.04, .13, .01], [.08, .26, .02], [.08, .18, .02]),
  createTreeQrAppearance([.80, .74, .62], [.50, .15, .05], [.42, .26, .08], [.62, .21, .07]),
  createTreeQrAppearance([.68, .73, .76], [.16, .22, .27], [.50, .58, .64], [.36, .44, .50], createWinterTracksGeometry),
];

function noise(noiseX, noiseYAt5cdbf6 = 0, noiseSalt = 0) {
  const noiseValue =
    43758.5 *
    Math.sin(127.1 * noiseX + 311.7 * noiseYAt5cdbf6 + 43.7 * noiseSalt);
  return noiseValue - Math.floor(noiseValue);
}

var re = 0;

function setNoiseSeed(noiseSeed) {
  re = noiseSeed;
}

function seededNoise(noiseXAt4d1b02, noiseY = 0, noiseSaltAt2a1a19 = 0) {
  const seededNoiseValue =
    43758.5 *
    Math.sin(
      127.1 * noiseXAt4d1b02 + 311.7 * noiseY + 43.7 * noiseSaltAt2a1a19 + 7919 * re,
    );
  return seededNoiseValue - Math.floor(seededNoiseValue);
}

function createVoxelBlocks(qrMatrixAt40e06b) {
  const gridSize = qrMatrixAt40e06b.length,
    qrGridHalfWidthAt52762f = gridSize / 2,
    qrGridHalfHeightAt54e1b3 = gridSize / 2,
    qrScaleAt5b6290 = gridSize / 29,
    trunkHeightLayers = Math.round(12 * qrScaleAt5b6290),
    trunkBaseHeight = trunkHeightLayers * q,
    qrRadius = gridSize * W,
    qrRadiusSquared = qrRadius * qrRadius,
    voxelPositions = new Float32Array(268960),
    voxelHeights = new Float32Array(G),
    voxelBaseY = new Float32Array(G),
    voxelTypes = new Uint32Array(G);
  let voxelCount = 0;
  const treeFlowerLayerBase = Math.round(18 * qrScaleAt5b6290);
  for (let voxelRow = 0; voxelRow < gridSize; voxelRow++) {
    const qrMatrixRow = qrMatrixAt40e06b[voxelRow];
    for (let treeColumnIndex = 0; treeColumnIndex < gridSize; treeColumnIndex++) {
      const qrModuleActive = qrMatrixRow[treeColumnIndex],
        treeColumnOffset = treeColumnIndex - qrGridHalfWidthAt52762f,
        qrCenteredRow = voxelRow - qrGridHalfHeightAt54e1b3,
        treeDistanceSquared = treeColumnOffset * treeColumnOffset + qrCenteredRow * qrCenteredRow,
        voxelIndexAt41b0b5 = voxelCount,
        voxelPositionOffset = 4 * voxelIndexAt41b0b5;
      if (
        ((voxelPositions[voxelPositionOffset] = treeColumnIndex),
        (voxelPositions[voxelPositionOffset + 1] = voxelRow),
        (voxelPositions[voxelPositionOffset + 2] = 0),
        (voxelPositions[voxelPositionOffset + 3] = 0),
        (voxelHeights[voxelIndexAt41b0b5] = q),
        (voxelBaseY[voxelIndexAt41b0b5] = 0),
        (voxelTypes[voxelIndexAt41b0b5] = qrModuleActive
          ? treeDistanceSquared < 6.25
            ? BlockType.CherryBlossom
            : treeDistanceSquared >= qrRadiusSquared
              ? BlockType.Grass
              : BlockType.FallenPetals
          : BlockType.Dirt),
        voxelCount++,
        qrModuleActive)
      ) {
        if (treeDistanceSquared < 6.25)
          for (let trunkLayerIndexAt46b5bd = 1; trunkLayerIndexAt46b5bd < trunkHeightLayers; trunkLayerIndexAt46b5bd++) {
            const trunkRowIndex = voxelCount,
              voxelPositionOffsetAtb1163 = 4 * trunkRowIndex;
            ((voxelPositions[voxelPositionOffsetAtb1163] = treeColumnIndex),
              (voxelPositions[voxelPositionOffsetAtb1163 + 1] = voxelRow),
              (voxelPositions[voxelPositionOffsetAtb1163 + 2] = 0),
              (voxelPositions[voxelPositionOffsetAtb1163 + 3] = 0),
              (voxelHeights[trunkRowIndex] = q),
              (voxelBaseY[trunkRowIndex] = trunkLayerIndexAt46b5bd * q),
              (voxelTypes[trunkRowIndex] = BlockType.Trunk),
              voxelCount++);
          }
        if (treeDistanceSquared < qrRadiusSquared) {
          const qrRadialFalloff = 1 - Math.sqrt(treeDistanceSquared) / qrRadius,
            cherryBlossomLayerCount = Math.max(
              4,
              Math.round(treeFlowerLayerBase * (0.25 + 0.75 * qrRadialFalloff * qrRadialFalloff)),
            ),
            qrFlowerHeightOffsetAt99256 = Math.floor(4.5 * qrRadialFalloff * qrScaleAt5b6290) * q;
          for (let trunkLayerIndexAt1f5db7 = 0; trunkLayerIndexAt1f5db7 < cherryBlossomLayerCount; trunkLayerIndexAt1f5db7++) {
            const trunkColumnIndex = voxelCount,
              voxelPositionOffsetAt725080 = 4 * trunkColumnIndex;
            ((voxelPositions[voxelPositionOffsetAt725080] = treeColumnIndex),
              (voxelPositions[voxelPositionOffsetAt725080 + 1] = voxelRow),
              (voxelPositions[voxelPositionOffsetAt725080 + 2] = 0),
              (voxelPositions[voxelPositionOffsetAt725080 + 3] = 0),
              (voxelHeights[trunkColumnIndex] = q),
              (voxelBaseY[trunkColumnIndex] = trunkBaseHeight + trunkLayerIndexAt1f5db7 * q + qrFlowerHeightOffsetAt99256),
              (voxelTypes[trunkColumnIndex] = BlockType.CherryBlossom),
              voxelCount++);
          }
          const extraCherryBlossomLayers = Math.floor(
            6 * noise(treeColumnIndex, voxelRow, 500) * qrScaleAt5b6290,
          );
          for (let extraCherryBlossomLayerIndex = 0; extraCherryBlossomLayerIndex < extraCherryBlossomLayers; extraCherryBlossomLayerIndex++) {
            const voxelIndexAt489898 = voxelCount,
              voxelPositionOffsetAt512cad = 4 * voxelIndexAt489898;
            ((voxelPositions[voxelPositionOffsetAt512cad] = treeColumnIndex),
              (voxelPositions[voxelPositionOffsetAt512cad + 1] = voxelRow),
              (voxelPositions[voxelPositionOffsetAt512cad + 2] = 0),
              (voxelPositions[voxelPositionOffsetAt512cad + 3] = 0),
              (voxelHeights[voxelIndexAt489898] = q),
              (voxelBaseY[voxelIndexAt489898] =
                trunkBaseHeight + (cherryBlossomLayerCount + extraCherryBlossomLayerIndex) * q + qrFlowerHeightOffsetAt99256),
              (voxelTypes[voxelIndexAt489898] = BlockType.CherryBlossom),
              voxelCount++);
          }
          if (treeDistanceSquared < 2.25)
            for (let trunkLayerIndex = 0; trunkLayerIndex < 4; trunkLayerIndex++) {
              const voxelIndex = voxelCount,
                trunkPositionOffset = 4 * voxelIndex;
              ((voxelPositions[trunkPositionOffset] = treeColumnIndex),
                (voxelPositions[trunkPositionOffset + 1] = voxelRow),
                (voxelPositions[trunkPositionOffset + 2] = 0),
                (voxelPositions[trunkPositionOffset + 3] = 0),
                (voxelHeights[voxelIndex] = q),
                (voxelBaseY[voxelIndex] = trunkBaseHeight + trunkLayerIndex * q),
                (voxelTypes[voxelIndex] = BlockType.CherryBlossom),
                voxelCount++);
            }
        }
      }
    }
  }
  return {
    positions: voxelPositions,
    heights: voxelHeights,
    baseY: voxelBaseY,
    types: voxelTypes,
    gridSize: gridSize,
    numBlocks: voxelCount,
  };
}

function analyzeQrMatrix(qrMatrixAt228010) {
  const qrGridSizeAt2d105a = qrMatrixAt228010.length;
  let darkModuleCount = 0,
    qrEdgeTransitionCount = 0;
  for (let qrRowAt3a59be = 0; qrRowAt3a59be < qrGridSizeAt2d105a; qrRowAt3a59be++)
    for (let qrColumn = 0; qrColumn < qrGridSizeAt2d105a; qrColumn++)
      (qrMatrixAt228010[qrRowAt3a59be][qrColumn] && darkModuleCount++,
        qrColumn > 0 &&
          qrMatrixAt228010[qrRowAt3a59be][qrColumn] !==
            qrMatrixAt228010[qrRowAt3a59be][qrColumn - 1] &&
          qrEdgeTransitionCount++,
        qrRowAt3a59be > 0 &&
          qrMatrixAt228010[qrRowAt3a59be][qrColumn] !==
            qrMatrixAt228010[qrRowAt3a59be - 1][qrColumn] &&
          qrEdgeTransitionCount++);
  const qrDensity = darkModuleCount / (qrGridSizeAt2d105a * qrGridSizeAt2d105a),
    qrEdgeRatio = qrEdgeTransitionCount / (2 * qrGridSizeAt2d105a * (qrGridSizeAt2d105a - 1)),
    qrScale = qrGridSizeAt2d105a / 29;
  return {
    gridSize: qrGridSizeAt2d105a,
    density: qrDensity,
    edgeRatio: qrEdgeRatio,
    trunkHeight: (0.26 + 0.08 * qrDensity) * qrScale,
    trunkRadius: (0.024 + 0.008 * qrDensity) * qrScale,
    trunkLean: (0.04 + 0.03 * noise(qrDensity, qrEdgeRatio)) * qrScale,
    mainBranches: 4 + Math.floor(4 * qrDensity),
    branchSpread: 0.5 + 0.5 * qrEdgeRatio,
    branchLengthScale: 0.55 + 0.25 * qrDensity,
    maxDepth: qrEdgeRatio > 0.28 ? 5 : 4,
    canopyDensity: 0.5 + 0.5 * qrDensity,
  };
}

function createTreeBranches(treeSettings, treeGridSizeAt3c69a6) {
  const treeWorldRadius = treeGridSizeAt3c69a6 * W * $,
    branchSegmentValues = [],
    treeTips = [],
    {
      trunkHeight: trunkHeight,
      trunkRadius: trunkRadius,
      trunkLean: trunkLean,
      mainBranches: mainBranches,
      branchLengthScale: branchLengthScale,
      maxDepth: maxBranchDepth,
    } = treeSettings;
  let branchSegmentCount = 0;
  function growBranch(
    branchStartX,
    branchSegmentStartY,
    branchStartZ,
    branchStartRadiusAt3c041a,
    branchSegmentEndX,
    branchSegmentEndY,
    branchSegmentEndZ,
    branchEndRadius,
    branchDepthAt58102a,
    branchSeed,
  ) {
    (branchSegmentValues.push(
      branchStartX,
      branchSegmentStartY,
      branchStartZ,
      branchStartRadiusAt3c041a,
      branchSegmentEndX,
      branchSegmentEndY,
      branchSegmentEndZ,
      branchEndRadius,
      branchDepthAt58102a,
      branchSeed,
      0,
      0,
    ),
      branchSegmentCount++);
  }
  for (let trunkSegmentIndex = 0; trunkSegmentIndex < 10; trunkSegmentIndex++) {
    const trunkSegmentStartProgress = trunkSegmentIndex / 10,
      trunkSegmentEndProgress = (trunkSegmentIndex + 1) / 10,
      trunkSegmentStartRadius =
        trunkRadius *
        (1 - 0.55 * trunkSegmentStartProgress) *
        (1 + 0.08 * Math.sin(trunkSegmentStartProgress * Math.PI * 0.8)),
      trunkSegmentEndRadius =
        trunkRadius *
        (1 - 0.55 * trunkSegmentEndProgress) *
        (1 + 0.08 * Math.sin(trunkSegmentEndProgress * Math.PI * 0.8)),
      trunkStartX =
        trunkLean * trunkSegmentStartProgress * trunkSegmentStartProgress +
        0.3 * trunkLean * Math.sin(trunkSegmentStartProgress * Math.PI * 1.5),
      trunkStartZ = 0.5 * trunkLean * Math.sin(trunkSegmentStartProgress * Math.PI * 0.8),
      trunkEndX =
        trunkLean * trunkSegmentEndProgress * trunkSegmentEndProgress +
        0.3 * trunkLean * Math.sin(trunkSegmentEndProgress * Math.PI * 1.5),
      trunkEndZ = 0.5 * trunkLean * Math.sin(trunkSegmentEndProgress * Math.PI * 0.8);
    growBranch(
      trunkStartX,
      trunkSegmentStartProgress * trunkHeight,
      trunkStartZ,
      trunkSegmentStartRadius,
      trunkEndX,
      trunkSegmentEndProgress * trunkHeight,
      trunkEndZ,
      trunkSegmentEndRadius,
      0,
      0.5 * trunkSegmentStartProgress,
    );
  }
  function trunkPositionAt(trunkProgress) {
    return {
      x:
        trunkLean * trunkProgress * trunkProgress +
        0.3 * trunkLean * Math.sin(trunkProgress * Math.PI * 1.5),
      y: trunkHeight * trunkProgress,
      z: 0.5 * trunkLean * Math.sin(trunkProgress * Math.PI * 0.8),
    };
  }
  const maximumBranchY = trunkHeight + 1.5 * treeWorldRadius,
    minimumBranchY = 0.5 * trunkHeight;
  function appendBranchSegment(
    branchSegmentStartX,
    branchStartYAt4002bb,
    branchSegmentStartZ,
    branchStartRadius,
    branchStartXAt26c4b7,
    branchStartY,
    branchStartZAt588b5d,
    branchStartRadiusAt309d6,
    parentBranchAngle,
    branchDepth,
  ) {
    if (branchSegmentCount >= 485) return;
    growBranch(
      branchSegmentStartX,
      branchStartYAt4002bb,
      branchSegmentStartZ,
      branchStartRadius,
      branchStartXAt26c4b7,
      branchStartY,
      branchStartZAt588b5d,
      branchStartRadiusAt309d6,
      branchDepth,
      seededNoise(branchSegmentCount, 0, 400),
    );
    const childBranchesPerSegment = 1 + Math.floor(2 * seededNoise(branchSegmentCount, 0, 500));
    for (
      let childBranchIndex = 0;
      childBranchIndex < childBranchesPerSegment && branchSegmentCount < 485;
      childBranchIndex++
    ) {
      const branchAngle =
          parentBranchAngle + 2.2 * (seededNoise(branchSegmentCount, childBranchIndex, 600) - 0.5),
        childBranchLength =
          treeWorldRadius *
          (0.15 + 0.2 * seededNoise(branchSegmentCount, childBranchIndex, 700)) *
          branchLengthScale,
        childBranchElevation = 0.1 + 0.45 * seededNoise(branchSegmentCount, childBranchIndex, 750),
        childBranchStartRadius =
          branchStartRadiusAt309d6 * (0.5 + 0.2 * seededNoise(branchSegmentCount, childBranchIndex, 800));
      let childBranchEndX =
          branchStartXAt26c4b7 + Math.cos(branchAngle) * Math.cos(childBranchElevation) * childBranchLength,
        childBranchY = Math.max(
          Math.min(branchStartY + Math.sin(childBranchElevation) * childBranchLength, maximumBranchY),
          minimumBranchY,
        ),
        childBranchZAt24ed2b =
          branchStartZAt588b5d + Math.sin(branchAngle) * Math.cos(childBranchElevation) * childBranchLength;
      const childBranchEndRadius = 0.4 * childBranchStartRadius,
        branchPlanarDistanceAt316203 = Math.sqrt(childBranchEndX * childBranchEndX + childBranchZAt24ed2b * childBranchZAt24ed2b);
      if (
        (branchPlanarDistanceAt316203 > 0.95 * treeWorldRadius &&
          ((childBranchEndX *= (0.95 * treeWorldRadius) / branchPlanarDistanceAt316203),
          (childBranchZAt24ed2b *= (0.95 * treeWorldRadius) / branchPlanarDistanceAt316203)),
        growBranch(
          branchStartXAt26c4b7,
          branchStartY,
          branchStartZAt588b5d,
          childBranchStartRadius,
          childBranchEndX,
          childBranchY,
          childBranchZAt24ed2b,
          childBranchEndRadius,
          branchDepth + 1,
          seededNoise(branchSegmentCount, childBranchIndex, 850),
        ),
        treeTips.push({
          x: childBranchEndX,
          y: childBranchY,
          z: childBranchZAt24ed2b,
          radius: 25 * childBranchEndRadius,
        }),
        maxBranchDepth >= 4 && branchSegmentCount < 485)
      ) {
        const childBranchAngle =
            branchAngle + 2.2 * (seededNoise(branchSegmentCount, childBranchIndex, 860) - 0.5),
          secondaryChildBranchLength = 0.45 * childBranchLength,
          childBranchElevationAt48acb3 = 0.1 + 0.35 * seededNoise(branchSegmentCount, childBranchIndex, 870),
          childBranchRadius = 0.5 * childBranchEndRadius;
        let childBranchX =
          childBranchEndX + Math.cos(childBranchAngle) * Math.cos(childBranchElevationAt48acb3) * secondaryChildBranchLength;
        const childBranchEndY = Math.max(
          Math.min(childBranchY + Math.sin(childBranchElevationAt48acb3) * secondaryChildBranchLength, maximumBranchY),
          minimumBranchY,
        );
        let childBranchZ =
          childBranchZAt24ed2b + Math.sin(childBranchAngle) * Math.cos(childBranchElevationAt48acb3) * secondaryChildBranchLength;
        const childBranchPlanarDistance = Math.sqrt(
          childBranchX * childBranchX + childBranchZ * childBranchZ,
        );
        (childBranchPlanarDistance > 0.95 * treeWorldRadius &&
          ((childBranchX *= (0.95 * treeWorldRadius) / childBranchPlanarDistance),
          (childBranchZ *= (0.95 * treeWorldRadius) / childBranchPlanarDistance)),
          growBranch(
            childBranchEndX,
            childBranchY,
            childBranchZAt24ed2b,
            childBranchEndRadius,
            childBranchX,
            childBranchEndY,
            childBranchZ,
            0.3 * childBranchRadius,
            branchDepth + 2,
            seededNoise(branchSegmentCount, childBranchIndex, 880),
          ),
          treeTips.push({
            x: childBranchX,
            y: childBranchEndY,
            z: childBranchZ,
            radius: 15 * childBranchRadius,
          }));
      }
    }
  }
  const secondaryBranchCount = 3 + Math.floor(2 * seededNoise(0, 0, 2e3)),
    mainBranchStartPosition = trunkPositionAt(0.95);
  for (
    let secondaryBranchIndex = 0;
    secondaryBranchIndex < secondaryBranchCount && branchSegmentCount < 470;
    secondaryBranchIndex++
  ) {
    const mainBranchAngle =
        (secondaryBranchIndex / secondaryBranchCount) * Math.PI * 2 +
        0.5 * seededNoise(secondaryBranchIndex, 0, 2100),
      mainBranchLength = treeWorldRadius * (0.1 + 0.25 * seededNoise(secondaryBranchIndex, 0, 2200)),
      secondaryBranchRadius = trunkRadius * (0.3 + 0.12 * seededNoise(secondaryBranchIndex, 0, 2300)),
      mainBranchSegmentCount = 2 + Math.floor(seededNoise(secondaryBranchIndex, 0, 2400));
    let branchStartXAt2beda2 = mainBranchStartPosition.x,
      mainBranchYAt52a541 = mainBranchStartPosition.y,
      mainBranchZ = mainBranchStartPosition.z,
      mainBranchRadius = secondaryBranchRadius;
    for (
      let mainBranchSegmentIndex = 0;
      mainBranchSegmentIndex < mainBranchSegmentCount && branchSegmentCount < 475;
      mainBranchSegmentIndex++
    ) {
      const mainBranchProgress = (mainBranchSegmentIndex + 1) / mainBranchSegmentCount,
        mainBranchXJitter = 0.01 * (seededNoise(secondaryBranchIndex, mainBranchSegmentIndex, 2500) - 0.5),
        mainBranchZJitterAt5a0bbb = 0.01 * (seededNoise(secondaryBranchIndex, mainBranchSegmentIndex, 2600) - 0.5),
        mainBranchEndX =
          mainBranchStartPosition.x + Math.cos(mainBranchAngle) * mainBranchLength * mainBranchProgress + mainBranchXJitter,
        mainBranchEndYAt99854e =
          mainBranchStartPosition.y +
          (maximumBranchY - mainBranchStartPosition.y) *
            mainBranchProgress *
            (0.7 + 0.3 * seededNoise(secondaryBranchIndex, mainBranchSegmentIndex, 2700)),
        mainBranchEndZ =
          mainBranchStartPosition.z + Math.sin(mainBranchAngle) * mainBranchLength * mainBranchProgress + mainBranchZJitterAt5a0bbb,
        mainBranchEndRadius =
          mainBranchRadius * (0.5 + 0.1 * seededNoise(secondaryBranchIndex, mainBranchSegmentIndex, 2800));
      (growBranch(
        branchStartXAt2beda2,
        mainBranchYAt52a541,
        mainBranchZ,
        mainBranchRadius,
        mainBranchEndX,
        mainBranchEndYAt99854e,
        mainBranchEndZ,
        mainBranchEndRadius,
        1,
        seededNoise(secondaryBranchIndex, mainBranchSegmentIndex, 2900),
      ),
        (branchStartXAt2beda2 = mainBranchEndX),
        (mainBranchYAt52a541 = mainBranchEndYAt99854e),
        (mainBranchZ = mainBranchEndZ),
        (mainBranchRadius = mainBranchEndRadius));
    }
    (treeTips.push({
      x: branchStartXAt2beda2,
      y: mainBranchYAt52a541,
      z: mainBranchZ,
      radius: 35 * mainBranchRadius,
    }),
      appendBranchSegment(
        branchStartXAt2beda2,
        mainBranchYAt52a541,
        mainBranchZ,
        0.7 * mainBranchRadius,
        branchStartXAt2beda2 + (seededNoise(secondaryBranchIndex, 0, 3e3) - 0.5) * treeWorldRadius * 0.35,
        Math.max(Math.min(mainBranchYAt52a541 + 0.08 * treeWorldRadius, maximumBranchY), minimumBranchY),
        mainBranchZ + (seededNoise(secondaryBranchIndex, 0, 3100) - 0.5) * treeWorldRadius * 0.35,
        0.3 * mainBranchRadius,
        mainBranchAngle,
        2,
      ));
  }
  for (
    let mainBranchIndex = 0;
    mainBranchIndex < mainBranches && branchSegmentCount < 470;
    mainBranchIndex++
  ) {
    const mainBranchStartPositionAt5df0d3 = trunkPositionAt(0.7 + 0.25 * seededNoise(mainBranchIndex, 0, 1200)),
      mainBranchAngleAtb8d093 =
        (mainBranchIndex / mainBranches) * Math.PI * 2 +
        0.4 * (seededNoise(mainBranchIndex, 0, 900) - 0.5),
      branchPlanarDistance = treeWorldRadius * (0.6 + 0.35 * seededNoise(mainBranchIndex, 0, 1e3)),
      mainBranchTargetY = trunkHeight * (0.8 + 0.2 * seededNoise(mainBranchIndex, 0, 1050)),
      mainBranchTargetX = Math.cos(mainBranchAngleAtb8d093) * branchPlanarDistance,
      mainBranchTargetZ = Math.sin(mainBranchAngleAtb8d093) * branchPlanarDistance;
    let mainBranchX = mainBranchStartPositionAt5df0d3.x,
      mainBranchY = mainBranchStartPositionAt5df0d3.y,
      mainBranchZAt60b8f0 = mainBranchStartPositionAt5df0d3.z,
      mainBranchRadiusAt558439 = trunkRadius * (0.4 + 0.15 * seededNoise(mainBranchIndex, 0, 1100));
    for (let mainBranchSegmentIndexAt8c09d9 = 0; mainBranchSegmentIndexAt8c09d9 < 3 && branchSegmentCount < 475; mainBranchSegmentIndexAt8c09d9++) {
      const mainBranchSegmentProgress = (mainBranchSegmentIndexAt8c09d9 + 1) / 3,
        mainBranchArcHeight = Math.sin(mainBranchSegmentProgress * Math.PI) * treeWorldRadius * 0.3,
        mainBranchXJitterAt3514ed = 0.015 * (seededNoise(mainBranchIndex, mainBranchSegmentIndexAt8c09d9, 150) - 0.5),
        mainBranchZJitter = 0.015 * (seededNoise(mainBranchIndex, mainBranchSegmentIndexAt8c09d9, 250) - 0.5),
        mainBranchEndXAt54680e =
          mainBranchStartPositionAt5df0d3.x + (mainBranchTargetX - mainBranchStartPositionAt5df0d3.x) * mainBranchSegmentProgress + mainBranchXJitterAt3514ed,
        mainBranchEndY =
          mainBranchStartPositionAt5df0d3.y +
          (mainBranchTargetY - mainBranchStartPositionAt5df0d3.y) * mainBranchSegmentProgress +
          mainBranchArcHeight * (1 - mainBranchSegmentProgress),
        mainBranchEndZAtfed78a =
          mainBranchStartPositionAt5df0d3.z + (mainBranchTargetZ - mainBranchStartPositionAt5df0d3.z) * mainBranchSegmentProgress + mainBranchZJitter,
        mainBranchSegmentRadius =
          mainBranchRadiusAt558439 * (0.55 + 0.1 * seededNoise(mainBranchIndex, mainBranchSegmentIndexAt8c09d9, 350));
      (growBranch(
        mainBranchX,
        mainBranchY,
        mainBranchZAt60b8f0,
        mainBranchRadiusAt558439,
        mainBranchEndXAt54680e,
        mainBranchEndY,
        mainBranchEndZAtfed78a,
        mainBranchSegmentRadius,
        1,
        seededNoise(mainBranchIndex, mainBranchSegmentIndexAt8c09d9, 400),
      ),
        mainBranchSegmentIndexAt8c09d9 >= 1 &&
          branchSegmentCount < 470 &&
          appendBranchSegment(
            mainBranchEndXAt54680e,
            mainBranchEndY,
            mainBranchEndZAtfed78a,
            0.6 * mainBranchSegmentRadius,
            mainBranchEndXAt54680e +
              (seededNoise(mainBranchIndex, mainBranchSegmentIndexAt8c09d9, 610) - 0.5) * treeWorldRadius * 0.45,
            Math.max(
              Math.min(
                mainBranchEndY +
                  treeWorldRadius *
                    (0.05 + 0.1 * seededNoise(mainBranchIndex, mainBranchSegmentIndexAt8c09d9, 620)),
                maximumBranchY,
              ),
              minimumBranchY,
            ),
            mainBranchEndZAtfed78a +
              (seededNoise(mainBranchIndex, mainBranchSegmentIndexAt8c09d9, 630) - 0.5) * treeWorldRadius * 0.45,
            0.25 * mainBranchSegmentRadius,
            mainBranchAngleAtb8d093,
            2,
          ),
        (mainBranchX = mainBranchEndXAt54680e),
        (mainBranchY = mainBranchEndY),
        (mainBranchZAt60b8f0 = mainBranchEndZAtfed78a),
        (mainBranchRadiusAt558439 = mainBranchSegmentRadius));
    }
    treeTips.push({
      x: mainBranchX,
      y: mainBranchY,
      z: mainBranchZAt60b8f0,
      radius: 30 * mainBranchRadiusAt558439,
    });
  }
  return {
    segments: new Float32Array(branchSegmentValues),
    segmentCount: branchSegmentCount,
    tips: treeTips,
  };
}

function generateCanopyFlowers(canopyTips, treeSettingsAt35f9df) {
  const canopyGridSize = treeSettingsAt35f9df.gridSize,
    canopyHalfWorldSize = canopyGridSize * $ * 0.5,
    canopyFlowerValues = [];
  let canopyFlowerCountAt5db29d = 0;
  const maxCanopyFlowers = 1e5;
  function worldToGridPosition(worldX, worldZ) {
    return {
      col: (worldX + canopyHalfWorldSize) / $,
      row: (worldZ + canopyHalfWorldSize) / $,
    };
  }
  function appendCanopyFlower(flowerColumn, canopyFlowerRow, flowerHeight, canopyFlowerVariation) {
    canopyFlowerCountAt5db29d >= maxCanopyFlowers ||
      (canopyFlowerValues.push(flowerColumn, canopyFlowerRow, flowerHeight, canopyFlowerVariation), canopyFlowerCountAt5db29d++);
  }
  for (let canopyTipIndex = 0; canopyTipIndex < canopyTips.length; canopyTipIndex++) {
    const canopyTip = canopyTips[canopyTipIndex];
    if (seededNoise(canopyTipIndex, 0, 780) < 0.01) continue;
    const canopyDistance = Math.sqrt(
        canopyTip.x * canopyTip.x + canopyTip.z * canopyTip.z,
      ),
      canopyFlowerDensityFactorAt538d72 = 1 + 0.45 * (1 - Math.min(1, canopyDistance / (canopyHalfWorldSize * W))),
      canopyFlowerDensityFactor = (1 + 0.3 * seededNoise(canopyTipIndex, 3, 790)) * canopyFlowerDensityFactorAt538d72,
      canopyFlowerCount = Math.max(
        40,
        Math.floor(60 * canopyTip.radius * treeSettingsAt35f9df.canopyDensity * canopyFlowerDensityFactor),
      ),
      canopyFlowerRadius = canopyTip.radius * $ * 9 * canopyFlowerDensityFactor;
    for (let canopyFlowerIndex = 0; canopyFlowerIndex < canopyFlowerCount; canopyFlowerIndex++) {
      const canopyFlowerVariationAte4e356 = seededNoise(canopyTipIndex, canopyFlowerIndex, 800),
        canopyFlowerAngle = seededNoise(canopyTipIndex, canopyFlowerIndex, 810) * Math.PI * 2,
        canopyFlowerVerticalUnit = 2 * seededNoise(canopyTipIndex, canopyFlowerIndex, 820) - 1,
        canopyFlowerRadialProjection = Math.sqrt(1 - canopyFlowerVerticalUnit * canopyFlowerVerticalUnit),
        canopyFlowerRadialDistance =
          canopyFlowerRadius * Math.cbrt(seededNoise(canopyTipIndex, canopyFlowerIndex, 830)),
        canopyFlowerWorldX =
          canopyTip.x + canopyFlowerRadialDistance * canopyFlowerRadialProjection * Math.cos(canopyFlowerAngle) * 1.5,
        canopyFlowerHeight = canopyTip.y + canopyFlowerRadialDistance * canopyFlowerVerticalUnit * 1.1 + 0.1 * canopyFlowerRadius,
        canopyFlowerGridPosition = worldToGridPosition(
          canopyFlowerWorldX,
          canopyTip.z + canopyFlowerRadialDistance * canopyFlowerRadialProjection * Math.sin(canopyFlowerAngle) * 1.5,
        );
      appendCanopyFlower(canopyFlowerGridPosition.col, canopyFlowerGridPosition.row, canopyFlowerHeight, canopyFlowerVariationAte4e356);
    }
    const hangingFlowerCount = 6 + Math.floor(6 * seededNoise(canopyTipIndex, 0, 1500));
    for (let hangingFlowerIndex = 0; hangingFlowerIndex < hangingFlowerCount; hangingFlowerIndex++) {
      const hangingFlowerVariation = seededNoise(canopyTipIndex, hangingFlowerIndex, 1600),
        hangingFlowerAngle = seededNoise(canopyTipIndex, hangingFlowerIndex, 1700) * Math.PI * 2,
        hangingFlowerRadius = 0.5 * canopyFlowerRadius,
        hangingFlowerWorldX = canopyTip.x + Math.cos(hangingFlowerAngle) * hangingFlowerRadius,
        hangingFlowerWorldZ = canopyTip.z + Math.sin(hangingFlowerAngle) * hangingFlowerRadius,
        hangingFlowerHeight =
          canopyTip.y - q * (0.5 + 2 * seededNoise(canopyTipIndex, hangingFlowerIndex, 1900)),
        hangingFlowerGridPosition = worldToGridPosition(hangingFlowerWorldX, hangingFlowerWorldZ);
      appendCanopyFlower(hangingFlowerGridPosition.col, hangingFlowerGridPosition.row, hangingFlowerHeight, hangingFlowerVariation);
    }
    if (seededNoise(canopyTipIndex, 2, 900) < 0.5) {
      const groundFlowerVariation = seededNoise(canopyTipIndex, 0, 910) + 1,
        groundFlowerAngle = seededNoise(canopyTipIndex, 0, 920) * Math.PI * 2,
        canopyFlowerWorldXAt29f800 = canopyTip.x + Math.cos(groundFlowerAngle) * canopyFlowerRadius * 0.4,
        groundFlowerWorldZAt9e84e0 = canopyTip.z + Math.sin(groundFlowerAngle) * canopyFlowerRadius * 0.4,
        groundFlowerHeight = canopyTip.y - 0.01225,
        groundFlowerGridPositionAt4d80de = worldToGridPosition(canopyFlowerWorldXAt29f800, groundFlowerWorldZAt9e84e0);
      appendCanopyFlower(groundFlowerGridPositionAt4d80de.col, groundFlowerGridPositionAt4d80de.row, groundFlowerHeight, groundFlowerVariation);
    }
  }
  if (canopyTips.length > 0 && canopyFlowerCountAt5db29d < maxCanopyFlowers) {
    let maximumCanopyTipY = -1 / 0;
    for (let canopyTipIndexAtb0003e = 0; canopyTipIndexAtb0003e < canopyTips.length; canopyTipIndexAtb0003e++)
      canopyTips[canopyTipIndexAtb0003e].y > maximumCanopyTipY &&
        (maximumCanopyTipY = canopyTips[canopyTipIndexAtb0003e].y);
    const canopyTopFlowerCount = Math.floor(120 * Math.max(0.75, treeSettingsAt35f9df.canopyDensity)),
      canopyTopFlowerRadius = canopyHalfWorldSize * W * 0.2,
      canopyTopY = maximumCanopyTipY - 0.049;
    for (let canopyTopFlowerIndex = 0; canopyTopFlowerIndex < canopyTopFlowerCount; canopyTopFlowerIndex++) {
      const canopyTopFlowerAngle = seededNoise(canopyTopFlowerIndex, 0, 5100) * Math.PI * 2,
        canopyTopFlowerDistance = canopyTopFlowerRadius * Math.sqrt(seededNoise(canopyTopFlowerIndex, 0, 5200)),
        canopyTopFlowerWorldX = Math.cos(canopyTopFlowerAngle) * canopyTopFlowerDistance,
        canopyTopFlowerWorldZ = Math.sin(canopyTopFlowerAngle) * canopyTopFlowerDistance,
        canopyTopFlowerHeight =
          canopyTopY + (seededNoise(canopyTopFlowerIndex, 0, 5300) - 0.35) * q * 8,
        canopyTopFlowerVariation = seededNoise(canopyTopFlowerIndex, 0, 5400),
        canopyTopFlowerGridPosition = worldToGridPosition(canopyTopFlowerWorldX, canopyTopFlowerWorldZ);
      appendCanopyFlower(canopyTopFlowerGridPosition.col, canopyTopFlowerGridPosition.row, canopyTopFlowerHeight, canopyTopFlowerVariation);
    }
  }
  const canopyRadius = canopyGridSize * W * $;
  for (let groundFlowerIndex = 0; groundFlowerIndex < 80; groundFlowerIndex++) {
    const groundFlowerAngleAte0c6ee = seededNoise(groundFlowerIndex, 0, 4e3) * Math.PI * 2,
      groundFlowerDistanceNoise = seededNoise(groundFlowerIndex, 0, 4100),
      groundFlowerDistance = canopyRadius * (0.1 + groundFlowerDistanceNoise * groundFlowerDistanceNoise * 0.75),
      groundFlowerWorldX = Math.cos(groundFlowerAngleAte0c6ee) * groundFlowerDistance,
      groundFlowerWorldZ = Math.sin(groundFlowerAngleAte0c6ee) * groundFlowerDistance,
      groundFlowerVariationAt4d1445 = seededNoise(groundFlowerIndex, 0, 4200),
      groundFlowerGridPosition = worldToGridPosition(groundFlowerWorldX, groundFlowerWorldZ);
    appendCanopyFlower(groundFlowerGridPosition.col, groundFlowerGridPosition.row, 0.0294, groundFlowerVariationAt4d1445);
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
    qrGridHalfWidth = qrGridSizeAt4c9653 / 2,
    qrGridHalfHeight = qrGridSizeAt4c9653 / 2,
    qrScaleAt53f5f9 = qrGridSizeAt4c9653 / 29,
    qrFlowerBaseHeightAt5e7c72 = Math.round(12 * qrScaleAt53f5f9) * q,
    qrFlowerRadius = qrGridSizeAt4c9653 * W,
    qrFlowerValues = [];
  let qrFlowerCountAt27f743 = 0;
  const qrFlowerRadiusSquared = qrFlowerRadius * qrFlowerRadius;
  for (let qrFlowerRow = 0; qrFlowerRow < qrGridSizeAt4c9653; qrFlowerRow++)
    for (let qrFlowerColumn = 0; qrFlowerColumn < qrGridSizeAt4c9653; qrFlowerColumn++) {
      const qrFlowerCenteredColumn = qrFlowerColumn - qrGridHalfWidth,
        qrFlowerCenteredRow = qrFlowerRow - qrGridHalfHeight,
        qrFlowerDistanceSquared = qrFlowerCenteredColumn * qrFlowerCenteredColumn + qrFlowerCenteredRow * qrFlowerCenteredRow;
      if (qrFlowerDistanceSquared < qrFlowerRadiusSquared && qrFlowerDistanceSquared >= 6.25) {
        const canopyRadialFalloff = 1 - Math.sqrt(qrFlowerDistanceSquared) / qrFlowerRadius,
          baseQrFlowerLayers = Math.round(18 * qrScaleAt53f5f9),
          qrFlowerLayerCount =
            Math.max(
              4,
              Math.round(baseQrFlowerLayers * (0.25 + 0.75 * canopyRadialFalloff * canopyRadialFalloff)),
            ) + Math.floor(6 * noise(qrFlowerColumn, qrFlowerRow, 500) * qrScaleAt53f5f9),
          qrFlowerHeightOffset = Math.floor(4.5 * canopyRadialFalloff * qrScaleAt53f5f9) * q,
          qrFlowerBaseHeight = qrFlowerBaseHeightAt5e7c72 + (qrFlowerLayerCount - 1) * q + qrFlowerHeightOffset + q,
          qrFlowersPerCell = 4 + Math.floor(3 * noise(qrFlowerColumn, qrFlowerRow, 600));
        for (let qrFlowerIndex = 0; qrFlowerIndex < qrFlowersPerCell; qrFlowerIndex++) {
          const qrFlowerVariation = noise(qrFlowerColumn, qrFlowerRow, 777 + qrFlowerIndex),
            qrFlowerColumnJitterAt42b956 =
              1.2 * (noise(qrFlowerColumn, qrFlowerRow, 800 + qrFlowerIndex) - 0.5),
            qrFlowerRowJitterAt49e756 =
              1.2 * (noise(qrFlowerColumn, qrFlowerRow, 900 + qrFlowerIndex) - 0.5),
            qrFlowerHeightJitter =
              (noise(qrFlowerColumn, qrFlowerRow, 1e3 + qrFlowerIndex) - 0.6) * q * 2;
          (qrFlowerValues.push(
            qrFlowerColumn + qrFlowerColumnJitterAt42b956,
            qrFlowerRow + qrFlowerRowJitterAt49e756,
            qrFlowerBaseHeight + qrFlowerHeightJitter,
            qrFlowerVariation,
          ),
            qrFlowerCountAt27f743++);
        }
        if (noise(qrFlowerColumn, qrFlowerRow, 1100) < 0.35) {
          const qrFlowerVariationAt2ade8a = noise(qrFlowerColumn, qrFlowerRow, 1200) + 1,
            qrFlowerColumnJitter = 0.5 * (noise(qrFlowerColumn, qrFlowerRow, 1300) - 0.5),
            qrFlowerRowJitter = 0.5 * (noise(qrFlowerColumn, qrFlowerRow, 1400) - 0.5);
          (qrFlowerValues.push(
            qrFlowerColumn + qrFlowerColumnJitter,
            qrFlowerRow + qrFlowerRowJitter,
            qrFlowerBaseHeight - 0.0245,
            qrFlowerVariationAt2ade8a,
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
  let grassCount = 0;
  const grassHalfGridSize = grassGridSize / 2,
    grassHalfGridSizeAt893d87 = grassGridSize / 2,
    grassRadius = grassGridSize * W,
    grassRadiusSquared = grassRadius * grassRadius;
  for (let grassRow = 0; grassRow < grassGridSize; grassRow++)
    for (
      let grassColumn = 0;
      grassColumn < grassGridSize && grassCount < 5e4;
      grassColumn++
    ) {
      const grassCenteredColumn = grassColumn - grassHalfGridSize,
        grassCenteredRow = grassRow - grassHalfGridSizeAt893d87,
        grassDistanceSquared = grassCenteredColumn * grassCenteredColumn + grassCenteredRow * grassCenteredRow;
      if (grassDistanceSquared < 25) continue;
      if (!qrMatrixAt484328?.[grassRow]?.[grassColumn]) continue;
      if (grassDistanceSquared < grassRadiusSquared) continue;
      const grassBladesPerCell = 14 + Math.floor(8 * noise(grassColumn, grassRow, 5100));
      for (
        let grassBladeIndex = 0;
        grassBladeIndex < grassBladesPerCell && grassCount < 5e4;
        grassBladeIndex++
      ) {
        const grassBladeVariation = noise(grassColumn, grassRow, 5200 + grassBladeIndex),
          grassColumnJitter =
            0.85 * (noise(grassColumn, grassRow, 5300 + grassBladeIndex) - 0.5),
          grassZJitter =
            0.85 * (noise(grassColumn, grassRow, 5400 + grassBladeIndex) - 0.5),
          grassBladeHeight =
            $ * (0.5 + 1.2 * noise(grassColumn, grassRow, 5500 + grassBladeIndex));
        (grassVertexValues.push(
          grassColumn + grassColumnJitter,
          grassRow + grassZJitter,
          grassBladeVariation,
          grassBladeHeight,
        ),
          grassCount++);
      }
    }
  const grassPositions = new Float32Array(2e5);
  return (
    grassPositions.set(new Float32Array(grassVertexValues)),
    {
      positions: grassPositions,
      count: grassCount,
    }
  );
}

function generateFallingPetals(canopyTipsAt5136b8, treeGridSizeAt5db166, maximumFallingPetals = 10) {
  const petalGridOffset = treeGridSizeAt5db166 * $ * 0.5,
    fallingPetalValues = [];
  let fallingPetalCount = 0;
  if (0 === canopyTipsAt5136b8.length)
    return {
      positions: new Float32Array(4 * maximumFallingPetals),
      count: 0,
    };
  for (let fallingPetalIndex = 0; fallingPetalIndex < maximumFallingPetals; fallingPetalIndex++) {
    const fallingPetalOrigin =
        canopyTipsAt5136b8[
          Math.floor(seededNoise(fallingPetalIndex, 0, 5e3) * canopyTipsAt5136b8.length) %
            canopyTipsAt5136b8.length
        ],
      fallingPetalSeed = seededNoise(fallingPetalIndex, 0, 5100),
      fallingPetalAngle = seededNoise(fallingPetalIndex, 0, 5200) * Math.PI * 2,
      fallingPetalRadius = fallingPetalOrigin.radius * $ * 1.5 * seededNoise(fallingPetalIndex, 0, 5300),
      fallingPetalWorldX = fallingPetalOrigin.x + Math.cos(fallingPetalAngle) * fallingPetalRadius,
      fallingPetalWorldZ = fallingPetalOrigin.z + Math.sin(fallingPetalAngle) * fallingPetalRadius,
      fallingPetalHeight = fallingPetalOrigin.y + q * (0.5 + 1 * seededNoise(fallingPetalIndex, 0, 5400)),
      fallingPetalColumn = (fallingPetalWorldX + petalGridOffset) / $,
      fallingPetalGridRow = (fallingPetalWorldZ + petalGridOffset) / $;
    (fallingPetalValues.push(fallingPetalColumn, fallingPetalGridRow, fallingPetalHeight, fallingPetalSeed), fallingPetalCount++);
  }
  const fallingPetalPositions = new Float32Array(4 * maximumFallingPetals);
  return (
    fallingPetalPositions.set(new Float32Array(fallingPetalValues)),
    {
      positions: fallingPetalPositions,
      count: fallingPetalCount,
    }
  );
}

function generateRain(rainGridSize) {
  const rainPositions = new Float32Array(2e3),
    rainRange = 1.2 * rainGridSize;
  for (let rainIndex = 0; rainIndex < 500; rainIndex++) {
    const rainWorldX =
        seededNoise(rainIndex, 0, 8e3) * rainRange -
        0.5 * (rainRange - rainGridSize),
      rainWorldZ =
        seededNoise(rainIndex, 0, 8100) * rainRange -
        0.5 * (rainRange - rainGridSize),
      rainHeightSeed = seededNoise(rainIndex, 0, 8200),
      rainSeed = seededNoise(rainIndex, 0, 8300);
    ((rainPositions[4 * rainIndex] = rainWorldX),
      (rainPositions[4 * rainIndex + 1] = rainWorldZ),
      (rainPositions[4 * rainIndex + 2] = rainHeightSeed),
      (rainPositions[4 * rainIndex + 3] = rainSeed));
  }
  return {
    positions: rainPositions,
    count: 500,
  };
}

function generateButterflies(butterflyGridSize) {
  const butterflyOrbitRange = 0.46 * butterflyGridSize,
    butterflyPositions = new Float32Array(40);
  for (let autumnCloudIndex = 0; autumnCloudIndex < 10; autumnCloudIndex++) {
    const butterflyOrbitRadius =
        butterflyOrbitRange * (0.35 + 0.55 * seededNoise(autumnCloudIndex, 0, 9e3)),
      butterflyOrbitSpeed = 0.25 + 0.3 * seededNoise(autumnCloudIndex, 0, 9100),
      butterflyHeightOffset = 4 + 9 * seededNoise(autumnCloudIndex, 0, 9200),
      butterflySeed = seededNoise(autumnCloudIndex, 0, 9300);
    ((butterflyPositions[4 * autumnCloudIndex] = butterflyOrbitRadius),
      (butterflyPositions[4 * autumnCloudIndex + 1] = butterflyOrbitSpeed),
      (butterflyPositions[4 * autumnCloudIndex + 2] = butterflyHeightOffset),
      (butterflyPositions[4 * autumnCloudIndex + 3] = butterflySeed));
  }
  return {
    positions: butterflyPositions,
    count: 10,
  };
}

 const WGSL_BLOCK_SIZE = "0.0245";
const WGSL_ACES_FILM = `
fn acesFilm(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
`;

function uploadSceneData(
  rendererAt2fb61d,
  voxelBlocks,
  treeBranchesAt54e0bc,
  canopyFlowersAt8693e0,
  qrFlowerValuesAtc37564,
  qrFlowerCountAt720260,
  grass,
  fallingPetalsAt34c53d,
  rainDataAt36d9e8,
  butterflyDataAt559a87,
) {
  const { device: gpuDevice, buffers: buffersAt4b843a } = rendererAt2fb61d;
  (!(function (gpuDeviceAt33e759, buffersAt4a0788, sceneData) {
    (gpuDeviceAt33e759.queue.writeBuffer(buffersAt4a0788.typeBuffer, 0, sceneData.types),
      gpuDeviceAt33e759.queue.writeBuffer(buffersAt4a0788.posBuffer, 0, sceneData.positions),
      gpuDeviceAt33e759.queue.writeBuffer(buffersAt4a0788.heightBuffer, 0, sceneData.heights),
      gpuDeviceAt33e759.queue.writeBuffer(buffersAt4a0788.baseYBuffer, 0, sceneData.baseY));
  })(gpuDevice, buffersAt4b843a, voxelBlocks),
    (rendererAt2fb61d.counts.numBlocks = voxelBlocks.numBlocks),
    (rendererAt2fb61d.counts.gridSize = voxelBlocks.gridSize));
  const branchUploadAt42f591 = rendererAt2fb61d._branchUpload;
  (branchUploadAt42f591.fill(0),
    branchUploadAt42f591.set(treeBranchesAt54e0bc.segments),
    gpuDevice.queue.writeBuffer(buffersAt4b843a.branchBuffer, 0, branchUploadAt42f591),
    (rendererAt2fb61d.counts.segmentCount = treeBranchesAt54e0bc.segmentCount));
  const totalFlowerCountAtc30fd4 = canopyFlowersAt8693e0.count + qrFlowerCountAt720260,
    flowerUpload = rendererAt2fb61d._flowerUpload;
  (flowerUpload.fill(0), flowerUpload.set(canopyFlowersAt8693e0.positions));
  for (let qrFlowerValueIndexAt85a1e3 = 0; qrFlowerValueIndexAt85a1e3 < 4 * qrFlowerCountAt720260; qrFlowerValueIndexAt85a1e3++)
    flowerUpload[4 * canopyFlowersAt8693e0.count + qrFlowerValueIndexAt85a1e3] = qrFlowerValuesAtc37564[qrFlowerValueIndexAt85a1e3];
  (gpuDevice.queue.writeBuffer(buffersAt4b843a.flowerBuffer, 0, flowerUpload),
    (rendererAt2fb61d.counts.flowerCount = totalFlowerCountAtc30fd4),
    gpuDevice.queue.writeBuffer(buffersAt4b843a.grassBuffer, 0, grass.positions),
    (rendererAt2fb61d.counts.grassCount = grass.count));
  const petalUploadAt55de00 = rendererAt2fb61d._petalUpload;
  if (
    (petalUploadAt55de00.fill(0),
    petalUploadAt55de00.set(fallingPetalsAt34c53d.positions),
    gpuDevice.queue.writeBuffer(buffersAt4b843a.fallingPetalBuffer, 0, petalUploadAt55de00),
    (rendererAt2fb61d.counts.petalCount = fallingPetalsAt34c53d.count),
    rainDataAt36d9e8)
  ) {
    const rainUpload = rendererAt2fb61d._rainUpload;
    (rainUpload.fill(0),
      rainUpload.set(rainDataAt36d9e8.positions),
      gpuDevice.queue.writeBuffer(buffersAt4b843a.rainBuffer, 0, rainUpload),
      (rendererAt2fb61d.counts.rainCount = rainDataAt36d9e8.count));
  }
  if (butterflyDataAt559a87) {
    const butterflyUpload = rendererAt2fb61d._butterflyUpload;
    (butterflyUpload.fill(0),
      butterflyUpload.set(butterflyDataAt559a87.positions),
      gpuDevice.queue.writeBuffer(buffersAt4b843a.butterflyBuffer, 0, butterflyUpload),
      (rendererAt2fb61d.counts.butterflyCount = butterflyDataAt559a87.count));
  }
}

function drawTreeScene(rendererAt3ff5cb, sceneUniforms) {
  const seasonIndex = Math.min(3, Math.max(0, Math.floor(sceneUniforms.season)));
  rendererAt3ff5cb.qrScene = TREE_QR_APPEARANCES[seasonIndex];
  const {
      buffers: buffers,
      pipelines: pipelines,
      bindGroups: bindGroups,
      counts: counts,
    } = rendererAt3ff5cb;
  rendererAt3ff5cb.uniformTargets ??= [
    { buffer: buffers.blockUniforms, count: "numBlocks" },
    { buffer: buffers.branchUniforms, count: "segmentCount" },
    { buffer: buffers.grassUniforms, count: "grassCount" },
    { buffer: buffers.petalUniforms, count: "petalCount" },
    { buffer: buffers.rainUniforms, count: "rainCount" },
    { buffer: buffers.butterflyUniforms, count: "butterflyCount" },
  ];
  writeSceneUniforms(rendererAt3ff5cb, sceneUniforms, rendererAt3ff5cb.uniformTargets);
  renderSceneFrame(rendererAt3ff5cb, sceneUniforms, { blur: true, draw(mainRenderPass) {
    if (!rendererAt3ff5cb.gpuSurface.transparent) {
      mainRenderPass.setPipeline(pipelines.sky);
      mainRenderPass.setBindGroup(0, bindGroups.sky);
      mainRenderPass.draw(3);
    }
    (mainRenderPass.setPipeline(pipelines.shadow),
    mainRenderPass.setBindGroup(0, bindGroups.shadow),
    mainRenderPass.draw(6),
    sceneUniforms.season < 2.5 && counts.grassCount > 0 &&
      pipelines.grass &&
      (mainRenderPass.setPipeline(pipelines.grass),
      mainRenderPass.setBindGroup(0, bindGroups.grass),
      mainRenderPass.draw(3 * counts.grassCount)),
    counts.segmentCount > 0 &&
      pipelines.branches &&
      (mainRenderPass.setPipeline(pipelines.branches),
      mainRenderPass.setBindGroup(0, bindGroups.branches),
      mainRenderPass.draw(48 * counts.segmentCount)),
    sceneUniforms.season < 2.5 && counts.flowerCount > 0 &&
      (mainRenderPass.setPipeline(pipelines.flowers),
      mainRenderPass.setBindGroup(0, bindGroups.flowers),
      mainRenderPass.draw(150 * counts.flowerCount)),
    sceneUniforms.season < 2.5 && counts.petalCount > 0 &&
      pipelines.fallingPetals &&
      (mainRenderPass.setPipeline(pipelines.fallingPetals),
      mainRenderPass.setBindGroup(0, bindGroups.fallingPetals),
      mainRenderPass.draw(150 * counts.petalCount)),
    sceneUniforms.season > 1.5 && sceneUniforms.season < 2.5 && counts.rainCount > 0 &&
      pipelines.rain &&
      sceneUniforms.rainMode > 0.01 &&
      (mainRenderPass.setPipeline(pipelines.rain),
      mainRenderPass.setBindGroup(0, bindGroups.rain),
      mainRenderPass.draw(6 * counts.rainCount)),
    sceneUniforms.season < 2.5 && counts.butterflyCount > 0 &&
      pipelines.butterflies &&
      (mainRenderPass.setPipeline(pipelines.butterflies),
      mainRenderPass.setBindGroup(0, bindGroups.butterflies),
    mainRenderPass.draw(6 * counts.butterflyCount)));
  }, drawForeground(foregroundPass) {
    if (sceneUniforms.season <= 2.5 || !counts.rainCount || !pipelines.rain || sceneUniforms.rainMode <= .01) return;
    foregroundPass.setPipeline(pipelines.rain);
    foregroundPass.setBindGroup(0, bindGroups.rain);
    foregroundPass.draw(6 * counts.rainCount);
  }});
}

function hashSeed(treeSeed) {
  let hash = 0;
  for (let stringCharacterIndex = 0; stringCharacterIndex < treeSeed.length; stringCharacterIndex++)
    hash = (Math.imul(31, hash) + treeSeed.charCodeAt(stringCharacterIndex)) | 0;
  return (Math.abs(hash) % 99991) + 1;
}


function buildQrMatrix(content) { return encodeQrMatrix(content); }

function setupTreeRuntime(runtime) {
  const { canvasRef, canvasWidth, canvasHeight, qrContent, isFlat, seasonRef, customColorRef, treeSeed, gpuSurface, qrRenderer, runSetup } = runtime;
  (function (rendererProps) {
      const {
          canvasRef: canvasRef,
          canvasWidth: canvasWidth,
          canvasHeight: canvasHeightAt41144e,
          qrContent: qrContentAt2d7f10,
          isFlat: isFlatRef,
          seasonRef: seasonRef,
          customColorRef: customColorRef,
          treeSeed: treeSeedRef,
          qrSnapshotRef: qrSnapshotRef,
          onFlatSettled: onFlatSettled,
          onQrSnapshotUpdated: onQrSnapshotUpdated,
        } = rendererProps,
        frameLoopRef = createRef(null),
        rendererInitializing = createRef(!1),
        renderedCanvasRef = createRef(null),
        sceneStartTimeRef = createRef(Date.now()),
        rendererRef = createRef(null),
        transitionProgressRef = createRef(0),
        easedTransitionProgressRef = createRef(0),
        lastFrameTimeRef = createRef(Date.now()),
        qrContentRef = createRef(qrContentAt2d7f10);
      qrContentRef.current = qrContentAt2d7f10;
      const lastRenderedQrContentRef = createRef(qrContentAt2d7f10),
        previousSeasonRef = createRef(0),
        qrMatrixRef = createRef(null),
        treeSettingsRef = createRef(null),
        gridSizeRef = createRef(0),
        trunkSeed = (hashSeed(treeSeedRef.current) - 1) / 99990,
        burstStartTimeRef = createRef(0),
        previousFlatState = createRef(!1),
        rainTransition = createRef(0);
      runSetup(() => {
        const rendererAt741d66 = rendererRef.current;
        if (!rendererAt741d66) return;
        const qrMatrix = buildQrMatrix(qrContentAt2d7f10),
          voxelBlocksAt311b94 = createVoxelBlocks(qrMatrix),
          treeSettingsAte480db = analyzeQrMatrix(qrMatrix);
        ((qrMatrixRef.current = qrMatrix),
          (treeSettingsRef.current = treeSettingsAte480db),
          (gridSizeRef.current = voxelBlocksAt311b94.gridSize),
          setNoiseSeed(hashSeed(treeSeedRef.current)));
        const treeBranchesAtccf5b6 = createTreeBranches(treeSettingsAte480db, voxelBlocksAt311b94.gridSize),
          canopyFlowersAtca0499 = generateCanopyFlowers(treeBranchesAtccf5b6.tips, treeSettingsAte480db),
          qrFlowersAt543ce4 = generateQrFlowers(qrMatrix),
          grassData = generateGrass(voxelBlocksAt311b94.gridSize, qrMatrix),
          fallingPetals = generateFallingPetals(treeBranchesAtccf5b6.tips, voxelBlocksAt311b94.gridSize),
          rainData = generateRain(voxelBlocksAt311b94.gridSize),
          butterflyDataAt4cdca2 = generateButterflies(voxelBlocksAt311b94.gridSize);
        (uploadSceneData(
          rendererAt741d66,
          voxelBlocksAt311b94,
          treeBranchesAtccf5b6,
          canopyFlowersAtca0499,
          qrFlowersAt543ce4.positions,
          qrFlowersAt543ce4.count,
          grassData,
          fallingPetals,
          rainData,
          butterflyDataAt4cdca2,
        ),
          (lastRenderedQrContentRef.current = qrContentAt2d7f10));
      });
      const initializeRenderer = async () => {
        try {
          if (rendererRef.current || rendererInitializing.current) return;
          if (canvasWidth <= 0 || canvasHeightAt41144e <= 0) return;
          const sceneCanvasAt207726 = canvasRef.current;
          if (!sceneCanvasAt207726) return;
          rendererInitializing.current = !0;
          const rendererAtf2509b = await (async function (
            sceneCanvasAt56169d,
            rendererOptions,
            rendererOptionsAt40a891,
          ) {
            const gpuContext = gpuSurface.context,
              gpuDeviceAt354206 = gpuSurface.device,
              textureFormat = gpuSurface.format;
            gpuSurface.resize();
            const blurUniformBuffer = createUniformBuffer(gpuDeviceAt354206, 64),
              branchUniformBuffer = createUniformBuffer(gpuDeviceAt354206, 64),
              grassUniformBuffer = createUniformBuffer(gpuDeviceAt354206, 64),
              petalUniformBuffer = createUniformBuffer(gpuDeviceAt354206, 64),
              rainUniformBuffer = createUniformBuffer(gpuDeviceAt354206, 64),
              butterflyUniformBuffer = createUniformBuffer(gpuDeviceAt354206, 64),
              blockTypeBuffer = createStorageBuffer(gpuDeviceAt354206, 268960),
              positionBuffer = createStorageBuffer(gpuDeviceAt354206, 1075840),
              heightBuffer = createStorageBuffer(gpuDeviceAt354206, 268960),
              baseYBuffer = createStorageBuffer(gpuDeviceAt354206, 268960),
              flowerBuffer = createStorageBuffer(gpuDeviceAt354206, 16e5),
              branchBuffer = createStorageBuffer(gpuDeviceAt354206, 24e3),
              grassBuffer = createStorageBuffer(gpuDeviceAt354206, 8e5),
              fallingPetalBuffer = createStorageBuffer(gpuDeviceAt354206, 160),
              rainBuffer = createStorageBuffer(gpuDeviceAt354206, 8e3),
              butterflyBuffer = createStorageBuffer(gpuDeviceAt354206, 160),
              sceneBindGroupLayout = createBindGroupLayout(gpuDeviceAt354206, {
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
              sceneBindGroupLayoutAt9c7a29 = createBindGroupLayout(gpuDeviceAt354206, {
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
              sceneBindGroupLayoutAt3d73c0 = createBindGroupLayout(gpuDeviceAt354206, {
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
              blocksBindGroup = createBindGroup(gpuDeviceAt354206, {
                layout: sceneBindGroupLayout,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: blurUniformBuffer,
                    },
                  },
                  {
                    binding: 1,
                    resource: {
                      buffer: blockTypeBuffer,
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
              skyShadowBindGroup = createBindGroup(gpuDeviceAt354206, {
                layout: sceneBindGroupLayoutAt9c7a29,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: blurUniformBuffer,
                    },
                  },
                ],
              }),
              flowerBindGroup = createBindGroup(gpuDeviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: blurUniformBuffer,
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
              branchBindGroup = createBindGroup(gpuDeviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: branchUniformBuffer,
                    },
                  },
                  {
                    binding: 1,
                    resource: {
                      buffer: branchBuffer,
                    },
                  },
                ],
              }),
              grassBindGroup = createBindGroup(gpuDeviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: grassUniformBuffer,
                    },
                  },
                  {
                    binding: 1,
                    resource: {
                      buffer: grassBuffer,
                    },
                  },
                ],
              }),
              fallingPetalBindGroup = createBindGroup(gpuDeviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: petalUniformBuffer,
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
              rainBindGroup = createBindGroup(gpuDeviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: rainUniformBuffer,
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
              butterflyBindGroup = createBindGroup(gpuDeviceAt354206, {
                layout: sceneBindGroupLayoutAt3d73c0,
                entries: [
                  {
                    binding: 0,
                    resource: {
                      buffer: butterflyUniformBuffer,
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
              skyPipeline = createScenePipeline(gpuDeviceAt354206, textureFormat, sceneBindGroupLayoutAt9c7a29, {
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
              shadowPipeline = createScenePipeline(gpuDeviceAt354206, textureFormat, sceneBindGroupLayoutAt9c7a29, {
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
              blocksPipeline = createScenePipeline(gpuDeviceAt354206, textureFormat, sceneBindGroupLayout, {
                vertex:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct BlockOutput {\n  @builtin(position) position: vec4f,\n  @location(0) uv: vec2f,\n  @location(1) faceNx: f32,\n  @location(2) faceNy: f32,\n  @location(3) faceNz: f32,\n  @location(4) blockType: f32,\n  @location(5) blockH: f32,\n  @location(6) col: f32,\n  @location(7) row: f32,\n  @location(8) layer: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n@group(0) @binding(1) var<storage, read> blockTypes: array<u32>;\n@group(0) @binding(2) var<storage, read> blockPositions: array<vec4f>;\n@group(0) @binding(3) var<storage, read> blockHeights: array<f32>;\n@group(0) @binding(4) var<storage, read> blockBaseY: array<f32>;\n\n@vertex\nfn main(@builtin(vertex_index) vertexIndex: u32) -> BlockOutput {\n  var output: BlockOutput;\n  let blockIdx = vertexIndex / 36u;\n  let localVertIdx = vertexIndex % 36u;\n  let faceIdx = localVertIdx / 6u;\n  let vertIdx = localVertIdx % 6u;\n\n  let blockCount = u32(uniforms.blockCount);\n  if (blockIdx >= blockCount) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let posData = blockPositions[blockIdx];\n  let col = posData.x;\n  let row = posData.y;\n  output.col = col;\n  output.row = row;\n  output.layer = blockBaseY[blockIdx] / " +
                  WGSL_BLOCK_SIZE +
                  ";\n\n  let gridSize = uniforms.gridSize;\n  let blockSize = " +
                  WGSL_BLOCK_SIZE +
                  ";\n  let halfGrid = gridSize * blockSize * 0.5;\n  let cubeSize = blockSize;\n\n  let baseX = col * blockSize - halfGrid;\n  let baseY = blockBaseY[blockIdx];\n  let baseZ = row * blockSize - halfGrid;\n  let h = cubeSize;\n  output.blockH = h;\n\n  let typePacked = blockTypes[blockIdx];\n  // Winter keeps the QR ground module but removes every elevated leaf cube.\n  if (uniforms.season > 2.5 && typePacked == 1u && baseY > .001) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n  output.blockType = f32(typePacked);\n\n  let quadVerts = array<vec2f, 6>(\n    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),\n    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)\n  );\n  let qv = quadVerts[vertIdx];\n  let hw = cubeSize * 0.5;\n  let hd = cubeSize * 0.5;\n\n  var localPos = vec3f(0.0);\n  var normal = vec3f(0.0);\n\n  var swayX = 0.0;\n  var swayZ = 0.0;\n  if (typePacked == 1u && h > 0.15) {\n    let time = uniforms.time;\n    swayX = sin(time * 0.8 + col * 0.3 + row * 0.2) * 0.002 * h;\n    swayZ = sin(time * 0.6 + col * 0.2 + row * 0.4) * 0.0015 * h;\n  }\n\n  if (faceIdx == 0u) {\n    localPos = vec3f(baseX + (qv.x - 0.5) * cubeSize + swayX, baseY + h, baseZ + (qv.y - 0.5) * cubeSize + swayZ);\n    normal = vec3f(0.0, 1.0, 0.0);\n  } else if (faceIdx == 1u) {\n    localPos = vec3f(baseX + (qv.x - 0.5) * cubeSize, baseY, baseZ + (0.5 - qv.y) * cubeSize);\n    normal = vec3f(0.0, -1.0, 0.0);\n  } else if (faceIdx == 2u) {\n    localPos = vec3f(baseX + (qv.x - 0.5) * cubeSize + swayX * qv.y, baseY + qv.y * h, baseZ + hd + swayZ * qv.y);\n    normal = vec3f(0.0, 0.0, 1.0);\n  } else if (faceIdx == 3u) {\n    localPos = vec3f(baseX + (0.5 - qv.x) * cubeSize + swayX * qv.y, baseY + qv.y * h, baseZ - hd + swayZ * qv.y);\n    normal = vec3f(0.0, 0.0, -1.0);\n  } else if (faceIdx == 4u) {\n    localPos = vec3f(baseX + hw + swayX * qv.y, baseY + qv.y * h, baseZ + (qv.x - 0.5) * cubeSize + swayZ * qv.y);\n    normal = vec3f(1.0, 0.0, 0.0);\n  } else {\n    localPos = vec3f(baseX - hw + swayX * qv.y, baseY + qv.y * h, baseZ + (0.5 - qv.x) * cubeSize + swayZ * qv.y);\n    normal = vec3f(-1.0, 0.0, 0.0);\n  }\n\n  output.uv = qv;\n  output.faceNx = normal.x;\n  output.faceNy = normal.y;\n  output.faceNz = normal.z;\n\n  let progress = uniforms.progress;\n\n  if (typePacked == 2u && baseY > 0.001) {\n    let trunkVis = smoothstep(0.2, 0.6, progress);\n    localPos = vec3f(\n      baseX + (localPos.x - baseX) * trunkVis,\n      baseY + (localPos.y - baseY) * trunkVis,\n      baseZ + (localPos.z - baseZ) * trunkVis,\n    );\n  }\n\n  if (typePacked == 1u) {\n    let cubeVis = smoothstep(0.15, 0.6, progress);\n    localPos = vec3f(\n      baseX + (localPos.x - baseX) * cubeVis,\n      baseY + (localPos.y - baseY) * cubeVis,\n      baseZ + (localPos.z - baseZ) * cubeVis,\n    );\n  }\n\n  if (typePacked == 5u) {\n    let branchVis = smoothstep(0.0, 0.4, 1.0 - progress);\n    localPos = vec3f(\n      baseX + (localPos.x - baseX) * branchVis,\n      baseY + (localPos.y - baseY) * branchVis,\n      baseZ + (localPos.z - baseZ) * branchVis,\n    );\n  }\n\n  " +
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
                  ";\n\n  let NdSun = max(dot(N, sunDir), 0.0);\n  let NdUp = max(dot(N, vec3f(0.0, 1.0, 0.0)), 0.0);\n\n  let layer = input.layer;\n  let seed = vec2f(input.col, input.row);\n  let blockSeed = seed.x * 17.3 + seed.y * 31.1 + layer * 73.7;\n  let noise1 = fract(sin(blockSeed) * 43758.5);\n  let noise2 = fract(sin(blockSeed * 1.7 + 127.1) * 43758.5);\n  let noise3 = fract(sin(blockSeed * 2.3 + 311.7) * 43758.5);\n\n  let gridSize = uniforms.gridSize;\n  let cx = gridSize * 0.5;\n  let cy = gridSize * 0.5;\n  let shadowOffsetX = 1.5;\n  let shadowOffsetY = 1.5;\n  let dx = input.col - (cx + shadowOffsetX);\n  let dy = input.row - (cy + shadowOffsetY);\n  let distFromShadowCenter = sqrt(dx * dx + dy * dy);\n  let canopyRadius = gridSize * 0.46;\n  let trunkRadius = 2.5;\n  let shadowT = 1.0 - smoothstep(trunkRadius, canopyRadius, distFromShadowCenter);\n  let trunkAO = (1.0 - smoothstep(0.0, trunkRadius * 1.5, distFromShadowCenter)) * 0.20;\n  let treeShadow = 1.0 - shadowT * 0.35 - trunkAO;\n\n  let maxCanopyLayer = 15.0;\n  let layerRatio = min(layer / maxCanopyLayer, 1.0);\n  let canopyAO = 0.65 + layerRatio * 0.35;\n\n  var albedo = vec3f(0.5);\n\n  if (input.faceNy > 0.5) {\n    let topWarmTint = vec3f(1.1, 1.08, 1.02);\n    let isDarkModule = step(0.5, f32(blockType));\n\n    if (blockType == 0) {\n      var dirtColor = dirtMid;\n      let t = noise1;\n      if (t < 0.4) { dirtColor = mix(dirtLight, dirtMid, t / 0.4); }\n      else if (t < 0.7) { dirtColor = mix(dirtMid, dirtDark, (t - 0.4) / 0.3); }\n      else { dirtColor = mix(dirtDark, dirtDark * 0.85, (t - 0.7) / 0.3); }\n      let shift = (noise2 - 0.5) * 0.18;\n      let grain = (noise3 - 0.5) * 0.08;\n      dirtColor = dirtColor * (1.0 + shift + grain) * treeShadow;\n\n      let distFromCenter = sqrt((input.col - cx) * (input.col - cx) + (input.row - cy) * (input.row - cy));\n      let underCanopy = step(distFromCenter, canopyRadius);\n      let speckleChance = noise3 * underCanopy;\n\n      if (season < 0.5) {\n        let petalTint = vec3f(0.90, 0.72, 0.70);\n        dirtColor = mix(dirtColor, petalTint, step(0.85, speckleChance) * 0.4);\n      } else if (season < 1.5) {\n        let greenSpeck = vec3f(0.55, 0.68, 0.42);\n        dirtColor = mix(dirtColor, greenSpeck, step(0.92, speckleChance) * 0.2);\n      } else if (season < 2.5) {\n        let leafSpeck = mix(vec3f(0.85, 0.52, 0.15), vec3f(0.72, 0.35, 0.10), noise1);\n        dirtColor = mix(dirtColor, leafSpeck, step(0.70, speckleChance) * 0.5);\n      }\n      albedo = dirtColor * topWarmTint;\n\n    } else if (blockType == 1) {\n      var cherryColor = sakuraMid;\n      let t = noise1;\n      if (t < 0.33) { cherryColor = mix(sakuraLight, sakuraMid, t / 0.33); }\n      else if (t < 0.66) { cherryColor = mix(sakuraMid, sakuraDeep, (t - 0.33) / 0.33); }\n      else { cherryColor = mix(sakuraDeep, sakuraRich, (t - 0.66) / 0.34); }\n      let shift = (noise2 - 0.5) * 0.15;\n      cherryColor = cherryColor * (1.0 + shift);\n\n      let edgeX = min(uv.x, 1.0 - uv.x);\n      let edgeY = min(uv.y, 1.0 - uv.y);\n      let edgeDist = min(edgeX, edgeY);\n      let roundedEdge = smoothstep(0.0, 0.12, edgeDist);\n      let edgeDarken = mix(0.88, 1.0, roundedEdge);\n      let finalEdge = mix(edgeDarken, 1.0, progress);\n      albedo = cherryColor * topWarmTint * canopyAO * finalEdge;\n\n    } else if (blockType == 2) {\n      let trunkMaxLayer = 18.0;\n      let heightRatio = min(layer / trunkMaxLayer, 1.0);\n      let sandColor = vec3f(0.85, 0.78, 0.64);\n      let sandShift = (noise1 - 0.5) * 0.1;\n      let groundSand = sandColor * (1.0 + sandShift) * treeShadow;\n\n      var barkColor = mix(barkMid, barkLight, noise1 * 0.4);\n      let shift = (noise2 - 0.5) * 0.15;\n      barkColor = barkColor * (1.0 + shift);\n      let aoShadow = 0.6 + heightRatio * 0.4;\n      let sandBlend = smoothstep(0.0, 0.15, heightRatio);\n      albedo = mix(groundSand, barkColor * aoShadow, sandBlend) * topWarmTint;\n\n    } else if (blockType == 3) {\n      let grassBrown = vec3f(0.28, 0.25, 0.12);\n      let grassOlive = vec3f(0.32, 0.35, 0.15);\n      var grassColor = grassMid;\n      let t = noise1;\n      if (t < 0.3) { grassColor = mix(grassBright, grassMid, t / 0.3); }\n      else if (t < 0.6) { grassColor = mix(grassMid, grassDark, (t - 0.3) / 0.3); }\n      else if (t < 0.8) { grassColor = mix(grassDark, grassBrown, (t - 0.6) / 0.2); }\n      else { grassColor = mix(grassBrown, grassOlive, (t - 0.8) / 0.2); }\n      let shift = (noise2 - 0.5) * 0.2;\n      grassColor = grassColor * (1.0 + shift);\n      albedo = grassColor * topWarmTint;\n\n    } else if (blockType == 5) {\n      var branchColor = mix(barkMid, barkLight, noise1 * 0.5);\n      let bShift = (noise2 - 0.5) * 0.12;\n      branchColor = branchColor * (1.0 + bShift);\n      let ringNoise = sin(noise1 * 12.0 + noise2 * 6.0) * 0.06 + 0.94;\n      albedo = branchColor * ringNoise * topWarmTint * canopyAO;\n\n    } else {\n      let sandA = vec3f(0.84, 0.77, 0.63);\n      let sandB = vec3f(0.80, 0.73, 0.60);\n      let sandPink = vec3f(0.84, 0.74, 0.66);\n      var fallenColor = sandA;\n      if (noise1 < 0.4) { fallenColor = mix(sandA, sandB, noise2); }\n      else if (noise1 < 0.75) { fallenColor = mix(sandB, sandPink, noise2 * 0.5); }\n      else { fallenColor = mix(sandA, sandPink, noise2 * 0.4); }\n      let shift = (noise2 - 0.5) * 0.12;\n      fallenColor = fallenColor * (1.0 + shift) * treeShadow;\n      albedo = fallenColor * topWarmTint;\n    }\n\n    let qrBoost = progress * progress;\n    // Stronger darkening for spring & autumn QR contrast\n    let seasonDark = select(0.0, 0.08, season < 0.5 || season > 1.5);\n    // Extra darkening for light custom colors (Snow) in QR mode\n    let albedoBright = dot(albedo, vec3f(0.299, 0.587, 0.114));\n    let snowExtraDark = mix(0.0, 0.12, smoothstep(0.55, 0.8, albedoBright) * customStr);\n    let darkFactor = mix(0.48, 0.43 - snowExtraDark - seasonDark, qrBoost);\n    // Prevent light QR modules from washing out to gray/white in 2D mode\n    let lightFactor = mix(0.20, 0.36, qrBoost);\n    let lightTarget = vec3f(0.78, 0.70, 0.56);\n    let darkened = albedo * darkFactor;\n    let brightened = mix(albedo, lightTarget, lightFactor);\n    albedo = mix(brightened, darkened, isDarkModule);\n\n  } else if (abs(input.faceNz) > 0.5 || abs(input.faceNx) > 0.5) {\n    let faceN = normalize(vec3f(input.faceNx, input.faceNy, input.faceNz));\n    let sunLight = max(dot(faceN, sunDir), 0.0);\n    let shade = 0.3 + sunLight * 0.65;\n    let tint = vec3f(0.95, 0.95, 0.98);\n\n    if (layer < 1.0 && (blockType == 0 || blockType == 3 || blockType == 4)) {\n      let stoneLight = vec3f(0.78, 0.72, 0.64);\n      let stoneMid = vec3f(0.68, 0.62, 0.54);\n      let stoneDark = vec3f(0.58, 0.52, 0.45);\n      var stoneColor = stoneMid;\n      if (noise1 < 0.35) { stoneColor = mix(stoneLight, stoneMid, noise2); }\n      else if (noise1 < 0.7) { stoneColor = mix(stoneMid, stoneDark, noise2 * 0.6); }\n      else { stoneColor = mix(stoneDark, stoneLight, noise2 * 0.3); }\n      let stoneShift = (noise3 - 0.5) * 0.08;\n      stoneColor = stoneColor * (1.0 + stoneShift);\n      albedo = stoneColor * shade * tint;\n\n    } else if (blockType == 0) {\n      var dirtColor = dirtMid;\n      let t = noise1;\n      if (t < 0.4) { dirtColor = mix(dirtLight, dirtMid, t / 0.4); }\n      else if (t < 0.7) { dirtColor = mix(dirtMid, dirtDark, (t - 0.4) / 0.3); }\n      else { dirtColor = dirtDark * (1.0 - (t - 0.7) * 0.2); }\n      let shift = (noise2 - 0.5) * 0.2;\n      dirtColor = dirtColor * (1.0 + shift);\n      albedo = dirtColor * shade * tint;\n\n    } else if (blockType == 1) {\n      var cherryColor = sakuraMid;\n      let t = noise1;\n      if (t < 0.33) { cherryColor = mix(sakuraLight, sakuraMid, t / 0.33); }\n      else if (t < 0.66) { cherryColor = mix(sakuraMid, sakuraDeep, (t - 0.33) / 0.33); }\n      else { cherryColor = mix(sakuraDeep, sakuraRich, (t - 0.66) / 0.34); }\n      let shift = (noise2 - 0.5) * 0.25;\n      cherryColor = cherryColor * (1.0 + shift);\n      let edgeX = min(uv.x, 1.0 - uv.x);\n      let edgeY = min(uv.y, 1.0 - uv.y);\n      let edgeDist = min(edgeX, edgeY);\n      let roundedEdge = smoothstep(0.0, 0.12, edgeDist);\n      let edgeDarken = mix(0.7, 1.0, roundedEdge);\n      albedo = cherryColor * shade * tint * canopyAO * edgeDarken;\n\n    } else if (blockType == 2) {\n      let trunkCx = gridSize * 0.5;\n      let trunkCy = gridSize * 0.5;\n      let radX = input.col - trunkCx;\n      let radZ = input.row - trunkCy;\n      let radLen = max(sqrt(radX * radX + radZ * radZ), 0.01);\n      let cylNormalX = radX / radLen;\n      let cylNormalZ = radZ / radLen;\n      let cylN = normalize(vec3f(cylNormalX * 0.8 + faceN.x * 0.2, faceN.y * 0.15, cylNormalZ * 0.8 + faceN.z * 0.2));\n      let cylSunLight = max(dot(cylN, sunDir), 0.0);\n\n      let trunkMaxLayer = 18.0;\n      let heightRatio = min(layer / trunkMaxLayer, 1.0);\n\n      let ts = uniforms.trunkSeed;  // 0..1 per-session bark variation\n\n      let barkAngle = atan2(radZ, radX);\n      let groove1 = sin(barkAngle * (9.0 + ts * 7.0) + noise1 * 2.0) * 0.5 + 0.5;\n      let groove2 = sin(barkAngle * (5.0 + ts * 5.0) + noise2 * 3.5 + 1.7) * 0.5 + 0.5;\n      let groove3 = sin(barkAngle * (16.0 + ts * 8.0) + noise1 * 5.0) * 0.5 + 0.5;\n      let grooveDepth = (groove1 * 0.5 + groove2 * 0.3 + groove3 * 0.2) * 0.25 + 0.75;\n\n      let spiralAngle = barkAngle + heightRatio * (1.8 + ts * 2.0) + noise1 * 0.5;\n      let woodGrain = sin(spiralAngle * (6.0 + ts * 5.0) + layer * 2.0) * 0.08 + 0.92;\n      let ringPattern = sin(layer * (2.0 + ts * 3.5) + noise2 * 4.0) * 0.10 + 0.90;\n      let knotNoise = sin(barkAngle * 3.0 + layer * 5.0 + noise3 * 6.0);\n      let knot = smoothstep(0.85, 0.95, knotNoise) * 0.15;\n\n      var barkColor = mix(barkDark, barkMid, heightRatio * 0.7);\n      barkColor = mix(barkColor, barkLight, groove1 * 0.3);\n      let purpleUndertone = vec3f(0.08, 0.02, 0.10) * heightRatio * 0.3;\n      barkColor = barkColor + purpleUndertone;\n      let shift = (noise2 - 0.5) * 0.18;\n      barkColor = barkColor * (1.0 + shift);\n      barkColor = barkColor - knot;\n      // Seed-based hue variation: warm reddish (ts→1) to cool gray-brown (ts→0)\n      let hueShift = (ts - 0.5) * 0.10;\n      barkColor = clamp(barkColor + vec3f(hueShift, -abs(hueShift) * 0.25, -hueShift * 0.45), vec3f(0.0), vec3f(1.0));\n\n      let edgeFade = 1.0 - smoothstep(0.6, 1.0, abs(dot(cylN, normalize(vec3f(faceN.x, 0.0, faceN.z)))));\n      let cylAO = 0.7 + edgeFade * 0.3;\n      let vertAO = 0.60 + heightRatio * 0.40;\n      let trunkShade = 0.22 + cylSunLight * 0.75;\n      var trunkAlbedo = barkColor * trunkShade * grooveDepth * woodGrain * ringPattern * cylAO * vertAO * tint;\n\n      let sandSideColor = vec3f(0.78, 0.72, 0.58) * shade * tint;\n      let sideBlend = smoothstep(0.0, 0.15, heightRatio);\n      albedo = mix(sandSideColor, trunkAlbedo, sideBlend);\n\n    } else if (blockType == 3) {\n      let grassBrown = vec3f(0.28, 0.25, 0.12);\n      let grassOlive = vec3f(0.32, 0.35, 0.15);\n      var grassColor = grassMid;\n      let t = noise1;\n      if (t < 0.3) { grassColor = mix(grassBright, grassMid, t / 0.3); }\n      else if (t < 0.6) { grassColor = mix(grassMid, grassDark, (t - 0.6) / 0.3); }\n      else if (t < 0.8) { grassColor = mix(grassDark, grassBrown, (t - 0.6) / 0.2); }\n      else { grassColor = mix(grassBrown, grassOlive, (t - 0.8) / 0.2); }\n      let shift = (noise2 - 0.5) * 0.2;\n      grassColor = grassColor * (1.0 + shift);\n      albedo = grassColor * shade * tint;\n\n    } else if (blockType == 5) {\n      var branchColor = mix(barkDark, barkMid, noise1 * 0.6);\n      let grooveSide = sin(layer * 5.0 + noise1 * 3.0) * 0.08 + 0.92;\n      let bShift = (noise2 - 0.5) * 0.15;\n      branchColor = branchColor * (1.0 + bShift) * grooveSide;\n      albedo = branchColor * shade * tint;\n\n    } else {\n      let sandSide = vec3f(0.72, 0.66, 0.52);\n      let sandSideDark = vec3f(0.62, 0.56, 0.44);\n      var fallenColor = mix(sandSide, sandSideDark, noise1 * 0.5);\n      let shift = (noise2 - 0.5) * 0.12;\n      fallenColor = fallenColor * (1.0 + shift);\n      albedo = fallenColor * shade * tint;\n    }\n\n  } else {\n    let bottomTint = vec3f(0.65, 0.62, 0.58);\n    let fallenBottom = vec3f(0.50, 0.45, 0.38);\n\n    if (blockType == 0) { albedo = dirtDark * 0.5 * bottomTint; }\n    else if (blockType == 1) { albedo = sakuraDeep * 0.5 * bottomTint; }\n    else if (blockType == 2) { albedo = barkDark * 0.5 * bottomTint; }\n    else if (blockType == 3) { albedo = grassDark * 0.5 * bottomTint; }\n    else if (blockType == 5) { albedo = barkDark * 0.5 * bottomTint; }\n    else { albedo = fallenBottom * 0.6 * bottomTint; }\n  }\n\n  const viewDir = vec3f(0.398015, 0.597022, 0.696526);\n  let rimDot = 1.0 - max(dot(N, viewDir), 0.0);\n  let rimLight = pow(rimDot, 4.0) * 0.06 * vec3f(0.85, 0.75, 0.95);\n\n  let diffuse = albedo * (ambient + sunCol * NdSun * 0.85 + skyFill * NdUp * 0.18 + bounce * 0.15) + rimLight;\n  var hdr = diffuse;\n  hdr = acesFilm(hdr * 1.15);\n  hdr = pow(hdr, vec3f(1.0 / 2.2));\n\n  let grayB = dot(hdr, vec3f(0.299, 0.587, 0.114));\n  hdr = mix(vec3f(grayB), hdr, 1.25);\n\n  // Rain wet ground effect (hide in QR mode)\n  let rainVis = uniforms.rainMode * (1.0 - progress);\n  if (rainVis > 0.01 && input.faceNy > 0.5 && blockType != 1) {\n    let rainMode = rainVis;\n    // Wet specular highlight\n    let specDir = normalize(vec3f(0.4, 0.9, 0.3));\n    let viewD = normalize(vec3f(0.4, 0.6, 0.7));\n    let half = normalize(specDir + viewD);\n    let spec = pow(max(dot(N, half), 0.0), 32.0) * 0.16 * rainMode;\n    hdr = hdr + vec3f(spec);\n\n    // Darken for wetness\n    hdr = hdr * mix(1.0, 0.88, rainMode);\n\n    // Ripple rings on ground blocks\n    if (blockType == 0 || blockType == 3 || blockType == 4) {\n      let rippleCenter1 = vec2f(input.col + sin(uniforms.time * 1.3 + noise1 * 5.0) * 3.0,\n                                 input.row + cos(uniforms.time * 1.1 + noise2 * 4.0) * 3.0);\n      let rippleCenter2 = vec2f(input.col + sin(uniforms.time * 0.9 + noise2 * 7.0) * 4.0,\n                                 input.row + cos(uniforms.time * 1.5 + noise1 * 3.0) * 4.0);\n      let rd1 = length(vec2f(input.col, input.row) - rippleCenter1);\n      let rd2 = length(vec2f(input.col, input.row) - rippleCenter2);\n      let ripple1 = sin(rd1 * 4.0 - uniforms.time * 6.0) * 0.5 + 0.5;\n      let ripple2 = sin(rd2 * 3.5 - uniforms.time * 5.0) * 0.5 + 0.5;\n      let rippleIntensity = (smoothstep(0.4, 0.6, ripple1) + smoothstep(0.4, 0.6, ripple2)) * 0.015 * rainMode;\n      hdr = hdr + vec3f(rippleIntensity * 0.8, rippleIntensity * 0.85, rippleIntensity);\n    }\n  }\n\n  return vec4f(hdr, 1.0);\n}\n",
                depthWrite: !0,
                depthCompare: "less",
              }),
              flowerPipeline = createScenePipeline(gpuDeviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
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
            let branchPipeline = null;
            try {
              branchPipeline = createScenePipeline(gpuDeviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
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
                  "\n\n@fragment\nfn main(input: BranchInput) -> @location(0) vec4f {\n  let N = normalize(vec3f(input.normalX, input.normalY, input.normalZ));\n  let depth = input.depth;\n  let seed = input.vSeed;\n  let t = input.ringT;\n\n  let barkBase  = vec3f(0.28, 0.16, 0.10);\n  let barkLight = vec3f(0.40, 0.26, 0.18);\n  let barkDark  = vec3f(0.16, 0.09, 0.05);\n  let barkHighlight = vec3f(0.50, 0.34, 0.24);\n\n  let depthT = min(depth / 5.0, 1.0);\n  var bark = mix(barkBase, barkLight, depthT * 0.5);\n  bark = mix(bark, barkHighlight, depthT * depthT * 0.2);\n\n  let noise1 = fract(sin(seed * 43.7 + depth * 17.3) * 43758.5);\n  let noise2 = fract(sin(seed * 73.1 + depth * 31.1 + 127.1) * 43758.5);\n\n  let grooveAngle = fract(sin(seed * 127.1 + t * 31.1) * 43758.5) * 6.28;\n  let groove1 = sin(grooveAngle * 8.0 + noise1 * 3.0) * 0.5 + 0.5;\n  let groove2 = sin(grooveAngle * 14.0 + noise2 * 5.0 + 1.7) * 0.5 + 0.5;\n  let groove3 = sin(grooveAngle * 22.0 + noise1 * 7.0) * 0.5 + 0.5;\n  let grooveEffect = (groove1 * 0.5 + groove2 * 0.3 + groove3 * 0.2) * 0.18 + 0.82;\n\n  let ring = sin(t * 18.0 + noise2 * 6.0) * 0.07 + 0.93;\n\n  let knotNoise = sin(seed * 47.3 + t * 13.0 + noise1 * 8.0);\n  let knot = smoothstep(0.88, 0.95, knotNoise) * 0.10;\n\n  let colorShift = (noise1 - 0.5) * 0.12;\n  bark = bark * (1.0 + colorShift) * grooveEffect * ring - knot;\n\n  // Winter snow settles only on upward-facing branch surfaces.\n  if (uniforms.season > 2.5) {\n    let snowCover = smoothstep(.12, .78, N.y) * (.76 + noise1 * .18);\n    bark = mix(bark, vec3f(.88, .92, .94), snowCover);\n  }\n\n  const sunDir = vec3f(-0.405616, 0.861934, -0.304212);\n  let sunCol = vec3f(1.20, 1.20, 1.20);\n  let ambient = vec3f(0.25, 0.25, 0.28);\n  let NdotL = max(dot(N, sunDir), 0.0);\n\n  let NdotLBack = max(dot(-N, sunDir), 0.0);\n  let sss = NdotLBack * depthT * 0.06 * vec3f(0.6, 0.3, 0.2);\n\n  let skyFill = vec3f(0.85, 0.80, 0.90);\n  let skyContrib = max(N.y, 0.0) * 0.08 * skyFill;\n\n  let ao = 0.75 + depthT * 0.25;\n\n  let lit = bark * (ambient + sunCol * NdotL * 0.82) * ao + sss + skyContrib;\n\n  let hdr = acesFilm(lit * 1.05);\n  var ldr = pow(hdr, vec3f(1.0 / 2.2));\n\n  let gray = dot(ldr, vec3f(0.299, 0.587, 0.114));\n  ldr = mix(vec3f(gray), ldr, 1.25);\n\n  return vec4f(ldr, 1.0);\n}\n",
                depthWrite: !0,
                depthCompare: "less",
              });
            } catch (errorAt5cbaae) {
              console.error("Branch pipeline failed (non-fatal):", errorAt5cbaae);
            }
            let grassPipeline = null;
            try {
              grassPipeline = createScenePipeline(gpuDeviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
                vertex:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct GrassOutput {\n  @builtin(position) position: vec4f,\n  @location(0) greenT: f32,\n  @location(1) normalY: f32,\n  @location(2) seed: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n@group(0) @binding(1) var<storage, read> grassData: array<vec4f>;\n\nconst PI: f32 = 3.14159265;\n\n@vertex\nfn main(@builtin(vertex_index) vertexIndex: u32) -> GrassOutput {\n  var output: GrassOutput;\n\n  let bladeIdx = vertexIndex / 3u;\n  let vertIdx = vertexIndex % 3u;\n\n  let grassCount = u32(uniforms.blockCount);\n  if (bladeIdx >= grassCount) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let progress = uniforms.progress;\n  let vis = smoothstep(0.0, 0.3, 1.0 - progress);\n  if (vis < 0.01) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    return output;\n  }\n\n  let data = grassData[bladeIdx];\n  let col = data.x;\n  let row = data.y;\n  let seed = data.z;\n  let bladeHeight = data.w * vis;\n\n  output.seed = seed;\n\n  let blockSize = f32(" +
                  WGSL_BLOCK_SIZE +
                  ");\n  let gridSize = uniforms.gridSize;\n  let halfGrid = gridSize * blockSize * 0.5;\n\n  let baseX = col * blockSize - halfGrid;\n  let baseY = 0.0;\n  let baseZ = row * blockSize - halfGrid;\n\n  let angle = seed * PI * 2.0;\n  let cosA = cos(angle);\n  let sinA = sin(angle);\n\n  let halfWidth = blockSize * 0.22;\n\n  var localPos = vec3f(0.0);\n\n  let tiltX = (seed - 0.5) * 0.4;\n  let tiltZ = (fract(seed * 7.13) - 0.5) * 0.4;\n  let time = uniforms.time;\n  let windBase = sin(time * 0.45 + col * 0.25 + row * 0.15) * 0.02;\n  let windTurb = sin(time * 1.1 + col * 0.8 + row * 0.6) * 0.005;\n  let windX = windBase + windTurb;\n  let windZ = sin(time * 0.35 + col * 0.15 + row * 0.25) * 0.012;\n  let tipOffX = (tiltX + windX) * bladeHeight * 4.0;\n  let tipOffZ = (tiltZ + windZ) * bladeHeight * 4.0;\n\n  let yLift = blockSize * 1.0;\n\n  if (vertIdx == 0u) {\n    localPos = vec3f(baseX - halfWidth * cosA, baseY + yLift, baseZ - halfWidth * sinA);\n    output.greenT = 0.0;\n    output.normalY = 0.3;\n  } else if (vertIdx == 1u) {\n    localPos = vec3f(baseX + halfWidth * cosA, baseY + yLift, baseZ + halfWidth * sinA);\n    output.greenT = 0.0;\n    output.normalY = 0.3;\n  } else {\n    let curlDroop = bladeHeight * seed * 0.15;\n    localPos = vec3f(baseX + tipOffX, baseY + yLift + bladeHeight - curlDroop, baseZ + tipOffZ);\n    output.greenT = 1.0;\n    output.normalY = 0.9;\n  }\n\n  " +
                  createIsometricTransformWgsl() +
                  "\n  \n  output.position = vec4f(\n    (ry_x + xOffsetScene) * scaleX,\n    (rx_y + yOffsetScene) * scaleY,\n    rx_z * 0.01 + 0.5,\n    1.0\n  );\n\n\n  return output;\n}\n",
                fragment:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct GrassInput {\n  @location(0) greenT: f32,\n  @location(1) normalY: f32,\n  @location(2) seed: f32,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n\n" +
                  WGSL_ACES_FILM +
                  "\n\n@fragment\nfn main(input: GrassInput) -> @location(0) vec4f {\n  let season = uniforms.season;\n\n  var darkGreen  = vec3f(0.12, 0.32, 0.06);\n  var midGreen   = vec3f(0.22, 0.48, 0.12);\n  var lightGreen = vec3f(0.35, 0.58, 0.20);\n  var coralPink  = vec3f(0.65, 0.28, 0.30);\n  var dustyRose  = vec3f(0.55, 0.32, 0.28);\n  var mossGreen  = vec3f(0.30, 0.40, 0.15);\n  var yellowFlower = vec3f(0.75, 0.68, 0.20);\n  var whiteFlower = vec3f(0.88, 0.86, 0.78);\n  var lavender = vec3f(0.55, 0.42, 0.62);\n\n  if (season > 0.5 && season < 1.5) {\n    darkGreen  = vec3f(0.03, 0.16, 0.01);\n    midGreen   = vec3f(0.08, 0.28, 0.02);\n    lightGreen = vec3f(0.16, 0.38, 0.04);\n    mossGreen  = vec3f(0.10, 0.22, 0.02);\n    coralPink  = vec3f(0.12, 0.28, 0.03);\n    dustyRose  = vec3f(0.08, 0.22, 0.02);\n    yellowFlower = vec3f(0.44, 0.48, 0.10);\n    whiteFlower = vec3f(0.58, 0.64, 0.42);\n    lavender = vec3f(0.18, 0.30, 0.08);\n  } else if (season > 1.5 && season < 2.5) {\n    darkGreen  = vec3f(0.42, 0.24, 0.08);\n    midGreen   = vec3f(0.56, 0.32, 0.10);\n    lightGreen = vec3f(0.70, 0.42, 0.12);\n    mossGreen  = vec3f(0.50, 0.30, 0.08);\n    coralPink  = vec3f(0.62, 0.26, 0.10);\n    dustyRose  = vec3f(0.55, 0.28, 0.12);\n    yellowFlower = vec3f(0.76, 0.52, 0.14);\n    whiteFlower = vec3f(0.74, 0.62, 0.42);\n    lavender = vec3f(0.52, 0.32, 0.18);\n  }\n\n  let tier = fract(input.seed * 7.31);\n  var baseColor: vec3f;\n  var tipColor: vec3f;\n  if (tier < 0.22) { baseColor = darkGreen; tipColor = midGreen; }\n  else if (tier < 0.42) { baseColor = midGreen; tipColor = lightGreen; }\n  else if (tier < 0.55) { baseColor = mossGreen; tipColor = lightGreen; }\n  else if (tier < 0.68) { baseColor = dustyRose; tipColor = coralPink; }\n  else if (tier < 0.76) { baseColor = coralPink; tipColor = vec3f(0.72, 0.35, 0.35); }\n  else if (tier < 0.84) { baseColor = midGreen; tipColor = yellowFlower; }\n  else if (tier < 0.92) { baseColor = mossGreen; tipColor = whiteFlower; }\n  else { baseColor = dustyRose; tipColor = lavender; }\n\n  let color = mix(baseColor, tipColor, input.greenT);\n\n  const sunDir = vec3f(-0.405616, 0.861934, -0.304212);\n  let N = normalize(vec3f(0.0, input.normalY, 0.3));\n  let NdotL = max(dot(N, sunDir), 0.0);\n  let ambient = vec3f(0.22, 0.24, 0.18);\n  let sunCol = vec3f(1.20, 1.20, 1.20);\n\n  let lit = color * (ambient + sunCol * NdotL * 0.85);\n\n  let hdr = acesFilm(lit * 1.1);\n  var ldr = pow(hdr, vec3f(1.0 / 2.2));\n\n  let gray = dot(ldr, vec3f(0.299, 0.587, 0.114));\n  ldr = mix(vec3f(gray), ldr, 1.6);\n\n  return vec4f(ldr, 1.0);\n}\n",
                depthWrite: !0,
                depthCompare: "less",
              });
            } catch (errorAt2e8e5b) {
              console.error("Grass pipeline failed (non-fatal):", errorAt2e8e5b);
            }
            let fallingPetalPipeline = null;
            try {
              fallingPetalPipeline = createScenePipeline(gpuDeviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
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
            } catch (errorAt64cb2c) {
              console.error(
                "Falling petal pipeline failed (non-fatal):",
                errorAt64cb2c,
              );
            }
            let rainPipeline = null;
            try {
              rainPipeline = createScenePipeline(gpuDeviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
                vertex:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct RainOutput {\n  @builtin(position) position: vec4f,\n  @location(0) alpha: f32,\n  @location(1) particleUv: vec2f,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n@group(0) @binding(1) var<storage, read> rainData: array<vec4f>;\n\n@vertex\nfn main(@builtin(vertex_index) vertexIndex: u32) -> RainOutput {\n  var output: RainOutput;\n\n  let vertsPerDrop = 6u;\n  let dropIdx = vertexIndex / vertsPerDrop;\n  let localVert = vertexIndex % vertsPerDrop;\n\n  let count = u32(uniforms.blockCount);\n  if (dropIdx >= count) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    output.alpha = 0.0;\n    output.particleUv = vec2f(0.0);\n    return output;\n  }\n\n  let progress = uniforms.progress;\n  let vis = smoothstep(0.0, 0.3, 1.0 - progress) * uniforms.rainMode;\n  if (vis < 0.01) {\n    output.position = vec4f(0.0, 0.0, -10.0, 1.0);\n    output.alpha = 0.0;\n    output.particleUv = vec2f(0.0);\n    return output;\n  }\n\n  let data = rainData[dropIdx];\n  let blockSize = f32(" +
                  WGSL_BLOCK_SIZE +
                  ");\n  let halfGrid = uniforms.gridSize * blockSize * 0.5;\n  let time = uniforms.time;\n  let winter = step(2.5, uniforms.season);\n  let fallSpeed = mix(1.5 + data.w, .35 + data.w * .20, winter);\n  let cycleT = fract((time * fallSpeed + data.z * 10.0) * mix(.3, .08, winter));\n  let dropY = mix(blockSize * 45.0, blockSize * .5, cycleT);\n\n  let quadVerts = array<vec2f, 6>(\n    vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 1.0),\n    vec2f(-1.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)\n  );\n  let qv = quadVerts[localVert];\n  let flakeUv = qv * 2.0 - vec2f(1.0);\n  output.particleUv = flakeUv;\n\n  let rainOffset = vec2f(qv.x * blockSize * .06, qv.y * blockSize * (2.5 + data.w * 1.5));\n  let snowOffset = flakeUv * blockSize * (.13 + data.w * .12);\n  let offset = mix(rainOffset, snowOffset, winter);\n  let driftX = mix(.015 * cycleT, sin(time * .55 + data.w * 12.0) * blockSize * .55, winter);\n  let driftZ = mix(.008 * cycleT, cos(time * .40 + data.z * 9.0) * blockSize * .25, winter);\n  let fadeTop = smoothstep(0.0, .1, cycleT);\n  let fadeBot = 1.0 - smoothstep(.85, 1.0, cycleT);\n  output.alpha = fadeTop * fadeBot * vis * mix(.06 + data.w * .05, .60 + data.w * .25, winter);\n\n  var localPos = vec3f(\n    data.x * blockSize - halfGrid + driftX + offset.x,\n    dropY + offset.y,\n    data.y * blockSize - halfGrid + driftZ\n  );\n\n  " +
                  createIsometricTransformWgsl() +
                  "\n  output.position = vec4f(\n    (ry_x + xOffsetScene) * scaleX,\n    (rx_y + yOffsetScene) * scaleY,\n    rx_z * 0.01 + 0.5,\n    1.0\n  );\n\n  return output;\n}\n",
                fragment:
                  "\n" +
                  SCENE_UNIFORM_WGSL +
                  "\n\nstruct RainInput {\n  @location(0) alpha: f32,\n  @location(1) particleUv: vec2f,\n}\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n\n@fragment\nfn main(input: RainInput) -> @location(0) vec4f {\n  let winter = step(2.5, uniforms.season);\n  let snowEdge = 1.0 - smoothstep(.72, 1.0, length(input.particleUv));\n  let alpha = input.alpha * mix(1.0, snowEdge, winter);\n  if (alpha < 0.01) { discard; }\n  let color = mix(vec3f(.72, .78, .9), vec3f(.88, .93, 1.0), winter);\n  return vec4f(color * alpha, alpha);\n}\n",
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
              });
            } catch (errorAt9a8b5f) {
              console.error("Rain pipeline failed (non-fatal):", errorAt9a8b5f);
            }
            let butterflyPipeline = null;
            try {
              butterflyPipeline = createScenePipeline(gpuDeviceAt354206, textureFormat, sceneBindGroupLayoutAt3d73c0, {
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
            const blur = createTransitionBlur(gpuDeviceAt354206, textureFormat, blurUniformBuffer, renderTargets.sceneTextureView),
              blurPipeline = blur.pipeline,
              blurBindGroup = blur.bindGroup;
            return {
              device: gpuDeviceAt354206,
              context: gpuContext,
              buffers: {
                blockUniforms: blurUniformBuffer,
                branchUniforms: branchUniformBuffer,
                grassUniforms: grassUniformBuffer,
                petalUniforms: petalUniformBuffer,
                typeBuffer: blockTypeBuffer,
                posBuffer: positionBuffer,
                heightBuffer: heightBuffer,
                baseYBuffer: baseYBuffer,
                flowerBuffer: flowerBuffer,
                branchBuffer: branchBuffer,
                grassBuffer: grassBuffer,
                fallingPetalBuffer: fallingPetalBuffer,
                rainUniforms: rainUniformBuffer,
                rainBuffer: rainBuffer,
                butterflyUniforms: butterflyUniformBuffer,
                butterflyBuffer: butterflyBuffer,
              },
              pipelines: {
                sky: skyPipeline,
                shadow: shadowPipeline,
                blocks: blocksPipeline,
                flowers: flowerPipeline,
                branches: branchPipeline,
                grass: grassPipeline,
                fallingPetals: fallingPetalPipeline,
                rain: rainPipeline,
                butterflies: butterflyPipeline,
                blur: blurPipeline,
              },
              bindGroups: {
                sky: skyShadowBindGroup,
                shadow: skyShadowBindGroup,
                blocks: blocksBindGroup,
                flowers: flowerBindGroup,
                branches: branchBindGroup,
                grass: grassBindGroup,
                fallingPetals: fallingPetalBindGroup,
                rain: rainBindGroup,
                butterflies: butterflyBindGroup,
                blur: blurBindGroup,
              },
              renderTargets,
              get depthTextureView() { return renderTargets.depthTextureView; },
              get sceneTextureView() { return renderTargets.sceneTextureView; },
              blur,
              aspectRatio: sceneCanvasAt56169d.width / sceneCanvasAt56169d.height,
              gpuSurface,
              qrRenderer,
              isMobile:
                "ontouchstart" in globalThis || navigator.maxTouchPoints > 0,
              counts: {
                numBlocks: 0,
                gridSize: 0,
                flowerCount: 0,
                segmentCount: 0,
                grassCount: 0,
                petalCount: 0,
                rainCount: 0,
                butterflyCount: 0,
              },
              _uniformArr: new Float32Array(16),
              _branchUpload: new Float32Array(6e3),
              _flowerUpload: new Float32Array(4e5),
              _petalUpload: new Float32Array(40),
              _rainUpload: new Float32Array(2e3),
              _butterflyUpload: new Float32Array(40),
            };
          })(sceneCanvasAt207726, canvasWidth, canvasHeightAt41144e);
          if (!rendererAtf2509b) return;
          ((rendererRef.current = rendererAtf2509b), (renderedCanvasRef.current = sceneCanvasAt207726));
          const qrMatrixAt529187 = buildQrMatrix(qrContentRef.current),
            voxelBlocksAt508cc4 = createVoxelBlocks(qrMatrixAt529187),
            treeSettingsAt4c4fbc = analyzeQrMatrix(qrMatrixAt529187);
          ((qrMatrixRef.current = qrMatrixAt529187),
            (treeSettingsRef.current = treeSettingsAt4c4fbc),
            (gridSizeRef.current = voxelBlocksAt508cc4.gridSize),
            setNoiseSeed(hashSeed(treeSeedRef.current)));
          const treeBranchesAt2fca02 = createTreeBranches(treeSettingsAt4c4fbc, voxelBlocksAt508cc4.gridSize),
            canopyFlowers = generateCanopyFlowers(treeBranchesAt2fca02.tips, treeSettingsAt4c4fbc),
            qrFlowers = generateQrFlowers(qrMatrixAt529187),
            grassDataAt4664b9 = generateGrass(voxelBlocksAt508cc4.gridSize, qrMatrixAt529187),
            fallingPetalsAt45610b = generateFallingPetals(
              treeBranchesAt2fca02.tips,
              voxelBlocksAt508cc4.gridSize,
            ),
            rainDataAt2a5e57 = generateRain(voxelBlocksAt508cc4.gridSize),
            butterflyData = generateButterflies(voxelBlocksAt508cc4.gridSize);
          (uploadSceneData(
            rendererAtf2509b,
            voxelBlocksAt508cc4,
            treeBranchesAt2fca02,
            canopyFlowers,
            qrFlowers.positions,
            qrFlowers.count,
            grassDataAt4664b9,
            fallingPetalsAt45610b,
            rainDataAt2a5e57,
            butterflyData,
          ),
            (lastRenderedQrContentRef.current = qrContentRef.current));
          let previousSeason = -1,
            previousCustomColorKey = "",
            previousQrContent = "",
            previousSnapshotWidth = 0,
            previousSnapshotHeight = 0,
            snapshotPending = !1;
          const refreshQrSnapshot = () => {
            if (!qrSnapshotRef) return;
            if (lastRenderedQrContentRef.current !== qrContentRef.current) return;
            const customColorKey = customColorRef.current.join(","),
              canvasWidthAt33e9ea = sceneCanvasAt207726.width,
              canvasHeight = sceneCanvasAt207726.height,
              snapshotSizeChanged = previousSnapshotWidth !== canvasWidthAt33e9ea || previousSnapshotHeight !== canvasHeight,
              snapshotStateChanged =
                previousSeason !== seasonRef.current ||
                previousCustomColorKey !== customColorKey ||
                previousQrContent !== qrContentRef.current;
            if (!snapshotSizeChanged && !snapshotStateChanged && !snapshotPending) return;
            if (snapshotSizeChanged && previousSnapshotWidth > 0)
              return (
                (previousSnapshotWidth = canvasWidthAt33e9ea),
                (previousSnapshotHeight = canvasHeight),
                (qrSnapshotRef.current = ""),
                onQrSnapshotUpdated?.current?.(""),
                void (snapshotPending = !0)
              );
            ((snapshotPending = !1),
              (previousSeason = seasonRef.current),
              (previousCustomColorKey = customColorKey),
              (previousQrContent = qrContentRef.current),
              (previousSnapshotWidth = canvasWidthAt33e9ea),
              (previousSnapshotHeight = canvasHeight));
            const rainMode = seasonRef.current >= 2 ? 1 : 0;
            drawTreeScene(rendererAtf2509b, {
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
              rainMode: rainMode,
              trunkSeed: trunkSeed,
            });
            const snapshotCanvas = document.createElement("canvas");
            ((snapshotCanvas.width = canvasWidthAt33e9ea), (snapshotCanvas.height = canvasHeight));
            const snapshotContext = snapshotCanvas.getContext("2d");
            if (snapshotContext) {
              snapshotContext.drawImage(sceneCanvasAt207726, 0, 0);
              const qrSnapshotDataUrl = snapshotCanvas.toDataURL("image/png");
              ((qrSnapshotRef.current = qrSnapshotDataUrl),
                onQrSnapshotUpdated?.current?.(qrSnapshotDataUrl));
            }
          };
          setTimeout(refreshQrSnapshot, 50);
          let lastFlatSettledState = !1;
          const frame = () => {
            const nowMilliseconds = Date.now(),
              deltaSeconds = Math.min((nowMilliseconds - lastFrameTimeRef.current) / 1e3, 0.05);
            lastFrameTimeRef.current = nowMilliseconds;
            const targetFlatState = isFlatRef.current ? 1 : 0;
            var transitionProgress;
            ((transitionProgressRef.current +=
              (targetFlatState - transitionProgressRef.current) * Math.min(1, 3.5 * deltaSeconds)),
              Math.abs(transitionProgressRef.current - targetFlatState) < 0.001 &&
                (transitionProgressRef.current = targetFlatState),
              (easedTransitionProgressRef.current =
                (transitionProgress = transitionProgressRef.current) < 0.5
                  ? 4 * transitionProgress * transitionProgress * transitionProgress
                  : 1 - (-2 * transitionProgress + 2) ** 3 / 2));
            const flatSettled = transitionProgressRef.current >= 0.9 && 1 === targetFlatState;
            flatSettled !== lastFlatSettledState &&
              ((lastFlatSettledState = flatSettled), onFlatSettled?.current?.(flatSettled));
            const sceneTime = (nowMilliseconds - sceneStartTimeRef.current) / 1e3,
              transitionProgressAt58e226 = easedTransitionProgressRef.current,
              treeVisibility = 1 - transitionProgressAt58e226,
              burstElapsedTime = sceneTime - burstStartTimeRef.current,
              burstCameraBobY =
                Math.exp(6 * -burstElapsedTime) * Math.sin(12 * burstElapsedTime) * 0.008,
              cameraBobX = 0.003 * Math.sin(0.15 * sceneTime) * treeVisibility,
              cameraBobY =
                0.002 * Math.sin(0.11 * sceneTime + 1) * treeVisibility + burstCameraBobY;
            isFlatRef.current !== previousFlatState.current &&
              ((previousFlatState.current = isFlatRef.current),
              (burstStartTimeRef.current = sceneTime));
            const targetRainMode = seasonRef.current >= 2 ? 1 : 0;
            if (
              ((rainTransition.current +=
                (targetRainMode - rainTransition.current) * Math.min(1, 3 * deltaSeconds)),
              Math.abs(rainTransition.current - targetRainMode) < 0.001 &&
                (rainTransition.current = targetRainMode),
              seasonRef.current !== previousSeasonRef.current && treeSettingsRef.current)
            ) {
              ((previousSeasonRef.current = seasonRef.current),
                setNoiseSeed(hashSeed(treeSeedRef.current)));
              const treeSettingsAt35f428 = treeSettingsRef.current,
                treeGridSize = gridSizeRef.current,
                treeBranchesAt562ec3 = createTreeBranches(treeSettingsAt35f428, treeGridSize),
                canopyFlowersAt3fa020 = generateCanopyFlowers(treeBranchesAt562ec3.tips, treeSettingsAt35f428),
                qrFlowersAt350191 = generateQrFlowers(qrMatrixRef.current),
                fallingPetalsAt3d438e = generateFallingPetals(treeBranchesAt562ec3.tips, treeGridSize);
              !(function (
                renderer,
                treeBranches,
                canopyFlowersUpload,
                qrFlowerPositions,
                qrFlowerCount,
                fallingPetalsAt30ab7f,
              ) {
                const { device: gpuDeviceAt3f4ff5, buffers: buffersAt4d9529 } = renderer,
                  branchUpload = renderer._branchUpload;
                (branchUpload.fill(0),
                  branchUpload.set(treeBranches.segments),
                  gpuDeviceAt3f4ff5.queue.writeBuffer(
                    buffersAt4d9529.branchBuffer,
                    0,
                    branchUpload,
                  ),
                  (renderer.counts.segmentCount = treeBranches.segmentCount));
                const totalFlowerCount = canopyFlowersUpload.count + qrFlowerCount,
                  flowerUploadAt3b5a65 = renderer._flowerUpload;
                (flowerUploadAt3b5a65.fill(0), flowerUploadAt3b5a65.set(canopyFlowersUpload.positions));
                for (let qrFlowerValueIndex = 0; qrFlowerValueIndex < 4 * qrFlowerCount; qrFlowerValueIndex++)
                  flowerUploadAt3b5a65[4 * canopyFlowersUpload.count + qrFlowerValueIndex] =
                    qrFlowerPositions[qrFlowerValueIndex];
                (gpuDeviceAt3f4ff5.queue.writeBuffer(
                  buffersAt4d9529.flowerBuffer,
                  0,
                  flowerUploadAt3b5a65,
                ),
                  (renderer.counts.flowerCount = totalFlowerCount));
                const petalUpload = renderer._petalUpload;
                (petalUpload.fill(0),
                  petalUpload.set(fallingPetalsAt30ab7f.positions),
                  gpuDeviceAt3f4ff5.queue.writeBuffer(
                    buffersAt4d9529.fallingPetalBuffer,
                    0,
                    petalUpload,
                  ),
                  (renderer.counts.petalCount = fallingPetalsAt30ab7f.count));
              })(
                rendererAtf2509b,
                treeBranchesAt562ec3,
                canopyFlowersAt3fa020,
                qrFlowersAt350191.positions,
                qrFlowersAt350191.count,
                fallingPetalsAt3d438e,
              );
            }
            refreshQrSnapshot();
            drawTreeScene(rendererAtf2509b, {
                time: sceneTime,
                progress: transitionProgressAt58e226,
                season: seasonRef.current,
                cameraBobX: cameraBobX,
                cameraBobY: cameraBobY,
                burstTime: burstStartTimeRef.current,
                customR: customColorRef.current[0],
                customG: customColorRef.current[1],
                customB: customColorRef.current[2],
                customStrength: customColorRef.current[3],
                rainMode: rainTransition.current,
                trunkSeed: trunkSeed,
              });
          };
          frameLoopRef.current = createFrameLoop(frame);
          frameLoopRef.current.start();
        } catch (error) {
          console.error("WebGPU init failed:", error);
        } finally {
          rendererInitializing.current = !1;
        }
      };
      (runSetup(() => {
        const initializeRendererTimeout = setTimeout(initializeRenderer, 100);
        return () => {
          clearTimeout(initializeRendererTimeout);
        };
      }),
        runSetup(() => {
          const sceneCanvasAt26b053 = canvasRef.current;
          !sceneCanvasAt26b053 ||
            canvasWidth <= 0 ||
            canvasHeightAt41144e <= 0 ||
            (rendererRef.current &&
              renderedCanvasRef.current !== sceneCanvasAt26b053 &&
              (frameLoopRef.current &&
                (frameLoopRef.current.stop(),
                (frameLoopRef.current = null)),
              (rendererRef.current = null),
              (renderedCanvasRef.current = null),
              (sceneStartTimeRef.current = Date.now()),
              (lastFrameTimeRef.current = Date.now())),
            rendererRef.current || initializeRenderer());
        }),
        runSetup(() => {
          const activeRenderer = rendererRef.current,
            sceneCanvasElement = canvasRef.current;
          activeRenderer &&
            sceneCanvasElement &&
            (canvasWidth <= 0 ||
              canvasHeightAt41144e <= 0 ||
              (function (rendererState) {
                if (!rendererState.renderTargets.resize()) return;
                rendererState.bindGroups.blur = rendererState.blur.createBindGroup(rendererState.sceneTextureView);
                rendererState.aspectRatio = gpuSurface.width / gpuSurface.height;
              })(activeRenderer));
        }),
        runSetup(() => () => {
          frameLoopRef.current?.stop();
        }));
    })({
    canvasRef,
    canvasWidth,
    canvasHeight,
    qrContent,
    isFlat,
    seasonRef,
    customColorRef,
    treeSeed,
    qrSnapshotRef: null,
    onFlatSettled: null,
    onQrSnapshotUpdated: null,
  });
}

export const SCENE = createSceneModule({
  id: "three",
  settings: {
    seasons: ["spring", "summer", "autumn", "winter"],
    defaultSeason: "spring",
  },
  createRuntime: options => createSceneRuntime(options, setupTreeRuntime),
});
