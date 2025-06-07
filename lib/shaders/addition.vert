// lib/shaders/addition.vert
attribute vec2 a_position; // Vertex positions (e.g., a quad from -1 to 1)
varying vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = (a_position + 1.0) / 2.0; // Map from [-1,1] to [0,1]
}
