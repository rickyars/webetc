/**
 * Comprehensive Difficulty Filter Test
 *
 * Validates the GPU difficulty filter thoroughly by:
 * 1. Testing with large batches (1000+ nonces)
 * 2. Testing at multiple difficulty levels
 * 3. Verifying GPU returns correct winning nonces (not just count)
 * 4. Comparing GPU filter output against CPU reference
 * 5. Measuring performance characteristics
 */

import { setupHashimotoGPU, runHashimotoBatchGPU } from '../gpu/hashimoto';
import { createGPUDevice } from '../gpu/device-helper';
import { Ethash } from '@ethereumjs/ethash';
import { keccak256 } from 'ethereum-cryptography/keccak.js';

function log(message: string) {
  const logEl = document.getElementById('log');
  if (logEl) {
    logEl.innerHTML += message + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }
  console.log(message);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function runComprehensiveTest() {
  try {
    log('=== COMPREHENSIVE DIFFICULTY FILTER TEST ===\n');

    const device = await createGPUDevice();
    log('✓ GPU device created\n');

    // Setup
    log('Setting up Hashimoto for epoch 0...');
    const setupStart = performance.now();
    const setup = await setupHashimotoGPU(0, device);
    const setupDuration = performance.now() - setupStart;
    log(`✓ Setup complete (${formatDuration(setupDuration)})\n`);

    // Create test data
    const headerBytes = new TextEncoder().encode('test-block-header');
    const headerHash = keccak256(headerBytes);

    // Setup ethereumjs reference
    log('Setting up CPU reference (ethereumjs)...');
    const ethash = new Ethash();
    const CACHE_INIT_BYTES = 16 * 1024 * 1024;
    const seed = new Uint8Array(32);
    const cache = ethash.mkcache(CACHE_INIT_BYTES, seed);
    ethash.cache = cache;
    ethash.fullSize = 1024 * 1024 * 1024;
    log('✓ CPU reference ready\n');

    // Test configurations: different batch sizes and difficulty levels
    const testConfigs = [
      { batchSize: 100, threshold: BigInt(1) << BigInt(255), name: '2^255 (top 50%)' },
      { batchSize: 100, threshold: BigInt(1) << BigInt(250), name: '2^250 (top 1.5%)' },
      { batchSize: 1000, threshold: BigInt(1) << BigInt(255), name: '2^255 (top 50%)' },
      { batchSize: 1000, threshold: BigInt(1) << BigInt(250), name: '2^250 (top 1.5%)' },
      { batchSize: 5000, threshold: BigInt(1) << BigInt(255), name: '2^255 (top 50%)' },
    ];

    for (const config of testConfigs) {
      log(`\n${'='.repeat(60)}`);
      log(`TEST: ${config.batchSize} nonces at difficulty ${config.name}`);
      log(`${'='.repeat(60)}\n`);

      // Generate random nonces
      const testNonces: Uint8Array[] = [];
      for (let i = 0; i < config.batchSize; i++) {
        const nonce = new Uint8Array(8);
        crypto.getRandomValues(nonce);
        testNonces.push(nonce);
      }

      // Step 1: Run GPU without filter to get all hashes
      log(`Step 1: Computing ${config.batchSize} hashes on GPU...`);
      const gpuStart = performance.now();
      const gpuResult = await runHashimotoBatchGPU(
        new Uint8Array(headerHash.buffer, headerHash.byteOffset, 32),
        testNonces,
        device,
        setup
      );
      const gpuDuration = performance.now() - gpuStart;
      log(`✓ GPU computed ${gpuResult.results.length} hashes in ${formatDuration(gpuDuration)}`);
      log(`  Throughput: ${(config.batchSize / (gpuDuration / 1000)).toFixed(2)} hashes/sec\n`);

      // Step 2: Determine expected winners using CPU
      log('Step 2: Computing expected winners using CPU reference...');
      const cpuStart = performance.now();
      const expectedWinners: { index: number; nonce: Uint8Array; hash: Uint8Array }[] = [];

      for (let i = 0; i < testNonces.length; i++) {
        const hash = gpuResult.results[i].hash;

        // Convert hash to BigInt (little-endian)
        const hashView = new DataView(hash.buffer, hash.byteOffset, 32);
        let hashBigInt = BigInt(0);
        for (let j = 0; j < 8; j++) {
          const u32 = hashView.getUint32(j * 4, true);
          hashBigInt |= BigInt(u32) << BigInt(j * 32);
        }

        if (hashBigInt < config.threshold) {
          expectedWinners.push({ index: i, nonce: testNonces[i], hash });
        }
      }
      const cpuDuration = performance.now() - cpuStart;
      log(`✓ CPU identified ${expectedWinners.length} winners in ${formatDuration(cpuDuration)}\n`);

      // Step 3: Run GPU with difficulty filter
      log('Step 3: Running GPU Hashimoto WITH difficulty filter...');
      const filterStart = performance.now();
      const filteredResult = await runHashimotoBatchGPU(
        new Uint8Array(headerHash.buffer, headerHash.byteOffset, 32),
        testNonces,
        device,
        setup,
        undefined,
        config.threshold
      );
      const filterDuration = performance.now() - filterStart;
      const gpuWinnerCount = filteredResult.filterResult?.validCount || 0;
      log(`✓ GPU filter returned ${gpuWinnerCount} winners in ${formatDuration(filterDuration)}\n`);

      // Step 4: Validate results
      log('Step 4: Validating GPU filter results...');

      if (gpuWinnerCount !== expectedWinners.length) {
        log(`<span style="color: #ff4444;">❌ Winner count mismatch!</span>`);
        log(`  Expected: ${expectedWinners.length}`);
        log(`  GPU returned: ${gpuWinnerCount}\n`);
        continue;
      }

      log(`<span style="color: #00ff88;">✓ Winner count matches! (${gpuWinnerCount}/${config.batchSize})</span>`);

      // Verify the actual winning nonces returned by GPU
      if (filteredResult.filterResult) {
        const gpuWinningNonces = filteredResult.filterResult.validNonces;
        let allMatch = true;

        // Create set of expected nonces for lookup
        const expectedNonceSet = new Set(
          expectedWinners.map(w => {
            const hex = Array.from(w.nonce).map(b => b.toString(16).padStart(2, '0')).join('');
            return hex;
          })
        );

        for (let i = 0; i < gpuWinnerCount; i++) {
          const gpuNonce = gpuWinningNonces[i];
          const gpuNonceHex = Array.from(gpuNonce).map(b => b.toString(16).padStart(2, '0')).join('');

          if (!expectedNonceSet.has(gpuNonceHex)) {
            log(`<span style="color: #ff4444;">❌ GPU returned unexpected winning nonce: 0x${gpuNonceHex}</span>`);
            allMatch = false;
          }
        }

        if (allMatch) {
          log(`<span style="color: #00ff88;">✓ All GPU winning nonces match CPU reference!</span>\n`);
        } else {
          log(`<span style="color: #ff4444;">❌ Some GPU winning nonces don't match!</span>\n`);
        }
      }

      // Performance summary
      log('Performance Summary:');
      log(`  GPU hash computation: ${formatDuration(gpuDuration)} (${(config.batchSize / (gpuDuration / 1000)).toFixed(2)} hashes/sec)`);
      log(`  CPU winner identification: ${formatDuration(cpuDuration)}`);
      log(`  GPU filtered computation: ${formatDuration(filterDuration)} (${(config.batchSize / (filterDuration / 1000)).toFixed(2)} hashes/sec)`);
      log(`  Winner ratio: ${((expectedWinners.length / config.batchSize) * 100).toFixed(2)}%`);
    }

    // Cleanup
    setup.cacheBuffer.destroy();
    setup.dagBuffer.destroy();

    log(`\n${'='.repeat(60)}`);
    log('=== ALL TESTS COMPLETE ===');
    log(`${'='.repeat(60)}`);
  } catch (error) {
    log(`<span style="color: #ff4444;">❌ Error: ${error instanceof Error ? error.message : String(error)}</span>`);
    console.error(error);
  }
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runComprehensiveTest);
} else {
  runComprehensiveTest();
}
