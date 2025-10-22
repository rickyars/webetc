// FNV Hash Functions - Direct port of @ethereumjs/ethash
// Used by both DAG builder and Hashimoto algorithms

// FNV-1a hash for single 32-bit word
// Ported from @ethereumjs/ethash fnv function:
// ((((x * 0x01000000) | 0) + ((x * 0x193) | 0)) ^ y) >>> 0
// In WGSL: u32 multiplication wraps automatically, so we just compute it directly
fn fnv(x: u32, y: u32) -> u32 {
  let part1 = x * 0x01000000u;
  let part2 = x * 0x193u;
  return ((part1 + part2) ^ y);
}

// FNV-1a hash for mixing 16 u32 words (64 bytes)
fn fnv_bytes_mix(a: array<u32, 16>, b: array<u32, 16>) -> array<u32, 16> {
  var result: array<u32, 16>;
  for (var i = 0u; i < 16u; i = i + 1u) {
    result[i] = fnv(a[i], b[i]);
  }
  return result;
}

// FNV-1a hash for mixing 32 u32 words (128 bytes)
fn fnv_bytes_mix_32(a: array<u32, 32>, b: array<u32, 32>) -> array<u32, 32> {
  var result: array<u32, 32>;
  for (var i = 0u; i < 32u; i = i + 1u) {
    result[i] = fnv(a[i], b[i]);
  }
  return result;
}
