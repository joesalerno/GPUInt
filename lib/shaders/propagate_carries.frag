precision highp float;
varying vec2 v_texCoord;

uniform sampler2D u_inputTexture;
uniform float u_base;
uniform float u_textureWidth;

// Function to compute fmod more robustly for positive numbers
float robust_mod(float x, float y) {
    if (y == 0.0) return x;
    return x - y * floor(x / y);
}

void main() {
    float current_x_pixel_idx = floor(v_texCoord.x * u_textureWidth);
    vec2 current_tex_coord = vec2((current_x_pixel_idx + 0.5) / u_textureWidth, 0.5);

    vec4 self_components = texture2D(u_inputTexture, current_tex_coord);
    float current_limb_val = self_components.r;

    float propagated_carry_from_left = 0.0;
    if (current_x_pixel_idx > 0.0) {
        vec2 left_neighbor_tex_coord = vec2((current_x_pixel_idx - 1.0 + 0.5) / u_textureWidth, 0.5);
        propagated_carry_from_left = texture2D(u_inputTexture, left_neighbor_tex_coord).g;
    }

    float sum_for_final_limb = current_limb_val + propagated_carry_from_left;

    float new_limb_at_k = robust_mod(sum_for_final_limb, u_base); // Use robust_mod
    float new_carry_from_k = floor(sum_for_final_limb / u_base);

    gl_FragColor = vec4(new_limb_at_k, new_carry_from_k, 0.0, 1.0);
}
