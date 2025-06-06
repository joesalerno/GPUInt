// src/shaders/addition.frag
precision highp float; // Important for GPGPU

uniform sampler2D u_num1Texture; // Texture containing limbs of the first number
uniform sampler2D u_num2Texture; // Texture containing limbs of the second number
uniform sampler2D u_carryTexture; // Texture containing incoming carries

varying vec2 v_texCoord; // Texture coordinate, indicates which limb we're processing

const float BASE = 10000.0;

void main() {
    // Read limbs from input textures
    // texture2D returns a vec4, we'll assume the limb is in the 'r' component
    float limb1 = texture2D(u_num1Texture, v_texCoord).r;
    float limb2 = texture2D(u_num2Texture, v_texCoord).r;
    float carryIn = texture2D(u_carryTexture, v_texCoord).r; // Carry from the previous (less significant) limb

    float sum = limb1 + limb2 + carryIn;

    float resultLimb = mod(sum, BASE);
    float carryOut = floor(sum / BASE);

    // Output the result limb and the new carry.
    // We can pack this into two components of gl_FragColor.
    // For example, resultLimb in .r and carryOut in .g
    // The other components (.b, .a) can be zero or used for other data.
    gl_FragColor = vec4(resultLimb, carryOut, 0.0, 1.0);
}
