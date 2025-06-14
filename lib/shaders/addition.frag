// src/shaders/addition.frag (Debug version)
precision highp float;

uniform sampler2D u_num1Texture;
uniform sampler2D u_num2Texture;
uniform sampler2D u_carryTexture;
uniform float u_base;         // Now used
uniform float u_texWidth;     // The width of the texture (number of limbs/pixels)
varying vec2 v_texCoord;

void main() {
    float norm_texCoordX = v_texCoord.x;
    float norm_texWidth = u_texWidth / 10.0; // Scale texWidth to see it (e.g. 2.0 -> 0.2)
                                         // Be careful if texWidth can be > 10

    float currentLimbIndex_float = floor(v_texCoord.x * u_texWidth);

    // Read actual L0 of num1 and num2 to make sure texture reading itself is okay for the first texel at least
    // This part is not strictly necessary for debugging v_texCoord and u_texWidth but can stay
    float limb1_L0 = texture2D(u_num1Texture, vec2(0.5 / u_texWidth, 0.5)).r;
    float limb2_L0 = texture2D(u_num2Texture, vec2(0.5 / u_texWidth, 0.5)).r;

    // Output debug values:
    // R: currentLimbIndex_float (e.g. 0.0 for first pixel, 1.0 for second if texWidth=2)
    // G: norm_texWidth (e.g. 0.2 if texWidth=2)
    // B: norm_texCoordX (varying from 0 to 1)
    // A: Use u_base in a dummy way to ensure it's not optimized out. Alpha usually 1.0.
    //    mod(u_base, 100.0) / 100.0 could give a value in [0,1) if u_base is large.
    float debug_base_check = mod(u_base, 100.0) / 100.0;
    if (u_base == 0.0) debug_base_check = 0.1; // Avoid 0 if base is 0, just for visibility

    gl_FragColor = vec4(currentLimbIndex_float, norm_texWidth, norm_texCoordX, debug_base_check);
}
