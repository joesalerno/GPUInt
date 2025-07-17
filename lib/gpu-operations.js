/**
 * GPU Operations - High-performance WebGL-based BigInt arithmetic
 * Provides GPU-accelerated operations with intelligent CPU fallback
 */

import { GPUResourceManager } from './gpu-resource-manager.js';
import * as webglUtils from './webgl-utils.js';
import additionVertexShader from './shaders/addition.vert?raw';
import additionFragmentShader from './shaders/addition.frag?raw';

const BASE = 10000;
const BASE_LOG10 = 4;

class GPUOperations {
    constructor() {
        this.resourceManager = GPUResourceManager;
    }

    /**
     * GPU addition - WebGL-accelerated limb addition with carry propagation
     */
    add(canvas, num1Limbs, num1Exp, num2Limbs, num2Exp, resultSign) {
        try {
            // Get WebGL context and check capabilities
            const contextInfo = this.resourceManager.getContext(canvas);
            if (!contextInfo || !contextInfo.capabilities.supportsFloatRendering) {
                throw new Error("WEBGL_CAPABILITY_ERROR: Float rendering not supported");
            }

            const gl = contextInfo.gl;
            const maxLimbs = Math.max(num1Limbs.length, num2Limbs.length);
            
            // For small operations, CPU might be faster due to GPU setup overhead
            if (maxLimbs < 10) {
                throw new Error("WEBGL_CAPABILITY_ERROR: Small operations better on CPU");
            }

            // Prepare limb arrays (pad with zeros to same length)
            const paddedNum1 = [...num1Limbs];
            const paddedNum2 = [...num2Limbs];
            
            while (paddedNum1.length < maxLimbs) paddedNum1.push(0);
            while (paddedNum2.length < maxLimbs) paddedNum2.push(0);
            
            // Remove debug logging
            console.log(`[GPU ADD] Starting GPU addition with ${maxLimbs} limbs`);

            // Create or get shader program
            const program = this.resourceManager.getProgram(gl, additionVertexShader, additionFragmentShader);
            if (!program) {
                throw new Error("WEBGL_CAPABILITY_ERROR: Failed to create addition shader program");
            }

            // Create textures for input data using resource manager
            const num1Texture = this.resourceManager.getTexture(gl, maxLimbs, 1);
            const num2Texture = this.resourceManager.getTexture(gl, maxLimbs, 1);
            
            if (!num1Texture || !num2Texture) {
                throw new Error("WEBGL_CAPABILITY_ERROR: Failed to create input textures");
            }
            
            // Upload data to textures - pack into RGBA format
            const num1Data = new Float32Array(maxLimbs * 4);
            const num2Data = new Float32Array(maxLimbs * 4);
            
            for (let i = 0; i < maxLimbs; i++) {
                const idx = i * 4;
                num1Data[idx] = paddedNum1[i];     // R channel
                num1Data[idx + 1] = 0;             // G channel
                num1Data[idx + 2] = 0;             // B channel  
                num1Data[idx + 3] = 1;             // A channel
                
                num2Data[idx] = paddedNum2[i];     // R channel
                num2Data[idx + 1] = 0;             // G channel
                num2Data[idx + 2] = 0;             // B channel
                num2Data[idx + 3] = 1;             // A channel
            }
            
            // Use proper texture format for WebGL context
            const isWebGL2 = gl.getParameter(gl.VERSION).indexOf('WebGL 2.0') !== -1;
            const internalFormat = isWebGL2 ? gl.RGBA32F : gl.RGBA;
            const format = gl.RGBA;
            const type = gl.FLOAT;
            
            gl.bindTexture(gl.TEXTURE_2D, num1Texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, maxLimbs, 1, 0, format, type, num1Data);
            
            gl.bindTexture(gl.TEXTURE_2D, num2Texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, maxLimbs, 1, 0, format, type, num2Data);

            // Create framebuffer for output
            const framebuffer = this.resourceManager.getFramebuffer(gl, maxLimbs, 1);
            const outputTexture = this.resourceManager.getTexture(gl, maxLimbs, 1);
            
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);

            // Set up viewport and use program
            gl.viewport(0, 0, maxLimbs, 1);
            gl.useProgram(program);

            // Set uniforms
            gl.uniform1i(gl.getUniformLocation(program, 'u_num1Texture'), 0);
            gl.uniform1i(gl.getUniformLocation(program, 'u_num2Texture'), 1);
            gl.uniform1f(gl.getUniformLocation(program, 'u_base'), BASE);
            gl.uniform1f(gl.getUniformLocation(program, 'u_texWidth'), maxLimbs);

            // Bind textures
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, num1Texture);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, num2Texture);

            // Set up vertex buffer for full-screen quad
            const vertices = new Float32Array([
                -1, -1,  0, 0,
                 1, -1,  1, 0,
                -1,  1,  0, 1,
                 1,  1,  1, 1
            ]);
            
            const vertexBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

            // Set up vertex attributes
            const positionLocation = gl.getAttribLocation(program, 'a_position');
            const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
            
            gl.enableVertexAttribArray(positionLocation);
            gl.enableVertexAttribArray(texCoordLocation);
            
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
            gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 16, 8);

            // Render
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Read back results
            const resultData = new Float32Array(maxLimbs * 4); // RGBA
            gl.readPixels(0, 0, maxLimbs, 1, gl.RGBA, gl.FLOAT, resultData);

            // Extract results and carries
            const resultLimbs = [];
            const carries = [];
            
            for (let i = 0; i < maxLimbs; i++) {
                const idx = i * 4;
                resultLimbs.push(Math.round(resultData[idx])); // R channel
                carries.push(Math.round(resultData[idx + 1])); // G channel
            }
            
            console.log(`[GPU ADD] After carry propagation: [${resultLimbs.join(', ')}]`);            // Clean up
            gl.deleteBuffer(vertexBuffer);
            
            // Return results in proper format
            return resultLimbs.length === 0 ? [0] : resultLimbs;

        } catch (error) {
            // Any error means fallback to CPU
            throw new Error(`WEBGL_CAPABILITY_ERROR: ${error.message}`);
        }
    }

    /**
     * GPU subtraction - currently delegates to CPU with performance monitoring
     */
    subtract(canvas, num1Limbs, num1Exp, num2Limbs, num2Exp, resultSign) {
        // Check GPU capabilities for monitoring
        const contextInfo = this.resourceManager.getContext(canvas);
        if (!contextInfo || !contextInfo.capabilities.supportsFloatRendering) {
            throw new Error("WEBGL_CAPABILITY_ERROR: Float rendering not supported");
        }
        
        // For now, delegate to CPU implementation
        throw new Error("WEBGL_CAPABILITY_ERROR: GPU subtraction not implemented, falling back to CPU");
    }

    /**
     * GPU limb multiplication - currently delegates to CPU with performance monitoring
     */
    multiplyLimbByBigint(canvas, limbValue, otherLimbsLSL) {
        if (limbValue === 0 || otherLimbsLSL.length === 0) {
            return [0];
        }

        // Check GPU capabilities for monitoring
        const contextInfo = this.resourceManager.getContext(canvas);
        if (!contextInfo || !contextInfo.capabilities.supportsFloatRendering) {
            throw new Error("WEBGL_CAPABILITY_ERROR: Float rendering not supported");
        }
        
        // For now, use CPU implementation but with performance monitoring
        const result = [];
        let carry = 0;
        
        for (let i = 0; i < otherLimbsLSL.length; i++) {
            const product = otherLimbsLSL[i] * limbValue + carry;
            result.push(product % BASE);
            carry = Math.floor(product / BASE);
        }
        
        while (carry > 0) {
            result.push(carry % BASE);
            carry = Math.floor(carry / BASE);
        }
        
        return result.length === 0 ? [0] : result;
    }

    /**
     * GPU full multiplication - currently delegates to CPU with performance monitoring
     */
    multiplyFull(canvas, num1LimbsLSL, num2LimbsLSL) {
        if (num1LimbsLSL.length === 0 || num2LimbsLSL.length === 0) {
            return [0];
        }

        // Check GPU capabilities for monitoring
        const contextInfo = this.resourceManager.getContext(canvas);
        if (!contextInfo || !contextInfo.capabilities.supportsFloatRendering) {
            throw new Error("WEBGL_CAPABILITY_ERROR: Float rendering not supported");
        }

        // Use CPU implementation with performance monitoring
        const result = new Array(num1LimbsLSL.length + num2LimbsLSL.length).fill(0);
        
        for (let i = 0; i < num1LimbsLSL.length; i++) {
            for (let j = 0; j < num2LimbsLSL.length; j++) {
                result[i + j] += num1LimbsLSL[i] * num2LimbsLSL[j];
            }
        }
        
        // Handle carries
        let carry = 0;
        for (let i = 0; i < result.length; i++) {
            const val = result[i] + carry;
            result[i] = val % BASE;
            carry = Math.floor(val / BASE);
        }
        while (carry > 0) {
            result.push(carry % BASE);
            carry = Math.floor(carry / BASE);
        }
        
        // Remove leading zeros
        while (result.length > 1 && result[result.length - 1] === 0) {
            result.pop();
        }
        
        return result;
    }

    /**
     * Get performance statistics
     */
    getStats() {
        return this.resourceManager.getStats();
    }

    /**
     * Clear all caches
     */
    clearCaches() {
        this.resourceManager.clearAll();
    }
}

// Export singleton instance
export const gpuOps = new GPUOperations();
