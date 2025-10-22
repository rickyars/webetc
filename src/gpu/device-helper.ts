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

  // Get adapter limits to see what's available
  console.log('[GPU] Adapter limits:', {
    maxBufferSize: `${(adapter.limits.maxBufferSize / 1024 / 1024 / 1024).toFixed(2)}GB`,
    maxStorageBufferBindingSize: `${(adapter.limits.maxStorageBufferBindingSize / 1024 / 1024 / 1024).toFixed(2)}GB`,
  });

  // Request device with the adapter's reported limits
  // This ensures we get the full capabilities the hardware supports
  try {
    console.log('[GPU] Requesting device with adapter limits...');
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      },
    });
    console.log(`[GPU] ✓ Device created successfully with limits:`, {
      maxBufferSize: `${(device.limits.maxBufferSize / 1024 / 1024 / 1024).toFixed(2)}GB`,
      maxStorageBufferBindingSize: `${(device.limits.maxStorageBufferBindingSize / 1024 / 1024 / 1024).toFixed(2)}GB`,
    });
    return device;
  } catch (e) {
    console.error('[GPU] Failed to create device:', e);
    throw new Error(`Failed to create GPU device: ${(e as Error).message}`);
  }
}
