// lib/shaders/subtraction.vert
attribute vec2 a_position; // Vertices for a quad that covers the output texture
varying vec2 v_texCoord;   // Texture coordinate passed to fragment shader

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = (a_position + 1.0) / 2.0; // Map from [-1,1] to [0,1]
}
