# Testing Guide: Ethash WebGPU Implementation

## Quick Start

### Browser Testing (Standalone HTML)
1. Build the project: `npm run build`
2. Open `standalone.html` in a WebGPU-capable browser (Chrome/Edge 113+)
3. Click buttons in sequence:
   - **Step 1:** Initializes WebGPU device
   - **Step 2:** Tests compute shader and buffer I/O
   - **Step 3:** Validates Keccak-512/256 (js-sha3 reference)
   - **Step 4:** Tests FNV hash function
   - **Step 5:** Generates and validates cache (with progress bar)
   - **Step 6:** DAG generation (coming next)
   - **Run All:** Executes all steps sequentially

### Development Testing
```bash
npm run build      # Compile TypeScript
npm run dev        # Local dev server with hot reload
npm run preview    # Preview production build
```

## Implementation Stages

### Stage 1: Verification & Setup (COMPLETE ✓)

**Step 1: WebGPU Initialization**
- Initializes GPU device and validates capabilities
- Logs device info (backend, limits, features)
- Expected output: Device properties displayed

**Step 2: Compute Shader Test**
- Runs trivial compute shader writing pattern to buffer
- Validates buffer I/O and readback
- Expected output: `[1234, 1276, 1318, ...]` pattern verified

**Step 3: Keccak Reference Validation**
- Tests Keccak-256 and Keccak-512 via js-sha3 library
- Verifies test vectors match expected values
- Expected output:
  ```
  ✓ Keccak-256: empty → c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
  ✓ Keccak-512: empty → 0eab42de4c3ceb9235fc91acffe746b29c29a8c366b7c60e4e67c466f36a4304...
  ```

### Stage 2: Ethash Foundation (COMPLETE ✓)

**Step 4: FNV Hash Function**
- Tests FNV mixing function: `(a * 0x01000193) ^ b`
- Uses 3 test vectors from Ethash specification
- Expected output:
  ```
  ✓ fnvEthash(0x00000066, 0x00000000): 0x050c5d7e
  ```

**Step 5: Cache Generation**
- Generates Ethash cache for epoch 0
- **Epoch 0 parameters:**
  - Items: 262,139 (prime ✓)
  - Size: ~16 MB
  - Per item: 64 bytes
- **Algorithm:**
  1. Seed: `keccak512(epoch)` in little-endian
  2. Generate items: chain `keccak512(seed)`
  3. Mix: 3 rounds with random XOR
- **Expected output:**
  - ✓ Cache size: 16.00 MB
  - ✓ First cache item: (displayed)
  - ⏱ Generation time: ~100-500ms
  - 📊 Progress bar: Shows generation progress

### Stage 3: DAG Generation (IN PROGRESS)

**Step 6: DAG Generation** (coming next)
- Generates Ethash DAG for epoch 0
- **Epoch 0 parameters:**
  - Items: 8,388,593 (prime)
  - Size: ~1 GB
  - Per item: 128 bytes
- **Algorithm:**
  1. For each item: initialize from cache
  2. 256 FNV mixing rounds with pseudo-random parents
  3. Compression: 16→4 words
  4. Expansion: 4→8 words
  5. Final Keccak-512 hash
- **Expected output:**
  - ✓ DAG size: 1.00 GB
  - ✓ First DAG items: (displayed)
  - ⏱ Generation time: ~5-30 minutes (intentionally slow, memory-hard design)
  - 📊 Progress bar: Shows detailed progress

### Stage 4: GPU Validation (PLANNED)

**Step 7: GPU Keccak Validation** (planned)
- Validate existing WGSL shader against CPU reference
- Compare outputs on test vectors
- Benchmark GPU vs CPU performance

**Step 8: Hashimoto Implementation** (planned)
- Implement mining algorithm
- Test with known nonces and expected outputs
- Validate against reference implementations

**Step 9: Full GPU Pipeline** (planned)
- Integrate all GPU shaders
- Batch-process multiple nonces
- Performance profiling and optimization

## What to Expect

### Cache Generation (Step 5)
- **First run:** ~100-500ms for 262,139 items
- **Progress display:**
  - Shows % complete
  - Current/total item count
  - Status messages: "Generating cache items...", "Mixed round 1/3..."
- **Console output:**
  ```
  Generating cache for epoch 0...
    Cache items: 262,139 (prime)
    Cache size: 16.00 MB
  ```

### DAG Generation (Step 6, Coming Soon)
- **Expected time:** 5-30 minutes for full epoch 0
  - Memory-hard by design (anti-ASIC property of Ethash)
  - Cannot be optimized much on CPU
- **Progress display:**
  - Granular updates every 1000+ items
  - Detailed mixing phase progress
  - Time estimation would be helpful
- **Console output:**
  ```
  Generating DAG for epoch 0...
    DAG items: 8,388,593 (prime)
    DAG size: 1000.00 MB
    Mixing 256 rounds per item...
  ```

## Browser Requirements

### Supported Browsers
- ✅ Chrome 113+
- ✅ Edge 113+
- ✅ Firefox Nightly
- ✅ Safari (experimental)

### Browser Flags (if needed)
- Go to `chrome://flags`
- Search: "WebGPU"
- Set to: "Enabled"

### Hardware Requirements
- GPU with WebGPU support
- 4GB+ RAM (for full DAG generation)
- Modern GPU for reasonable performance

## Troubleshooting

### Issue: WebGPU Not Available
- **Solution:** Update browser to latest version
- **Check:** Open DevTools Console, WebGPU should initialize without errors

### Issue: Step 5 Hangs or Freezes
- **Expected:** Cache generation may take up to 500ms, showing progress
- **Solution:** Wait for progress bar to complete (should be fast)
- **Check:** Browser console for error messages

### Issue: DAG Generation Takes Forever
- **Expected:** 5-30 minutes is CORRECT by design (memory-hard algorithm)
- **Solution:** Let it run in background
- **Monitor:** Progress bar updates every 1000 items
- **Abort:** Close browser tab to stop

### Issue: Progress Bar Not Showing
- **Check:** Browser DevTools > Elements, find `#progress-container`
- **Verify:** CSS classes exist in page
- **Clear:** Browser cache (Ctrl+Shift+Delete)

### Issue: Keccak Test Fails
- **Check:** js-sha3 library loaded (should be in dist/main.js)
- **Verify:** Node modules: `npm install`
- **Rebuild:** `npm run build`

### Issue: FNV Hash Shows Wrong Results
- **Check:** Little-endian byte order assumptions
- **Verify:** FNV_PRIME = 0x01000193
- **Debug:** Compare with algorithm specification

## Validation Checks

### Step 3: Keccak Verification
- ✅ Keccak-512 test vectors match js-sha3
- ✅ Keccak-256 test vectors match js-sha3
- Validates: CPU reference implementation is correct

### Step 4: FNV Verification
- ✅ FNV function produces expected outputs
- ✅ All 3 test vectors pass
- Validates: Parent selection algorithm is correct

### Step 5: Cache Verification
- ✅ Cache size matches calculation (16 MB for epoch 0)
- ✅ Item count is prime (262,139 for epoch 0)
- ✅ Cache contains non-zero values
- ✅ First few items match expected pattern
- Validates: Cache generation algorithm is correct

### Step 6: DAG Verification (When Implemented)
- ✅ DAG size matches calculation (1 GB for epoch 0)
- ✅ Item count is prime (8,388,593 for epoch 0)
- ✅ DAG items contain mix of values
- ✅ First few items match reference vectors
- Validates: DAG generation algorithm is correct

## Reference Implementation

### Using Battle-Tested Libraries
- **Keccak:** `js-sha3` npm package (widely used in production)
- **Why:** Audited, tested, and known to be correct
- **Test vectors:** Derived from official Ethereum implementations

### Algorithm Reference
- `ETHASH_ALGORITHM_REFERENCE.md` - Detailed pseudocode and specifications
- `STATUS.md` - Current implementation status

## Performance Benchmarks

### Current System (CPU Implementation)
```
Step 1: WebGPU Init       ~50-100ms
Step 2: Shader Test       ~10-50ms
Step 3: Keccak Tests      ~10-50ms
Step 4: FNV Tests         < 1ms
Step 5: Cache Gen         100-500ms (262,139 items)
Step 6: DAG Gen (planned) 5-30 minutes (8,388,593 items)
```

### Expected GPU Performance (When Implemented)
```
Cache Gen               < 100ms (parallel batching)
DAG Gen                < 30 seconds (massive parallelism)
Hashimoto              > 10M hashes/second
```

## Development Workflow

### Adding New Tests
1. Create test function in `src/main.ts`
2. Add step button in HTML template
3. Implement progress monitoring if long-running
4. Add console logging for debugging
5. Build and test in browser: `npm run build`

### Debugging
- **Browser DevTools:** F12 key
- **Console:** All operations logged
- **Network:** WGSL shaders loaded from dist/
- **Performance:** Use Performance tab to profile

### Common Development Tasks

**Test a specific step:**
```bash
npm run build
# Open standalone.html
# Click Step X button
```

**Test in dev mode:**
```bash
npm run dev
# Open http://localhost:5173
# Hot reload on file changes
```

**Profile performance:**
```bash
npm run build
# Open DevTools Performance tab
# Click "Start Recording"
# Click test button
# Click "Stop Recording"
# Analyze timeline
```

## Commit Checklist

Before committing code:
- ✅ All tests pass in browser
- ✅ No console errors
- ✅ Progress bars working
- ✅ Documentation updated
- ✅ Build succeeds: `npm run build`
- ✅ No unverified code pushed

## Next Testing Phases

1. **DAG Validation Phase** (Step 6)
   - Implement DAG generation with progress monitoring
   - Test with small epoch (faster iteration)
   - Validate against reference vectors

2. **GPU Validation Phase** (Step 7)
   - Validate existing GPU Keccak shader
   - Compare GPU vs CPU output
   - Benchmark performance

3. **Integration Phase** (Steps 8-9)
   - Implement Hashimoto algorithm
   - Full GPU pipeline
   - End-to-end testing

4. **Production Phase**
   - Performance profiling
   - Memory optimization
   - Stress testing
   - Reference vector comparison

