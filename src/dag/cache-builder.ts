/**
 * Ethash Cache Generation (CPU Reference Implementation)
 *
 * Cache is a small (~16 MB) dataset derived from epoch number.
 * Used as parent data for DAG generation.
 *
 * Algorithm:
 * 1. Calculate cache size (must be prime number of 64-byte items)
 * 2. Generate initial cache items from Keccak-512 chain
 * 3. Mix cache: 2 rounds per item with random XOR
 *
 * Reference: ETHASH_ALGORITHM_REFERENCE.md
 */

import { keccak512 } from '../crypto/keccak-cpu';

// Ethash Constants
export const HASH_BYTES = 64; // Keccak-512 output size in bytes
export const HASH_WORDS = 16; // HASH_BYTES / 4 = 16 uint32 words per hash
export const CACHE_ROUNDS = 3; // Number of times to iterate cache items
export const CACHE_INIT_BYTES = 16 * 1024 * 1024; // 16 MB starting cache size
export const CACHE_GROWTH_BYTES = 128 * 1024; // Growth rate: 128 KB per epoch

/**
 * Calculate cache size (must be prime number of 64-byte items)
 *
 * Algorithm (from Ethash spec):
 * 1. Base size: 16 MB + epoch * 128 KB
 * 2. Reduce to odd number of items
 * 3. Find largest prime less than that
 *
 * @param epoch The epoch number (0, 1, 2, ...)
 * @returns Number of 64-byte cache items (guaranteed prime)
 */
export function getCacheItemCount(epoch: number): number {
  const bytes = CACHE_INIT_BYTES + epoch * CACHE_GROWTH_BYTES;
  let items = Math.floor(bytes / HASH_BYTES);

  // Reduce to odd number
  if (items % 2 === 0) {
    items -= 1;
  }

  // Find largest prime less than items
  while (!isPrime(items)) {
    items -= 2;
  }

  return items;
}

/**
 * Check if a number is prime (simple trial division)
 * Optimized for Ethash use case where numbers are large and odd
 *
 * @param n Number to check
 * @returns true if prime, false otherwise
 */
function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;

  // Check odd divisors up to sqrt(n)
  const limit = Math.sqrt(n);
  for (let i = 3; i <= limit; i += 2) {
    if (n % i === 0) {
      return false;
    }
  }

  return true;
}

/**
 * Progress callback type for cache generation
 */
export type CacheProgressCallback = (current: number, total: number, message?: string) => void;

/**
 * Generate Ethash cache for given epoch
 *
 * Algorithm:
 * 1. Calculate cache size (prime number of items)
 * 2. Generate seed: keccak512(epoch in little-endian)
 * 3. Generate cache items: chain keccak512
 * 4. Mix cache: 2 rounds per item with random parents
 *
 * @param epoch The epoch number (0, 1, 2, ...)
 * @param progressCallback Optional callback for progress monitoring
 * @returns Cache as Uint32Array (items * HASH_WORDS elements)
 */
export function generateCache(
  epoch: number,
  progressCallback?: CacheProgressCallback
): Uint32Array {
  const cacheItemCount = getCacheItemCount(epoch);
  const cacheSize = cacheItemCount * HASH_WORDS; // in uint32 words
  const cache = new Uint32Array(cacheSize);

  console.log(`Generating cache for epoch ${epoch}...`);
  console.log(`  Cache items: ${cacheItemCount} (prime)`);
  console.log(`  Cache size: ${(cacheItemCount * HASH_BYTES) / (1024 * 1024)} MB`);

  if (progressCallback) {
    progressCallback(0, cacheItemCount * 2, 'Generating cache items...');
  }

  // Step 1: Generate seed from epoch number (little-endian)
  const epochBytes = new Uint8Array(4);
  const view = new DataView(epochBytes.buffer);
  view.setUint32(0, epoch, true); // true = little-endian
  const seed = keccak512(epochBytes);

  // Step 2: Generate initial cache items
  // First item: keccak512(seed)
  let item = seed.slice(); // Copy seed as first item

  for (let i = 0; i < cacheItemCount; i++) {
    // Each subsequent item is keccak512 of previous
    item = keccak512(item);

    // Store as uint32 array in cache
    const itemView = new DataView(item.buffer);
    for (let j = 0; j < HASH_WORDS; j++) {
      cache[i * HASH_WORDS + j] = itemView.getUint32(j * 4, true); // little-endian
    }

    // Progress reporting (every 1000 items or at end)
    if (progressCallback && (i % 1000 === 999 || i === cacheItemCount - 1)) {
      progressCallback(i + 1, cacheItemCount * 2, `Generated ${i + 1} items...`);
    }
  }

  // Step 3: Mix cache (CACHE_ROUNDS rounds per item)
  for (let round = 0; round < CACHE_ROUNDS; round++) {
    for (let i = 0; i < cacheItemCount; i++) {
      // Get first word of this item (used for random parent selection)
      const firstWord = cache[i * HASH_WORDS];

      // Select parent based on first word
      const parent = firstWord % cacheItemCount;

      // XOR all words with parent's data
      for (let j = 0; j < HASH_WORDS; j++) {
        cache[i * HASH_WORDS + j] ^= cache[parent * HASH_WORDS + j];
      }
    }

    // Progress reporting for mixing phase
    if (progressCallback) {
      const mixProgress = cacheItemCount + (round + 1) * cacheItemCount;
      progressCallback(
        mixProgress,
        cacheItemCount * 2,
        `Mixed round ${round + 1}/${CACHE_ROUNDS}...`
      );
    }
  }

  if (progressCallback) {
    progressCallback(cacheItemCount * 2, cacheItemCount * 2, 'Cache generation complete');
  }

  return cache;
}

/**
 * Validate cache
 *
 * @param cache The cache to validate
 * @param epoch The epoch it was generated for
 * @returns true if cache is valid, false otherwise
 */
export function validateCache(cache: Uint32Array, epoch: number): boolean {
  const expectedItemCount = getCacheItemCount(epoch);
  const expectedSize = expectedItemCount * HASH_WORDS;

  if (cache.length !== expectedSize) {
    console.error(
      `Cache size mismatch: expected ${expectedSize}, got ${cache.length}`
    );
    return false;
  }

  // Check for non-zero content (cache shouldn't be all zeros)
  let hasNonZero = false;
  for (let i = 0; i < Math.min(100, cache.length); i++) {
    if (cache[i] !== 0) {
      hasNonZero = true;
      break;
    }
  }

  if (!hasNonZero) {
    console.error('Cache contains only zeros - validation failed');
    return false;
  }

  return true;
}
