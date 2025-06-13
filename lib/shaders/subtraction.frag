// lib/shaders/subtraction.frag
precision highp float;

uniform sampler2D u_num1Texture;  // Minuend (the number being subtracted from)
uniform sampler2D u_num2Texture;  // Subtrahend (the number to subtract)
uniform sampler2D u_borrowTexture; // Texture containing incoming borrows

varying vec2 v_texCoord; // Texture coordinate, indicates which limb we're processing

const float BASE = 10000.0;

void main() {
    float limb1 = texture2D(u_num1Texture, v_texCoord).r;
    float limb2 = texture2D(u_num2Texture, v_texCoord).r;
    float borrowIn = texture2D(u_borrowTexture, v_texCoord).r; // Borrow from the previous (less significant) limb

    float diff = limb1 - limb2 - borrowIn;
    float resultLimb;
    float borrowOut;

    if (diff < 0.0) {
        resultLimb = diff + BASE;
        borrowOut = 1.0;
    } else {
        resultLimb = diff;
        borrowOut = 0.0;
    }

    // DEBUG: Output raw inputs
    // gl_FragColor = vec4(limb1, limb2, borrowIn, 1.0); // This line MUST be commented out
    gl_FragColor = vec4(resultLimb, borrowOut, 0.0, 1.0); // This line MUST be active
}
