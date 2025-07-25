precision highp float;

uniform sampler2D u_num1Texture;
uniform sampler2D u_num2Texture;
uniform float u_base;
uniform float u_texWidth;
varying vec2 v_texCoord;

void main() {
    float currentLimbIndex = floor(v_texCoord.x * u_texWidth);

    // Fetch limbs for the current position
    float limb1 = texture2D(u_num1Texture, vec2((currentLimbIndex + 0.5) / u_texWidth, 0.5)).r;
    float limb2 = texture2D(u_num2Texture, vec2((currentLimbIndex + 0.5) / u_texWidth, 0.5)).r;

    // Fetch carry from the previous limb's calculation.
    // The previous limb's carry is stored in its green channel.
    float carryIn = 0.0;
    if (currentLimbIndex > 0.0) {
        float prevLimbIndex = currentLimbIndex - 1.0;
        float prevTexelX = (prevLimbIndex + 0.5) / u_texWidth;
        // This creates a dependency on the previous texel, which isn't ideal for parallel processing.
        // A better approach would be a multi-pass system, but for simplicity, we'll try this first.
        // This will likely not work as intended due to parallel execution.
        // The correct way to handle this is with multiple render passes or a more advanced shader.
        // Let's stick to the multi-pass approach, but simplify the logic in bigint.js.
        // For now, let's assume carry-in is always 0 and handled by the CPU-side loop.
    }

    float sum = limb1 + limb2;
    float resultLimb = mod(sum, u_base);
    float carryOut = floor(sum / u_base);

    gl_FragColor = vec4(resultLimb, carryOut, 0.0, 1.0);
}
