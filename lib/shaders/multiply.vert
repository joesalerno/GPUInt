// lib/shaders/multiply.vert
attribute vec2 a_position; // Vertex position (typically a quad from -1 to 1)
varying vec2 v_texCoord;   // Pass texture coordinate to fragment shader

void main() {
    // Simple pass-through: map quad vertices to clip space
    gl_Position = vec4(a_position, 0.0, 1.0);

    // Map quad vertices directly to texture coordinates (0 to 1)
    // Assumes the quad vertices are set up to conveniently map to texture space.
    // For a quad from (-1,-1) to (1,1), this maps to (0,0) to (1,1) in texture space.
    v_texCoord = a_position * 0.5 + 0.5;
}
