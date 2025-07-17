precision highp float;

uniform sampler2D u_num1Texture;
uniform sampler2D u_num2Texture;
uniform float u_base;
uniform float u_texWidth; // Width of the texture (number of limbs)
varying vec2 v_texCoord;

void main() {
    // Calculate the index of the current limb based on texture coordinate
    float currentLimbIndex_float = floor(v_texCoord.x * u_texWidth);

    // Normalize coordinates to sample the center of the texel for the current limb index
    float texelX = (currentLimbIndex_float + 0.5) / u_texWidth;

    // Sample from R channel of RGBA textures
    float limb1 = texture2D(u_num1Texture, vec2(texelX, 0.5)).r;
    float limb2 = texture2D(u_num2Texture, vec2(texelX, 0.5)).r;

    float sum = limb1 + limb2;
    float resultLimb = mod(sum, u_base);
    float carryOut = floor(sum / u_base);

    // Output: resultLimb in R, carryOut in G, unused in B, alpha in A
    gl_FragColor = vec4(resultLimb, carryOut, 0.0, 1.0);
}
