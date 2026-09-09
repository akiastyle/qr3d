# qr3d Player API

The Player API embeds one or more qr3d scenes in an existing web page. It is independent from the scene editor and the full demonstration viewer: it creates one WebGPU canvas and only the seasonal controls required by the active scene.

## Public module

```text
https://krprojects.it/qr3d/api.js
```

The qr3d server must serve JavaScript modules with the correct MIME type and CORS headers. Scene files remain on the embedding page's HTTPS origin and must be served as `application/json`.

## Basic use

Give the container an explicit size, import `mountQr3d()`, and pass the JSON scene exported by the editor:

```html
<div id="qr3d" style="width: 640px; height: 480px"></div>

<script type="module">
  import { mountQr3d } from "https://krprojects.it/qr3d/api.js";

  const player = await mountQr3d("#qr3d", {
    scenes: ["./scenes/my-scene.json"],
  });
</script>
```

The API loads the QR encoder automatically and isolates its canvas and controls in a shadow root. It does not require the editor or the demonstration viewer.

## Complete configuration

```js
const player = await mountQr3d("#qr3d", {
  scenes: [
    "./scenes/scene-a.json",
    "./scenes/scene-b.json",
  ],
  url: "https://example.com",
  autoplaySeconds: 8,
  transparent: true,
  viewInteraction: "hover",
  qrAutoplaySeconds: 10,
  qrHoldSeconds: 2,
});
```

| Option | Default | Description |
| --- | --- | --- |
| `scenes` | required | Array containing same-origin HTTPS JSON URLs. |
| `url` | scene value | Overrides `settings.qrUrl` for every scene. When omitted, each scene uses its exported QR URL. |
| `autoplaySeconds` | `0` | Seconds between seasonal changes. `0` disables autoplay; active values must be between `1` and `60`. |
| `transparent` | `false` | Removes the player and scene background so the host page remains visible. |
| `viewInteraction` | `"click"` | Selects `"click"`, `"hover"`, or `"none"` for the 3D-to-QR rotation. Hover returns to 3D on pointer leave. |
| `qrAutoplaySeconds` | `0` | Seconds before automatically rotating from 3D to QR. `0` disables it; active values must be between `1` and `60`. |
| `qrHoldSeconds` | `2` | Seconds spent in QR view before returning to 3D. Accepted values are `0` or `1`–`60`. |
Scene JSON is validated once before rendering. Unknown properties, executable fields, invalid geometry, oversized documents, and cross-origin URLs are rejected. A scene is limited to 15 MB, 128 assets, 512 draws and 1,000,000 vertices. QR targets must be HTTPS URLs no longer than 50 characters.

Seasonal autoplay and QR-view autoplay are independent and can be enabled together.

## One or more scenes

With one scene, autoplay cycles only through that scene's available seasons. A scene with one season remains unchanged and does not display seasonal controls.

With multiple scenes, autoplay completes the active scene's seasons and then moves to the next scene. After the final scene it starts again from the first.

```js
await mountQr3d("#qr3d", {
  scenes: ["./spring-only.json", "./four-seasons.json"],
  autoplaySeconds: 6,
});
```

## Player methods

`mountQr3d()` resolves to the player controller:

```js
await player.setScene(1);        // scene index
player.setSeason("winter");
await player.setUrl("https://example.com/new-target");

player.play(8);                  // start or change seasonal autoplay
player.pause();                  // stop seasonal autoplay
await player.advance();          // advance once
player.showQr(true);             // show QR
player.showQr(false);            // return to 3D

player.destroy();                // release WebGPU and DOM resources
```

The current values are available as `player.scene` and `player.season`.

## Transparent embed

```html
<div class="hero-scene" id="qr3d"></div>
<style>
  .hero-scene {
    width: min(800px, 100%);
    height: 560px;
    background: linear-gradient(#eef2f4, #dfe7eb);
  }
</style>
<script type="module">
  import { mountQr3d } from "https://krprojects.it/qr3d/api.js";

  await mountQr3d("#qr3d", {
    scenes: ["./my-scene.json"],
    transparent: true,
    viewInteraction: "click",
  });
</script>
```

## Browser requirements

The player requires WebGPU and JavaScript modules. If WebGPU initialization fails, the player displays an error inside its container and rejects the `mountQr3d()` promise. The embedding page should handle that rejection when it needs a custom fallback:

```js
try {
  await mountQr3d("#qr3d", { scenes: ["./my-scene.json"] });
} catch (error) {
  // Optional host-page fallback.
}
```
