import * as webglUtilsModule from './webgl-utils.js';
import vertexShaderSrc from './shaders/addition.vert?raw';
import fragmentShaderSrc from './shaders/addition.frag?raw';
import subtractVertexShaderSrc from './shaders/subtraction.vert?raw';
import subtractFragmentShaderSrc from './shaders/subtraction.frag?raw';
import multiplyLimbVertexShaderSrc from './shaders/multiply_limb.vert?raw';
import multiplyLimbFragmentShaderSrc from './shaders/multiply_limb.frag?raw';

const BASE = 10000;
const BASE_LOG10 = 4; // log10(BASE)
const KARATSUBA_THRESHOLD = 20;

class BigIntPrimitive {
  constructor(value, canvas, options = {}) {
    this.limbs = [];
    this.sign = 1;
    this.canvas = canvas;
    this.forceCPU = !!(options && options.forceCPU);

    if (value instanceof BigIntPrimitive) {
      this.limbs = [...value.limbs];
      this.sign = value.sign;
      // this.forceCPU will be taken from the new options object if provided,
      // or default to false if value is a BigIntPrimitive and options is not given.
      // If copying, the source's forceCPU isn't automatically copied unless options are explicitly passed.
      // This is generally fine as new operations would use new options.
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

    if (!/^\d+$/.test(stringValue) && stringValue !== "") {
        throw new TypeError("Invalid BigInt string format: contains non-digits or is just a sign.");
    }

    if (stringValue === "" || stringValue === "0") {
      this.limbs = [0];
      this.sign = 1;
    } else {
      stringValue = stringValue.replace(/^0+/, '');
      if (stringValue === "") {
          this.limbs = [0];
          this.sign = 1;
      } else {
        for (let i = stringValue.length; i > 0; i -= BASE_LOG10) {
          const start = Math.max(0, i - BASE_LOG10);
          this.limbs.push(Number(stringValue.substring(start, i)));
        }
        while (this.limbs.length > 1 && this.limbs[this.limbs.length - 1] === 0) {
            this.limbs.pop();
        }
        if (this.limbs.length === 0) {
            this.limbs = [0];
            this.sign = 1;
        }
      }
    }
    if (this.limbs.length === 1 && this.limbs[0] === 0) {
        this.sign = 1;
    }
  }

  negate() {
    const negated = new BigIntPrimitive(this, this.canvas, { forceCPU: this.forceCPU });
    if (!negated.isZero()) {
        negated.sign *= -1;
    }
    return negated;
  }

  abs() {
    const absolute = new BigIntPrimitive(this, this.canvas, { forceCPU: this.forceCPU });
    absolute.sign = 1;
    return absolute;
  }

  isPositive() {
    return this.sign === 1 && !this.isZero();
  }

  isNegative() {
    return this.sign === -1 && !this.isZero();
  }

  compareMagnitude(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    const l1 = this.limbs.length;
    const l2 = otherBigInt.limbs.length;
    if (l1 > l2) return 1;
    if (l1 < l2) return -1;
    for (let i = l1 - 1; i >= 0; i--) {
      if (this.limbs[i] > otherBigInt.limbs[i]) return 1;
      if (this.limbs[i] < otherBigInt.limbs[i]) return -1;
    }
    return 0;
  }

  cmp(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }

    // Handle zero comparisons
    const thisIsZero = this.isZero();
    const otherIsZero = otherBigInt.isZero();

    if (thisIsZero && otherIsZero) {
      return 0;
    }
    if (thisIsZero) { // other is non-zero
      return otherBigInt.sign === 1 ? -1 : 1;
    }
    if (otherIsZero) { // this is non-zero
      return this.sign === 1 ? 1 : -1;
    }

    // Compare signs if different
    if (this.sign !== otherBigInt.sign) {
      return this.sign === 1 ? 1 : -1;
    }

    // Signs are the same, compare magnitudes
    if (this.sign === 1) { // Both positive
      return this.compareMagnitude(otherBigInt);
    } else { // Both negative
      const magComparison = this.compareMagnitude(otherBigInt);
      if (magComparison === 0) {
        return 0;
      }
      return magComparison * -1;
    }
  }

  toString() {
    if (this.isZero()) {
      return "0";
    }
    let s = "";
    for (let i = 0; i < this.limbs.length; i++) {
      let limbStr = String(this.limbs[i]);
      if (i < this.limbs.length - 1) {
        limbStr = limbStr.padStart(BASE_LOG10, '0');
      }
      s = limbStr + s;
    }
    return (this.sign === -1 ? "-" : "") + s;
  }

  toNumber() {
    return parseFloat(this.toString());
  }

  toJSON() {
    return this.toString();
  }

  valueOf() {
    return this.toString();
  }

  isZero() {
    return this.limbs.length === 1 && this.limbs[0] === 0;
  }

  _core_add(positiveOtherBigInt) {
    if (!(positiveOtherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive for _core_add.");
    }

    try {
      if (this.forceCPU) { throw new Error("Forcing CPU path for _core_add via option"); }
      // --- START OF WEBGL ATTEMPT ---
      if (!this.canvas) {
          throw new Error("Canvas not available for WebGL addition.");
      }

      const webglUtils = webglUtilsModule;
      const vsSource = vertexShaderSrc;
      const fsSource = fragmentShaderSrc;

      if (!webglUtils) {
          throw new Error("WebGL utilities module not loaded correctly for addition.");
      }
      if (!vsSource || !fsSource) {
          throw new Error("Addition shader sources not found.");
      }

      const gl = webglUtils.initWebGL(this.canvas);
      if (!gl) {
          throw new Error("Failed to initialize WebGL for addition.");
      }
      gl._programCache = gl._programCache || {};
      const opKey = 'add';
      let program = gl._programCache[opKey];
      let vertexShader, fragmentShader;

      if (!program) {
        vertexShader = webglUtils.createShader(gl, gl.VERTEX_SHADER, vsSource);
        fragmentShader = webglUtils.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        program = webglUtils.createProgram(gl, vertexShader, fragmentShader);

        if (program) {
          gl._programCache[opKey] = program;
          if (vertexShader) gl.deleteShader(vertexShader);
          if (fragmentShader) gl.deleteShader(fragmentShader);
        } else {
          if (vertexShader) gl.deleteShader(vertexShader);
          if (fragmentShader) gl.deleteShader(fragmentShader);
          throw new Error("Failed to create shader program for addition.");
        }
      }

      const maxLength = Math.max(this.limbs.length, positiveOtherBigInt.limbs.length);
      const texWidth = maxLength;
      const texHeight = 1;

      const num1LimbsData = new Float32Array(maxLength);
      const num2LimbsData = new Float32Array(maxLength);
      const carryInLimbsData = new Float32Array(maxLength);

      for (let i = 0; i < maxLength; i++) {
        num1LimbsData[i] = this.limbs[i] || 0;
        num2LimbsData[i] = positiveOtherBigInt.limbs[i] || 0;
        carryInLimbsData[i] = 0;
      }

      const texNum1 = webglUtils.createDataTexture(gl, num1LimbsData, texWidth, texHeight, false);
      const texNum2 = webglUtils.createDataTexture(gl, num2LimbsData, texWidth, texHeight, false);
      const texCarryIn = webglUtils.createDataTexture(gl, carryInLimbsData, texWidth, texHeight, false);
      const texOutput = webglUtils.createDataTexture(gl, new Float32Array(texWidth * texHeight * 4), texWidth, texHeight, true);

      if (!texNum1 || !texNum2 || !texCarryIn || !texOutput) {
          if (texNum1) gl.deleteTexture(texNum1);
          if (texNum2) gl.deleteTexture(texNum2);
          if (texCarryIn) gl.deleteTexture(texCarryIn);
          if (texOutput) gl.deleteTexture(texOutput);
          throw new Error("Failed to create one or more data textures for addition.");
      }

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);

      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
        gl.deleteFramebuffer(fbo);
        throw new Error("Framebuffer incomplete for addition.");
      }

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
          gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
          gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer);
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
      if (finalResultLimbs.length === 0) {
         finalResultLimbs.push(0);
      }

      gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texCarryIn);
      gl.deleteTexture(texOutput);
      gl.deleteFramebuffer(fbo);
      gl.deleteBuffer(vertexBuffer);

      const resultNum = new this.constructor("0", this.canvas, { forceCPU: this.forceCPU });
      resultNum.limbs = finalResultLimbs;
      resultNum.sign = 1;
      if (resultNum.isZero()) resultNum.sign = 1;
      return resultNum;
      // --- END OF WEBGL ATTEMPT ---

    } catch (error) {
      // console.warn(`WebGL addition failed: ${error.message}. Falling back to CPU.`);
      let resultLimbs = [];
      let carry = 0;
      const num1Limbs = this.limbs;
      const num2Limbs = positiveOtherBigInt.limbs;
      const maxLength = Math.max(num1Limbs.length, num2Limbs.length);

      for (let i = 0; i < maxLength; i++) {
        const limb1 = num1Limbs[i] || 0;
        const limb2 = num2Limbs[i] || 0;
        const sum = limb1 + limb2 + carry;
        resultLimbs.push(sum % BASE);
        carry = Math.floor(sum / BASE);
      }

      while (carry > 0) {
        resultLimbs.push(carry % BASE);
        carry = Math.floor(carry / BASE);
      }

      while (resultLimbs.length > 1 && resultLimbs[resultLimbs.length - 1] === 0) {
        resultLimbs.pop();
      }
      if (resultLimbs.length === 0) {
        resultLimbs.push(0);
      }

      const resultNumCPU = new this.constructor("0", this.canvas, { forceCPU: this.forceCPU });
      resultNumCPU.limbs = resultLimbs;
      resultNumCPU.sign = 1;
      if (resultNumCPU.isZero()) {
          resultNumCPU.sign = 1;
      }
      return resultNumCPU;
    }
  }

  add(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    if (this.sign === otherBigInt.sign) {
      const absThis = this.abs();
      const absOther = otherBigInt.abs();
      const sumMagnitude = absThis._core_add(absOther);
      sumMagnitude.sign = this.sign;
      if (sumMagnitude.isZero()) {
          sumMagnitude.sign = 1;
      }
      return sumMagnitude;
    } else {
      return this.subtract(otherBigInt.negate());
    }
  }

  _core_subtract(positiveOtherBigInt) {
    if (!(positiveOtherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive for _core_subtract.");
    }
    try {
      if (this.forceCPU) { throw new Error("Forcing CPU path for _core_subtract via option"); }
      // --- START OF WEBGL ATTEMPT ---
      if (!this.canvas) {
          throw new Error("Canvas not available for WebGL subtraction.");
      }

      const gl = webglUtilsModule.initWebGL(this.canvas);
      if (!gl) {
          throw new Error("Failed to initialize WebGL for subtraction.");
      }
      gl._programCache = gl._programCache || {};
      const opKey = 'subtract';
      let program = gl._programCache[opKey];
      let vertexShader, fragmentShader;

      if (!program) {
        vertexShader = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, subtractVertexShaderSrc);
        fragmentShader = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, subtractFragmentShaderSrc);
        program = webglUtilsModule.createProgram(gl, vertexShader, fragmentShader);

        if (program) {
          gl._programCache[opKey] = program;
          if (vertexShader) gl.deleteShader(vertexShader);
          if (fragmentShader) gl.deleteShader(fragmentShader);
        } else {
          if (vertexShader) gl.deleteShader(vertexShader);
          if (fragmentShader) gl.deleteShader(fragmentShader);
          throw new Error("Failed to create shader program for subtraction.");
        }
      }

      const maxLength = Math.max(this.limbs.length, positiveOtherBigInt.limbs.length);
      const texWidth = maxLength;
      const texHeight = 1;

      const num1LimbsData = new Float32Array(maxLength);
      const num2LimbsData = new Float32Array(maxLength);
      const borrowInLimbsData = new Float32Array(maxLength);

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
          gl.deleteFramebuffer(fbo);
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
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      if (!outputPixelDataRGBA) {
          gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texBorrowIn); gl.deleteTexture(texOutput);
          gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer);
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
      for (let i = 0; i < maxLength; i++) {
          let diffLimbShaderOutput = resultLimbsFromGPU[i];
          let jsBorrowForThisLimb = propagatedBorrow;
          let currentLimbFinal = diffLimbShaderOutput - jsBorrowForThisLimb;
          propagatedBorrow = borrowOutFromGPU[i];
          if (currentLimbFinal < 0) {
              currentLimbFinal += BASE;
              propagatedBorrow += 1;
          }
          finalResultLimbs.push(currentLimbFinal);
      }

      if (propagatedBorrow > 0) {
          console.error("_core_subtract WebGL path: final propagatedBorrow > 0. This indicates minuend < subtrahend.");
      }

      while (finalResultLimbs.length > 1 && finalResultLimbs[finalResultLimbs.length - 1] === 0) {
          finalResultLimbs.pop();
      }
      if (finalResultLimbs.length === 0) {
           finalResultLimbs.push(0);
      }

      gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texBorrowIn);
      gl.deleteTexture(texOutput);
      gl.deleteFramebuffer(fbo);
      gl.deleteBuffer(vertexBuffer);

      const resultNum = new this.constructor("0", this.canvas, { forceCPU: this.forceCPU });
      resultNum.limbs = finalResultLimbs;
      resultNum.sign = 1;
      if (resultNum.isZero()) {
          resultNum.sign = 1;
      }
      return resultNum;
      // --- END OF WEBGL ATTEMPT ---

    } catch (error) {
      // console.warn(`WebGL subtraction failed: ${error.message}. Falling back to CPU.`);
      let resultLimbs = [];
      let borrow = 0;
      const minuendLimbs = this.limbs;
      const subtrahendLimbs = positiveOtherBigInt.limbs;
      const maxLength = minuendLimbs.length;

      for (let i = 0; i < maxLength; i++) {
        const limb1 = minuendLimbs[i] || 0;
        const limb2 = subtrahendLimbs[i] || 0;
        let diff = limb1 - limb2 - borrow;
        if (diff < 0) {
          diff += BASE;
          borrow = 1;
        } else {
          borrow = 0;
        }
        resultLimbs.push(diff);
      }

      if (borrow > 0) {
        console.error("_core_subtract CPU: final borrow was > 0. Minuend likely < subtrahend.");
      }

      while (resultLimbs.length > 1 && resultLimbs[resultLimbs.length - 1] === 0) {
        resultLimbs.pop();
      }
      if (resultLimbs.length === 0) {
        resultLimbs.push(0);
      }

      const resultNumCPU = new this.constructor("0", this.canvas, { forceCPU: this.forceCPU });
      resultNumCPU.limbs = resultLimbs;
      resultNumCPU.sign = 1;
      if (resultNumCPU.isZero()) {
          resultNumCPU.sign = 1;
      }
      return resultNumCPU;
    }
  }

  subtract(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    if (this.sign !== otherBigInt.sign) {
      const absThis = this.abs();
      const absOther = otherBigInt.abs();
      const sumMagnitude = absThis._core_add(absOther);
      sumMagnitude.sign = this.sign;
      if (sumMagnitude.isZero()) {
          sumMagnitude.sign = 1;
      }
      return sumMagnitude;
    } else {
      const comp = this.compareMagnitude(otherBigInt);
      if (comp === 0) {
        return new BigIntPrimitive("0", this.canvas);
      }
      let resultMagnitude;
      if (comp > 0) {
        resultMagnitude = this.abs()._core_subtract(otherBigInt.abs());
        resultMagnitude.sign = this.sign;
      } else {
        resultMagnitude = otherBigInt.abs()._core_subtract(this.abs());
        resultMagnitude.sign = this.sign * -1;
      }
      if (resultMagnitude.isZero()) {
          resultMagnitude.sign = 1;
      }
      return resultMagnitude;
    }
  }

  _multiply_limb_by_bigint(limbValue, otherNumber) {
    if (limbValue === 0 || otherNumber.isZero()) {
        return new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
    }

    try {
      if (this.forceCPU || !this.canvas) {
        throw new Error("Forcing CPU path for _multiply_limb_by_bigint or canvas not available.");
      }

      // --- START OF WEBGL ATTEMPT ---
      const gl = webglUtilsModule.initWebGL(this.canvas);
      if (!gl) {
          throw new Error("Failed to initialize WebGL for _multiply_limb_by_bigint.");
      }
      gl._programCache = gl._programCache || {};
       const opKey = 'multiply_limb';
       let program = gl._programCache[opKey];
       let vertexShader, fragmentShader;

       if (!program) {
         vertexShader = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, multiplyLimbVertexShaderSrc);
         fragmentShader = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, multiplyLimbFragmentShaderSrc);
         program = webglUtilsModule.createProgram(gl, vertexShader, fragmentShader);

         if (program) {
           gl._programCache[opKey] = program;
           if (vertexShader) gl.deleteShader(vertexShader);
           if (fragmentShader) gl.deleteShader(fragmentShader);
         } else {
           if (vertexShader) gl.deleteShader(vertexShader);
           if (fragmentShader) gl.deleteShader(fragmentShader);
           throw new Error("Failed to create shader program for _multiply_limb_by_bigint.");
         }
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
           gl.deleteFramebuffer(fbo);
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
           gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer);
           throw new Error("Failed to read pixel data for _multiply_limb_by_bigint.");
       }

       const resultLimbsFromGPU = new Float32Array(maxLength);
       const carryOutFromGPU = new Float32Array(maxLength);
       for (let i = 0; i < maxLength; i++) {
           resultLimbsFromGPU[i] = outputPixelDataRGBA[i * 4 + 0];
           carryOutFromGPU[i] = outputPixelDataRGBA[i * 4 + 1];
       }

       const finalResultLimbsGPU = [];
       let propagatedCarryGPU = 0;
       for (let i = 0; i < maxLength; i++) {
           let currentProductSum = resultLimbsFromGPU[i] + propagatedCarryGPU;
           finalResultLimbsGPU.push(currentProductSum % BASE);
           propagatedCarryGPU = carryOutFromGPU[i] + Math.floor(currentProductSum / BASE);
       }

       if (propagatedCarryGPU > 0) {
           let currentCarry = propagatedCarryGPU;
           while(currentCarry > 0) {
               finalResultLimbsGPU.push(currentCarry % BASE);
               currentCarry = Math.floor(currentCarry / BASE);
           }
       }

       gl.deleteTexture(texOtherNum); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
       gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer);

       const resultNumWebGL = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
       resultNumWebGL.limbs = finalResultLimbsGPU.length > 0 ? finalResultLimbsGPU : [0];
       resultNumWebGL.sign = 1; // Core methods deal with positive magnitudes
       if (resultNumWebGL.isZero()) resultNumWebGL.sign = 1;
       return resultNumWebGL;
      // --- END OF WEBGL ATTEMPT ---

    } catch (error) {
      // console.warn(`WebGL _multiply_limb_by_bigint failed: ${error.message}. Falling back to CPU.`);

      const resultLimbsCPU = [];
      let carryCPU = 0;
      for (let i = 0; i < otherNumber.limbs.length; i++) {
          const otherLimb = otherNumber.limbs[i] || 0;
          const product = otherLimb * limbValue + carryCPU;
          resultLimbsCPU.push(product % BASE);
          carryCPU = Math.floor(product / BASE);
      }
      while (carryCPU > 0) {
          resultLimbsCPU.push(carryCPU % BASE);
          carryCPU = Math.floor(carryCPU / BASE);
      }

      const resultNumCPU = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
      resultNumCPU.limbs = resultLimbsCPU.length > 0 ? resultLimbsCPU : [0];
      resultNumCPU.sign = 1; // Core methods deal with positive magnitudes
      if (resultNumCPU.isZero()) resultNumCPU.sign = 1;
      return resultNumCPU;
    }
   }

   _core_multiply(num1, num2) {
    // num1 and num2 are expected to be positive, this method is for magnitude.
    // The calling public multiply() method should handle signs.
    // this.forceCPU is used for new instances created here.
    if (num1.isZero() || num2.isZero()) {
        return new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
    }
    let totalResult = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
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
        if (!totalResult) {
            throw new Error("Error during accumulation in _core_multiply.");
        }
    }
    totalResult.sign = 1;
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
            const currentOptions = { forceCPU: self.forceCPU };
            const p0_shifted = new BigIntPrimitive("0", self.canvas, currentOptions);
            if (!p0.isZero()) {
                p0_shifted.limbs = new Array(2 * m).fill(0).concat(p0.limbs);
                p0_shifted.sign = p0.sign; // p0 is magnitude, should be 1
            }
            if (p0_shifted.isZero()) p0_shifted.sign = 1; // Ensure zero is positive
            const p2_shifted = new BigIntPrimitive("0", self.canvas, currentOptions);
            if (!p2.isZero()) {
                p2_shifted.limbs = new Array(m).fill(0).concat(p2.limbs);
                // p2 is (a+b)(c+d) - (p0+p1). (a+b) and (c+d) are positive magnitudes.
                // p0 and p1 are positive magnitudes.
                // So p2 should result from operations on positive magnitudes.
                // The subtract operation itself will set the sign of p2 correctly.
                p2_shifted.sign = p2.sign;
            }
            if (p2_shifted.isZero()) p2_shifted.sign = 1; // Ensure zero is positive
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

  pow(exp) {
    if (typeof exp !== 'number' || !Number.isInteger(exp)) {
      throw new TypeError("Exponent must be an integer.");
    }
    if (exp < 0) {
      throw new TypeError("Exponent must be non-negative.");
    }
    if (exp > 1000000) { // Max exponent from big.js (for non-negative)
        throw new Error("Exponent too large.");
    }

    const currentOptions = { forceCPU: this.forceCPU };

    if (exp === 0) {
      return new BigIntPrimitive("1", this.canvas, currentOptions);
    }
    if (this.isZero()) { // 0^exp = 0 for exp > 0
      return new BigIntPrimitive(this, this.canvas, currentOptions); // Returns a copy of 0
    }
    if (this.limbs.length === 1 && this.limbs[0] === 1) { // '1' or '-1'
        if (this.sign === 1) { // 1^exp = 1
            return new BigIntPrimitive(this, this.canvas, currentOptions); // Returns a copy of 1
        } else { // (-1)^exp
            return exp % 2 === 0 ? new BigIntPrimitive("1", this.canvas, currentOptions) : new BigIntPrimitive(this, this.canvas, currentOptions);
        }
    }
    if (exp === 1) {
      return new BigIntPrimitive(this, this.canvas, currentOptions); // Return a copy
    }

    let res = new BigIntPrimitive("1", this.canvas, currentOptions);
    let currentBase = new BigIntPrimitive(this, this.canvas, currentOptions);
    let e = exp;

    while (e > 0) {
      if (e % 2 === 1) {
        res = res.multiply(currentBase);
      }
      currentBase = currentBase.multiply(currentBase);
      e = Math.floor(e / 2);
    }
    return res;
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
    const currentOptions = { forceCPU: this.forceCPU };
    let low, high;
    if (m <= 0) {
        low = new Ctor("0", this.canvas, currentOptions);
        high = new Ctor(this, this.canvas, currentOptions); // `this` already has options, constructor handles it
        return { low, high };
    }
    if (m >= this.limbs.length) {
        low = new Ctor(this, this.canvas, currentOptions); // `this` already has options
        high = new Ctor("0", this.canvas, currentOptions);
        return { low, high };
    }
    low = new Ctor("0", this.canvas, currentOptions);
    let lowSlice = this.limbs.slice(0, m);
    while (lowSlice.length > 1 && lowSlice[lowSlice.length - 1] === 0) {
        lowSlice.pop();
    }
    if (lowSlice.length === 0 || (lowSlice.length === 1 && lowSlice[0] === 0)) {
        low.limbs = [0];
    } else {
        low.limbs = lowSlice;
    }
    low.sign = low.isZero() ? 1 : 1; // Sign is positive for magnitudes
    // low.forceCPU is already set by its constructor
    high = new Ctor("0", this.canvas, currentOptions);
    let highSlice = this.limbs.slice(m);
    while (highSlice.length > 1 && highSlice[highSlice.length - 1] === 0) {
        highSlice.pop();
    }
    if (highSlice.length === 0 || (highSlice.length === 1 && highSlice[0] === 0)) {
        high.limbs = [0];
    } else {
        high.limbs = highSlice;
    }
    high.sign = high.isZero() ? 1 : 1; // Sign is positive for magnitudes
    // high.forceCPU is already set by its constructor
    return { low, high };
  }

  _multiplyByPowerOfBase(power) {
    const currentOptions = { forceCPU: this.forceCPU };
    if (typeof power !== 'number' || !Number.isInteger(power)) {
      throw new Error("Power must be an integer.");
    }
    if (power < 0) {
      throw new Error("Power must be non-negative for _multiplyByPowerOfBase.");
    }
    if (this.isZero()) {
      return new BigIntPrimitive("0", this.canvas, currentOptions);
    }
    if (power === 0) {
      return new BigIntPrimitive(this, this.canvas, currentOptions); // Constructor handles copying `this`
    }
    const newLimbs = new Array(power).fill(0).concat(this.limbs);
    const Ctor = this.constructor;
    const result = new Ctor("0", this.canvas, currentOptions);
    result.limbs = newLimbs.length > 0 ? newLimbs : [0];
    result.sign = this.sign;
    if (result.limbs.length === 1 && result.limbs[0] === 0) {
        result.sign = 1;
    }
    return result;
  }

  _longDivide(positiveDividend, positiveDivisor) {
    if (!(positiveDividend instanceof BigIntPrimitive) || !(positiveDivisor instanceof BigIntPrimitive)) {
      throw new TypeError("Inputs to _longDivide must be BigIntPrimitive instances.");
    }
    if (positiveDivisor.isZero()) {
      throw new Error("Division by zero");
    }
    const Ctor = this.constructor;
    if (positiveDividend.isZero()) {
      return {
        quotient: new Ctor("0", this.canvas),
        remainder: new Ctor("0", this.canvas)
      };
    }
    const comparison = positiveDividend.compareMagnitude(positiveDivisor);
    if (comparison < 0) {
      return {
        quotient: new Ctor("0", this.canvas),
        remainder: new Ctor(positiveDividend, this.canvas)
      };
    }
    if (comparison === 0) {
      return {
        quotient: new Ctor("1", this.canvas),
        remainder: new Ctor("0", this.canvas)
      };
    }
    let quotientLimbs = [];
    let currentWorkingDividend = new Ctor("0", this.canvas);
    for (let i = positiveDividend.limbs.length - 1; i >= 0; i--) {
      const dividendLimb = positiveDividend.limbs[i];
      currentWorkingDividend = currentWorkingDividend._multiplyByPowerOfBase(1);
      const limbAsBigInt = new Ctor(String(dividendLimb), this.canvas);
      currentWorkingDividend = currentWorkingDividend.add(limbAsBigInt);
      let quotientLimbValue = 0;
      while (!currentWorkingDividend.isZero() && currentWorkingDividend.compareMagnitude(positiveDivisor) >= 0) {
        currentWorkingDividend = currentWorkingDividend._core_subtract(positiveDivisor);
        quotientLimbValue++;
      }
      quotientLimbs.push(quotientLimbValue);
    }
    while (quotientLimbs.length > 1 && quotientLimbs[0] === 0) {
      quotientLimbs.shift();
    }
    let finalQuotientString = "";
    if (quotientLimbs.length === 0) {
        finalQuotientString = "0";
    } else if (quotientLimbs.length === 1 && quotientLimbs[0] === 0) {
        finalQuotientString = "0";
    } else {
        finalQuotientString = String(quotientLimbs[0]);
        for (let k = 1; k < quotientLimbs.length; k++) {
            finalQuotientString += String(quotientLimbs[k]).padStart(BASE_LOG10, '0');
        }
    }
    const finalQuotient = new Ctor(finalQuotientString, this.canvas);
    finalQuotient.sign = 1;
    if (currentWorkingDividend.isZero()) {
        currentWorkingDividend.sign = 1;
    } else {
        currentWorkingDividend.sign = 1;
    }
    return {
        quotient: finalQuotient,
        remainder: currentWorkingDividend
    };
  }

  divideAndRemainder(divisorBigInt) {
    if (!(divisorBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Divisor must be an instance of BigIntPrimitive.");
    }
    if (divisorBigInt.isZero()) {
      throw new Error("Division by zero");
    }
    const quotientSign = (this.sign === divisorBigInt.sign) ? 1 : -1;
    const remainderSign = this.sign;
    const absDividend = this.abs();
    const absDivisor = divisorBigInt.abs();
    const { quotient: absQuotient, remainder: absRemainder } = this._longDivide(absDividend, absDivisor);
    if (absQuotient.isZero()) {
      absQuotient.sign = 1;
    } else {
      absQuotient.sign = quotientSign;
    }
    if (absRemainder.isZero()) {
      absRemainder.sign = 1;
    } else {
      absRemainder.sign = remainderSign;
    }
    return { quotient: absQuotient, remainder: absRemainder };
  }

  cmp(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive for cmp.");
    }

    // Handle zero comparisons
    const thisIsZero = this.isZero();
    const otherIsZero = otherBigInt.isZero();

    if (thisIsZero && otherIsZero) {
      return 0;
    }
    if (thisIsZero) { // other is non-zero
      // Since 0 is normalized to sign 1, if otherBigInt.sign is -1, it's < 0.
      // So, 0 (this) is greater than a negative number.
      return otherBigInt.sign === 1 ? -1 : 1;
    }
    if (otherIsZero) { // this is non-zero
      return this.sign === 1 ? 1 : -1;
    }

    // Compare signs if different
    if (this.sign !== otherBigInt.sign) {
      return this.sign === 1 ? 1 : -1;
    }

    // Signs are the same, compare magnitudes
    // If both positive, the one with larger magnitude is greater.
    // If both negative, the one with larger magnitude is smaller (further from zero).
    if (this.sign === 1) { // Both positive
      return this.compareMagnitude(otherBigInt);
    } else { // Both negative
      return this.compareMagnitude(otherBigInt) * -1;
    }
  }

  eq(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    return this.cmp(otherBigInt) === 0;
  }

  gt(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    return this.cmp(otherBigInt) === 1;
  }

  gte(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    return this.cmp(otherBigInt) >= 0;
  }

  lt(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    return this.cmp(otherBigInt) === -1;
  }

  lte(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    return this.cmp(otherBigInt) <= 0;
  }

  divide(divisorBigInt) {
    const { quotient } = this.divideAndRemainder(divisorBigInt);
    return quotient;
  }

  remainder(divisorBigInt) {
    const { remainder } = this.divideAndRemainder(divisorBigInt);
    return remainder;
  }
}

export { BigIntPrimitive };
