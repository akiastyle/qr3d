import { createBindGroup, createBindGroupLayout } from "./gpu.js";
import { SCENE_UNIFORM_WGSL } from "./scene-wgsl.js";

const VERTEX_WGSL = `${SCENE_UNIFORM_WGSL}
struct BlurOut { @builtin(position) position: vec4f, @location(0) uv: vec2f, }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@vertex fn main(@builtin(vertex_index) index: u32) -> BlurOut {
  let triangle = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
  let point = triangle[index];
  var output: BlurOut;
  output.position = vec4f(point, 1., 1.);
  output.uv = vec2f(point.x * .5 + .5, .5 - point.y * .5);
  return output;
}`;

const FRAGMENT_WGSL = `${SCENE_UNIFORM_WGSL}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var sceneSamp: sampler;
@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let strength = sin(uniforms.progress * 3.14159) * .05;
  let center = vec2f(.5);
  let direction = (uv - center) * strength;
  var color = vec4f(0.);
  for (var index = 0u; index < 8u; index++) { color += textureSample(sceneTex, sceneSamp, uv - direction * (f32(index) / 7.)); }
  color /= 8.;
  let vignette = 1. - length(uv - center) * length(uv - center) * strength * 8.;
  return vec4f(color.rgb * vignette, 1.);
}`;

export function createTransitionBlur(device, format, uniformBuffer, sceneTextureView) {
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  const layout = createBindGroupLayout(device, { entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
  ] });
  const createGroup = view => createBindGroup(device, { layout, entries: [
    { binding: 0, resource: { buffer: uniformBuffer } },
    { binding: 1, resource: view },
    { binding: 2, resource: sampler },
  ] });
  let pipeline = null;
  try {
    pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module: device.createShaderModule({ code: VERTEX_WGSL }), entryPoint: "main" },
      fragment: { module: device.createShaderModule({ code: FRAGMENT_WGSL }), entryPoint: "main", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
    });
  } catch (error) {
    console.error("Blur pipeline failed (non-fatal):", error);
  }
  return { pipeline, bindGroup: createGroup(sceneTextureView), createBindGroup: createGroup };
}
