import * as webglUtilsModule from './webgl-utils.js';
import vertexShaderSrc from './shaders/addition.vert?raw';
import fragmentShaderSrc from './shaders/addition.frag?raw';
import subtractVertexShaderSrc from './shaders/subtraction.vert?raw';
import subtractFragmentShaderSrc from './shaders/subtraction.frag?raw';
import multiplyLimbVertexShaderSrc from './shaders/multiply_limb.vert?raw';
import multiplyLimbFragmentShaderSrc from './shaders/multiply_limb.frag?raw';

const KARATSUBA_THRESHOLD = 20;
const BASE_LOG10 = 1;
const BASE = 10;

class BigIntPrimitive {
  static NE = -7;
  static PE = 21;
  static DP = 20; // Default decimal places
  static RM = 1;  // Default rounding mode: roundHalfUp

  // Static rounding mode constants for big.js API compatibility
  static roundDown = 0;
  static roundHalfUp = 1;
  static roundHalfEven = 2;
  static roundUp = 3;

  constructor(value, canvas, options = {}) {
    this.limbs = [];
    this.sign = 1;
    this.exponent = 0;
    this.canvas = canvas;
    this.forceCPU = !!(options && options.forceCPU);

    if (value instanceof BigIntPrimitive) {
      this.limbs = [...value.limbs];
      this.sign = value.sign;
      this.exponent = value.exponent;
      if (value.hasOwnProperty('_roundedDp')) {
        this._roundedDp = value._roundedDp;
      }
      if (!(options && options.hasOwnProperty('forceCPU'))) {
          this.forceCPU = value.forceCPU;
      }
      return;
    }

    if (value === null || value === undefined) {
        throw new TypeError("Invalid input type for BigIntPrimitive: cannot be null or undefined.");
    }

    let stringValue = '';
    if (typeof value === 'number') {
      if (!isFinite(value)) {
          throw new TypeError("Numeric input must be finite.");
      }
      stringValue = String(value);
    } else if (typeof value === 'string') {
      stringValue = value.trim();
    } else {
      throw new TypeError("Invalid input type for BigIntPrimitive. Expected string, number, or BigIntPrimitive instance.");
    }

    if (stringValue === "") {
      this.limbs = [0];
      this.exponent = 0;
      this.sign = 1;
      return;
    }

    if (stringValue.startsWith('-')) {
      this.sign = -1;
      stringValue = stringValue.substring(1);
    } else if (stringValue.startsWith('+')) {
      this.sign = 1;
      stringValue = stringValue.substring(1);
    } else {
      this.sign = 1;
    }

    if (/[^0-9.eE+-]/.test(stringValue)) {
        throw new TypeError("Invalid character in numeric string.");
    }

    let mantissaStr = stringValue;
    let expStr = '';
    let sciExponent = 0;

    const sciNotationIndex = stringValue.toLowerCase().indexOf('e');
    if (sciNotationIndex !== -1) {
        mantissaStr = stringValue.substring(0, sciNotationIndex);
        expStr = stringValue.substring(sciNotationIndex + 1);

        if (expStr === "" || expStr === "+" || expStr === "-") {
            throw new TypeError("Invalid scientific notation: exponent missing or malformed sign.");
        }
        if (!/^[+-]?\d+$/.test(expStr)) {
            throw new TypeError("Invalid scientific notation: exponent contains non-digits or is poorly formed.");
        }
        sciExponent = parseInt(expStr, 10);
        if (String(sciExponent) !== expStr.replace(/^\+/, '')) {
            if (parseFloat(expStr) !== sciExponent) {
                 throw new TypeError("Invalid scientific notation: exponent is not an integer.");
            }
        }
         if (isNaN(sciExponent)) {
            throw new TypeError("Invalid scientific notation: exponent is not a number.");
        }
    }

    if (mantissaStr === "" || mantissaStr === ".") {
         throw new TypeError("Invalid numeric string: empty or invalid mantissa.");
    }
    if (mantissaStr.indexOf('e') !== -1 || mantissaStr.indexOf('E') !== -1) {
        throw new TypeError("Invalid scientific notation: 'e' in mantissa after initial split.");
    }
    if (!/^[0-9.]*$/.test(mantissaStr)) {
         throw new TypeError("Invalid characters in mantissa.");
    }

    const decimalPointIndex = mantissaStr.indexOf('.');
    let coefficientStr = mantissaStr;

    if (decimalPointIndex !== -1) {
      if (mantissaStr.indexOf('.', decimalPointIndex + 1) !== -1) {
          throw new TypeError("Invalid numeric string: multiple decimal points in mantissa.");
      }
      coefficientStr = mantissaStr.replace('.', '');
      this.exponent = sciExponent - (mantissaStr.length - 1 - decimalPointIndex);
    } else {
      this.exponent = sciExponent;
    }

    if (coefficientStr === "") {
        this.limbs = [0];
        this.exponent = 0;
        this.sign = 1;
        return;
    }
    if (!/^\d+$/.test(coefficientStr)) {
        throw new TypeError("Invalid BigInt string format: coefficient contains non-digits.");
    }

    this.limbs = coefficientStr.split('').map(digit => parseInt(digit, 10));

    let leadingZerosToRemove = 0;
    while (leadingZerosToRemove < this.limbs.length -1 && this.limbs[leadingZerosToRemove] === 0) {
        leadingZerosToRemove++;
    }
    if (leadingZerosToRemove > 0) {
        this.limbs.splice(0, leadingZerosToRemove);
    }

    while (this.limbs.length > 1 && this.limbs[this.limbs.length - 1] === 0) {
      this.limbs.pop();
      this.exponent++;
    }

    if (this.limbs.length === 1 && this.limbs[0] === 0) {
      this.exponent = 0;
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
    const this_msd_power = (this.limbs.length - 1) + this.exponent;
    const other_msd_power = (otherBigInt.limbs.length - 1) + otherBigInt.exponent;

    if (this_msd_power > other_msd_power) return 1;
    if (this_msd_power < other_msd_power) return -1;

    const min_power_to_check = Math.min(this.exponent, otherBigInt.exponent);

    for (let current_power = this_msd_power; current_power >= min_power_to_check; current_power--) {
        const k1 = (this.limbs.length - 1) - (current_power - this.exponent);
        const digit1 = (k1 >= 0 && k1 < this.limbs.length) ? this.limbs[k1] : 0;
        const k2 = (otherBigInt.limbs.length - 1) - (current_power - otherBigInt.exponent);
        const digit2 = (k2 >= 0 && k2 < otherBigInt.limbs.length) ? otherBigInt.limbs[k2] : 0;

        if (digit1 > digit2) return 1;
        if (digit1 < digit2) return -1;
    }
    return 0;
  }

  cmp(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    const thisIsZero = this.isZero();
    const otherIsZero = otherBigInt.isZero();

    if (thisIsZero && otherIsZero) { return 0; }
    if (this.sign !== otherBigInt.sign) {
        return this.sign > otherBigInt.sign ? 1 : -1;
    }
    let magResult = this.compareMagnitude(otherBigInt);
    if (this.sign === 1) {
        return magResult;
    } else {
        return magResult === 0 ? 0 : -magResult;
    }
  }

  eq(other) { return this.cmp(other) === 0; }
  gt(other) { return this.cmp(other) > 0; }
  gte(other) { return this.cmp(other) >= 0; }
  lt(other) { return this.cmp(other) < 0; }
  lte(other) { return this.cmp(other) <= 0; }

  // big.js API aliases
  plus(n) { return this.add(n); }
  minus(n) { return this.subtract(n); }
  times(n) { return this.multiply(n); }
  div(n) { return this.divide(n); }
  mod(n) { return this.remainder(n); }
  neg() { return this.negate(); }


  toString() {
    const isZeroMagnitude = this.limbs.length === 1 && this.limbs[0] === 0;
    if (isZeroMagnitude) {
        if (typeof this._roundedDp === 'number' && this._roundedDp > 0) {
            return (this.sign === -1 ? "-" : "") + '0.' + '0'.repeat(this._roundedDp);
        }
        return "0";
    }

    let coefficientString = this.limbs.join('');
    let s;
    const e = this.exponent;
    const len = coefficientString.length;
    const decimalPointActualPosition = len + e;

    const useSciNotation = (typeof this._roundedDp !== 'number') &&
                           (decimalPointActualPosition <= BigIntPrimitive.NE || decimalPointActualPosition > BigIntPrimitive.PE);

    if (useSciNotation) {
      s = coefficientString[0];
      if (len > 1) { s += '.' + coefficientString.substring(1); }
      const expVal = decimalPointActualPosition - 1;
      s += 'e' + (expVal >= 0 ? '+' : '') + expVal;
      if (s.includes('.')) { s = s.replace(/\.0+e/, 'e').replace(/(\.[0-9]*[1-9])0+e/, '$1e');}
    } else {
      if (e < 0) {
        if (decimalPointActualPosition > 0) {
          s = coefficientString.substring(0, decimalPointActualPosition) + '.' + coefficientString.substring(decimalPointActualPosition);
        } else {
          s = '0.' + '0'.repeat(-decimalPointActualPosition) + coefficientString;
        }
      } else {
        s = coefficientString + '0'.repeat(e);
      }

      if (typeof this._roundedDp === 'number') {
          let [integerPart, fractionalPart = ''] = s.split('.');
          if (this._roundedDp > 0) {
              fractionalPart = fractionalPart.padEnd(this._roundedDp, '0').substring(0, this._roundedDp);
              s = integerPart + '.' + fractionalPart;
          } else if (this._roundedDp === 0) {
              s = integerPart;
          }
      } else if (s.includes('.')) {
          s = s.replace(/\.?0+$/, '');
          if (s.startsWith('.')) s = '0' + s;
      }
      if (s === "") s = "0";
    }
    return (this.sign === -1 ? "-" : "") + s;
  }

  toNumber() { return parseFloat(this.toString()); }
  toJSON() { return this.toString(); }
  valueOf() { return this.toString(); }
  isZero() { return this.limbs.length === 1 && this.limbs[0] === 0 && this.exponent === 0; }

  _core_add(positiveOtherBigInt) {
      let arr1 = [...this.limbs].reverse();
      let arr2 = [...positiveOtherBigInt.limbs].reverse();
      let resultLimbsReversed = [];
      let carry = 0;
      const len1 = arr1.length;
      const len2 = arr2.length;
      const maxLength = Math.max(len1, len2);
      for (let i = 0; i < maxLength; i++) {
        const digit1 = arr1[i] || 0;
        const digit2 = arr2[i] || 0;
        const sum = digit1 + digit2 + carry;
        resultLimbsReversed.push(sum % BASE);
        carry = Math.floor(sum / BASE);
      }
      if (carry > 0) { resultLimbsReversed.push(carry); }
      let finalResultLimbs = resultLimbsReversed.reverse();
      while (finalResultLimbs.length > 1 && finalResultLimbs[0] === 0) { finalResultLimbs.shift(); }
      if (finalResultLimbs.length === 0) { finalResultLimbs = [0];}
      const resultNumCPU = new this.constructor("0", this.canvas, { forceCPU: true });
      resultNumCPU.limbs = finalResultLimbs;
      resultNumCPU.sign = 1;
      if (resultNumCPU.isZero()) { resultNumCPU.exponent = 0; }
      return resultNumCPU;
  }

  add(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive."); }

    let gl;
    // Attempt WebGL Path
    if (!this.forceCPU && this.canvas && typeof webglUtilsModule !== 'undefined' && webglUtilsModule.initWebGL && vertexShaderSrc && fragmentShaderSrc) {
      gl = webglUtilsModule.initWebGL(this.canvas);
      if (gl) {
        try {
          const maxLength = Math.max(this.limbs.length, otherBigInt.limbs.length);

          // Prepare input data (LSB first for texture)
          const num1LimbsData = new Float32Array(maxLength);
          const num2LimbsData = new Float32Array(maxLength);
          const carryInData = new Float32Array(maxLength).fill(0); // Initial carries are 0

          for (let i = 0; i < this.limbs.length; i++) num1LimbsData[i] = this.limbs[this.limbs.length - 1 - i];
          for (let i = 0; i < otherBigInt.limbs.length; i++) num2LimbsData[i] = otherBigInt.limbs[otherBigInt.limbs.length - 1 - i];

          // Create shader program
          const program = webglUtilsModule.createProgram(gl, vertexShaderSrc, fragmentShaderSrc);
          if (!program) throw new Error("Failed to create shader program.");

          const positionAttributeLocation = gl.getAttribLocation(program, "a_position");
          const texCoordAttributeLocation = gl.getAttribLocation(program, "a_texCoord");

          const uNum1TextureLocation = gl.getUniformLocation(program, "u_num1Texture");
          const uNum2TextureLocation = gl.getUniformLocation(program, "u_num2Texture");
          const uCarryTextureLocation = gl.getUniformLocation(program, "u_carryTexture");

          // Simple quad covering the viewport
          const positionBuffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

          const texCoordBuffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);

          // Create input textures
          const texNum1 = webglUtilsModule.createDataTexture(gl, num1LimbsData, maxLength, 1, false);
          const texNum2 = webglUtilsModule.createDataTexture(gl, num2LimbsData, maxLength, 1, false);
          const texCarryIn = webglUtilsModule.createDataTexture(gl, carryInData, maxLength, 1, false);

          // Create output texture and framebuffer
          const texOutput = webglUtilsModule.createDataTexture(gl, null, maxLength, 1, true); // RGBA output
          const framebuffer = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);

          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error("Framebuffer incomplete.");
          }

          // Execute Shader
          gl.viewport(0, 0, maxLength, 1);
          gl.useProgram(program);

          gl.enableVertexAttribArray(positionAttributeLocation);
          gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
          gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

          gl.enableVertexAttribArray(texCoordAttributeLocation);
          gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
          gl.vertexAttribPointer(texCoordAttributeLocation, 2, gl.FLOAT, false, 0, 0);

          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texNum1); gl.uniform1i(uNum1TextureLocation, 0);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNum2); gl.uniform1i(uNum2TextureLocation, 1);
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texCarryIn); gl.uniform1i(uCarryTextureLocation, 2);

          gl.drawArrays(gl.TRIANGLES, 0, 6);

          // Read results
          const resultData = webglUtilsModule.readDataFromTexture(gl, framebuffer, maxLength, 1, true);

          // Process results (resultData is [LSB_limb_sum, LSB_carry_out, LSB+1_limb_sum, LSB+1_carry_out, ...])
          // Shader computes: shaderResultLimb = (l1[i]+l2[i]+carryInTex[i]) % BASE
          //                   shaderCarryOut = floor((l1[i]+l2[i]+carryInTex[i])/BASE)
          // Since carryInTex is all zeros for this simple one-pass attempt:
          // shaderResultLimb = (l1[i]+l2[i]) % BASE
          // shaderCarryOut   = floor((l1[i]+l2[i])/BASE)

          let processedLimbs = [];
          let accumulatedCPUCarry = 0;
          for (let i = 0; i < maxLength; i++) {
              let limbSumFromShader = resultData[i * 4 + 0]; // This is essentially (l1[i] + l2[i]) % BASE
              let carryDirectlyFromShaderSum = resultData[i * 4 + 1]; // This is floor((l1[i] + l2[i]) / BASE)

              // Add accumulated CPU carry to the shader's summed limb (which was sum % BASE)
              let currentPositionSum = limbSumFromShader + accumulatedCPUCarry;

              processedLimbs.push(currentPositionSum % BASE);

              // New CPU carry = carry from (shader_limb_sum + previous_cpu_carry) + direct_carry_from_shader_for_this_position
              accumulatedCPUCarry = Math.floor(currentPositionSum / BASE) + carryDirectlyFromShaderSum;
          }

          // If there's a final carry after iterating through all limbs
          if (accumulatedCPUCarry > 0) {
              // Handle multi-digit carry if accumulatedCPUCarry itself is >= BASE
              while(accumulatedCPUCarry > 0) {
                processedLimbs.push(accumulatedCPUCarry % BASE);
                accumulatedCPUCarry = Math.floor(accumulatedCPUCarry / BASE);
              }
          }

          // Remove trailing zeros that might exist if sum is shorter than maxLength (e.g. 1 + (-1) via CPU path)
          // For WebGL path, this mainly handles if the sum was shorter than maxLength.
          while (processedLimbs.length > 1 && processedLimbs[processedLimbs.length - 1] === 0) {
            processedLimbs.pop();
          }
          if (processedLimbs.length === 0) processedLimbs.push(0); // Should not happen if inputs are valid

          const finalResult = new this.constructor("0", this.canvas, {forceCPU: true});
          finalResult.limbs = processedLimbs.reverse(); // Reverse to MSB first for constructor/internal representation

          // Exponent and sign (simplified for same-sign addition)
          const commonExponent = Math.min(this.exponent, otherBigInt.exponent);
          finalResult.exponent = commonExponent;
          finalResult.sign = this.sign;

          // Normalize (e.g. if result is 0)
          if (finalResult.isZero()) {
            finalResult.sign = 1;
            finalResult.exponent = 0;
          } else {
            // Adjust exponent for trailing zeros in limbs (if any, though CPU carry should handle this)
             while (finalResult.limbs.length > 1 && finalResult.limbs[finalResult.limbs.length - 1] === 0) {
                finalResult.limbs.pop();
                finalResult.exponent++;
            }
          }

          // Cleanup
          gl.deleteTexture(texNum1);
          gl.deleteTexture(texNum2);
          gl.deleteTexture(texCarryIn);
          gl.deleteTexture(texOutput);
          gl.deleteFramebuffer(framebuffer);
          // If shaders are stored on the program object by createProgram (as in the updated mock)
          if (program && program._vertexShader) {
            gl.deleteShader(program._vertexShader);
          }
          if (program && program._fragmentShader) {
            gl.deleteShader(program._fragmentShader);
          }
          gl.deleteProgram(program);
          gl.deleteBuffer(positionBuffer);
          gl.deleteBuffer(texCoordBuffer);

          return finalResult;

        } catch (e) {
          console.error("WebGL addition failed, falling back to CPU:", e);
          // Fallback to CPU path will happen naturally if this block doesn't return.
        }
      }
    }
    // CPU Path (existing logic)
    if (this.isZero()) {
      const result = new this.constructor(otherBigInt, this.canvas);
      result.forceCPU = this.forceCPU || otherBigInt.forceCPU;
      return result;
    }
    if (otherBigInt.isZero()) {
      const result = new this.constructor(this, this.canvas);
      result.forceCPU = this.forceCPU || otherBigInt.forceCPU;
      return result;
    }
    const result = new this.constructor("0", this.canvas, { forceCPU: this.forceCPU || otherBigInt.forceCPU });
    if (this.sign === otherBigInt.sign) {
      const commonExponent = Math.min(this.exponent, otherBigInt.exponent);
      const tempThis = new this.constructor("0", this.canvas, { forceCPU: true });
      tempThis.limbs = [...this.limbs];
      for (let i = 0; i < (this.exponent - commonExponent); i++) { tempThis.limbs.push(0); }
      tempThis.sign = 1;
      const tempOther = new this.constructor("0", this.canvas, { forceCPU: true });
      tempOther.limbs = [...otherBigInt.limbs];
      for (let i = 0; i < (otherBigInt.exponent - commonExponent); i++) { tempOther.limbs.push(0); }
      tempOther.sign = 1;
      const sumMagnitudeResult = tempThis._core_add(tempOther);
      result.limbs = sumMagnitudeResult.limbs;
      result.exponent = commonExponent;
      result.sign = this.sign;
    } else {
      return this.subtract(otherBigInt.negate());
    }
    if (result.isZero()) {
      result.sign = 1; result.exponent = 0;
    } else {
      while (result.limbs.length > 1 && result.limbs[result.limbs.length - 1] === 0) {
        result.limbs.pop(); result.exponent++;
      }
    }
    return result;
  }

  _core_subtract(positiveOtherBigInt) {
      let minuendLimbs = [...this.limbs].reverse();
      let subtrahendLimbs = [...positiveOtherBigInt.limbs].reverse();
      let resultLimbsReversed = [];
      let borrow = 0;
      const len1 = minuendLimbs.length;
      for (let i = 0; i < len1; i++) {
        let digit1 = minuendLimbs[i];
        const digit2 = subtrahendLimbs[i] || 0;
        let diff = digit1 - borrow - digit2;
        if (diff < 0) { diff += BASE; borrow = 1; } else { borrow = 0; }
        resultLimbsReversed.push(diff);
      }
      let finalResultLimbs = resultLimbsReversed.reverse();
      while (finalResultLimbs.length > 1 && finalResultLimbs[0] === 0) { finalResultLimbs.shift(); }
      if (finalResultLimbs.length === 0) { finalResultLimbs = [0]; }
      const resultNumCPU = new BigIntPrimitive("0");
      resultNumCPU.canvas = this.canvas;
      resultNumCPU.forceCPU = this.forceCPU;
      resultNumCPU.limbs = finalResultLimbs;
      resultNumCPU.sign = 1;
      if (resultNumCPU.isZero()) { resultNumCPU.sign = 1; resultNumCPU.exponent = 0;}
      return resultNumCPU;
  }

  subtract(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive."); }
    const result = new this.constructor("0", this.canvas, { forceCPU: this.forceCPU || otherBigInt.forceCPU });
    if (this.sign !== otherBigInt.sign) {
      const termToAdd = new this.constructor(otherBigInt, this.canvas, { forceCPU: otherBigInt.forceCPU });
      termToAdd.sign = -termToAdd.sign;
      return this.add(termToAdd);
    }
    const commonExponent = Math.min(this.exponent, otherBigInt.exponent);
    let thisLimbsAligned = [...this.limbs];
    let thisExpDiff = this.exponent - commonExponent;
    for (let i = 0; i < thisExpDiff; i++) { thisLimbsAligned.push(0); }
    let otherLimbsAligned = [...otherBigInt.limbs];
    let otherExpDiff = otherBigInt.exponent - commonExponent;
    for (let i = 0; i < otherExpDiff; i++) { otherLimbsAligned.push(0); }
    let comparison = 0;
    if (thisLimbsAligned.length > otherLimbsAligned.length) comparison = 1;
    else if (thisLimbsAligned.length < otherLimbsAligned.length) comparison = -1;
    else {
      for(let i=0; i < thisLimbsAligned.length; i++) {
        if(thisLimbsAligned[i] > otherLimbsAligned[i]) { comparison = 1; break; }
        if(thisLimbsAligned[i] < otherLimbsAligned[i]) { comparison = -1; break; }
      }
    }
    if (comparison === 0) {
      result.limbs = [0]; result.exponent = 0; result.sign = 1; return result;
    }
    const tempMinuend = new this.constructor("0", this.canvas, { forceCPU: true });
    const tempSubtrahend = new this.constructor("0", this.canvas, { forceCPU: true });
    if (comparison > 0) {
      tempMinuend.limbs = thisLimbsAligned; tempSubtrahend.limbs = otherLimbsAligned; result.sign = this.sign;
    } else {
      tempMinuend.limbs = otherLimbsAligned; tempSubtrahend.limbs = thisLimbsAligned; result.sign = -this.sign;
    }
    const coreResult = tempMinuend._core_subtract(tempSubtrahend);
    result.limbs = coreResult.limbs; result.exponent = commonExponent;
    if (result.isZero()) { result.sign = 1; result.exponent = 0;}
    else {
      while (result.limbs.length > 1 && result.limbs[result.limbs.length - 1] === 0) {
        result.limbs.pop(); result.exponent++;
      }
    }
    return result;
  }

  _multiply_limb_by_bigint(limbValue, otherNumber) {
      const otherLimbsReversed = [...otherNumber.limbs].reverse();
      let resultLimbsReversed = [];
      let carry = 0;
      for (let i = 0; i < otherLimbsReversed.length; i++) {
        const digit = otherLimbsReversed[i];
        const product = digit * limbValue + carry;
        resultLimbsReversed.push(product % BASE);
        carry = Math.floor(product / BASE);
      }
      while (carry > 0) { resultLimbsReversed.push(carry % BASE); carry = Math.floor(carry / BASE); }
      let finalResultLimbs = resultLimbsReversed.reverse();
      if (finalResultLimbs.length === 0) { finalResultLimbs = [0]; }
      while (finalResultLimbs.length > 1 && finalResultLimbs[0] === 0) { finalResultLimbs.shift(); }
      const resultNumCPU = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
      resultNumCPU.limbs = finalResultLimbs;
      resultNumCPU.sign = 1;
      resultNumCPU.exponent = otherNumber.exponent;
      if (resultNumCPU.isZero()) { resultNumCPU.sign = 1; resultNumCPU.exponent = 0; }
      return resultNumCPU;
  }

   _core_multiply(num1, num2) {
    if (num1.isZero() || num2.isZero()) {
        return new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    }
    let totalResult = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    const n1_limbs_reversed = [...num1.limbs].reverse();
    for (let i = 0; i < n1_limbs_reversed.length; i++) {
        const digitOfNum1 = n1_limbs_reversed[i];
        if (digitOfNum1 === 0) { continue; }
        let partialProductMagnitude = this._multiply_limb_by_bigint(digitOfNum1, num2);
        if (partialProductMagnitude.isZero()) { continue; }
        const shiftedPartialProduct = new BigIntPrimitive(partialProductMagnitude, this.canvas, { forceCPU: true });
        shiftedPartialProduct.exponent += i;
        totalResult = totalResult.add(shiftedPartialProduct);
    }
    if (totalResult.limbs.length === 1 && totalResult.limbs[0] === 0) {
        totalResult.sign = 1; totalResult.exponent = 0;
    } else {
      while (totalResult.limbs.length > 1 && totalResult.limbs[totalResult.limbs.length - 1] === 0) {
        totalResult.limbs.pop();
      }
      if (totalResult.limbs.length === 0) { totalResult.limbs = [0]; }
    }
    totalResult.sign = 1;
    totalResult.exponent = 0;
    return totalResult;
  }

  multiply(otherBigInt) {
    const self = this;
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive."); }
    if (self.isZero() || otherBigInt.isZero()) {
        return new BigIntPrimitive("0", self.canvas, { forceCPU: self.forceCPU || otherBigInt.forceCPU });
    }
    const finalExponent = self.exponent + otherBigInt.exponent;
    const resultSign = (self.sign === otherBigInt.sign) ? 1 : -1;
    const tempNum1Original = self.abs();
    let tempNum1Limbs = [...tempNum1Original.limbs];
    if (tempNum1Original.exponent > 0) {
        for (let k = 0; k < tempNum1Original.exponent; k++) tempNum1Limbs.push(0);
    }
    const tempNum1 = new BigIntPrimitive("0", self.canvas, { forceCPU: true });
    tempNum1.limbs = tempNum1Limbs; tempNum1.sign = 1; tempNum1.exponent = 0;
    const tempNum2Original = otherBigInt.abs();
    let tempNum2Limbs = [...tempNum2Original.limbs];
    if (tempNum2Original.exponent > 0) {
        for (let k = 0; k < tempNum2Original.exponent; k++) tempNum2Limbs.push(0);
    }
    const tempNum2 = new BigIntPrimitive("0", self.canvas, { forceCPU: true });
    tempNum2.limbs = tempNum2Limbs; tempNum2.sign = 1; tempNum2.exponent = 0;
    let absResult;
    let gl;
    if (!self.forceCPU && !otherBigInt.forceCPU && self.canvas && typeof webglUtilsModule !== 'undefined' && (gl = webglUtilsModule.initWebGL(self.canvas))) {
    }
    if (tempNum1.limbs.length < KARATSUBA_THRESHOLD || tempNum2.limbs.length < KARATSUBA_THRESHOLD) {
        absResult = self._core_multiply(tempNum1, tempNum2);
    } else {
        const n = Math.max(tempNum1.limbs.length, tempNum2.limbs.length);
        const m = Math.floor(n / 2);
        if (m === 0) { absResult = self._core_multiply(tempNum1, tempNum2);
        } else {
            const { low: b, high: a } = tempNum1._splitAt(m);
            const { low: d, high: c } = tempNum2._splitAt(m);
            const p0 = a.multiply(c);
            const p1 = b.multiply(d);
            const sum_ab = a.add(b);
            const sum_cd = c.add(d);
            const p2_temp = sum_ab.multiply(sum_cd);
            const p0_plus_p1 = p0.add(p1);
            const p2 = p2_temp.subtract(p0_plus_p1);
            const p0_shifted = p0._multiplyByPowerOfBase(2 * m);
            const p2_shifted = p2._multiplyByPowerOfBase(m);
            let tempSum = p0_shifted.add(p2_shifted);
            absResult = tempSum.add(p1);
        }
    }
    absResult.exponent = finalExponent;
    absResult.sign = resultSign;
    if (absResult.limbs.length === 1 && absResult.limbs[0] === 0) {
        absResult.sign = 1; absResult.exponent = 0;
    } else {
         while (absResult.limbs.length > 1 && absResult.limbs[absResult.limbs.length - 1] === 0) {
            absResult.limbs.pop(); absResult.exponent++;
        }
    }
    return absResult;
  }

  pow(exp) {
    if (typeof exp !== 'number' || !Number.isInteger(exp)) { throw new TypeError("Exponent must be an integer."); }
    if (exp < 0) { throw new TypeError("Exponent must be non-negative."); }
    if (exp > 1000000) { throw new Error("Exponent too large.");}
    const currentOptions = { forceCPU: this.forceCPU };
    if (exp === 0) { return new BigIntPrimitive("1", this.canvas, currentOptions); }
    if (this.isZero()) { return new BigIntPrimitive(this, this.canvas, currentOptions); }
    if (this.limbs.length === 1 && this.limbs[0] === 1 && this.exponent === 0) {
        if (this.sign === 1) { return new BigIntPrimitive(this, this.canvas, currentOptions); }
        else { return exp % 2 === 0 ? new BigIntPrimitive("1", this.canvas, currentOptions) : new BigIntPrimitive(this, this.canvas, currentOptions); }
    }
    if (exp === 1) { return new BigIntPrimitive(this, this.canvas, currentOptions); }
    let res = new BigIntPrimitive("1", this.canvas, currentOptions);
    let currentBase = new BigIntPrimitive(this, this.canvas, currentOptions);
    let e = exp;
    while (e > 0) {
      if (e % 2 === 1) { res = res.multiply(currentBase); }
      currentBase = currentBase.multiply(currentBase);
      e = Math.floor(e / 2);
    }
    return res;
  }

  _shiftLeft(numLimbsToShift) {
    if (numLimbsToShift < 0) { throw new Error("numLimbsToShift must be non-negative.");}
    if (this.isZero() || numLimbsToShift === 0) { return new BigIntPrimitive(this, this.canvas); }
    const result = new BigIntPrimitive(this, this.canvas);
    result.exponent += numLimbsToShift;
    return result;
  }

  _splitAt(m) {
    const Ctor = this.constructor; const currentOptions = { forceCPU: this.forceCPU };
    let s = this.abs().toString();
    if (s.includes('e')) {
        const [coeff, expStr] = s.split('e');
        const expVal = parseInt(expStr);
        let [intPart, fracPart=""] = coeff.split('.');
        if(!fracPart) fracPart = "";
        if (expVal >= 0) {
            const digitsToMove = Math.min(expVal, fracPart.length);
            s = intPart + fracPart.substring(0, digitsToMove);
            fracPart = fracPart.substring(digitsToMove);
            s += '0'.repeat(expVal - digitsToMove);
            if (fracPart.length > 0) s += '.' + fracPart;
        } else {
            const digitsToMove = Math.abs(expVal);
            s = '0'.repeat(Math.max(0, digitsToMove - intPart.length +1)) + intPart + fracPart;
            const decPos = s.length - fracPart.length - digitsToMove;
            s = s.substring(0, decPos) + '.' + s.substring(decPos);
            if(s.startsWith('.')) s = '0' + s;
            if(s.endsWith('.')) s = s.substring(0, s.length -1);
        }
        s = s.replace(/^0+([1-9])/ , '$1').replace(/^0+\./, '0.');
        if (s===".") s = "0";
    }
    s = s.split('.')[0];
    let lowStr, highStr;
    if (m <= 0) { highStr = s; lowStr = "0"; }
    else if (m >= s.length) { lowStr = s; highStr = "0"; }
    else {
        highStr = s.substring(0, s.length - m);
        lowStr = s.substring(s.length - m);
    }
    const high = new Ctor(highStr, this.canvas, currentOptions);
    const low = new Ctor(lowStr, this.canvas, currentOptions);
    return { low, high };
  }

  _multiplyByPowerOfBase(power) {
    const currentOptions = { forceCPU: this.forceCPU };
    if (typeof power !== 'number' || !Number.isInteger(power)) { throw new Error("Power must be an integer.");}
    if (this.isZero()) { return new BigIntPrimitive("0", this.canvas, currentOptions); }
    if (power === 0) { return new BigIntPrimitive(this, this.canvas, currentOptions); }
    const result = new BigIntPrimitive(this, this.canvas, currentOptions);
    if (power < 0) {
        throw new Error("Power must be non-negative for _multiplyByPowerOfBase as currently used.");
    }
    result.exponent += power;
    return result;
  }

  _longDivide(positiveDividend, positiveDivisor) {
    if (!(positiveDividend instanceof BigIntPrimitive) || !(positiveDivisor instanceof BigIntPrimitive)) { throw new TypeError("Inputs to _longDivide must be BigIntPrimitive instances.");}
    if (positiveDivisor.isZero()) { throw new Error("Division by zero"); }
    const Ctor = this.constructor;
    const currentOptions = { canvas: this.canvas, forceCPU: true };

    if (positiveDividend.isZero()) { return { quotient: new Ctor("0", null, currentOptions), remainder: new Ctor("0", null, currentOptions) }; }

    // Use a special toString variant if available, or ensure PE/NE are set for plain format
    const originalPE = Ctor.PE; const originalNE = Ctor.NE;
    let dividendStr, divisorStr;
    try {
      Ctor.PE = 1000000; Ctor.NE = -1000000; // Force plain string output
      dividendStr = positiveDividend.abs().toString();
      divisorStr = positiveDivisor.abs().toString();
    } finally {
      Ctor.PE = originalPE; Ctor.NE = originalNE; // Restore PE/NE
    }

    // Handle potential decimal points by scaling
    let dividendScale = 0;
    if (dividendStr.includes('.')) {
      dividendScale = dividendStr.length - dividendStr.indexOf('.') - 1;
      dividendStr = dividendStr.replace('.', '');
    } else if (dividendStr.includes('e')) { // Handle scientific notation from toString if PE/NE not high enough
        const tempN = new Ctor(dividendStr); // Parse it properly
        dividendStr = tempN.limbs.join('') + '0'.repeat(Math.max(0,tempN.exponent));
        dividendScale = -Math.min(0, tempN.exponent);
    }


    let divisorScale = 0;
    if (divisorStr.includes('.')) {
      divisorScale = divisorStr.length - divisorStr.indexOf('.') - 1;
      divisorStr = divisorStr.replace('.', '');
    } else if (divisorStr.includes('e')) {
        const tempN = new Ctor(divisorStr);
        divisorStr = tempN.limbs.join('') + '0'.repeat(Math.max(0,tempN.exponent));
        divisorScale = -Math.min(0, tempN.exponent);
    }

    // Pad with zeros to make scales equal for BigInt conversion
    const scaleDiff = dividendScale - divisorScale;
    if (scaleDiff > 0) { // dividend has more decimal places originally
      divisorStr += '0'.repeat(scaleDiff);
    } else if (scaleDiff < 0) { // divisor has more decimal places originally
      dividendStr += '0'.repeat(-scaleDiff);
    }
    const commonExponentAdjustment = Math.max(dividendScale, divisorScale);

    if (divisorStr === "" || BigInt(divisorStr) === 0n) throw new Error("Division by zero after string processing.");
    if (dividendStr === "") dividendStr = "0"; // Should not happen if not zero initially

    const biDividend = BigInt(dividendStr);
    const biDivisor = BigInt(divisorStr);

    const biQuotient = biDividend / biDivisor;
    const biRemainder = biDividend % biDivisor;

    let quotient = new Ctor(biQuotient.toString(), null, currentOptions);
    let remainder = new Ctor(biRemainder.toString(), null, currentOptions);

    if (!remainder.isZero()) {
      remainder.exponent = (remainder.exponent || 0) - commonExponentAdjustment;
      // Normalize remainder exponent and limbs
        while (remainder.limbs.length > 1 && remainder.limbs[remainder.limbs.length - 1] === 0 && remainder.exponent < 0) {
            remainder.limbs.pop();
            remainder.exponent++;
        }
         if (remainder.limbs.length === 1 && remainder.limbs[0] === 0) {
            remainder.exponent = 0; remainder.sign = 1;
        }
    }
    return { quotient: quotient, remainder: remainder };
  }

  divideAndRemainder(divisorBigInt) {
    if (!(divisorBigInt instanceof BigIntPrimitive)) { throw new TypeError("Divisor must be an instance of BigIntPrimitive."); }
    if (divisorBigInt.isZero()) { throw new Error("Division by zero"); }

    const quotientSign = (this.sign === divisorBigInt.sign || this.isZero()) ? 1 : -1;
    const remainderSign = this.isZero() ? 1 : this.sign;

    const absDividend = this.abs();
    const absDivisor = divisorBigInt.abs();

    const { quotient: absQuotient, remainder: absRemainder } = this._longDivide(absDividend, absDivisor);

    absQuotient.sign = absQuotient.isZero() ? 1 : quotientSign;
    absRemainder.sign = absRemainder.isZero() ? 1 : remainderSign;

    return { quotient: absQuotient, remainder: absRemainder };
  }

  divide(divisorBigInt) {
    const Ctor = this.constructor;
    if (!(divisorBigInt instanceof BigIntPrimitive)) { throw new TypeError("Divisor must be an instance of BigIntPrimitive."); }
    if (divisorBigInt.isZero()) { throw new Error("Division by zero"); }

    let precisionScale = Ctor.DP + 10;
    const thisIntDigits = Math.max(1, (this.limbs.length + this.exponent));
    const divisorIntDigits = Math.max(1, (divisorBigInt.limbs.length + divisorBigInt.exponent));
    precisionScale = Math.max(precisionScale, Ctor.DP + Math.abs(thisIntDigits - divisorIntDigits) + 10); // Increased guard

    const tempDividend = new Ctor(this, this.canvas);
    if (!tempDividend.isZero()) {
        tempDividend.exponent += precisionScale;
    }

    // Make sure signs are handled correctly for the division part
    const scaledDividendForDiv = new Ctor(tempDividend.abs(), this.canvas);
    const { quotient: scaledQuotient } = scaledDividendForDiv.divideAndRemainder(divisorBigInt.abs()); // Use abs for divisor too

    if (!scaledQuotient.isZero()) {
      scaledQuotient.exponent -= precisionScale;
      // Set sign based on original inputs
      scaledQuotient.sign = (this.sign === divisorBigInt.sign || scaledQuotient.isZero()) ? 1 : -1;

      // Normalize exponent and limbs
        while (scaledQuotient.limbs.length > 0 && scaledQuotient.limbs.length > 1 && scaledQuotient.limbs[scaledQuotient.limbs.length - 1] === 0 && scaledQuotient.exponent < 0) {
            scaledQuotient.limbs.pop();
            scaledQuotient.exponent++;
        }
         if (scaledQuotient.limbs.length === 0) scaledQuotient.limbs = [0]; // Should not happen if not zero
        if (scaledQuotient.isZero()) { // Check if it became zero after normalization
            scaledQuotient.exponent = 0;
            scaledQuotient.sign = 1;
        }
    } else {
        scaledQuotient.sign = 1; // Ensure zero has positive sign
    }
    return scaledQuotient; // Caller is responsible for rounding.
  }
  remainder(divisorBigInt) { const { remainder } = this.divideAndRemainder(divisorBigInt); return remainder; }

  static _staticRound(inputLimbsMsbFirst, inputExponent, inputSign, dpUndefined, rmUndefined) {
    const dp = dpUndefined === undefined ? 0 : dpUndefined;
    const rm = rmUndefined === undefined ? BigIntPrimitive.RM : rmUndefined;

    const tempNumForStr = new BigIntPrimitive("0");
    tempNumForStr.limbs = [...inputLimbsMsbFirst];
    tempNumForStr.exponent = inputExponent;

    if (tempNumForStr.limbs.length === 1 && tempNumForStr.limbs[0] === 0) {
      return { limbs: [0], exponent: 0, sign: 1 };
    }

    const originalPETemp = BigIntPrimitive.PE;
    const originalNETemp = BigIntPrimitive.NE;
    BigIntPrimitive.PE = 100000;
    BigIntPrimitive.NE = -100000;
    let s = tempNumForStr.toString();
    BigIntPrimitive.PE = originalPETemp;
    BigIntPrimitive.NE = originalNETemp;

    let [integerS, fractionalS = ''] = s.split('.');
    if (integerS === "" && fractionalS !== "") integerS = "0";
    if (integerS === "") integerS = "0";

    let applyRoundingEffect = 0;
    const initialIntegerLength = integerS.length;

    if (dp >= 0) {
        if (dp >= fractionalS.length) {
            // No rounding decision based on further digits
        } else {
            const roundDigitVal = parseInt(fractionalS[dp], 10);
            const trailingDigitsStr = fractionalS.substring(dp + 1);
            const hasNonZeroTrailing = !/^[0]*$/.test(trailingDigitsStr);
            const isExactlyHalfWay = roundDigitVal === 5 && !hasNonZeroTrailing;

            switch (rm) {
                case 0: break;
                case 1: if (roundDigitVal >= 5) applyRoundingEffect = 1; break;
                case 2:
                    if (roundDigitVal > 5) applyRoundingEffect = 1;
                    else if (isExactlyHalfWay) {
                        const prevDigit = dp > 0 ? parseInt(fractionalS[dp - 1], 10) : parseInt(integerS[integerS.length - 1] || '0', 10);
                        if (prevDigit % 2 !== 0) applyRoundingEffect = 1;
                    } else if (roundDigitVal === 5 && hasNonZeroTrailing) {
                        applyRoundingEffect = 1;
                    }
                    break;
                case 3: if (!/^[0]*$/.test(fractionalS.substring(dp))) applyRoundingEffect = 1; break;
            }
            fractionalS = fractionalS.substring(0, dp);
        }
    } else {
        const roundPosInInt = integerS.length + dp;
        let originalFractionalForCheck = fractionalS;
        fractionalS = '';

        if (roundPosInInt <= 0) {
            const isGreaterThanZero = integerS !== "0" || !/^[0]*$/.test(originalFractionalForCheck);
            let effectiveFirstDigitForRounding = 0;
            if (isGreaterThanZero) {
                 effectiveFirstDigitForRounding = parseInt(integerS[0] || '0', 10);
            }

            if (isGreaterThanZero) {
                const discardedPartIsNonZeroOrFurtherDigits =
                    integerS.length > (-dp) ||
                    !/^[0]*$/.test(integerS.substring(1)) ||
                    !/^[0]*$/.test(originalFractionalForCheck);

                switch (rm) {
                    case 0: break;
                    case 1: if (effectiveFirstDigitForRounding >= 5) applyRoundingEffect = 1; break;
                    case 2:
                        if (effectiveFirstDigitForRounding > 5) applyRoundingEffect = 1;
                        else if (effectiveFirstDigitForRounding === 5 && discardedPartIsNonZeroOrFurtherDigits) {
                            applyRoundingEffect = 1;
                        }
                        break;
                    case 3: applyRoundingEffect = 1; break;
                }
            }
            integerS = applyRoundingEffect ? "1" : "0";
            applyRoundingEffect = 0;
        } else {
            const roundDigitVal = parseInt(integerS[roundPosInInt] || '0', 10);
            const discardedFollowingIntPartIsNonZero = !/^[0]*$/.test(integerS.substring(roundPosInInt + 1));
            const isExactlyHalfWay = roundDigitVal === 5 && !discardedFollowingIntPartIsNonZero && /^[0]*$/.test(originalFractionalForCheck);

            switch (rm) {
                case 0: break;
                case 1: if (roundDigitVal >= 5) applyRoundingEffect = 1; break;
                case 2:
                    if (roundDigitVal > 5) applyRoundingEffect = 1;
                    else if (isExactlyHalfWay) {
                        const prevDigit = parseInt(integerS[roundPosInInt - 1] || '0', 10);
                        if (prevDigit % 2 !== 0) applyRoundingEffect = 1;
                    } else if (roundDigitVal === 5 && !isExactlyHalfWay ) {
                         applyRoundingEffect = 1;
                    }
                    break;
                case 3: if (!/^[0]*$/.test(integerS.substring(roundPosInInt)) || !/^[0]*$/.test(originalFractionalForCheck)) applyRoundingEffect = 1; break;
            }
            integerS = integerS.substring(0, roundPosInInt);
            if(integerS === "") integerS = "0";
        }
    }

    if (applyRoundingEffect) {
        let combinedStrForCarry = integerS + (dp > 0 ? fractionalS : "");
        let digitsArr = combinedStrForCarry.split('');
        let carry = 1;
        let k = digitsArr.length - 1;

        while (k >= 0 && carry > 0) {
            let digitVal = parseInt(digitsArr[k], 10) + carry;
            digitsArr[k] = String(digitVal % BASE);
            carry = Math.floor(digitVal / BASE);
            if (carry === 0) break;
            k--;
        }
        if (carry > 0) {
            digitsArr.unshift(String(carry));
        }

        // Determine the length of the integer part after potential carry
        let finalIntegerLength = initialIntegerLength;
        if (digitsArr.length > combinedStrForCarry.length) { // Carry propagated past MSB of original combined string
            finalIntegerLength++;
        } else if (digitsArr.length < combinedStrForCarry.length) { // Should not happen with current logic
             finalIntegerLength = digitsArr.length - (dp > 0 ? fractionalS.length : 0);
        }


        if (dp > 0) {
            integerS = digitsArr.slice(0, finalIntegerLength).join('');
            fractionalS = digitsArr.slice(finalIntegerLength).join('');
        } else {
            integerS = digitsArr.join('');
        }
        if (integerS === "") integerS = "0";
    }

    let finalRoundedStr;
    if (dp > 0) {
        finalRoundedStr = integerS + '.' + (fractionalS || '').padEnd(dp, '0');
    } else if (dp < 0) {
        if (integerS === "0") {
            finalRoundedStr = "0";
        } else {
            finalRoundedStr = integerS + "0".repeat(-dp);
        }
    } else { // dp === 0
        finalRoundedStr = integerS;
    }

    const resultNum = new BigIntPrimitive(finalRoundedStr);
    resultNum.sign = (resultNum.isZero()) ? 1 : inputSign;

    return { limbs: resultNum.limbs, exponent: resultNum.exponent, sign: resultNum.sign };
  }

  round(dp, rm) {
    const roundingMode = rm === undefined ? this.constructor.RM : rm;
    const dpToUse = dp === undefined ? 0 : dp;

    const roundedParts = BigIntPrimitive._staticRound(
        this.limbs, this.exponent, this.sign, dpToUse, roundingMode
    );

    const result = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
    result.limbs = roundedParts.limbs;
    result.exponent = roundedParts.exponent;
    result.sign = roundedParts.sign;
    result._roundedDp = dpToUse;

    if (result.limbs.length === 1 && result.limbs[0] === 0) {
        result.sign = 1;
        result.exponent = 0;
    }
    return result;
  }

  toExponential(dpUndefined, rmUndefined) {
    const actualRm = (rmUndefined === undefined ? BigIntPrimitive.RM : rmUndefined);
    let dp = dpUndefined;

    if (this.isZero()) {
      let zeroStr = "0";
      if (dp !== undefined && dp > 0) { zeroStr += "." + "0".repeat(dp); }
      return zeroStr + "e+0";
    }
    if (dp !== undefined && dp < 0) { throw new RangeError("toExponential() argument must be non-negative"); }

    let sciExp = (this.limbs.length - 1) + this.exponent;
    const coeff = new BigIntPrimitive(this, this.canvas, { forceCPU: this.forceCPU });
    coeff.sign = 1;
    coeff.exponent = -(this.limbs.length - 1);

    let roundedCoeff;
    if (dp === undefined) {
        const tempPE = BigIntPrimitive.PE; const tempNE = BigIntPrimitive.NE;
        BigIntPrimitive.PE = 10000; BigIntPrimitive.NE = -10000;
        let coeffStrTemp = coeff.toString();
        BigIntPrimitive.PE = tempPE; BigIntPrimitive.NE = tempNE;
        if(coeffStrTemp.includes('.')) coeffStrTemp = coeffStrTemp.replace(/\.?0+$/, '');
        roundedCoeff = new BigIntPrimitive(coeffStrTemp);

        const originalCoeffStr = coeff.limbs.join('');
        const roundedCoeffStr = roundedCoeff.limbs.join('');
        if (roundedCoeffStr.length > originalCoeffStr.length && roundedCoeffStr[0] !== '0') {
             sciExp += (roundedCoeffStr.length - originalCoeffStr.length);
             roundedCoeff.exponent -= (roundedCoeffStr.length - originalCoeffStr.length);
        } else if (parseFloat(roundedCoeff.toString()) >= 10.0) {
            sciExp++;
            roundedCoeff = new BigIntPrimitive(roundedCoeff.toString() + "e-1");
        }
    } else {
        roundedCoeff = coeff.round(dp, actualRm);
        let tempCoeffValCheck = new BigIntPrimitive(roundedCoeff, this.canvas);
        tempCoeffValCheck.exponent = 0;

        let checkStr = tempCoeffValCheck.limbs.join('');
        if (checkStr.length > 1 && tempCoeffValCheck.limbs[0] !== 0 && parseFloat(roundedCoeff.toString()) >= 10.0 ) {
             sciExp++;
             let tempDivBy10 = new BigIntPrimitive(roundedCoeff, this.canvas);
             tempDivBy10.exponent--;
             roundedCoeff = tempDivBy10.round(dp, actualRm);
        }
    }

    let coeffStrFinal = roundedCoeff.limbs.join('');
    let res = (this.sign === -1 ? "-" : "") + coeffStrFinal[0];
    const fracDigits = coeffStrFinal.substring(1);

    if (dp === undefined) {
        if (fracDigits.length > 0) { res += '.' + fracDigits.replace(/0+$/, ''); }
    } else if (dp > 0) {
        res += '.';
        res += fracDigits.padEnd(dp, '0').substring(0, dp);
    }
    res += 'e' + (sciExp >= 0 ? '+' : '-') + Math.abs(sciExp);
    return res;
  }

  toFixed(dpUndefined, rmUndefined) {
    const actualRm = (rmUndefined === undefined ? BigIntPrimitive.RM : rmUndefined);
    let dp = dpUndefined;

    if (dp === undefined) {
        const tempPE = BigIntPrimitive.PE; const tempNE = BigIntPrimitive.NE;
        BigIntPrimitive.PE = 1000000; BigIntPrimitive.NE = -1000000;
        const originalRoundedDp = this._roundedDp;
        delete this._roundedDp;
        const str = this.toString();
        this._roundedDp = originalRoundedDp;
        BigIntPrimitive.PE = tempPE; BigIntPrimitive.NE = tempNE;
        return str;
    }

    if (typeof dp !== 'number' || !Number.isInteger(dp) || dp < 0 ) {
        throw new RangeError("toFixed() argument must be a non-negative integer.");
    }

    const originalRoundedDp = this._roundedDp;
    this._roundedDp = dp;
    const roundedNum = this.round(dp, actualRm);
    this._roundedDp = originalRoundedDp;

    return roundedNum.toString();
  }

  sqrt(dp) {
    const Ctor = this.constructor;
    const currentOptions = { forceCPU: this.forceCPU, canvas: this.canvas };

    if (this.isNegative()) {
      throw new Error("sqrt of negative number");
    }
    if (this.isZero()) {
      return new Ctor("0", this.canvas, currentOptions);
    }

    const targetDp = (dp === undefined) ? Ctor.DP : dp;
    // internalDp for N/x and (x + N/x)/2 needs to be quite high.
    // Heuristic: targetDp + (number of integer digits in N)/2 + some guard digits.
    let numIntDigitsN = Math.max(0, (this.limbs.length + this.exponent));
    const internalDp = targetDp + Math.max(8, Math.ceil(numIntDigitsN / 2)) + 10; // Further increase


    const two = new Ctor("2", this.canvas, { forceCPU: true });
    let x; // Initial guess

    // Initial guess strategy: x_0 = 10^(num_digits(N)/2)
    // num_digits(N) is approximately this.limbs.length + this.exponent (value of most significant digit)
    let numDigitsEstimate = (this.limbs.length -1) + this.exponent;

    x = new Ctor("1", this.canvas, currentOptions);
    x.exponent = Math.floor(numDigitsEstimate / 2);

    if (x.isZero() && this.isPositive()) { // If N is very small, e.g. 1e-100, guess might become 0
        // A more robust guess for small N: if N < 1, x_0 = N or 1.
        // If N is 1e-100, x_0 could be 1e-50.
        // If N is 0.25, initial guess 10^(-1/2) approx 0.316.
        // Let's try N if N < 1 as a starting point if 10^(...) is zero
        if (this.abs().lt(new Ctor("1", this.canvas, currentOptions))) {
            x = new Ctor(this, this.canvas, currentOptions);
            x.sign = 1; // Ensure positive guess
            if (x.isZero()) { // If N itself is so small it's zero for Ctor
                 x = new Ctor("1e-50", this.canvas, currentOptions); // Fallback small guess
            }
        } else { // N > 1 but 10^(...) was zero (should not happen for N > 1)
            x = new Ctor("1", this.canvas, currentOptions); // Fallback for N > 1
        }
    }
    if (x.isZero()) x = new Ctor("1", this.canvas, currentOptions); // Absolute fallback if guess is still zero

    let xNext;
    // Check convergence with slightly more precision than target.
    const convergenceCheckDp = targetDp + Math.max(5, Math.ceil(numIntDigitsN / 2)) + 6; // Further increase


    // Perform Newton-Raphson iteration
    for (let i = 0; i < 150; i++) { // Max iterations increased to 150
      // N_div_x = N.divide(x)
      // For division, we need to ensure enough precision.
      // The current `divide` method is a problem as it relies on `divideAndRemainder` which uses the problematic `_longDivide`.
      // Assuming `divide` can provide sufficient precision if `internalDp` is used in its own scaling.
      const N_div_x_unrounded = this.divide(x); // This divide must handle precision internally
      const N_div_x = N_div_x_unrounded.round(internalDp, Ctor.RM);

      if (x.isZero()) { // Avoid division by zero if x somehow becomes zero
          x = new Ctor("1e-50", this.canvas, currentOptions); // Re-initialize x to a small number
      }

      xNext = x.add(N_div_x).divide(two); // This divide by two also needs to be precise.
      // No explicit rounding here, let the loop refine. Final rounding at the end.
      // However, to prevent precision from growing indefinitely and to stabilize:
      xNext = xNext.round(internalDp + 7, Ctor.RM); // Keep slightly more precision than N_div_x, increased guard to +7

      // Check for convergence
      const x_check = x.round(convergenceCheckDp, Ctor.RM);
      const xNext_check = xNext.round(convergenceCheckDp, Ctor.RM);

      if (x_check.eq(xNext_check)) {
        break;
      }
      x = xNext;
      if (i === 99) {
        // console.warn("sqrt: Max iterations reached");
      }
    }
    return xNext.round(targetDp, Ctor.RM);
  }
}

export { BigIntPrimitive };
