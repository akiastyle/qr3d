# export_static_mesh_module.py v1.0.0
import bpy
import os
import sys
import json
import struct
import base64

arguments = sys.argv[sys.argv.index("--") + 1:]
source_path, output_path, export_name, ratio, object_names = arguments[:5]
embed_textures = len(arguments) > 5 and arguments[5] == "embed"
ratio = float(ratio)
object_names = set(filter(None, object_names.split(",")))

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source_path)
bpy.context.view_layer.update()

# Preserve source labels rather than Blender's generated names for unnamed nodes.
with open(source_path, "rb") as source:
    if source_path.lower().endswith(".glb"):
        source.read(12)
        chunk_length, chunk_type = struct.unpack("<II", source.read(8))
        document = json.loads(source.read(chunk_length))
    else:
        document = json.load(source)
source_labels = {}
for node in document.get("nodes", []):
    if "mesh" not in node:
        continue
    mesh_info = document["meshes"][node["mesh"]]
    name = node.get("name") or mesh_info.get("name") or ""
    description = next((extras["description"] for extras in (node.get("extras"), mesh_info.get("extras")) if isinstance(extras, dict) and isinstance(extras.get("description"), str) and extras["description"]), "")
    for label in (node.get("name"), mesh_info.get("name")):
        if label:
            source_labels[label] = (name, description if isinstance(description, str) else "")

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and (not object_names or obj.name in object_names)]
if not meshes:
    raise RuntimeError("Nessuna mesh selezionata")

for obj in meshes:
    if ratio < 1:
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new("decimate", "DECIMATE")
        modifier.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=modifier.name)

bpy.context.view_layer.update()
world_positions = [obj.matrix_world @ vertex.co for obj in meshes for vertex in obj.data.vertices]
minimum = [min(getattr(point, axis) for point in world_positions) for axis in "xyz"]
maximum = [max(getattr(point, axis) for point in world_positions) for axis in "xyz"]
center = [(low + high) * .5 for low, high in zip(minimum, maximum)]
scale = max(high - low for low, high in zip(minimum, maximum))

texture_urls = {}

def material_data(material):
    color = tuple(material.diffuse_color) if material else (0.8, 0.8, 0.8, 1.0)
    image = None
    if material and material.use_nodes:
        principled = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
        base_color = principled.inputs.get("Base Color") if principled else None
        if base_color:
            color = tuple(base_color.default_value)
            if base_color.is_linked:
                node = base_color.links[0].from_node
                image = node.image if node.type == "TEX_IMAGE" else None
    if not image:
        return color, None
    if image.name not in texture_urls:
        texture_name = f"{os.path.splitext(os.path.basename(output_path))[0]}-texture-{len(texture_urls)}.png"
        texture_path = os.path.join(os.path.dirname(output_path), texture_name)
        image.save_render(texture_path)
        if embed_textures:
            with open(texture_path, "rb") as texture_file:
                texture_urls[image.name] = "data:image/png;base64," + base64.b64encode(texture_file.read()).decode("ascii")
            os.unlink(texture_path)
        else:
            texture_urls[image.name] = texture_name
    return color, texture_urls[image.name]

parts = []
for obj in meshes:
    mesh = obj.data
    mesh.calc_loop_triangles()
    normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
    draws = {}
    for triangle in mesh.loop_triangles:
        material = mesh.materials[triangle.material_index] if triangle.material_index < len(mesh.materials) else None
        color, texture = material_data(material)
        key = (tuple(color), texture)
        vertices = draws.setdefault(key, [])
        for loop_index in triangle.loops:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index]
            point = obj.matrix_world @ vertex.co
            normal = (normal_matrix @ vertex.normal).normalized()
            uv = mesh.uv_layers.active.data[loop_index].uv if mesh.uv_layers.active else (0.0, 0.0)
            vertices.extend([(point.x - center[0]) / scale, (point.y - center[1]) / scale, (point.z - center[2]) / scale, normal.x, normal.y, normal.z, uv[0], 1.0 - uv[1]])
    if draws:
        name, description = source_labels.get(obj.name, source_labels.get(obj.data.name, ("", obj.get("description", ""))))
        if not isinstance(description, str):
            description = ""
        parts.append((name, description, [(color, texture, vertices) for (color, texture), vertices in draws.items()]))
def values(items):
    return ",".join(f"{value:.6f}" if isinstance(value, float) else str(value) for value in items)

with open(output_path, "w", encoding="utf-8") as output:
    if output_path.lower().endswith(".json"):
        json.dump({
            "version": 1,
            "meshes": [{
                "name": name,
                "description": description,
                "draws": [{"color": list(color), "textureUrl": texture, "vertices": vertices} for color, texture, vertices in draws],
            } for name, description, draws in parts],
        }, output, separators=(",", ":"))
    else:
        output.write(f"// Generated from {os.path.basename(source_path)} with materials and textures.\n")
        output.write(f"export const {export_name}_VERTEX_STRIDE = 32;\n")
        output.write(f"export const {export_name}_MESHES = [\n")
        for name, description, draws in parts:
            output.write(f"  {{ name: {json.dumps(name)}, description: {json.dumps(description)}, draws: [\n")
            for color, texture, vertices in draws:
                texture_url = json.dumps(texture) if texture and embed_textures else f"new URL({('./' + texture)!r}, import.meta.url).href" if texture else "null"
                output.write(f"    {{ color: [{values(color)}], textureUrl: {texture_url}, vertices: new Float32Array([{values(vertices)}]) }},\n")
            output.write("  ] },\n")
        output.write("];\n")
