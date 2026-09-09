# QR3D Agent Notes

## Project Scope
- Project root: `/var/www/html/qr3d`.
- Git repository: `akiastyle/qr3d`, branch `main`.
- `_old/` is reference material and is read-only unless the user explicitly requests otherwise.
- `gpg.txt`, credentials, generated imports, raw meshes, and local server files must never be committed.

## Source of Truth
- The source of truth is: the user's current request, the existing QR3D structure, and the working reference scenes.
- Preserve existing geometry, colors, animation, lighting, timing, and behavior unless the requested change explicitly targets them.
- Do not reinterpret, rebuild, merge, or split scene content autonomously.

## Working Method
- Inspect the complete affected flow before editing.
- Change only the requested step; do not continue into later steps automatically.
- Prefer the smallest targeted patch that fixes the shared root cause.
- Reuse existing project code before creating helpers, abstractions, or parallel implementations.
- If the target or requested behavior is ambiguous, stop and ask before modifying it.
- Do not touch working, unrelated code and do not revert user changes.
- Do not leave temporary copies, maps, generated files, or debug output in the repository.

## Architecture
- Keep one shared WebGPU renderer and frame lifecycle in `core/`.
- Keep generic QR, camera, lighting, resize, render-pass, buffer, validation, and interaction behavior in `core/`.
- Keep scene-specific geometry, materials, palettes, effects, seasonal content, and animation in each file under `scenes/`.
- Scenes must remain autonomous and implement the same scene contract; never import scene content from another scene.
- Do not add local renderer, canvas, device, encoder, submit, resize, or frame-loop duplicates to scene files.
- Scene availability and defaults belong to each scene's settings. Global interface configuration belongs in `core/settings.js`.
- The editor, viewer, and embeddable player are separate consumers of the same validated scene format.
- Exported scenes are declarative JSON only. Never add executable JavaScript to scene data.

## Protected Behavior
- The QR plane is shared core functionality and is rendered by the main renderer, not by individual scenes.
- A scene supplies only its objects, effects, palettes, seasons, and scene-specific updates.
- Scene selection is controlled by the interface/settings, not URL query parameters.
- QR destination URLs must remain HTTPS-only and at most 50 characters.
- Preserve the current validation limits and same-origin rules unless explicitly requested otherwise.
- The local GLB importer/editor tooling must not be deployed with the public viewer/API.

## UI Rules
- Reuse `core/ui.css` tokens and the existing Atlas-inspired visual language.
- Keep the interface minimal, high-contrast, responsive, and consistent across editor, viewer, and player.
- Prefer icons where the established interface already uses icons; do not introduce unnecessary text or translation work.
- Do not add frameworks or UI dependencies; the project remains vanilla HTML, CSS, and JavaScript.

## Verification
- Run the smallest relevant syntax check and test for every modified area.
- Core changes: run `node core/core.test.mjs`.
- Editor changes: run `node editor.test.mjs`.
- JavaScript changes: run `node --check` on each changed JavaScript file.
- For rendering or interaction changes, verify the affected scene/season in the browser when browser tooling is available.
- A task is not complete while the browser console contains a new WebGPU, shader, pipeline, or runtime error.

## Git Versioning
- Every maintained source file starts with its own semantic version comment in the form `filename vMAJOR.MINOR.PATCH`.
- Increment only the files changed by the requested task: `PATCH` for fixes/refactors, `MINOR` for compatible features, and `MAJOR` for incompatible contracts.
- Keep browser entrypoint references aligned with the referenced file version through `?v=MAJOR.MINOR.PATCH`.
- Before editing, inspect `git status` and preserve unrelated changes.
- Keep each commit limited to one coherent, verified change.
- Use short imperative commit messages that state the actual result.
- Do not amend, rewrite history, force-push, delete tags, or discard changes unless explicitly requested.
- Do not commit or push automatically. Commit, push, tag, and deploy only when the user explicitly requests the corresponding action.
- Create release tags only for verified milestones, using semantic versions such as `v1.0.0`.
- Before publishing, review the diff and confirm that ignored/private/local-only files are absent.

## Deployment
- Deploy only explicitly approved files and only to the requested target.
- Never expose credentials or print their contents.
- Keep `.htaccess` deployment-specific and outside Git.
- Before deployment, compare local and remote files; afterward verify the uploaded files and the public endpoints.
- Never delete or replace the public site, its parent directory, or unrelated hosting content without an exact confirmed target.
