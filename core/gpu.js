import { ENGINE_SETTINGS } from "./settings.js";

export const ALPHA_BLEND_STATE = Object.freeze({
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
});

export function createUniformBuffer(device, size) {
  return device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
}

export function createStorageBuffer(device, size) {
  return device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
}

function createUploadedBuffer(device, data, usage) {
  const size = Math.ceil(data.byteLength / 4) * 4;
  const buffer = device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
  if (size === data.byteLength) device.queue.writeBuffer(buffer, 0, data);
  else {
    const paddedData = new Uint8Array(size);
    paddedData.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    device.queue.writeBuffer(buffer, 0, paddedData);
  }
  return buffer;
}

export function createVertexBuffer(device, data) {
  return createUploadedBuffer(device, data, GPUBufferUsage.VERTEX);
}

export function createIndexBuffer(device, data) {
  return createUploadedBuffer(device, data, GPUBufferUsage.INDEX);
}

export function createBindGroupLayout(device, descriptor) {
  return device.createBindGroupLayout(descriptor);
}

export function createBindGroup(device, descriptor) {
  return device.createBindGroup(descriptor);
}

export function createPipeline(device, format, { vertex, fragment, layout = "auto", depth = true, blend, buffers }) {
  const vertexModule = device.createShaderModule({ code: vertex });
  const fragmentModule = device.createShaderModule({ code: fragment });
  return device.createRenderPipeline({
    layout,
    vertex: { module: vertexModule, entryPoint: "main", buffers },
    fragment: { module: fragmentModule, entryPoint: "main", targets: [{ format, blend }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: depth ? { format: ENGINE_SETTINGS.render.depthFormat, depthWriteEnabled: true, depthCompare: "less" } : undefined,
  });
}

export function createScenePipeline(device, format, bindGroupLayout, shader) {
  const vertexModule = device.createShaderModule({ code: shader.vertex });
  const fragmentModule = device.createShaderModule({ code: shader.fragment });
  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: { module: vertexModule, entryPoint: "main", buffers: shader.vertexBuffers },
    fragment: { module: fragmentModule, entryPoint: "main", targets: [{ format, blend: shader.blend ?? ALPHA_BLEND_STATE }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { depthWriteEnabled: shader.depthWrite, depthCompare: shader.depthCompare, format: ENGINE_SETTINGS.render.depthFormat },
  });
}

export async function createGpuDevice() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error("WebGPU non disponibile");
  const device = await adapter.requestDevice();
  return { adapter, device, format: navigator.gpu.getPreferredCanvasFormat() };
}

export async function createGpuSurface(canvas, gpu = null) {
  gpu ??= await createGpuDevice();
  const { adapter, device, format } = gpu;
  const context = canvas.getContext("webgpu");
  let width = 0, height = 0;
  let transparent = false;

  function resize() {
    const scale = Math.min(devicePixelRatio || 1, ENGINE_SETTINGS.render.maxPixelRatio);
    const nextWidth = Math.max(1, Math.floor(canvas.clientWidth * scale));
    const nextHeight = Math.max(1, Math.floor(canvas.clientHeight * scale));
    if (nextWidth === width && nextHeight === height) return false;
    width = nextWidth; height = nextHeight;
    canvas.width = width; canvas.height = height;
    context.configure({ device, format, alphaMode: ENGINE_SETTINGS.render.alphaMode });
    return true;
  }

  function createCommandEncoder() { return device.createCommandEncoder(); }
  function getCurrentTextureView() { resize(); return context.getCurrentTexture().createView(); }
  function submit(encoder) { device.queue.submit([encoder.finish()]); }
  function destroy() { context.unconfigure(); width = height = 0; }
  function setTransparent(value) { transparent = Boolean(value); }

  function beginRenderPass(encoder, colorView, depthView, { clearColor, loadOp = "clear" } = {}) {
    const descriptor = {
      colorAttachments: [{ view: colorView, clearValue: clearColor ?? { r: .965, g: .945, b: .906, a: transparent ? 0 : 1 }, loadOp, storeOp: "store" }],
    };
    if (depthView) descriptor.depthStencilAttachment = { view: depthView, depthClearValue: 1, depthLoadOp: loadOp, depthStoreOp: "store" };
    return encoder.beginRenderPass(descriptor);
  }

  return { adapter, device, context, format, resize, destroy, setTransparent, createCommandEncoder, getCurrentTextureView, submit, beginRenderPass, get transparent() { return transparent; }, get clearColor() { return transparent ? [0, 0, 0, 0] : ENGINE_SETTINGS.render.clearColor; }, get width() { return width; }, get height() { return height; } };
}

export function createRenderTargets(surface) {
  const { device, format } = surface;
  let width = 0, height = 0;
  let depthTexture = null, sceneTexture = null;
  let depthView = null, sceneView = null;

  function resize() {
    surface.resize();
    if (depthTexture && width === surface.width && height === surface.height) return false;
    depthTexture?.destroy();
    sceneTexture?.destroy();
    width = surface.width;
    height = surface.height;
    depthTexture = device.createTexture({ size: [width, height], format: ENGINE_SETTINGS.render.depthFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    sceneTexture = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    depthView = depthTexture.createView();
    sceneView = sceneTexture.createView();
    return true;
  }

  function destroy() {
    depthTexture?.destroy();
    sceneTexture?.destroy();
    depthTexture = sceneTexture = depthView = sceneView = null;
  }

  return { resize, destroy, get depthTextureView() { return depthView; }, get sceneTextureView() { return sceneView; } };
}
