/**
 * Ethash WebGPU - Main Entry Point
 * Comprehensive UI for all implementation steps
 */

import { GPUContext } from './gpu/context';
import {
  getDeviceInfo,
  createGPUBuffer,
  readGPUBuffer,
  createComputePipeline,
  executeComputeShader,
} from './gpu/utils';
import { Logger } from './ui/logger';
import {
  keccak256,
  keccak512,
  bytesToHex,
  validateKeccakImplementation,
  validateKeccak512Implementation,
  validateKeccak256Implementation,
  KECCAK512_TEST_VECTORS,
  KECCAK_TEST_VECTORS
} from './crypto/keccak-cpu';
import {
  fnvEthash,
  validateFNVImplementation,
  FNV_TEST_VECTORS,
} from './crypto/fnv';
import {
  generateCache,
  validateCache,
  getCacheItemCount,
  HASH_BYTES,
} from './dag/cache-builder';
import { ProgressMonitor } from './utils/progress';

let logger: Logger | null = null;
let gpuContext: GPUContext | null = null;

/**
 * Initialize logger when DOM is ready
 */
function initializeLogger(): Logger {
  if (!logger) {
    logger = new Logger();
  }
  return logger;
}

/**
 * Update status display
 */
function updateStatus(text: string, color: string = '#4ec9b0'): void {
  const status = document.getElementById('status');
  if (status) {
    status.textContent = text;
    status.style.borderLeftColor = color;
  }
}

/**
 * Step 1: Initialize WebGPU
 */
async function initializeWebGPU(): Promise<void> {
  const log = initializeLogger();
  try {
    log.info('=== STEP 1: Environment Setup ===');
    log.info('Initializing WebGPU...');
    updateStatus('Initializing WebGPU...', '#dcdcaa');

    gpuContext = GPUContext.getInstance();
    await gpuContext.initialize();

    log.success('WebGPU initialized successfully');
    log.info('Device info:');
    log.info(getDeviceInfo(gpuContext));

    updateStatus('WebGPU Ready ✓', '#6a9955');

    // Enable other buttons
    const buttons = document.querySelectorAll('button[data-step]') as NodeListOf<
      HTMLButtonElement
    >;
    buttons.forEach(btn => (btn.disabled = false));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to initialize WebGPU: ${message}`);
    updateStatus('WebGPU Initialization Failed ✗', '#f48771');
  }
}

/**
 * Step 2: Test simple compute shader
 */
async function testComputeShader(): Promise<void> {
  const log = initializeLogger();
  if (!gpuContext) {
    log.error('GPU context not initialized. Run Step 1 first.');
    return;
  }

  try {
    log.info('=== STEP 2: Hello Compute Shader ===');
    log.info('Running test compute shader...');
    updateStatus('Running test shader...', '#dcdcaa');

    const device = gpuContext.getDevice();

    const shaderCode = `
      @group(0) @binding(0)
      var<storage, read_write> output: array<u32>;

      @compute @workgroup_size(256)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let idx = global_id.x;
        if (idx < arrayLength(&output)) {
          output[idx] = idx * 42u + 1234u;
        }
      }
    `;

    const bufferSize = 1024;
    const outputBuffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: false,
    });

    const layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
    });

    const bindGroup = device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: outputBuffer } }],
    });

    const pipeline = createComputePipeline(
      device,
      shaderCode,
      device.createPipelineLayout({ bindGroupLayouts: [layout] })
    );

    await executeComputeShader(device, pipeline, bindGroup, [1, 1, 1]);

    const result = await readGPUBuffer(device, outputBuffer, 0, bufferSize);
    const values = new Uint32Array(result);

    log.success('Shader executed successfully');
    log.info(`First 8 values: ${Array.from(values.slice(0, 8)).join(', ')}`);
    log.info(`Expected pattern: [1234, 1276, 1318, 1360, ...]`);

    let isCorrect = true;
    for (let i = 0; i < 8; i++) {
      if (values[i] !== i * 42 + 1234) {
        isCorrect = false;
        break;
      }
    }

    if (isCorrect) {
      log.success('Buffer IO validation ✓ - GPU data matches expected values');
    } else {
      log.warn('Buffer values do not match expected pattern');
    }

    outputBuffer.destroy();
    updateStatus('Compute Shader Test Complete ✓', '#6a9955');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Test shader failed: ${message}`);
    updateStatus('Test Failed ✗', '#f48771');
  }
}

/**
 * Step 3: Test Keccak implementation
 */
async function testKeccak(): Promise<void> {
  const log = initializeLogger();
  try {
    log.info('=== STEP 3: Keccak-512 & Keccak-256 Implementation ===');
    log.info('Testing CPU reference implementations...');
    updateStatus('Testing Keccak...', '#dcdcaa');

    // Test Keccak-512 (used in Ethash DAG generation)
    log.info('');
    log.info('Validating Keccak-512 (used in Ethash)...');
    let keccak512Valid = true;
    for (const vector of KECCAK512_TEST_VECTORS) {
      const input = new TextEncoder().encode(vector.input);
      const hash = keccak512(input);
      const hashHex = bytesToHex(hash);
      const passed = hashHex === vector.expected;
      log.info(`  Test "${vector.input}": ${passed ? '✓' : '✗'}`);
      if (!passed) {
        log.info(`    Expected: ${vector.expected}`);
        log.info(`    Got:      ${hashHex}`);
      }
      keccak512Valid = keccak512Valid && passed;
    }

    // Test Keccak-256 (reference for comparison)
    log.info('');
    log.info('Validating Keccak-256 (reference)...');
    let keccak256Valid = true;
    for (const vector of KECCAK_TEST_VECTORS) {
      const input = new TextEncoder().encode(vector.input);
      const hash = keccak256(input);
      const hashHex = bytesToHex(hash);
      const passed = hashHex === vector.expected;
      log.info(`  Test "${vector.input}": ${passed ? '✓' : '✗'}`);
      if (!passed) {
        log.info(`    Expected: ${vector.expected}`);
        log.info(`    Got:      ${hashHex}`);
      }
      keccak256Valid = keccak256Valid && passed;
    }

    // Summary
    log.info('');
    if (keccak512Valid && keccak256Valid) {
      log.success('All Keccak test vectors passed ✓');
      log.info('Both implementations are correct');
      log.info('GPU shaders can now be validated against these');
    } else {
      if (!keccak512Valid) {
        log.error('Keccak-512 test vectors FAILED');
      }
      if (!keccak256Valid) {
        log.error('Keccak-256 test vectors FAILED');
      }
    }

    updateStatus('Keccak Testing Complete', '#6a9955');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Keccak test failed: ${message}`);
    updateStatus('Keccak Test Failed ✗', '#f48771');
  }
}

/**
 * Step 4-9: GPU Implementation Steps
 * To be implemented as we port computations to WebGPU shaders
 */

// Step 4: FNV Hash Function (CPU implementation)
async function testFNVHash(): Promise<void> {
  const log = initializeLogger();
  try {
    log.info('=== STEP 4: FNV Hash Function (Ethash parent selection) ===');
    log.info('Testing FNV implementation for DAG generation...');
    updateStatus('Testing FNV...', '#dcdcaa');

    log.info('');
    log.info('Validating FNV mixing function...');
    let fnvValid = true;
    for (const vector of FNV_TEST_VECTORS) {
      const result = fnvEthash(vector.a, vector.b);
      const passed = result === vector.expected;

      const aHex = vector.a.toString(16).padStart(8, '0');
      const bHex = vector.b.toString(16).padStart(8, '0');
      const resultHex = result.toString(16).padStart(8, '0');
      const expectedHex = vector.expected.toString(16).padStart(8, '0');

      log.info(`  fnvEthash(0x${aHex}, 0x${bHex}): ${passed ? '✓' : '✗'}`);
      if (!passed) {
        log.info(`    Expected: 0x${expectedHex}`);
        log.info(`    Got:      0x${resultHex}`);
      }

      fnvValid = fnvValid && passed;
    }

    // Summary
    log.info('');
    if (fnvValid) {
      log.success('All FNV test vectors passed ✓');
      log.info('FNV function ready for DAG generation');
    } else {
      log.error('FNV test vectors FAILED');
    }

    updateStatus('FNV Testing Complete', '#6a9955');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`FNV test failed: ${message}`);
    updateStatus('FNV Test Failed ✗', '#f48771');
  }
}

// Step 5: Cache Generation (CPU implementation)
async function testCacheGeneration(): Promise<void> {
  const log = initializeLogger();
  try {
    log.info('=== STEP 5: Cache Generation (CPU Implementation) ===');
    log.info('Generating Ethash cache for epoch 0...');
    updateStatus('Generating cache...', '#dcdcaa');

    const epoch = 0;
    const startTime = performance.now();

    // Create progress monitor
    const progress = new ProgressMonitor('progress-container');

    // Generate cache with progress monitoring
    const cache = generateCache(epoch, (current, total, message) => {
      progress.update(current, message);
    });

    const endTime = performance.now();
    progress.complete('Cache generation complete');

    // Validate cache
    const valid = validateCache(cache, epoch);

    log.info('');
    if (valid) {
      log.success(`✓ Cache generated successfully in ${(endTime - startTime).toFixed(2)}ms`);

      const itemCount = getCacheItemCount(epoch);
      const cacheSizeMB = (cache.length * 4) / (1024 * 1024);
      log.info(`  Items: ${itemCount.toLocaleString()} (PRIME)`);
      log.info(`  Total size: ${cacheSizeMB.toFixed(2)} MB`);
      log.info(`  Per item: ${HASH_BYTES} bytes`);

      // Display first few cache items
      log.info('');
      log.info('First 3 cache items (first 8 words each):');
      for (let i = 0; i < 3; i++) {
        const words: string[] = [];
        for (let j = 0; j < 8; j++) {
          const value = cache[i * 16 + j];
          words.push(value.toString(16).padStart(8, '0'));
        }
        log.info(`  Item ${i}: 0x${words.join('')}`);
      }

      updateStatus('Cache Generation Complete ✓', '#6a9955');
    } else {
      log.error('Cache validation FAILED');
      updateStatus('Cache Generation Failed ✗', '#f48771');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Cache generation failed: ${message}`);
    updateStatus('Cache Generation Failed ✗', '#f48771');
  }
}

// Step 6: DAG Validation (GPU vs reference)
async function testDAGValidationGPU(): Promise<void> {
  const log = initializeLogger();
  log.info('=== STEP 6: DAG Validation and Testing ===');
  log.info('GPU implementation coming soon...');
  log.info('To be implemented: Compare GPU DAG output against test vectors');
}

/**
 * Run all available steps
 */
async function runAllSteps(): Promise<void> {
  const log = initializeLogger();
  try {
    log.info('Running all implemented steps...\n');

    if (!gpuContext) {
      await initializeWebGPU();
    }

    await testComputeShader();
    log.info('');

    await testKeccak();
    log.info('');

    await testFNVHash();
    log.info('');

    await testCacheGeneration();
    log.info('');

    log.success('\n✓ All implemented steps completed successfully!');
    log.info('Next: Implement DAG generation (Step 6)');
  } catch (error) {
    log.error(`Multi-step execution failed: ${String(error)}`);
  }
}

/**
 * Setup UI event listeners
 */
function setupEventListeners(): void {
  const initBtn = document.getElementById('initBtn');
  const clearBtn = document.getElementById('clearBtn');

  if (initBtn) {
    initBtn.addEventListener('click', initializeWebGPU);
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const log = initializeLogger();
      log.clear();
    });
  }

  // Step-specific buttons
  const step2Btn = document.getElementById('step2Btn');
  const step3Btn = document.getElementById('step3Btn');
  const step4Btn = document.getElementById('step4Btn');
  const step5Btn = document.getElementById('step5Btn');
  const step6Btn = document.getElementById('step6Btn');
  const runAllBtn = document.getElementById('runAllBtn');

  if (step2Btn)
    step2Btn.addEventListener('click', testComputeShader);
  if (step3Btn)
    step3Btn.addEventListener('click', testKeccak);
  if (step4Btn)
    step4Btn.addEventListener('click', testFNVHash);
  if (step5Btn)
    step5Btn.addEventListener('click', testCacheGeneration);
  if (step6Btn)
    step6Btn.addEventListener('click', testDAGValidationGPU);
  if (runAllBtn)
    runAllBtn.addEventListener('click', runAllSteps);
}

/**
 * Main entry point
 */
function main(): void {
  const log = initializeLogger();
  log.info('Ethash WebGPU Research Implementation');
  log.info('GPU-Accelerated Ethereum Mining Algorithm');
  log.info('');
  log.info('✓ Steps 1-3: Environment, Compute Shader, Keccak CPU Reference');
  log.info('✓ Step 4: FNV Hash Function (CPU implementation)');
  log.info('✓ Step 5: Cache Generation (CPU implementation)');
  log.info('⏳ Steps 6-9: DAG, Hashimoto, GPU porting in progress');
  log.info('');
  log.info('Click buttons below to run individual steps');
  log.info('');

  setupEventListeners();
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
