precision highp float;

uniform sampler2D u_partialProductsTex; // Texture containing limb products (P_ij_val in .r, P_ij_carry in .g)
uniform int u_texWidth;                 // Dimension of the square texture (N)
uniform int u_k;                        // The anti-diagonal index we are summing (0 to 2N-2)
uniform float u_base;                   // The base of the limb system (e.g., 10000.0)

// Function to robustly calculate modulo for positive numbers
float robust_mod(float a, float b) {
    return a - b * floor(a / b);
}

// Function to perform higher precision multiplication of two "limbs"
// and return the result as {value_within_base, carry_out_of_base}
// This is used by multiply_full.frag and needed here for consistent simulation if required.
vec2 multiply_limbs_to_val_carry(float limbA, float limbB, float base) {
    float S = sqrt(base); // Split point for emulated higher precision
    float al = robust_mod(limbA, S);
    float ah = floor(limbA / S);
    float bl = robust_mod(limbB, S);
    float bh = floor(limbB / S);

    float c0 = al * bl;
    float c1 = ah * bl + al * bh;
    float c2 = ah * bh;

    // Reconstruct the full product: P = c2*S^2 + c1*S + c0
    // P = c2*base + c1*S + c0
    // We need to get this into: resultLimb + carryOut * base

    float X = c1 * S + c0; // Intermediate sum that might exceed 'base'

    float resultLimb = robust_mod(X, base);
    float carryToC2 = floor(X / base);
    float totalCarry = c2 + carryToC2;

    return vec2(resultLimb, totalCarry);
}


void main() {
    // Accumulators for the sum of P_val and P_carry for the current anti-diagonal k
    float s_k_limb_accumulator = 0.0;
    float s_k_carry_accumulator = 0.0;

    // Loop through all possible i values for the current anti-diagonal k
    // i ranges from max(0, k - (N-1)) to min(k, N-1)
    // N is u_texWidth
    // For GLSL ES 1.0, loop counters must be const. Iterating u_texWidth times is safe.
    // We will select only valid (i,j) pairs inside the loop.
    // j = k - i.
    // Constraints: 0 <= i < N and 0 <= j < N
    // So, 0 <= i < N and 0 <= k-i < N  =>  k-N < i <= k

    const int MAX_ITERATIONS = 256; // Max texture dimension supported by multiply_full

    for (int i = 0; i < MAX_ITERATIONS; ++i) {
        if (i >= u_texWidth) break; // Ensure i is within bounds of actual texture dim

        int j = u_k - i;

        if (j >= 0 && j < u_texWidth) {
            // This (i,j) is a valid pair for the current anti-diagonal k

            // Texture coordinates are normalized (0.0 to 1.0).
            // Adding 0.5 to pixel index to sample center of texel.
            float tex_i = (float(i) + 0.5) / float(u_texWidth);
            float tex_j = (float(j) + 0.5) / float(u_texWidth);

            vec4 partial_product_components = texture2D(u_partialProductsTex, vec2(tex_i, tex_j));
            float P_val = partial_product_components.r; // The P_ij_val (product mod base)
            float P_c = partial_product_components.g;   // The P_ij_carry (product / base)

            // Accumulate P_val into s_k_limb_accumulator, propagating its carry
            float temp_sum_for_limb = s_k_limb_accumulator + P_val;
            s_k_limb_accumulator = robust_mod(temp_sum_for_limb, u_base);
            s_k_carry_accumulator += floor(temp_sum_for_limb / u_base);

            // Add P_c to the carry accumulator
            s_k_carry_accumulator += P_c;
        }
    }

    // s_k_limb_accumulator is the final limb value for this anti-diagonal (C_k)
    // s_k_carry_accumulator is the carry to be passed to the next anti-diagonal sum ( conceptually C_{k+1} += s_k_carry_accumulator * u_base, but handled in JS)
    // For this shader, we just output these two components.
    // The JS side will read these values and perform the final carry propagation across all C_k.
    gl_FragColor = vec4(s_k_limb_accumulator, s_k_carry_accumulator, 0.0, 1.0);
}
