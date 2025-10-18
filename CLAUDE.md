## Project Description:

We are implementing a fully in-browser Ethash algorithm that runs on WebGPU as a proof-of-concept project for fun, research, and educational purposes. This project aims to demonstrate GPU-accelerated Ethereum mining computations entirely within a web browser environment, leveraging WebGPU's modern, low-level compute capabilities. By building the DAG and executing Hashimoto and Keccak functions on the GPU via WebGPU, we explore the challenges and performance characteristics of browser-based cryptographic workloads.

The focus is on incremental development with strong testing, including GPU-native implementations and storage optimization. This project is not intended for production mining but to advance understanding of blockchain mining algorithms, GPU programming in browsers, and WebGPU's practical applications.

It serves as a research vehicle to:
- Explore WebGPU's compute shader model for hashing workloads.
- Investigate GPU-accelerated DAG/cache generation and memory management in-browser.
- Educate developers on GPU programming integration in web environments.

This effort aligns with the latest WebGPU API features and browser support, emphasizing correctness, performance profiling, and shader debugging techniques relevant to Ethash computations.

### Step-by-Step Plan

#### Step 1 — Environment Setup

- Initialize WebGPU (request adapter/device).
- Log device info and verify API availability.
- Submit a trivial compute task to confirm setup.


#### Step 2 — Hello Compute Shader

- Create a simple WGSL shader that writes predetermined values to a buffer.
- Map buffer back to JavaScript; verify values.
- Use WebGPU Inspector or DevTools to debug memory contents.


#### Step 3 — Keccak-512 GPU Shader (WGSL)

- Port Keccak-512 permutation rounds to WGSL compute shader.
- Implement batch Keccak-512 hashing on GPU (multiple items in parallel).
- Validate GPU output against CPU reference (js-sha3) using known test vectors.
- Benchmark: GPU vs CPU performance for hashing throughput.


#### Step 4 — Cache Generation on GPU

- Implement GPU compute shader to generate Ethash cache items using Keccak-512.
- Generate cache directly on GPU using the shader from Step 3.
- Copy results back to CPU for storage and validation.
- **Cache storage:** Save to IndexedDB or localStorage in binary format for fast reloading.
- Verify cache integrity and size before proceeding.


#### Step 5 — DAG Generation on GPU

- Implement GPU compute shader for DAG item calculation.
- Load cache buffer onto GPU from storage (or regenerate if needed).
- Execute GPU kernel to generate full DAG (all items in parallel).
- Copy DAG results back to CPU for storage.
- **DAG storage:** Save to IndexedDB with metadata (epoch, hash, timestamp).
- Implement DAG loading from storage to avoid expensive regeneration.


#### Step 6 — DAG Validation and Testing

- Create tests comparing DAG values generated on GPU against official Ethash test vectors.
- Sample specific DAG indices and verify against reference implementations (ethminer, go-ethereum).
- Verify cache consistency by recomputing and comparing selective cache items.
- Implement unit tests for DAG/cache GPU kernels with small subsets.


#### Step 7 — Hashimoto GPU Shader

- Implement GPU compute shader for Hashimoto algorithm.
- Load DAG buffer onto GPU (or use streaming for large DAGs).
- Implement FNV-1a mixing in WGSL.
- Chain with Keccak-512 shader for final hash computation.
- Test with known mining nonces and expected hash outputs.


#### Step 8 — Full Mining Pipeline

- Integrate cache generation → DAG generation → Hashimoto → final hash.
- Batch process multiple nonces in parallel on GPU.
- Implement input buffer for nonces, output buffer for hashes.
- Compare results against geth/ethminer for correctness validation.


#### Step 9 — Performance Profiling & Optimization

- Use WebGPU Inspector to profile shader execution time, memory bandwidth, and occupancy.
- Measure throughput: hashes/second vs CPU reference.
- Profile memory usage: GPU buffers for cache, DAG, and work items.
- Identify bottlenecks and optimize shader code.
- Conduct stability tests under sustained mining simulation.

***

### GPU-First Development Guidelines

- **Validate against CPU reference:** Always compare GPU results against known-good CPU implementations (js-sha3, reference Ethash) to catch bugs early.
- **Storage optimization:** Cache and DAG are computed once on GPU, stored in IndexedDB, and reloaded for subsequent runs (avoid expensive regeneration).
- **Binary format:** Store cache/DAG in binary format matching GPU buffer layout for direct `GPUBuffer` creation without conversion overhead.
- **Parallel processing:** GPU work should batch-process items whenever possible (e.g., compute multiple cache items, DAG items, or hashes in parallel).
- **Memory considerations:** DAG is ~1GB for epoch 0; use GPU streaming or staging buffers if needed for large datasets.

***

### Summary Table

| Step | Focus | Implementation | Validation Focus | Development Tips |
| :-- | :-- | :-- | :-- | :-- |
| 1 | WebGPU setup | Device initialization | Device acquired | Console + inspector tests |
| 2 | Buffer IO | Simple WGSL compute | Array content matches | Use buffer mapping |
| 3 | Keccak-512 GPU | WGSL shader + batch | GPU vs CPU results match | Compare known test vectors |
| 4 | Cache generation | GPU shader + storage | Cache hash/size matches | Store to IndexedDB |
| 5 | DAG generation | GPU shader + storage | DAG hash/size matches | Verify against ethminer |
| 6 | Validation | Test framework | GPU DAG values correct | Sample random indices |
| 7 | Hashimoto GPU | WGSL shader + FNV | Hash outputs match reference | Use geth validation |
| 8 | Full pipeline | Integrated shaders | End-to-end correctness | Multi-nonce batching |
| 9 | Profiling | Performance analysis | Throughput & memory metrics | Use WebGPU inspector |

***

### Key Principles

1. **GPU-native from the start:** All heavy computations (Keccak, cache gen, DAG gen, mining) should run on GPU.
2. **CPU used for I/O only:** CPU handles storage, validation, and orchestration; GPU handles computation.
3. **Test-driven:** Each step validates GPU output against CPU reference before moving forward.
4. **Incremental complexity:** Start simple (Step 2), add complexity gradually, benchmark at each stage.
5. **Storage first:** Avoid regenerating expensive data; cache/DAG storage is critical for usability.

This plan ensures proper GPU acceleration while maintaining correctness through validation at every step.
