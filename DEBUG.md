# GPU Hashimoto Debugging - Problem Analysis

## Problem Summary

**Goal:** GPU Hashimoto should produce the same output as ethereumjs.Ethash.run()

**The Issue:** GPU is producing completely different hashes than ethereumjs

**Reference Vectors (from ethereumjs):**
- Nonce `0000000000000000` → `edbeac79...`
- Nonce `0100000000000000` → `1a5b48ba...`
- Nonce `0200000000000000` → `3e7fbb8a...`

**GPU Produces:**
- Nonce `0000000000000000` → `fca4fd4c...`
- Nonce `0100000000000000` → `60d604d3...`
- Nonce `0200000000000000` → `0c8b44ce...`

---

## What I've Found So Far

**The Key Discovery:** When the nonce reversal code in the shader was modified, the GPU output changed to different values.

This proves:
1. ✅ The shader IS being recompiled
2. ✅ Changes to the shader DO affect GPU output
3. ✅ The shader code IS executing

**So the nonce reversal code IS running**, but it's producing the wrong output.

---

## Where I Think the Problem Is

**Most Likely:** The nonce reversal **mathematics/algorithm is wrong**, not that the code isn't executing.

The current reversal code does:
```wgsl
let nonce_lo_reversed = ((nonce_lo & 0x000000FFu) << 24u) | ((nonce_lo & 0x0000FF00u) << 8u) |
                        ((nonce_lo & 0x00FF0000u) >> 8u) | ((nonce_lo & 0xFF000000u) >> 24u);
```

I mathematically verified this in JavaScript and it produces the correct byte reversal. But maybe:

1. **WGSL bit operations work differently than JavaScript**
   - Different semantics for unsigned shifts?
   - Different behavior with large numbers?

2. **The u32 array interpretation in WGSL is different**
   - How WGSL reads/writes u32 arrays vs JavaScript
   - Endianness issues in WGSL arrays

3. **The overall algorithm logic is wrong**
   - Maybe we shouldn't be swapping lo/hi
   - Or the reversal order/placement is fundamentally incorrect

---

## Why This Is Stuck

I've verified the logic in JavaScript multiple times and it's mathematically correct. But:
- The GPU output is still wrong
- When I modify the shader, the output changes (so code is executing)
- But the changes don't produce the correct ethereumjs output

The disconnect is between:
- **What should happen mathematically** (verified correct in JS)
- **What actually happens in the GPU** (produces wrong output)

This suggests the issue is deeper - either:
1. **WGSL semantics are different** from what I expect
2. **The entire algorithm approach is wrong** (not just the reversal)
3. **There's a subtle bug in the Keccak or mixing loop** that's unrelated to reversal

---

## What Needs to Happen to Fix This

To fix this, the investigation needs to:

1. **Create a minimal test that compares Stage 1 output only** (just Keccak-512 with reversed nonce)
   - CPU: `keccak512(header || bytesReverse(nonce))`
   - GPU: Whatever the shader produces for that input
   - See if they match

2. **If Stage 1 output is wrong**, the problem is in Keccak or nonce reversal
   - Trace through the shader to see what u32 values are actually being fed to Keccak
   - Compare against expected values
   - Check WGSL bit operation semantics

3. **If Stage 1 output is correct** but final hash is wrong, problem is in:
   - Stages 2-5 (mixing loop, compression, final Keccak)
   - Something else in the pipeline

---

## Key Facts

- The nonce reversal code in the shader IS executing (proven by output changing when modified)
- The mathematics of the reversal appears correct when verified in JavaScript
- The GPU is producing reproducible output (same output for same nonce)
- Different nonces produce different outputs (GPU is using nonces correctly)
- The issue appears to be in how Stage 1 (Keccak-512) is handling the reversed nonce

---

## Test File

A verification test exists at: `src/tests/test-hashimoto-verification.html`

This test:
1. Sets up GPU Hashimoto for epoch 0
2. Runs 3 test nonces through GPU
3. Compares against ethereumjs reference values
4. Reports 0/3 matches (all mismatches)

The test definitively shows GPU output does not match ethereumjs.
