/**
 * GPU Device Helper - Centralized device creation with generous buffer limits
 *
 * This ensures all code uses the same device creation strategy with appropriate limits
 * for large DAG buffers (4GB+) and other allocations.
 */

export async function createGPUDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU not available');
  }

  // Get adapter limits to see baseline
  console.log('[GPU] Adapter baseline limits:', {
    maxBufferSize: `${(adapter.limits.maxBufferSize / 1024 / 1024 / 1024).toFixed(2)}GB`,
    maxStorageBufferBindingSize: `${(adapter.limits.maxStorageBufferBindingSize / 1024 / 1024 / 1024).toFixed(2)}GB`,
  });

  // Request limits for Ethereum DAG storage
  // WebGPU spec hard limit for maxBufferSize is 2^31 (2147483648 = 2GB)
  // Epoch 0 DAG is ~1GB, so 2GB limit is sufficient
  // We try progressively smaller limits until one succeeds
  const limitOptions = [
    {
      maxBufferSize: 2147483648, // 2GB (WebGPU spec maximum for maxBufferSize)
      maxStorageBufferBindingSize: 2147483644, // 2GB - 4 bytes (spec limit)
    },
    {
      maxBufferSize: 1610612736, // 1.5GB
      maxStorageBufferBindingSize: 1073741824, // 1GB
    },
    {
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    },
  ];

  for (const limits of limitOptions) {
    try {
      console.log(`[GPU] Requesting device with maxBufferSize=${(limits.maxBufferSize / 1024 / 1024 / 1024).toFixed(1)}GB...`);
      const device = await adapter.requestDevice({
        requiredLimits: limits,
      });
      console.log(`[GPU] ✓ Device created successfully with limits:`, {
        maxBufferSize: `${(device.limits.maxBufferSize / 1024 / 1024 / 1024).toFixed(2)}GB`,
        maxStorageBufferBindingSize: `${(device.limits.maxStorageBufferBindingSize / 1024 / 1024 / 1024).toFixed(2)}GB`,
      });
      return device;
    } catch (e) {
      console.log(`[GPU] Failed with ${(limits.maxBufferSize / 1024 / 1024 / 1024).toFixed(1)}GB: ${(e as Error).message}`);
    }
  }

  throw new Error('[GPU] Failed to create device with any limit configuration');
}
