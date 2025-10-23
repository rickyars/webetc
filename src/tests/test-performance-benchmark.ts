/**
 * Performance Benchmark Test
 *
 * Measures GPU Hashimoto mining performance:
 * 1. Hashes per second (H/s, KH/s, MH/s)
 * 2. GPU utilization and efficiency
 * 3. Different batch sizes and their impact
 * 4. Sustained performance over time
 */

import { setupHashimotoGPU, runHashimotoBatchGPU, createReusableBuffers } from '../gpu/hashimoto';
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
      log('\n<span style="color: #ffaa00;">⚠ Stop requested by user</span>\n');
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

async function runBenchmark() {
  try {
    log('=== GPU HASHIMOTO PERFORMANCE BENCHMARK ===\n');

    const device = await createGPUDevice();
    log('✓ GPU device created\n');

    // Setup
    log('Setting up Hashimoto for epoch 0...');
    log('(This may take 2-3 minutes for DAG generation)\n');
    const setupStart = performance.now();
    const setup = await setupHashimotoGPU(0, device);
    const setupDuration = performance.now() - setupStart;
    log(`✓ Setup complete in ${formatDuration(setupDuration)}`);
    log(`  Cache: ${(setup.cache.byteLength / 1024 / 1024).toFixed(2)} MB`);
    log(`  DAG: ${(setup.dag.byteLength / 1024 / 1024 / 1024).toFixed(2)} GB\n`);

    // Create reusable buffers for maximum performance
    log('Creating reusable GPU buffers for optimized performance...');
    const maxBatchSize = 100000; // Increase to saturate GPU!
    createReusableBuffers(maxBatchSize, device, setup);
    log(`✓ Reusable buffers created (max batch: ${maxBatchSize.toLocaleString()} nonces)\n`);

    // Test header
    const headerBytes = new TextEncoder().encode('performance-benchmark-test');
    const headerHash = keccak256(headerBytes);

    log(`${'='.repeat(60)}`);
    log('BENCHMARK 1: Different Batch Sizes');
    log(`${'='.repeat(60)}\n`);

    const batchSizes = [1000, 5000, 10000, 25000, 50000, 100000];

    for (const batchSize of batchSizes) {
      log(`Testing batch size: ${batchSize.toLocaleString()} nonces`);

      // Generate random nonces
      const testNonces: Uint8Array[] = [];
      for (let i = 0; i < batchSize; i++) {
        const nonce = new Uint8Array(8);
        crypto.getRandomValues(nonce);
        testNonces.push(nonce);
      }

      // Run benchmark
      const start = performance.now();
      const result = await runHashimotoBatchGPU(
        new Uint8Array(headerHash.buffer, headerHash.byteOffset, 32),
        testNonces,
        device,
        setup
      );
      const duration = performance.now() - start;

      const hashrate = batchSize / (duration / 1000);
      log(`  Duration: ${formatDuration(duration)}`);
      log(`  Hashrate: ${formatHashrate(hashrate)}`);
      log(`  Per-hash time: ${(duration / batchSize).toFixed(3)}ms\n`);
    }

    log(`${'='.repeat(60)}`);
    log('BENCHMARK 2: Sustained Performance (60 seconds)');
    log(`${'='.repeat(60)}\n`);

    setupStopButton();

    const sustainedBatchSize = 50000; // Increase to saturate GPU!
    const testDuration = 60000; // 60 seconds
    let totalHashes = 0;
    let batchCount = 0;
    const hashrates: number[] = [];

    log(`Running continuous mining with ${sustainedBatchSize.toLocaleString()} nonces per batch...`);
    log(`Target duration: ${testDuration / 1000} seconds\n`);
    log(`<span style="color: #ffaa00;">Click STOP button to end test early</span>\n`);

    const benchmarkStart = performance.now();

    while (!shouldStop && performance.now() - benchmarkStart < testDuration) {
      // Generate random nonces
      const testNonces: Uint8Array[] = [];
      for (let i = 0; i < sustainedBatchSize; i++) {
        const nonce = new Uint8Array(8);
        crypto.getRandomValues(nonce);
        testNonces.push(nonce);
      }

      const start = performance.now();
      await runHashimotoBatchGPU(
        new Uint8Array(headerHash.buffer, headerHash.byteOffset, 32),
        testNonces,
        device,
        setup
      );
      const duration = performance.now() - start;

      totalHashes += sustainedBatchSize;
      batchCount++;

      const batchHashrate = sustainedBatchSize / (duration / 1000);
      hashrates.push(batchHashrate);

      // Log progress every 10 batches
      if (batchCount % 10 === 0) {
        const elapsed = performance.now() - benchmarkStart;
        const avgHashrate = totalHashes / (elapsed / 1000);
        log(`  ${formatDuration(elapsed)}: ${totalHashes.toLocaleString()} hashes, avg ${formatHashrate(avgHashrate)}`);
      }
    }

    const totalDuration = performance.now() - benchmarkStart;
    const avgHashrate = totalHashes / (totalDuration / 1000);
    const minHashrate = Math.min(...hashrates);
    const maxHashrate = Math.max(...hashrates);

    log(`\nSustained Performance Results:`);
    log(`  Total duration: ${formatDuration(totalDuration)}`);
    log(`  Total hashes: ${totalHashes.toLocaleString()}`);
    log(`  Total batches: ${batchCount}`);
    log(`  Average hashrate: ${formatHashrate(avgHashrate)}`);
    log(`  Min hashrate: ${formatHashrate(minHashrate)}`);
    log(`  Max hashrate: ${formatHashrate(maxHashrate)}`);
    log(`  Hashrate variance: ${((maxHashrate - minHashrate) / avgHashrate * 100).toFixed(2)}%\n`);

    log(`${'='.repeat(60)}`);
    log('BENCHMARK 3: GPU vs CPU Performance');
    log(`${'='.repeat(60)}\n`);

    // This would require implementing CPU mining for comparison
    // For now, just show GPU results
    log('GPU Performance Summary:');
    log(`  Peak hashrate: ${formatHashrate(maxHashrate)}`);
    log(`  Sustained hashrate: ${formatHashrate(avgHashrate)}`);

    if (avgHashrate >= 10_000_000) {
      log(`  <span style="color: #00ff88;">✓ Exceeds 10 MH/s target!</span>`);
    } else if (avgHashrate >= 1_000_000) {
      log(`  <span style="color: #ffaa00;">⚠ ${(avgHashrate / 1_000_000).toFixed(2)} MH/s (below 10 MH/s target)</span>`);
    } else {
      log(`  <span style="color: #ff4444;">❌ ${formatHashrate(avgHashrate)} (significantly below target)</span>`);
    }

    // Cleanup
    if (setup.reusableBuffers) {
      setup.reusableBuffers.headerHashBuffer.destroy();
      setup.reusableBuffers.noncesBuffer.destroy();
      setup.reusableBuffers.hashesBuffer.destroy();
      setup.reusableBuffers.paramsBuffer.destroy();
      setup.reusableBuffers.stagingBuffer.destroy();
    }
    setup.cacheBuffer.destroy();
    setup.dagBuffer.destroy();

    log(`\n${'='.repeat(60)}`);
    log('=== BENCHMARK COMPLETE ===');
    log(`${'='.repeat(60)}`);
  } catch (error) {
    log(`<span style="color: #ff4444;">❌ Error: ${error instanceof Error ? error.message : String(error)}</span>`);
    console.error(error);
  }
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runBenchmark);
} else {
  runBenchmark();
}
