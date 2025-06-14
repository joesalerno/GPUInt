// lib/shaders/multiply.frag
precision highp float;

uniform sampler2D u_num1Texture;   // Texture for one of the numbers (e.g., multiplicand)
uniform float u_num2Limb;        // A single limb of the other number (e.g., current multiplier limb)
uniform sampler2D u_carryTexture;  // Texture for incoming carry (or partial product sum from previous step)

varying vec2 v_texCoord;         // Texture coordinate, indicates which limb of u_num1Texture we're processing

const float BASE = 10000.0;

void main() {
    float limb1 = texture2D(u_num1Texture, v_texCoord).r; // Current limb of num1
    float carryIn = texture2D(u_carryTexture, v_texCoord).r; // Carry-in / partial product sum from previous stage

    float product = limb1 * u_num2Limb;
    float totalSum = product + carryIn;

    float resultLimb = mod(totalSum, BASE);
    float carryOut = floor(totalSum / BASE);

    // Output the result limb and the new carry
    gl_FragColor = vec4(resultLimb, carryOut, 0.0, 1.0);
}
