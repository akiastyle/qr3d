# qr3d

**Interactive QR environments, built with vanilla JavaScript and WebGPU.**

qr3d explores the QR code as a foundation for a three-dimensional environment: a tree through the seasons, a fountain with moving water and wildlife, or a beach with its own objects and atmosphere. The viewer transitions between the isometric scene and the QR view.

## Documentation

- [Player API](./API.md) — embeddable engine, scene loading, autoplay, transparency, and runtime methods.
- [Scene Editor](./EDITOR.md) — local installation, GLB import, seasonal composition, QR configuration, and JSON export.
- Demo viewer documentation — coming next.

## Inspiration and direction

The project is inspired by **ICQR** and its approach to combining QR codes with animated 3D scenes. qr3d takes that starting point in a different architectural direction: a vanilla JavaScript application, a shared WebGPU core, and a separate editor for composing environments with independently editable objects.

The aim is to make scene creation more flexible than a fixed composition. Objects can be placed, moved, rotated, scaled, recolored, hidden, and arranged differently for each season. The existing scenes provide working examples, while the editor provides a workspace for building new environments directly on the QR plane.

ICQR is acknowledged as the project's inspiration; this does not imply affiliation or endorsement.

## Viewer and scenes

- **Tree** — a seasonal tree environment, including a winter setting with snow.
- **Fountain** — water, fish, birds, vegetation, and seasonal effects.
- **Beach** — seaside objects, water effects, and changing seasonal atmosphere.

Each scene declares its available seasons. The shared core supplies rendering infrastructure, the QR base, camera transformations, lighting settings, resizing, and the frame loop. Scene-specific geometry, colors, and animation behavior remain in the scene modules.

## Scene editor

The editor is a separate interface for arranging objects on four seasonal QR planes: **Spring, Summer, Autumn, and Winter**.

- Import GLB models through the PHP/Blender conversion workflow.
- Browse mesh previews and work with separate mesh components.
- Drag objects onto the plane and select them in the scene or the mesh list.
- Move objects across the plane or in height, rotate them, and change their scale.
- Adjust material colors while retaining imported texture support.
- Select multiple objects, hide or delete them, and copy placements between seasons.
- Undo and redo edits, orbit the workspace, and switch between light and dark themes.
- Download the complete static composition as a validated JSON scene for the viewer.

Editing sessions and imported assets remain temporary. The downloaded JSON scene is the persistent output.

To add a downloaded static scene to the viewer, place its JSON file in `scenes/` and register its path, label, and icon in `ENGINE_SETTINGS.scene.modules` inside `core/settings.js`.

For an embedded player with only seasonal controls, pass one or more exported JSON scenes to the public API:

```html
<div id="qr3d" style="width: 640px; height: 480px"></div>
<script type="module">
  import { mountQr3d } from "./player.js";

  const player = await mountQr3d("#qr3d", {
    scenes: ["./scenes/my-scene.json"],
    autoplaySeconds: 8,
    transparent: false,
    viewInteraction: "click",
    qrAutoplaySeconds: 10,
    qrHoldSeconds: 2,
  });
</script>
```

With multiple JSON scenes, autoplay advances through each scene's seasons and then moves to the next scene. Set `autoplaySeconds` to `0` for manual seasonal controls. The returned player also exposes `setScene(index)`, `setSeason(name)`, `setUrl(url)`, `play(seconds)`, `pause()`, `advance()`, and `destroy()`.

Set `transparent` to render over the host page. `viewInteraction` accepts `"click"`, `"hover"`, or `"none"`. `qrAutoplaySeconds` periodically rotates the scene into QR view, while `qrHoldSeconds` controls how long it remains there before returning to 3D.

The editor stores its QR URL in `settings.qrUrl`. The player uses that value automatically; pass `url` to `mountQr3d()` only when the embedding page needs to override it.

## Project structure

| Location | Purpose |
| --- | --- |
| `core/` | Shared WebGPU and QR infrastructure, scene contracts, and base settings |
| `api.js`, `player.js` | Public embed entry point and minimal player implementation |
| `scenes/` | Tree, fountain, and beach scene modules |
| `main.js` | Viewer startup, scene selection, and season handling |
| `editor.html`, `editor.js`, `editor.css` | Scene composition interface |
| `editor-import.php` | Server-side GLB conversion endpoint |
| `tools/` | Blender scripts for extracting and converting mesh data |
| `assets/meshes/` | JavaScript mesh data used by the existing scenes |

The frontend uses native browser APIs and vanilla JavaScript, without React. WebGPU handles the 3D rendering; Blender is used server-side for model conversion, not as a browser runtime.

## Run

Serve this directory at `/qr3d/` on localhost or HTTPS, using a browser with WebGPU support.

- Viewer: `/qr3d/`
- Editor: `/qr3d/editor.html`

For the complete local editor installation and composition workflow, see [Scene Editor](./EDITOR.md).

The editor's GLB upload/conversion requires PHP 8.1+, PHP `exec()` enabled, and Blender at `/usr/bin/blender`. Conversion uses `/dev/shm` when available, falls back to the system temporary directory, returns in-memory JSON, and removes its temporary workspace immediately. Configure PHP upload and memory limits for the files you intend to import. Do not expose the conversion endpoint publicly without authentication and resource limits.

GitHub Pages can serve the viewer and static editor interface, but cannot run the PHP/Blender conversion endpoint.

## Included assets

`assets/meshes/*.js` contains the six runtime mesh modules required by the existing scenes. Original GLB files, raw exports, `_old/`, and temporary editor imports are excluded. Credentials are not part of this repository.

## Checks

```sh
node editor.test.mjs
node core/core.test.mjs
```
