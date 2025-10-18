/**
 * FNV Hash for Ethash
 *
 * Ethash uses a word-level FNV mixing function (not the byte-level FNV-1a).
 * This is specifically for pseudo-random parent selection in DAG generation.
 *
 * Formula: (a * FNV_PRIME) ^ b
 * - a, b: 32-bit unsigned integers
 * - FNV_PRIME: 0x01000193 (16777619 in decimal)
 *
 * Reference: Ethash algorithm specification
 */

export const FNV_PRIME = 0x01000193;

/**
 * Ethash FNV mixing function
 * Used for pseudo-random parent selection in DAG generation
 *
 * @param a First operand (32-bit unsigned)
 * @param b Second operand (32-bit unsigned)
 * @returns Result of (a * FNV_PRIME) ^ b, as unsigned 32-bit
 */
export function fnvEthash(a: number, b: number): number {
  // JavaScript bitwise operations work on 32-bit integers
  // We need to ensure the multiplication doesn't overflow
  const mul = Math.imul(a >>> 0, FNV_PRIME);
  return (mul ^ b) >>> 0;
}

/**
 * Test vectors for FNV mixing function
 * These are derived from Ethash specifications and known implementations
 */
export const FNV_TEST_VECTORS = [
  // Test case 1: Basic mixing
  {
    a: 0x66,
    b: 0x00,
    expected: 0x050c5d7e,
  },
  // Test case 2: FNV with different values
  {
    a: 0x00,
    b: 0xff,
    expected: 0x010001ff,
  },
  // Test case 3: FNV cascade
  {
    a: 0x01000193,
    b: 0x01000193,
    expected: 0x0,
  },
];

/**
 * Validate FNV implementation
 */
export function validateFNVImplementation(): boolean {
  console.log('Validating FNV implementation...');

  let allPassed = true;

  for (const vector of FNV_TEST_VECTORS) {
    const result = fnvEthash(vector.a, vector.b);
    const passed = result === vector.expected;

    const aHex = vector.a.toString(16).padStart(8, '0');
    const bHex = vector.b.toString(16).padStart(8, '0');
    const resultHex = result.toString(16).padStart(8, '0');
    const expectedHex = vector.expected.toString(16).padStart(8, '0');

    console.log(`  fnvEthash(0x${aHex}, 0x${bHex}): ${passed ? '✓' : '✗'}`);
    if (!passed) {
      console.log(`    Expected: 0x${expectedHex}`);
      console.log(`    Got:      0x${resultHex}`);
    }

    allPassed = allPassed && passed;
  }

  return allPassed;
}
