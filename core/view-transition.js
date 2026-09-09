import { ENGINE_SETTINGS } from "./settings.js";

// Valori estratti dal ciclo comune di three e fountain.
export function advanceViewTransition(progress, isFlat, deltaSeconds) {
  const target = isFlat ? 1 : 0;
  const { maxFrameDelta, transitionResponse, transitionSnap } = ENGINE_SETTINGS.animation;
  const next = progress + (target - progress) * Math.min(1, transitionResponse * Math.min(deltaSeconds, maxFrameDelta));
  return Math.abs(next - target) < transitionSnap ? target : next;
}

export function easeViewTransition(progress) {
  return progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}
