# Ethash WebGPU - Browser-Based GPU Mining Research

A fully in-browser implementation of the Ethash mining algorithm using WebGPU for GPU acceleration. This is an educational research project exploring blockchain mining algorithms, GPU programming in modern web environments, and WebGPU's compute capabilities.

## Overview

This project demonstrates GPU-accelerated Ethereum mining computations entirely within a web browser. By implementing the Keccak hash function, cache/DAG generation, and Hashimoto algorithm on GPU via WebGPU compute shaders, we explore the practical challenges and performance characteristics of browser-based cryptographic workloads.

**Note:** This is a research and educational project, not intended for production mining.

## Project Status

### ✅ Complete (GPU-Ready Infrastructure)
- **Step 1:** WebGPU environment setup and device initialization
- **Step 2:** Basic compute shader testing (buffer I/O validation)
- **Step 3:** Keccak CPU reference implementation with test vectors

### ⏳ Pending (GPU Implementation)
- **Step 4:** Cache generation on GPU (WGSL shader)
- **Step 5:** DAG generation on GPU (WGSL shader)
- **Step 6:** DAG validation (GPU vs reference)
- **Step 7:** Hashimoto GPU shader implementation
- **Step 8:** Full mining pipeline on GPU
- **Step 9:** Performance profiling and optimization

## Architecture

### GPU-First Design
- All heavy computations (Keccak, cache/DAG generation, Hashimoto) run on **GPU**
- CPU handles storage, I/O, and orchestration only
- Validation against CPU reference implementations ensures correctness

### Core Components

- **GPU Context Manager** (`src/gpu/context.ts`) - WebGPU device initialization
- **GPU Utils** (`src/gpu/utils.ts`) - Buffer management, pipeline creation
- **Keccak Reference** (`src/crypto/keccak-cpu.ts`) - CPU reference for validation (js-sha3)
- **UI Logger** (`src/ui/logger.ts`) - Debug output and progress tracking
- **CPU Reference Implementations** (`src/reference/`) - Used only for validation

### Planned GPU Shaders
- `Keccak-512.wgsl` - Batch Keccak-512 hashing
- `Cache-Generator.wgsl` - GPU cache item generation
- `DAG-Generator.wgsl` - GPU DAG item generation
- `Hashimoto.wgsl` - GPU Hashimoto algorithm
- `Mining-Pipeline.wgsl` - Integrated mining compute

## Project Structure

```
webetc/
├── src/
│   ├── gpu/                     # WebGPU infrastructure
│   │   ├── context.ts           # Device management
│   │   └── utils.ts             # GPU utilities
│   ├── compute/                 # WGSL shaders (to be implemented)
│   │   ├── keccak-shader.wgsl   # Keccak-512 GPU shader
│   │   └── ...                  # Other GPU shaders
│   ├── crypto/
│   │   └── keccak-cpu.ts        # CPU reference (validation)
│   ├── reference/               # CPU implementations for validation
│   │   ├── cache-builder-cpu.ts # CPU DAG/cache generation
│   │   ├── hashimoto-cpu.ts     # CPU Hashimoto algorithm
│   │   ├── fnv-cpu.ts           # FNV hash function
│   │   └── README.md            # Reference usage guide
│   ├── ui/
│   │   └── logger.ts            # Debug UI and progress bars
│   ├── index.html               # HTML template
│   └── main.ts                  # Entry point
├── dist/                        # Build output (auto-generated)
├── CLAUDE.md                    # Project plan (GPU-first)
├── README.md                    # This file
├── TESTING_GUIDE.md             # Testing and validation procedures
├── ETHASH_ALGORITHM_REFERENCE.md # Algorithm reference
├── STATUS.md                    # Implementation status
└── package.json                 # Dependencies & scripts
```

## Getting Started

### Prerequisites

- Node.js 18+ with npm
- Browser with WebGPU support (Chrome 113+, Edge 113+)
- 4GB+ RAM (for full DAG generation when implemented)

### Installation

```bash
npm install
```

### Quick Start

**Development mode (hot-reload):**
```bash
npm run dev
```
Visit `http://localhost:5173` in your browser.

**Build standalone HTML:**
```bash
npm run build
```

**Run with Vite preview:**
```bash
npm run preview
```

## Usage

Open the generated `standalone.html` or visit the dev server. The UI shows:

- **Step 1:** WebGPU initialization status
- **Step 2:** Compute shader buffer I/O test
- **Step 3:** Keccak-256/512 reference validation
- **Steps 4-9:** Placeholder UI for GPU implementations (coming soon)

### Testing

The test suite validates:
- ✅ Keccak-256 against known test vectors
- ✅ Keccak-512 against known test vectors
- ✅ WebGPU device capabilities
- (GPU implementations will validate against CPU reference)

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

- **Cache Generation:** < 1 second on GPU
- **DAG Generation:** < 30 seconds on GPU
- **Hash Throughput:** > 10M hashes/second on modern GPU
- **Memory Bandwidth:** Optimize for GPU VRAM constraints

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
