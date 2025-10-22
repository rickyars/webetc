# Ethash WebGPU - Project Structure

## Directory Layout

```
src/
├── index.html                 # Main entry point (legacy UI)
├── main.ts                    # Main entry point logic
├── compute/                   # GPU compute shaders (WGSL)
│   ├── fnv-shader.wgsl        # FNV-1a hash function
│   ├── keccak-256-shader.wgsl # Keccak-256 hashing
│   ├── keccak-512-shader.wgsl # Keccak-512 hashing
│   ├── dag-builder-shader.wgsl # DAG item generation
│   ├── difficulty-filter-shader.wgsl # Difficulty filtering
│   └── hashimoto-shader-v2.wgsl # Complete Hashimoto algorithm
├── crypto/                    # CPU cryptographic functions
│   ├── ethash-reference.ts    # Reference CPU implementations
│   └── keccak-cpu.ts          # CPU Keccak (fallback)
├── gpu/                       # GPU orchestration layer
│   ├── context.ts             # WebGPU context management
│   ├── device-helper.ts       # GPU device utilities
│   ├── hashimoto.ts           # GPU Hashimoto orchestration
│   ├── dag-builder.ts         # GPU DAG generation
│   ├── difficulty-filter.ts   # GPU difficulty filtering
│   ├── utils.ts               # General GPU utilities
├── tests/                     # Test suite
│   ├── test-hashimoto.html    # Consolidated Hashimoto tests
│   ├── test-hashimoto.ts      # Hashimoto test logic
│   ├── test-keccak.html       # Keccak function tests
│   ├── test-keccak.ts         # Keccak test logic
│   ├── test-dag.html          # DAG generation tests
│   ├── test-dag.ts            # DAG test logic
│   ├── test-difficulty-filter.html # Difficulty filter tests
│   ├── test-difficulty-filter.ts
│   ├── test-full-pipeline.html # End-to-end pipeline test
│   └── test-full-pipeline.ts
├── ui/                        # UI components
│   └── logger.ts              # Console logger
└── utils/                     # Utilities
    └── progress.ts            # Progress tracking
```

## Key Modules

### GPU Orchestration (`src/gpu/`)

- **hashimoto.ts** (458 lines)
  - `setupHashimotoGPU()`: Initialize cache + DAG for epoch
  - `runHashimotoBatchGPU()`: Execute Hashimoto on batch of nonces
  - `validateHashimotoGPU()`: Verify results against CPU reference
  - Core mining function

- **dag-builder.ts** (215 lines)
  - `generateDAGGPU()`: GPU-accelerated DAG generation
  - Uses GPU compute shader for parallel DAG item computation
  - Stores result in GPU memory for mining

- **difficulty-filter.ts** (192 lines)
  - `runDifficultyFilterGPU()`: Filter hashes by difficulty threshold
  - Reduces GPU→CPU bandwidth by only returning valid nonces
  - *Status: Module exists, integration with Hashimoto pending*

- **device-helper.ts** (54 lines)
  - `createGPUDevice()`: WebGPU device initialization
  - Utility functions for device capabilities

- **context.ts** (135 lines)
  - `GPUContext`: Singleton WebGPU context manager
  - *Note: Used by legacy main.ts, not by test files*

- **utils.ts** (142 lines)
  - Buffer creation/reading helpers
  - Compute pipeline utilities
  - *Note: Used by legacy main.ts*

### Cryptographic Implementations

- **ethash-reference.ts**: CPU Ethash implementation wrapper
  - Uses `@ethereumjs/ethash` for cache generation
  - Provides reference implementations for validation

### GPU Shaders (`src/compute/`)

- **fnv-shader.wgsl**: FNV-1a hash (x * 0x01000193 ^ y)
  - Used in DAG generation and Hashimoto mixing
  - ✅ Verified correct via exhaustive testing

- **keccak-512-shader.wgsl**: 512-bit Keccak (Stage 1 of Hashimoto)
  - ✅ GPU output matches CPU reference perfectly

- **keccak-256-shader.wgsl**: 256-bit Keccak (Stage 5 of Hashimoto)
  - Final hashing step

- **hashimoto-shader-v2.wgsl**: Complete Hashimoto algorithm
  - All 5 stages: Keccak-512, Mix init, FNV loop, folding, Keccak-256
  - ✅ Produces correct mining hashes

- **dag-builder-shader.wgsl**: DAG item generation
  - Parallel computation of Ethash DAG items
  - ✅ Generates correct DAG values

- **difficulty-filter-shader.wgsl**: Difficulty comparison
  - Filters hashes: hash < 2^256 / difficulty

## Test Suite (`src/tests/`)

### Consolidated Hashimoto Test
- **test-hashimoto.ts/html**: Complete test suite
  - Stage 1: Keccak-512 verification
  - Full pipeline: End-to-end mining validation
  - Difficulty filter: Integration (pending)
  - Uses ethereumjs as ground truth

### Individual Component Tests
- **test-keccak.ts**: Keccak-256 and Keccak-512 validation
- **test-dag.ts**: DAG generation correctness (10 items + spot checks)
- **test-difficulty-filter.ts**: Difficulty filtering validation
- **test-full-pipeline.ts**: Complete end-to-end mining pipeline

## Implementation Status

### ✅ Complete & Verified
- WebGPU device initialization
- Keccak-512 GPU shader
- Keccak-256 GPU shader
- FNV-1a hash function
- Hashimoto algorithm (Stages 1-5)
- DAG generation
- Basic difficulty filtering logic

### 🔄 Integrated But Need Testing
- **Difficulty filter integration**: Module exists but not integrated into Hashimoto mining loop

### 📋 Pending
- Full end-to-end mining with difficulty filtering
- Performance optimization
- Large-scale testing

## How to Run Tests

### Main Entry Point (Legacy UI)
```
npm run build
# Open dist/index.html in browser
```

### Hashimoto Test Suite (Recommended)
```
npm run build
# Open dist/src/tests/test-hashimoto.html in browser
```

### Component Tests
- `dist/src/tests/test-keccak.html` - Keccak validation
- `dist/src/tests/test-dag.html` - DAG generation
- `dist/src/tests/test-difficulty-filter.html` - Difficulty filtering
- `dist/src/tests/test-full-pipeline.html` - Full pipeline

## Key Design Decisions

1. **GPU-First Architecture**
   - Expensive computations (DAG, Hashimoto) run on GPU
   - CPU handles setup, validation, storage

2. **Modular GPU Shaders**
   - Separate shaders for each function (FNV, Keccak-256/512, etc.)
   - Combined at runtime for flexibility

3. **Reference Validation**
   - All GPU results compared against `@ethereumjs/ethash` CPU reference
   - Ensures correctness before production use

4. **Test-Driven Development**
   - Comprehensive test suite verifies each component
   - Isolated tests for debugging (Stage 1, FNV, etc.)
   - Full integration tests for end-to-end validation

## Files to Keep

Essential for operation:
- All shaders in `src/compute/`
- All files in `src/gpu/` (context, device-helper, hashimoto, dag-builder, difficulty-filter, utils)
- `src/crypto/ethash-reference.ts` for reference validation
- `src/index.html`, `src/main.ts` (legacy entry point)

Supporting files:
- All files in `src/tests/` (validation & development)
- `src/ui/logger.ts`, `src/utils/progress.ts`

## Future Improvements

1. **Difficulty Filter Integration**
   - Integrate `runDifficultyFilterGPU()` into `runHashimotoBatchGPU()`
   - Only return nonces meeting difficulty threshold
   - Reduce GPU→CPU bandwidth

2. **Performance Optimization**
   - Profile with WebGPU Inspector
   - Optimize batch sizes
   - Benchmark: hashes/second vs CPU baseline

3. **Production Readiness**
   - Handle network submission of valid nonces
   - State persistence across sessions
   - Error recovery and retry logic
