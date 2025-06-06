// src/shaders/addition.vert
attribute vec2 a_position; // Vertex positions (e.g., a quad from -1 to 1)
attribute vec2 a_texCoord; // Texture coordinates

varying vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
