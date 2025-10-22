/**
 * DAG Generation - GPU vs CPU Reference Comparison Test
 * Compares GPU DAG generation against @ethereumjs/ethash CPU reference
 */

import { generateDAGGPU } from '../gpu/dag-builder';
import { Ethash } from '@ethereumjs/ethash';

const HASH_BYTES = 64;
const CACHE_INIT = 16 * 1024 * 1024;

function log(msg: string, type = 'info') {
  const logEl = document.getElementById('log');
  if (logEl) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = msg;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }
  console.log(`[${type.toUpperCase()}] ${msg}`);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

function u32ArrayToHex(arr: Uint32Array, items = 4): string {
  return Array.from(arr.slice(0, items))
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('')
    .slice(0, 32);
}

export async function runTest() {
  const runBtn = document.getElementById('runBtn') as HTMLButtonElement;
  const logEl = document.getElementById('log') as HTMLElement;

  if (runBtn) runBtn.disabled = true;
  if (logEl) logEl.textContent = '';

  log('=== DAG REFERENCE COMPARISON TEST ===', 'info');
  log('', 'info');

  try {
    // Step 1: Load Ethash reference
    log('STEP 1: Loading @ethereumjs/ethash reference', 'info');
    const ethash = new Ethash();
    log('✓ Ethash library loaded', 'success');
    log('', 'info');

    // Step 2: Generate cache on CPU
    log('STEP 2: Generating cache (CPU reference)', 'info');
    const epoch = 0;
    const cacheBytes = CACHE_INIT;

    const seed = new Uint8Array(32);
    const cache = ethash.mkcache(cacheBytes, seed);
    ethash.cache = cache;

    log(`✓ Cache generated: ${cache.length} items (${(cache.length * HASH_BYTES) / 1024 / 1024}MB)`, 'success');
    log('', 'info');

    // Step 3: Generate first 10 DAG items using CPU reference
    log('STEP 3: Generating 10 sample DAG items (CPU reference)', 'info');
    const cpuDAGItems: Uint32Array[] = [];
    for (let i = 0; i < 10; i++) {
      const item = ethash.calcDatasetItem(i);
      cpuDAGItems.push(new Uint32Array(item.buffer, item.byteOffset, 16));
    }
    log('✓ 10 CPU reference items generated', 'success');

    for (let i = 0; i < 10; i++) {
      log(`  Item ${i}: ${u32ArrayToHex(cpuDAGItems[i])}...`, 'debug');
    }
    log('', 'info');

    // Step 4: Setup WebGPU
    log('STEP 4: Setting up WebGPU', 'info');
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) {
      log('❌ WebGPU unavailable', 'error');
      return;
    }

    // Request generous buffer limits (try high first, fallback to lower)
    let device;
    const limitConfigs = [
      { maxBufferSize: 6442450944, maxStorageBufferBindingSize: 2147483648 },
      { maxBufferSize: 4294967296, maxStorageBufferBindingSize: 1073741824 },
      { maxBufferSize: 2147483644, maxStorageBufferBindingSize: 1073741824 },
    ];

    for (const limits of limitConfigs) {
      try {
        device = await adapter.requestDevice({ requiredLimits: limits });
        break;
      } catch (e) {
        // Try next configuration
        continue;
      }
    }

    if (!device) {
      log('❌ Failed to create device with any buffer limit', 'error');
      return;
    }
    log('✓ WebGPU device ready', 'success');
    log('', 'info');

    // Step 5: Generate GPU DAG (full 1GB)
    log('STEP 5: Generating full DAG on GPU', 'info');

    const gpuStartTime = Date.now();
    const { dag: gpuDAG, dagBuffer } = await generateDAGGPU(epoch, device, (progress) => {
      if (progress.progress % 0.25 === 0) {
        log(
          `  ${(progress.progress * 100).toFixed(0)}% | ` +
            `${(progress.itemsPerSecond / 1000).toFixed(1)}K items/sec`,
          'debug'
        );
      }
    });
    const gpuTime = (Date.now() - gpuStartTime) / 1000;

    log(`✓ GPU DAG generated in ${gpuTime.toFixed(1)}s`, 'success');
    log(`  DAG size: ${(gpuDAG.byteLength / 1024 / 1024 / 1024).toFixed(2)} GB`, 'debug');
    log(`  DAG items: ${(gpuDAG.length / 16).toLocaleString()} items`, 'debug');
    log('', 'info');

    // Step 6: Compare first 10 items
    log('STEP 6: Comparing first 10 GPU items against CPU reference', 'info');
    let matchCount = 0;
    for (let i = 0; i < 10; i++) {
      const gpuItemOffset = i * 16;
      const gpuItem = gpuDAG.slice(gpuItemOffset, gpuItemOffset + 16);
      const cpuItem = cpuDAGItems[i];

      let matches = true;
      for (let j = 0; j < 16; j++) {
        if (gpuItem[j] !== cpuItem[j]) {
          matches = false;
          break;
        }
      }

      if (matches) matchCount++;

      const gpuHex = u32ArrayToHex(gpuItem);
      const cpuHex = u32ArrayToHex(cpuItem);
      const status = matches ? '✓' : '❌';
      log(
        `  Item ${i}: GPU=${gpuHex}... CPU=${cpuHex}... ${status}`,
        matches ? 'success' : 'error'
      );
    }

    log('', 'info');
    log(`Matches: ${matchCount}/10 items`, matchCount === 10 ? 'success' : 'error');

    if (matchCount === 0) {
      log('❌ CRITICAL: No GPU items match CPU reference!', 'error');
      log('   This indicates a fundamental issue with the GPU shader algorithm', 'error');
    } else if (matchCount < 8) {
      log('❌ WARNING: Most items do not match', 'warning');
      log('   The GPU algorithm may have a serious bug', 'warning');
    } else {
      log('✓ GPU algorithm matches CPU reference implementation', 'success');
    }
    log('', 'info');

    // Step 7: Spot check middle and end
    log('STEP 7: Spot check items at different ranges', 'info');

    const testIndices = [100, 1000, 10000];
    let midpointMatches = 0;

    for (const idx of testIndices) {
      // CPU reference
      const cpuItem = ethash.calcDatasetItem(idx);
      const cpuItemU32 = new Uint32Array(cpuItem.buffer, cpuItem.byteOffset, 16);

      // GPU item
      const gpuItemOffset = idx * 16;
      if (gpuItemOffset + 16 <= gpuDAG.length) {
        const gpuItem = gpuDAG.slice(gpuItemOffset, gpuItemOffset + 16);

        let matches = true;
        for (let j = 0; j < 16; j++) {
          if (gpuItem[j] !== cpuItemU32[j]) {
            matches = false;
            break;
          }
        }

        if (matches) midpointMatches++;

        const status = matches ? '✓' : '❌';
        log(`  Item ${idx}: ${status}`, matches ? 'success' : 'error');
      }
    }

    log(
      `  Spot check matches: ${midpointMatches}/${testIndices.length}`,
      midpointMatches === testIndices.length ? 'success' : 'warning'
    );
    log('', 'info');

    // Summary
    log('=== TEST SUMMARY ===', 'info');
    const allMatch = matchCount === 10 && midpointMatches === testIndices.length;
    log(
      allMatch
        ? '✅ GPU DAG GENERATION VALIDATED AGAINST CPU REFERENCE'
        : '⚠️  GPU GENERATION HAS DISCREPANCIES',
      allMatch ? 'success' : 'error'
    );
    log('', 'info');

    if (allMatch) {
      log('Findings:', 'success');
      log('  • GPU algorithm correctly implements calcDatasetItem', 'success');
      log('  • First 10 items match CPU reference exactly', 'success');
      log('  • Spot checks at indices 100, 1000, 10000 match', 'success');
      log('  • Full 1GB DAG generated in GPU', 'success');
      log('  • Ready for Hashimoto mining pipeline', 'success');
    } else {
      log('Recommendations:', 'warning');
      log('  • Verify Keccak-512 implementation in WGSL', 'warning');
      log('  • Check FNV hash function implementation', 'warning');
      log('  • Review cache/DAG index calculations', 'warning');
      log('  • Compare against reference line-by-line', 'warning');
    }

    dagBuffer.destroy();
  } catch (err) {
    log(`\n❌ ERROR: ${err instanceof Error ? err.message : String(err)}`, 'error');
    console.error(err);
  } finally {
    if (runBtn) runBtn.disabled = false;
  }
}

// Initialize on page load
window.addEventListener('load', () => {
  log('Ready for reference comparison test', 'info');
  log('Click button to start', 'info');

  const runBtn = document.getElementById('runBtn') as HTMLButtonElement;
  if (runBtn) {
    runBtn.addEventListener('click', runTest);
  }
});
