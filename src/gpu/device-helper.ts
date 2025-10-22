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

  // Request higher limits for large DAG allocation (6GB)
  // Must request these explicitly via requiredLimits parameter
  try {
    console.log('[GPU] Requesting device with 6GB limits...');
    const sixGbBytes = 6 * 1024 * 1024 * 1024;
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxBufferSize: sixGbBytes,
        maxStorageBufferBindingSize: sixGbBytes,
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
