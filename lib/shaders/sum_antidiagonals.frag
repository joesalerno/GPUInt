precision highp float;

uniform sampler2D u_partialProductsTexture; // Texture containing (value, carry) from P_ij = A_i * B_j
uniform float u_lenA;                     // Number of limbs in operand A
uniform float u_lenB;                     // Number of limbs in operand B
uniform float u_productTexWidth;          // Width of the partial products texture
uniform float u_productTexHeight;         // Height of the partial products texture
uniform float u_base;
uniform float u_outputTexWidth;           // Width of the output texture

varying vec2 v_texCoord; // Normalized texture coordinates for the output pixel

const int MAX_LIMB_ITERATIONS = 256;

// Function to compute fmod more robustly for positive numbers
float robust_mod(float x, float y) {
    if (y == 0.0) return x; // Or handle error appropriately
    return x - y * floor(x / y);
}

void main() {
    // k is the index of the anti-diagonal, and also the index of the output limb S_k
    float k_float = floor(v_texCoord.x * u_outputTexWidth);
    int k = int(k_float);

    float sum_val = 0.0;
    float sum_carry = 0.0;

    // Sum P_ij where i+j = k
    for (int i = 0; i < MAX_LIMB_ITERATIONS; ++i) {
        if (i >= int(u_lenA)) { // Current limb of A is out of bounds
            break;
        }

        int j = k - i; // Calculate corresponding limb index for B

        if (j >= 0 && j < int(u_lenB)) { // Check if limb of B is in bounds
            // (i, j) is a valid index pair for P_ij
            // Sample u_partialProductsTexture at coordinates corresponding to (i, j)
            float u_coord = (float(i) + 0.5) / u_productTexWidth;
            float v_coord = (float(j) + 0.5) / u_productTexHeight;
            vec4 partial_product_components = texture2D(u_partialProductsTexture, vec2(u_coord, v_coord));

            sum_val += partial_product_components.r;   // Add value part of P_ij
            sum_carry += partial_product_components.g; // Add carry part of P_ij
        }
    }

    // Normalize the sum: S_k = (sum_val_k % BASE), C_k_initial = floor(sum_val_k / BASE) + sum_carry_k
    float final_limb_val = robust_mod(sum_val, u_base); // Use robust_mod
    float carry_from_sum_val = floor(sum_val / u_base);
    float final_carry_val = carry_from_sum_val + sum_carry;

    gl_FragColor = vec4(final_limb_val, final_carry_val, 0.0, 1.0); // Output S_k % BASE and its initial carry
}
