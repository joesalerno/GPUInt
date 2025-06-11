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
  static _shaderProgramsCache = {}; // Shader program cache
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
        const digit2 = arr2[i] || 0; // Reverted to LSB of arr2
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

      // Attempt GPGPU path for core addition of magnitudes
      let sumMagnitudeResultLimbs;
      let gpuPathSuccess = false;
      let gl;

      if (!this.forceCPU && !otherBigInt.forceCPU && this.canvas && typeof webglUtilsModule !== 'undefined') {
        gl = webglUtilsModule.initWebGL(this.canvas);
        if (gl) {
          const Ctor = this.constructor;
          const cacheKey = "additionProgram";
          let additionProgram = Ctor._shaderProgramsCache[cacheKey];

          if (!additionProgram) {
            const vs = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, vertexShaderSrc);
            const fs = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSrc);
            if (vs && fs) {
              additionProgram = webglUtilsModule.createProgram(gl, vs, fs);
              if (additionProgram) {
                Ctor._shaderProgramsCache[cacheKey] = additionProgram;
                console.log(`[GPU ADD DEBUG] Shader program "${cacheKey}" compiled and linked successfully for context.`);
              } else {
                // createProgram already logs verbose errors, so just a note here
                console.error(`[GPU ADD DEBUG] Program linking failed for program "${cacheKey}". Check createProgram logs in webgl-utils.`);
                gl = null; // Signal to fallback to CPU
              }
              // Log shader info logs regardless of program linking success, if shaders were compiled
              if (typeof gl.getShaderInfoLog === 'function') {
                const vsInfoLog = gl.getShaderInfoLog(vs); // vs is guaranteed to be non-null here
                if (vsInfoLog) console.log(`[GPU ADD DEBUG] Vertex shader info log for "${cacheKey}":`, vsInfoLog);
                const fsInfoLog = gl.getShaderInfoLog(fs); // fs is guaranteed to be non-null here
                if (fsInfoLog) console.log(`[GPU ADD DEBUG] Fragment shader info log for "${cacheKey}":`, fsInfoLog);
              } else {
                console.warn(`[GPU ADD DEBUG] gl.getShaderInfoLog is not a function on this GL context for "${cacheKey}".`);
              }

            } else {
              // This case means vs or fs was null, createShader already logged the error.
              console.error(`[GPU ADD DEBUG] Shader compilation failed for program "${cacheKey}". Check createShader logs in webgl-utils.`);
              gl = null; // Signal to fallback to CPU
            }
          }

          if (additionProgram) {
            const texWidth = Math.max(tempThis.limbs.length, tempOther.limbs.length);
            // Ensure limbs are reversed for texture (shader might expect LSB first if processing right-to-left)
            // OR ensure shader processes from left-to-right based on texture coordinates.
            // Assuming current shaders work with limbs as is (MSB first in array).
            console.log('[GPU ADD DEBUG] Input tempThis.limbs:', JSON.stringify(tempThis.limbs));
            console.log('[GPU ADD DEBUG] Input tempOther.limbs:', JSON.stringify(tempOther.limbs));
            console.log('[GPU ADD DEBUG] texWidth:', texWidth);
            const tex1 = webglUtilsModule.createDataTexture(gl, new Float32Array(tempThis.limbs), texWidth, 1, false);
            const tex2 = webglUtilsModule.createDataTexture(gl, new Float32Array(tempOther.limbs), texWidth, 1, false);
            const outTex = webglUtilsModule.createDataTexture(gl, null, texWidth, 1, true); // useRGBA for output

            if (tex1 && tex2 && outTex) {
              const fbo = gl.createFramebuffer();
              gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
              gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);

              if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
                gl.useProgram(additionProgram);

                const uTexWidthLoc = gl.getUniformLocation(additionProgram, "u_texWidth");
                gl.uniform1f(uTexWidthLoc, texWidth);
                const uBaseLoc = gl.getUniformLocation(additionProgram, "u_base");
                gl.uniform1f(uBaseLoc, BASE);

                gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex1);
                gl.uniform1i(gl.getUniformLocation(additionProgram, "u_texture1"), 0);

                gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex2);
                gl.uniform1i(gl.getUniformLocation(additionProgram, "u_texture2"), 1);

                gl.viewport(0, 0, texWidth, 1);
                const quadBuffer = webglUtilsModule.setupGpgpuQuad(gl, additionProgram);

                if (quadBuffer) {
                  gl.drawArrays(gl.TRIANGLES, 0, 6);
                  const gpuResultRGBA = webglUtilsModule.readDataFromTexture(gl, fbo, texWidth, 1, false);
                  console.log('[GPU ADD DEBUG] Raw gpuResultRGBA from texture:', gpuResultRGBA ? JSON.stringify(Array.from(gpuResultRGBA)) : 'null_or_undefined');

                  if (gpuResultRGBA) {
                    let finalLimbs = []; // Will be MSB first
                    let js_carry_in = 0;
                    // Iterate from LSB (texWidth-1) to MSB (0) from the shader output
                    // This assumes gpuResultRGBA has MSB at index 0 and LSB at (texWidth-1)*4.
                    for (let i = texWidth - 1; i >= 0; i--) {
                      const val_from_shader = gpuResultRGBA[i * 4 + 0];
                      const carry_from_shader = gpuResultRGBA[i * 4 + 1];

                      const sum_with_js_carry = val_from_shader + js_carry_in;
                      finalLimbs.unshift(sum_with_js_carry % BASE); // Prepend to build MSB-first
                      js_carry_in = Math.floor(sum_with_js_carry / BASE) + carry_from_shader;
                    }
                    // After loop, if there's a remaining carry, prepend it
                    while (js_carry_in > 0) {
                      finalLimbs.unshift(js_carry_in % BASE);
                      js_carry_in = Math.floor(js_carry_in / BASE);
                    }
                    if (finalLimbs.length === 0) finalLimbs = [0]; // Handle case of 0+0
                    sumMagnitudeResultLimbs = finalLimbs;
                    console.log('[GPU ADD DEBUG] sumMagnitudeResultLimbs (after JS carry):', JSON.stringify(sumMagnitudeResultLimbs));
                    console.log('[GPU ADD DEBUG] Final js_carry_in after loop:', js_carry_in);
                    gpuPathSuccess = true;
                  } else {
                  }
                  gl.deleteBuffer(quadBuffer);
                }
              } else { console.error("WebGL FBO not complete for addition."); }
              gl.bindFramebuffer(gl.FRAMEBUFFER, null);
              gl.deleteFramebuffer(fbo);
              gl.deleteTexture(tex1); gl.deleteTexture(tex2); gl.deleteTexture(outTex);
            } else { console.error("Failed to create WebGL textures for addition."); }
          }
        }
      }

      if (gpuPathSuccess) {
        result.limbs = sumMagnitudeResultLimbs;
        console.log('[GPU ADD DEBUG] GPU Result Object: limbs=', JSON.stringify(result.limbs), 'exp=', result.exponent, 'sign=', result.sign, '_roundedDp=', result._roundedDp);
      } else { // CPU Fallback for core addition
        const sumMagnitudeResult = tempThis._core_add(tempOther); // Reverted to original
        result.limbs = sumMagnitudeResult.limbs;
      }
      result.exponent = commonExponent;
      result.sign = this.sign;

    } else { // Signs are different, effectively subtraction
      return this.subtract(otherBigInt.negate());
    }

    // Normalize result
    if (result.isZero()) {
      result.sign = 1; result.exponent = 0;
    } else {
      while (result.limbs.length > 1 && result.limbs[0] === 0) { result.limbs.shift(); } // remove leading zeros
      while (result.limbs.length > 1 && result.limbs[result.limbs.length - 1] === 0) {
        result.limbs.pop(); result.exponent++;
      }
       if (result.isZero()) { result.sign = 1; result.exponent = 0; } // Re-check after normalization
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
    if (positiveDividend.isZero()) { return { quotient: new Ctor("0", this.canvas), remainder: new Ctor("0", this.canvas) }; }
    const comparison = positiveDividend.compareMagnitude(positiveDivisor);
    if (comparison < 0) { return { quotient: new Ctor("0", this.canvas), remainder: new Ctor(positiveDividend, this.canvas) }; }
    if (comparison === 0) { return { quotient: new Ctor("1", this.canvas), remainder: new Ctor("0", this.canvas) }; }
    let dividendStr = positiveDividend.abs().toString();
    let divisorStr = positiveDivisor.abs().toString();
    if (divisorStr === "0") throw new Error("Division by zero.");
    if (dividendStr === "0") return { quotient: new Ctor("0"), remainder: new Ctor("0") };
    const q = BigInt(dividendStr) / BigInt(divisorStr);
    const r = BigInt(dividendStr) % BigInt(divisorStr);
    return { quotient: new Ctor(q.toString(), this.canvas), remainder: new Ctor(r.toString(), this.canvas) };
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

  divide(divisorBigInt) { const { quotient } = this.divideAndRemainder(divisorBigInt); return quotient; }
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

  sqrt() {
    if (this.isNegative()) {
      throw new Error("[big.js] No square root of negative number");
    }

    const Ctor = this.constructor;
    const currentOptions = { canvas: this.canvas, forceCPU: this.forceCPU };

    if (this.isZero()) {
      return new Ctor("0", this.canvas, currentOptions);
    }
    if (this.eq(new Ctor("1", this.canvas, currentOptions))) {
      return new Ctor("1", this.canvas, currentOptions);
    }

    const S = this;
    const originalDP = Ctor.DP;
    const originalRM = Ctor.RM;

    // internalDP needs to be high enough for Newton's method to converge properly.
    const internalDP = originalDP + (String(Math.abs(S.exponent)).length || 1) + S.limbs.length + 7;

    // internalDivide: A specialized division for sqrt's S/x_n step.
    // It computes dividend / divisor to 'precision' decimal places.
    const internalDivide = (dividend, divisor, precision) => {
      if (divisor.isZero()) {
        throw new Error("[big.js] Division by zero in internalDivide for sqrt.");
      }

      const absDividend = dividend.abs();
      const absDivisor = divisor.abs();

      let numCoeffStr = absDividend.limbs.join('');
      let numEffectiveExp = absDividend.exponent + precision;

      let denCoeffStr = absDivisor.limbs.join('');
      let denEffectiveExp = absDivisor.exponent;

      let finalNumStr, finalDenStr;
      let expDiffForBigInt = numEffectiveExp - denEffectiveExp;

      if (expDiffForBigInt >= 0) {
        finalNumStr = numCoeffStr + '0'.repeat(expDiffForBigInt);
        finalDenStr = denCoeffStr;
      } else {
        finalNumStr = numCoeffStr;
        finalDenStr = denCoeffStr + '0'.repeat(-expDiffForBigInt);
      }

      // Ensure strings are not empty before passing to BigInt
      if (finalNumStr === "") finalNumStr = "0";
      if (finalDenStr === "") finalDenStr = "0"; // Should be caught by divisor.isZero earlier or next check

      const biNum = BigInt(finalNumStr);
      const biDen = BigInt(finalDenStr);

      if (biDen === BigInt(0)) {
          throw new Error("[big.js] Division by zero after scaling in internalDivide for sqrt.");
      }

      const quotientValStr = (biNum / biDen).toString();

      let quotient = new Ctor(quotientValStr, dividend.canvas, { forceCPU: dividend.forceCPU });
      quotient.exponent = -precision; // This is the exponent adjustment due to the initial scaling by `precision`

      // Normalize the quotient (limbs and exponent)
      if (quotient.isZero()) {
          quotient.exponent = 0;
          quotient.sign = 1;
      } else {
          while(quotient.limbs.length > 1 && quotient.limbs[0] === 0) { quotient.limbs.shift(); } // remove leading zeros
          while(quotient.limbs.length > 1 && quotient.limbs[quotient.limbs.length -1] === 0) { // remove trailing zeros
              quotient.limbs.pop();
              quotient.exponent++;
          }
           if (quotient.isZero()) { quotient.exponent = 0; quotient.sign = 1; }
      }


      if (dividend.sign !== divisor.sign && !quotient.isZero()) {
        quotient.sign = -1;
      }
      return quotient;
    };

    let x_n;
    const s_order_mag_exp = S.exponent + S.limbs.length - 1;
    x_n = new Ctor("1", this.canvas, currentOptions);
    x_n.exponent = Math.floor(s_order_mag_exp / 2);
    x_n.limbs = [1];

    if (x_n.isZero() && !S.isZero()) {
      x_n = new Ctor(S, this.canvas, currentOptions);
      if (x_n.isZero()) {
        x_n = new Ctor("1", this.canvas, currentOptions);
      }
    }

    const two = new Ctor("2", this.canvas, currentOptions);
    let x_n_plus_1;

    const MAX_ITERATIONS = originalDP + S.limbs.length + Math.abs(S.exponent) + 20;
    let iterations = 0;
    let previous_x_n_rounded_str = "";

    Ctor.DP = internalDP;

    for (iterations = 0; iterations < MAX_ITERATIONS; iterations++) {
      if (x_n.isZero()) {
        throw new Error("[big.js] Division by zero during sqrt iteration: x_n became zero.");
      }

      const s_div_xn = internalDivide(S, x_n, internalDP);

      const sum_terms = s_div_xn.add(x_n);
      x_n_plus_1 = sum_terms.divide(two);

      const tempConvergenceDP = originalDP + 5;
      const CtorDPForConvergenceCheck = Ctor.DP;
      Ctor.DP = tempConvergenceDP;
      const current_x_n_plus_1_rounded_str = x_n_plus_1.round(tempConvergenceDP, originalRM).toString();
      Ctor.DP = CtorDPForConvergenceCheck;

      if (current_x_n_plus_1_rounded_str === previous_x_n_rounded_str) {
        break;
      }
      x_n = x_n_plus_1;
      previous_x_n_rounded_str = current_x_n_plus_1_rounded_str;
    }

    Ctor.DP = originalDP;
    Ctor.RM = originalRM;

    const finalResult = x_n_plus_1.round(originalDP, originalRM);

    let isInteger = finalResult.exponent >= 0;
    if (isInteger) {
        const tempRoundedToZero = finalResult.round(0, BigIntPrimitive.roundDown);
        if (finalResult.eq(tempRoundedToZero)) {
            if (originalDP > 0 || finalResult._roundedDp !== undefined) { // Check if it might have trailing zeros due to _roundedDp
               delete finalResult._roundedDp;
            }
        }
    }

    return finalResult;
  }

  prec(sd, rm) {
    const Ctor = this.constructor;

    if (sd === undefined || sd === null) { // big.js behavior: x.prec() is x
      return new Ctor(this, this.canvas, { forceCPU: this.forceCPU });
    }
    if (typeof sd !== 'number' || !Number.isInteger(sd) || sd < 1 || sd > 1e6) {
      throw new Error('[big.js] Invalid precision');
    }

    const actualRM = (rm === undefined || rm === null) ? Ctor.RM : rm;
    if (actualRM < 0 || actualRM > 3 || !Number.isInteger(actualRM)) {
      throw new Error('[big.js] Invalid rounding mode');
    }

    if (this.isZero()) {
      return new Ctor("0", this.canvas, { forceCPU: this.forceCPU });
    }

    // If the number of significant digits in `this` is already <= sd, no change needed.
    // Limbs are normalized (no leading/trailing zeros for the coefficient itself).
    if (this.limbs.length <= sd) {
        return new Ctor(this, this.canvas, { forceCPU: this.forceCPU });
    }

    // Order of magnitude exponent of the number: exponent of the most significant digit.
    // For value = coeff_int * 10^exponent, orderMagExp = exponent_of_MSD_of_coeff_int + exponent.
    // MSD of coeff_int is limbs[0]. Its "power" relative to LSB of coeff is limbs.length - 1.
    // So, orderMagExp = (this.limbs.length - 1) + this.exponent.
    const orderMagExp = this.exponent + this.limbs.length - 1;

    // The decimal place `dp` to round to, to achieve `sd` significant digits.
    // dp = sd - orderMagExp - 1
    const dpForRounding = sd - orderMagExp - 1;

    const result = this.round(dpForRounding, actualRM);
    // The `prec` method should return a number whose string representation is naturally formatted.
    // Deleting _roundedDp ensures that toString() uses its default formatting based on NE/PE,
    // rather than being influenced by the dpForRounding used internally by prec.
    // This aligns with big.js behavior e.g. new Big("0.0000099").prec(1).toString() === "0.00001"
    delete result._roundedDp;
    return result;
  }

  toPrecision(sd, rm) {
    const Ctor = this.constructor;

    if (sd === undefined || sd === null || typeof sd !== 'number' || !Number.isInteger(sd) || sd < 1 || sd > 1e6) {
      throw new Error('[big.js] Invalid precision');
    }

    const actualRM = (rm === undefined || rm === null) ? Ctor.RM : rm;
    if (actualRM < 0 || actualRM > 3 || !Number.isInteger(actualRM)) {
      throw new Error('[big.js] Invalid rounding mode');
    }

    if (this.isZero()) {
      let zeroStr = "0";
      if (sd > 1) {
        zeroStr += "." + "0".repeat(sd - 1);
      }
      return zeroStr;
    }

    // First, round the number to sd significant digits.
    // Calculate the decimal place `dp` needed for the `round` method.
    const orderMagExp = this.exponent + this.limbs.length - 1; // Exponent of the MSD
    const dpToRoundTo = sd - orderMagExp - 1;

    let roundedNum = this.round(dpToRoundTo, actualRM);

    // Now, format this roundedNum.
    // Determine the exponent of the MSD of the *rounded* number.
    const roundedNumOrderMagExp = roundedNum.isZero() ? 0 : roundedNum.exponent + roundedNum.limbs.length - 1;

    // Condition for using scientific notation.
    // Use Ctor.NE for the lower bound, and compare roundedNumOrderMagExp with sd for the upper bound,
    // similar to Number.prototype.toPrecision and big.js behavior.
    if (roundedNumOrderMagExp <= Ctor.NE || roundedNumOrderMagExp >= sd) {
      let expStr = roundedNum.toExponential(sd - 1, actualRM);
      // Special formatting for toPrecision(1) when result is like 1e-N, big.js expects 1.0e-N
      if (sd === 1 && !expStr.includes('.') && roundedNumOrderMagExp < 0) {
          // Check if the significand is a single digit (already handled by !expStr.includes('.'))
          const eIndex = expStr.toLowerCase().indexOf('e');
          if (eIndex !== -1 && eIndex === 1) { // Ensure it's like "1e-5", not "10e-5"
            expStr = expStr.substring(0, eIndex) + '.0' + expStr.substring(eIndex);
          }
      }
      return expStr;
    } else {
      // Fixed-point notation
      // dpForFixed is the number of digits to display *after the decimal point*.
      const dpForFixed = Math.max(0, sd - (roundedNumOrderMagExp + 1));
      return roundedNum.toFixed(dpForFixed, actualRM);
    }
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
}

export { BigIntPrimitive };
