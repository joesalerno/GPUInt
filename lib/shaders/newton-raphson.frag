// Optimized Newton-Raphson iteration shader for GPU division
precision highp float;

uniform sampler2D u_divisorTexture;      // B (divisor) limbs
uniform sampler2D u_currentXTexture;     // X_n (current reciprocal approximation) limbs
uniform sampler2D u_carryTexture;        // Carry values from previous operations
uniform float u_base;                    // Base for calculations
uniform float u_texWidth;                // Width of texture (number of limbs)
uniform int u_iteration;                 // Current iteration number
uniform float u_convergenceThreshold;    // Threshold for convergence detection

varying vec2 v_texCoord;

// Helper function to read limb value safely
float readLimb(sampler2D texture, float limbIndex) {
    if (limbIndex < 0.0 || limbIndex >= u_texWidth) {
        return 0.0;
    }
    float texX = (limbIndex + 0.5) / u_texWidth;
    return texture2D(texture, vec2(texX, 0.5)).r;
}

// Optimized multiplication for Newton-Raphson: B * X_n
vec2 multiplyBX(float limbIndex) {
    float result = 0.0;
    float carry = 0.0;
    
    // Perform multiplication B * X for this limb position
    for (float i = 0.0; i <= limbIndex && i < u_texWidth; i++) {
        float bLimb = readLimb(u_divisorTexture, limbIndex - i);
        float xLimb = readLimb(u_currentXTexture, i);
        
        result += bLimb * xLimb;
    }
    
    // Handle carry propagation
    float finalResult = mod(result, u_base);
    float carryOut = floor(result / u_base);
    
    return vec2(finalResult, carryOut);
}

// Optimized subtraction for Newton-Raphson: 2 - (B * X_n)
vec2 subtract2MinusBX(float limbIndex, float bxValue) {
    float twoValue = (limbIndex == 0.0) ? 2.0 : 0.0;
    float borrow = texture2D(u_carryTexture, vec2((limbIndex + 0.5) / u_texWidth, 0.5)).g;
    
    float diff = twoValue - bxValue - borrow;
    float result;
    float borrowOut;
    
    if (diff < 0.0) {
        result = diff + u_base;
        borrowOut = 1.0;
    } else {
        result = diff;
        borrowOut = 0.0;
    }
    
    return vec2(result, borrowOut);
}

// Optimized final multiplication: X_n * (2 - B * X_n)
vec2 finalMultiply(float limbIndex, float term2MinusBX) {
    float result = 0.0;
    float carry = 0.0;
    
    // Perform multiplication X_n * (2 - B * X_n) for this limb position
    for (float i = 0.0; i <= limbIndex && i < u_texWidth; i++) {
        float xLimb = readLimb(u_currentXTexture, limbIndex - i);
        float termLimb = (i == 0.0) ? term2MinusBX : 0.0; // Simplified for single limb case
        
        result += xLimb * termLimb;
    }
    
    // Handle carry propagation
    float finalResult = mod(result, u_base);
    float carryOut = floor(result / u_base);
    
    return vec2(finalResult, carryOut);
}

void main() {
    float limbIndex = floor(v_texCoord.x * u_texWidth);
    
    // Check if we're within bounds
    if (limbIndex >= u_texWidth) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    
    // Step 1: Calculate B * X_n for this limb
    vec2 bxResult = multiplyBX(limbIndex);
    
    // Step 2: Calculate 2 - (B * X_n) for this limb
    vec2 subtractResult = subtract2MinusBX(limbIndex, bxResult.x);
    
    // Step 3: Calculate X_n * (2 - B * X_n) for this limb
    vec2 finalResult = finalMultiply(limbIndex, subtractResult.x);
    
    // Convergence detection: check if change is below threshold
    float currentX = readLimb(u_currentXTexture, limbIndex);
    float convergenceCheck = abs(finalResult.x - currentX) < u_convergenceThreshold ? 1.0 : 0.0;
    
    // Output: result limb in R, carry in G, convergence flag in B
    gl_FragColor = vec4(finalResult.x, finalResult.y, convergenceCheck, 1.0);
}
