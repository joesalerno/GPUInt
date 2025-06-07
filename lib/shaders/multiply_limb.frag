// lib/shaders/multiply_limb.frag
precision highp float;

uniform float u_limbVal;            // The single limb value from the first number
uniform sampler2D u_otherNumTexture; // Texture containing limbs of the second number
uniform sampler2D u_carryTexture;    // Texture containing incoming carries (e.g., from previous limb's high part)

varying vec2 v_texCoord; // Texture coordinate, indicates which limb of u_otherNumTexture we're processing

const float BASE = 10000.0; // Make sure this BASE is consistent with JS

void main() {
    float otherNumLimb = texture2D(u_otherNumTexture, v_texCoord).r;
    float carryIn = texture2D(u_carryTexture, v_texCoord).r; // Carry from the previous (less significant) position's calculation.

    // Product can exceed BASE*BASE, but individual limb operations are usually limb * limb + carry
    // The carryIn here is from the multiplication of u_limbVal by the *previous* otherNumLimb.
    // Example: u_limbVal * (y_2 y_1 y_0) = u_limbVal*y_0 + u_limbVal*y_1*BASE + u_limbVal*y_2*BASE^2
    // Shader processes one otherNumLimb (y_j) at a time.
    // product = u_limbVal * y_j + carry_from_processing_y_{j-1}

    float product = u_limbVal * otherNumLimb + carryIn;

    float resultLimb = mod(product, BASE);
    float carryOut = floor(product / BASE); // This carryOut will be the carryIn for the next (more significant) limb y_{j+1}

    gl_FragColor = vec4(resultLimb, carryOut, 0.0, 1.0); // Output: result limb and carry out to next stage
}
