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
): Promise<{ dag: Uint32Array; dagBuffer: GPUBuffer }> {
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

  // Step 4: Create DAG output buffer
  // IMPORTANT: Use COPY_SRC so we can read it back AND verify data was written
  const dagBuffer = device.createBuffer({
    size: datasetBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });

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

  // Step 7: Create bind group
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: cacheBuffer } },
      { binding: 1, resource: { buffer: dagBuffer } },
      { binding: 2, resource: { buffer: paramsBuffer } },
    ],
  });

  // Step 8: Dispatch GPU kernel
  const startTime = Date.now();
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);

  console.log(`[DAG-GPU] Total workgroups needed: ${totalWorkgroups.toLocaleString()}`);
  console.log(`[DAG-GPU] Dispatching ${workgroupsX} x ${workgroupsY} = ${workgroupsX * workgroupsY} workgroups (${numDAGItems.toLocaleString()} items)`);

  passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY, 1);
  passEncoder.end();

  // Step 9: Read back DAG from GPU
  console.log(`[DAG-GPU] Reading DAG from GPU...`);
  const stagingBuffer = device.createBuffer({
    size: datasetBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  // Copy the compute output to staging buffer - this happens AFTER compute shader finishes
  const copyEncoder = device.createCommandEncoder();
  copyEncoder.copyBufferToBuffer(dagBuffer, 0, stagingBuffer, 0, datasetBytes);

  // Submit BOTH commands together so they execute in order
  device.queue.submit([commandEncoder.finish(), copyEncoder.finish()]);

  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const dagData = new Uint32Array(stagingBuffer.getMappedRange()).slice();
  stagingBuffer.unmap();

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`[DAG-GPU] ✓ DAG generation complete: ${(datasetBytes / 1024 / 1024 / 1024).toFixed(2)} GB in ${totalTime.toFixed(1)}s`);

  // Verify DAG has non-zero data
  let nonZeroCount = 0;
  for (let i = 0; i < Math.min(dagData.length, 1000); i++) {
    if (dagData[i] !== 0) nonZeroCount++;
  }
  console.log(`[DAG-GPU] Verification: ${nonZeroCount}/1000 first u32s are non-zero`);
  if (nonZeroCount === 0) {
    console.error(`[DAG-GPU] ❌ WARNING: DAG readback is all zeros! Shader may not be writing correctly.`);
  }

  // Cleanup temp buffers
  cacheBuffer.destroy();
  paramsBuffer.destroy();
  stagingBuffer.destroy();
  dagBuffer.destroy(); // Destroy the compute output buffer

  // dagData is the readback copy - use this to create a fresh GPU buffer for Hashimoto
  const dag = new Uint32Array(dagData.buffer, dagData.byteOffset, datasetBytes / 4);

  // Create a NEW GPU buffer with the actual DAG data for Hashimoto to use
  console.log(`[DAG-GPU] Creating final GPU buffer with DAG data for Hashimoto...`);
  const finalDAGBuffer = device.createBuffer({
    size: datasetBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
  });
  new Uint32Array(finalDAGBuffer.getMappedRange()).set(dag);
  finalDAGBuffer.unmap();

  console.log(`[DAG-GPU] Returning DAG: GPU buffer ready for Hashimoto`);
  return { dag, dagBuffer: finalDAGBuffer };
}
