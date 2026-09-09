export const SCENE_TRANSFORM_WGSL = /* wgsl */ `
fn projectScenePosition(localPosition: vec3f) -> vec4f {
  let yaw = mix(uniforms.yaw, uniforms.flatYaw, uniforms.progress);
  let pitch = mix(uniforms.pitch, uniforms.flatPitch, uniforms.progress);
  let cosineYaw = cos(yaw); let sineYaw = sin(yaw);
  let cosinePitch = cos(pitch); let sinePitch = sin(pitch);
  let rotatedX = localPosition.x * cosineYaw - localPosition.z * sineYaw;
  let rotatedZ = localPosition.x * sineYaw + localPosition.z * cosineYaw;
  let rotatedY = localPosition.y * cosinePitch - rotatedZ * sinePitch;
  let depth = localPosition.y * sinePitch + rotatedZ * cosinePitch;
  let boost = select(1., uniforms.portraitBoost, uniforms.aspectRatio < .8);
  let scale = mix(uniforms.viewScale, uniforms.flatViewScale, uniforms.progress) / uniforms.gridSize * boost;
  let offsetX = mix(uniforms.offsetX, uniforms.flatOffsetX, uniforms.progress);
  let offsetY = mix(uniforms.offsetY, uniforms.flatOffsetY, uniforms.progress);
  return vec4f((rotatedX + offsetX) * scale / max(uniforms.aspectRatio, 1.), (rotatedY + offsetY) * scale / max(1. / uniforms.aspectRatio, 1.), depth * .01 + .5, 1.);
}`;
