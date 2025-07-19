uniform sampler2D u_dividendTexture;
uniform sampler2D u_divisorTexture;
uniform sampler2D u_quotientTexture;
uniform float u_base;
uniform float u_texWidth;
uniform int u_iteration;

varying vec2 v_texCoord;

void main() {
    // Batched division: y coordinate selects the batch index
    float limbIndex = floor(v_texCoord.x * u_texWidth);
    float batchIndex = floor(v_texCoord.y * u_texWidth); // assumes square texture for batching
    float texelX = (limbIndex + 0.5) / u_texWidth;
    float texelY = (batchIndex + 0.5) / u_texWidth;

    // Sample the dividend limb for this batch
    float dividendLimb = texture2D(u_dividendTexture, vec2(texelX, texelY)).r;

    // Multi-limb divisor for this batch
    float divisorValue = 0.0;
    float basePow = 1.0;
    for (float i = 0.0; i < u_texWidth; i += 1.0) {
        float limb = texture2D(u_divisorTexture, vec2((i + 0.5) / u_texWidth, texelY)).r;
        divisorValue += limb * basePow;
        basePow *= u_base;
    }

    // Get current quotient estimate (if needed)
    float quotientEstimate = texture2D(u_quotientTexture, vec2(texelX, texelY)).r;

    // Use reciprocal approximation for division (Newton-Raphson, 2 iterations for better accuracy)
    float reciprocal = 1.0 / divisorValue;
    reciprocal = reciprocal * (2.0 - divisorValue * reciprocal); // 1st refinement
    reciprocal = reciprocal * (2.0 - divisorValue * reciprocal); // 2nd refinement

    float quotient = dividendLimb * reciprocal;
    float quotientInt = floor(quotient + 1e-6); // Avoid floating point error
    float remainder = dividendLimb - quotientInt * divisorValue;

    // Output: quotient in R, remainder in G
    gl_FragColor = vec4(quotientInt, remainder, 0.0, 1.0);
}
