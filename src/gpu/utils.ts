/**
 * GPU Utility Functions
 */

import { GPUContext } from './context';

/**
 * Create a GPU buffer with initial data
 */
export function createGPUBuffer(
  device: GPUDevice,
  data: ArrayBuffer | ArrayBufferView,
  usage: GPUBufferUsageFlags = GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE
): GPUBuffer {
  const size = data.byteLength;

  const buffer = device.createBuffer({
    size,
    usage,
    mappedAtCreation: true,
  });

  new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data));
  buffer.unmap();

  return buffer;
}

/**
 * Create a staging buffer for reading GPU data
 */
export function createStagingBuffer(
  device: GPUDevice,
  size: number
): GPUBuffer {
  return device.createBuffer({
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
}

/**
 * Read data from GPU buffer back to CPU
 */
export async function readGPUBuffer(
  device: GPUDevice,
  buffer: GPUBuffer,
  offset: number = 0,
  size?: number
): Promise<ArrayBuffer> {
  const bufferSize = size || buffer.size;
  const stagingBuffer = createStagingBuffer(device, bufferSize);

  const commandEncoder = device.createCommandEncoder();
  commandEncoder.copyBufferToBuffer(
    buffer,
    offset,
    stagingBuffer,
    0,
    bufferSize
  );

  device.queue.submit([commandEncoder.finish()]);

  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const data = stagingBuffer.getMappedRange();
  const result = new ArrayBuffer(bufferSize);
  new Uint8Array(result).set(new Uint8Array(data));
  stagingBuffer.unmap();
  stagingBuffer.destroy();

  return result;
}

/**
 * Create a compute pipeline from shader code
 */
export function createComputePipeline(
  device: GPUDevice,
  shaderCode: string,
  layout?: GPUPipelineLayout
): GPUComputePipeline {
  const shaderModule = device.createShaderModule({
    code: shaderCode,
  });

  return device.createComputePipeline({
    layout: layout || 'auto',
    compute: {
      module: shaderModule,
      entryPoint: 'main',
    },
  });
}

/**
 * Execute a compute shader
 */
export async function executeComputeShader(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  workgroups: [number, number, number] = [1, 1, 1]
): Promise<void> {
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();

  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.dispatchWorkgroups(...workgroups);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
}

/**
 * Format bytes as hex string for debugging
 */
export function bytesToHex(bytes: ArrayBuffer, length?: number): string {
  const view = new Uint8Array(bytes);
  const count = length || Math.min(32, view.length);
  return Array.from(view.slice(0, count))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
}

/**
 * Get device features as a readable string
 */
export function getDeviceInfo(context: GPUContext): string {
  const info = context.getAdapterInfo();
  const limits = context.getAdapterLimits();

  return `
Adapter: ${info?.description || 'Unknown (requestAdapterInfo not available)'}
Vendor: ${info?.vendor || 'Unknown'}
Max Compute Workgroup Size: ${limits.maxComputeWorkgroupSizeX}x${limits.maxComputeWorkgroupSizeY}x${limits.maxComputeWorkgroupSizeZ}
Max Workgroups Per Dimension: ${limits.maxComputeWorkgroupsPerDimension}
Max Storage Buffer Binding Size: ${limits.maxStorageBufferBindingSize} bytes
Max Compute Workgroup Storage Size: ${limits.maxComputeWorkgroupStorageSize} bytes
  `.trim();
}
