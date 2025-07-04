precision highp float;

uniform sampler2D u_num1Texture;
uniform sampler2D u_num2Texture;
uniform float u_texWidth; // This should represent the dimension of the input limb textures (e.g. maxInputLen)
uniform float u_base;

varying vec2 v_texCoord;

// Function to compute fmod more robustly for positive numbers
float robust_mod(float x, float y) {
    if (y == 0.0) return x; // Or handle error appropriately
    // Ensure x is positive for this specific version of robust_mod,
    // or use a version that handles negative x correctly if product can be negative (not for limbs).
    // product = limbA * limbB will always be positive as limbs are positive.
    return x - y * floor(x / y);
}

void main() {
    // This fragment shader computes the product of two limbs: limbA[i] * limbB[j]
    // v_texCoord.x is used to select limbA (effectively i / u_texWidth)
    // v_texCoord.y is used to select limbB (effectively j / u_texWidth, assuming square input for conceptual P_ij matrix)

    // Sample limbs from 1D textures (height is implicitly 1, y-coord for sampling is 0.5)
    float limbA = texture2D(u_num1Texture, vec2(v_texCoord.x, 0.5)).r;
    float limbB = texture2D(u_num2Texture, vec2(v_texCoord.y, 0.5)).r;
    // Note: The original used v_texCoord.x for num1 and v_texCoord.y for num2.
    // This means texPartialProducts(x,y) = num1[x] * num2[y]. This is fine.

    float product = limbA * limbB;

    // The product can be larger than BASE. We need to split it into current limb and carry.
    float resultLimb = robust_mod(product, u_base); // Use robust_mod
    float carryOut = floor(product / u_base);

    // Store resultLimb in .r and carryOut in .g
    gl_FragColor = vec4(resultLimb, carryOut, 0.0, 1.0);
}
