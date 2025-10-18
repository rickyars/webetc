// Keccak-256 GPU Shader (WGSL)
// Step 3: GPU implementation of Keccak permutation

// Keccak round constants
const RC: array<u64, 24> = array(
  0x0000000000000001u, 0x0000000000008082u, 0x800000000000808au,
  0x8000000080008000u, 0x000000008000808bu, 0x0000000080000001u,
  0x8000000080008081u, 0x8000000000008080u, 0x0000000000000080u,
  0x000000008000000au, 0x000000008000000au, 0x0000000000008082u,
  0x0000000080000000u, 0x8000000080008085u, 0x000000008000008bu,
  0x000000000000008bu, 0x0000000000008089u, 0x0000000080008002u,
  0x0000000080000001u, 0x000000008000008bu, 0x8000000000008000u,
  0x8000000080008081u, 0x8000000000008080u, 0x0000000000000001u
);

// Keccak rotation offsets
const ROT: array<array<u32, 5>, 5> = array(
  array(0u, 36u, 3u, 41u, 18u),
  array(1u, 44u, 10u, 45u, 2u),
  array(62u, 6u, 43u, 15u, 61u),
  array(28u, 55u, 25u, 21u, 56u),
  array(27u, 20u, 39u, 8u, 14u)
);

// 64-bit rotate left
fn rotl64(value: u64, shift: u32) -> u64 {
  return (value << shift) | (value >> (64u - shift));
}

// Keccak-f permutation
fn keccak_f(state: ptr<function, array<u64, 25>>) {
  var C: array<u64, 5>;
  var D: array<u64, 5>;
  var B: array<u64, 25>;

  for (var round = 0u; round < 24u; round++) {
    // Theta
    for (var x = 0u; x < 5u; x++) {
      C[x] = (*state)[x] ^ (*state)[5u + x] ^ (*state)[10u + x] ^ (*state)[15u + x] ^ (*state)[20u + x];
    }

    for (var x = 0u; x < 5u; x++) {
      D[x] = C[(x - 1u + 5u) % 5u] ^ rotl64(C[(x + 1u) % 5u], 1u);
    }

    for (var x = 0u; x < 5u; x++) {
      for (var y = 0u; y < 5u; y++) {
        (*state)[5u * y + x] ^= D[x];
      }
    }

    // Rho and Pi
    for (var x = 0u; x < 5u; x++) {
      for (var y = 0u; y < 5u; y++) {
        let idx = 5u * y + x;
        B[5u * x + ((y + x) % 5u)] = rotl64((*state)[idx], ROT[x][y]);
      }
    }

    // Chi
    for (var x = 0u; x < 5u; x++) {
      for (var y = 0u; y < 5u; y++) {
        let idx = 5u * y + x;
        (*state)[idx] = B[idx] ^ (~B[5u * ((x + 1u) % 5u) + y] & B[5u * ((x + 2u) % 5u) + y]);
      }
    }

    // Iota
    (*state)[0] ^= RC[round];
  }
}

// Main compute shader for Keccak hashing
@group(0) @binding(0)
var<storage, read_write> input_data: array<u8>;

@group(0) @binding(1)
var<storage, read_write> output_hashes: array<u8>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  let max_idx = arrayLength(&input_data) / 136u; // 136 bytes per Keccak-256 input block

  if (idx >= max_idx) {
    return;
  }

  // Initialize state
  var state: array<u64, 25>;
  for (var i = 0u; i < 25u; i++) {
    state[i] = 0u;
  }

  // Absorb input block (136 bytes = 17 u64 lanes for Keccak-256)
  let input_offset = idx * 136u;
  for (var i = 0u; i < 17u; i++) {
    var lane = 0u64;
    for (var j = 0u; j < 8u; j++) {
      let byte_idx = input_offset + i * 8u + j;
      lane |= u64(input_data[byte_idx]) << (j * 8u);
    }
    state[i] ^= lane;
  }

  // Apply padding for single block (already pre-padded in input)
  // Apply Keccak permutation
  keccak_f(&state);

  // Squeeze output (32 bytes = 4 u64 lanes for Keccak-256)
  let output_offset = idx * 32u;
  for (var i = 0u; i < 4u; i++) {
    let lane = state[i];
    for (var j = 0u; j < 8u; j++) {
      output_hashes[output_offset + i * 8u + j] = u8((lane >> (j * 8u)) & 0xffu);
    }
  }
}
