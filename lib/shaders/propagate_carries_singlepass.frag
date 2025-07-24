// lib/shaders/propagate_carries_singlepass.frag
// Single-pass parallel prefix sum for carry/borrow propagation
precision highp float;

varying vec2 v_texCoord;
uniform sampler2D u_inputTexture;
uniform float u_base;
uniform float u_textureWidth;

// Helper: robust mod for positive numbers
float robust_mod(float x, float y) {
    if (y == 0.0) return x;
    return x - y * floor(x / y);
}

const int MAX_WIDTH = 256;

void main() {
    float idx = floor(v_texCoord.x * u_textureWidth);
    float texelX = (idx + 0.5) / u_textureWidth;
    float sum = 0.0;
    float carry = 0.0;
    // Prefix sum: accumulate all previous carries and values
    for (int i = 0; i < MAX_WIDTH; i++) {
        if (float(i) <= idx) {
            float sampleX = (float(i) + 0.5) / u_textureWidth;
            vec4 limb = texture2D(u_inputTexture, vec2(sampleX, 0.5));
            sum += limb.r;
            sum += limb.g; // accumulate carry from previous limb
        }
    }
    float resultLimb = robust_mod(sum, u_base);
    float carryOut = floor(sum / u_base);
    gl_FragColor = vec4(resultLimb, carryOut, 0.0, 1.0);
}
