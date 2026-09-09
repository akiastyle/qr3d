# qr3d Scene Editor

The scene editor is a local composition tool. It imports GLB files through Blender, lets you arrange their meshes on seasonal QR planes, and exports one validated JSON scene for the viewer or Player API.

The editor session lives only in browser memory. Reloading the page clears imported models and placements. The downloaded JSON file is the saved scene.

## Requirements

- Git
- PHP 8.1 or newer with `exec()` enabled
- Blender available at `/usr/bin/blender`
- Chrome or Edge with WebGPU enabled

Node.js is not required to run the editor. It is used only for the repository checks.

## Local installation

Download or clone the project into a directory named `qr3d`:

```sh
git clone https://github.com/akiastyle/qr3d.git qr3d
cd qr3d
```

The example path above can be replaced by any local directory. Install PHP and Blender through the package manager provided by the operating system, then confirm that the required commands are available. The current importer invokes Blender at `/usr/bin/blender`:

```sh
php --version
/usr/bin/blender --version
php -r 'echo function_exists("exec") ? "exec enabled\n" : "exec disabled\n";'
```

Start the local server from the project directory:

```sh
php \
  -d upload_max_filesize=256M \
  -d post_max_size=260M \
  -d max_execution_time=300 \
  -d memory_limit=512M \
  -S 127.0.0.1:8080 \
  -t ..
```

Open:

```text
http://localhost:8080/qr3d/editor.html
```

Run this command from inside `qr3d/`. The document root is its parent directory because the interface uses `/qr3d/` as its base path.

## Create a scene

1. Press `+` in the Mesh panel and select one or more `.glb` files.
2. Wait for upload, Blender conversion, and preview generation to finish.
3. Drag a mesh preview or its name from the Mesh panel onto the active seasonal QR plane.
4. Use the season buttons to compose Spring, Summer, Autumn, and Winter independently.
5. Open Actions, set an HTTPS QR URL of at most 50 characters, and optionally change the scene title.
6. Use Export to inspect, copy, download, or open the resulting JSON in the preview player.

Each GLB mesh becomes an independently editable item. Base material colors and supported PNG, JPEG, or WebP textures are retained and embedded in the exported scene.

## Edit placed meshes

Click a mesh in the list or on the QR plane to select it. More than one mesh can be selected at the same time.

| Action | Mouse | Keyboard |
| --- | --- | --- |
| Move on the plane | Drag the selected mesh | Arrow keys, one QR block per step |
| Raise or lower | Drag the vertical control | `Shift` + Up/Down |
| Scale | Mouse wheel or drag the scale control | `+` / `-` |
| Rotate | `Shift` + mouse wheel or drag the rotation control | 15-degree steps |
| Remove from the active season | Trash control | `Delete` |
| Undo / redo | Toolbar controls | `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` |

The eye control hides an item. Removing an item from one season does not remove its placements in other seasons. The copy control applies selected placements to one or more other seasons.

## Exported JSON

The exported file already contains:

- QR URL and QR colors
- available seasons and default season
- mesh geometry
- material colors and supported textures
- position, height, scale, and rotation for every seasonal placement

No separate GLB or mesh file is needed by the player. Place the JSON file on the same HTTPS origin as the page using it, serve it as `application/json`, and pass its URL to `scenes`:

```html
<div id="qr3d" style="width:640px;height:480px"></div>

<script type="module">
  import { mountQr3d } from "https://krprojects.it/qr3d/api.js";

  await mountQr3d("#qr3d", {
    scenes: ["./scenes/my-scene.json"],
  });
</script>
```

See [Player API](./API.md) for every runtime option.

## Conversion behavior

`editor-import.php` accepts GLB uploads and invokes `tools/export_static_mesh_module.py` through Blender. Conversion files are created in `/dev/shm` when available, otherwise in the system temporary directory, and are deleted immediately after the response. Converted geometry and textures remain in browser memory until export or page reload.

The final scene validator rejects unknown executable fields, non-HTTPS URLs, malformed geometry, unsupported textures, and files exceeding the configured scene limits.

Keep the importer local. A public deployment of the viewer or API does not require PHP, Blender, the editor, or the conversion endpoint.

## Troubleshooting

- **WebGPU is unavailable:** open the editor in a current Chrome or Edge browser and check `chrome://gpu` or `edge://gpu`.
- **Model preparation fails:** run `/usr/bin/blender --background --version` and confirm that PHP reports `exec enabled`.
- **Large GLB upload fails:** check the effective values with `php -i | grep -E 'upload_max_filesize|post_max_size|max_execution_time|memory_limit'`.
- **Export is unavailable:** place at least one visible mesh on a seasonal plane.
- **Scene JSON is rejected:** reduce geometry or embedded textures to remain within the limits documented in [Player API](./API.md).

## Optional checks

With Node.js installed:

```sh
node editor.test.mjs
node core/core.test.mjs
```
