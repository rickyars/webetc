/**
 * GPU Difficulty Filter
 * Filters Hashimoto outputs to find nonces meeting difficulty threshold
 * Massively reduces GPU→CPU transfer bandwidth by only returning winning nonces
 */

import difficultyFilterShader from '../compute/difficulty-filter-shader.wgsl?raw';

export interface FilterResult {
  validNonces: Uint8Array[]; // Winning nonces (8 bytes each)
  totalHashes: number;
  validCount: number;
  timeMs: number;
}

/**
 * Run GPU difficulty filter on batch of hashes
 *
 * @param hashes Array of Keccak-256 hashes (32 bytes each)
 * @param nonces Array of corresponding nonces (8 bytes each)
 * @param difficulty Target difficulty (as max_hash threshold)
 * @param device GPU device
 * @returns Filtered results with winning nonces
 */
export async function runDifficultyFilterGPU(
  hashes: Uint8Array[],
  nonces: Uint8Array[],
  difficulty: bigint,
  device: GPUDevice
): Promise<FilterResult> {
  const startTime = performance.now();

  if (hashes.length !== nonces.length) {
    throw new Error('Hashes and nonces array lengths must match');
  }

  const numHashes = hashes.length;

  // Convert hashes to u32 array (8 u32s per hash = 32 bytes)
  const hashesU32Data = new Uint32Array(numHashes * 8);
  for (let i = 0; i < numHashes; i++) {
    const hashView = new DataView(hashes[i].buffer, hashes[i].byteOffset, 32);
    for (let j = 0; j < 8; j++) {
      hashesU32Data[i * 8 + j] = hashView.getUint32(j * 4, true);
    }
  }

  // Convert nonces to u32 array (2 u32s per nonce = 8 bytes)
  const noncesU32Data = new Uint32Array(numHashes * 2);
  for (let i = 0; i < numHashes; i++) {
    const nonceView = new DataView(nonces[i].buffer, nonces[i].byteOffset, 8);
    noncesU32Data[i * 2] = nonceView.getUint32(0, true);
    noncesU32Data[i * 2 + 1] = nonceView.getUint32(4, true);
  }

  // Create GPU buffers
  const hashesBuffer = device.createBuffer({
    size: hashesU32Data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(hashesBuffer.getMappedRange()).set(hashesU32Data);
  hashesBuffer.unmap();

  const noncesBuffer = device.createBuffer({
    size: noncesU32Data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(noncesBuffer.getMappedRange()).set(noncesU32Data);
  noncesBuffer.unmap();

  // Valid nonces output buffer (worst case: all pass)
  const validNoncesBuffer = device.createBuffer({
    size: numHashes * 8, // PooledNonce = 2 u32s = 8 bytes
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  // Counter for valid nonces (atomic)
  const validCountBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
  });
  new Uint32Array(validCountBuffer.getMappedRange()).set([0]);
  validCountBuffer.unmap();

  // Parameters buffer - storage buffer (no alignment restrictions)
  // Layout: array<u32, 10> where [0]=num_hashes, [1]=unused, [2..9]=threshold
  const paramsBuffer = device.createBuffer({
    size: 40,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  const paramsData = new Uint32Array(paramsBuffer.getMappedRange());

  paramsData[0] = numHashes;      // params[0] = num_hashes
  paramsData[1] = 0;               // params[1] = unused

  // Convert difficulty to max_hash threshold (full 256-bit value)
  // The difficulty parameter is a 256-bit BigInt (e.g., 2^255)
  // We need to store all 8 u32s that represent this value in little-endian
  // Store at params[2..9]
  for (let i = 0; i < 8; i++) {
    const shift = BigInt(i * 32);
    const mask = BigInt(0xffffffff);
    paramsData[2 + i] = Number((difficulty >> shift) & mask);
  }
  paramsBuffer.unmap();

  // Create compute pipeline
  const shaderModule = device.createShaderModule({ code: difficultyFilterShader });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'main' },
  });

  // Create bind group
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: hashesBuffer } },
      { binding: 1, resource: { buffer: noncesBuffer } },
      { binding: 2, resource: { buffer: validNoncesBuffer } },
      { binding: 3, resource: { buffer: validCountBuffer } },
      { binding: 4, resource: { buffer: paramsBuffer } },
    ],
  });

  // Execute filter kernel
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);

  const workgroupsNeeded = Math.ceil(numHashes / 32);
  passEncoder.dispatchWorkgroups(workgroupsNeeded, 1, 1);
  passEncoder.end();

  // Read back results
  const stagingValidNoncesBuffer = device.createBuffer({
    size: numHashes * 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const stagingCountBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  commandEncoder.copyBufferToBuffer(validNoncesBuffer, 0, stagingValidNoncesBuffer, 0, numHashes * 8);
  commandEncoder.copyBufferToBuffer(validCountBuffer, 0, stagingCountBuffer, 0, 4);

  device.queue.submit([commandEncoder.finish()]);

  // Read count
  await stagingCountBuffer.mapAsync(GPUMapMode.READ);
  const countData = new Uint32Array(stagingCountBuffer.getMappedRange()).slice();
  stagingCountBuffer.unmap();
  const validCount = countData[0];

  // Read valid nonces
  await stagingValidNoncesBuffer.mapAsync(GPUMapMode.READ);
  const validNoncesData = new Uint32Array(stagingValidNoncesBuffer.getMappedRange()).slice();
  stagingValidNoncesBuffer.unmap();

  // Parse results
  const validNonces: Uint8Array[] = [];
  for (let i = 0; i < validCount; i++) {
    const nonceU32 = validNoncesData.slice(i * 2, (i + 1) * 2);
    const nonceBytes = new Uint8Array(nonceU32.buffer, nonceU32.byteOffset, 8);
    validNonces.push(new Uint8Array(nonceBytes));
  }

  // Cleanup
  hashesBuffer.destroy();
  noncesBuffer.destroy();
  validNoncesBuffer.destroy();
  validCountBuffer.destroy();
  paramsBuffer.destroy();
  stagingValidNoncesBuffer.destroy();
  stagingCountBuffer.destroy();

  const endTime = performance.now();

  return {
    validNonces,
    totalHashes: numHashes,
    validCount,
    timeMs: endTime - startTime,
  };
}
