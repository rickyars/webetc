// Keccak-512 GPU Shader - Direct port of js-sha3
// Works on 50 u32 values (25 u64 lanes as pairs)
// Input: 72 bytes (Keccak-512 rate)
// Output: 64 bytes (512-bit hash)

const RC = array<u32, 48>(
  1u, 0u, 32898u, 0u, 32906u, 2147483648u, 2147516416u, 2147483648u,
  32907u, 0u, 2147483649u, 0u, 2147516545u, 2147483648u, 32777u, 2147483648u,
  138u, 0u, 136u, 0u, 2147516425u, 0u, 2147483658u, 0u,
  2147516555u, 0u, 139u, 2147483648u, 32905u, 2147483648u, 32771u, 2147483648u,
  32770u, 2147483648u, 128u, 2147483648u, 32778u, 0u, 2147483658u, 2147483648u,
  2147516545u, 2147483648u, 32896u, 2147483648u, 2147483649u, 0u, 2147516424u, 2147483648u
);

// Reusable Keccak-512 function for use in other shaders
// Note: Can be called with 16 or 18 u32s. When called with 16, the 2 extra are implicitly 0.
fn keccak512(input: array<u32, 18>) -> array<u32, 16> {
  // Initialize state (50 u32s for 25 u64 lanes)
  var s: array<u32, 50>;
  for (var i = 0u; i < 50u; i = i + 1u) {
    s[i] = 0u;
  }

  // Absorb input: XOR first 18 u32s (9 lanes for Keccak-512, 72-byte rate)
  for (var i = 0u; i < 18u; i = i + 1u) {
    s[i] ^= input[i];
  }

  // Keccak-f permutation (24 rounds, 48 RC values)
  for (var n = 0u; n < 48u; n = n + 2u) {
    // Theta
    var c0 = s[0u] ^ s[10u] ^ s[20u] ^ s[30u] ^ s[40u];
    var c1 = s[1u] ^ s[11u] ^ s[21u] ^ s[31u] ^ s[41u];
    var c2 = s[2u] ^ s[12u] ^ s[22u] ^ s[32u] ^ s[42u];
    var c3 = s[3u] ^ s[13u] ^ s[23u] ^ s[33u] ^ s[43u];
    var c4 = s[4u] ^ s[14u] ^ s[24u] ^ s[34u] ^ s[44u];
    var c5 = s[5u] ^ s[15u] ^ s[25u] ^ s[35u] ^ s[45u];
    var c6 = s[6u] ^ s[16u] ^ s[26u] ^ s[36u] ^ s[46u];
    var c7 = s[7u] ^ s[17u] ^ s[27u] ^ s[37u] ^ s[47u];
    var c8 = s[8u] ^ s[18u] ^ s[28u] ^ s[38u] ^ s[48u];
    var c9 = s[9u] ^ s[19u] ^ s[29u] ^ s[39u] ^ s[49u];

    var h = c8 ^ ((c2 << 1u) | (c3 >> 31u));
    var l = c9 ^ ((c3 << 1u) | (c2 >> 31u));
    s[0u] ^= h;
    s[1u] ^= l;
    s[10u] ^= h;
    s[11u] ^= l;
    s[20u] ^= h;
    s[21u] ^= l;
    s[30u] ^= h;
    s[31u] ^= l;
    s[40u] ^= h;
    s[41u] ^= l;

    h = c0 ^ ((c4 << 1u) | (c5 >> 31u));
    l = c1 ^ ((c5 << 1u) | (c4 >> 31u));
    s[2u] ^= h;
    s[3u] ^= l;
    s[12u] ^= h;
    s[13u] ^= l;
    s[22u] ^= h;
    s[23u] ^= l;
    s[32u] ^= h;
    s[33u] ^= l;
    s[42u] ^= h;
    s[43u] ^= l;

    h = c2 ^ ((c6 << 1u) | (c7 >> 31u));
    l = c3 ^ ((c7 << 1u) | (c6 >> 31u));
    s[4u] ^= h;
    s[5u] ^= l;
    s[14u] ^= h;
    s[15u] ^= l;
    s[24u] ^= h;
    s[25u] ^= l;
    s[34u] ^= h;
    s[35u] ^= l;
    s[44u] ^= h;
    s[45u] ^= l;

    h = c4 ^ ((c8 << 1u) | (c9 >> 31u));
    l = c5 ^ ((c9 << 1u) | (c8 >> 31u));
    s[6u] ^= h;
    s[7u] ^= l;
    s[16u] ^= h;
    s[17u] ^= l;
    s[26u] ^= h;
    s[27u] ^= l;
    s[36u] ^= h;
    s[37u] ^= l;
    s[46u] ^= h;
    s[47u] ^= l;

    h = c6 ^ ((c0 << 1u) | (c1 >> 31u));
    l = c7 ^ ((c1 << 1u) | (c0 >> 31u));
    s[8u] ^= h;
    s[9u] ^= l;
    s[18u] ^= h;
    s[19u] ^= l;
    s[28u] ^= h;
    s[29u] ^= l;
    s[38u] ^= h;
    s[39u] ^= l;
    s[48u] ^= h;
    s[49u] ^= l;

    // Rho and Pi
    var b0 = s[0u];
    var b1 = s[1u];
    var b32 = (s[11u] << 4u) | (s[10u] >> 28u);
    var b33 = (s[10u] << 4u) | (s[11u] >> 28u);
    var b14 = (s[20u] << 3u) | (s[21u] >> 29u);
    var b15 = (s[21u] << 3u) | (s[20u] >> 29u);
    var b46 = (s[31u] << 9u) | (s[30u] >> 23u);
    var b47 = (s[30u] << 9u) | (s[31u] >> 23u);
    var b28 = (s[40u] << 18u) | (s[41u] >> 14u);
    var b29 = (s[41u] << 18u) | (s[40u] >> 14u);
    var b20 = (s[2u] << 1u) | (s[3u] >> 31u);
    var b21 = (s[3u] << 1u) | (s[2u] >> 31u);
    var b2 = (s[13u] << 12u) | (s[12u] >> 20u);
    var b3 = (s[12u] << 12u) | (s[13u] >> 20u);
    var b34 = (s[22u] << 10u) | (s[23u] >> 22u);
    var b35 = (s[23u] << 10u) | (s[22u] >> 22u);
    var b16 = (s[33u] << 13u) | (s[32u] >> 19u);
    var b17 = (s[32u] << 13u) | (s[33u] >> 19u);
    var b48 = (s[42u] << 2u) | (s[43u] >> 30u);
    var b49 = (s[43u] << 2u) | (s[42u] >> 30u);
    var b40 = (s[5u] << 30u) | (s[4u] >> 2u);
    var b41 = (s[4u] << 30u) | (s[5u] >> 2u);
    var b22 = (s[14u] << 6u) | (s[15u] >> 26u);
    var b23 = (s[15u] << 6u) | (s[14u] >> 26u);
    var b4 = (s[25u] << 11u) | (s[24u] >> 21u);
    var b5 = (s[24u] << 11u) | (s[25u] >> 21u);
    var b36 = (s[34u] << 15u) | (s[35u] >> 17u);
    var b37 = (s[35u] << 15u) | (s[34u] >> 17u);
    var b18 = (s[45u] << 29u) | (s[44u] >> 3u);
    var b19 = (s[44u] << 29u) | (s[45u] >> 3u);
    var b10 = (s[6u] << 28u) | (s[7u] >> 4u);
    var b11 = (s[7u] << 28u) | (s[6u] >> 4u);
    var b42 = (s[17u] << 23u) | (s[16u] >> 9u);
    var b43 = (s[16u] << 23u) | (s[17u] >> 9u);
    var b24 = (s[26u] << 25u) | (s[27u] >> 7u);
    var b25 = (s[27u] << 25u) | (s[26u] >> 7u);
    var b6 = (s[36u] << 21u) | (s[37u] >> 11u);
    var b7 = (s[37u] << 21u) | (s[36u] >> 11u);
    var b38 = (s[47u] << 24u) | (s[46u] >> 8u);
    var b39 = (s[46u] << 24u) | (s[47u] >> 8u);
    var b30 = (s[8u] << 27u) | (s[9u] >> 5u);
    var b31 = (s[9u] << 27u) | (s[8u] >> 5u);
    var b12 = (s[18u] << 20u) | (s[19u] >> 12u);
    var b13 = (s[19u] << 20u) | (s[18u] >> 12u);
    var b44 = (s[29u] << 7u) | (s[28u] >> 25u);
    var b45 = (s[28u] << 7u) | (s[29u] >> 25u);
    var b26 = (s[38u] << 8u) | (s[39u] >> 24u);
    var b27 = (s[39u] << 8u) | (s[38u] >> 24u);
    var b8 = (s[48u] << 14u) | (s[49u] >> 18u);
    var b9 = (s[49u] << 14u) | (s[48u] >> 18u);

    // Chi
    s[0u] = b0 ^ (~b2 & b4);
    s[1u] = b1 ^ (~b3 & b5);
    s[10u] = b10 ^ (~b12 & b14);
    s[11u] = b11 ^ (~b13 & b15);
    s[20u] = b20 ^ (~b22 & b24);
    s[21u] = b21 ^ (~b23 & b25);
    s[30u] = b30 ^ (~b32 & b34);
    s[31u] = b31 ^ (~b33 & b35);
    s[40u] = b40 ^ (~b42 & b44);
    s[41u] = b41 ^ (~b43 & b45);
    s[2u] = b2 ^ (~b4 & b6);
    s[3u] = b3 ^ (~b5 & b7);
    s[12u] = b12 ^ (~b14 & b16);
    s[13u] = b13 ^ (~b15 & b17);
    s[22u] = b22 ^ (~b24 & b26);
    s[23u] = b23 ^ (~b25 & b27);
    s[32u] = b32 ^ (~b34 & b36);
    s[33u] = b33 ^ (~b35 & b37);
    s[42u] = b42 ^ (~b44 & b46);
    s[43u] = b43 ^ (~b45 & b47);
    s[4u] = b4 ^ (~b6 & b8);
    s[5u] = b5 ^ (~b7 & b9);
    s[14u] = b14 ^ (~b16 & b18);
    s[15u] = b15 ^ (~b17 & b19);
    s[24u] = b24 ^ (~b26 & b28);
    s[25u] = b25 ^ (~b27 & b29);
    s[34u] = b34 ^ (~b36 & b38);
    s[35u] = b35 ^ (~b37 & b39);
    s[44u] = b44 ^ (~b46 & b48);
    s[45u] = b45 ^ (~b47 & b49);
    s[6u] = b6 ^ (~b8 & b0);
    s[7u] = b7 ^ (~b9 & b1);
    s[16u] = b16 ^ (~b18 & b10);
    s[17u] = b17 ^ (~b19 & b11);
    s[26u] = b26 ^ (~b28 & b20);
    s[27u] = b27 ^ (~b29 & b21);
    s[36u] = b36 ^ (~b38 & b30);
    s[37u] = b37 ^ (~b39 & b31);
    s[46u] = b46 ^ (~b48 & b40);
    s[47u] = b47 ^ (~b49 & b41);
    s[8u] = b8 ^ (~b0 & b2);
    s[9u] = b9 ^ (~b1 & b3);
    s[18u] = b18 ^ (~b10 & b12);
    s[19u] = b19 ^ (~b11 & b13);
    s[28u] = b28 ^ (~b20 & b22);
    s[29u] = b29 ^ (~b21 & b23);
    s[38u] = b38 ^ (~b30 & b32);
    s[39u] = b39 ^ (~b31 & b33);
    s[48u] = b48 ^ (~b40 & b42);
    s[49u] = b49 ^ (~b41 & b43);

    // Iota
    s[0u] ^= RC[n];
    s[1u] ^= RC[n + 1u];
  }

  // Squeeze output (first 16 u32s = 8 lanes = 64 bytes)
  var output: array<u32, 16>;
  for (var i = 0u; i < 16u; i = i + 1u) {
    output[i] = s[i];
  }
  return output;
}

// Shader entry point for batch Keccak-512 hashing
@group(0) @binding(0) var<storage, read> input_data: array<u32>;
@group(0) @binding(1) var<storage, read_write> output_data: array<u32>;

@compute @workgroup_size(1)
fn main() {
  // Read 18 u32s from input buffer (full Keccak-512 rate: 72 bytes)
  var input: array<u32, 18>;
  for (var i = 0u; i < 18u; i = i + 1u) {
    if (i < arrayLength(&input_data)) {
      input[i] = input_data[i];
    }
  }

  // Compute Keccak-512 hash
  let result = keccak512(input);

  // Write 16 u32s to output buffer
  for (var i = 0u; i < 16u; i = i + 1u) {
    if (i < arrayLength(&output_data)) {
      output_data[i] = result[i];
    }
  }
}
