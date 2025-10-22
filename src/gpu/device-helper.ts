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

  // Request generous limits for large buffers
  // Note: WebGPU spec limits maxStorageBufferBindingSize to 2^31 - 4 bytes (2147483644)
  // Even though hardware can handle more, the spec enforces this ceiling
  const limitOptions = [
    {
      maxBufferSize: 6442450944, // 6GB - ideal for current Ethereum DAG
      maxStorageBufferBindingSize: 2147483644, // 2GB - 4 bytes (WebGPU spec limit)
    },
    {
      maxBufferSize: 4294967296, // 4GB - fallback
      maxStorageBufferBindingSize: 1073741824, // 1GB for shader storage
    },
    {
      maxBufferSize: 2147483644, // 2GB - conservative
      maxStorageBufferBindingSize: 1073741824, // 1GB for shader storage
    },
  ];

  let lastError: Error | null = null;

  for (const limits of limitOptions) {
    try {
      console.log(
        `[GPU] Requesting device with maxBufferSize=${(limits.maxBufferSize / 1024 / 1024 / 1024).toFixed(1)}GB...`
      );
      const device = await adapter.requestDevice({ requiredLimits: limits });
      console.log(`[GPU] ✓ Device created successfully with limits:`, {
        maxBufferSize: `${(device.limits.maxBufferSize / 1024 / 1024 / 1024).toFixed(1)}GB`,
        maxStorageBufferBindingSize: `${(device.limits.maxStorageBufferBindingSize / 1024 / 1024 / 1024).toFixed(1)}GB`,
      });
      return device;
    } catch (e) {
      lastError = e as Error;
      console.log(`[GPU] ✗ Failed with ${(limits.maxBufferSize / 1024 / 1024 / 1024).toFixed(1)}GB limit: ${lastError.message}`);
    }
  }

  throw new Error(
    `Failed to create GPU device with any limit configuration. Last error: ${lastError?.message}`
  );
}
