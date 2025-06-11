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
    // Attempt to enable WEBGL_color_buffer_float, often needed with OES_texture_float
    const colorBufferFloatExt = gl.getExtension('WEBGL_color_buffer_float');
    if (!colorBufferFloatExt) {
        console.warn("WEBGL_color_buffer_float extension not available. Rendering to float textures might not be fully supported or could be slow.");
    }
    // console.log("WebGL context obtained."); // Removed
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
        console.error('OES_texture_float extension not supported.');
        // It's often better to throw an error or let the app handle this,
        // but alert was in the original code. For now, keep or remove based on desired behavior.
        // Consider removing alert for a library function.
        // alert('OES_texture_float extension not supported. This is required for GPGPU tasks.');
        return null;
    }

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    let texelData = null; // Initialize texelData to null

    if (dataArray) { // Only process dataArray if it's not null
        if (useRGBA) {
            texelData = dataArray; // Assume dataArray is already correctly formatted Float32Array
            if (dataArray.length !== width * height * 4) {
                // This warning is still relevant if dataArray is provided but mismatched
                console.warn("Data array length does not match width*height*4 for RGBA texture when dataArray is provided.");
            }
        } else {
            // Data is single component, pack it into the Red channel of an RGBA texture.
            texelData = new Float32Array(width * height * 4);
            for (let i = 0; i < width * height; i++) {
                if (i < dataArray.length) { // Check bounds in case dataArray is shorter than expected
                    texelData[i * 4 + 0] = dataArray[i]; // Store in Red channel
                } else {
                    texelData[i * 4 + 0] = 0.0; // Pad with 0 if dataArray is too short
                }
                texelData[i * 4 + 1] = 0.0;          // Green
                texelData[i * 4 + 2] = 0.0;          // Blue
                texelData[i * 4 + 3] = 1.0;          // Alpha (fully opaque)
            }
        }
    }
    // If dataArray was null, texelData remains null.
    // gl.texImage2D can accept null for the data argument to allocate texture memory without initial data.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, texelData);

    gl.bindTexture(gl.TEXTURE_2D, null); // Unbind
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

    // Store the current FBO to restore it later
    const previousFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);

    if (framebuffer) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    } else {
        // If framebuffer is null, it implies reading from the default draw framebuffer.
        // However, for GPGPU, an explicit FBO with a float texture is usually needed.
        // This path might still lead to format mismatch errors if the default FB is RGBA8.
        // The caller (e.g., bigint.js) should ideally always provide the correct FBO.
        console.warn("readDataFromTexture: Reading from default framebuffer (framebuffer is null). Ensure this is intended and the format matches.");
    }

    const pixelDataRGBA = new Float32Array(width * height * 4); // RGBA
    try {
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixelDataRGBA);
    } catch (e) {
        console.error("Error during gl.readPixels:", e);
        // Restore FBO before returning null
        if (framebuffer) { // Only restore if we changed it.
             gl.bindFramebuffer(gl.FRAMEBUFFER, previousFBO);
        }
        return null;
    }

    // Restore the previous FBO
    if (framebuffer) { // Only restore if we changed it.
        gl.bindFramebuffer(gl.FRAMEBUFFER, previousFBO);
    }

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
 * Sets up a simple quad for GPGPU operations.
 * Creates a vertex buffer for a fullscreen quad and sets up the 'a_position' attribute.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {WebGLProgram} program The shader program (must have 'a_position' attribute).
 * @returns {WebGLBuffer | null} The vertex buffer or null on failure.
 */
export function setupGpgpuQuad(gl, program) {
    if (!gl || !program) {
        console.error("setupGpgpuQuad: gl or program is null.");
        return null;
    }

    const positionAttributeLocation = gl.getAttribLocation(program, "a_position");
    if (positionAttributeLocation < 0) {
        console.error("setupGpgpuQuad: Attribute 'a_position' not found in shader program.");
        // Not returning null here as buffer creation can proceed, but it won't be usable.
        // Caller should check if rendering works.
    }

    // Buffer for a fullscreen quad (2 triangles)
    const positions = new Float32Array([
        -1.0, -1.0,  // Triangle 1
         1.0, -1.0,
        -1.0,  1.0,
        -1.0,  1.0,  // Triangle 2
         1.0, -1.0,
         1.0,  1.0,
    ]);

    const positionBuffer = gl.createBuffer();
    if (!positionBuffer) {
        console.error("setupGpgpuQuad: Failed to create position buffer.");
        return null;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    // Setup the vertex attribute pointer
    // This part should typically be done right before gl.drawArrays,
    // but the buffer itself can be created and data set here.
    // For simplicity in this utility, we'll do it here if location is valid.
    if (positionAttributeLocation >= 0) {
        gl.enableVertexAttribArray(positionAttributeLocation);
        // Bind the position buffer before setting the pointer
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(
            positionAttributeLocation, // Attribute location
            2,                         // Number of components per attribute (x, y)
            gl.FLOAT,                  // Type of data
            false,                     // Normalize
            0,                         // Stride (0 = auto)
            0                          // Offset (0 = auto)
        );
    }

    // Texture Coordinates
    const texCoordAttributeLocation = gl.getAttribLocation(program, "a_texCoord");
    if (texCoordAttributeLocation < 0) {
        console.warn("setupGpgpuQuad: Attribute 'a_texCoord' not found in shader program. Texture mapping may not work.");
    }

    const texCoords = new Float32Array([
        0.0, 0.0, // Tex coord for -1,-1
        1.0, 0.0, // Tex coord for  1,-1
        0.0, 1.0, // Tex coord for -1, 1
        0.0, 1.0, // Tex coord for -1, 1
        1.0, 0.0, // Tex coord for  1,-1
        1.0, 1.0, // Tex coord for  1, 1
    ]);
    const texCoordBuffer = gl.createBuffer();
    if (!texCoordBuffer) {
        console.error("setupGpgpuQuad: Failed to create texture coordinate buffer.");
        // positionBuffer might still be valid, but setup is incomplete.
        // Consider how to handle partial failure; for now, continue and it might mostly work if texCoords aren't strictly needed by a shader.
    } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
        if (texCoordAttributeLocation >= 0) {
            gl.enableVertexAttribArray(texCoordAttributeLocation);
            gl.vertexAttribPointer(
                texCoordAttributeLocation,
                2,          // Number of components
                gl.FLOAT,
                false,
                0,
                0
            );
        }
    }

    // Unbind buffer (good practice, though not strictly necessary here as it's used immediately or soon after)
    // gl.bindBuffer(gl.ARRAY_BUFFER, null); // Let the caller manage binding state for drawing if preferred

    // Return an object containing buffers if they need to be managed/deleted by caller
    // For now, just returning the positionBuffer as before, assuming caller might only manage that one,
    // or that these buffers are short-lived with the quad setup.
    // A more robust solution might involve a VAO or returning all created resources.
    return positionBuffer;
}
