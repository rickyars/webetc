/**
 * GPU Keccak Test Suite
 * Tests both Keccak-256 and Keccak-512 on WebGPU
 * Uses test vectors from js-sha3 library
 */

// Import the shader code
import keccak512Shader from './compute/keccak-512-shader.wgsl?raw';
import keccak256Shader from './compute/keccak-256-shader.wgsl?raw';
import { createGPUDevice } from '../gpu/device-helper';

interface TestVector {
  input: string;
  expected: string;
  bits: number;
}

const TEST_VECTORS: TestVector[] = [
  // Keccak-256 (32 bytes = 64 hex chars)
  { input: '', expected: 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', bits: 256 },
  { input: 'abc', expected: '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45', bits: 256 },
  { input: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', expected: '45d3b367a6904e6e8d502ee04999a7c27647f91fa845d456525fd352ae3d7371', bits: 256 },

  // Keccak-512 (64 bytes = 128 hex chars)
  { input: '', expected: '0eab42de4c3ceb9235fc91acffe746b29c29a8c366b7c60e4e67c466f36a4304c00fa9caf9d87976ba469bcbe06713b435f091ef2769fb160cdab33d3670680e', bits: 512 },
  { input: 'abc', expected: '18587dc2ea106b9a1563e32b3312421ca164c7f1f07bc922a9c83d77cea3a1e5d0c69910739025372dc14ac9642629379540c17e2a65b19d77aa511a9d00bb96', bits: 512 },
];

function log(message: string) {
  const logEl = document.getElementById('log');
  if (logEl) {
    logEl.textContent += message + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }
  console.log(message);
}

async function testKeccak() {
  try {
    const device = await createGPUDevice();
    log('✓ GPU device created\n');

    let passed = 0;
    let failed = 0;

    for (const test of TEST_VECTORS) {
      const input = new TextEncoder().encode(test.input);
      const rate = test.bits === 512 ? 72 : 136; // Keccak-512 rate vs Keccak-256
      const outputSize = test.bits === 512 ? 64 : 32;

      log(`Test: "${test.input || '(empty)'}" [Keccak-${test.bits}]`);

      // Apply Keccak padding
      const padded = new Uint8Array(rate);
      padded.set(input);
      padded[input.length] = 0x01;
      padded[rate - 1] = 0x80;

      // Convert to u32
      const inputU32 = new Uint32Array(rate / 4);
      const view = new Uint8Array(inputU32.buffer);
      view.set(padded);

      try {
        const shader = test.bits === 512 ? keccak512Shader : keccak256Shader;
        const shaderModule = device.createShaderModule({ code: shader });
        const pipeline = device.createComputePipeline({
          layout: 'auto',
          compute: { module: shaderModule, entryPoint: 'main' }
        });

        const inputBuffer = device.createBuffer({
          size: rate,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
          mappedAtCreation: true
        });
        new Uint32Array(inputBuffer.getMappedRange()).set(inputU32);
        inputBuffer.unmap();

        const outputBuffer = device.createBuffer({
          size: outputSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        const stagingBuffer = device.createBuffer({
          size: outputSize,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: inputBuffer } },
            { binding: 1, resource: { buffer: outputBuffer } }
          ]
        });

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();
        encoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, outputSize);
        device.queue.submit([encoder.finish()]);

        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const resultU32 = new Uint32Array(stagingBuffer.getMappedRange()).slice(0);
        const resultBytes = new Uint8Array(resultU32.buffer, 0, outputSize);
        stagingBuffer.unmap();

        const gpuHex = Array.from(resultBytes)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        const match = gpuHex === test.expected;

        log(`  GPU: ${gpuHex}`);
        log(`  EXP: ${test.expected}`);
        log(`  ${match ? '✓ MATCH' : '✗ MISMATCH'}\n`);

        if (match) passed++;
        else failed++;

      } catch (e) {
        log(`  ❌ ERROR: ${(e as Error).message}\n`);
        failed++;
      }
    }

    log(`\nResults: ${passed}/${passed + failed} tests passed`);

  } catch (e) {
    log(`ERROR: ${(e as Error).message}`);
  }
}

// Run tests on page load
window.addEventListener('DOMContentLoaded', testKeccak);
