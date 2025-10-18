/**
 * WebGPU Context Manager
 * Handles initialization and management of WebGPU device and adapter
 */

export interface GPUContextInfo {
  adapter: GPUAdapter;
  device: GPUDevice;
  queue: GPUQueue;
  adapterInfo: GPUAdapterInfo | null;
}

export class GPUContext {
  private static instance: GPUContext | null = null;
  private context: GPUContextInfo | null = null;

  private constructor() {}

  static getInstance(): GPUContext {
    if (!GPUContext.instance) {
      GPUContext.instance = new GPUContext();
    }
    return GPUContext.instance;
  }

  /**
   * Initialize WebGPU adapter and device
   */
  async initialize(): Promise<GPUContextInfo> {
    if (this.context) {
      return this.context;
    }

    // Check WebGPU support
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser');
    }

    // Request adapter
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      throw new Error('Failed to request GPU adapter');
    }

    // Get adapter info (optional - not supported in all browsers)
    let adapterInfo: GPUAdapterInfo | null = null;
    try {
      if (typeof adapter.requestAdapterInfo === 'function') {
        adapterInfo = await adapter.requestAdapterInfo();
      }
    } catch (e) {
      // requestAdapterInfo not available in this browser
      console.warn('requestAdapterInfo not available:', e);
    }

    // Request device with limits (use adapter's actual limits, don't exceed them)
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        // Use adapter's supported limit (some browsers support 32KB, not 48KB)
        maxComputeWorkgroupStorageSize: Math.min(
          49152,
          adapter.limits.maxComputeWorkgroupStorageSize
        ),
      },
    });

    device.lost.then(() => {
      console.error('GPU device was lost');
      this.context = null;
    });

    const queue = device.queue;

    this.context = {
      adapter,
      device,
      queue,
      adapterInfo,
    };

    return this.context;
  }

  /**
   * Get the current GPU context (must be initialized first)
   */
  getContext(): GPUContextInfo {
    if (!this.context) {
      throw new Error('GPU context not initialized. Call initialize() first.');
    }
    return this.context;
  }

  /**
   * Get GPU device
   */
  getDevice(): GPUDevice {
    return this.getContext().device;
  }

  /**
   * Get GPU queue
   */
  getQueue(): GPUQueue {
    return this.getContext().queue;
  }

  /**
   * Get adapter info for debugging (may be null if not supported)
   */
  getAdapterInfo(): GPUAdapterInfo | null {
    return this.getContext().adapterInfo;
  }

  /**
   * Get adapter limits
   */
  getAdapterLimits() {
    return this.getContext().adapter.limits;
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.context) {
      this.context.device.destroy();
      this.context = null;
    }
  }
}
