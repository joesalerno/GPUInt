precision highp float;

// Uniforms declared but not used in this debug version, will be optimized out
uniform float u_limbValue;
uniform sampler2D u_otherNumTexture;
uniform float u_base;

varying vec2 v_texCoord; // Still used by default by texture2D if it were present

void main() {
    // Debug: Output fragment coordinates
    gl_FragColor = vec4(gl_FragCoord.x, gl_FragCoord.y, 0.0, 1.0);
}
