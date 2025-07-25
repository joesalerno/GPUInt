// lib/shaders/subtraction.frag
precision highp float;

uniform sampler2D u_num1Texture;  // Minuend (the number being subtracted from)
uniform sampler2D u_num2Texture;  // Subtrahend (the number to subtract)

varying vec2 v_texCoord; // Texture coordinate, indicates which limb we're processing

void main() {
    float limb1 = texture2D(u_num1Texture, v_texCoord).r;
    float limb2 = texture2D(u_num2Texture, v_texCoord).r;

    float diff = limb1 - limb2;

    // Output the raw difference. The CPU will handle borrow propagation.
    gl_FragColor = vec4(diff, 0.0, 0.0, 1.0);
}
