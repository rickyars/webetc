// DAG Builder Shader - Direct port of @ethereumjs/ethash calcDatasetItem
//
// Algorithm for each DAG item i:
// 1. mix = cache[i % cache.length]
// 2. mix[0] ^= i
// 3. mix = keccak512(mix)
// 4. for j = 0 to 255:
//      cacheIndex = fnv(i ^ j, mix[j % 16])
//      mix = fnv_bytes(mix, cache[cacheIndex % cache.length])
// 5. result = keccak512(mix)

// NOTE: Keccak-512 function is injected at runtime from keccak-512-shader.wgsl
// The function signature is: fn keccak512(input: array<u32, 18>) -> array<u32, 16>
// It correctly absorbs 18 u32s (72-byte rate = full Keccak-512 rate)

// NOTE: FNV functions are injected at runtime from fnv-shader.wgsl
// Available functions:
// - fn fnv(x: u32, y: u32) -> u32
// - fn fnv_bytes_mix(a: array<u32, 16>, b: array<u32, 16>) -> array<u32, 16>

// ============ DAG Builder Shader ============
@group(0) @binding(0) var<storage, read> cache: array<u32>;        // Cache: 16 u32s per item
@group(0) @binding(1) var<storage, read_write> dag: array<u32>;    // DAG output: 16 u32s per item
@group(0) @binding(2) var<uniform> params: vec4<u32>;              // x=num_cache_items, y=num_dag_items, z=workgroupsX, w=items_per_workgroup

@compute @workgroup_size(32)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>,
        @builtin(workgroup_id) workgroup_id: vec3<u32>,
        @builtin(local_invocation_index) local_idx: u32) {
  // Compute flat DAG item index from 3D invocation ID
  // Dispatch is (workgroupsX, workgroupsY, 1) with workgroup_size=32
  // Each workgroup has 32 invocations
  // Item index = (workgroup_id.y * workgroupsX * 32) + (workgroup_id.x * 32) + local_idx

  let num_cache_items = params.x;
  let num_dag_items = params.y;
  let workgroups_x = params.z;
  let items_per_workgroup = params.w;

  let dag_item_idx = (workgroup_id.y * workgroups_x * items_per_workgroup) + (workgroup_id.x * items_per_workgroup) + local_idx;

  if (dag_item_idx >= num_dag_items) {
    return;
  }

  // Step 1: mix = cache[dag_item_idx % num_cache_items]
  let cache_idx = dag_item_idx % num_cache_items;
  var mix: array<u32, 16>;
  for (var i = 0u; i < 16u; i = i + 1u) {
    mix[i] = cache[cache_idx * 16u + i];
  }

  // Step 2: mix[0] ^= dag_item_idx
  mix[0] = mix[0] ^ dag_item_idx;

  // Step 3: mix = keccak512(mix)
  // Prepare 18 u32 input with correct Keccak-512 padding
  // For 64-byte (16 u32) input into 72-byte (18 u32) rate:
  // Byte 64: 0x01 (Keccak suffix) -> u32[16] = 0x00000001 (little-endian)
  // Byte 71: 0x80 (end marker)    -> u32[17] = 0x80000000 (little-endian)
  var mix_padded: array<u32, 18>;
  for (var i = 0u; i < 16u; i = i + 1u) {
    mix_padded[i] = mix[i];
  }
  mix_padded[16u] = 0x00000001u;  // Keccak suffix byte at position 64
  mix_padded[17u] = 0x80000000u;  // End marker byte at position 71
  mix = keccak512(mix_padded);

  // Step 4: FNV mixing with 256 cache parents
  for (var j = 0u; j < 256u; j = j + 1u) {
    let cache_index_value = fnv(dag_item_idx ^ j, mix[j % 16u]);
    let parent_cache_idx = cache_index_value % num_cache_items;

    var parent: array<u32, 16>;
    for (var i = 0u; i < 16u; i = i + 1u) {
      parent[i] = cache[parent_cache_idx * 16u + i];
    }

    mix = fnv_bytes_mix(mix, parent);
  }

  // Step 5: Final keccak512(mix)
  // Prepare 18 u32 input with correct Keccak-512 padding
  var mix_padded_final: array<u32, 18>;
  for (var i = 0u; i < 16u; i = i + 1u) {
    mix_padded_final[i] = mix[i];
  }
  mix_padded_final[16u] = 0x00000001u;  // Keccak suffix byte at position 64
  mix_padded_final[17u] = 0x80000000u;  // End marker byte at position 71
  let result = keccak512(mix_padded_final);

  // Write to DAG
  for (var i = 0u; i < 16u; i = i + 1u) {
    dag[dag_item_idx * 16u + i] = result[i];
  }
}
