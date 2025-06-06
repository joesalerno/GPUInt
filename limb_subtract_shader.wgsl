@group(0) @binding(0) var<storage, read> limbsA: array<u32>;
@group(0) @binding(1) var<storage, read> limbsB: array<u32>;
@group(0) @binding(2) var<storage, write> diff_limbs_raw: array<u32>;
@group(0) @binding(3) var<storage, write> borrow_out_limbs: array<u32>; // Renamed for clarity

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;

    // Bounds protection for output buffers.
    if (idx >= arrayLength(&diff_limbs_raw)) { // Also implies idx >= arrayLength(&borrow_out_limbs)
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

    // This computes (valA - valB) mod 2^32. If valA < valB, this will underflow correctly within u32.
    diff_limbs_raw[idx] = valA - valB;

    // borrow_out_limbs[idx] is 1u if valA < valB (a borrow is needed for this current limb operation to be arithmetically correct if no borrow_in),
    // else 0u. This shader does not consider borrow_in. The CPU will handle that.
    borrow_out_limbs[idx] = select(0u, 1u, valA < valB);
}
