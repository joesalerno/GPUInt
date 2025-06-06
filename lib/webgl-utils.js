// src/webgl-utils.js

/**
 * Initializes and returns a WebGL_OLD rendering context.
 * @param {HTMLCanvasElement} canvas The canvas element to get the context from.
 * @returns {WebGLRenderingContext | null} The WebGL context or null if not available.
 */
export function initWebGL(canvas) {
    if (!canvas) {
        console.error("initWebGL: Canvas element is null or undefined.");
        return null;
    }
    let gl = null;
    try {
        // Try to grab the standard context. If it fails, fallback to experimental.
        gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    } catch (e) {
        console.error("Error getting WebGL context:", e);
    }

    if (!gl) {
        console.error("WebGL not supported or context creation failed.");
        return null;
    }
    console.log("WebGL context obtained.");
    return gl;
}

/**
 * Creates and compiles a shader.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {GLenum} type The shader type (gl.VERTEX_SHADER or gl.FRAGMENT_SHADER).
 * @param {string} source The shader source code.
 * @returns {WebGLShader | null} The compiled shader or null on failure.
 */
export function createShader(gl, type, source) {
    if (!gl) {
        console.error("createShader: WebGL context is null.");
        return null;
    }
    const shader = gl.createShader(type);
    if (!shader) {
        console.error("Unable to create shader object.");
        return null;
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const shaderType = type === gl.VERTEX_SHADER ? "Vertex" : "Fragment";
        console.error(`Error compiling ${shaderType} shader:`, gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    console.log((type === gl.VERTEX_SHADER ? "Vertex" : "Fragment") + " shader compiled successfully.");
    return shader;
}

/**
 * Creates and links a shader program.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {WebGLShader} vertexShader The compiled vertex shader.
 * @param {WebGLShader} fragmentShader The compiled fragment shader.
 * @returns {WebGLProgram | null} The shader program or null on failure.
 */
export function createProgram(gl, vertexShader, fragmentShader) {
    if (!gl || !vertexShader || !fragmentShader) {
        console.error("createProgram: Invalid arguments (gl, vertexShader, or fragmentShader is null).");
        return null;
    }
    const program = gl.createProgram();
    if (!program) {
        console.error("Unable to create shader program.");
        return null;
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error("Error linking shader program:", gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    console.log("Shader program linked successfully.");
    return program;
}

/**
 * Creates a 2D texture from a Float32Array.
 * Assumes data for RGBA channels if components = 4. For our GPGPU, we might store 1 float per pixel (Luminance or Red).
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {Float32Array} dataArray The data to load into the texture.
 * @param {number} width The width of the texture.
 * @param {number} height The height of the texture.
 * @param {boolean} [useRGBA=false] If true, assumes dataArray has 4 components (RGBA) per texel. If false (default), assumes 1 component (R) per texel.
 * @returns {WebGLTexture | null} The created texture or null on failure.
 */
export function createDataTexture(gl, dataArray, width, height, useRGBA = false) {
    if (!gl) {
        console.error("createDataTexture: WebGL context is null.");
        return null;
    }
    if (!gl.getExtension('OES_texture_float')) {
        console.error('OES_texture_float extension not supported.');
        alert('OES_texture_float extension not supported. This is required for GPGPU tasks.');
        return null;
    }

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // For float textures, WebGL1 requires specific filtering and wrapping.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    let texelData;
    if (useRGBA) {
        // Data is already in RGBA format
        texelData = dataArray;
        if (dataArray.length !== width * height * 4) {
            console.warn("Data array length does not match width*height*4 for RGBA texture.");
        }
    } else {
        // Data is single component, pack it into the Red channel of an RGBA texture.
        texelData = new Float32Array(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            texelData[i * 4 + 0] = dataArray[i]; // Store in Red channel
            texelData[i * 4 + 1] = 0.0;          // Green
            texelData[i * 4 + 2] = 0.0;          // Blue
            texelData[i * 4 + 3] = 1.0;          // Alpha (fully opaque)
        }
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, texelData);

    gl.bindTexture(gl.TEXTURE_2D, null); // Unbind
    console.log(`Data texture created (${width}x${height}).`);
    return texture;
}


/**
 * Reads pixel data from the current framebuffer into a Float32Array.
 * Assumes the data was stored as RGBA float.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {WebGLFramebuffer | null} framebuffer The framebuffer to read from. Bind this before calling.
 * @param {number} width The width of the area to read.
 * @param {number} height The height of the area to read.
 * @param {boolean} [extractSingleComponent=true] If true, extracts only the .r component from each RGBA texel.
 * @returns {Float32Array | null} The pixel data or null on failure.
 */
export function readDataFromTexture(gl, framebuffer, width, height, extractSingleComponent = true) {
    if (!gl) {
        console.error("readDataFromTexture: WebGL context is null.");
        return null;
    }

    const pixelDataRGBA = new Float32Array(width * height * 4); // RGBA
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixelDataRGBA);

    if (extractSingleComponent) {
        const singleComponentData = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            singleComponentData[i] = pixelDataRGBA[i * 4 + 0]; // Extract Red component
        }
        console.log(`Data read from texture (${width}x${height}) and R component extracted.`);
        return singleComponentData;
    } else {
        console.log(`Data read from texture (${width}x${height}) as RGBA.`);
        return pixelDataRGBA;
    }
}
