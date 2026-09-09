import base64
import bpy
import json
import os
import struct
import sys

source_path, output_path = sys.argv[sys.argv.index("--") + 1:sys.argv.index("--") + 3]
clip_names = {"fly1_bird_Object_4"}

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source_path)
bpy.context.view_layer.update()

armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
bones = list(armature.pose.bones)
bone_index = {bone.name: index for index, bone in enumerate(bones)}
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.parent_type == "OBJECT" and obj.find_armature() == armature]

for obj in meshes:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    modifier = obj.modifiers.new("qr3d_half_detail", "DECIMATE")
    modifier.ratio = 0.5
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)

positions, normals, uvs, joints, weights, indices = [], [], [], [], [], []
for obj in meshes:
    mesh = obj.data
    mesh.calc_loop_triangles()
    object_to_armature = armature.matrix_world.inverted() @ obj.matrix_world
    normal_matrix = object_to_armature.to_3x3().inverted().transposed()
    uv_layer = mesh.uv_layers.active
    for triangle in mesh.loop_triangles:
      for loop_index in triangle.loops:
        vertex = mesh.vertices[mesh.loops[loop_index].vertex_index]
        point = object_to_armature @ vertex.co
        normal = (normal_matrix @ vertex.normal).normalized()
        influences = sorted(
            ((group.weight, bone_index.get(obj.vertex_groups[group.group].name, 0)) for group in vertex.groups),
            reverse=True,
        )[:4]
        influence_total = sum(weight for weight, _ in influences) or 1.0
        influence_weights = [weight / influence_total for weight, _ in influences] + [0.0] * (4 - len(influences))
        influence_joints = [joint for _, joint in influences] + [0] * (4 - len(influences))
        positions.extend((point.x, point.y, point.z))
        normals.extend((normal.x, normal.y, normal.z))
        uv = uv_layer.data[loop_index].uv if uv_layer else (0.0, 0.0)
        uvs.extend((uv.x, 1.0 - uv.y))
        joints.extend(influence_joints)
        weights.extend(influence_weights)
        indices.append(len(indices))

def packed(values, format_code):
    return base64.b64encode(struct.pack("<" + format_code * len(values), *values)).decode("ascii")

def bone_matrices():
    values = []
    for bone in bones:
        matrix = bone.matrix @ bone.bone.matrix_local.inverted()
        values.extend(value for column in matrix.transposed() for value in column)
    return values

with open(source_path, "rb") as source:
    source_bytes = source.read()
json_length = struct.unpack_from("<I", source_bytes, 12)[0]
document = json.loads(source_bytes[20:20 + json_length].decode("utf-8"))
binary_start = 20 + json_length + 8
base_texture = document["textures"][document["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
image = document["images"][base_texture["source"]]
view = document["bufferViews"][image["bufferView"]]
start = binary_start + view.get("byteOffset", 0)
texture = source_bytes[start:start + view["byteLength"]]
texture_data_url = "data:" + image["mimeType"] + ";base64," + base64.b64encode(texture).decode("ascii")

fps = 12
clips = {}
for action in bpy.data.actions:
    if action.name not in clip_names:
        continue
    armature.animation_data_create()
    armature.animation_data.action = action
    start, end = action.frame_range
    duration = (end - start) / bpy.context.scene.render.fps
    frames = round(duration * fps) + 1
    samples = []
    for sample in range(frames):
        frame = start + sample * (bpy.context.scene.render.fps / fps)
        bpy.context.scene.frame_set(int(frame), subframe=frame % 1)
        bpy.context.view_layer.update()
        samples.extend(bone_matrices())
    clips[action.name.replace("_Object_4", "")] = {"duration": duration, "frames": frames, "matrices": packed(samples, "f")}

with open(output_path, "w", encoding="utf-8") as output:
    output.write("// Generated from bird_animations_alex.glb. Half-detail mesh with original UVs, skin weights, base texture and one 12 fps source flight clip.\n")
    output.write("const decode = (text, Type) => { const raw = Uint8Array.from(atob(text), c => c.charCodeAt(0)); return new Type(raw.buffer); };\n")
    output.write(f"export const BIRD_VERTEX_COUNT = {len(positions) // 3};\n")
    output.write(f"export const BIRD_INDEX_COUNT = {len(indices)};\n")
    output.write(f"export const BIRD_BONE_COUNT = {len(bones)};\n")
    output.write(f"export const BIRD_POSITIONS = decode('{packed(positions, 'f')}', Float32Array);\n")
    output.write(f"export const BIRD_NORMALS = decode('{packed(normals, 'f')}', Float32Array);\n")
    output.write(f"export const BIRD_UVS = decode('{packed(uvs, 'f')}', Float32Array);\n")
    output.write(f"export const BIRD_JOINTS = decode('{packed(joints, 'H')}', Uint16Array);\n")
    output.write(f"export const BIRD_WEIGHTS = decode('{packed(weights, 'f')}', Float32Array);\n")
    output.write(f"export const BIRD_INDICES = decode('{packed(indices, 'H')}', Uint16Array);\n")
    output.write(f"export const BIRD_BASE_COLOR_TEXTURE = '{texture_data_url}';\n")
    output.write("export const BIRD_CLIPS = {\n")
    for name, clip in clips.items():
        output.write(f"  {name}: {{ duration: {clip['duration']:.6f}, frames: {clip['frames']}, matrices: decode('{clip['matrices']}', Float32Array) }},\n")
    output.write("};\n")
