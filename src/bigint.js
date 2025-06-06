// WebGL utilities and shader sources are expected to be globally available via
// window.webglUtils, window.vertexShaderSrc, and window.fragmentShaderSrc
// as set up by the HTML page.

const BASE = 10000;
const BASE_LOG10 = 4; // log10(BASE)

/**
 * @class BigIntPrimitive
 * @description Represents a large integer, potentially using WebGL for operations.
 */
class BigIntPrimitive {
  /**
   * Creates an instance of BigIntPrimitive.
   * @param {string | number} value The initial value. Can be a string of digits or a number.
   * @param {HTMLCanvasElement} [canvas] Optional canvas element for WebGL operations.
   * @throws {TypeError} If the input string is not a valid representation of an integer or input type is wrong.
   */
  constructor(value, canvas) {
    this.limbs = [];
    this.sign = 1; // Assume positive for now
    this.canvas = canvas; // Store the canvas for WebGL operations

    let stringValue = '';

    if (typeof value === 'number') {
      if (!Number.isInteger(value)) {
        throw new TypeError("Numeric input must be an integer.");
      }
      stringValue = String(value);
    } else if (typeof value === 'string') {
      stringValue = value.trim();
      if (!/^\d+$/.test(stringValue) && stringValue !== "") {
        throw new TypeError("Invalid BigInt string format: contains non-digits.");
      }
    } else {
      throw new TypeError("Invalid input type for BigIntPrimitive. Expected string or number.");
    }

    if (stringValue === "" || stringValue === "0") {
      this.limbs = [0];
    } else {
      for (let i = stringValue.length; i > 0; i -= BASE_LOG10) {
        const start = Math.max(0, i - BASE_LOG10);
        this.limbs.push(Number(stringValue.substring(start, i)));
      }
      // Normalize limbs: remove leading zeros represented as trailing zero limbs
      // e.g., if limbs is [123, 0] (from "00123"), it becomes [123]
      // e.g., if limbs is [0, 0] (from "0000"), it should become [0] but this is handled by the stringValue === "0" check.
      // This primarily handles cases like "00789" -> [789, 0] -> [789]
      while (this.limbs.length > 1 && this.limbs[this.limbs.length - 1] === 0) {
          this.limbs.pop();
      }
    }
  }

  /**
   * Returns the string representation of the BigIntPrimitive.
   * @returns {string} The string representation.
   */
  toString() {
    if (this.isZero()) {
      return "0";
    }
    let s = "";
    // Build string from least significant limb to most significant
    for (let i = 0; i < this.limbs.length; i++) {
      let limbStr = String(this.limbs[i]);
      if (i < this.limbs.length - 1) { // Pad if not the most significant limb
        limbStr = limbStr.padStart(BASE_LOG10, '0');
      }
      s = limbStr + s;
    }
    return (this.sign === -1 ? "-" : "") + s;
  }

  /**
   * Checks if the BigIntPrimitive is zero.
   * @returns {boolean} True if the value is zero, false otherwise.
   */
  isZero() {
    return this.limbs.length === 1 && this.limbs[0] === 0;
  }

  /**
   * Adds another BigIntPrimitive to this one using WebGL for computation.
   * For now, assumes both are positive.
   * @param {BigIntPrimitive} otherBigInt The BigIntPrimitive to add.
   * @returns {BigIntPrimitive | null} A new BigIntPrimitive representing the sum, or null on WebGL error.
   * @throws {TypeError} If otherBigInt is not an instance of BigIntPrimitive.
   */
  add(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    if (!this.canvas) {
        console.error("BigIntPrimitive.add: Canvas element not provided to constructor. WebGL operations require a canvas.");
        return null;
    }
    // TODO: Sign handling

    const webglUtils = (typeof window !== 'undefined' && window.webglUtils) ? window.webglUtils : null;
    const vsSource = (typeof window !== 'undefined' && window.vertexShaderSrc) ? window.vertexShaderSrc : null;
    const fsSource = (typeof window !== 'undefined' && window.fragmentShaderSrc) ? window.fragmentShaderSrc : null;

    if (!webglUtils) {
        console.error("BigIntPrimitive.add: WebGL utilities not found (window.webglUtils is undefined). Cannot proceed with WebGL operations.");
        return null;
    }
    // Note: vsSource and fsSource being null is checked later, after gl context is obtained.

    const gl = webglUtils.initWebGL(this.canvas);
    if (!gl) {
      console.error("Failed to initialize WebGL context (returned by webglUtils.initWebGL).");
      return null;
    }

    if (!vsSource || !fsSource) {
        console.error("Shader sources not found on window object (vertexShaderSrc or fragmentShaderSrc is undefined).");
        return null;
    }

    const vertexShader = webglUtils.createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = webglUtils.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const program = webglUtils.createProgram(gl, vertexShader, fragmentShader);

    if (!program) {
      console.error("Failed to create shader program.");
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
      return null;
    }

    const maxLength = Math.max(this.limbs.length, otherBigInt.limbs.length);
    const texWidth = maxLength;
    const texHeight = 1;

    const num1LimbsData = new Float32Array(maxLength);
    const num2LimbsData = new Float32Array(maxLength);
    const carryInLimbsData = new Float32Array(maxLength); // All zeros

    for (let i = 0; i < maxLength; i++) {
      num1LimbsData[i] = this.limbs[i] || 0;
      num2LimbsData[i] = otherBigInt.limbs[i] || 0;
      carryInLimbsData[i] = 0;
    }

    const texNum1 = window.webglUtils.createDataTexture(gl, num1LimbsData, texWidth, texHeight, false);
    const texNum2 = window.webglUtils.createDataTexture(gl, num2LimbsData, texWidth, texHeight, false);
    const texCarryIn = window.webglUtils.createDataTexture(gl, carryInLimbsData, texWidth, texHeight, false);

    // Create an empty RGBA texture for the output
    // Data is passed as null, but dimensions are set. useRGBA = true because we'll read RGBA.
    const texOutput = window.webglUtils.createDataTexture(gl, new Float32Array(texWidth * texHeight * 4), texWidth, texHeight, true);


    if (!texNum1 || !texNum2 || !texCarryIn || !texOutput) {
        console.error("Failed to create one or more data textures.");
        // Partial cleanup
        if (texNum1) gl.deleteTexture(texNum1);
        if (texNum2) gl.deleteTexture(texNum2);
        if (texCarryIn) gl.deleteTexture(texCarryIn);
        if (texOutput) gl.deleteTexture(texOutput);
        gl.deleteProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        return null;
    }

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);

    const fboStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (fboStatus !== gl.FRAMEBUFFER_COMPLETE) {
      console.error("Framebuffer incomplete: " + fboStatus);
      gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
      gl.deleteFramebuffer(fbo);
      gl.deleteProgram(program); gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader);
      return null;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Unbind for now

    const quadVertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    gl.viewport(0, 0, texWidth, texHeight);
    gl.useProgram(program);

    const aPositionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(aPositionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer); // Rebind vertexBuffer before vertexAttribPointer
    gl.vertexAttribPointer(aPositionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texNum1);
    gl.uniform1i(gl.getUniformLocation(program, "u_num1Texture"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNum2);
    gl.uniform1i(gl.getUniformLocation(program, "u_num2Texture"), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texCarryIn);
    gl.uniform1i(gl.getUniformLocation(program, "u_carryTexture"), 2);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Read back results
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); // Bind FBO to read from it
    const outputPixelDataRGBA = window.webglUtils.readDataFromTexture(gl, fbo, texWidth, texHeight, false); // Get full RGBA
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (!outputPixelDataRGBA) {
        console.error("Failed to read pixel data from output texture.");
        // Perform full cleanup
        gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
        gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer);
        gl.deleteProgram(program); gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader);
        return null;
    }

    const resultLimbsFromGPU = new Float32Array(maxLength);
    const carryOutFromGPU = new Float32Array(maxLength);
    for (let i = 0; i < maxLength; i++) {
      resultLimbsFromGPU[i] = outputPixelDataRGBA[i * 4 + 0]; // R component
      carryOutFromGPU[i] = outputPixelDataRGBA[i * 4 + 1];    // G component
    }

    // CPU-side Carry Propagation
    const finalResultLimbs = [];
    let propagatedCarry = 0;
    for (let i = 0; i < maxLength; i++) {
      let currentLimbValueFromGPU = resultLimbsFromGPU[i];
      let carryGeneratedByGPUForThisPosition = carryOutFromGPU[i];
      let sumWithPropagatedCarry = currentLimbValueFromGPU + propagatedCarry;
      let finalLimbValue = sumWithPropagatedCarry % BASE;
      finalResultLimbs.push(finalLimbValue);
      propagatedCarry = carryGeneratedByGPUForThisPosition + Math.floor(sumWithPropagatedCarry / BASE);
    }
    if (propagatedCarry > 0) {
      // Handle remaining carry, potentially spanning multiple new limbs
      let currentCarry = propagatedCarry;
      while (currentCarry > 0) {
        finalResultLimbs.push(currentCarry % BASE);
        currentCarry = Math.floor(currentCarry / BASE);
      }
    }
    while (finalResultLimbs.length > 1 && finalResultLimbs[finalResultLimbs.length - 1] === 0) {
      finalResultLimbs.pop();
    }

    // Cleanup WebGL objects
    gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texCarryIn);
    gl.deleteTexture(texOutput);
    gl.deleteFramebuffer(fbo);
    gl.deleteBuffer(vertexBuffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader);

    // Construct result BigIntPrimitive
    // Using simplified construction: create dummy, then set limbs and sign.
    const resultNum = new BigIntPrimitive("0", this.canvas); // Pass canvas for future ops
    resultNum.limbs = finalResultLimbs.length > 0 ? finalResultLimbs : [0]; // Ensure limbs array is not empty
    resultNum.sign = this.sign; // Assuming positive + positive for now

    return resultNum;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BigIntPrimitive };
}
