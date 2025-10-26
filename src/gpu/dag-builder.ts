/**
 * GPU DAG Builder - Calls GPU compute shader to generate full DAG
 * Direct port of @ethereumjs/ethash calcDatasetItem algorithm to WGSL
 */

import keccak512Shader from '../compute/keccak-512-shader.wgsl?raw';
import fnvShader from '../compute/fnv-shader.wgsl?raw';
import dagBuilderShader from '../compute/dag-builder-shader.wgsl?raw';
import { Ethash } from '@ethereumjs/ethash';

const HASH_BYTES = 64;
const DATASET_BYTES_INIT = 1073741824; // 2^30 (1GB)
const DATASET_BYTES_GROWTH = 8388608;  // 2^23 (8MB)
const CACHE_BYTES_INIT = 16 * 1024 * 1024;
const CACHE_BYTES_GROWTH = 128 * 1024;

export interface DAGGenerationProgress {
  progress: number;
  itemsCompleted: number;
  totalItems: number;
  itemsPerSecond: number;
}

export async function generateDAGGPU(
  epoch: number,
  device: GPUDevice,
  onProgress?: (progress: DAGGenerationProgress) => void
): Promise<{ dag: Uint32Array; dagBuffers: GPUBuffer[] }> {
  console.log(`[DAG-GPU] Starting GPU DAG generation for epoch ${epoch}...`);

  // Step 1: Generate cache on CPU
  const cacheBytes = CACHE_BYTES_INIT + epoch * CACHE_BYTES_GROWTH;
  const ethash = new Ethash();
  const seed = new Uint8Array(32);
  const cache = ethash.mkcache(cacheBytes, seed);
  const numCacheItems = cache.length;

  console.log(`[DAG-GPU] Cache: ${numCacheItems} items (${numCacheItems * HASH_BYTES / 1024 / 1024}MB)`);

  // Step 2: Calculate DAG size
  const datasetBytes = DATASET_BYTES_INIT + epoch * DATASET_BYTES_GROWTH;
  const numDAGItems = Math.floor(datasetBytes / HASH_BYTES);

  console.log(`[DAG-GPU] DAG: ${numDAGItems.toLocaleString()} items (${(datasetBytes / 1024 / 1024 / 1024).toFixed(2)}GB)`);
  console.log(`[DAG-GPU] Dispatching GPU kernel to generate DAG...`);

  // Step 3: Upload cache to GPU
  const cacheU32 = new Uint32Array(HASH_BYTES * numCacheItems / 4);
  let offset = 0;
  for (const item of cache) {
    const view = new Uint32Array(item.buffer, item.byteOffset, 16);
    cacheU32.set(view, offset);
    offset += 16;
  }

  const cacheBuffer = device.createBuffer({
    size: cacheU32.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(cacheBuffer.getMappedRange()).set(cacheU32);
  cacheBuffer.unmap();

  // Step 4: Create DAG output buffers (split if >2.15 GB)
  const maxBufferSize = device.limits.maxStorageBufferBindingSize;
  const numBuffers = Math.ceil(datasetBytes / maxBufferSize);
  const itemsPerBuffer = Math.ceil(numDAGItems / numBuffers);

  console.log(`[DAG-GPU] Splitting DAG into ${numBuffers} buffer(s) (max ${(maxBufferSize / 1024 / 1024 / 1024).toFixed(2)} GB each)`);

  const dagBuffers: GPUBuffer[] = [];
  for (let i = 0; i < numBuffers; i++) {
    const startItem = i * itemsPerBuffer;
    const endItem = Math.min((i + 1) * itemsPerBuffer, numDAGItems);
    const actualItems = endItem - startItem;
    const actualBytes = actualItems * HASH_BYTES;

    const buffer = device.createBuffer({
      size: actualBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    dagBuffers.push(buffer);
    console.log(`[DAG-GPU]   Buffer ${i}: ${actualItems.toLocaleString()} items (${(actualBytes / 1024 / 1024 / 1024).toFixed(2)} GB)`);
  }

  // Step 5: Calculate workgroup dispatch
  const itemsPerWorkgroup = 32;
  const totalWorkgroups = Math.ceil(numDAGItems / itemsPerWorkgroup);

  let workgroupsX = totalWorkgroups;
  let workgroupsY = 1;

  if (workgroupsX > 65535) {
    // Split across Y dimension
    workgroupsY = Math.ceil(workgroupsX / 65535);
    workgroupsX = Math.ceil(totalWorkgroups / workgroupsY);
  }

  // Step 6: Create params buffer (include workgroupsX for index calculation)
  const paramsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  const params = new Uint32Array(paramsBuffer.getMappedRange());
  params[0] = numCacheItems;
  params[1] = numDAGItems;
  params[2] = workgroupsX;
  params[3] = itemsPerWorkgroup;
  paramsBuffer.unmap();

  // Step 6: Create compute pipeline
  // Concatenate shader dependencies: Keccak-512 function + FNV functions + DAG builder shader
  // Extract only the keccak512 function (skip entry point)
  const lines512 = keccak512Shader.split('\n');

  // Find RC constant start (at beginning)
  let rcStartIdx = 0;
  let rcEndIdx = 0;
  for (let i = 0; i < lines512.length; i++) {
    if (lines512[i].includes('const RC = array<u32, 48>')) {
      rcStartIdx = i;
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
  let keccak512FuncStartIdx = 0;
  let keccak512EndIdx = 0;
  for (let i = 0; i < lines512.length; i++) {
    if (lines512[i].includes('fn keccak512(')) {
      keccak512FuncStartIdx = i;
    }
    if (keccak512FuncStartIdx > 0 && lines512[i].includes('return output;')) {
      keccak512EndIdx = i + 1;
      break;
    }
  }

  const rcCode = lines512.slice(rcStartIdx, rcEndIdx + 1).join('\n');
  const keccak512Code = lines512.slice(keccak512FuncStartIdx, keccak512EndIdx + 1).join('\n');
  const combinedShader = rcCode + '\n\n' + fnvShader + '\n\n' + keccak512Code + '\n\n' + dagBuilderShader;
  const shaderModule = device.createShaderModule({ code: combinedShader });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'main' },
  });

  // Step 7-8: Generate DAG in chunks (one chunk per buffer)
  const startTime = Date.now();
  const dagDataChunks: Uint32Array[] = [];

  console.log(`[DAG-GPU] Generating ${numBuffers} chunk(s)...`);

  for (let bufferIdx = 0; bufferIdx < numBuffers; bufferIdx++) {
    const startItem = bufferIdx * itemsPerBuffer;
    const endItem = Math.min((bufferIdx + 1) * itemsPerBuffer, numDAGItems);
    const chunkItems = endItem - startItem;
    const chunkBytes = chunkItems * HASH_BYTES;

    console.log(`[DAG-GPU] Chunk ${bufferIdx + 1}/${numBuffers}: items ${startItem.toLocaleString()}-${endItem.toLocaleString()}`);

    // Update params for this chunk
    const chunkParamsBuffer = device.createBuffer({
      size: 20,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    const chunkParams = new Uint32Array(chunkParamsBuffer.getMappedRange());
    chunkParams[0] = numCacheItems;
    chunkParams[1] = chunkItems;        // Number of items in THIS chunk
    chunkParams[2] = workgroupsX;
    chunkParams[3] = itemsPerWorkgroup;
    chunkParams[4] = startItem;         // Offset for DAG item indices
    chunkParamsBuffer.unmap();

    // Create bind group for this chunk
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: cacheBuffer } },
        { binding: 1, resource: { buffer: dagBuffers[bufferIdx] } },
        { binding: 2, resource: { buffer: chunkParamsBuffer } },
      ],
    });

    // Dispatch compute for this chunk
    const chunkWorkgroups = Math.ceil(chunkItems / itemsPerWorkgroup);
    let chunkWorkgroupsX = chunkWorkgroups;
    let chunkWorkgroupsY = 1;

    if (chunkWorkgroupsX > 65535) {
      chunkWorkgroupsY = Math.ceil(chunkWorkgroupsX / 65535);
      chunkWorkgroupsX = Math.ceil(chunkWorkgroups / chunkWorkgroupsY);
    }

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(chunkWorkgroupsX, chunkWorkgroupsY, 1);
    passEncoder.end();

    // Read back this chunk
    const stagingBuffer = device.createBuffer({
      size: chunkBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const copyEncoder = device.createCommandEncoder();
    copyEncoder.copyBufferToBuffer(dagBuffers[bufferIdx], 0, stagingBuffer, 0, chunkBytes);

    device.queue.submit([commandEncoder.finish(), copyEncoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const chunkData = new Uint32Array(stagingBuffer.getMappedRange()).slice();
    stagingBuffer.unmap();

    dagDataChunks.push(chunkData);

    // Cleanup temp buffers
    stagingBuffer.destroy();
    chunkParamsBuffer.destroy();

    // Progress callback
    if (onProgress) {
      const itemsCompleted = endItem;
      const progress = Math.floor((itemsCompleted / numDAGItems) * 100);
      onProgress({
        progress,
        itemsCompleted,
        totalItems: numDAGItems,
        itemsPerSecond: itemsCompleted / ((Date.now() - startTime) / 1000),
      });
    }
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`[DAG-GPU] ✓ DAG generation complete: ${(datasetBytes / 1024 / 1024 / 1024).toFixed(2)} GB in ${totalTime.toFixed(1)}s`);

  // Verify first chunk has non-zero data
  let nonZeroCount = 0;
  for (let i = 0; i < Math.min(dagDataChunks[0].length, 1000); i++) {
    if (dagDataChunks[0][i] !== 0) nonZeroCount++;
  }
  console.log(`[DAG-GPU] Verification: ${nonZeroCount}/1000 first u32s are non-zero`);
  if (nonZeroCount === 0) {
    console.error(`[DAG-GPU] ❌ WARNING: DAG readback is all zeros! Shader may not be writing correctly.`);
  }

  // Cleanup temp buffers
  cacheBuffer.destroy();
  paramsBuffer.destroy();

  // Create a minimal DAG array for metadata (just store the chunks without combining)
  // This avoids allocating 2.56+ GB in browser memory
  console.log(`[DAG-GPU] Creating DAG metadata (keeping ${dagDataChunks.length} chunks separate to save memory)...`);

  // Create a view that concatenates chunks without extra allocation
  // Note: This is a virtual view - chunks stay separate in memory
  const dag = {
    length: numDAGItems * 16,
    byteLength: datasetBytes,
    chunks: dagDataChunks,
    // Implement array-like access for compatibility
    subarray(start: number, end?: number) {
      // This is only used for buffer slicing during setup
      const chunkSize = dagDataChunks[0].length;
      const chunkIdx = Math.floor(start / chunkSize);
      const offsetInChunk = start % chunkSize;
      const actualEnd = end ?? this.length;
      const length = actualEnd - start;

      if (chunkIdx >= dagDataChunks.length) {
        return new Uint32Array(0);
      }

      // Simple case: within single chunk
      if (Math.floor((actualEnd - 1) / chunkSize) === chunkIdx) {
        return dagDataChunks[chunkIdx].subarray(offsetInChunk, offsetInChunk + length);
      }

      // Cross-chunk case: need to allocate
      const result = new Uint32Array(length);
      let resultOffset = 0;
      let remaining = length;
      let currentChunk = chunkIdx;
      let currentOffset = offsetInChunk;

      while (remaining > 0 && currentChunk < dagDataChunks.length) {
        const available = dagDataChunks[currentChunk].length - currentOffset;
        const toCopy = Math.min(remaining, available);
        result.set(dagDataChunks[currentChunk].subarray(currentOffset, currentOffset + toCopy), resultOffset);
        resultOffset += toCopy;
        remaining -= toCopy;
        currentChunk++;
        currentOffset = 0;
      }

      return result;
    }
  } as any as Uint32Array;

  console.log(`[DAG-GPU] Returning ${dagBuffers.length} DAG buffer(s) ready for Hashimoto`);
  return { dag, dagBuffers };
}
