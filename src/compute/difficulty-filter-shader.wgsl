// GPU Difficulty Filter for Ethash
// Filters hashes to find those meeting difficulty requirement
//
// Algorithm:
// For each hash, check if hash_value < 2^256 / difficulty
// In u256 comparison terms: hash_value < max_hash_value
// where max_hash_value = 2^256 / difficulty
//
// Input:
// - hashes: Array of final hashes (32 bytes each = 8 u32s in little-endian)
// - difficulty: Mining difficulty (stored as max_hash threshold = 2^256 / difficulty)
// - nonces: Original nonces corresponding to hashes
//
// Output:
// - valid_nonces: Nonces that passed difficulty filter (winning nonces)
// - valid_count: Number of valid nonces found (via atomic counter)

struct PooledNonce {
  nonce_lo: u32,
  nonce_hi: u32,
};

@group(0) @binding(0) var<storage, read> hashes: array<u32>;              // All hashes (8 u32 per hash)
@group(0) @binding(1) var<storage, read> nonces: array<u32>;              // All nonces (2 u32 per nonce)
@group(0) @binding(2) var<storage, read_write> valid_nonces: array<PooledNonce>; // Output: winning nonces
@group(0) @binding(3) var<storage, read_write> valid_count: atomic<u32>;  // Counter for valid nonces
@group(0) @binding(4) var<storage, read> params: array<u32, 10>;          // [0]=num_hashes, [1]=unused, [2..9]=threshold

// Compare two 256-bit numbers represented as arrays of 8 u32s (little-endian)
// Returns true if a < b
fn u256_less_than(a: array<u32, 8>, b: array<u32, 8>) -> bool {
  // Compare from most significant to least significant
  // In little-endian, u32s are arranged as: [lo, ..., hi]
  // But numerically we need MSB comparison, so compare indices 7 down to 0
  for (var i = 7i; i >= 0; i = i - 1) {
    let idx = u32(i);
    if (a[idx] != b[idx]) {
      return a[idx] < b[idx];
    }
  }
  return false; // Equal (a is not less than b)
}

@compute @workgroup_size(32)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let hash_idx = global_id.x;
  let num_hashes = params[0];

  if (hash_idx >= num_hashes) {
    return;
  }

  // Read hash (8 u32s in little-endian)
  var hash: array<u32, 8>;
  let hash_offset = hash_idx * 8u;
  for (var i = 0u; i < 8u; i = i + 1u) {
    hash[i] = hashes[hash_offset + i];
  }

  // Read the max_hash threshold from params array [2..9]
  var max_hash: array<u32, 8>;
  for (var i = 0u; i < 8u; i = i + 1u) {
    max_hash[i] = params[2u + i];
  }

  // Check if hash < max_hash (meets difficulty threshold)
  let meets_difficulty = u256_less_than(hash, max_hash);

  if (meets_difficulty) {
    // Atomically increment counter to get position
    let pos = atomicAdd(&valid_count, 1u);

    // Store nonce at this position
    let nonce_offset = hash_idx * 2u;
    valid_nonces[pos].nonce_lo = nonces[nonce_offset];
    valid_nonces[pos].nonce_hi = nonces[nonce_offset + 1u];
  }
}
