/**
 * Initializes a WebGL context.
 * @param {HTMLCanvasElement} canvas The canvas element.
 * @returns {WebGLRenderingContext | null} The WebGL context, or null if not available.
 */
function initWebGL(canvas) {
  try {
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) {
      console.error("WebGL not supported.");
      return null;
    }
    return gl;
  } catch (e) {
    console.error("Error initializing WebGL: ", e);
    return null;
  }
}

/**
 * Creates a shader.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {GLenum} type The shader type (gl.VERTEX_SHADER or gl.FRAGMENT_SHADER).
 * @param {string} source The shader source code.
 * @returns {WebGLShader | null} The compiled shader, or null on failure.
 */
function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) {
    console.error("Error creating shader.");
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Error compiling shader:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Creates a shader program.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {WebGLShader} vertexShader The compiled vertex shader.
 * @param {WebGLShader} fragmentShader The compiled fragment shader.
 * @returns {WebGLProgram | null} The shader program, or null on failure.
 */
function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  if (!program) {
    console.error("Error creating program.");
    return null;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Error linking program:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/**
 * Creates a WebGL buffer.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {ArrayBufferView} data The data to upload to the buffer.
 * @param {GLenum} [usage=gl.STATIC_DRAW] The usage type for the buffer.
 * @returns {WebGLBuffer | null} The WebGL buffer, or null on failure.
 */
function createBuffer(gl, data, usage = gl.STATIC_DRAW) {
  const buffer = gl.createBuffer();
  if (!buffer) {
    console.error("Error creating buffer.");
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  return buffer;
}
