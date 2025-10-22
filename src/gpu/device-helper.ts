/**
 * GPU Device Helper - Creates WebGPU device
 *
 * Requests high limits to allow allocation of large buffers (6GB+ DAG).
 * For 6GB DAG on 4080 Super with 16GB VRAM, we request 6GB limits explicitly.
 */

export async function createGPUDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU not available');
  }

  // Log adapter limits for reference
  console.log('[GPU] Adapter limits:', {
    maxBufferSize: `${(adapter.limits.maxBufferSize / 1024 / 1024 / 1024).toFixed(2)}GB`,
    maxStorageBufferBindingSize: `${(adapter.limits.maxStorageBufferBindingSize / 1024 / 1024 / 1024).toFixed(2)}GB`,
  });

  // Request device with adapter's actual supported limits
  // Don't try to exceed what the adapter supports
  try {
    console.log('[GPU] Creating device with adapter supported limits...');
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
    throw new Error(`Failed to create GPU device: ${(e as Error).message}`);
  }
}
