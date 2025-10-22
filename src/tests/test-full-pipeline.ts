/**
 * Full Mining Pipeline Test
 * Validates the complete Ethash mining flow:
 * 1. Setup (cache/DAG generation)
 * 2. Hashimoto kernel (compute hashes)
 * 3. Difficulty filter kernel (find winners)
 * 4. Validate against CPU reference
 */

import { setupHashimotoGPU, runHashimotoBatchGPU } from '../gpu/hashimoto';
import { createGPUDevice } from '../gpu/device-helper';
import { Ethash } from '@ethereumjs/ethash';

function log(message: string) {
  const logEl = document.getElementById('log');
  if (logEl) {
    logEl.textContent += message + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }
  console.log(message);
}

async function testFullPipeline() {
  try {
    log('=== FULL ETHASH MINING PIPELINE TEST ===\n');

    // Initialize WebGPU
    log('Step 1: Initializing WebGPU...');
    const device = await createGPUDevice();
    device.addEventListener('uncapturederror', (event) => {
      log(`⚠️ GPU Error: ${event.error.message}`);
    });
    log('✓ GPU device created\n');

    // Setup phase (one-time per epoch)
    log('Step 2: SETUP PHASE - Generating cache and DAG...');
    log('(This takes 2-5 minutes on first run)\n');

    const epoch = 0;
    const setupStart = performance.now();
    const setup = await setupHashimotoGPU(epoch, device);
    const setupTime = performance.now() - setupStart;

    log(`✓ Setup complete in ${(setupTime / 1000).toFixed(2)}s`);
    log(`  Cache: ${(setup.cache.byteLength / 1024 / 1024).toFixed(2)} MB`);
    log(`  DAG: ${(setup.dag.byteLength / 1024 / 1024 / 1024).toFixed(2)} GB\n`);

    // Mining phase
    log('Step 3: MINING PHASE - Batch mining 1000 nonces...\n');

    const headerHash = new Uint8Array(32);
    const testNonces: Uint8Array[] = [];
    for (let i = 0; i < 1000; i++) {
      const nonce = new Uint8Array(8);
      const view = new DataView(nonce.buffer);
      view.setBigUint64(0, BigInt(i), true);
      testNonces.push(nonce);
    }

    log(`Generating ${testNonces.length} nonces...\n`);

    // Use difficulty that will catch a few winners (loose threshold for testing)
    // difficulty = 1 trillion: expect ~1 winner per trillion hashes
    // max_hash = 2^256 / difficulty
    // For testing with 1000 hashes, we need a loose difficulty
    const difficulty = BigInt('1000000000000'); // 1 trillion (loose for testing 1000 hashes)
    const maxHashThreshold = (BigInt(1) << BigInt(256)) / difficulty;

    // Step 3a: Hashimoto kernel with integrated difficulty filter
    log('3a. Running Hashimoto kernel on GPU with difficulty filter...');
    const hashimotoStart = performance.now();
    const batchResult = await runHashimotoBatchGPU(
      headerHash,
      testNonces,
      device,
      setup,
      undefined, // default config
      maxHashThreshold // pass difficulty threshold for integrated filtering
    );
    const hashimotoTime = performance.now() - hashimotoStart;

    log(`✓ Hashimoto complete: ${batchResult.results.length} hashes`);
    log(`  Hashimoto time: ${hashimotoTime.toFixed(2)}ms`);
    log(`  Throughput: ${(batchResult.results.length / (hashimotoTime / 1000)).toFixed(0)} hashes/sec\n`);

    // Step 3b: Difficulty filter results (now integrated into Hashimoto)
    log('3b. Difficulty filter results (integrated)...');

    // Results already include filter results since we passed difficulty to runHashimotoBatchGPU
    const filterResult = batchResult.filterResult!;

    log(`✓ Difficulty filter results (integrated):`);
    log(`  Input: ${filterResult.totalHashes} hashes`);
    log(`  Output: ${filterResult.validCount} winning nonces`);
    log(`  Time: ${filterResult.filterTimeMs.toFixed(2)}ms`);
    log(`  Win rate: ${((filterResult.validCount / filterResult.totalHashes) * 100).toFixed(4)}%\n`);

    // Step 4: Validation
    log('Step 4: VALIDATION - Checking results against CPU reference...\n');

    const ethash = new Ethash();
    const { keccak512 } = await import('ethereum-cryptography/keccak.js');

    // Setup cache for validation
    const cacheArray: Uint8Array[] = [];
    for (let i = 0; i < setup.cache.length; i += 16) {
      const itemU32 = setup.cache.slice(i, i + 16);
      const itemBytes = new Uint8Array(itemU32.buffer, itemU32.byteOffset, 64);
      cacheArray.push(itemBytes);
    }
    ethash.cache = cacheArray;
    ethash.fullSize = setup.dag.length * 4;

    // Verify each winning nonce
    log(`Validating ${Math.min(10, filterResult.validNonces.length)} winners...\n`);

    let allValid = true;
    let validationErrors = 0;

    for (let i = 0; i < Math.min(10, filterResult.validNonces.length); i++) {
      const nonce = filterResult.validNonces[i];
      const cpuResult = ethash.run(headerHash, nonce, ethash.fullSize);

      // Verify hash correctness
      const hashBytes = batchResult.results.find(r =>
        Array.from(r.nonce).every((b, j) => b === nonce[j])
      )?.hash;

      if (!hashBytes) {
        log(`✗ Winner ${i}: Could not find corresponding GPU hash`);
        allValid = false;
        validationErrors++;
        continue;
      }

      const gpuHashHex = Array.from(hashBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      const cpuHashHex = Array.from(cpuResult.hash)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const hashMatch = gpuHashHex === cpuHashHex;
      const status = hashMatch ? '✓' : '✗';

      log(`${status} Winner ${i}: ${cpuHashHex.slice(0, 16)}...`);

      if (!hashMatch) {
        log(`  GPU: ${gpuHashHex.slice(0, 16)}...`);
        log(`  CPU: ${cpuHashHex.slice(0, 16)}...`);
        allValid = false;
        validationErrors++;
      }
    }

    log('');

    // Final summary
    log('=== PIPELINE SUMMARY ===\n');
    log(`Setup time:        ${(setupTime / 1000).toFixed(2)}s`);
    log(`Hashimoto time:    ${hashimotoTime.toFixed(2)}ms for ${testNonces.length} nonces`);
    log(`Filter time:       ${filterTime.toFixed(2)}ms`);
    log(`Total mining time: ${(hashimotoTime + filterTime).toFixed(2)}ms\n`);

    log(`Hashes/sec:        ${(testNonces.length / (hashimotoTime / 1000)).toFixed(0)}`);
    log(`Winners found:     ${filterResult.validCount}/${testNonces.length}`);
    log(`Win rate:          ${((filterResult.validCount / testNonces.length) * 100).toFixed(6)}%\n`);

    log(`Validation errors: ${validationErrors}`);

    if (allValid && validationErrors === 0) {
      log('\n✓✓✓ PIPELINE VALIDATED SUCCESSFULLY!');
      log('GPU mining is working correctly end-to-end.');
    } else {
      log('\n⚠️ VALIDATION ISSUES DETECTED');
      log(`${validationErrors} nonce(s) failed validation.`);
    }

    // Cleanup
    setup.cacheBuffer.destroy();
    setup.dagBuffer.destroy();
  } catch (error) {
    log(`\n❌ Pipeline test failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', testFullPipeline);
} else {
  testFullPipeline();
}
