export const SCENE_UNIFORM_WGSL = `
struct Uniforms {
  aspectRatio: f32, time: f32, blockCount: f32, progress: f32,
  gridSize: f32, cameraBobX: f32, cameraBobY: f32, season: f32,
  burstTime: f32, customR: f32, customG: f32, customB: f32,
  customStrength: f32, rainMode: f32, trunkSeed: f32, beachSeason: f32,
}
`;

export function createIsometricTransformWgsl(position = "localPos") {
  return `
  let isoAngleY = mix(0.78, 0, uniforms.progress) + uniforms.cameraBobX;
  let isoAngleX = mix(-0.55, -1.5708, uniforms.progress) + uniforms.cameraBobY;
  let cy = cos(isoAngleY); let sy = sin(isoAngleY);
  let cx = cos(isoAngleX); let sx = sin(isoAngleX);
  let ry_x = ${position}.x * cy - ${position}.z * sy;
  let ry_z = ${position}.x * sy + ${position}.z * cy;
  let rx_y = ${position}.y * cx - ry_z * sx;
  let rx_z = ${position}.y * sx + ry_z * cx;
  let portraitBoost = select(1.0, 1.2, uniforms.aspectRatio < 0.8);
  let viewScale = (mix(37.70, 46.40, uniforms.progress) / uniforms.gridSize) * portraitBoost;
  let ar = uniforms.aspectRatio;
  let scaleX = viewScale / max(ar, 1.0);
  let scaleY = viewScale / max(1.0 / ar, 1.0);
  let yOffsetScene = mix(-0.06, 0.08, uniforms.progress);
  let xOffsetScene = mix(0.0, 0.015, uniforms.progress);
`;
}
