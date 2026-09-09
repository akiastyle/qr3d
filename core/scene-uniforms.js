export function writeSceneUniforms(renderer, base, targets) {
  const values = renderer._uniformArr;
  const defaults = renderer.uniformDefaults;
  for (const { buffer, count, overrides } of targets) {
    const blockCount = typeof count === "string" ? renderer.counts[count] : count;
    values[0] = renderer.aspectRatio;
    values[1] = defaults?.time ?? base.time ?? 0;
    values[2] = blockCount;
    values[3] = defaults?.progress ?? base.progress ?? 0;
    values[4] = renderer.counts.gridSize;
    values[5] = defaults?.cameraBobX ?? base.cameraBobX ?? 0;
    values[6] = defaults?.cameraBobY ?? base.cameraBobY ?? 0;
    values[7] = overrides?.season ?? defaults?.season ?? base.season ?? 0;
    values[8] = defaults?.burstTime ?? base.burstTime ?? 0;
    values[9] = defaults?.customR ?? base.customR ?? 0;
    values[10] = defaults?.customG ?? base.customG ?? 0;
    values[11] = defaults?.customB ?? base.customB ?? 0;
    values[12] = overrides?.customStrength ?? defaults?.customStrength ?? base.customStrength ?? 0;
    values[13] = defaults?.rainMode ?? base.rainMode ?? 0;
    values[14] = defaults?.trunkSeed ?? base.trunkSeed ?? 0;
    values[15] = defaults?.beachSeason ?? base.beachSeason ?? 0;
    renderer.device.queue.writeBuffer(buffer, 0, values);
  }
}
