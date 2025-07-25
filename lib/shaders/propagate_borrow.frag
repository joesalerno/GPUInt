// lib/shaders/propagate_borrow.frag
precision highp float;

uniform sampler2D u_inputTexture; // Texture with (limb, borrow) from previous pass
uniform float u_texWidth;
uniform float u_stride; // The distance to the neighbor (1, 2, 4, ...)

varying vec2 v_texCoord;

const float BASE = 10000.0;

void main() {
    float currentLimbIndex = floor(v_texCoord.x * u_texWidth);

    // Texel coordinate for the current limb
    vec2 currentTexCoord = vec2((currentLimbIndex + 0.5) / u_texWidth, 0.5);

    // Read my own limb and borrow
    vec4 myData = texture2D(u_inputTexture, currentTexCoord);
    float myLimb = myData.r;
    float myBorrow = myData.g;

    // Calculate the index of the neighbor limb to get the borrow from
    float neighborLimbIndex = currentLimbIndex - u_stride;

    float neighborBorrow = 0.0;
    if (neighborLimbIndex >= 0.0) {
        // Texel coordinate for the neighbor limb
        vec2 neighborTexCoord = vec2((neighborLimbIndex + 0.5) / u_texWidth, 0.5);
        // We only care about the borrow from the neighbor, which is in the .g channel
        neighborBorrow = texture2D(u_inputTexture, neighborTexCoord).g;
    }

    // The total borrow to be subtracted from the current limb is the neighbor's borrow.
    // The shader's job is to propagate, not to re-calculate the initial subtraction.
    // The initial subtraction already happened.
    // This logic is for the *second* stage of a two-stage process.
    // Let's rethink the shader logic.

    // The input to this shader is the output of the *initial* subtraction pass.
    // myLimb is `minuendLimb - subtrahendLimb` (potentially with +BASE)
    // myBorrow is the borrow generated *at this position*.

    // Let's trace the data flow for a parallel scan (prefix sum).
    // Pass 1 (stride 1):
    //   Limb[i] gets borrow from Limb[i-1].
    //   The borrow at Limb[i-1] is the one it generated itself.
    // Pass 2 (stride 2):
    //   Limb[i] gets borrow from Limb[i-2].
    //   The borrow at Limb[i-2] is now the sum of its own borrow and the borrow from Limb[i-3].
    // This seems correct.

    // Let's refine the shader logic.
    // The value at each position should be (limb, total_borrow_from_all_previous_limbs).
    // The shader should compute:
    //   out.limb = in.limb - neighbor.borrow
    //   out.borrow = in.borrow + neighbor.borrow

    vec4 neighborData = vec4(0.0);
    if (neighborLimbIndex >= 0.0) {
        vec2 neighborTexCoord = vec2((neighborLimbIndex + 0.5) / u_texWidth, 0.5);
        neighborData = texture2D(u_inputTexture, neighborTexCoord);
    }

    float propagatedBorrow = neighborData.g; // The total borrow from the neighbor at distance `stride`

    // Apply the propagated borrow to my current limb value
    float finalLimb = myLimb - propagatedBorrow;
    float newBorrowFromThisStep = 0.0;
    if (finalLimb < 0.0) {
        finalLimb += BASE;
        newBorrowFromThisStep = 1.0;
    }

    // The new total borrow at this position is my original borrow plus the propagated one.
    float totalBorrow = myBorrow + propagatedBorrow;

    // This seems wrong. The borrow should be combined.
    // Let's re-read a parallel prefix scan algorithm.
    // The standard algorithm has two phases: up-sweep (reduce) and down-sweep.
    // This can be done with one shader that does both depending on the pass.

    // Let's try a simpler, more intuitive approach for now.
    // The goal is to get the total borrow from all previous limbs at each position.
    // At each step `i` (stride `2^i`), we add the borrow from `2^i` positions away.

    // Let's rewrite the shader from scratch with this idea.
    // The texture stores `(original_diff, original_borrow)`.
    // No, the texture should store `(current_limb_value, accumulated_borrow)`.

    // Let's trace:
    // Initial state (output of subtraction.frag): `(diff, borrow_generated_here)`
    // Pass 1 (stride=1):
    //   input: `(diff, borrow_0)`
    //   neighbor at i-1 has `(diff_i-1, borrow_0_i-1)`
    //   output at i should be:
    //     `limb = diff_i - borrow_0_i-1`
    //     `borrow = borrow_0_i + borrow_0_i-1`
    // This seems correct. The `limb` is adjusted, and the `borrow` is accumulated.

    // Let's write the shader for this logic.
    // It reads from one texture and writes to another (ping-pong).

    // Re-reading my proposed shader... it's almost there.
    // `myLimb` is the result of the previous pass.
    // `myBorrow` is the accumulated borrow up to this point from previous passes.

    // Let's dry run:
    // Limbs: A, B, C, D
    // Initial sub: (dA,bA), (dB,bB), (dC,bC), (dD,bD)
    // Pass 1 (stride 1):
    //   Input for C is (dC, bC). Neighbor is B.
    //   neighborData = (dB, bB)
    //   propagatedBorrow = bB
    //   finalLimb = dC - bB. (Correct)
    //   totalBorrow = bC + bB. (Correct)
    //   Output for C is (dC-bB, bC+bB)
    // Pass 2 (stride 2):
    //   Input for C is (dC-bB, bC+bB). Neighbor is A.
    //   neighborData = (dA-b_nothing, bA+b_nothing) = (dA, bA)
    //   propagatedBorrow = bA
    //   finalLimb = (dC-bB) - bA. (Correct)
    //   totalBorrow = (bC+bB) + bA. (Correct)
    //   Output for C is (dC-bB-bA, bA+bB+bC)

    // The logic seems correct. The `limb` part is the final limb value after all borrows are applied.
    // The `borrow` part is the total accumulated borrow from this point backwards.
    // After the last pass, the `r` channel will have the final limb values.

    // The shader I wrote before was slightly off. Let's fix it.
    vec4 neighbor_data = vec4(0.0);
    if (currentLimbIndex >= u_stride) {
        vec2 neighbor_tex_coord = vec2((currentLimbIndex - u_stride + 0.5) / u_texWidth, 0.5);
        neighbor_data = texture2D(u_inputTexture, neighbor_tex_coord);
    }

    // The new accumulated borrow at this position is the sum of my own
    // accumulated borrow and my neighbor's.
    float new_accumulated_borrow = myData.g + neighbor_data.g;

    // The new limb value is my original limb value, but with the
    // neighbor's accumulated borrow subtracted from it.
    // This is wrong. The limb value was already updated in the previous pass.
    // I should just use myData.r as is.

    // Let's try again.
    // At each step, we are combining two elements.
    // `a = (limb_a, borrow_a)`, `b = (limb_b, borrow_b)`
    // `combine(a, b) = (limb_a - borrow_b, borrow_a + borrow_b)`
    // This is the core operation of the parallel scan.

    // So, if `myData` is `a` and `neighbor_data` is `b`:
    float combined_limb = myData.r - neighbor_data.g;
    float combined_borrow = myData.g + neighbor_data.g;

    // We need to handle the underflow from the subtraction.
    if (combined_limb < 0.0) {
        combined_limb += BASE;
        combined_borrow += 1.0; // This seems wrong. The borrow should be propagated, not created here.
    }
    // The borrow should only be generated in the first pass.
    // The subsequent passes just propagate it.

    // Let's look at the subtraction shader again. It produces (resultLimb, borrowOut).
    // `resultLimb` is `diff + BASE` if `diff < 0`.
    // This means the limb value is already adjusted locally.

    // Let's redefine the state in the texture:
    // `r`: The limb's value, assuming all previous borrows have been applied.
    // `g`: The total borrow generated by this limb and all previous limbs.

    // Initial state (from subtraction.frag):
    // `r`: `limb1 - limb2` (adjusted with `+BASE` if negative).
    // `g`: `1.0` if a borrow was generated here, `0.0` otherwise.

    // `propagate_borrow.frag` logic:
    // `myData` is from `currentLimbIndex`.
    // `neighborData` is from `currentLimbIndex - u_stride`.
    // `myLimb` = `myData.r`
    // `myAccumulatedBorrow` = `myData.g`
    // `neighborAccumulatedBorrow` = `neighborData.g`

    // The new limb value needs to be adjusted by the borrow from the neighbor.
    float newLimb = myLimb - neighborAccumulatedBorrow;
    float newBorrowGenerated = 0.0;
    if (newLimb < 0.0) {
        newLimb += BASE;
        newBorrowGenerated = 1.0;
    }

    // The new total accumulated borrow is the sum of all previous borrows.
    float newAccumulatedBorrow = myAccumulatedBorrow + neighborAccumulatedBorrow;

    // This seems wrong. The `newBorrowGenerated` is not right.
    // The borrow was already accounted for in the limb value.

    // Let's simplify the state.
    // `r`: final limb value
    // `g`: borrow to be passed to the next block

    // Let's try this shader. It's a standard prefix scan operator.
    // `x[i] = x[i] + x[i - stride]`
    // Here, the operation is not simple addition.
    // Let `(l, b)` be a tuple of (limb, borrow).
    // `(l1, b1) op (l2, b2) = (l1 - b2, b1 + b2)`
    // This is not associative. `(a op b) op c != a op (b op c)`.
    // `((l1,b1) op (l2,b2)) op (l3,b3) = (l1-b2, b1+b2) op (l3,b3) = ((l1-b2)-b3, (b1+b2)+b3)`
    // `(l1,b1) op ((l2,b2) op (l3,b3)) = (l1,b1) op (l2-b3, b2+b3) = (l1-(b2+b3), b1+(b2+b3))`
    // The limb part is different. `l1-b2-b3` vs `l1-b2-b3`. Oh, it is associative.
    // So I can use a parallel prefix scan.

    // The shader logic for `(l_out, b_out) = (l_i, b_i) op (l_neighbor, b_neighbor)`
    float neighbor_limb = neighbor_data.r;
    float neighbor_borrow = neighbor_data.g;

    float my_limb = myData.r;
    float my_borrow = myData.g;

    // The combination rule:
    float out_limb = my_limb - neighbor_borrow; // This is wrong. The limb value should not be part of the scan.
    // The scan should only be on the borrows.

    // **New, simpler plan:**
    // 1. **Pass 1: `subtraction.frag`**
    //    - Output: `(diff, borrow)`. `diff` is the simple `limb1-limb2`. `borrow` is 0 or 1.
    // 2. **Pass 2: `propagate_borrow.frag` (scan on borrows)**
    //    - This shader only reads and writes the `g` channel (and keeps `r` the same).
    //    - It does a parallel prefix sum on the `borrow` values.
    //    - Loop `log(N)` times.
    //    - At the end of this, the `g` channel of the texture will contain the total borrow from all previous limbs.
    // 3. **Pass 3: `apply_borrow.frag`**
    //    - Input: The texture from Pass 2, which has `(diff, total_borrow)`.
    //    - It calculates `final_limb = diff - total_borrow`.
    //    - It handles underflow (`+BASE`).
    //    - Output: A texture with the final limb values in the `r` channel.

    // This is a 3-stage process, but it's clean and should be correct and parallel.

    // I will create three new shaders.
    // `subtraction_initial.frag` (replaces `subtraction.frag`)
    // `propagate_scan.frag`
    // `subtraction_apply.frag`

    // Let's start with `subtraction_initial.frag`. It's almost the same as the old `subtraction.frag`, but it outputs the raw difference.
    // I will just modify the existing `subtraction.frag` for now.

    // Let's write `propagate_scan.frag`.
    // It will be executed in a loop.
    // It reads from one texture and writes to another.
    // The `r` channel is passed through untouched.
    // The `g` channel is the prefix sum.
    vec4 my_val = texture2D(u_inputTexture, v_texCoord);
    float my_borrow = my_val.g;

    if (currentLimbIndex >= u_stride) {
        vec2 neighbor_coord = vec2((currentLimbIndex - u_stride + 0.5) / u_texWidth, 0.5);
        my_borrow += texture2D(u_inputTexture, neighbor_coord).g;
    }

    gl_FragColor = vec4(my_val.r, my_borrow, 0.0, 1.0);
}
