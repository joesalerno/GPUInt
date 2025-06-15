precision highp float;

uniform float u_limbValue;         // The single limb value from the first number.
uniform sampler2D u_otherNumTexture; // Texture containing limbs of the second number (LSL first).
uniform float u_base;              // The base (e.g., 10000).

varying vec2 v_texCoord;           // Texture coordinate, ranging from 0.0 to 1.0.

void main() {
    // Sample the limb from the second number's texture.
    float otherLimb = texture2D(u_otherNumTexture, v_texCoord).r;

    // Perform the multiplication: current limb of otherNum * u_limbValue
    float product = otherLimb * u_limbValue;

    // Calculate the part of the product that belongs to the current limb position
    // and the carry that needs to be propagated to the next (more significant) limb.
    float limbProductResult = mod(product, u_base);
    float carryOut = floor(product / u_base);

    // Output:
    // r: the resulting product for the current limb position (after mod base).
    // g: the carry generated from this multiplication to be handled by the next more significant limb.
    // b, a: not strictly used for this calculation, can be 0 or 1.
    gl_FragColor = vec4(limbProductResult, carryOut, 0.0, 1.0);
}
