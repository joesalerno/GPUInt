// test/webgl-test-utils.js
const getHeadlessGLContext = (width, height, options) => {
    try {
        const gl = require('gl')(width, height, options || { preserveDrawingBuffer: true });
        if (!gl) {
            throw new Error('Failed to create headless-gl context: require("gl") returned null/undefined.');
        }

        // headless-gl might not have getExtension as a bound function on the context directly
        // or might require explicit enabling for some extensions.
        // For OES_texture_float, it's usually available if underlying drivers support it.
        // We can attempt to get it and log.
        const oesTextureFloat = gl.getExtension('OES_texture_float');
        if (!oesTextureFloat) {
            console.warn('headless-gl: OES_texture_float extension not available. Floating point textures might not work.');
        }

        // Add a mock getContext method to the gl instance if our library expects it
        // on a canvas-like object. However, our webgl-utils.js initWebGL takes a canvas.
        // So, we'll create a mock canvas that returns this gl.

        return gl;
    } catch (e) {
        console.error('Error creating headless-gl context:', e);
        // Log additional info if it's related to Xvfb or Mesa for headless environments
        if (process.platform === 'linux') {
            console.warn(
                'On Linux, ensure Xvfb and Mesa drivers are correctly installed and configured ' +
                'if you encounter issues creating a headless WebGL context. ' +
                'Try running tests with xvfb-run.'
            );
        }
        throw e; // Re-throw the error so tests know context creation failed
    }
};

const createMockCanvas = (width = 1, height = 1, glContext = null) => {
    let currentGL = glContext;
    return {
        width: width,
        height: height,
        getContext: (contextType, contextAttributes) => {
            if (contextType === 'webgl' || contextType === 'experimental-webgl') {
                if (!currentGL) { // If no GL context was provided, try to create one
                    currentGL = getHeadlessGLContext(width, height, contextAttributes);
                }
                return currentGL;
            }
            return null;
        },
        // Add other canvas properties/methods if needed by the library, e.g., for resizing
        // For now, getContext is the most crucial.
    };
};

module.exports = {
    getHeadlessGLContext,
    createMockCanvas,
};
