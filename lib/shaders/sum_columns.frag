
precision highp float;

uniform sampler2D u_inputTexture; // Texture containing partial products (limb, carry)
uniform float u_textureHeight;    // Height of the input texture
uniform float u_base;             // The numerical base (e.g., 10000.0)

varying vec2 v_texCoord;

void main() {
    float colSum = 0.0;
    float carrySum = 0.0;

    // This shader now sums two adjacent elements from the input texture.
    // The JavaScript will manage multiple passes for full column summation.
    // v_texCoord.y will be used to select which pair of rows to sum.

    // Sample the current row (v_texCoord.y)
    vec4 texel1 = texture2D(u_inputTexture, v_texCoord);

    // Sample the next row (v_texCoord.y + 1.0 / u_textureHeight)
    // Ensure we don't go out of bounds if u_textureHeight is odd or on the last pass
    vec4 texel2 = texture2D(u_inputTexture, vec2(v_texCoord.x, v_texCoord.y + (1.0 / u_textureHeight)));

    colSum = texel1.r + texel2.r;
    carrySum = texel1.g + texel2.g;

    // Output the sum of the column and the sum of carries for this column.
    // These will be processed in a subsequent pass for final carry propagation.
    gl_FragColor = vec4(colSum, carrySum, 0.0, 1.0);
}
