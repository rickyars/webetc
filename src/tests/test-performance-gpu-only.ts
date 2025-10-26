/**
 * GPU-Only Performance Benchmark
 *
 * Measures pure GPU compute performance without GPU-CPU transfer overhead
 * This shows the actual hashing throughput of the GPU
 */

import { setupHashimotoGPU, createReusableBuffers } from '../gpu/hashimoto';
import { createGPUDevice } from '../gpu/device-helper';
import { keccak256 } from 'ethereum-cryptography/keccak.js';

let shouldStop = false;

function log(message: string) {
  const logEl = document.getElementById('log');
  if (logEl) {
    logEl.innerHTML += message + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }
  console.log(message);
}

function setupStopButton() {
  const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
  if (stopBtn) {
    stopBtn.style.display = 'block';
    stopBtn.onclick = () => {
      shouldStop = true;
      stopBtn.disabled = true;
      stopBtn.textContent = 'Stopping...';
      log('\n<span style="color: #ffaa00;">⚠ Stop requested</span>\n');
    };
  }
}

function formatHashrate(hashesPerSecond: number): string {
  if (hashesPerSecond >= 1_000_000) {
    return `${(hashesPerSecond / 1_000_000).toFixed(2)} MH/s`;
  } else if (hashesPerSecond >= 1_000) {
    return `${(hashesPerSecond / 1_000).toFixed(2)} KH/s`;
  } else {
    return `${hashesPerSecond.toFixed(2)} H/s`;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function runGPUOnlyBenchmark() {
  try {
    log('=== GPU-ONLY PERFORMANCE BENCHMARK ===');
    log('(Measures GPU compute without CPU transfer overhead)\n');

    const device = await createGPUDevice();
    log('✓ GPU device created\n');

    log('Setting up Hashimoto for epoch 0...');
    const setup = await setupHashimotoGPU(0, device);
    log(`✓ Setup complete`);
    log(`  DAG: ${(setup.dag.byteLength / 1024 / 1024 / 1024).toFixed(2)} GB\n`);

    // Generate test data
    const headerBytes = new TextEncoder().encode('gpu-benchmark-test');
    const headerHash = keccak256(headerBytes);
    const headerHashU32 = new Uint32Array(headerHash.buffer, headerHash.byteOffset, 8);

    // Test different batch sizes
    const batchSizes = [50000, 100000, 250000, 500000, 1000000];

    for (const batchSize of batchSizes) {
      log(`${'='.repeat(60)}`);
      log(`Testing batch size: ${batchSize.toLocaleString()} nonces`);
      log(`${'='.repeat(60)}\n`);

      // Create reusable buffers (this compiles the shader with proper selection logic)
      createReusableBuffers(batchSize, device, setup);
      const buffers = setup.reusableBuffers!;

      // Generate nonces
      const noncesU32Data = new Uint32Array(batchSize * 2);
      for (let i = 0; i < batchSize; i++) {
        noncesU32Data[i * 2] = i & 0xFFFFFFFF;
        noncesU32Data[i * 2 + 1] = (i >>> 32) & 0xFFFFFFFF;
      }

      // Upload data once
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

      let bindGroup1: GPUBindGroup | null = null;
      if (setup.numDAGBuffers === 2) {
        bindGroup1 = device.createBindGroup({
          layout: buffers.pipeline.getBindGroupLayout(1),
          entries: [
            { binding: 0, resource: { buffer: setup.dagBuffers[1] } },
          ],
        });
      }

      const workgroupsNeeded = Math.ceil(batchSize / 256);

      // Warm up (ensure shader is compiled)
      log('Warming up GPU (3 iterations)...');
      for (let i = 0; i < 3; i++) {
        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(buffers.pipeline);
        passEncoder.setBindGroup(0, bindGroup0);
        if (bindGroup1) {
          passEncoder.setBindGroup(1, bindGroup1);
        }
        passEncoder.dispatchWorkgroups(workgroupsNeeded, 1, 1);
        passEncoder.end();
        device.queue.submit([commandEncoder.finish()]);
        await device.queue.onSubmittedWorkDone();
      }

      log('Running GPU compute benchmark (10 iterations)...');

      const iterations = 10;
      const timings: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();

        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(buffers.pipeline);
        passEncoder.setBindGroup(0, bindGroup0);
        if (bindGroup1) {
          passEncoder.setBindGroup(1, bindGroup1);
        }
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

      log(`Results (${iterations} iterations):`);
      log(`  Avg time: ${formatDuration(avgTime)}`);
      log(`  Min time: ${formatDuration(minTime)}`);
      log(`  Max time: ${formatDuration(maxTime)}`);
      log(`  <span style="color: #00ff88; font-weight: bold;">GPU Hashrate: ${formatHashrate(hashrate)}</span>`);
      log(`  Per-hash time: ${(avgTime / batchSize * 1000).toFixed(3)}µs\n`);

      // Cleanup buffers for this batch size
      buffers.headerHashBuffer.destroy();
      buffers.noncesBuffer.destroy();
      buffers.hashesBuffer.destroy();
      buffers.paramsBuffer.destroy();
      buffers.stagingBuffer.destroy();
    }

    // Final cleanup
    setup.cacheBuffer.destroy();
    for (const buffer of setup.dagBuffers) {
      buffer.destroy();
    }

    log(`${'='.repeat(60)}`);
    log('=== BENCHMARK COMPLETE ===');
    log(`${'='.repeat(60)}`);
  } catch (error) {
    log(`<span style="color: #ff4444;">❌ Error: ${error instanceof Error ? error.message : String(error)}</span>`);
    console.error(error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runGPUOnlyBenchmark);
} else {
  runGPUOnlyBenchmark();
}
