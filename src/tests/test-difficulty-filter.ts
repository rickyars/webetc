/**
 * Difficulty Filter Diagnostic Test
 *
 * Validates the GPU difficulty filter by:
 * 1. Generating hashes on GPU
 * 2. Computing same hashes on CPU
 * 3. Comparing hash values byte-by-byte
 * 4. Testing difficulty threshold comparison
 * 5. Verifying GPU filter returns correct winners
 */

import { setupHashimotoGPU, runHashimotoBatchGPU } from '../gpu/hashimoto';
import { createGPUDevice } from '../gpu/device-helper';
import { Ethash } from '@ethereumjs/ethash';
import { keccak256 } from 'ethereum-cryptography/keccak.js';

function log(message: string) {
  const logEl = document.getElementById('log');
  if (logEl) {
    logEl.textContent += message + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }
  console.log(message);
}

async function runDiagnostic() {
  try {
    log('=== DIFFICULTY FILTER DIAGNOSTIC TEST ===\n');

    const device = await createGPUDevice();
    log('✓ GPU device created\n');

    // Setup
    log('Setting up Hashimoto for epoch 0...');
    const setup = await setupHashimotoGPU(0, device);
    log(`✓ Setup complete\n`);

    // Create test data
    const headerBytes = new TextEncoder().encode('diagnostic-test-header');
    const headerHash = keccak256(headerBytes);

    // Generate just 10 nonces for detailed analysis
    const testNonces: Uint8Array[] = [];
    for (let i = 0; i < 10; i++) {
      const nonce = new Uint8Array(8);
      nonce[0] = i;
      testNonces.push(nonce);
    }

    log('Step 1: Running GPU Hashimoto on 10 test nonces...\n');

    // Run without difficulty filter first - get raw hashes
    const gpuResult = await runHashimotoBatchGPU(
      new Uint8Array(headerHash.buffer, headerHash.byteOffset, 32),
      testNonces,
      device,
      setup
    );

    log(`GPU generated ${gpuResult.results.length} hashes\n`);

    // Step 2: Compute same hashes on CPU
    log('Step 2: Computing same hashes on CPU reference...\n');

    const ethash = new Ethash();
    const cacheArray: Uint8Array[] = [];
    for (let i = 0; i < setup.cache.length; i += 16) {
      const itemU32 = setup.cache.slice(i, i + 16);
      const itemBytes = new Uint8Array(itemU32.buffer, itemU32.byteOffset, 64);
      cacheArray.push(itemBytes);
    }
    ethash.cache = cacheArray;
    ethash.fullSize = setup.dag.length * 4;

    // Step 3: Compare GPU and CPU hashes
    log('Step 3: Comparing GPU vs CPU hash values...\n');

    let hashesMatch = 0;
    let hashesMismatch = 0;

    for (let i = 0; i < testNonces.length; i++) {
      const gpuHash = gpuResult.results[i].hash;
      const cpuResult = ethash.run(
        new Uint8Array(headerHash.buffer, headerHash.byteOffset, 32),
        testNonces[i],
        ethash.fullSize
      );
      const cpuHash = cpuResult.hash;

      const gpuHex = Array.from(gpuHash).map(b => b.toString(16).padStart(2, '0')).join('');
      const cpuHex = Array.from(cpuHash).map(b => b.toString(16).padStart(2, '0')).join('');

      const match = gpuHex === cpuHex;
      const status = match ? '✓' : '✗';

      log(`Nonce ${i}:`);
      log(`  GPU: 0x${gpuHex}`);
      log(`  CPU: 0x${cpuHex}`);
      log(`  ${status}\n`);

      if (match) hashesMatch++;
      else hashesMismatch++;
    }

    log(`Hash comparison: ${hashesMatch}/${testNonces.length} match\n`);

    if (hashesMismatch > 0) {
      log('❌ WARNING: Some GPU hashes don\'t match CPU. This is a bug!\n');
    } else {
      log('✓ All GPU hashes match CPU reference!\n');
    }

    // Step 4: Test difficulty threshold comparison
    log('Step 4: Testing difficulty threshold comparison...\n');

    const thresholds = [
      { name: '2^255 (top 50%)', value: BigInt(1) << BigInt(255) },
      { name: '2^240 (top 0.0015%)', value: BigInt(1) << BigInt(240) },
      { name: '2^200 (realistic Eth)', value: BigInt(1) << BigInt(200) },
    ];

    for (const threshold of thresholds) {
      log(`Testing threshold: ${threshold.name}`);

      // Count how many GPU hashes should pass this threshold
      let cpuPassCount = 0;
      for (let i = 0; i < testNonces.length; i++) {
        const gpuHash = gpuResult.results[i].hash;
        // Convert hash to BigInt (little-endian)
        const hashView = new DataView(gpuHash.buffer, gpuHash.byteOffset, 32);
        const hashU32s = new Array(8);
        for (let j = 0; j < 8; j++) {
          hashU32s[j] = hashView.getUint32(j * 4, true);
        }
        // Compare as little-endian u256
        let hashBigInt = BigInt(0);
        for (let j = 7; j >= 0; j--) {
          hashBigInt = (hashBigInt << BigInt(32)) | BigInt(hashU32s[j]);
        }

        if (hashBigInt < threshold.value) {
          cpuPassCount++;
          log(`  Nonce ${i} PASSES (hash < threshold)`);
        }
      }

      log(`  Result: ${cpuPassCount}/${testNonces.length} hashes pass\n`);
    }

    // Step 5: Run with difficulty filter and verify
    log('Step 5: Running GPU Hashimoto WITH integrated difficulty filter...\n');

    const filterThreshold = BigInt(1) << BigInt(200); // Realistic Ethereum threshold

    const filteredResult = await runHashimotoBatchGPU(
      new Uint8Array(headerHash.buffer, headerHash.byteOffset, 32),
      testNonces,
      device,
      setup,
      undefined,
      filterThreshold
    );

    log(`GPU filter returned: ${filteredResult.filterResult?.validCount || 0} winning nonces\n`);

    // Manually verify which nonces should have been returned
    log('Step 6: Manual verification of filter results...\n');

    let expectedWinners = 0;
    for (let i = 0; i < testNonces.length; i++) {
      const gpuHash = gpuResult.results[i].hash;
      const hashView = new DataView(gpuHash.buffer, gpuHash.byteOffset, 32);
      const hashU32s = new Array(8);
      for (let j = 0; j < 8; j++) {
        hashU32s[j] = hashView.getUint32(j * 4, true);
      }
      let hashBigInt = BigInt(0);
      for (let j = 7; j >= 0; j--) {
        hashBigInt = (hashBigInt << BigInt(32)) | BigInt(hashU32s[j]);
      }

      if (hashBigInt < filterThreshold) {
        expectedWinners++;
        const nonceHex = Array.from(testNonces[i]).map(b => b.toString(16).padStart(2, '0')).join('');
        log(`  Expected winner: nonce 0x${nonceHex}`);
      }
    }

    log(`\nExpected winners: ${expectedWinners}`);
    log(`GPU filter returned: ${filteredResult.filterResult?.validCount || 0}`);

    if (expectedWinners === (filteredResult.filterResult?.validCount || 0)) {
      log('✓ Filter count matches expected!\n');
    } else {
      log('❌ Filter count mismatch!\n');
    }

    // Cleanup
    setup.cacheBuffer.destroy();
    setup.dagBuffer.destroy();

    log('\n=== DIAGNOSTIC COMPLETE ===');
  } catch (error) {
    log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
  }
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runDiagnostic);
} else {
  runDiagnostic();
}
