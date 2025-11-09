/**
 * Epoch Management for Ethash
 * Handles epoch calculation and seedHash derivation
 */

import { keccak256 } from 'js-sha3';

/**
 * Ethereum Classic epoch calculation
 * ETC uses 60,000 blocks per epoch after the Thanos fork
 */
export const BLOCKS_PER_EPOCH_ETC = 60000;

/**
 * Ethereum epoch calculation (pre-merge)
 * ETH used 30,000 blocks per epoch
 */
export const BLOCKS_PER_EPOCH_ETH = 30000;

/**
 * Cache for seedHash → epoch lookups
 * Avoids recomputing iterative Keccak-256 for known seeds
 */
const seedHashCache = new Map<string, number>();

/**
 * Reverse cache for epoch → seedHash lookups
 */
const epochSeedCache = new Map<number, string>();

/**
 * Get epoch number from block number
 * Uses ETC epoch length by default (60,000 blocks)
 *
 * @param blockNumber Block number
 * @param blocksPerEpoch Blocks per epoch (default: 60000 for ETC)
 * @returns Epoch number
 */
export function getEpochFromBlockNumber(
  blockNumber: number,
  blocksPerEpoch: number = BLOCKS_PER_EPOCH_ETC
): number {
  return Math.floor(blockNumber / blocksPerEpoch);
}

/**
 * Get seedHash for a given epoch
 * SeedHash is computed by iteratively applying Keccak-256:
 * - Epoch 0: 0x00...00 (32 zero bytes)
 * - Epoch N: Keccak-256(seedHash[N-1])
 *
 * @param epoch Epoch number
 * @returns Seed hash as 0x-prefixed hex string
 */
export function getSeedHashForEpoch(epoch: number): string {
  // Check cache first
  if (epochSeedCache.has(epoch)) {
    return epochSeedCache.get(epoch)!;
  }

  // Epoch 0 seed is 32 zero bytes
  if (epoch === 0) {
    const seed = '0x' + '00'.repeat(32);
    epochSeedCache.set(0, seed);
    seedHashCache.set(seed, 0);
    return seed;
  }

  // Compute iteratively from epoch 0
  let seed = new Uint8Array(32); // Start with zeros

  for (let i = 0; i < epoch; i++) {
    // Keccak-256(seed)
    const hashHex = keccak256(seed);
    seed = hexToBytes(hashHex);
  }

  const seedHex = '0x' + bytesToHex(seed);

  // Cache results
  epochSeedCache.set(epoch, seedHex);
  seedHashCache.set(seedHex, epoch);

  return seedHex;
}

/**
 * Get epoch number from seedHash
 * Uses cache if available, otherwise computes iteratively
 *
 * @param seedHash Seed hash as 0x-prefixed hex string
 * @param maxEpoch Maximum epoch to check (default: 1000, ~6 years for ETC)
 * @returns Epoch number, or -1 if not found
 */
export function getEpochFromSeedHash(seedHash: string, maxEpoch: number = 1000): number {
  // Normalize seedHash (ensure 0x prefix and lowercase)
  const normalizedSeed = seedHash.toLowerCase().startsWith('0x')
    ? seedHash.toLowerCase()
    : '0x' + seedHash.toLowerCase();

  // Check cache first
  if (seedHashCache.has(normalizedSeed)) {
    return seedHashCache.get(normalizedSeed)!;
  }

  // Compute iteratively from epoch 0
  let seed = new Uint8Array(32); // Epoch 0: zeros

  for (let epoch = 0; epoch <= maxEpoch; epoch++) {
    const currentSeedHex = '0x' + bytesToHex(seed);

    // Cache this result
    epochSeedCache.set(epoch, currentSeedHex);
    seedHashCache.set(currentSeedHex, epoch);

    // Check if this matches our target
    if (currentSeedHex === normalizedSeed) {
      return epoch;
    }

    // Compute next seed: Keccak-256(current)
    const hashHex = keccak256(seed);
    seed = hexToBytes(hashHex);
  }

  console.warn(`Could not find epoch for seedHash ${seedHash} (searched up to epoch ${maxEpoch})`);
  return -1;
}

/**
 * Check if epoch has changed between two seed hashes
 */
export function hasEpochChanged(currentSeed: string, newSeed: string): boolean {
  return currentSeed.toLowerCase() !== newSeed.toLowerCase();
}

/**
 * Validate that epoch matches block number
 * Useful for sanity checking RPC data
 */
export function validateEpoch(
  epoch: number,
  blockNumber: number,
  blocksPerEpoch: number = BLOCKS_PER_EPOCH_ETC
): boolean {
  const expectedEpoch = getEpochFromBlockNumber(blockNumber, blocksPerEpoch);
  return epoch === expectedEpoch;
}

/**
 * Get expected DAG size for an epoch
 * This is an approximation based on the Ethash spec
 *
 * @param epoch Epoch number
 * @returns DAG size in bytes
 */
export function getExpectedDAGSize(epoch: number): number {
  // Ethash DAG size formula (approximate):
  // Initial size: 1 GB (epoch 0)
  // Growth: ~8 MB per epoch
  const INITIAL_SIZE = 1073739904; // ~1 GB
  const GROWTH_PER_EPOCH = 8388608; // ~8 MB

  return INITIAL_SIZE + (epoch * GROWTH_PER_EPOCH);
}

/**
 * Get expected cache size for an epoch
 *
 * @param epoch Epoch number
 * @returns Cache size in bytes
 */
export function getExpectedCacheSize(epoch: number): number {
  // Ethash cache size formula (approximate):
  // Initial size: 16 MB (epoch 0)
  // Growth: ~128 KB per epoch
  const INITIAL_SIZE = 16776896; // ~16 MB
  const GROWTH_PER_EPOCH = 131072; // ~128 KB

  return INITIAL_SIZE + (epoch * GROWTH_PER_EPOCH);
}

/**
 * Helper: Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Helper: Convert Uint8Array to hex string (no 0x prefix)
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Pre-populate cache with common epochs for ETC
 * Speeds up lookups for current mining epochs
 */
export function warmupEpochCache(maxEpoch: number = 500): void {
  console.log(`Warming up epoch cache (0-${maxEpoch})...`);
  const start = performance.now();

  for (let epoch = 0; epoch <= maxEpoch; epoch++) {
    getSeedHashForEpoch(epoch);
  }

  const elapsed = performance.now() - start;
  console.log(`✓ Epoch cache warmed up (${maxEpoch + 1} epochs, ${elapsed.toFixed(0)}ms)`);
}
