precision highp float;
varying vec2 v_texCoord;

uniform sampler2D u_inputTexture; // .r: limb_k (or S_k initial), .g: carry_from_k-1 from *previous* iteration's output
uniform float u_base;
uniform float u_textureWidth; // Width of the texture in pixels

void main() {
    float current_x_pixel = gl_FragCoord.x - 0.5; // Current pixel's x-coordinate (0 to width-1)

    // Current limb value (L'_k) at this position k
    vec4 self_components = texture2D(u_inputTexture, vec2(current_x_pixel / u_textureWidth, 0.5));
    float current_limb_value = self_components.r;

    // Carry from the left neighbor (k-1), which was generated in the *previous* iteration and stored in its .g channel
    float carry_from_left = 0.0;
    if (current_x_pixel > 0.0) {
        vec4 left_neighbor_components = texture2D(u_inputTexture, vec2((current_x_pixel - 1.0) / u_textureWidth, 0.5));
        carry_from_left = left_neighbor_components.g; // This is the C'_{k-1}
    }

    float sum_with_carry = current_limb_value + carry_from_left;

    float new_limb_at_k = mod(sum_with_carry, u_base);
    float new_carry_from_k = floor(sum_with_carry / u_base); // This is C'_k to be used by k+1 in the *next* iteration

    gl_FragColor = vec4(new_limb_at_k, new_carry_from_k, 0.0, 1.0);
}
