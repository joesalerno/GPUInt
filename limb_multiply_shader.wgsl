struct Params {
    num_limbs_A: u32,
    num_limbs_B: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> limbsA: array<u32>;
@group(0) @binding(2) var<storage, read> limbsB: array<u32>;
@group(0) @binding(3) var<storage, write> partial_products_low: array<u32>;
@group(0) @binding(4) var<storage, write> partial_products_high: array<u32>;

@compute @workgroup_size(64) // Example workgroup size
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let flat_idx = global_id.x; // Renamed for clarity

    let n_a = params.num_limbs_A;
    let n_b = params.num_limbs_B;

    // Check if the index is out of bounds for the output arrays.
    // The output arrays have size n_a * n_b.
    if (flat_idx >= n_a * n_b) {
        return;
    }

    // Avoid division by zero if n_b is 0. This also implies n_a * n_b would be 0,
    // so the above check would catch it. However, explicit check is safer.
    if (n_b == 0u || n_a == 0u) {
        return;
    }

    // Calculate 2D indices (i for limbsA, j for limbsB)
    let i = flat_idx / n_b; // Index for limbsA
    let j = flat_idx % n_b; // Index for limbsB

    // These checks should ideally not be needed if the dispatch size is exactly n_a * n_b
    // and flat_idx < n_a * n_b is already verified.
    // if (i >= n_a || j >= n_b) {
    //     return;
    // }
    // The read from limbsA[i] and limbsB[j] is safe due to the flat_idx check
    // and correct calculation of i and j.

    let valA = limbsA[i];
    let valB = limbsB[j];

    let product64 = u64(valA) * u64(valB);
    partial_products_low[flat_idx] = u32(product64 & 0xFFFFFFFFu);
    partial_products_high[flat_idx] = u32(product64 >> 32u);
}
