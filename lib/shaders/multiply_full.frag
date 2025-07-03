
precision highp float;

uniform sampler2D u_num1Texture;
uniform sampler2D u_num2Texture;
uniform float u_texWidth;
uniform float u_base;

varying vec2 v_texCoord;

void main() {
    // Calculate the integer texture coordinates
    float x = floor(v_texCoord.x * u_texWidth);
    float y = floor(v_texCoord.y * u_texWidth); // Assuming square textures for simplicity initially

    // Get the limb values from the textures
    // We need to map the 2D texture coordinate back to a 1D index for the limbs
    // For a 1D array stored in a 2D texture, v_texCoord.x is the index / texWidth
    // So, to get the value at index i, we sample at ( (i + 0.5) / texWidth, 0.5 )
    // Here, x and y are already integer indices.
    // For simplicity, let's assume u_num1Texture and u_num2Texture are 1D textures (height 1)
    // and v_texCoord.y is always 0.5 (or some constant for 1D access).
    // We'll use v_texCoord.x to get the limb index.

    // In a schoolbook multiplication, we multiply limb_i from num1 by limb_j from num2.
    // The result contributes to the (i+j)-th position of the product.
    // We need to decide how to map (i, j) to a fragment.
    // A 2D texture where (x,y) corresponds to (limb_x_from_num1, limb_y_from_num2) is a good start.

    // Let's assume v_texCoord.x corresponds to limb index from num1, and v_texCoord.y to limb index from num2.
    // This means the output texture will be (num1_len) x (num2_len).
    // The actual output texture size will be (num1_limbs + num2_limbs - 1) for the sum.
    // This implies a different strategy for mapping.

    // For now, let's simplify: this shader calculates a single product of two limbs.
    // The main JS code will manage multiple passes for summation.

    // This fragment shader will compute the product of two limbs and their carry.
    // It will be used in a multi-pass rendering approach.
    // Pass 1: Compute all pairwise products (limbA[i] * limbB[j])
    // Pass 2+: Sum and propagate carries

    // For Pass 1: Each fragment (x, y) computes product of limbA[x] * limbB[y]
    // u_num1Texture and u_num2Texture are 1D textures (height 1)
    float limbA = texture2D(u_num1Texture, vec2(v_texCoord.x, 0.5)).r;
    float limbB = texture2D(u_num2Texture, vec2(v_texCoord.y, 0.5)).r; // Assuming u_num2Texture is sampled along y

    float product = limbA * limbB;

    // The product can be larger than BASE. We need to split it into current limb and carry.
    float resultLimb = mod(product, u_base);
    float carryOut = floor(product / u_base);

    // Store resultLimb in .r and carryOut in .g
    gl_FragColor = vec4(resultLimb, carryOut, 0.0, 1.0);
}
