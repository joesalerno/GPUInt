@group(0) @binding(0) var<storage, read> limbsA: array<u32>;
@group(0) @binding(1) var<storage, read> limbsB: array<u32>;
@group(0) @binding(2) var<storage, write> sum_limbs_raw: array<u32>;
@group(0) @binding(3) var<storage, write> carry_limbs_raw: array<u32>;

@compute @workgroup_size(64) // Example workgroup size
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;

    // Bounds protection for output buffers.
    // It's crucial that the dispatch size is appropriate for sum_limbs_raw and carry_limbs_raw.
    // The input buffers (limbsA, limbsB) can be shorter, and we handle that by providing 0u.
    if (idx >= arrayLength(&sum_limbs_raw)) { // Also implies idx >= arrayLength(&carry_limbs_raw)
        return;
    }

    var valA: u32 = 0u;
    if (idx < arrayLength(&limbsA)) {
        valA = limbsA[idx];
    }
    var valB: u32 = 0u;
    if (idx < arrayLength(&limbsB)) {
        valB = limbsB[idx];
    }

    let sum64 = u64(valA) + u64(valB);
    sum_limbs_raw[idx] = u32(sum64 & 0xFFFFFFFFu); // Lower 32 bits
    carry_limbs_raw[idx] = u32(sum64 >> 32u);    // Upper 32 bits (carry)
}
