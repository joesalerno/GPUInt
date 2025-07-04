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

    // Check for zero limbs early to avoid issues if S is derived from limbA/B, or just for efficiency.
    if (limbA == 0.0 || limbB == 0.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Emulated higher precision multiplication for limbA * limbB
    // Product P = c2*BASE + c1*S + c0
    // where S = sqrt(BASE). For BASE = 10000, S = 100.
    // Max limb value for BASE=10000 is 9999.
    // Splitting limb L = ah*S + al, max ah, al = 99.

    float S = sqrt(u_base); // S = 100.0 for u_base = 10000.0

    float al = robust_mod(limbA, S);
    float ah = floor(limbA / S);
    float bl = robust_mod(limbB, S);
    float bh = floor(limbB / S);

    float c0 = al * bl;         // max 99*99 = 9801. Fits float.
    float c1_term1 = ah * bl;   // max 9801. Fits float.
    float c1_term2 = al * bh;   // max 9801. Fits float.
    float c1 = c1_term1 + c1_term2; // max 19602. Fits float.

    float c2 = ah * bh;         // max 9801. Fits float.

    // Intermediate sum X = c1*S + c0
    // c1*S max 19602 * 100 = 1,960,200
    // c0 max 9801
    // X max 1,960,200 + 9801 = 1,969,001. This fits in highp float accurately.
    float X = c1 * S + c0;

    // Now, split X with respect to u_base
    float resultLimb = robust_mod(X, u_base);
    float carryFromX = floor(X / u_base); // This is the carry from (c1*S + c0) part

    // The full carryOut is c2 (from ah*bh*BASE) + carryFromX
    float carryOut = c2 + carryFromX;

    // Store resultLimb in .r and carryOut in .g
    gl_FragColor = vec4(resultLimb, carryOut, 0.0, 1.0);
}
