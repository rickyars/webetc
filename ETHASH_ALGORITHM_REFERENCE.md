# Ethash Algorithm Reference Implementation

## Overview

This document describes the correct Ethash algorithm implementation based on go-ethereum and EIP-1485.

## Key Constants

```
HASH_BYTES = 64              # Keccak-512 output size
HASH_WORDS = 16              # 64 / 4 = 16 uint32 words
MIX_BYTES = 128              # Mix buffer size
MIX_WORDS = 32               # 128 / 4 = 32 uint32 words
DATASET_PARENTS = 256        # Number of cache parents per DAG item
FNV_PRIME = 0x01000193
```

## FNV Function

The FNV function used in Ethash (different from standard FNV-1a):

```javascript
function fnv(a, b) {
    return ((a * 0x01000193) ^ b) >>> 0;
}
```

This multiplies BOTH 32-bit integers (not just one byte), then XORs with b.

## Cache Generation Algorithm

### Input
- epoch: epoch number (0, 1, 2, ...)

### Process

1. **Calculate cache size** (cacheSize must have primality property)
   ```
   Base: 16 MB + epoch * 131,072 bytes
   Adjusted: must be prime number of HASH_BYTES (64-byte chunks)
   ```

2. **Generate cache items** using Keccak-512

   ```javascript
   // Seed generation
   seed = keccak512([epoch as uint32 in little-endian])

   // Initialize cache
   for (i = 0; i < cacheItemCount; i++) {
       seed = keccak512(seed)
       cache[i] = seed as Uint32Array
   }
   ```

3. **Mix cache** (2 rounds of mixing per item)

   ```javascript
   for (i = 0; i < cacheItemCount; i++) {
       for (j = 0; j < 2; j++) {
           // Select random parent based on cache data
           parent = cache[i][0] % cacheItemCount

           // XOR with parent's data
           for (k = 0; k < HASH_WORDS; k++) {
               cache[i][k] ^= cache[parent][k]
           }
       }
   }
   ```

## DAG Item Generation Algorithm

### Input
- epoch: epoch number
- cache: generated cache (Uint32Array)
- index: DAG item index (0 to dagItemCount-1)

### Process

1. **Initialize mix**
   ```javascript
   // Get first 64 bytes (16 uint32s) from cache
   parentIndex = index % cacheItemCount
   mix = new Uint32Array(16)
   cache_row = cache[parentIndex * 16 : parentIndex * 16 + 16]
   mix = cache_row.slice()
   mix[0] ^= index  // XOR with item index
   ```

2. **Keccak-512 hash**
   ```javascript
   mixHash = keccak512(mix.buffer)
   intMix = mixHash as Uint32Array
   ```

3. **FNV mixing loop** (256 iterations)
   ```javascript
   for (i = 0; i < DATASET_PARENTS; i++) {
       // Calculate parent index
       // Mix current intMix[i % 16] with index and iteration
       parentIndex = fnv(index ^ i, intMix[i % HASH_WORDS]) % cacheItemCount

       // Get cache data for this parent
       cacheData = cache[parentIndex * HASH_WORDS : parentIndex * HASH_WORDS + HASH_WORDS]

       // Apply FNV mixing
       for (j = 0; j < HASH_WORDS; j++) {
           intMix[j] = fnv(intMix[j], cacheData[j])
       }
   }
   ```

4. **Compress to 4 words**
   ```javascript
   // Cascade FNV down from 16 to 4 words
   compressed = new Uint32Array(4)
   for (i = 0; i < HASH_WORDS; i += 4) {
       compressed[i/4] = fnv(
           fnv(compressed[i/4], intMix[i]),
           intMix[i+1]
       )
       // ... continue cascading
   }
   ```

5. **Expand back to 8 words**
   ```javascript
   // Expand 4 words back to 8 for 64-byte output
   expanded = new Uint32Array(8)
   for (i = 0; i < 4; i++) {
       expanded[i] = compressed[i]
       expanded[4+i] = compressed[i] ^ 0x01000193  // FNV mixing
   }
   ```

6. **Final Keccak-512**
   ```javascript
   dagItem = keccak512(expanded.buffer)
   // Result is 64 bytes (16 uint32s)
   ```

## Key Differences from Current Implementation

**Current (Simplified)**
- DAG generation: `dag[i] = cacheMix ^ (i + j)` - trivial XOR
- No FNV mixing
- No parent selection
- Generates instantly (suspicious)

**Correct (Real Ethash)**
- DAG generation: 256 FNV mixing rounds with pseudo-random cache parents
- Each DAG item derived from 256 cache items
- Parent indices computed via FNV mixing
- Epoch 0: ~1 GB output, should take 5-20 minutes CPU time

## Test Vectors Needed

To validate the implementation, we need:
1. Known cache item values for epoch 0
2. Known DAG item values for epoch 0
3. References from go-ethereum, ethminer, or official Ethash repo

These can be generated using:
- go-ethereum: `go run . makedag [epoch_number] [output_dir]`
- ethminer: Similar DAG generation functionality
- Python reference implementation: `pyethash` library

## Why This Matters

- **Correctness**: GPU code must match exact algorithm for valid proofs
- **Performance**: Real algorithm is memory-hard (anti-ASIC design)
- **Validation**: Can't prove code works without correct reference values
