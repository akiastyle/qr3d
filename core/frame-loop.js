export function startFrameLoop(update) {
  if (typeof update !== "function") throw new TypeError("update deve essere una funzione");
  let frameId = 0, active = true;
  const frame = time => { if (!active) return; update(time / 1000); frameId = requestAnimationFrame(frame); };
  frameId = requestAnimationFrame(frame);
  return () => { active = false; cancelAnimationFrame(frameId); };
}
