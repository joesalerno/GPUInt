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
    let contextType = "";
    try {
        gl = canvas.getContext("webgl2");
        if (gl) {
            contextType = "webgl2";
            console.log("[WebGL Utils] Using WebGL2 context.");
        } else {
            console.warn("[WebGL Utils] WebGL2 not supported, falling back to WebGL1.");
            gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
            if (gl) {
                contextType = "webgl";
                console.log("[WebGL Utils] Using WebGL1 context.");
            }
        }
    } catch (e) {
        console.error("Error getting WebGL context:", e);
    }

    if (!gl) {
        console.error("WebGL not supported or context creation failed.");
        return null;
    }

    if (contextType === "webgl") {
        const floatBufferExt = gl.getExtension('WEBGL_color_buffer_float');
        if (!floatBufferExt) {
            console.warn("[WebGL Utils] WEBGL_color_buffer_float extension NOT SUPPORTED on this WebGL1 context. Rendering to float textures may fail.");
            // For GPGPU, this is critical. Let's make it an error that can be caught.
            throw new Error("WEBGL_CAPABILITY_ERROR: WEBGL_color_buffer_float not supported.");
        } else {
            console.log("[WebGL Utils] WEBGL_color_buffer_float extension IS SUPPORTED on this WebGL1 context.");
        }
    }
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
    // console.log((type === gl.VERTEX_SHADER ? "Vertex" : "Fragment") + " shader compiled successfully."); // Removed
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
    // console.log("Shader program linked successfully."); // Removed
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
        // console.error('OES_texture_float extension not supported.'); // Old logging
        // alert('OES_texture_float extension not supported. This is required for GPGPU tasks.'); // Alert is problematic for tests
        throw new Error("WEBGL_CAPABILITY_ERROR: OES_texture_float extension not supported. Required by createDataTexture.");
    }

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // For float textures, WebGL1 requires specific filtering and wrapping.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    let texelData = null; // Initialize texelData to null for clarity

    if (dataArray) { // Only process dataArray if it's not null
        if (useRGBA) {
            // Data is already in RGBA format
            texelData = dataArray;
            if (dataArray.length !== width * height * 4) {
                console.warn("Data array length does not match width*height*4 for RGBA texture.");
                // Potentially return null or throw an error if this is critical
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
    } else if (useRGBA) {
        // If dataArray is null AND useRGBA is true, we might be allocating an empty RGBA texture
        // texelData remains null, which is valid for gl.texImage2D to allocate uninitialized data
    } else {
        // If dataArray is null and we are not using RGBA (i.e., expecting single component to pack)
        // this case might be an error or requires creating an empty Float32Array of appropriate size if needed.
        // For now, let texelData remain null, assuming gl.texImage2D handles it for allocation.
        // If specific initialization (e.g. to zeros) is needed for null single-component, it would go here.
        // texelData = new Float32Array(width * height * 4); // Example if initialization to zero was required
    }

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, texelData);

    gl.bindTexture(gl.TEXTURE_2D, null); // Unbind
    // console.log(`Data texture created (${width}x${height}).`); // Removed
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
    // It's crucial that the framebuffer is bound *before* calling readPixels.
    // This function assumes the caller has already bound the correct framebuffer.
    // gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); // This line was in the original thought process but should be done by caller.

    const bufferSize = width * height * 4;
    const pixelDataRGBA = new Float32Array(bufferSize);
    console.log(`[webgl-utils readDataFromTexture] Requesting ${width}x${height} pixels. Buffer size: ${bufferSize}. Framebuffer: ${framebuffer ? 'provided' : 'null'}`);

    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixelDataRGBA);

    // Log a few initial values to see if it's sparse or truncated
    const rawReadForLog = [];
    for(let i=0; i < Math.min(16, pixelDataRGBA.length); i++) { // Log up to first 16 floats
        rawReadForLog.push(pixelDataRGBA[i]);
    }
    console.log(`[webgl-utils readDataFromTexture] Raw pixels read (first few): [${rawReadForLog.join(',')}]`);

    // gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Caller should unbind if they bound it.

    if (extractSingleComponent) {
        const singleComponentData = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            singleComponentData[i] = pixelDataRGBA[i * 4 + 0]; // Extract Red component
        }
        return singleComponentData;
    } else {
        return pixelDataRGBA;
    }
}

/**
 * Returns a human-readable string for a WebGL framebuffer status code.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {GLenum} status The framebuffer status code.
 * @returns {string} Human-readable string for the status.
 */
export function getFramebufferStatusString(gl, status) {
    if (!gl) return "WebGL context not available to interpret framebuffer status.";
    // Check if gl constants are available before using them
    // Destructuring gl constants like this is fine as long as gl is a valid context.
    const {
        FRAMEBUFFER_COMPLETE,
        FRAMEBUFFER_INCOMPLETE_ATTACHMENT,
        FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT,
        FRAMEBUFFER_INCOMPLETE_DIMENSIONS,
        FRAMEBUFFER_UNSUPPORTED,
        FRAMEBUFFER_INCOMPLETE_MULTISAMPLE // WebGL2
    } = gl;

    switch (status) {
        case FRAMEBUFFER_COMPLETE: // Equivalent to gl.FRAMEBUFFER_COMPLETE if gl is valid
            return "FRAMEBUFFER_COMPLETE";
        case FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
            return "FRAMEBUFFER_INCOMPLETE_ATTACHMENT";
        case FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
            return "FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT";
        case FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
            return "FRAMEBUFFER_INCOMPLETE_DIMENSIONS";
        case FRAMEBUFFER_UNSUPPORTED:
            return "FRAMEBUFFER_UNSUPPORTED";
        case FRAMEBUFFER_INCOMPLETE_MULTISAMPLE: // WebGL2 specific
             return "FRAMEBUFFER_INCOMPLETE_MULTISAMPLE (WebGL2)";
        default:
            return `Unknown framebuffer status: 0x${status.toString(16)}`;
    }
}
