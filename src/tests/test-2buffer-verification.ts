/**
 * 2-Buffer Verification Test
 * Tests that the 2-buffer shader variant works correctly for epochs requiring 2 buffers
 */

import { setupHashimotoGPU, createReusableBuffers } from '../gpu/hashimoto';
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
    log('=== 2-BUFFER VERIFICATION TEST ===');
    log('(Testing epoch 200: 2.56 GB DAG, requires 2 buffers)\n');

    log('Creating GPU device...');
    const device = await createGPUDevice();
    log(`✓ GPU device created`);
    log(`  Max buffer size: ${(device.limits.maxStorageBufferBindingSize / 1024 / 1024 / 1024).toFixed(2)} GB\n`);

    const epoch = 200;
    log(`Setting up Hashimoto for epoch ${epoch}...`);
    log('(This will take ~3-5 minutes to generate 2.56 GB DAG in 2 chunks)\n');

    const setupStart = performance.now();
    const setup = await setupHashimotoGPU(epoch, device);
    const setupTime = performance.now() - setupStart;

    log(`✓ Setup complete in ${formatDuration(setupTime)}`);
    log(`  DAG: ${(setup.dag.byteLength / 1024 / 1024 / 1024).toFixed(2)} GB`);
    log(`  <span style="color: #00ff88; font-weight: bold;">Number of buffers: ${setup.numDAGBuffers}</span>`);
    log(`  Items per buffer: ${setup.dagItemsPerBuffer.toLocaleString()}`);
    log(`  Buffer 0 size: ${(setup.dagBuffers[0].size / 1024 / 1024 / 1024).toFixed(2)} GB`);
    if (setup.numDAGBuffers > 1) {
      log(`  Buffer 1 size: ${(setup.dagBuffers[1].size / 1024 / 1024 / 1024).toFixed(2)} GB`);
    }
    log('');

    if (setup.numDAGBuffers !== 2) {
      log(`<span style="color: #ff0000;">❌ FAILED: Expected 2 buffers, got ${setup.numDAGBuffers}</span>`);
      return;
    }

    log('✓ Correct number of buffers created\n');

    // Generate test data
    const headerBytes = new TextEncoder().encode('2buffer-test');
    const headerHash = keccak256(headerBytes);
    const headerHashU32 = new Uint32Array(headerHash.buffer, headerHash.byteOffset, 8);

    // Test with 1M nonces for better GPU saturation
    const batchSize = 1000000;
    log(`Testing with ${batchSize.toLocaleString()} nonces...\n`);

    // Create reusable buffers (this should select the 2-buffer shader)
    createReusableBuffers(batchSize, device, setup);
    const buffers = setup.reusableBuffers!;

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
    paramsData[1] = setup.dag.length / 16;
    paramsData[2] = setup.dagItemsPerBuffer;
    paramsData[3] = 0;
    device.queue.writeBuffer(buffers.paramsBuffer, 0, paramsData);

    // Create bind groups
    const bindGroup0 = device.createBindGroup({
      layout: buffers.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.headerHashBuffer } },
        { binding: 1, resource: { buffer: buffers.noncesBuffer } },
        { binding: 3, resource: { buffer: setup.dagBuffers[0] } },
        { binding: 4, resource: { buffer: buffers.hashesBuffer } },
        { binding: 5, resource: { buffer: buffers.paramsBuffer } },
      ],
    });

    const bindGroup1 = device.createBindGroup({
      layout: buffers.pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: setup.dagBuffers[1] } },
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

    // Expected: ~26-28 MH/s (slight overhead from 2-buffer branching)
    if (hashrate >= 25_000_000) {
      log(`<span style="color: #00ff88; font-weight: bold;">✓ PASSED: 2-buffer performance is good (≥25 MH/s)</span>`);
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
    setup.cacheBuffer.destroy();
    for (const buffer of setup.dagBuffers) {
      buffer.destroy();
    }

    log('\n=== TEST COMPLETE ===');
  } catch (error) {
    log(`<span style="color: #ff0000;">❌ Error: ${error}</span>`);
    console.error(error);
  }
}

runTest();
