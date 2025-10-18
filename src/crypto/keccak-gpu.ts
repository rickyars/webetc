/**
 * Keccak GPU Implementation Wrapper
 * Executes Keccak-256 hashing on GPU via WebGPU compute shaders
 */

import { GPUContext } from '../gpu/context';
import { createComputePipeline, executeComputeShader, readGPUBuffer } from '../gpu/utils';
import KECCAK_SHADER from '../compute/keccak-shader.wgsl?raw';

export class KeccakGPU {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;

  constructor(device: GPUDevice) {
    this.device = device;
    this.pipeline = createComputePipeline(device, KECCAK_SHADER);
  }

  /**
   * Batch hash multiple inputs on GPU
   * @param inputBuffers Array of 136-byte (padded) input blocks
   * @returns Array of 32-byte hashes
   */
  async hashBatch(inputBuffers: Uint8Array[]): Promise<Uint8Array[]> {
    // Combine all inputs into single buffer
    const totalInputSize = inputBuffers.length * 136;
    const inputData = new Uint8Array(totalInputSize);

    let offset = 0;
    for (const buffer of inputBuffers) {
      if (buffer.length !== 136) {
        throw new Error(`Input buffer must be exactly 136 bytes, got ${buffer.length}`);
      }
      inputData.set(buffer, offset);
      offset += 136;
    }

    // Create GPU buffers
    const inputGPUBuffer = this.device.createBuffer({
      size: totalInputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });

    new Uint8Array(inputGPUBuffer.getMappedRange()).set(inputData);
    inputGPUBuffer.unmap();

    const outputSize = inputBuffers.length * 32;
    const outputGPUBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: false,
    });

    // Create bind group
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
    });

    const bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: inputGPUBuffer } },
        { binding: 1, resource: { buffer: outputGPUBuffer } },
      ],
    });

    // Execute shader
    const workgroups = Math.ceil(inputBuffers.length / 64);
    await executeComputeShader(this.device, this.pipeline, bindGroup, [workgroups, 1, 1]);

    // Read results
    const result = await readGPUBuffer(this.device, outputGPUBuffer, 0, outputSize);
    const resultArray = new Uint8Array(result);

    // Split into individual hashes
    const hashes: Uint8Array[] = [];
    for (let i = 0; i < inputBuffers.length; i++) {
      hashes.push(resultArray.slice(i * 32, (i + 1) * 32));
    }

    // Cleanup
    inputGPUBuffer.destroy();
    outputGPUBuffer.destroy();

    return hashes;
  }

  /**
   * Hash single input on GPU (convenience method)
   * @param input 136-byte padded input block
   * @returns 32-byte hash
   */
  async hash(input: Uint8Array): Promise<Uint8Array> {
    const result = await this.hashBatch([input]);
    return result[0];
  }
}
