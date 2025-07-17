/**
 * GPU Resource Manager - Efficient caching and reuse of WebGL resources
 * Optimizes BigInt GPU calculations by maintaining resource pools
 */

import * as webglUtilsModule from './webgl-utils.js';
import { PerformanceMonitor } from './performance-monitor.js';

class GPUResourceManager {
    constructor() {
        this.contexts = new Map(); // Canvas -> WebGL context cache
        this.shaderCache = new Map(); // Shader source -> compiled shader cache
        this.programCache = new Map(); // Program signature -> linked program cache
        this.texturePool = new Map(); // Size -> texture pool cache
        this.framebufferPool = new Map(); // Size -> framebuffer pool cache
        this.bufferPool = new Map(); // Type -> buffer pool cache
        this.capabilities = new Map(); // Context -> capabilities cache
        this.stats = {
            shaderCacheHits: 0,
            shaderCacheMisses: 0,
            programCacheHits: 0,
            programCacheMisses: 0,
            textureCacheHits: 0,
            textureCacheMisses: 0,
            framebufferCacheHits: 0,
            framebufferCacheMisses: 0
        };
        this.perfMonitor = PerformanceMonitor;
    }

    /**
     * Get or create a cached WebGL context with capabilities
     */
    getContext(canvas) {
        if (!canvas) return null;

        // Check cache first
        if (this.contexts.has(canvas)) {
            const cached = this.contexts.get(canvas);
            if (cached.gl && !cached.gl.isContextLost()) {
                return cached;
            }
            // Context lost, remove from cache
            this.contexts.delete(canvas);
        }

        try {
            const gl = webglUtilsModule.initWebGL(canvas);
            if (!gl) return null;

            const capabilities = this._detectCapabilities(gl);
            const contextInfo = { gl, capabilities };
            
            this.contexts.set(canvas, contextInfo);
            this.perfMonitor.recordGpuMetric('contextCreations');
            return contextInfo;
        } catch (error) {
            console.warn(`[GPUResourceManager] Failed to initialize WebGL context: ${error.message}`);
            return null;
        }
    }

    /**
     * Detect and cache WebGL capabilities
     */
    _detectCapabilities(gl) {
        const key = gl;
        if (this.capabilities.has(key)) {
            return this.capabilities.get(key);
        }

        const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
        
        const capabilities = {
            isWebGL2,
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
            maxFragmentUniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
            maxVertexUniforms: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
            supportsFloatTextures: false,
            supportsFloatRendering: false
        };

        try {
            if (isWebGL2) {
                capabilities.supportsFloatTextures = true;
                capabilities.supportsFloatRendering = !!gl.getExtension('EXT_color_buffer_float');
            } else {
                capabilities.supportsFloatTextures = !!gl.getExtension('OES_texture_float');
                capabilities.supportsFloatRendering = !!gl.getExtension('WEBGL_color_buffer_float');
            }
        } catch (e) {
            console.warn('[GPUResourceManager] Error detecting float texture capabilities:', e.message);
        }

        this.capabilities.set(key, capabilities);
        return capabilities;
    }

    /**
     * Get or create a cached shader
     */
    getShader(gl, type, source) {
        const key = `${type}_${source}`;
        
        if (this.shaderCache.has(key)) {
            this.stats.shaderCacheHits++;
            this.perfMonitor.recordCacheMetric('hits');
            return this.shaderCache.get(key);
        }

        this.stats.shaderCacheMisses++;
        this.perfMonitor.recordCacheMetric('misses');
        this.perfMonitor.recordGpuMetric('shaderCompilations');
        
        const shader = webglUtilsModule.createShader(gl, type, source);
        
        if (shader) {
            this.shaderCache.set(key, shader);
        }
        
        return shader;
    }

    /**
     * Get or create a cached shader program
     */
    getProgram(gl, vertexShaderSource, fragmentShaderSource) {
        const key = `${vertexShaderSource}_${fragmentShaderSource}`;
        
        if (this.programCache.has(key)) {
            this.stats.programCacheHits++;
            this.perfMonitor.recordCacheMetric('hits');
            return this.programCache.get(key);
        }

        this.stats.programCacheMisses++;
        this.perfMonitor.recordCacheMetric('misses');
        
        const vs = this.getShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
        const fs = this.getShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
        
        if (!vs || !fs) return null;

        const program = webglUtilsModule.createProgram(gl, vs, fs);
        
        if (program) {
            this.programCache.set(key, program);
        }
        
        return program;
    }

    /**
     * Get a texture from the pool or create a new one
     */
    getTexture(gl, width, height, useRGBA = false) {
        const key = `${width}x${height}_${useRGBA}`;
        
        if (!this.texturePool.has(key)) {
            this.texturePool.set(key, []);
        }
        
        const pool = this.texturePool.get(key);
        
        if (pool.length > 0) {
            this.stats.textureCacheHits++;
            this.perfMonitor.recordCacheMetric('hits');
            return pool.pop();
        }

        this.stats.textureCacheMisses++;
        this.perfMonitor.recordCacheMetric('misses');
        this.perfMonitor.recordGpuMetric('textureCreations');
        
        return webglUtilsModule.createDataTexture(gl, null, width, height, useRGBA);
    }

    /**
     * Return a texture to the pool for reuse
     */
    returnTexture(gl, texture, width, height, useRGBA = false) {
        if (!texture) return;

        const key = `${width}x${height}_${useRGBA}`;
        
        if (!this.texturePool.has(key)) {
            this.texturePool.set(key, []);
        }
        
        const pool = this.texturePool.get(key);
        
        // Limit pool size to prevent memory bloat
        if (pool.length < 10) {
            pool.push(texture);
        } else {
            gl.deleteTexture(texture);
        }
    }

    /**
     * Get a framebuffer from the pool or create a new one
     */
    getFramebuffer(gl, width, height) {
        const key = `${width}x${height}`;
        
        if (!this.framebufferPool.has(key)) {
            this.framebufferPool.set(key, []);
        }
        
        const pool = this.framebufferPool.get(key);
        
        if (pool.length > 0) {
            this.stats.framebufferCacheHits++;
            this.perfMonitor.recordCacheMetric('hits');
            return pool.pop();
        }

        this.stats.framebufferCacheMisses++;
        this.perfMonitor.recordCacheMetric('misses');
        this.perfMonitor.recordGpuMetric('framebufferCreations');
        
        return gl.createFramebuffer();
    }

    /**
     * Return a framebuffer to the pool for reuse
     */
    returnFramebuffer(gl, framebuffer, width, height) {
        if (!framebuffer) return;

        const key = `${width}x${height}`;
        
        if (!this.framebufferPool.has(key)) {
            this.framebufferPool.set(key, []);
        }
        
        const pool = this.framebufferPool.get(key);
        
        // Limit pool size to prevent memory bloat
        if (pool.length < 5) {
            pool.push(framebuffer);
        } else {
            gl.deleteFramebuffer(framebuffer);
        }
    }

    /**
     * Get a buffer from the pool or create a new one
     */
    getBuffer(gl, type = 'vertex') {
        if (!this.bufferPool.has(type)) {
            this.bufferPool.set(type, []);
        }
        
        const pool = this.bufferPool.get(type);
        
        if (pool.length > 0) {
            return pool.pop();
        }

        return gl.createBuffer();
    }

    /**
     * Return a buffer to the pool for reuse
     */
    returnBuffer(gl, buffer, type = 'vertex') {
        if (!buffer) return;

        if (!this.bufferPool.has(type)) {
            this.bufferPool.set(type, []);
        }
        
        const pool = this.bufferPool.get(type);
        
        // Limit pool size to prevent memory bloat
        if (pool.length < 10) {
            pool.push(buffer);
        } else {
            gl.deleteBuffer(buffer);
        }
    }

    /**
     * Optimized texture data upload
     */
    uploadTextureData(gl, texture, data, width, height, useRGBA = false) {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        
        let texelData = null;
        const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
        
        let internalFormat, format, type;
        
        if (isWebGL2) {
            internalFormat = gl.RGBA32F;
            format = gl.RGBA;
            type = gl.FLOAT;
        } else {
            internalFormat = gl.RGBA;
            format = gl.RGBA;
            type = gl.FLOAT;
        }

        if (data) {
            if (useRGBA) {
                texelData = data;
            } else {
                // Pack single component data into RGBA
                texelData = new Float32Array(width * height * 4);
                for (let i = 0; i < width * height; i++) {
                    texelData[i * 4 + 0] = data[i];
                    texelData[i * 4 + 1] = 0.0;
                    texelData[i * 4 + 2] = 0.0;
                    texelData[i * 4 + 3] = 1.0;
                }
            }
        }

        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, texelData);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    /**
     * Setup standard vertex attributes efficiently
     */
    setupVertexAttributes(gl, program, positionBuffer, texCoordBuffer) {
        const positionAttributeLocation = gl.getAttribLocation(program, "a_position");
        const texCoordAttributeLocation = gl.getAttribLocation(program, "a_texCoord");

        // Position attribute
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
        if (positionAttributeLocation !== -1) {
            gl.enableVertexAttribArray(positionAttributeLocation);
            gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
        }

        // Texture coordinate attribute
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
        if (texCoordAttributeLocation !== -1) {
            gl.enableVertexAttribArray(texCoordAttributeLocation);
            gl.vertexAttribPointer(texCoordAttributeLocation, 2, gl.FLOAT, false, 0, 0);
        }
    }

    /**
     * Optimized framebuffer setup
     */
    setupFramebuffer(gl, framebuffer, texture) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error(`WEBGL_FRAMEBUFFER_ERROR: Framebuffer incomplete. Status: ${webglUtilsModule.getFramebufferStatusString(gl, status)}`);
        }
        
        return framebuffer;
    }

    /**
     * Batch uniform setup for common operations
     */
    setupUniforms(gl, program, uniforms) {
        gl.useProgram(program);
        
        for (const [name, value] of Object.entries(uniforms)) {
            const location = gl.getUniformLocation(program, name);
            if (location !== null) {
                if (typeof value === 'number') {
                    gl.uniform1f(location, value);
                } else if (typeof value === 'boolean') {
                    gl.uniform1i(location, value ? 1 : 0);
                } else if (Array.isArray(value)) {
                    switch (value.length) {
                        case 2: gl.uniform2fv(location, value); break;
                        case 3: gl.uniform3fv(location, value); break;
                        case 4: gl.uniform4fv(location, value); break;
                        default: gl.uniform1fv(location, value);
                    }
                }
            }
        }
    }

    /**
     * Efficient texture binding with automatic unit assignment
     */
    bindTextures(gl, program, textures) {
        let textureUnit = 0;
        
        for (const [uniformName, texture] of Object.entries(textures)) {
            if (texture) {
                gl.activeTexture(gl.TEXTURE0 + textureUnit);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                
                const location = gl.getUniformLocation(program, uniformName);
                if (location !== null) {
                    gl.uniform1i(location, textureUnit);
                }
                
                textureUnit++;
            }
        }
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            ...this.stats,
            contextsCached: this.contexts.size,
            shadersCached: this.shaderCache.size,
            programsCached: this.programCache.size,
            texturePoolSizes: Array.from(this.texturePool.entries()).map(([key, pool]) => ({
                size: key,
                available: pool.length
            })),
            framebufferPoolSizes: Array.from(this.framebufferPool.entries()).map(([key, pool]) => ({
                size: key,
                available: pool.length
            }))
        };
    }

    /**
     * Clear all caches and pools
     */
    clearAll() {
        // Clear shader cache
        for (const shader of this.shaderCache.values()) {
            // Note: We can't delete shaders here as they might be in use by programs
        }
        this.shaderCache.clear();

        // Clear program cache
        for (const program of this.programCache.values()) {
            // Note: We can't delete programs here as they might be in use
        }
        this.programCache.clear();

        // Clear texture pools
        for (const [key, pool] of this.texturePool.entries()) {
            // Note: We can't delete textures here without GL context
            pool.length = 0;
        }
        this.texturePool.clear();

        // Clear framebuffer pools
        for (const [key, pool] of this.framebufferPool.entries()) {
            // Note: We can't delete framebuffers here without GL context
            pool.length = 0;
        }
        this.framebufferPool.clear();

        // Clear buffer pools
        for (const [key, pool] of this.bufferPool.entries()) {
            // Note: We can't delete buffers here without GL context
            pool.length = 0;
        }
        this.bufferPool.clear();

        // Reset stats
        this.stats = {
            shaderCacheHits: 0,
            shaderCacheMisses: 0,
            programCacheHits: 0,
            programCacheMisses: 0,
            textureCacheHits: 0,
            textureCacheMisses: 0,
            framebufferCacheHits: 0,
            framebufferCacheMisses: 0
        };
    }
}

// Global instance
const resourceManager = new GPUResourceManager();

export { resourceManager as GPUResourceManager };
