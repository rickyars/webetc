# Ethash WebGPU - Browser-Based GPU Mining Research

A fully in-browser implementation of the Ethash mining algorithm using WebGPU for GPU acceleration. This is an educational research project exploring blockchain mining algorithms, GPU programming in modern web environments, and WebGPU's compute capabilities.

## Overview

This project demonstrates GPU-accelerated Ethereum mining computations entirely within a web browser. By implementing the Keccak hash function, cache/DAG generation, and Hashimoto algorithm on GPU via WebGPU compute shaders, we explore the practical challenges and performance characteristics of browser-based cryptographic workloads.

**Note:** This is a research and educational project, not intended for production mining.

## Project Status

### ✅ Phase 1: GPU Keccak - COMPLETE
- **Step 1:** WebGPU environment setup and device initialization ✅
- **Step 2:** Basic compute shader testing (buffer I/O validation) ✅
- **Step 3:** Keccak-256 & Keccak-512 GPU implementation ✅
  - Direct ports of proven js-sha3 algorithm
  - 5 test vectors: 3× Keccak-256, 2× Keccak-512
  - All tests passing, GPU output matches CPU reference exactly

### ✅ Phase 2: GPU Hashimoto - COMPLETE
- **Step 4:** Cache generation (CPU via @ethereumjs/ethash, transferred to GPU memory) ✅
- **Step 5:** DAG generation (CPU via @ethereumjs/ethash, transferred to GPU memory) ✅
- **Step 6:** GPU Hashimoto shader (parallel nonce mining) ✅
  - Correct nonce byte reversal implemented
  - 130/130 test nonces verified against ethereumjs reference (100% match)
- **Step 7:** GPU difficulty filtering (keep only valid solutions) ✅
  - Tested with batches up to 5000 nonces
  - Verified at multiple difficulty thresholds (2^255, 2^250)
  - Correctly returns winning nonces that meet difficulty
- **Step 8:** Full mining pipeline on GPU with large batch processing ✅

### Test Files
- **GPU Keccak Test:** `src/tests/test-keccak.html` - 5/5 tests passing
- **GPU DAG Test:** `src/tests/test-dag.html` - Validates cache/DAG generation
- **GPU Hashimoto Comprehensive:** `src/tests/test-hashimoto-comprehensive.html` - 130 nonces, 100% verified
- **GPU Difficulty Filter Comprehensive:** `src/tests/test-difficulty-filter-comprehensive.html` - Large batches (100-5000 nonces), multiple difficulty levels
- **Main UI:** `src/index.html` - UI for running all steps

## Architecture

### Browser-Standalone GPU-First Design

**Setup Phase (Once per epoch):**
1. Generate cache on CPU via @ethereumjs/ethash
2. Generate DAG on CPU via @ethereumjs/ethash
3. Transfer both to GPU memory (keep resident)

**Mining Phase (Continuous):**
1. Launch GPU kernel with batch of nonces (1000s in parallel)
2. GPU Hashimoto: Process nonces with DAG/cache lookups + Keccak-512
3. GPU difficulty filter: Keep only solutions meeting difficulty
4. Transfer winning nonces back to CPU
5. CPU validates and submits

### Core Components

- **GPU Context Manager** (`src/gpu/context.ts`) - WebGPU device initialization
- **GPU Utils** (`src/gpu/utils.ts`) - Buffer management, pipeline creation
- **Ethash Reference** (`src/crypto/ethash-reference.ts`) - Official @ethereumjs/ethash wrapper
- **Keccak Reference** (`src/crypto/keccak-cpu.ts`) - CPU reference validation (js-sha3)
- **UI Logger** (`src/ui/logger.ts`) - Debug output and progress tracking

### GPU Shaders
- ✅ `keccak-256-shader.wgsl` - Batch Keccak-256 hashing
- ✅ `keccak-512-shader.wgsl` - Batch Keccak-512 hashing
- ✅ `hashimoto-shader.wgsl` - GPU Hashimoto algorithm (100% verified)
- ✅ `difficulty-filter-shader.wgsl` - GPU difficulty comparison (tested up to 5000 nonces)

## Project Structure

```
webetc/
├── src/
│   ├── gpu/                           # WebGPU infrastructure
│   │   ├── context.ts                 # Device management
│   │   ├── utils.ts                   # GPU utilities
│   │   ├── hashimoto.ts               # GPU Hashimoto orchestration
│   │   └── device-helper.ts           # GPU device initialization
│   ├── compute/                       # WGSL compute shaders
│   │   ├── keccak-256-shader.wgsl     # ✅ Keccak-256 GPU shader
│   │   ├── keccak-512-shader.wgsl     # ✅ Keccak-512 GPU shader
│   │   ├── hashimoto-shader.wgsl      # ✅ Hashimoto mining kernel
│   │   ├── difficulty-filter-shader.wgsl # ✅ Difficulty comparison
│   │   └── fnv.wgsl                   # FNV-1a hash for mixing
│   ├── crypto/
│   │   ├── ethash-reference.ts        # @ethereumjs/ethash wrapper
│   │   └── keccak-cpu.ts              # js-sha3 CPU reference
│   ├── tests/                         # Test suite
│   │   ├── test-keccak.html/ts        # GPU Keccak tests (5/5 passing)
│   │   ├── test-dag.html/ts           # Cache/DAG generation tests
│   │   ├── test-hashimoto-comprehensive.html # 130 nonces (100% verified)
│   │   └── test-difficulty-filter-comprehensive.html/ts # Large batch filter tests
│   ├── ui/
│   │   └── logger.ts                  # Debug UI and progress
│   ├── utils/
│   │   └── progress.ts                # Progress monitoring
│   ├── index.html                     # Main HTML template
│   └── main.ts                        # Main entry point
├── dist/                              # Build output (auto-generated)
├── CLAUDE.md                          # Project plan & roadmap
├── STRUCTURE.md                       # Codebase structure documentation
├── README.md                          # This file
└── package.json                       # Dependencies & scripts
```

## Getting Started

### Prerequisites

- Node.js 18+ with npm
- Browser with WebGPU support (Chrome 113+, Edge 113+)

### Installation

```bash
npm install
```

### Quick Start - Test GPU Keccak-256 & Keccak-512

```bash
npm run dev
```

Then open: **http://localhost:5173/src/test-keccak.html**

Expected output (5 tests total):
```
✓ GPU device created

Test: "(empty)" [Keccak-256]
  GPU: c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
  EXP: c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
  ✓ MATCH

Test: "abc" [Keccak-256]
  GPU: 4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45
  EXP: 4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45
  ✓ MATCH

Test: "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq" [Keccak-256]
  GPU: 45d3b367a6904e6e8d502ee04999a7c27647f91fa845d456525fd352ae3d7371
  EXP: 45d3b367a6904e6e8d502ee04999a7c27647f91fa845d456525fd352ae3d7371
  ✓ MATCH

Test: "(empty)" [Keccak-512]
  GPU: 0eab42de4c3ceb9235fc91acffe746b29c29a8c366b7c60e4e67c466f36a4304c00fa9caf9d87976ba469bcbe06713b435f091ef2769fb160cdab33d3670680e
  EXP: 0eab42de4c3ceb9235fc91acffe746b29c29a8c366b7c60e4e67c466f36a4304c00fa9caf9d87976ba469bcbe06713b435f091ef2769fb160cdab33d3670680e
  ✓ MATCH

Test: "abc" [Keccak-512]
  GPU: 18587dc2ea106b9a1563e32b3312421ca164c7f1f07bc922a9c83d77cea3a1e5d0c69910739025372dc14ac9642629379540c17e2a65b19d77aa511a9d00bb96
  EXP: 18587dc2ea106b9a1563e32b3312421ca164c7f1f07bc922a9c83d77cea3a1e5d0c69910739025372dc14ac9642629379540c17e2a65b19d77aa511a9d00bb96
  ✓ MATCH

Results: 5/5 tests passed
```

### Run CPU Tests

```bash
npm test
```

All 8 Keccak tests pass (CPU reference validation). Note: This is separate from GPU tests.

## Implementation

### GPU Keccak Test Suite

**Files:**
- `src/test-keccak.ts` - TypeScript test harness (imports shaders)
- `src/test-keccak.html` - Test page
- `src/compute/keccak-256-shader.wgsl` - Keccak-256 GPU shader
- `src/compute/keccak-512-shader.wgsl` - Keccak-512 GPU shader

**Key features:**
- **Algorithm:** Direct port of js-sha3 Keccak-f[1600] permutation
- **24 rounds** with correct round constants
- **50 u32 storage** (25 u64 lanes as high/low pairs)
- **Keccak-256:** 136-byte input (rate), 32-byte output
- **Keccak-512:** 72-byte input (rate), 64-byte output
- **5 test vectors** from js-sha3 (verified)

**Why this works:**
1. Direct port of proven js-sha3 algorithm (battle-tested)
2. No type aliases - uses `vec2<u32>` directly (compatible with all browsers)
3. Proper Vite integration - clean TypeScript, not inline HTML
4. Hardcoded test vectors - no external dependencies for tests

### Test Vectors

Generated from js-sha3 and hardcoded in `src/test-keccak.ts`:

**Keccak-256 (3 tests):**
- Empty string, "abc", long string

**Keccak-512 (2 tests):**
- Empty string, "abc"

## Key Concepts

### Ethash Algorithm
- **Cache:** Small (~16 MB) dataset derived from epoch
- **DAG:** Large (~1 GB) derived from cache, used for mining
- **Hashimoto:** Memory-hard algorithm combining cache and DAG reads
- **Epoch:** Changes every 30,000 blocks (~125 days on Ethereum)

### Keccak Specifications
- **Rate:** 1088 bits (136 bytes)
- **Capacity:** 512 bits
- **Output (Keccak-256):** 256 bits (32 bytes)
- **Output (Keccak-512):** 512 bits (64 bytes)
- **Rounds:** 24 rounds of Keccak-f[1600]

### GPU Memory Considerations
- DAG is ~1 GB for epoch 0 (may require streaming on some devices)
- Cache is ~16 MB (easily fits on GPU VRAM)
- Memory bandwidth is critical for hash throughput
- Workgroup synchronization must be minimized

## Development Workflow

1. **Modify code** in `src/`
2. **Build** with `npm run build` (generates standalone.html)
3. **Test** in browser or with `npm test`
4. **Profile** using WebGPU Inspector (DevTools)
5. **Validate** GPU output against CPU reference

## Performance Targets

- **Cache Generation:** ~30 seconds on CPU (once per epoch, acceptable)
- **DAG Generation:** ~2-3 minutes on CPU (once per epoch, acceptable)
- **Mining Hash Throughput:** > 10M hashes/second on GPU (batches of 1000+ nonces)
- **Memory Bandwidth:** DAG transfer overhead minimized by filtering on GPU
- **Difficulty Filter Selectivity:** Only transfer winning nonces (1 in 10^15 hashes)

## Debugging

### WebGPU Inspector (Chrome DevTools)
- Profile shader execution time
- Analyze memory access patterns
- Monitor GPU utilization
- Debug buffer contents

### Browser Console
- Device capabilities logged on startup
- Validation results for test vectors
- Progress tracking during operations

## Implementation Notes

### CPU Reference Use Cases
The CPU implementations in `src/reference/` are used **only for**:
1. Generating test vectors
2. Validating GPU results match CPU reference
3. Performance comparison (GPU vs CPU)
4. Educational reference during porting

These are **not** production code; actual implementations are GPU-based.

### Storage Strategy
- DAG persistence to IndexedDB (future)
- Binary format matching GPU buffer layout
- SHA-256 integrity verification
- Fast reloading (milliseconds vs minutes)

## References

- [CLAUDE.md](CLAUDE.md) - Full project plan (GPU-first architecture)
- [ETHASH_ALGORITHM_REFERENCE.md](ETHASH_ALGORITHM_REFERENCE.md) - Ethash algorithm details
- [TESTING_GUIDE.md](TESTING_GUIDE.md) - Testing and validation procedures
- [STATUS.md](STATUS.md) - Current implementation status
- [WebGPU Specification](https://www.w3.org/TR/webgpu/)
- [Ethash Specification](https://eth.wiki/en/concepts/ethash/ethash)
- [SHA-3/Keccak Reference](https://keccak.team/)

## License

Educational research project. Use for learning and research purposes only.

## Disclaimer

This project is for **educational and research purposes only**. It is not intended for production use or actual mining operations. Cryptocurrency mining involves significant electricity consumption and may be subject to regulatory restrictions in your jurisdiction.
