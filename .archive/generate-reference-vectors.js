/**
 * Generate reference Ethash test vectors using our implementation
 * These will be used to validate our DAG generation
 */

import sha3 from 'js-sha3';

// Copy our Ethash implementation helpers
function fnvEthash(a, b) {
    return (((a >>> 0) * 0x01000193) ^ (b >>> 0)) >>> 0;
}

function isPrime(n) {
    if (n <= 1) return false;
    if (n <= 3) return true;
    if (n % 2 === 0 || n % 3 === 0) return false;

    for (let i = 5; i * i <= n; i += 6) {
        if (n % i === 0 || n % (i + 2) === 0) return false;
    }

    return true;
}

const ETHASH_PARAMS = {
    HASH_BYTES: 64,
    MIX_BYTES: 128,
    CACHE_GROWTH: 131072,
    DAG_GROWTH: 8388608,
};

function getCacheSize(epoch) {
    const baseSize = 16 * 1024 * 1024 + epoch * ETHASH_PARAMS.CACHE_GROWTH;
    let size = baseSize - (baseSize % ETHASH_PARAMS.HASH_BYTES);

    while ((size / ETHASH_PARAMS.HASH_BYTES) % 2 === 0) {
        size -= ETHASH_PARAMS.HASH_BYTES;
    }

    for (let i = 0; i < 10000; i++) {
        if (isPrime(size / ETHASH_PARAMS.HASH_BYTES)) {
            return size;
        }
        size -= 2 * ETHASH_PARAMS.HASH_BYTES;
        if (size < 1000 * 1024) return baseSize;
    }

    return baseSize;
}

// Convert uint32 to bytes (little-endian)
function uint32ToBytes(val) {
    return new Uint8Array([
        val & 0xff,
        (val >> 8) & 0xff,
        (val >> 16) & 0xff,
        (val >> 24) & 0xff
    ]);
}

// Convert bytes to uint32 (little-endian)
function bytesToUint32(bytes, offset = 0) {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}

function generateCache(epoch) {
    const cacheSize = getCacheSize(epoch);
    const itemCount = cacheSize / ETHASH_PARAMS.HASH_BYTES;

    const cache = new Uint32Array(itemCount * (ETHASH_PARAMS.HASH_BYTES / 4));

    // Seed: keccak512(epoch as uint32 little-endian)
    const seedInput = new Uint8Array(4);
    new DataView(seedInput.buffer).setUint32(0, epoch, true);

    let seed = new Uint8Array(sha3.keccak512.array(seedInput));

    // Initialize cache items
    for (let i = 0; i < itemCount; i++) {
        const offset = i * (ETHASH_PARAMS.HASH_BYTES / 4);
        seed = new Uint8Array(sha3.keccak512.array(seed));

        // Convert seed bytes to u32 array (little-endian)
        for (let j = 0; j < ETHASH_PARAMS.HASH_BYTES / 4; j++) {
            cache[offset + j] = bytesToUint32(seed, j * 4);
        }
    }

    // Mix cache (2 rounds of mixing per item)
    for (let i = 0; i < itemCount; i++) {
        const offset = i * (ETHASH_PARAMS.HASH_BYTES / 4);

        // Each cache item is mixed with 2 parents
        for (let j = 0; j < 2; j++) {
            // Select parent index based on first word of current cache item
            const parentIdx = cache[offset] % itemCount;
            const parentOffset = parentIdx * (ETHASH_PARAMS.HASH_BYTES / 4);

            // XOR with parent's data
            for (let k = 0; k < ETHASH_PARAMS.HASH_BYTES / 4; k++) {
                cache[offset + k] ^= cache[parentOffset + k];
            }
        }
    }

    return cache;
}

function calcDatasetItem(cache, index, cacheItemCount) {
    const DATASET_PARENTS = 256;
    const HASH_WORDS = ETHASH_PARAMS.HASH_BYTES / 4;

    const intMix = new Uint32Array(HASH_WORDS);
    const parentIndex = index % cacheItemCount;
    const parentOffset = parentIndex * HASH_WORDS;

    for (let j = 0; j < HASH_WORDS; j++) {
        intMix[j] = cache[parentOffset + j];
    }
    intMix[0] ^= index;

    // Keccak-512 hash the initial mix
    const mixHashBytes = new Uint8Array(intMix.buffer, intMix.byteOffset, ETHASH_PARAMS.HASH_BYTES);
    const mixHash = new Uint8Array(sha3.keccak512.array(mixHashBytes));
    const mixHashWords = new Uint32Array(mixHash.buffer);

    for (let j = 0; j < HASH_WORDS; j++) {
        intMix[j] = mixHashWords[j];
    }

    // 256 FNV mixing rounds
    for (let i = 0; i < DATASET_PARENTS; i++) {
        const parentIdx = fnvEthash(index ^ i, intMix[i % HASH_WORDS]) % cacheItemCount;
        const cacheOffset = parentIdx * HASH_WORDS;

        for (let j = 0; j < HASH_WORDS; j++) {
            intMix[j] = fnvEthash(intMix[j], cache[cacheOffset + j]);
        }
    }

    // Compress 16 words to 4 words
    const compressed = new Uint32Array(4);
    for (let i = 0; i < HASH_WORDS; i += 4) {
        compressed[i / 4] = fnvEthash(
            fnvEthash(compressed[i / 4], intMix[i]),
            intMix[i + 1]
        );
        compressed[i / 4] = fnvEthash(
            fnvEthash(compressed[i / 4], intMix[i + 2]),
            intMix[i + 3]
        );
    }

    // Expand back to 8 words
    const expanded = new Uint32Array(8);
    for (let i = 0; i < 4; i++) {
        expanded[i] = compressed[i];
        expanded[4 + i] = fnvEthash(compressed[i], 0x01000193);
    }

    // Final Keccak-512 hash
    const expandedBytes = new Uint8Array(expanded.buffer, expanded.byteOffset, 32);
    const dagItem = new Uint8Array(sha3.keccak512.array(expandedBytes));
    return new Uint32Array(dagItem.buffer);
}

// Generate reference vectors for epoch 0
console.log('Generating reference test vectors for Ethash Epoch 0...\n');

const epoch = 0;
const cache = generateCache(epoch);
const cacheSize = getCacheSize(epoch);
const cacheItemCount = cacheSize / ETHASH_PARAMS.HASH_BYTES;

console.log('Cache generated:');
console.log('  Items:', cacheItemCount);
console.log('  Size:', (cacheSize / 1024 / 1024).toFixed(2), 'MB');
console.log('');

// Select specific cache items to verify
const cacheIndices = [0, 100, 1000, 10000, 100000];
console.log('Reference Cache Items:');
for (const idx of cacheIndices) {
    if (idx < cacheItemCount) {
        const offset = idx * 16; // 64 bytes / 4 = 16 uint32s
        const values = [];
        for (let i = 0; i < 4; i++) {
            values.push('0x' + cache[offset + i].toString(16).padStart(8, '0'));
        }
        console.log(`  cache[${idx}]: [${values.join(', ')}]`);
    }
}

console.log('');

// Generate reference DAG items
console.log('Generating reference DAG items...');
const dagIndices = [0, 100, 1000, 10000];
const refVectors = {
    epoch: epoch,
    cache_items: {},
    dag_items: {}
};

for (const idx of cacheIndices.slice(0, 3)) {
    if (idx < cacheItemCount) {
        const offset = idx * 16;
        refVectors.cache_items[`cache_${idx}`] = {
            index: idx,
            words: Array.from(cache.slice(offset, offset + 16)).map(w => '0x' + w.toString(16).padStart(8, '0'))
        };
    }
}

console.log('Reference DAG Items:');
for (const idx of dagIndices) {
    const dagItem = calcDatasetItem(cache, idx, cacheItemCount);
    const words = Array.from(dagItem.slice(0, 4)).map(w => '0x' + w.toString(16).padStart(8, '0'));
    console.log(`  dag[${idx}]: [${words.join(', ')}]`);

    refVectors.dag_items[`dag_${idx}`] = {
        index: idx,
        words: Array.from(dagItem).map(w => '0x' + w.toString(16).padStart(8, '0'))
    };
}

// Output as JSON that can be used in standalone.html
console.log('\n');
console.log('=== JSON for standalone.html ===');
console.log(JSON.stringify(refVectors, null, 2));
