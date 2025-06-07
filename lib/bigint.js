import * as webglUtilsModule from './webgl-utils.js';
import vertexShaderSrc from './shaders/addition.vert?raw';
import fragmentShaderSrc from './shaders/addition.frag?raw';
import subtractVertexShaderSrc from './shaders/subtraction.vert?raw';
import subtractFragmentShaderSrc from './shaders/subtraction.frag?raw';
import multiplyLimbVertexShaderSrc from './shaders/multiply_limb.vert?raw';
import multiplyLimbFragmentShaderSrc from './shaders/multiply_limb.frag?raw';

// Shader sources are still expected to be globally available via
// window.vertexShaderSrc, and window.fragmentShaderSrc
// as set up by the HTML page. Access to these will remain conditional.

const BASE = 10000;
const BASE_LOG10 = 4; // log10(BASE)
const KARATSUBA_THRESHOLD = 20;

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
    this.sign = 1;
    this.canvas = canvas;

    if (value instanceof BigIntPrimitive) {
      this.limbs = [...value.limbs];
      this.sign = value.sign;
      // canvas is already set from argument, or if undefined, it's copied as undefined
      return;
    }

    let stringValue = '';
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) {
        throw new TypeError("Numeric input must be an integer.");
      }
      stringValue = String(value);
    } else if (typeof value === 'string') {
      stringValue = value.trim();
    } else {
      throw new TypeError("Invalid input type for BigIntPrimitive. Expected string, number, or BigIntPrimitive instance.");
    }

    if (stringValue.startsWith('-')) {
      this.sign = -1;
      stringValue = stringValue.substring(1);
    } else {
      this.sign = 1;
    }

    // Validate format after potential sign removal
    if (!/^\d+$/.test(stringValue) && stringValue !== "") {
        throw new TypeError("Invalid BigInt string format: contains non-digits or is just a sign.");
    }

    if (stringValue === "" || stringValue === "0") {
      this.limbs = [0];
      this.sign = 1; // Normalize sign for zero
    } else {
      // Remove leading zeros from the string representation itself before parsing to limbs
      stringValue = stringValue.replace(/^0+/, '');
      if (stringValue === "") { // Case like "000"
          this.limbs = [0];
          this.sign = 1;
      } else {
        for (let i = stringValue.length; i > 0; i -= BASE_LOG10) {
          const start = Math.max(0, i - BASE_LOG10);
          this.limbs.push(Number(stringValue.substring(start, i)));
        }
        // Normalize limbs: remove leading zeros represented as trailing zero limbs in array
        while (this.limbs.length > 1 && this.limbs[this.limbs.length - 1] === 0) {
            this.limbs.pop();
        }
        // If all limbs were popped and it became empty (e.g. from "0000"), set to [0]
        if (this.limbs.length === 0) {
            this.limbs = [0];
            this.sign = 1; // Normalize sign for zero
        }
      }
    }
    // Final check: if value is 0, sign must be 1.
    if (this.limbs.length === 1 && this.limbs[0] === 0) {
        this.sign = 1;
    }
  }

  /**
   * Returns a new BigIntPrimitive representing the negation of this value.
   * @returns {BigIntPrimitive} A new BigIntPrimitive with the sign flipped.
   */
  negate() {
    const negated = new BigIntPrimitive(this, this.canvas); // Use copy constructor
    if (!negated.isZero()) { // Do not change sign of zero
        negated.sign *= -1;
    }
    return negated;
  }

  /**
   * Returns a new BigIntPrimitive representing the absolute value of this value.
   * @returns {BigIntPrimitive} A new BigIntPrimitive with a positive sign.
   */
  abs() {
    const absolute = new BigIntPrimitive(this, this.canvas); // Use copy constructor
    absolute.sign = 1;
    return absolute;
  }

  /**
   * Checks if the BigIntPrimitive is positive.
   * @returns {boolean} True if sign is 1 and not zero.
   */
  isPositive() {
    return this.sign === 1 && !this.isZero();
  }

  /**
   * Checks if the BigIntPrimitive is negative.
   * @returns {boolean} True if sign is -1 and not zero.
   */
  isNegative() {
    return this.sign === -1 && !this.isZero(); // isZero already implies not negative.
  }

  /**
   * Compares the magnitude (absolute value) of this BigIntPrimitive with another.
   * @param {BigIntPrimitive} otherBigInt The BigIntPrimitive to compare with.
   * @returns {number} 1 if abs(this) > abs(otherBigInt), -1 if abs(this) < abs(otherBigInt), 0 if magnitudes are equal.
   * @throws {TypeError} If otherBigInt is not an instance of BigIntPrimitive.
   */
  compareMagnitude(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }

    const l1 = this.limbs.length;
    const l2 = otherBigInt.limbs.length;

    if (l1 > l2) return 1;
    if (l1 < l2) return -1;

    // Lengths are equal, compare limb by limb from most significant
    for (let i = l1 - 1; i >= 0; i--) {
      if (this.limbs[i] > otherBigInt.limbs[i]) return 1;
      if (this.limbs[i] < otherBigInt.limbs[i]) return -1;
    }
    return 0; // Magnitudes are equal
  }

  /**
   * Returns the string representation of the BigIntPrimitive.
   * @returns {string} The string representation.
   */
  toString() {
    if (this.isZero()) { // isZero ensures sign is 1 for "0"
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
    // For non-zero numbers, prepend sign if negative.
    return (this.sign === -1 ? "-" : "") + s;
  }

  /**
   * Checks if the BigIntPrimitive is zero.
   * Sign of zero is normalized to 1 by constructor.
   * @returns {boolean} True if the value is zero, false otherwise.
   */
  isZero() {
    return this.limbs.length === 1 && this.limbs[0] === 0;
  }

  /**
   * @private
   * Internal method to add two positive BigIntPrimitives using WebGL.
   * Assumes `this` is positive and `positiveOtherBigInt` is also positive.
   * @param {BigIntPrimitive} positiveOtherBigInt The positive BigIntPrimitive to add.
   * @returns {BigIntPrimitive | null} A new positive BigIntPrimitive representing the sum, or null on WebGL error.
   */
  _core_add(positiveOtherBigInt) {
    // Pre-condition checks (optional, as this is an internal method)
    // if (this.sign === -1 || positiveOtherBigInt.sign === -1) {
    //   console.error("_core_add called with negative numbers.");
    //   return null;
    // }
    if (!(positiveOtherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive for _core_add.");
    }
    if (!this.canvas) {
        // console.error("BigIntPrimitive._core_add: Canvas element not provided. WebGL operations require a canvas.");
        // return null;
        throw new Error("Canvas not available for WebGL addition.");
    }

    const webglUtils = webglUtilsModule; // Use the imported module
    const vsSource = vertexShaderSrc; // Use imported shader for addition
    const fsSource = fragmentShaderSrc; // Use imported shader for addition

    if (!webglUtils) {
        // console.error("BigIntPrimitive.add: WebGL utilities module not loaded correctly. Cannot proceed with WebGL operations.");
        // return null;
        throw new Error("WebGL utilities module not loaded correctly for addition.");
    }

    const gl = webglUtils.initWebGL(this.canvas);
    if (!gl) {
    //   console.error("Failed to initialize WebGL context (returned by webglUtils.initWebGL).");
    //   return null;
        throw new Error("Failed to initialize WebGL for addition.");
    }

    if (!vsSource || !fsSource) {
        // console.error("Shader sources not provided (vertexShaderSrc or fragmentShaderSrc is undefined).");
        // return null;
        throw new Error("Addition shader sources not found.");
    }

    const vertexShader = webglUtils.createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = webglUtils.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const program = webglUtils.createProgram(gl, vertexShader, fragmentShader);

    if (!program) {
    //   console.error("Failed to create shader program.");
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
    //   return null;
      throw new Error("Failed to create shader program for addition.");
    }

    const maxLength = Math.max(this.limbs.length, positiveOtherBigInt.limbs.length); // Use positiveOtherBigInt here
    const texWidth = maxLength;
    const texHeight = 1;

    const num1LimbsData = new Float32Array(maxLength);
    const num2LimbsData = new Float32Array(maxLength);
    const carryInLimbsData = new Float32Array(maxLength); // All zeros

    for (let i = 0; i < maxLength; i++) {
      num1LimbsData[i] = this.limbs[i] || 0;
      num2LimbsData[i] = positiveOtherBigInt.limbs[i] || 0; // Corrected variable name
      carryInLimbsData[i] = 0;
    }

    const texNum1 = webglUtils.createDataTexture(gl, num1LimbsData, texWidth, texHeight, false);
    const texNum2 = webglUtils.createDataTexture(gl, num2LimbsData, texWidth, texHeight, false);
    const texCarryIn = webglUtils.createDataTexture(gl, carryInLimbsData, texWidth, texHeight, false);
    const texOutput = webglUtils.createDataTexture(gl, new Float32Array(texWidth * texHeight * 4), texWidth, texHeight, true);


    if (!texNum1 || !texNum2 || !texCarryIn || !texOutput) {
        // console.error("Failed to create one or more data textures.");
        if (program) gl.deleteProgram(program);
        if (vertexShader) gl.deleteShader(vertexShader);
        if (fragmentShader) gl.deleteShader(fragmentShader);
        if (texNum1) gl.deleteTexture(texNum1);
        if (texNum2) gl.deleteTexture(texNum2);
        if (texCarryIn) gl.deleteTexture(texCarryIn);
        if (texOutput) gl.deleteTexture(texOutput);
        // return null;
        throw new Error("Failed to create one or more data textures for addition.");
    }

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);

    // const fboStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER); // checkFramebufferStatus is part of gl
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    //   console.error("Framebuffer incomplete: " + fboStatus);
      gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
      gl.deleteFramebuffer(fbo); gl.deleteProgram(program); gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader);
    //   return null;
      throw new Error("Framebuffer incomplete for addition.");
    }
    // gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Unbind after check, before draw? No, draw to fbo.

    const quadVertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    gl.viewport(0, 0, texWidth, texHeight);
    gl.useProgram(program);

    const aPositionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(aPositionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
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

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const outputPixelDataRGBA = webglUtils.readDataFromTexture(gl, fbo, texWidth, texHeight, false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (!outputPixelDataRGBA) {
        // console.error("Failed to read pixel data from output texture.");
        gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
        gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer); gl.deleteProgram(program); gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader);
        // return null;
        throw new Error("Failed to read pixel data from output texture for addition.");
    }

    const resultLimbsFromGPU = new Float32Array(maxLength);
    const carryOutFromGPU = new Float32Array(maxLength);
    for (let i = 0; i < maxLength; i++) {
      resultLimbsFromGPU[i] = outputPixelDataRGBA[i * 4 + 0];
      carryOutFromGPU[i] = outputPixelDataRGBA[i * 4 + 1];
    }

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
      let currentCarry = propagatedCarry;
      while (currentCarry > 0) {
        finalResultLimbs.push(currentCarry % BASE);
        currentCarry = Math.floor(currentCarry / BASE);
      }
    }
    while (finalResultLimbs.length > 1 && finalResultLimbs[finalResultLimbs.length - 1] === 0) {
      finalResultLimbs.pop();
    }

    gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texCarryIn);
    gl.deleteTexture(texOutput);
    gl.deleteFramebuffer(fbo);
    gl.deleteBuffer(vertexBuffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader);

    const resultNum = new BigIntPrimitive("0", this.canvas); // Create a new instance for the result
    resultNum.limbs = finalResultLimbs.length > 0 ? finalResultLimbs : [0];
    resultNum.sign = 1; // _core_add always returns a positive number

    return resultNum;
  }

  /**
   * Adds another BigIntPrimitive to this one. Handles signs correctly.
   * @param {BigIntPrimitive} otherBigInt The BigIntPrimitive to add.
   * @returns {BigIntPrimitive | null} A new BigIntPrimitive representing the sum, or null on error.
   * @throws {TypeError} If otherBigInt is not an instance of BigIntPrimitive.
   */
  add(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }

    if (this.sign === otherBigInt.sign) {
      // Same signs: e.g., A + B or (-A) + (-B)
      // Result magnitude is abs(A) + abs(B)
      // Result sign is the same as their common sign
      const absThis = this.abs();
      const absOther = otherBigInt.abs();
      const sumMagnitude = absThis._core_add(absOther);
      if (!sumMagnitude) return null; // WebGL error in _core_add

      sumMagnitude.sign = this.sign; // Assign original sign
      // Ensure 0 always has positive sign
      if (sumMagnitude.isZero()) {
          sumMagnitude.sign = 1;
      }
      return sumMagnitude;
    } else {
      // Different signs: e.g., A + (-B) or (-A) + B
      // This is equivalent to subtraction: A - B or B - A
      // Delegate to subtract: this - (-otherBigInt)
      return this.subtract(otherBigInt.negate());
    }
  }

  /**
   * @private
   * Internal method to subtract two positive BigIntPrimitives using WebGL.
   * Assumes `this` is positive, `positiveOtherBigInt` is positive,
   * and `this` has a magnitude greater than or equal to `positiveOtherBigInt`.
   * @param {BigIntPrimitive} positiveOtherBigInt The positive BigIntPrimitive to subtract.
   * @returns {BigIntPrimitive | null} A new positive BigIntPrimitive representing the difference, or null on WebGL error.
   */
  _core_subtract(positiveOtherBigInt) {
    // Pre-condition checks (optional)
    // if (this.sign === -1 || positiveOtherBigInt.sign === -1 || this.compareMagnitude(positiveOtherBigInt) < 0) {
    //   console.error("_core_subtract called with invalid inputs.");
    //   return null;
    // }
    if (!(positiveOtherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive for _core_subtract.");
    }
    if (!this.canvas) {
        // console.error("BigIntPrimitive._core_subtract: Canvas element not provided.");
        // return null;
        throw new Error("Canvas not available for WebGL subtraction.");
    }

    const gl = webglUtilsModule.initWebGL(this.canvas);
    if (!gl) {
        // console.error("Failed to initialize WebGL context for subtraction.");
        // return null;
        throw new Error("Failed to initialize WebGL for subtraction.");
    }

    const vertexShader = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, subtractVertexShaderSrc);
    const fragmentShader = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, subtractFragmentShaderSrc);
    const program = webglUtilsModule.createProgram(gl, vertexShader, fragmentShader);

    if (!program) {
        if (vertexShader) gl.deleteShader(vertexShader);
        if (fragmentShader) gl.deleteShader(fragmentShader);
        // return null; // Or throw error
        throw new Error("Failed to create shader program for subtraction.");
    }

    const maxLength = Math.max(this.limbs.length, positiveOtherBigInt.limbs.length);
    const texWidth = maxLength;
    const texHeight = 1;

    const num1LimbsData = new Float32Array(maxLength);
    const num2LimbsData = new Float32Array(maxLength);
    const borrowInLimbsData = new Float32Array(maxLength); // All zeros

    for (let i = 0; i < maxLength; i++) {
        num1LimbsData[i] = this.limbs[i] || 0;
        num2LimbsData[i] = positiveOtherBigInt.limbs[i] || 0;
        borrowInLimbsData[i] = 0;
    }

    const texNum1 = webglUtilsModule.createDataTexture(gl, num1LimbsData, texWidth, texHeight, false);
    const texNum2 = webglUtilsModule.createDataTexture(gl, num2LimbsData, texWidth, texHeight, false);
    const texBorrowIn = webglUtilsModule.createDataTexture(gl, borrowInLimbsData, texWidth, texHeight, false);
    const texOutput = webglUtilsModule.createDataTexture(gl, new Float32Array(texWidth * texHeight * 4), texWidth, texHeight, true);

    if (!texNum1 || !texNum2 || !texBorrowIn || !texOutput) {
        if (program) gl.deleteProgram(program);
        if (vertexShader) gl.deleteShader(vertexShader);
        if (fragmentShader) gl.deleteShader(fragmentShader);
        if (texNum1) gl.deleteTexture(texNum1);
        if (texNum2) gl.deleteTexture(texNum2);
        if (texBorrowIn) gl.deleteTexture(texBorrowIn);
        if (texOutput) gl.deleteTexture(texOutput);
        throw new Error("Failed to create one or more data textures for subtraction.");
    }

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texBorrowIn); gl.deleteTexture(texOutput);
        gl.deleteFramebuffer(fbo); gl.deleteProgram(program); gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader);
        throw new Error("Framebuffer incomplete for subtraction.");
    }

    const quadVertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    gl.viewport(0, 0, texWidth, texHeight);
    gl.useProgram(program);

    const aPositionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(aPositionLocation);
    gl.vertexAttribPointer(aPositionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texNum1);
    gl.uniform1i(gl.getUniformLocation(program, "u_num1Texture"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNum2);
    gl.uniform1i(gl.getUniformLocation(program, "u_num2Texture"), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texBorrowIn);
    gl.uniform1i(gl.getUniformLocation(program, "u_borrowTexture"), 2);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const outputPixelDataRGBA = webglUtilsModule.readDataFromTexture(gl, fbo, texWidth, texHeight, false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Unbind FBO after reading

    if (!outputPixelDataRGBA) {
        gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texBorrowIn); gl.deleteTexture(texOutput);
        gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer); gl.deleteProgram(program); gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader);
        throw new Error("Failed to read pixel data from output texture for subtraction.");
    }

    const resultLimbsFromGPU = new Float32Array(maxLength);
    const borrowOutFromGPU = new Float32Array(maxLength);
    for (let i = 0; i < maxLength; i++) {
        resultLimbsFromGPU[i] = outputPixelDataRGBA[i * 4 + 0];
        borrowOutFromGPU[i] = outputPixelDataRGBA[i * 4 + 1];
    }

    const finalResultLimbs = [];
    let propagatedBorrow = 0;
    for (let i = 0; i < maxLength; i++) { // Correctly iterate up to maxLength
        // The shader calculates: limb1 - limb2 - borrowIn (from texture)
        // resultLimbsFromGPU[i] is this result (potentially with BASE added if negative)
        // borrowOutFromGPU[i] is the borrow generated by shader for THIS position

        // We now apply the propagatedBorrow from the PREVIOUS (less significant) JavaScript step
        let diffLimbShaderOutput = resultLimbsFromGPU[i];
        let jsBorrowForThisLimb = propagatedBorrow; // Borrow from previous JS step

        let currentLimbFinal = diffLimbShaderOutput - jsBorrowForThisLimb;
        propagatedBorrow = borrowOutFromGPU[i]; // This is the borrow the shader said it generated for this position

        if (currentLimbFinal < 0) {
            currentLimbFinal += BASE;
            propagatedBorrow += 1; // Additional borrow needed due to JS propagated borrow
        }
        finalResultLimbs.push(currentLimbFinal);
    }

    if (propagatedBorrow > 0) {
        console.error("_core_subtract resulted in a final propagatedBorrow. Minuend might have been smaller than subtrahend, or error in logic.");
        // This implies an issue, as _core_subtract assumes minuend >= subtrahend (positive result).
        // Consider throwing an error here if this state is truly invalid.
    }

    while (finalResultLimbs.length > 1 && finalResultLimbs[finalResultLimbs.length - 1] === 0) {
        finalResultLimbs.pop();
    }
    if (finalResultLimbs.length === 0) { // Should not happen if logic is correct and inputs valid
         finalResultLimbs.push(0);
    }

    gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texBorrowIn);
    gl.deleteTexture(texOutput);
    gl.deleteFramebuffer(fbo);
    gl.deleteBuffer(vertexBuffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    const resultNum = new BigIntPrimitive("0", this.canvas);
    resultNum.limbs = finalResultLimbs;
    resultNum.sign = 1; // _core_subtract by definition returns a positive result or zero
    if (resultNum.isZero()) { // Normalize sign of zero
        resultNum.sign = 1;
    }
    return resultNum;
  }

  /**
   * Subtracts another BigIntPrimitive from this one. Handles signs correctly.
   * @param {BigIntPrimitive} otherBigInt The BigIntPrimitive to subtract.
   * @returns {BigIntPrimitive | null} A new BigIntPrimitive representing the difference, or null on error.
   * @throws {TypeError} If otherBigInt is not an instance of BigIntPrimitive.
   */
  subtract(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }

    if (this.sign !== otherBigInt.sign) {
      // Different signs: e.g., A - (-B)  =>  A + B
      // or (-A) - B  =>  -(A + B)
      // Result magnitude is abs(A) + abs(B)
      // Result sign is `this.sign`.
      const absThis = this.abs();
      const absOther = otherBigInt.abs();
      const sumMagnitude = absThis._core_add(absOther);
      if (!sumMagnitude) return null; // WebGL error

      sumMagnitude.sign = this.sign;
      if (sumMagnitude.isZero()) { // Should not happen if adding two non-zero abs values, but good for safety.
          sumMagnitude.sign = 1;
      }
      return sumMagnitude;
    } else {
      // Same signs: e.g., A - B  or  (-A) - (-B) which is B - A (if signs flipped) or -(A-B)
      // Magnitude is |abs(A) - abs(B)|
      // Sign depends on comparison and original sign.
      const comp = this.compareMagnitude(otherBigInt);

      if (comp === 0) {
        return new BigIntPrimitive("0", this.canvas); // A - A = 0 or (-A) - (-A) = 0
      }

      let resultMagnitude;
      if (comp > 0) { // abs(this) > abs(other)
        resultMagnitude = this.abs()._core_subtract(otherBigInt.abs());
        if (!resultMagnitude) return null; // WebGL error
        resultMagnitude.sign = this.sign; // Sign of the larger magnitude number (this)
                                          // e.g.  5 - 2 = 3 (this.sign=1)
                                          //      -5 - (-2) = -3 (this.sign=-1)
      } else { // abs(this) < abs(other)
        resultMagnitude = otherBigInt.abs()._core_subtract(this.abs());
        if (!resultMagnitude) return null; // WebGL error
        resultMagnitude.sign = this.sign * -1; // Sign is opposite of this.sign
                                               // e.g.  2 - 5 = -3 (this.sign=1, result sign=-1)
                                               //      -2 - (-5) = 3 (this.sign=-1, result sign=1)
      }

      if (resultMagnitude.isZero()) { // Should not happen if comp !== 0, but for safety
          resultMagnitude.sign = 1;
      }
      return resultMagnitude;
    }
  }

  _multiply_limb_by_bigint(limbValue, otherNumber) {
       // limbValue is a JS number, otherNumber is a BigIntPrimitive instance
       // This method computes limbValue * otherNumber using WebGL.
       // It assumes otherNumber is positive. The sign is handled by the caller.

       if (!this.canvas) { // 'this' refers to the BigInt on which multiply is called, used to get canvas.
           // console.error("BigIntPrimitive._multiply_limb_by_bigint: Canvas element not available.");
           throw new Error("Canvas not available for WebGL operation.");
       }
       if (limbValue === 0 || otherNumber.isZero()) {
           return new BigIntPrimitive("0", this.canvas);
       }

       const gl = webglUtilsModule.initWebGL(this.canvas);
       if (!gl) {
           throw new Error("Failed to initialize WebGL for _multiply_limb_by_bigint.");
       }

       const vertexShader = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, multiplyLimbVertexShaderSrc);
       const fragmentShader = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, multiplyLimbFragmentShaderSrc);
       const program = webglUtilsModule.createProgram(gl, vertexShader, fragmentShader);

       if (!program) {
           if (vertexShader) gl.deleteShader(vertexShader);
           if (fragmentShader) gl.deleteShader(fragmentShader);
           throw new Error("Failed to create shader program for _multiply_limb_by_bigint.");
       }

       const maxLength = otherNumber.limbs.length;
       const texWidth = maxLength;
       const texHeight = 1;

       const otherNumLimbsData = new Float32Array(maxLength);
       const carryInLimbsData = new Float32Array(maxLength);

       for (let i = 0; i < maxLength; i++) {
           otherNumLimbsData[i] = otherNumber.limbs[i] || 0;
           carryInLimbsData[i] = 0;
       }

       const texOtherNum = webglUtilsModule.createDataTexture(gl, otherNumLimbsData, texWidth, texHeight, false);
       const texCarryIn = webglUtilsModule.createDataTexture(gl, carryInLimbsData, texWidth, texHeight, false);
       const texOutput = webglUtilsModule.createDataTexture(gl, new Float32Array(texWidth * texHeight * 4), texWidth, texHeight, true);

       if (!texOtherNum || !texCarryIn || !texOutput) {
           if (program) gl.deleteProgram(program);
           if (vertexShader) gl.deleteShader(vertexShader);
           if (fragmentShader) gl.deleteShader(fragmentShader);
           if (texOtherNum) gl.deleteTexture(texOtherNum);
           if (texCarryIn) gl.deleteTexture(texCarryIn);
           if (texOutput) gl.deleteTexture(texOutput);
           throw new Error("Failed to create data textures for _multiply_limb_by_bigint.");
       }

       const fbo = gl.createFramebuffer();
       gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
       gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);

       if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
           gl.deleteTexture(texOtherNum); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
           gl.deleteFramebuffer(fbo); gl.deleteProgram(program); gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader);
           throw new Error("Framebuffer incomplete for _multiply_limb_by_bigint.");
       }

       const quadVertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
       const vertexBuffer = gl.createBuffer();
       gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
       gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

       gl.viewport(0, 0, texWidth, texHeight);
       gl.useProgram(program);

       const aPositionLocation = gl.getAttribLocation(program, "a_position");
       gl.enableVertexAttribArray(aPositionLocation);
       gl.vertexAttribPointer(aPositionLocation, 2, gl.FLOAT, false, 0, 0);

       gl.uniform1f(gl.getUniformLocation(program, "u_limbVal"), limbValue);
       gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texOtherNum);
       gl.uniform1i(gl.getUniformLocation(program, "u_otherNumTexture"), 0);
       gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texCarryIn);
       gl.uniform1i(gl.getUniformLocation(program, "u_carryTexture"), 1);

       gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
       gl.drawArrays(gl.TRIANGLES, 0, 6);
       const outputPixelDataRGBA = webglUtilsModule.readDataFromTexture(gl, fbo, texWidth, texHeight, false);
       gl.bindFramebuffer(gl.FRAMEBUFFER, null);

       if (!outputPixelDataRGBA) {
           gl.deleteTexture(texOtherNum); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
           gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer); gl.deleteProgram(program); gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader);
           throw new Error("Failed to read pixel data for _multiply_limb_by_bigint.");
       }

       const resultLimbsFromGPU = new Float32Array(maxLength);
       const carryOutFromGPU = new Float32Array(maxLength);
       for (let i = 0; i < maxLength; i++) {
           resultLimbsFromGPU[i] = outputPixelDataRGBA[i * 4 + 0];
           carryOutFromGPU[i] = outputPixelDataRGBA[i * 4 + 1];
       }

       const finalResultLimbs = [];
       let propagatedCarry = 0;
       for (let i = 0; i < maxLength; i++) {
           let currentProductSum = resultLimbsFromGPU[i] + propagatedCarry;
           finalResultLimbs.push(currentProductSum % BASE);
           propagatedCarry = carryOutFromGPU[i] + Math.floor(currentProductSum / BASE);
       }

       if (propagatedCarry > 0) {
           let currentCarry = propagatedCarry;
           // If propagatedCarry is larger than BASE, it needs to be split into multiple limbs
           while(currentCarry > 0) {
               finalResultLimbs.push(currentCarry % BASE);
               currentCarry = Math.floor(currentCarry / BASE);
           }
       }

       gl.deleteTexture(texOtherNum); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
       gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer);
       gl.deleteProgram(program); gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader);

       const resultNum = new BigIntPrimitive("0", this.canvas);
       resultNum.limbs = finalResultLimbs.length > 0 ? finalResultLimbs : [0];
       resultNum.sign = 1;
       if (resultNum.isZero()) resultNum.sign = 1;
       return resultNum;
   }

   _core_multiply(num1, num2) {
    // Assumes num1 and num2 are positive BigIntPrimitive instances.
    // Uses this.canvas from the instance on which .multiply() was called.

    if (num1.isZero() || num2.isZero()) {
        return new BigIntPrimitive("0", this.canvas);
    }

    let totalResult = new BigIntPrimitive("0", this.canvas);

    for (let i = 0; i < num1.limbs.length; i++) {
        const limbOfNum1 = num1.limbs[i];
        if (limbOfNum1 === 0) {
            continue;
        }

        let partialProduct = this._multiply_limb_by_bigint(limbOfNum1, num2);

        if (partialProduct.isZero()) {
            continue;
        }

        if (i > 0) {
            const shiftedLimbs = new Array(i).fill(0).concat(partialProduct.limbs);
            partialProduct.limbs = shiftedLimbs;
        }

        totalResult = totalResult.add(partialProduct);
        if (!totalResult) { // Error occurred in add (e.g. WebGL issue)
            throw new Error("Error during accumulation in _core_multiply.");
        }
    }

    totalResult.sign = 1; // _core_multiply result is positive
    return totalResult;
  }

  multiply(otherBigInt) {
    const self = this;

    if (!(otherBigInt instanceof BigIntPrimitive)) {
        throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }

    if (self.isZero() || otherBigInt.isZero()) {
        return new BigIntPrimitive("0", self.canvas);
    }

    const resultSign = (self.sign === otherBigInt.sign) ? 1 : -1;

    const absThis = self.abs();
    const absOther = otherBigInt.abs();

    let finalAbsResult;

    const absThisLen = absThis.isZero() ? 0 : absThis.limbs.length;
    const absOtherLen = absOther.isZero() ? 0 : absOther.limbs.length;

    if (absThisLen < KARATSUBA_THRESHOLD || absOtherLen < KARATSUBA_THRESHOLD) {
        finalAbsResult = self._core_multiply(absThis, absOther);
    } else {
        const n = Math.max(absThisLen, absOtherLen);
        const m = Math.floor(n / 2);

        if (m === 0) {
            finalAbsResult = self._core_multiply(absThis, absOther);
        } else {
            const { low: b, high: a } = absThis._splitAt(m);
            const { low: d, high: c } = absOther._splitAt(m);

            const p0 = a.multiply(c);
            const p1 = b.multiply(d);

            const sum_ab = a.add(b);
            const sum_cd = c.add(d);
            if (!sum_ab || !sum_cd) throw new Error("Karatsuba: Error in intermediate additions for p2_temp components.");
            const p2_temp = sum_ab.multiply(sum_cd);

            if (!p0 || !p1 || !p2_temp) throw new Error("Karatsuba: Error in recursive multiply calls.");

            const p0_plus_p1 = p0.add(p1);
            if(!p0_plus_p1) throw new Error("Karatsuba: Error in p0+p1 for p2 calculation.");
            const p2 = p2_temp.subtract(p0_plus_p1);
            if (!p2) throw new Error("Karatsuba: Error in p2_temp - (p0+p1) for p2 calculation.");


            const p0_shifted = new BigIntPrimitive("0", self.canvas);
            if (!p0.isZero()) {
                p0_shifted.limbs = new Array(2 * m).fill(0).concat(p0.limbs);
                p0_shifted.sign = p0.sign;
            }
            if (p0_shifted.isZero()) p0_shifted.sign = 1;


            const p2_shifted = new BigIntPrimitive("0", self.canvas);
            if (!p2.isZero()) {
                p2_shifted.limbs = new Array(m).fill(0).concat(p2.limbs);
                p2_shifted.sign = p2.sign;
            }
            if (p2_shifted.isZero()) p2_shifted.sign = 1;

            let tempSum = p0_shifted.add(p2_shifted);
            if (!tempSum) throw new Error("Karatsuba: Error in adding p0_shifted and p2_shifted");
            finalAbsResult = tempSum.add(p1);
            if (!finalAbsResult) throw new Error("Karatsuba: Error in adding sum and p1");
        }
    }

    if (finalAbsResult.isZero()) {
        finalAbsResult.sign = 1;
    } else {
        finalAbsResult.sign = resultSign;
    }

    if (finalAbsResult.canvas !== self.canvas) {
       finalAbsResult.canvas = self.canvas;
    }

    return finalAbsResult;
  }

  _shiftLeft(numLimbsToShift) {
    if (numLimbsToShift < 0) {
        throw new Error("numLimbsToShift must be non-negative.");
    }

    if (this.isZero() || numLimbsToShift === 0) {
        return new BigIntPrimitive(this, this.canvas);
    }

    const newLimbs = new Array(numLimbsToShift).fill(0).concat(this.limbs);

    const Ctor = this.constructor;
    const shiftedBigInt = new Ctor("0", this.canvas);
    shiftedBigInt.limbs = newLimbs;
    shiftedBigInt.sign = this.sign;

    return shiftedBigInt;
  }

  _splitAt(m) {
    const Ctor = this.constructor;
    let low, high;

    if (m <= 0) {
        low = new Ctor("0", this.canvas);
        high = new Ctor(this, this.canvas);
        return { low, high };
    }
    if (m >= this.limbs.length) {
        low = new Ctor(this, this.canvas);
        high = new Ctor("0", this.canvas);
        return { low, high };
    }

    low = new Ctor("0", this.canvas);
    let lowSlice = this.limbs.slice(0, m);
    while (lowSlice.length > 1 && lowSlice[lowSlice.length - 1] === 0) {
        lowSlice.pop();
    }
    if (lowSlice.length === 0 || (lowSlice.length === 1 && lowSlice[0] === 0)) {
        low.limbs = [0];
    } else {
        low.limbs = lowSlice;
    }
    // this will be positive when called from Karatsuba, so low part is positive unless zero
    low.sign = low.isZero() ? 1 : 1;


    high = new Ctor("0", this.canvas);
    let highSlice = this.limbs.slice(m);
    while (highSlice.length > 1 && highSlice[highSlice.length - 1] === 0) {
        highSlice.pop();
    }
    if (highSlice.length === 0 || (highSlice.length === 1 && highSlice[0] === 0)) {
        high.limbs = [0];
    } else {
        high.limbs = highSlice;
    }
    // this will be positive, so high part is positive unless zero
    high.sign = high.isZero() ? 1 : 1;

    return { low, high };
  }
}

export { BigIntPrimitive };
