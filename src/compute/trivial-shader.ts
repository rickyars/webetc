/**
 * Step 2: Hello Compute Shader
 * Basic compute shader for buffer IO validation
 */

export const TRIVIAL_SHADER_CODE = `
  @group(0) @binding(0)
  var<storage, read_write> output: array<u32>;

  @compute @workgroup_size(256)
  fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;
    if (idx < arrayLength(&output)) {
      // Write predetermined values for testing
      output[idx] = idx * 42u + 1234u;
    }
  }
`;

/**
 * Simple buffer test shader - writes constants
 */
export const BUFFER_TEST_SHADER = `
  @group(0) @binding(0)
  var<storage, read_write> data: array<u32>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;
    if (idx < arrayLength(&data)) {
      // Test pattern: 0xDEADBEEF, 0xCAFEBABE, 0x12345678...
      let patterns = array(0xDEADBEEFu, 0xCAFEBABEu, 0x12345678u, 0x9ABCDEF0u);
      data[idx] = patterns[idx % 4u];
    }
  }
`;
