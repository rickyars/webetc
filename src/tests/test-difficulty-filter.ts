/**
 * GPU Difficulty Filter Test
 * Tests the GPU difficulty filter with known mining scenarios
 */

import { runHashimotoBatchGPU, setupHashimotoGPU } from '../gpu/hashimoto';
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

async function testDifficultyFilter() {
  try {
    log('Initializing WebGPU...\n');

    const device = await createGPUDevice();
    log('✓ GPU device created\n');

    const epoch = 0;

    log(`=== GPU Difficulty Filter Test (Epoch ${epoch}) ===\n`);

    // Step 1: Setup Hashimoto (generate cache/DAG)
    log('Step 1: Setting up Hashimoto...');
    const setup = await setupHashimotoGPU(epoch, device);
    log('✓ Setup complete\n');

    // Step 2: Generate test nonces
    log('Step 2: Generating test nonces...');
    const testNonces: Uint8Array[] = [];
    for (let i = 0; i < 100; i++) {
      const nonce = new Uint8Array(8);
      const view = new DataView(nonce.buffer);
      view.setBigUint64(0, BigInt(i), true);
      testNonces.push(nonce);
    }
    log(`✓ Created ${testNonces.length} test nonces\n`);

    // Step 3: Create header hash
    log('Step 3: Creating test header hash...');
    const headerHash = new Uint8Array(32);
    log('✓ Header hash created (all zeros)\n');

    // Step 4-5: Run Hashimoto with integrated difficulty filter on all nonces
    log('Step 4-5: Running Hashimoto on GPU with integrated difficulty filter...');

    // Use a realistic difficulty threshold
    // For Ethereum, difficulty ~1 Th/s is around 2^256 / (1e12 * 1e9) ≈ 1.8e15
    // Let's use a threshold that should catch a few winning nonces
    const difficulty = BigInt('1000000000000'); // 1 trillion (loose threshold for testing)
    const maxHashThreshold = (BigInt(1) << BigInt(256)) / difficulty;

    const hashimotoStart = performance.now();
    const batchResult = await runHashimotoBatchGPU(
      headerHash,
      testNonces,
      device,
      setup,
      undefined, // default config
      maxHashThreshold // integrated difficulty filter
    );
    const hashimotoTime = performance.now() - hashimotoStart;

    log(`✓ Hashimoto + filter complete in ${hashimotoTime.toFixed(2)}ms`);
    log(`  Hashimoto hashes: ${batchResult.results.length}`);

    const filterResult = batchResult.filterResult!;
    log(`  Hashimoto time: ${batchResult.timeMs.toFixed(2)}ms`);
    log(`  Filter time: ${filterResult.filterTimeMs.toFixed(2)}ms`);
    log(`  Input hashes: ${filterResult.totalHashes}`);
    log(`  Winning nonces: ${filterResult.validCount}`);
    log(`  Efficiency: ${((filterResult.validCount / filterResult.totalHashes) * 100).toFixed(2)}% pass rate\n`);

    // Step 6: Validate results
    log('Step 6: Validating filter results...\n');

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

    // Verify each winning nonce is indeed valid
    log('Checking winning nonces meet difficulty threshold:\n');
    let allValid = true;

    for (let i = 0; i < Math.min(5, filterResult.validNonces.length); i++) {
      const nonce = filterResult.validNonces[i];
      const cpuResult = ethash.run(headerHash, nonce, ethash.fullSize);

      // Check if meets difficulty
      const hashBigInt = BigInt(
        '0x' + Array.from(cpuResult.hash)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
      );
      const meetsDifficulty = hashBigInt < (BigInt(1) << BigInt(256)) / difficulty;

      const status = meetsDifficulty ? '✓' : '✗';
      log(`  ${status} Nonce ${i}: hash starts with ${Array.from(cpuResult.hash.slice(0, 4))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')}... meets: ${meetsDifficulty}`);

      if (!meetsDifficulty) {
        allValid = false;
      }
    }

    log('');
    if (allValid) {
      log('✓✓✓ ALL WINNING NONCES VALIDATED!');
    } else {
      log('⚠️  Some nonces did not meet difficulty threshold');
    }

    log('\n=== Performance Summary ===');
    log(`Total hashes processed: ${filterResult.totalHashes}`);
    log(`Winning nonces found: ${filterResult.validCount}`);
    log(`Win rate: ${((filterResult.validCount / filterResult.totalHashes) * 100).toFixed(2)}%`);
    log(`Filter time: ${filterResult.timeMs.toFixed(2)}ms`);
    log(`Throughput: ${(filterResult.totalHashes / (filterResult.timeMs / 1000)).toFixed(0)} hashes/sec`);

    // Cleanup
    setup.cacheBuffer.destroy();
    setup.dagBuffer.destroy();
  } catch (error) {
    log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', testDifficultyFilter);
} else {
  testDifficultyFilter();
}
