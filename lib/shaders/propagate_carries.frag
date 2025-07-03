
precision highp float;

uniform sampler2D u_inputTexture; // Texture containing column sums and carries (from sum_columns.frag)
uniform sampler2D u_carryInTexture; // Texture for incoming carries from previous pass (if multi-pass)
uniform float u_base;             // The numerical base (e.g., 10000.0)
uniform float u_textureWidth;     // Width of the input texture (number of limbs)

varying vec2 v_texCoord;

void main() {
    // Get the current column's sum and carry from the input texture
    vec4 currentColumnData = texture2D(u_inputTexture, v_texCoord);
    float currentSum = currentColumnData.r;
    float currentCarry = currentColumnData.g;

    // Get the carry-in from the previous limb (pixel to the left)
    // This assumes a 1D texture where x-coordinate represents limb index.
    float incomingCarry = 0.0;
    // Sample from the pixel to the left (previous limb) in the *current* pass
    // This is for propagating carries from left to right within a single row.
    if (v_texCoord.x > 0.0) {
        // Calculate texel coordinate for the previous pixel
        // We need to sample from the texture that was the output of the *previous* iteration.
        // In the ping-pong setup, u_inputTexture is the output of the previous iteration.
        // The carry from the previous limb is in the .g component of the texel to the left.
        incomingCarry = texture2D(u_inputTexture, vec2(v_texCoord.x - (1.0 / u_textureWidth), v_texCoord.y)).g;
    }

    // Add the incoming carry to the current sum
    float total = currentSum + incomingCarry;

    // Calculate the final limb value and the carry-out for the next limb
    float resultLimb = mod(total, u_base);
    float outgoingCarry = floor(total / u_base);

    // Output the final limb value and the outgoing carry
    // The outgoingCarry will be used as incomingCarry for the next limb in the next pass (if multi-pass)
    gl_FragColor = vec4(resultLimb, outgoingCarry, 0.0, 1.0);
}
