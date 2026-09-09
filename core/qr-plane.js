export const QR_MODULE_VERTEX_COUNT = 36;

// Geometria procedurale realmente usata dal vertex shader: un cubo per modulo QR.
export const QR_MODULE_VERTEX_WGSL = /* wgsl */ `
  let moduleIndex = vertexIndex / 36u;
  let faceIndex = (vertexIndex % 36u) / 6u;
  let corner = array<vec2f, 6>(vec2f(0., 0.), vec2f(1., 0.), vec2f(0., 1.), vec2f(0., 1.), vec2f(1., 0.), vec2f(1., 1.))[vertexIndex % 6u];
  let column = f32(moduleIndex % u32(uniforms.gridSize));
  let row = f32(moduleIndex / u32(uniforms.gridSize));
  let halfGrid = uniforms.gridSize * uniforms.blockSize * .5;
  let baseX = column * uniforms.blockSize - halfGrid;
  let baseZ = row * uniforms.blockSize - halfGrid;
  let halfBlock = uniforms.blockSize * .5;
  var localPosition = vec3f(0.);
  var normal = vec3f(0.);
  if (faceIndex == 0u) {
    localPosition = vec3f(baseX + (corner.x - .5) * uniforms.blockSize, uniforms.blockSize, baseZ + (corner.y - .5) * uniforms.blockSize); normal = vec3f(0., 1., 0.);
  } else if (faceIndex == 1u) {
    localPosition = vec3f(baseX + (corner.x - .5) * uniforms.blockSize, 0., baseZ + (.5 - corner.y) * uniforms.blockSize); normal = vec3f(0., -1., 0.);
  } else if (faceIndex == 2u) {
    localPosition = vec3f(baseX + (corner.x - .5) * uniforms.blockSize, corner.y * uniforms.blockSize, baseZ + halfBlock); normal = vec3f(0., 0., 1.);
  } else if (faceIndex == 3u) {
    localPosition = vec3f(baseX + (.5 - corner.x) * uniforms.blockSize, corner.y * uniforms.blockSize, baseZ - halfBlock); normal = vec3f(0., 0., -1.);
  } else if (faceIndex == 4u) {
    localPosition = vec3f(baseX + halfBlock, corner.y * uniforms.blockSize, baseZ + (corner.x - .5) * uniforms.blockSize); normal = vec3f(1., 0., 0.);
  } else {
    localPosition = vec3f(baseX - halfBlock, corner.y * uniforms.blockSize, baseZ + (.5 - corner.x) * uniforms.blockSize); normal = vec3f(-1., 0., 0.);
  }`;
