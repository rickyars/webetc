/**
 * Step 3: Keccak Implementation (CPU Reference)
 * Uses js-sha3 library for reliable, tested implementation
 * This serves as a reference implementation for GPU shader comparison
 */

import { keccak_256, keccak_512 } from 'js-sha3';

/**
 * Keccak-256 hash function
 * Uses js-sha3's keccak_256 (NOT sha3_256 which is NIST SHA-3)
 * Input: message (Uint8Array)
 * Output: 32-byte hash (Uint8Array)
 */
export function keccak256(message: Uint8Array): Uint8Array {
  // js-sha3's keccak_256 is the Ethereum Keccak-256
  const hash = keccak_256.create();
  hash.update(message);
  const result = hash.hex();

  // Convert hex string to Uint8Array
  const uint8Array = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    uint8Array[i] = parseInt(result.substr(i * 2, 2), 16);
  }
  return uint8Array;
}

/**
 * Keccak-512 hash function
 * Used in Ethash for cache and DAG generation
 * Uses js-sha3's keccak_512 (NOT sha3_512 which is NIST SHA-3)
 * Input: message (Uint8Array)
 * Output: 64-byte hash (Uint8Array)
 */
export function keccak512(message: Uint8Array): Uint8Array {
  // js-sha3's keccak_512 is the Ethereum Keccak-512
  const hash = keccak_512.create();
  hash.update(message);
  const result = hash.hex();

  // Convert hex string to Uint8Array
  const uint8Array = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    uint8Array[i] = parseInt(result.substr(i * 2, 2), 16);
  }
  return uint8Array;
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Known test vectors for Keccak-256 (Ethereum version, not NIST SHA3)
 * These have been verified against js-sha3 and go-ethereum implementations
 */
export const KECCAK_TEST_VECTORS = [
  {
    input: '',
    expected: 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  },
  {
    input: 'abc',
    expected: '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
  },
  {
    input: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    expected: '45d3b367a6904e6e8d502ee04999a7c27647f91fa845d456525fd352ae3d7371',
  },
];

/**
 * Known test vectors for Keccak-512 (verified against js-sha3)
 */
export const KECCAK512_TEST_VECTORS = [
  {
    input: '',
    expected: '0eab42de4c3ceb9235fc91acffe746b29c29a8c366b7c60e4e67c466f36a4304c00fa9caf9d87976ba469bcbe06713b435f091ef2769fb160cdab33d3670680e',
  },
  {
    input: 'abc',
    expected: '18587dc2ea106b9a1563e32b3312421ca164c7f1f07bc922a9c83d77cea3a1e5d0c69910739025372dc14ac9642629379540c17e2a65b19d77aa511a9d00bb96',
  },
];

/**
 * Validate Keccak-256 implementation against test vectors
 */
export function validateKeccak256Implementation(): boolean {
  console.log('Validating Keccak-256 implementation...');

  let allPassed = true;

  for (const vector of KECCAK_TEST_VECTORS) {
    const input = new TextEncoder().encode(vector.input);
    const hash = keccak256(input);
    const hashHex = bytesToHex(hash);

    const passed = hashHex === vector.expected;
    console.log(`  Test "${vector.input}": ${passed ? '✓' : '✗'}`);
    if (!passed) {
      console.log(`    Expected: ${vector.expected}`);
      console.log(`    Got:      ${hashHex}`);
    }

    allPassed = allPassed && passed;
  }

  return allPassed;
}

/**
 * Validate Keccak-512 implementation against test vectors
 */
export function validateKeccak512Implementation(): boolean {
  console.log('Validating Keccak-512 implementation...');

  let allPassed = true;

  for (const vector of KECCAK512_TEST_VECTORS) {
    const input = new TextEncoder().encode(vector.input);
    const hash = keccak512(input);
    const hashHex = bytesToHex(hash);

    const passed = hashHex === vector.expected;
    console.log(`  Test "${vector.input}": ${passed ? '✓' : '✗'}`);
    if (!passed) {
      console.log(`    Expected: ${vector.expected}`);
      console.log(`    Got:      ${hashHex}`);
    }

    allPassed = allPassed && passed;
  }

  return allPassed;
}

/**
 * Validate both Keccak implementations
 */
export function validateKeccakImplementation(): boolean {
  const keccak256Valid = validateKeccak256Implementation();
  const keccak512Valid = validateKeccak512Implementation();
  return keccak256Valid && keccak512Valid;
}
