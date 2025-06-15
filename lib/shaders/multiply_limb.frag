precision highp float;

uniform float u_limbVal;
uniform sampler2D u_otherNumTexture;
uniform sampler2D u_carryTexture;
uniform float u_base; // Ensure this is uniform, not const
varying vec2 v_texCoord;

void main() {
    float otherLimb = texture2D(u_otherNumTexture, v_texCoord).r;
    float carryIn = texture2D(u_carryTexture, v_texCoord).r;

    float product = u_limbVal * otherNumLimb + carryIn;

    float resultLimb = mod(product, u_base);
    float carryOut = floor(product / u_base);

    gl_FragColor = vec4(resultLimb, carryOut, 0.0, 1.0);
}
