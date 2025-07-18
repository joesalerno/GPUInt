precision highp float;

uniform sampler2D u_dividendTexture;
uniform sampler2D u_divisorTexture;
uniform sampler2D u_quotientTexture;
uniform float u_base;
uniform float u_texWidth;
uniform int u_iteration;

varying vec2 v_texCoord;

void main() {
    float limbIndex = floor(v_texCoord.x * u_texWidth);
    float texelX = (limbIndex + 0.5) / u_texWidth;
    
    // Sample the dividend limb
    float dividendLimb = texture2D(u_dividendTexture, vec2(texelX, 0.5)).r;
    
    // Multi-limb divisor support
    float divisorValue = 0.0;
    float basePow = 1.0;
    for (float i = 0.0; i < u_texWidth; i += 1.0) {
        float limb = texture2D(u_divisorTexture, vec2((i + 0.5) / u_texWidth, 0.5)).r;
        divisorValue += limb * basePow;
        basePow *= u_base;
    }

    // Get current quotient estimate
    float quotientEstimate = texture2D(u_quotientTexture, vec2(texelX, 0.5)).r;

    // Use the full divisor value for division
    float result = dividendLimb / divisorValue;
    float remainder = mod(dividendLimb, divisorValue);

    // Output: quotient in R, remainder in G
    gl_FragColor = vec4(result, remainder, 0.0, 1.0);
}
