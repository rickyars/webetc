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


#### Step 4 — Cache Generation (CPU → GPU Memory)

- Use @ethereumjs/ethash to generate cache on CPU (one-time per epoch, ~30 seconds)
- **Validation:** Compare with reference implementation (already built-in)
- **GPU Memory Transfer:** Upload cache to GPU buffer (keep resident)
- **Validation on GPU:** Verify cache copied correctly to GPU (sample items)
- No GPU computation needed; CPU generation acceptable for one-time setup


#### Step 5 — DAG Generation (CPU → GPU Memory)

- Use @ethereumjs/ethash to generate DAG on CPU (one-time per epoch, ~2-3 minutes)
- **Validation:** Compare with reference implementation (already built-in)
- **GPU Memory Transfer:** Upload DAG to GPU buffer (keep resident)
- **Validation on GPU:** Verify DAG copied correctly to GPU (sample items)
- No GPU computation needed; CPU generation acceptable for one-time setup
- **Browser-Standalone:** Keep both cache and DAG in GPU memory (no IndexedDB)


#### Step 6 — GPU Hashimoto Shader

- Implement GPU compute shader for Hashimoto algorithm
- Input: batch of nonces (e.g., 1000s in parallel)
- Algorithm: For each nonce:
  - Mix with DAG items (256 random accesses per nonce)
  - FNV-1a mixing with cache/DAG lookups
  - Final hash with Keccak-512
- Output: Full hashes for all nonces
- Test with known mining nonces against reference implementation


#### Step 7 — GPU Difficulty Filter

- Implement second GPU kernel for difficulty comparison
- Input: hashes from Hashimoto kernel
- Algorithm: For each hash, check if `hash < 2^256 / difficulty`
- Output: **Only winning nonces** (keep empty slots as zeros or use atomics for compaction)
- **Key optimization:** Massively reduce GPU→CPU transfer bandwidth
- Test with known difficulty thresholds


#### Step 8 — Full Mining Pipeline Integration

- Orchestrate setup + mining phases
- Setup (once per epoch): Generate cache/DAG, upload to GPU
- Mining loop:
  1. Launch Hashimoto kernel with batch nonces
  2. Launch difficulty filter kernel
  3. Transfer only winning nonces back to CPU
  4. CPU validates and submits solutions
- Benchmark: Measure hashes/second and transfer efficiency
- Compare against ethminer/geth for correctness validation


#### Step 9 — Performance Profiling & Optimization

- Use WebGPU Inspector to profile shader execution time, memory bandwidth, occupancy
- Measure throughput: hashes/second on GPU vs CPU reference
- Profile GPU memory usage and transfer times
- Optimize batch sizes for best GPU utilization
- Test stability under sustained mining (minutes/hours)
- Analyze transfer overhead savings from GPU difficulty filtering

***

### GPU-First Development Guidelines (Browser-Standalone)

- **Validate against CPU reference:** Always compare GPU results against known-good CPU implementations (@ethereumjs/ethash, js-sha3) to catch bugs early.
- **Setup vs Mining:** Separate phases - setup (cache/DAG generation) runs once per epoch on CPU; mining (Hashimoto + difficulty) runs continuously on GPU.
- **GPU Memory Resident:** Keep cache + DAG in GPU memory for entire epoch (no IndexedDB needed for browser-standalone).
- **GPU Filtering:** Minimize GPU→CPU transfer by filtering on GPU (difficulty check) before returning results.
- **Parallel Mining:** Batch process 1000s of nonces in parallel on GPU (256 threads per nonce × large workgroups).
- **Direct Buffer Mapping:** Transfer cache/DAG as binary blobs directly to GPU buffers (zero-copy when possible).
- **Memory considerations:** DAG is ~1GB for epoch 0; stays in GPU VRAM for entire mining epoch. Validate copy integrity before mining begins.

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
