import bpy
import json
import os
import sys

SOURCE_DIR = sys.argv[sys.argv.index("--") + 1]
OUTPUT_DIR = sys.argv[sys.argv.index("--") + 2]
os.makedirs(OUTPUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def export_selected(path, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_materials="EXPORT")


manifest = []
for filename in sorted(name for name in os.listdir(SOURCE_DIR) if name.lower().endswith(".glb")):
    clear_scene()
    source_path = os.path.join(SOURCE_DIR, filename)
    bpy.ops.import_scene.gltf(filepath=source_path)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name != "Cube"]
    stem = os.path.splitext(filename)[0]
    source_output = os.path.join(OUTPUT_DIR, stem)
    os.makedirs(source_output, exist_ok=True)

    if meshes:
        export_selected(os.path.join(source_output, "model_raw.glb"), meshes)

    parts = []
    for index, mesh in enumerate(meshes, start=1):
        part_name = f"part_{index:02d}_raw.glb"
        export_selected(os.path.join(source_output, part_name), [mesh])
        parts.append({
            "file": part_name,
            "sourceObject": mesh.name,
            "vertices": len(mesh.data.vertices),
            "triangles": len(mesh.data.polygons),
            "materials": len(mesh.data.materials),
        })
    manifest.append({"source": filename, "model": "model_raw.glb", "parts": parts})

with open(os.path.join(OUTPUT_DIR, "manifest.json"), "w", encoding="utf-8") as output:
    json.dump(manifest, output, indent=2)
