import { activateTransientScene } from "./main.js";
import { parseSceneJson } from "./core/scene-json.js";

window.addEventListener("message", async event => {
  if (event.origin !== location.origin || event.source !== window.opener || event.data?.type !== "qr3d:scene-json" || typeof event.data.source !== "string") return;
  await activateTransientScene(parseSceneJson(event.data.source));
});

window.opener?.postMessage({ type: "qr3d:ready" }, location.origin);
