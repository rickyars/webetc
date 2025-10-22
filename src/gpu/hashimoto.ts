/**
 * GPU Hashimoto Implementation
 * Orchestrates cache + DAG transfer and Hashimoto mining on GPU
 */

import hashimotoShader from '../compute/hashimoto-shader.wgsl?raw';
import keccak512Shader from '../compute/keccak-512-shader.wgsl?raw';
import keccak256Shader from '../compute/keccak-256-shader.wgsl?raw';
import fnvShader from '../compute/fnv-shader.wgsl?raw';
import { generateCache } from '../crypto/ethash-reference';
import { generateDAGGPU } from './dag-builder';
import { runDifficultyFilterGPU } from './difficulty-filter';

export interface HashimotoResult {
  nonce: Uint8Array;
  hash: Uint8Array;
}

export interface HashimotoSetup {
  cache: Uint32Array;
  dag: Uint32Array;
  cacheBuffer: GPUBuffer;
  dagBuffer: GPUBuffer;
}

export interface HashimotoBatchResult {
  results: HashimotoResult[];
  timeMs: number;
  // Optional: difficulty filter results (if difficulty threshold provided)
  filterResult?: {
    validNonces: Uint8Array[];
    validCount: number;
    totalHashes: number;
    filterTimeMs: number;
  };
}

/**
 * Configuration for Hashimoto mining
 */
export interface MiningConfig {
  // Batch size: number of nonces to process per GPU kernel launch
  // Larger batches improve GPU utilization but may freeze browser UI longer
  // Recommended: 1,000 - 50,000 depending on GPU and responsiveness needs
  batchSize: number;
}

/**
 * Default mining configuration
 * Conservative for browser responsiveness
 */
export const DEFAULT_MINING_CONFIG: MiningConfig = {
  batchSize: 10_000, // Process 10k nonces per batch
};

/**
 * Setup Hashimoto on GPU for an epoch
 * - Generate cache and DAG
 * - Transfer to GPU memory (keep resident)
 * - Create buffers
 *
 * @param epoch Epoch number
 * @param device GPU device
 * @returns Setup object with buffers
 */
export async function setupHashimotoGPU(
  epoch: number,
  device: GPUDevice
): Promise<HashimotoSetup> {
  // Generate cache on CPU
  console.log(`Generating cache for epoch ${epoch}...`);
  const cache = await generateCache(epoch);
  console.log(`✓ Cache: ${(cache.byteLength / 1024 / 1024).toFixed(2)} MB`);

  // Create cache GPU buffer
  const cacheBuffer = device.createBuffer({
    size: cache.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(cacheBuffer.getMappedRange()).set(cache);
  cacheBuffer.unmap();

  // Generate DAG on worker thread (non-blocking) and upload to GPU
  console.log(`\nGenerating DAG for epoch ${epoch}...`);
  let dag: Uint32Array;
  let dagBuffer: GPUBuffer;

  try {
    const result = await generateDAGGPU(epoch, device, (progress) => {
      console.log(
        `  Progress: ${progress.progress}% (${progress.itemsCompleted.toLocaleString()}/${progress.totalItems.toLocaleString()} items, ${progress.itemsPerSecond.toLocaleString()} items/sec)`
      );
    });
    dag = result.dag;
    dagBuffer = result.dagBuffer;
  } catch (error) {
    console.error('DAG generation failed:', error);
    throw error;
  }

  console.log(`✓ DAG: ${(dag.byteLength / 1024 / 1024 / 1024).toFixed(2)} GB`);

  return {
    cache,
    dag,
    cacheBuffer,
    dagBuffer,
  };
}

/**
 * Run Hashimoto mining batch on GPU
 * Processes multiple nonces in parallel
 * Optionally filters results by difficulty threshold
 *
 * @param headerHash Block header hash (32 bytes)
 * @param nonces Array of nonces (8 bytes each) to process
 * @param device GPU device
 * @param setup Hashimoto setup from setupHashimotoGPU
 * @param config Mining configuration (batch size, etc.)
 * @param difficulty Optional difficulty threshold (as max_hash = 2^256 / difficulty). If provided, applies GPU difficulty filter.
 * @returns Array of (nonce, hash) pairs, optionally with difficulty filter results
 */
export async function runHashimotoBatchGPU(
  headerHash: Uint8Array,
  nonces: Uint8Array[],
  device: GPUDevice,
  setup: HashimotoSetup,
  config: MiningConfig = DEFAULT_MINING_CONFIG,
  difficulty?: bigint
): Promise<HashimotoBatchResult> {
  const startTime = performance.now();

  // Convert inputs to u32 arrays
  const headerHashU32 = new Uint32Array(headerHash.buffer, headerHash.byteOffset, 8);

  const noncesU32Data = new Uint32Array(nonces.length * 2);
  for (let i = 0; i < nonces.length; i++) {
    const view = new DataView(nonces[i].buffer, nonces[i].byteOffset, 8);
    noncesU32Data[i * 2] = view.getUint32(0, true);
    noncesU32Data[i * 2 + 1] = view.getUint32(4, true);
  }

  // Create input/output buffers
  const headerHashBuffer = device.createBuffer({
    size: headerHashU32.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(headerHashBuffer.getMappedRange()).set(headerHashU32);
  headerHashBuffer.unmap();

  const noncesBuffer = device.createBuffer({
    size: noncesU32Data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(noncesBuffer.getMappedRange()).set(noncesU32Data);
  noncesBuffer.unmap();

  const hashesBuffer = device.createBuffer({
    size: nonces.length * 32, // 8 u32 per nonce = 32 bytes (final Keccak-256 hash)
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const paramsBuffer = device.createBuffer({
    size: 16, // vec4<u32>
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  const paramsData = new Uint32Array(paramsBuffer.getMappedRange());

  // Store values to local variables BEFORE unmapping
  const num_nonces = nonces.length;
  const n_items = setup.dag.length / 16;
  const cache_items = setup.cache.length / 16;

  paramsData[0] = num_nonces;
  paramsData[1] = n_items;
  paramsData[2] = cache_items;

  console.log('DEBUG: Hashimoto params (before unmap):');
  console.log(`  num_nonces = ${paramsData[0]}`);
  console.log(`  dag_items (n) = ${paramsData[1]}`);

  paramsBuffer.unmap();

  // Log after unmap using stored values
  console.log('DEBUG: Hashimoto params (after unmap, using stored values):');
  console.log(`  num_nonces = ${num_nonces}`);
  console.log(`  dag_items (n) = ${n_items}`);
  console.log(`  dag_items as decimal = ${n_items.toString()}`);
  console.log(`  dag_items / 2 = ${(n_items / 2).toString()}`);
  console.log(`  dag.length = ${setup.dag.length.toString()}`);
  console.log(`  dag.byteLength = ${setup.dag.byteLength.toString()}`);
  console.log(`  Verify: dag.length / 16 = ${(setup.dag.length / 16).toString()}`);
  console.log(`  (Should match dag_items: ${n_items.toString()})`);
  console.log(`  Max DAG index p = ${((n_items / 2) * 2 - 2).toString()}`);
  console.log(`  Max DAG u32 offset = ${(((n_items / 2) * 2 - 2) * 16).toString()}`);

  // Create compute pipeline with explicit layout to ensure all bindings are preserved
  // Concatenate Keccak functions from their respective shaders
  // Extract only the function definitions (not the entry points)
  const lines512 = keccak512Shader.split('\n');
  const lines256 = keccak256Shader.split('\n');

  // Find the RC constant definition and function start/end for each shader
  let rcStartIdx = 0;
  let rcEndIdx = 0;
  let keccak512FuncStartIdx = 0;
  let keccak512EndIdx = 0;
  let keccak256FuncStartIdx = 0;
  let keccak256EndIdx = 0;

  // Find RC constant (appears at the start of keccak512 shader)
  for (let i = 0; i < lines512.length; i++) {
    if (lines512[i].includes('const RC = array<u32, 48>')) {
      rcStartIdx = i;
      // Find the closing of this const (the line with ");")
      for (let j = i; j < lines512.length; j++) {
        if (lines512[j].includes(');')) {
          rcEndIdx = j;
          break;
        }
      }
      break;
    }
  }

  // Find keccak512 function
  for (let i = 0; i < lines512.length; i++) {
    if (lines512[i].includes('fn keccak512(')) {
      keccak512FuncStartIdx = i;
    }
    if (keccak512FuncStartIdx > 0 && lines512[i].includes('return output;')) {
      keccak512EndIdx = i + 1;
      break;
    }
  }

  // Find keccak256 function
  for (let i = 0; i < lines256.length; i++) {
    if (lines256[i].includes('fn keccak256(')) {
      keccak256FuncStartIdx = i;
    }
    if (keccak256FuncStartIdx > 0 && lines256[i].includes('return output;')) {
      keccak256EndIdx = i + 1;
      break;
    }
  }

  // Build shader code: FNV functions + RC constant + Keccak functions + Hashimoto shader
  const rcCode = lines512.slice(rcStartIdx, rcEndIdx + 1).join('\n');
  const keccak512FunctionCode = lines512.slice(keccak512FuncStartIdx, keccak512EndIdx + 1).join('\n');
  const keccak256FunctionCode = lines256.slice(keccak256FuncStartIdx, keccak256EndIdx + 1).join('\n');

  const combinedShader = fnvShader + '\n\n' + rcCode + '\n\n' + keccak512FunctionCode + '\n\n' + keccak256FunctionCode + '\n\n' + hashimotoShader;

  let shaderModule: GPUShaderModule;
  try {
    shaderModule = device.createShaderModule({ code: combinedShader });

    // Check for compilation errors (async - don't wait for now)
    if (shaderModule.getCompilationInfo) {
      shaderModule.getCompilationInfo?.().then(info => {
        for (const msg of info.messages) {
          if (msg.type === 'error') {
            console.error(`🔴 SHADER COMPILATION ERROR at line ${msg.lineNum}:`, msg.message);
          } else if (msg.type === 'warning') {
            console.warn(`🟡 SHADER WARNING at line ${msg.lineNum}:`, msg.message);
          }
        }
      }).catch(e => console.log('Could not get compilation info:', e));
    }
  } catch (error) {
    console.error('❌ Failed to create shader module:', error);
    throw error;
  }

  // Explicit bind group layout - NOTE: Hashimoto doesn't actually use cache buffer,
  // only the DAG. We keep cache in the bind group for future use or consistency,
  // but the shader may optimize it out. This can cause validation errors with 'auto' layout.
  // Using explicit layout with only the bindings the shader actually uses:
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // header_hash
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // nonces
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // dag (actually used)
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },           // hashes
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },           // params
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });

  const pipeline = device.createComputePipeline({
    layout: pipelineLayout,
    compute: { module: shaderModule, entryPoint: 'main' },
  });

  // Log binding information for debugging
  console.log('Pipeline created successfully');
  console.log('');
  console.log('Bind group configuration:');
  console.log('  Binding 0 (header_hash): size=' + headerHashBuffer.size + ' bytes (should be 32)');
  console.log('  Binding 1 (nonces): size=' + noncesBuffer.size + ' bytes');
  console.log('  Binding 3 (dag): size=' + setup.dagBuffer.size + ' bytes = ' + (setup.dagBuffer.size / 1024 / 1024 / 1024).toFixed(2) + 'GB');
  console.log('  Binding 4 (hashes): size=' + hashesBuffer.size + ' bytes (should be ' + (nonces.length * 32) + ')');
  console.log('  Binding 5 (params): size=' + paramsBuffer.size + ' bytes');

  // Create bind group - NOTE: Binding 2 (cache) is not included since Hashimoto shader doesn't use it
  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: headerHashBuffer } },
      { binding: 1, resource: { buffer: noncesBuffer } },
      { binding: 3, resource: { buffer: setup.dagBuffer } },
      { binding: 4, resource: { buffer: hashesBuffer } },
      { binding: 5, resource: { buffer: paramsBuffer } },
    ],
  });

  console.log('✓ Bind group created successfully');

  // Execute shader
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);

  const workgroupsNeeded = Math.ceil(nonces.length / 32);
  passEncoder.dispatchWorkgroups(workgroupsNeeded, 1, 1);
  passEncoder.end();

  // Copy results to staging buffer
  const stagingBuffer = device.createBuffer({
    size: nonces.length * 32,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  commandEncoder.copyBufferToBuffer(
    hashesBuffer,
    0,
    stagingBuffer,
    0,
    nonces.length * 32
  );

  device.queue.submit([commandEncoder.finish()]);

  // Read results
  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const hashesData = new Uint32Array(stagingBuffer.getMappedRange()).slice();
  stagingBuffer.unmap();

  // Parse results (final Keccak-256 hash output - 32 bytes)
  const results: HashimotoResult[] = [];
  for (let i = 0; i < nonces.length; i++) {
    const hashU32 = hashesData.slice(i * 8, (i + 1) * 8);
    const hashBytes = new Uint8Array(hashU32.buffer, hashU32.byteOffset, 32);
    results.push({
      nonce: nonces[i],
      hash: hashBytes,
    });
  }

  // Cleanup
  headerHashBuffer.destroy();
  noncesBuffer.destroy();
  hashesBuffer.destroy();
  paramsBuffer.destroy();
  stagingBuffer.destroy();

  const endTime = performance.now();
  const hashimotoTimeMs = endTime - startTime;

  // Optionally apply difficulty filter
  let filterResult;
  if (difficulty !== undefined) {
    console.log(`\nApplying GPU difficulty filter (threshold: ${difficulty.toString()})...`);
    const filterStart = performance.now();

    const filter = await runDifficultyFilterGPU(
      results.map(r => r.hash),
      results.map(r => r.nonce),
      difficulty,
      device
    );

    const filterTimeMs = performance.now() - filterStart;

    filterResult = {
      validNonces: filter.validNonces,
      validCount: filter.validCount,
      totalHashes: filter.totalHashes,
      filterTimeMs,
    };

    console.log(`✓ Difficulty filter complete: ${filterResult.validCount}/${filterResult.totalHashes} winners`);
    console.log(`  Filter time: ${filterTimeMs.toFixed(2)}ms`);
  }

  return {
    results,
    timeMs: hashimotoTimeMs,
    filterResult,
  };
}

/**
 * Validate GPU Hashimoto against CPU reference
 * Compares GPU results against @ethereumjs/ethash implementation
 *
 * @param gpuResults GPU Hashimoto results
 * @param headerHash Block header hash used for mining
 * @param setup Hashimoto setup with cache and DAG
 * @returns Object with match status and details
 */
export async function validateHashimotoGPU(
  gpuResults: HashimotoResult[],
  headerHash: Uint8Array,
  setup: HashimotoSetup
): Promise<{ allMatch: boolean; details: string[] }> {
  const { Ethash } = await import('@ethereumjs/ethash');

  const details: string[] = [];
  let allMatch = true;

  // Validate structure first (expecting 32-byte final hash)
  for (const result of gpuResults) {
    if (result.hash.length !== 32) {
      details.push(`❌ Hash length mismatch: ${result.hash.length} != 32`);
      allMatch = false;
      break;
    }
    if (result.nonce.length !== 8) {
      details.push(`❌ Nonce length mismatch: ${result.nonce.length} != 8`);
      allMatch = false;
      break;
    }
  }

  if (!allMatch) {
    return { allMatch, details };
  }

  // Validate against CPU reference
  const ethash = new Ethash();

  // Setup DAG in ethash instance
  const cacheArray: Uint8Array[] = [];
  for (let i = 0; i < setup.cache.length; i += 16) {
    const itemU32 = setup.cache.slice(i, i + 16);
    const itemBytes = new Uint8Array(itemU32.buffer, itemU32.byteOffset, 64);
    cacheArray.push(itemBytes);
  }
  ethash.cache = cacheArray;
  ethash.fullSize = setup.dag.length * 4; // Convert u32 count to bytes

  details.push(`FINAL VALIDATION: Comparing GPU final hash against CPU ethash.run().hash`);

  for (let i = 0; i < gpuResults.length; i++) {
    const gpuResult = gpuResults[i];

    try {
      // Run CPU reference
      const cpuResult = ethash.run(headerHash, gpuResult.nonce, ethash.fullSize);

      // Compare final hashes
      const gpu_hash_hex = Array.from(gpuResult.hash)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const cpu_hash_hex = Array.from(cpuResult.hash)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      if (gpu_hash_hex === cpu_hash_hex) {
        details.push(`✓ Nonce ${i}: HASH MATCH!`);
        details.push(`  Hash: 0x${gpu_hash_hex}`);
      } else {
        details.push(`✗ Nonce ${i}: HASH MISMATCH`);
        details.push(`  GPU:  0x${gpu_hash_hex}`);
        details.push(`  CPU:  0x${cpu_hash_hex}`);
        allMatch = false;
      }
    } catch (error) {
      details.push(`✗ Nonce ${i}: ERROR - ${error instanceof Error ? error.message : String(error)}`);
      allMatch = false;
    }
  }

  return { allMatch, details };
}
