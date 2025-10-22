// GPU Hashimoto Implementation - CLEAN PORT (NONCE REVERSAL FIX v2 - TIMESTAMP: 2025-10-22-16:17)
// Direct line-by-line port of @ethereumjs/ethash Ethash.run()
//
// CPU Algorithm (from ethereumjs/ethash src/index.ts:211-254):
// 1. n = fullSize / 64
// 2. w = 32 (128 / 4)
// 3. s = keccak512(val || bytesReverse(nonce))
// 4. mix = [s, s] (s repeated 2x = 128 bytes)
// 5. For i = 0 to ACCESSES-1:
//    a. p = (fnv(i ^ s[0], mix[i%32]) % (n/2)) * 2
//    b. Load DAG items at indices p and p+1
//    c. mix = fnvBytes(mix, items)
// 6. cmix = fold(mix) via FNV (32 bytes)
// 7. hash = keccak256(s || cmix)

const ACCESSES = 64u;
const MIX_BYTES = 128u;
const HASH_BYTES = 64u;
const MIX_WORDS = 32u;  // MIX_BYTES / 4

@group(0) @binding(0) var<storage, read> header_hash: array<u32, 8>;
@group(0) @binding(1) var<storage, read> nonces: array<u32>;
@group(0) @binding(3) var<storage, read> dag: array<u32>;
@group(0) @binding(4) var<storage, read_write> hashes: array<u32>;
@group(0) @binding(5) var<uniform> params: vec4<u32>;  // x=num_nonces, y=n (dag_items), z=unused, w=unused

// Injected functions (from fnv-shader.wgsl and keccak-*.wgsl)
// fn fnv(x: u32, y: u32) -> u32
// fn keccak512(input: array<u32, 18>) -> array<u32, 16>
// fn keccak256(input: array<u32, 34>) -> array<u32, 8>

@compute @workgroup_size(32)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let nonce_idx = global_id.x;
  let num_nonces = params.x;

  if (nonce_idx >= num_nonces) {
    return;
  }

  // ===== LOAD INPUTS =====

  // Load header hash (32 bytes = 8 u32)
  var header: array<u32, 8>;
  for (var i = 0u; i < 8u; i = i + 1u) {
    header[i] = header_hash[i];
  }

  // Load nonce (8 bytes = 2 u32), must be reversed
  let nonce_offset = nonce_idx * 2u;
  let nonce_lo = nonces[nonce_offset];
  let nonce_hi = nonces[nonce_offset + 1u];

  // Reverse nonce: bytesReverse flips entire 8-byte array
  // The ethereumjs algorithm does: bytesReverse(nonce)
  // For an 8-byte nonce [byte0, byte1, ..., byte7], this produces [byte7, byte6, ..., byte0]
  //
  // When we have nonce as two u32 LE values (nonce_lo, nonce_hi):
  //   nonce_lo = byte0|byte1|byte2|byte3
  //   nonce_hi = byte4|byte5|byte6|byte7
  //
  // After bytesReverse, the 8-byte array becomes [byte7, byte6, ..., byte0]
  // When interpreted as two u32 LE values:
  //   u32[0] = byte7|byte6|byte5|byte4 = bytesReverse(nonce_hi)
  //   u32[1] = byte3|byte2|byte1|byte0 = bytesReverse(nonce_lo)
  //
  // So we need to: (1) byte-reverse each u32, (2) swap their order

  let nonce_lo_reversed = ((nonce_lo & 0x000000FFu) << 24u) | ((nonce_lo & 0x0000FF00u) << 8u) |
                          ((nonce_lo & 0x00FF0000u) >> 8u) | ((nonce_lo & 0xFF000000u) >> 24u);
  let nonce_hi_reversed = ((nonce_hi & 0x000000FFu) << 24u) | ((nonce_hi & 0x0000FF00u) << 8u) |
                          ((nonce_hi & 0x00FF0000u) >> 8u) | ((nonce_hi & 0xFF000000u) >> 24u);

  // ===== STAGE 1: keccak512(header || reversed_nonce) =====

  var keccak_input: array<u32, 18> = array<u32, 18>();

  // First 32 bytes: header
  for (var i = 0u; i < 8u; i = i + 1u) {
    keccak_input[i] = header[i];
  }

  // Next 8 bytes: reversed nonce (byte-reversed and swapped)
  keccak_input[8u] = nonce_hi_reversed;  // SWAPPED: hi goes first after reversal
  keccak_input[9u] = nonce_lo_reversed;  // SWAPPED: lo goes second after reversal

  // Padding for Keccak-512 (72-byte rate = 18 u32)
  // Byte 40 (u32[10] byte 0): 0x01
  // Byte 71 (u32[17] byte 3): 0x80
  keccak_input[10u] = 0x00000001u;
  for (var i = 11u; i < 17u; i = i + 1u) {
    keccak_input[i] = 0x00000000u;
  }
  keccak_input[17u] = 0x80000000u;

  let s = keccak512(keccak_input);

  // ===== STAGE 2: Initialize mix = s repeated 2x =====

  var mix: array<u32, 32> = array<u32, 32>();
  for (var i = 0u; i < 16u; i = i + 1u) {
    mix[i] = s[i];
    mix[i + 16u] = s[i];
  }

  // ===== STAGE 3: FNV mixing loop =====

  let n = params.y;  // Number of DAG items
  let s0 = s[0u];    // First u32 of s, used as seed
  let w = 32u;       // MIX_BYTES / WORD_BYTES

  for (var i = 0u; i < ACCESSES; i = i + 1u) {
    // p = (fnv(i ^ s[0], mix[i % w]) % (n / 2)) * 2
    let mix_word = mix[i % w];
    let fnv_result = fnv(i ^ s0, mix_word);
    let p = (fnv_result % (n / 2u)) * 2u;

    // Load 2 DAG items and FNV with mix
    // IMPORTANT: Load all DAG values FIRST, then FNV all, to avoid read-after-write hazards
    let dag_offset_0 = p * 16u;
    let dag_offset_1 = dag_offset_0 + 16u;

    var dag_item_0: array<u32, 16>;
    var dag_item_1: array<u32, 16>;

    for (var j = 0u; j < 16u; j = j + 1u) {
      dag_item_0[j] = dag[dag_offset_0 + j];
      dag_item_1[j] = dag[dag_offset_1 + j];
    }

    for (var j = 0u; j < 16u; j = j + 1u) {
      mix[j] = fnv(mix[j], dag_item_0[j]);
      mix[j + 16u] = fnv(mix[j + 16u], dag_item_1[j]);
    }
  }

  // ===== STAGE 4: Compress mix via FNV folding =====
  // cmix = fold(mix) where fold does:
  // for i in [0, 4, 8, 12, 16, 20, 24, 28]:
  //   cmix[i/4] = fnv(fnv(fnv(mix[i], mix[i+1]), mix[i+2]), mix[i+3])

  var cmix: array<u32, 8> = array<u32, 8>();

  for (var i = 0u; i < 8u; i = i + 1u) {
    let base = i * 4u;
    let a = fnv(mix[base], mix[base + 1u]);
    let b = fnv(a, mix[base + 2u]);
    let c = fnv(b, mix[base + 3u]);
    cmix[i] = c;
  }

  // ===== STAGE 5: Final Keccak-256 =====
  // hash = keccak256(s || cmix)
  // s = 64 bytes (16 u32), cmix = 32 bytes (8 u32), total = 96 bytes
  // Keccak-256 rate = 136 bytes (34 u32)

  var final_input: array<u32, 34> = array<u32, 34>();

  // First 16 u32 = s
  for (var i = 0u; i < 16u; i = i + 1u) {
    final_input[i] = s[i];
  }

  // Next 8 u32 = cmix
  for (var i = 0u; i < 8u; i = i + 1u) {
    final_input[16u + i] = cmix[i];
  }

  // Padding for Keccak-256
  // Byte 96 (u32[24] byte 0): 0x01
  // Byte 135 (u32[33] byte 3): 0x80
  final_input[24u] = 0x00000001u;
  for (var i = 25u; i < 33u; i = i + 1u) {
    final_input[i] = 0x00000000u;
  }
  final_input[33u] = 0x80000000u;

  let hash = keccak256(final_input);

  // ===== OUTPUT =====

  let output_offset = nonce_idx * 8u;
  for (var i = 0u; i < 8u; i = i + 1u) {
    hashes[output_offset + i] = hash[i];
  }
}
