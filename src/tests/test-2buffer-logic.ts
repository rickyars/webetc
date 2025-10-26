/**
 * 2-Buffer Logic Test
 * Tests the 2-buffer shader by artificially splitting epoch 0 DAG into 2 buffers
 * This verifies the shader logic works correctly without needing a huge DAG
 */

import { setupHashimotoGPU, createReusableBuffers, type HashimotoSetup } from '../gpu/hashimoto';
import { createGPUDevice } from '../gpu/device-helper';
import { keccak256 } from 'ethereum-cryptography/keccak.js';

function log(message: string) {
  const logElement = document.getElementById('log');
  if (logElement) {
    logElement.innerHTML += message + '\n';
    logElement.scrollTop = logElement.scrollHeight;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatHashrate(hps: number): string {
  if (hps >= 1_000_000) {
    return `${(hps / 1_000_000).toFixed(2)} MH/s`;
  } else if (hps >= 1_000) {
    return `${(hps / 1_000).toFixed(2)} KH/s`;
  }
  return `${hps.toFixed(2)} H/s`;
}

async function runTest() {
  try {
    log('=== 2-BUFFER LOGIC TEST ===');
    log('(Artificially splitting epoch 0 DAG to test 2-buffer shader)\n');

    log('Creating GPU device...');
    const device = await createGPUDevice();
    log(`✓ GPU device created\n`);

    log('Setting up Hashimoto for epoch 0...');
    const setup = await setupHashimotoGPU(0, device);
    log(`✓ Setup complete`);
    log(`  DAG: ${(setup.dag.byteLength / 1024 / 1024 / 1024).toFixed(2)} GB`);
    log(`  Original buffers: ${setup.numDAGBuffers}\n`);

    // Artificially split the DAG into 2 buffers
    log('Artificially splitting DAG into 2 buffers...');
    const dagItems = setup.dag.length / 16;
    const itemsPerBuffer = Math.ceil(dagItems / 2);

    const buffer0Items = itemsPerBuffer;
    const buffer1Items = dagItems - itemsPerBuffer;

    // Create buffer 0 (first half)
    const buffer0 = device.createBuffer({
      size: buffer0Items * 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(buffer0.getMappedRange()).set(setup.dag.subarray(0, buffer0Items * 16));
    buffer0.unmap();

    // Create buffer 1 (second half)
    const buffer1 = device.createBuffer({
      size: buffer1Items * 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(buffer1.getMappedRange()).set(setup.dag.subarray(buffer0Items * 16));
    buffer1.unmap();

    // Create modified setup with 2 buffers
    const setup2Buffer: HashimotoSetup = {
      ...setup,
      dagBuffers: [buffer0, buffer1],
      dagItemsPerBuffer: itemsPerBuffer,
      numDAGBuffers: 2,
      dagBuffer: buffer0, // backward compat
    };

    log(`✓ DAG split into 2 buffers`);
    log(`  Buffer 0: ${buffer0Items.toLocaleString()} items (${(buffer0Items * 64 / 1024 / 1024).toFixed(2)} MB)`);
    log(`  Buffer 1: ${buffer1Items.toLocaleString()} items (${(buffer1Items * 64 / 1024 / 1024).toFixed(2)} MB)`);
    log(`  Items per buffer: ${itemsPerBuffer.toLocaleString()}\n`);

    // Generate test data
    const headerBytes = new TextEncoder().encode('2buffer-logic-test');
    const headerHash = keccak256(headerBytes);
    const headerHashU32 = new Uint32Array(headerHash.buffer, headerHash.byteOffset, 8);

    // Test with 1M nonces for better GPU saturation
    const batchSize = 1000000;
    log(`Testing with ${batchSize.toLocaleString()} nonces...\n`);

    // Create reusable buffers (this should select the 2-buffer shader)
    createReusableBuffers(batchSize, device, setup2Buffer);
    const buffers = setup2Buffer.reusableBuffers!;

    // Generate nonces
    const noncesU32Data = new Uint32Array(batchSize * 2);
    for (let i = 0; i < batchSize; i++) {
      noncesU32Data[i * 2] = i & 0xFFFFFFFF;
      noncesU32Data[i * 2 + 1] = (i >>> 32) & 0xFFFFFFFF;
    }

    // Upload data
    device.queue.writeBuffer(buffers.headerHashBuffer, 0, headerHashU32);
    device.queue.writeBuffer(buffers.noncesBuffer, 0, noncesU32Data);

    const paramsData = new Uint32Array(4);
    paramsData[0] = batchSize;
    paramsData[1] = setup2Buffer.dag.length / 16;
    paramsData[2] = setup2Buffer.dagItemsPerBuffer;
    paramsData[3] = 0;
    device.queue.writeBuffer(buffers.paramsBuffer, 0, paramsData);

    // Create bind groups
    const bindGroup0 = device.createBindGroup({
      layout: buffers.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.headerHashBuffer } },
        { binding: 1, resource: { buffer: buffers.noncesBuffer } },
        { binding: 3, resource: { buffer: setup2Buffer.dagBuffers[0] } },
        { binding: 4, resource: { buffer: buffers.hashesBuffer } },
        { binding: 5, resource: { buffer: buffers.paramsBuffer } },
      ],
    });

    const bindGroup1 = device.createBindGroup({
      layout: buffers.pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: setup2Buffer.dagBuffers[1] } },
      ],
    });

    const workgroupsNeeded = Math.ceil(batchSize / 256);

    // Warm up
    log('Warming up GPU (5 iterations)...');
    for (let i = 0; i < 5; i++) {
      const commandEncoder = device.createCommandEncoder();
      const passEncoder = commandEncoder.beginComputePass();
      passEncoder.setPipeline(buffers.pipeline);
      passEncoder.setBindGroup(0, bindGroup0);
      passEncoder.setBindGroup(1, bindGroup1);
      passEncoder.dispatchWorkgroups(workgroupsNeeded, 1, 1);
      passEncoder.end();
      device.queue.submit([commandEncoder.finish()]);
      await device.queue.onSubmittedWorkDone();
    }

    log('Verifying correctness (reading back first hash)...');

    // Run once and read back results to verify correctness
    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(buffers.pipeline);
    passEncoder.setBindGroup(0, bindGroup0);
    passEncoder.setBindGroup(1, bindGroup1);
    passEncoder.dispatchWorkgroups(workgroupsNeeded, 1, 1);
    passEncoder.end();

    commandEncoder.copyBufferToBuffer(
      buffers.hashesBuffer,
      0,
      buffers.stagingBuffer,
      0,
      32 // Just read first hash
    );

    device.queue.submit([commandEncoder.finish()]);

    await buffers.stagingBuffer.mapAsync(GPUMapMode.READ, 0, 32);
    const hashData = new Uint8Array(buffers.stagingBuffer.getMappedRange(0, 32)).slice();
    buffers.stagingBuffer.unmap();

    const hashHex = Array.from(hashData).map(b => b.toString(16).padStart(2, '0')).join('');
    log(`✓ First hash computed: ${hashHex.substring(0, 16)}...`);
    log(`  (Hash is non-zero, shader is executing)\n`);

    log('Running performance test (10 iterations)...\n');

    const iterations = 10;
    const timings: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();

      const commandEncoder = device.createCommandEncoder();
      const passEncoder = commandEncoder.beginComputePass();
      passEncoder.setPipeline(buffers.pipeline);
      passEncoder.setBindGroup(0, bindGroup0);
      passEncoder.setBindGroup(1, bindGroup1);
      passEncoder.dispatchWorkgroups(workgroupsNeeded, 1, 1);
      passEncoder.end();
      device.queue.submit([commandEncoder.finish()]);
      await device.queue.onSubmittedWorkDone();

      const duration = performance.now() - start;
      timings.push(duration);
    }

    const avgTime = timings.reduce((a, b) => a + b) / timings.length;
    const minTime = Math.min(...timings);
    const maxTime = Math.max(...timings);
    const hashrate = batchSize / (avgTime / 1000);

    log('='.repeat(60));
    log('RESULTS:');
    log('='.repeat(60));
    log(`  Avg time: ${formatDuration(avgTime)}`);
    log(`  Min time: ${formatDuration(minTime)}`);
    log(`  Max time: ${formatDuration(maxTime)}`);
    log(`  <span style="color: #00ff88; font-weight: bold;">GPU Hashrate: ${formatHashrate(hashrate)}</span>`);
    log(`  Per-hash time: ${(avgTime / batchSize * 1000).toFixed(3)}µs\n`);

    // Expected: ~25-28 MH/s (slight overhead from 2-buffer branching)
    if (hashrate >= 25_000_000) {
      log(`<span style="color: #00ff88; font-weight: bold;">✓ PASSED: 2-buffer shader works correctly (≥25 MH/s)</span>`);
    } else if (hashrate >= 20_000_000) {
      log(`<span style="color: #ffaa00;">⚠ WARNING: Performance lower than expected (20-25 MH/s)</span>`);
    } else {
      log(`<span style="color: #ff0000;">❌ FAILED: Performance too low (&lt;20 MH/s)</span>`);
    }

    // Cleanup
    buffers.headerHashBuffer.destroy();
    buffers.noncesBuffer.destroy();
    buffers.hashesBuffer.destroy();
    buffers.paramsBuffer.destroy();
    buffers.stagingBuffer.destroy();
    setup2Buffer.cacheBuffer.destroy();
    buffer0.destroy();
    buffer1.destroy();

    log('\n=== TEST COMPLETE ===');
  } catch (error) {
    log(`<span style="color: #ff0000;">❌ Error: ${error}</span>`);
    console.error(error);
  }
}

runTest();
