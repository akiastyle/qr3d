import bpy
import os
import sys

SOURCE_PATH = sys.argv[sys.argv.index("--") + 1]
OUTPUT_PATH = sys.argv[sys.argv.index("--") + 2]
EXPORT_NAME = sys.argv[sys.argv.index("--") + 3]
PART_IDS = {"White": 0, "material": 1, "Eyes": 2, "Silver": 3}

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=SOURCE_PATH)
bpy.context.view_layer.update()

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name != "Cube"]
world_positions = [obj.matrix_world @ vertex.co for obj in meshes for vertex in obj.data.vertices]
minimum = [min(getattr(point, axis) for point in world_positions) for axis in "xyz"]
maximum = [max(getattr(point, axis) for point in world_positions) for axis in "xyz"]
center = [(low + high) * .5 for low, high in zip(minimum, maximum)]
scale = max(high - low for low, high in zip(minimum, maximum))

vertices = []
indices = []
for obj in meshes:
    mesh = obj.data
    mesh.calc_loop_triangles()
    normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
    material_name = mesh.materials[0].name if mesh.materials else "White"
    material_id = PART_IDS.get(material_name, 0)
    base_index = len(vertices) // 7
    for vertex in mesh.vertices:
        point = obj.matrix_world @ vertex.co
        normal = (normal_matrix @ vertex.normal).normalized()
        vertices.extend([
            (point.x - center[0]) / scale,
            (point.y - center[1]) / scale,
            (point.z - center[2]) / scale,
            normal.x, normal.y, normal.z,
            material_id,
        ])
    for triangle in mesh.loop_triangles:
        indices.extend(base_index + index for index in triangle.vertices)

if len(vertices) // 7 >= 65536:
    raise RuntimeError("La mesh richiede indici Uint32")

def values(items):
    return ",".join(f"{value:.6f}" if isinstance(value, float) else str(value) for value in items)

with open(OUTPUT_PATH, "w", encoding="utf-8") as output:
    output.write(f"// Generato da {os.path.basename(SOURCE_PATH)}: geometria senza texture.\n")
    output.write("export const KOI_VERTEX_STRIDE = 28;\n")
    output.write(f"export const KOI_VERTEX_DATA = new Float32Array([{values(vertices)}]);\n")
    output.write(f"export const KOI_INDICES = new Uint16Array([{values(indices)}]);\n")
    output.write(f"export const KOI_INDEX_COUNT = {len(indices)};\n")
    output.write(f"export const KOI_VERTEX_COUNT = {len(vertices) // 7};\n")
