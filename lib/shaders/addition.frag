precision highp float;

uniform sampler2D u_num1Texture;
uniform sampler2D u_num2Texture;
// uniform sampler2D u_carryTexture; // Carry-in texture might not be needed if processed serially or handled by CPU
uniform float u_base;
uniform float u_texWidth; // Width of the texture (number of limbs)
varying vec2 v_texCoord;

void main() {
    // Calculate the index of the current limb based on texture coordinate
    // v_texCoord.x ranges from 0.0 to 1.0. Multiply by u_texWidth to get current processing unit.
    // Add 0.5 before floor to sample center of texel.
    float currentLimbIndex_float = floor(v_texCoord.x * u_texWidth);

    // Normalize coordinates to sample the center of the texel for the current limb index
    float texelX = (currentLimbIndex_float + 0.5) / u_texWidth;

    float limb1 = texture2D(u_num1Texture, vec2(texelX, 0.5)).r;
    float limb2 = texture2D(u_num2Texture, vec2(texelX, 0.5)).r;
    // float carryIn = texture2D(u_carryTexture, vec2(texelX, 0.5)).r; // Assuming carry-in is 0 for this simplified shader pass

    float sum = limb1 + limb2; // + carryIn;
    float resultLimb = mod(sum, u_base);
    float carryOut = floor(sum / u_base);

    // Output: resultLimb in R, carryOut in G. B and A can be 0 and 1.
    gl_FragColor = vec4(resultLimb, carryOut, 0.0, 1.0);
}
