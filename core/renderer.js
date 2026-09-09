import { createGpuSurface } from "./gpu.js";
import { createCamera } from "./camera.js";
import { QR_MODULE_VERTEX_COUNT, QR_MODULE_VERTEX_WGSL } from "./qr-plane.js";
import { SCENE_TRANSFORM_WGSL } from "./scene-transform.js";
import { ENGINE_SETTINGS } from "./settings.js";

export function scheduleSceneFrame(callback) {
  return requestAnimationFrame(callback);
}

export function cancelSceneFrame(frameId) {
  cancelAnimationFrame(frameId);
}

export function createFrameLoop(draw) {
  let frameId = 0;
  let previousTime = 0;
  function frame(time) {
    draw(time, Math.min((time - previousTime) / 1000, .05));
    previousTime = time;
    frameId = requestAnimationFrame(frame);
  }
  return {
    start() { if (!frameId) { previousTime = performance.now(); frameId = requestAnimationFrame(frame); } },
    stop() { cancelAnimationFrame(frameId); frameId = 0; },
  };
}

const shaderCode = /* wgsl */ `
struct Uniforms {
  aspectRatio: f32, gridSize: f32, blockSize: f32, progress: f32,
  yaw: f32, pitch: f32, viewScale: f32, portraitBoost: f32,
  offsetX: f32, offsetY: f32, flatYaw: f32, flatPitch: f32,
  flatViewScale: f32, flatOffsetX: f32, flatOffsetY: f32, _pad1: f32,
  dark: vec4f, light: vec4f, sun: vec4f, ambient: vec4f,
}
@group(0) @binding(0) var<storage, read> modules: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var<storage, read> palette: array<vec4f>;

struct VertexOutput { @builtin(position) position: vec4f, @location(0) normal: vec3f, @location(1) @interpolate(flat) paletteIndex: u32 }

fn aces(color: vec3f) -> vec3f {
  return clamp((color * (2.51 * color + .03)) / (color * (2.43 * color + .59) + .14), vec3f(0.), vec3f(1.));
}
${SCENE_TRANSFORM_WGSL}

@vertex fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  ${QR_MODULE_VERTEX_WGSL}
  var output: VertexOutput;
  output.position = projectScenePosition(localPosition);
  output.normal = normal;
  output.paletteIndex = modules[moduleIndex];
  return output;
}

@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let baseColor = palette[input.paletteIndex].rgb;
  let normal = normalize(input.normal);
  let directional = max(dot(normal, normalize(uniforms.sun.xyz)), 0.);
  let sky = max(normal.y, 0.) * uniforms.dark.a;
  let lit = baseColor * (uniforms.ambient.rgb + uniforms.sun.w * directional + vec3f(sky));
  return vec4f(pow(aces(lit * uniforms.ambient.a), vec3f(1. / uniforms.light.a)), 1.);
}`;

const staticMeshShaderCode = /* wgsl */ `
struct Uniforms {
  aspectRatio: f32, gridSize: f32, blockSize: f32, progress: f32,
  yaw: f32, pitch: f32, viewScale: f32, portraitBoost: f32,
  offsetX: f32, offsetY: f32, flatYaw: f32, flatPitch: f32,
  flatViewScale: f32, flatOffsetX: f32, flatOffsetY: f32, _pad1: f32,
  dark: vec4f, light: vec4f, sun: vec4f, ambient: vec4f,
}
struct Material { color: vec4f }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<uniform> material: Material;
${SCENE_TRANSFORM_WGSL}

struct VertexInput { @location(0) position: vec3f, @location(1) normal: vec3f }
struct VertexOutput { @builtin(position) position: vec4f, @location(0) normal: vec3f }

fn aces(color: vec3f) -> vec3f {
  return clamp((color * (2.51 * color + .03)) / (color * (2.43 * color + .59) + .14), vec3f(0.), vec3f(1.));
}

@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let visibility = smoothstep(0., .35, 1. - uniforms.progress);
  output.position = projectScenePosition(input.position * visibility);
  output.normal = input.normal;
  return output;
}

@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let normal = normalize(input.normal);
  let directional = max(dot(normal, normalize(uniforms.sun.xyz)), 0.);
  let sky = max(normal.y, 0.) * uniforms.dark.a;
  let lit = material.color.rgb * (uniforms.ambient.rgb + uniforms.sun.w * directional + vec3f(sky));
  return vec4f(pow(aces(lit * uniforms.ambient.a), vec3f(1. / uniforms.light.a)), material.color.a);
}`;

const coloredMeshShaderCode = /* wgsl */ `
struct Uniforms {
  aspectRatio: f32, gridSize: f32, blockSize: f32, progress: f32,
  yaw: f32, pitch: f32, viewScale: f32, portraitBoost: f32,
  offsetX: f32, offsetY: f32, flatYaw: f32, flatPitch: f32,
  flatViewScale: f32, flatOffsetX: f32, flatOffsetY: f32, _pad1: f32,
  dark: vec4f, light: vec4f, sun: vec4f, ambient: vec4f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
${SCENE_TRANSFORM_WGSL}
struct VertexInput { @location(0) position: vec3f, @location(1) normal: vec3f, @location(2) color: vec4f }
struct VertexOutput { @builtin(position) position: vec4f, @location(0) normal: vec3f, @location(1) color: vec4f }
fn aces(color: vec3f) -> vec3f { return clamp((color * (2.51 * color + .03)) / (color * (2.43 * color + .59) + .14), vec3f(0.), vec3f(1.)); }
@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = projectScenePosition(input.position * smoothstep(0., .35, 1. - uniforms.progress));
  output.normal = input.normal; output.color = input.color; return output;
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  if (input.color.a < .01) { discard; }
  let directional = max(dot(normalize(input.normal), normalize(uniforms.sun.xyz)), 0.);
  let sky = max(normalize(input.normal).y, 0.) * uniforms.dark.a;
  let lit = input.color.rgb * (uniforms.ambient.rgb + uniforms.sun.w * directional + vec3f(sky));
  return vec4f(pow(aces(lit * uniforms.ambient.a), vec3f(1. / uniforms.light.a)), input.color.a);
}`;

const texturedMeshShaderCode = /* wgsl */ `
struct Uniforms {
  aspectRatio: f32, gridSize: f32, blockSize: f32, progress: f32,
  yaw: f32, pitch: f32, viewScale: f32, portraitBoost: f32,
  offsetX: f32, offsetY: f32, flatYaw: f32, flatPitch: f32,
  flatViewScale: f32, flatOffsetX: f32, flatOffsetY: f32, _pad1: f32,
  dark: vec4f, light: vec4f, sun: vec4f, ambient: vec4f,
}
struct Material { color: vec4f }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<uniform> material: Material;
@group(0) @binding(2) var colorTexture: texture_2d<f32>;
@group(0) @binding(3) var colorSampler: sampler;
${SCENE_TRANSFORM_WGSL}
struct VertexInput { @location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f }
struct VertexOutput { @builtin(position) position: vec4f, @location(0) normal: vec3f, @location(1) uv: vec2f }
fn aces(color: vec3f) -> vec3f { return clamp((color * (2.51 * color + .03)) / (color * (2.43 * color + .59) + .14), vec3f(0.), vec3f(1.)); }
@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = projectScenePosition(input.position * smoothstep(0., .35, 1. - uniforms.progress));
  output.normal = input.normal; output.uv = input.uv; return output;
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let baseColor = textureSample(colorTexture, colorSampler, input.uv) * material.color;
  if (baseColor.a < .01) { discard; }
  let directional = max(dot(normalize(input.normal), normalize(uniforms.sun.xyz)), 0.);
  let sky = max(normalize(input.normal).y, 0.) * uniforms.dark.a;
  let lit = baseColor.rgb * (uniforms.ambient.rgb + uniforms.sun.w * directional + vec3f(sky));
  return vec4f(pow(aces(lit * uniforms.ambient.a), vec3f(1. / uniforms.light.a)), baseColor.a);
}`;

const rendererResources = new WeakMap();

function sharedRendererResources(device, format) {
  let formats = rendererResources.get(device);
  if (!formats) rendererResources.set(device, formats = new Map());
  if (formats.has(format)) return formats.get(format);
  const shader = device.createShaderModule({ code: shaderCode });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "vertexMain" },
    fragment: { module: shader, entryPoint: "fragmentMain", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: ENGINE_SETTINGS.render.depthFormat, depthWriteEnabled: true, depthCompare: "less" },
  });
  const staticMeshShader = device.createShaderModule({ code: staticMeshShaderCode });
  const staticMeshPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: staticMeshShader,
      entryPoint: "vertexMain",
      buffers: [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x3" }] }],
    },
    fragment: { module: staticMeshShader, entryPoint: "fragmentMain", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: ENGINE_SETTINGS.render.depthFormat, depthWriteEnabled: true, depthCompare: "less" },
  });
  const coloredMeshShader = device.createShaderModule({ code: coloredMeshShaderCode });
  const coloredMeshOptions = {
    layout: "auto",
    vertex: { module: coloredMeshShader, entryPoint: "vertexMain", buffers: [{ arrayStride: 40, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x3" }, { shaderLocation: 2, offset: 24, format: "float32x4" }] }] },
    fragment: { module: coloredMeshShader, entryPoint: "fragmentMain", targets: [{ format, blend: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } } }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
  };
  const coloredOpaquePipeline = device.createRenderPipeline({ ...coloredMeshOptions, depthStencil: { format: ENGINE_SETTINGS.render.depthFormat, depthWriteEnabled: true, depthCompare: "less" } });
  const coloredTransparentPipeline = device.createRenderPipeline({ ...coloredMeshOptions, depthStencil: { format: ENGINE_SETTINGS.render.depthFormat, depthWriteEnabled: false, depthCompare: "less" } });
  const texturedMeshShader = device.createShaderModule({ code: texturedMeshShaderCode });
  const texturedMeshOptions = {
    layout: "auto",
    vertex: { module: texturedMeshShader, entryPoint: "vertexMain", buffers: [{ arrayStride: 32, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x3" }, { shaderLocation: 2, offset: 24, format: "float32x2" }] }] },
    fragment: { module: texturedMeshShader, entryPoint: "fragmentMain", targets: [{ format, blend: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } } }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
  };
  const texturedOpaquePipeline = device.createRenderPipeline({ ...texturedMeshOptions, depthStencil: { format: ENGINE_SETTINGS.render.depthFormat, depthWriteEnabled: true, depthCompare: "less" } });
  const texturedTransparentPipeline = device.createRenderPipeline({ ...texturedMeshOptions, depthStencil: { format: ENGINE_SETTINGS.render.depthFormat, depthWriteEnabled: false, depthCompare: "less" } });
  const textureSampler = device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" });
  const whiteTexture = device.createTexture({ size: [1, 1], format: "rgba8unorm-srgb", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: whiteTexture }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
  const resources = { pipeline, staticMeshPipeline, coloredOpaquePipeline, coloredTransparentPipeline, texturedOpaquePipeline, texturedTransparentPipeline, textureSampler, whiteTexture, whiteTextureView: whiteTexture.createView() };
  formats.set(format, resources);
  return resources;
}

export function normalizeQrColors(colors = ENGINE_SETTINGS.qr.colors) {
  const { dark, light } = colors;
  if (![dark, light].every(color => Array.isArray(color) && color.length === 3)) throw new TypeError("I colori QR richiedono dark e light RGB");
  return { dark, light };
}

function textureBlob(response) {
  if (!response.ok) throw new Error(`Texture non trovata: ${response.url}`);
  if (!/^image\/(png|jpeg|webp)(?:;|$)/i.test(response.headers.get("content-type") ?? "")) throw new TypeError("Texture must be PNG, JPEG or WebP");
  return response.blob();
}

function validateTextureDimensions(image) {
  if (image.width > ENGINE_SETTINGS.scene.maxTextureDimension || image.height > ENGINE_SETTINGS.scene.maxTextureDimension || image.width * image.height > ENGINE_SETTINGS.scene.maxTexturePixels) throw new RangeError("Texture exceeds the 4096×4096 pixel limit");
}

export async function createQrRenderer(canvas, surface = null) {
  surface ??= await createGpuSurface(canvas);
  const { device, context, format } = surface;
  const { pipeline, staticMeshPipeline, coloredOpaquePipeline, coloredTransparentPipeline, texturedOpaquePipeline, texturedTransparentPipeline, textureSampler, whiteTextureView } = sharedRendererResources(device, format);
  const uniformBuffer = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const textureCache = new Map();
  let destroyed = false;
  let cachedScene = null;
  let cachedGridSize = 0;
  let cachedStaticMeshes = [];
  let activeScene = null;
  let activeMatrix = null;

  function textureViewFor(url, onLoad) {
    if (!url) return whiteTextureView;
    let texture = textureCache.get(url);
    if (!texture) {
      texture = { view: whiteTextureView };
      texture.promise = fetch(url)
        .then(textureBlob)
        .then(createImageBitmap)
        .then(image => {
          if (destroyed) { image.close(); return; }
          try { validateTextureDimensions(image); }
          catch (error) { image.close(); throw error; }
          const gpuTexture = device.createTexture({ size: [image.width, image.height], format: "rgba8unorm-srgb", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
          device.queue.copyExternalImageToTexture({ source: image }, { texture: gpuTexture }, [image.width, image.height]);
          image.close(); texture.gpuTexture = gpuTexture; texture.view = gpuTexture.createView(); onLoad?.();
        })
        .catch(error => { texture.error = error; });
      textureCache.set(url, texture);
    }
    return texture.view;
  }

  async function prepareTextures(draws) {
    const urls = [...new Set(draws.map(draw => draw.textureUrl).filter(Boolean))];
    for (const url of urls) textureViewFor(url);
    await Promise.all(urls.map(url => textureCache.get(url).promise));
    for (const url of urls) if (textureCache.get(url).error) throw textureCache.get(url).error;
  }

  function setScene(scene) {
    activeScene = scene;
  }

  function setMatrix(matrix) {
    if (!Array.isArray(matrix) || !matrix.length || matrix.some(row => row.length !== matrix.length)) throw new TypeError("Matrice QR non valida");
    activeMatrix = matrix;
  }

  function staticMeshesFor(scene, gridSize) {
    if (scene === cachedScene && gridSize === cachedGridSize) return cachedStaticMeshes;
    for (const mesh of cachedStaticMeshes) { mesh.vertexBuffer.destroy(); mesh.materialBuffer.destroy(); }
    cachedScene = scene;
    cachedGridSize = gridSize;
    if (!scene?.createStaticGeometry) return cachedStaticMeshes = [];
    const definitions = scene.createStaticGeometry(gridSize)?.meshes;
    if (!Array.isArray(definitions)) throw new TypeError("La geometria statica della scena richiede meshes");
    cachedStaticMeshes = definitions.map(mesh => {
      if (!(mesh.vertices instanceof Float32Array) || !mesh.vertices.length || mesh.vertices.length % 6) throw new TypeError("Una mesh richiede vertici posizione+normale");
      const color = scene.colors.elements[mesh.material];
      if (!Array.isArray(color) || color.length !== 3) throw new TypeError("La mesh richiede un materiale della palette scena");
      const vertexBuffer = device.createBuffer({ size: mesh.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      const materialBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices);
      device.queue.writeBuffer(materialBuffer, 0, new Float32Array([...color, 1]));
      return {
        vertexBuffer,
        materialBuffer,
        vertexCount: mesh.vertices.length / 6,
        bindGroup: device.createBindGroup({ layout: staticMeshPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: { buffer: materialBuffer } }] }),
      };
    });
    return cachedStaticMeshes;
  }

  function renderQrPass({ matrix = activeMatrix, scene = activeScene, season = "spring", progress = 0, time = 0, camera = {}, encoder = null, colorView = null, depthView = null, clear = true, clearColor = surface.clearColor ?? ENGINE_SETTINGS.render.clearColor, showQr = true, onTextureLoad = null }) {
    if (!Array.isArray(matrix) || !matrix.length || matrix.some(row => row.length !== matrix.length)) throw new TypeError("Matrice QR non valida");
    if (scene?.seasons && !scene.seasons[season]) throw new RangeError("Stagione non disponibile per la scena");
    const colors = normalizeQrColors(scene?.colors?.qr);
    if (!encoder) surface.resize();
    const size = matrix.length;
    const isometricCamera = createCamera("isometric", camera.isometric);
    const qrCamera = createCamera("qr", camera.qr);
    const staticMeshes = staticMeshesFor(scene, size);
    const frameGeometry = scene?.createFrameGeometry?.({ gridSize: size, matrix, season, time }) ?? {};
    const frameMeshes = ["opaque", "transparent"].flatMap(kind => (frameGeometry[kind] ?? []).map(vertices => ({ kind, vertices })));
    for (const mesh of frameMeshes) if (!(mesh.vertices instanceof Float32Array) || mesh.vertices.length % 10) throw new TypeError("La geometria animata richiede posizione, normale e colore RGBA");
    const texturedMeshes = ["texturedOpaque", "texturedTransparent"].flatMap(kind => (frameGeometry[kind] ?? []).map(mesh => ({ kind, ...mesh })));
    for (const mesh of texturedMeshes) {
      if (!(mesh.vertices instanceof Float32Array) || mesh.vertices.length % 8) throw new TypeError("La mesh testurizzata richiede posizione, normale e UV");
      if (!Array.isArray(mesh.color) || mesh.color.length !== 4) throw new TypeError("La mesh testurizzata richiede un colore materiale RGBA");
    }
    const moduleData = scene?.createQrModules?.(matrix) ?? new Uint32Array(matrix.flat().map(value => value ? 1 : 0));
    if (!(moduleData instanceof Uint32Array) || moduleData.length !== size * size) throw new TypeError("I moduli QR della scena non sono validi");
    const palette = scene?.qrPalette ?? [colors.light, colors.dark];
    const paletteData = new Float32Array(palette.flatMap(color => [...color, 1]));
    if (!paletteData.length || moduleData.some(index => index >= palette.length)) throw new TypeError("La palette QR della scena non copre tutti i moduli");
    const moduleBuffer = device.createBuffer({ size: moduleData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const paletteBuffer = device.createBuffer({ size: paletteData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(moduleBuffer, 0, moduleData);
    device.queue.writeBuffer(paletteBuffer, 0, paletteData);
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
      surface.width / surface.height, size, ENGINE_SETTINGS.qr.blockSize, progress,
      isometricCamera.yaw, isometricCamera.pitch, isometricCamera.viewScale, isometricCamera.portraitBoost,
      isometricCamera.offset[0], isometricCamera.offset[1], qrCamera.yaw, qrCamera.pitch,
      qrCamera.viewScale, qrCamera.offset[0], qrCamera.offset[1], 0,
      ...colors.dark, ENGINE_SETTINGS.lighting.skyStrength,
      ...colors.light, ENGINE_SETTINGS.lighting.gamma,
      ...ENGINE_SETTINGS.lighting.sunDirection, ENGINE_SETTINGS.lighting.sunIntensity,
      ...ENGINE_SETTINGS.lighting.ambient, ENGINE_SETTINGS.lighting.exposure,
    ]));
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: moduleBuffer } }, { binding: 1, resource: { buffer: uniformBuffer } }, { binding: 2, resource: { buffer: paletteBuffer } }] });
    const coloredBindGroups = {
      opaque: device.createBindGroup({ layout: coloredOpaquePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] }),
      transparent: device.createBindGroup({ layout: coloredTransparentPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] }),
    };
    const depthTexture = depthView ? null : device.createTexture({ size: [surface.width, surface.height], format: ENGINE_SETTINGS.render.depthFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const [r, g, b, a] = clearColor;
    const activeEncoder = encoder ?? device.createCommandEncoder();
    const frameBuffers = [];
    const textureMaterialBuffers = [];
    const pass = activeEncoder.beginRenderPass({ colorAttachments: [{ view: colorView ?? context.getCurrentTexture().createView(), clearValue: { r, g, b, a }, loadOp: clear ? "clear" : "load", storeOp: "store" }], depthStencilAttachment: { view: depthView ?? depthTexture.createView(), depthClearValue: 1, depthLoadOp: clear ? "clear" : "load", depthStoreOp: "store" } });
    if (showQr) { pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(size * size * QR_MODULE_VERTEX_COUNT); }
    for (const mesh of staticMeshes) {
      pass.setPipeline(staticMeshPipeline); pass.setBindGroup(0, mesh.bindGroup); pass.setVertexBuffer(0, mesh.vertexBuffer); pass.draw(mesh.vertexCount);
    }
    for (const mesh of frameMeshes) {
      const vertexBuffer = device.createBuffer({ size: mesh.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices);
      pass.setPipeline(mesh.kind === "opaque" ? coloredOpaquePipeline : coloredTransparentPipeline);
      pass.setBindGroup(0, coloredBindGroups[mesh.kind]); pass.setVertexBuffer(0, vertexBuffer); pass.draw(mesh.vertices.length / 10);
      frameBuffers.push(vertexBuffer);
    }
    for (const mesh of texturedMeshes) {
      const vertexBuffer = device.createBuffer({ size: mesh.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      const materialBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices); device.queue.writeBuffer(materialBuffer, 0, new Float32Array(mesh.color));
      const texturedPipeline = mesh.kind === "texturedOpaque" ? texturedOpaquePipeline : texturedTransparentPipeline;
      const bindGroup = device.createBindGroup({ layout: texturedPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: { buffer: materialBuffer } }, { binding: 2, resource: textureViewFor(mesh.textureUrl, onTextureLoad) }, { binding: 3, resource: textureSampler }] });
      pass.setPipeline(texturedPipeline); pass.setBindGroup(0, bindGroup); pass.setVertexBuffer(0, vertexBuffer); pass.draw(mesh.vertices.length / 8);
      frameBuffers.push(vertexBuffer); textureMaterialBuffers.push(materialBuffer);
    }
    pass.end();
    const dispose = () => {
      for (const buffer of frameBuffers) buffer.destroy();
      for (const buffer of textureMaterialBuffers) buffer.destroy();
      moduleBuffer.destroy(); paletteBuffer.destroy(); depthTexture?.destroy();
    };
    if (!encoder) { device.queue.submit([activeEncoder.finish()]); dispose(); return; }
    return dispose;
  }
  function render(options) { renderQrPass(options); }
  function destroy() {
    destroyed = true;
    for (const mesh of cachedStaticMeshes) { mesh.vertexBuffer.destroy(); mesh.materialBuffer.destroy(); }
    cachedStaticMeshes = [];
    for (const texture of textureCache.values()) texture.gpuTexture?.destroy();
    textureCache.clear();
    uniformBuffer.destroy();
  }
  return { render, renderQrPass, setScene, setMatrix, prepareTextures, destroy };
}

export function renderSceneFrame(renderer, sceneState, { writeUniforms, draw, drawForeground = null, qrPlacement = "after", blur = false }) {
  if (renderer.renderTargets?.resize?.()) {
    renderer.aspectRatio = renderer.gpuSurface.width / renderer.gpuSurface.height;
    if (renderer.blur) renderer.bindGroups.blur = renderer.blur.createBindGroup(renderer.sceneTextureView);
  }
  writeUniforms?.();
  const encoder = renderer.gpuSurface.createCommandEncoder();
  const swapChainView = renderer.gpuSurface.getCurrentTextureView();
  const qrPassOptions = {
    encoder,
    scene: renderer.qrScene,
    progress: sceneState.progress,
    time: sceneState.time,
  };
  const shouldBlur = blur && !renderer.isMobile && sceneState.progress > 0 && sceneState.progress < 1 && renderer.pipelines.blur;
  const colorView = shouldBlur ? renderer.sceneTextureView : swapChainView;
  let disposeQrPass = null;
  if (qrPlacement === "before") {
    disposeQrPass = renderer.qrRenderer.renderQrPass({ ...qrPassOptions, colorView, depthView: renderer.depthTextureView, clear: true });
  }
  const pass = renderer.gpuSurface.beginRenderPass(encoder, colorView, renderer.depthTextureView, { loadOp: qrPlacement === "before" ? "load" : "clear" });
  draw(pass);
  pass.end();
  if (qrPlacement === "after") {
    disposeQrPass = renderer.qrRenderer.renderQrPass({ ...qrPassOptions, colorView, depthView: renderer.depthTextureView, clear: false });
  }
  if (drawForeground) {
    const foregroundPass = renderer.gpuSurface.beginRenderPass(encoder, colorView, renderer.depthTextureView, { loadOp: "load" });
    drawForeground(foregroundPass);
    foregroundPass.end();
  }
  if (shouldBlur) {
    const [r, g, b, a] = renderer.gpuSurface.clearColor ?? [0, 0, 0, 1];
    const blurPass = renderer.gpuSurface.beginRenderPass(encoder, swapChainView, null, { clearColor: { r, g, b, a } });
    blurPass.setPipeline(renderer.pipelines.blur);
    blurPass.setBindGroup(0, renderer.bindGroups.blur);
    blurPass.draw(3);
    blurPass.end();
  }
  renderer.gpuSurface.submit(encoder);
  disposeQrPass?.();
}

export async function createSceneRenderer(canvas, scene = null) {
  if (!scene?.createRenderer) return createQrRenderer(canvas);
  const renderer = await scene.createRenderer({ canvas, createGpuSurface, settings: ENGINE_SETTINGS });
  if (!renderer || typeof renderer.render !== "function") throw new TypeError("Il renderer della scena deve esporre render");
  return renderer;
}
