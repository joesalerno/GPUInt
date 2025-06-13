import * as webglUtilsModule from './webgl-utils.js';
import vertexShaderSrc from './shaders/addition.vert?raw';
import fragmentShaderSrc from './shaders/addition.frag?raw';
import subtractVertexShaderSrc from './shaders/subtraction.vert?raw';
import subtractFragmentShaderSrc from './shaders/subtraction.frag?raw';
import multiplyLimbVertexShaderSrc from './shaders/multiply_limb.vert?raw';
import multiplyLimbFragmentShaderSrc from './shaders/multiply_limb.frag?raw';

const KARATSUBA_THRESHOLD = 20;
const BASE_LOG10 = 4;
const BASE = 10000;

class BigIntPrimitive {
  static strict = false;
  static NE = -7;
  static PE = 21;
  static DP = 20; // Default decimal places
  static RM = 1;  // Default rounding mode: roundHalfUp

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

    // WebGL related properties
    this.gl = null;
    this.additionProgramGL = null;
    this.u_num1TextureLocAdd = null;
    this.u_num2TextureLocAdd = null;
    this.u_carryTextureLocAdd = null;
    this.a_positionLocAdd = null; // For quad vertices
    this.a_texCoordLocAdd = null; // For texture coords

    // Buffers for the quad
    this.quadVertexBufferGL = null;
    this.quadTexCoordBufferGL = null;

    // Subtraction Program
    this.subtractionProgramGL = null;
    this.u_num1TextureLocSub = null; // Minuend
    this.u_num2TextureLocSub = null; // Subtrahend
    this.u_borrowTextureLocSub = null;
    this.a_positionLocSub = null;
    this.a_texCoordLocSub = null;

    // Multiply Limb Program
    this.multiplyLimbProgramGL = null;
    this.u_limbValLocMul = null;
    this.u_otherNumTextureLocMul = null;
    this.u_carryTextureLocMul = null; // Uniform for initial carry texture
    this.a_positionLocMul = null;
    this.a_texCoordLocMul = null;


    if (this.canvas && !this.forceCPU && typeof webglUtilsModule !== 'undefined') {
        this._initWebGLPrograms();
    }

    if (this.constructor.strict && typeof value === 'number') {
      throw new TypeError("[big.js] String expected");
    }

    if (value instanceof BigIntPrimitive) {
      this.limbs = [...value.limbs];
      this.sign = value.sign;
      this.exponent = value.exponent;
      this.canvas = canvas !== undefined ? canvas : value.canvas;
      this.forceCPU = (options && options.hasOwnProperty('forceCPU')) ? options.forceCPU : value.forceCPU;

      if (value.hasOwnProperty('_roundedDp')) {
        this._roundedDp = value._roundedDp;
      }
      return;
    }

    if (value === null || value === undefined) {
        throw new TypeError("Invalid input type for BigIntPrimitive: cannot be null or undefined.");
    }

    let stringValue = '';
    if (typeof value === 'number') {
      // Note: Strict mode check for numbers is done earlier.
      // If not strict, numbers are converted to strings.
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
    let coefficientDigitsStr = mantissaStr; // Renamed for clarity

    if (decimalPointIndex !== -1) {
      if (mantissaStr.indexOf('.', decimalPointIndex + 1) !== -1) {
          throw new TypeError("Invalid numeric string: multiple decimal points in mantissa.");
      }
      coefficientDigitsStr = mantissaStr.replace('.', '');
      this.exponent = sciExponent - (mantissaStr.length - 1 - decimalPointIndex);
    } else {
      this.exponent = sciExponent;
    }

    // Remove leading zeros from the coefficient string itself before parsing into limbs
    let coeffStart = 0;
    while (coeffStart < coefficientDigitsStr.length - 1 && coefficientDigitsStr[coeffStart] === '0') {
        coeffStart++;
    }
    coefficientDigitsStr = coefficientDigitsStr.substring(coeffStart);


    if (coefficientDigitsStr === "" || coefficientDigitsStr === "0") {
        this.limbs = [0];
        this.exponent = 0;
        this.sign = 1; // Ensure sign is positive for zero
        return;
    }
    if (!/^\d+$/.test(coefficientDigitsStr)) { // Should be redundant if previous checks are thorough
        throw new TypeError("Invalid BigInt string format: coefficient contains non-digits after processing.");
    }

    // Parse coefficient into limbs based on BASE_LOG10
    this.limbs = [];
    for (let i = coefficientDigitsStr.length; i > 0; i -= BASE_LOG10) {
        const chunkStart = Math.max(0, i - BASE_LOG10);
        const limbStr = coefficientDigitsStr.substring(chunkStart, i);
        this.limbs.unshift(parseInt(limbStr, 10));
    }

    // Post-limb creation normalization (e.g. removing trailing zero limbs if any due to exponent logic - though less likely with current constructor)
    // This kind of normalization (adjusting exponent for trailing zero limbs) is usually for internal ops, not initial construction.
    // The primary normalization for zero value (limbs=[0], exp=0, sign=1) is already handled.

    if (this.limbs.length === 0) { // Should not happen if coefficientDigitsStr wasn't empty
        this.limbs = [0];
        this.exponent = 0;
        this.sign = 1;
    } else if (this.isZero()) { // Use isZero for consistent zero state
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

  plus(n) { return this.add(n); }
  minus(n) { return this.subtract(n); }
  times(n) { return this.multiply(n); }
  div(n) { return this.divide(n); }
  mod(n) { return this.remainder(n); }
  neg() { return this.negate(); }


  toString() {
    const isZeroCheck = this.isZero(); // Use the method for consistency
    if (isZeroCheck) {
        if (typeof this._roundedDp === 'number' && this._roundedDp > 0) {
            // For a zero value, sign should conventionally be positive unless specifically formatting -0.0 for some reason.
            // BigIntPrimitive usually normalizes sign of zero to 1.
            return '0.' + '0'.repeat(this._roundedDp);
        }
        return "0";
    }

    let coefficientString = this.limbs[0].toString();
    for (let i = 1; i < this.limbs.length; i++) {
        coefficientString += this.limbs[i].toString().padStart(BASE_LOG10, '0');
    }

    // This removal of leading zeros from the combined coefficient string might be redundant
    // if limbs are correctly formed (e.g., first limb isn't 0 unless it's the only limb and is 0).
    // However, it can be a safeguard.
    if (coefficientString !== "0" && coefficientString.length > 1 && coefficientString.startsWith('0')) {
        let start = 0;
        while (start < coefficientString.length - 1 && coefficientString[start] === '0') { start++; }
        coefficientString = coefficientString.substring(start);
    }


    let s;
    const e = this.exponent;
    const len = coefficientString.length; // Length of the coefficient part when limbs are joined
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

  toNumber() {
    const originalString = this.toString();
    const primitiveNumber = Number(originalString);

    if (this.constructor.strict) {
        if (isFinite(primitiveNumber)) {
            let tempBig;
            const OldStrict = this.constructor.strict;
            try {
                this.constructor.strict = false;
                tempBig = new BigIntPrimitive(primitiveNumber, this.canvas, { forceCPU: this.forceCPU });
                this.constructor.strict = OldStrict;
            } catch (e) {
                this.constructor.strict = OldStrict;
                throw new Error("[big.js] Imprecise conversion (intermediate creation failed for finite number)");
            }
            if (tempBig.toString() !== originalString) {
                 throw new Error("[big.js] Imprecise conversion");
            }
        } else {
            const OldStrict = this.constructor.strict;
            try {
                this.constructor.strict = false;
                new BigIntPrimitive(primitiveNumber, this.canvas, { forceCPU: this.forceCPU });
                this.constructor.strict = OldStrict;
            } catch (e) {
                this.constructor.strict = OldStrict;
                if (Number.isNaN(primitiveNumber)) {
                     throw new Error("[big.js] Imprecise conversion (NaN from string)");
                }
            }
        }
    }
    return primitiveNumber;
  }
  toJSON() { return this.toString(); }
  valueOf() {
    if (this.constructor.strict) {
      throw new Error("[big.js] valueOf disallowed");
    }
    return this.toString();
  }
  isZero() { return this.limbs.length === 1 && this.limbs[0] === 0; }

  _core_add(positiveOtherBigInt) {
      // Assumes this and positiveOtherBigInt are positive and have ALIGNED exponents.
      // Limbs are MSB first in this.limbs. For addition, usually process LSB first.
      let arr1 = [...this.limbs].reverse(); // LSB first
      let arr2 = [...positiveOtherBigInt.limbs].reverse(); // LSB first
      let resultLimbsReversed = [];
      let carry = 0;
      const maxLength = Math.max(arr1.length, arr2.length);

      for (let i = 0; i < maxLength; i++) {
        const digit1 = arr1[i] || 0;
        const digit2 = arr2[i] || 0;
        const sum = digit1 + digit2 + carry;
        resultLimbsReversed.push(sum % BASE);
        carry = Math.floor(sum / BASE);
      }
      if (carry > 0) {
        resultLimbsReversed.push(carry);
      }

      let finalResultLimbs = resultLimbsReversed.reverse(); // Back to MSB first
      // Remove leading zeros if any (e.g. if result was [0, 1234] for BASE 10000)
      while (finalResultLimbs.length > 1 && finalResultLimbs[0] === 0) {
        finalResultLimbs.shift();
      }
       if (finalResultLimbs.length === 0) finalResultLimbs = [0]; // Should not happen if inputs are valid

      const resultNumCPU = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
      resultNumCPU.limbs = finalResultLimbs;
      resultNumCPU.sign = 1; // _core_add deals with magnitude
      // Exponent is handled by the caller (it should be commonExponent)
      if (resultNumCPU.isZero()) { resultNumCPU.exponent = 0; } // Normalize zero
      return resultNumCPU;
  }

  _scaleToExponent(targetExponent) {
    const currentInstance = new BigIntPrimitive(this); // Create a copy to work on
    const diff = currentInstance.exponent - targetExponent;

    if (diff === 0) {
      return new BigIntPrimitive(this); // Return a new instance as per requirement
    }

    if (diff > 0) { // currentInstance.exponent > targetExponent, need to scale currentInstance's coefficient UP
                    // This means its coefficient represents a larger value, so add zeros to its limbs effectively.
      const numZeroLimbParts = Math.floor(diff / BASE_LOG10); // Number of full zero limbs to add
      const remainingShift = diff % BASE_LOG10; // Remaining shift within a limb (power of 10)

      let newLimbs = [...currentInstance.limbs];

      if (remainingShift > 0) {
        const multiplier = Math.pow(10, remainingShift);
        let carry = 0;
        // Multiply existing limbs by 10^remainingShift
        for (let i = newLimbs.length - 1; i >= 0; i--) {
            const product = newLimbs[i] * multiplier + carry;
            newLimbs[i] = product % BASE;
            carry = Math.floor(product / BASE);
        }
        if (carry > 0) {
            newLimbs.unshift(carry);
        }
        // Check if the first limb needs to be split due to becoming too large
        // This part is complex if a limb exceeds BASE after this partial shift.
        // For simplicity, this implementation assumes that multiplying by 10^remainingShift (max 1000 for BASE_LOG10=4)
        // and adding carry won't make a limb exceed BASE in a way that requires more than one new limb.
        // A more robust solution might re-normalize the limbs here.
         while (newLimbs.length > 1 && newLimbs[0] === 0) newLimbs.shift();
      }

      for (let i = 0; i < numZeroLimbParts; i++) {
        newLimbs.push(0);
      }

      const result = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
      result.limbs = newLimbs;
      result.exponent = targetExponent;
      result.sign = currentInstance.sign;

      if (result.isZero()) { // Normalize if scaling resulted in zero (e.g. if original was zero)
          result.exponent = 0;
          result.sign = 1;
      }
      return result;
    } else { // diff < 0 means targetExponent > currentInstance.exponent. This path should not be hit.
        // This implies currentInstance should be scaled "down", which would lose precision or require fractional limbs.
        // The design is that commonExponent is Math.min, so we only scale "up" (add trailing zeros).
        // If this path is ever needed, it indicates an issue with how commonExponent is chosen or how scaling is conceptualized.
        // For now, return a copy, though this scenario implies a logical flaw elsewhere if hit.
        console.warn("BigIntPrimitive._scaleToExponent called with targetExponent > this.exponent. This is unexpected.");
        return new BigIntPrimitive(this);
    }
  }


  add(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive."); }

    if (this.isZero()) {
      return new BigIntPrimitive(otherBigInt, otherBigInt.canvas, { forceCPU: this.forceCPU || otherBigInt.forceCPU });
    }
    if (otherBigInt.isZero()) {
      return new BigIntPrimitive(this, this.canvas, { forceCPU: this.forceCPU || otherBigInt.forceCPU });
    }

    const result = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU || otherBigInt.forceCPU });

    if (this.sign === otherBigInt.sign) {
      const commonExponent = Math.min(this.exponent, otherBigInt.exponent);
      const scaledThis = this._scaleToExponent(commonExponent);
      const scaledOther = otherBigInt._scaleToExponent(commonExponent);

      // WebGL Path Attempt
      if (this.gl && this.additionProgramGL && !this.forceCPU && !otherBigInt.forceCPU && scaledThis.limbs.length > 0 && scaledOther.limbs.length > 0) {
        try {
            const gl = this.gl;
            const maxLength = Math.max(scaledThis.limbs.length, scaledOther.limbs.length);

            const padLimbsMSBFirst = (limbs, len) => {
                if (limbs.length === 1 && limbs[0] === 0 && len > 0) return new Float32Array(len).fill(0);
                const padded = new Float32Array(len);
                const offset = len - limbs.length;
                for(let i=0; i < limbs.length; i++) {
                    padded[offset + i] = limbs[i];
                }
                return padded;
            };

            const num1Data = padLimbsMSBFirst(scaledThis.limbs, maxLength);
            const num2Data = padLimbsMSBFirst(scaledOther.limbs, maxLength);
            const carryInLimbData = new Float32Array(maxLength).fill(0);

            const num1Texture = webglUtilsModule.createDataTexture(gl, num1Data, maxLength, 1, false);
            const num2Texture = webglUtilsModule.createDataTexture(gl, num2Data, maxLength, 1, false);
            const carryInTexture = webglUtilsModule.createDataTexture(gl, carryInLimbData, maxLength, 1, false);
            const resultTexture = webglUtilsModule.createDataTexture(gl, null, maxLength, 1, true);

            if (!num1Texture || !num2Texture || !carryInTexture || !resultTexture) {
                throw new Error("Failed to create WebGL textures for addition.");
            }

            const fb = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resultTexture, 0);

            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                console.error("WebGL Error: Framebuffer incomplete. Status: " + gl.checkFramebufferStatus(gl.FRAMEBUFFER));
                throw new Error("WebGL framebuffer incomplete.");
            }

            gl.viewport(0, 0, maxLength, 1);
            gl.useProgram(this.additionProgramGL);

            this._setupQuadVertexBuffer(this.a_positionLocAdd, this.quadVertexBufferGL);
            this._setupQuadVertexBuffer(this.a_texCoordLocAdd, this.quadTexCoordBufferGL);

            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, num1Texture); gl.uniform1i(this.u_num1TextureLocAdd, 0);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, num2Texture); gl.uniform1i(this.u_num2TextureLocAdd, 1);
            gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, carryInTexture); gl.uniform1i(this.u_carryTextureLocAdd, 2);

            gl.drawArrays(gl.TRIANGLES, 0, 6);

            const rawOutputData = webglUtilsModule.readDataFromTexture(gl, fb, maxLength, 1, false);

            let finalLimbsReversed = [];
            let jsCarry = 0;

            for (let i = maxLength - 1; i >= 0; i--) {
                const shaderLimb = rawOutputData[i * 4 + 0];
                const shaderCarry = rawOutputData[i * 4 + 1];

                const currentSum = shaderLimb + jsCarry;
                finalLimbsReversed.push(currentSum % BASE);
                jsCarry = Math.floor(currentSum / BASE) + shaderCarry;
            }
            while (jsCarry > 0) {
                finalLimbsReversed.push(jsCarry % BASE);
                jsCarry = Math.floor(jsCarry / BASE);
            }

            result.limbs = finalLimbsReversed.length > 0 ? finalLimbsReversed.reverse() : [0];
            while(result.limbs.length > 1 && result.limbs[0] === 0) result.limbs.shift();
             if(result.limbs.length === 0 || (result.limbs.length === 1 && result.limbs[0] === 0)) { // Normalize to [0] for zero
                 result.limbs = [0];
            }

            result.exponent = commonExponent;
            result.sign = this.sign;

            gl.deleteTexture(num1Texture);
            gl.deleteTexture(num2Texture);
            gl.deleteTexture(carryInTexture);
            gl.deleteTexture(resultTexture);
            gl.deleteFramebuffer(fb);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        } catch (webGLError) {
            console.warn("WebGL add operation failed, falling back to CPU:", webGLError);
            const sumMagnitudeResultCPU = scaledThis._core_add(scaledOther);
            result.limbs = sumMagnitudeResultCPU.limbs;
            result.exponent = commonExponent;
            result.sign = this.sign;
            if (sumMagnitudeResultCPU.canvas) result.canvas = sumMagnitudeResultCPU.canvas;
        }
      } else {
        // CPU Path
        const sumMagnitudeResultCPU = scaledThis._core_add(scaledOther);
        result.limbs = sumMagnitudeResultCPU.limbs;
        result.exponent = commonExponent;
        result.sign = this.sign;
        if (sumMagnitudeResultCPU.canvas) result.canvas = sumMagnitudeResultCPU.canvas;
      }

      if (result.isZero()) { // Normalize zero
        result.exponent = 0;
        result.sign = 1;
      }
    } else {
      // Signs differ: A + (-B) is A - B. (-A) + B is B - A.
      return this.subtract(otherBigInt.negate());
    }
    return result;
  }

  _core_subtract(positiveOtherBigInt) {
      // Assumes this and positiveOtherBigInt are positive, this >= positiveOtherBigInt, and have ALIGNED exponents.
      let minuendLimbs = [...this.limbs].reverse(); // LSB first
      let subtrahendLimbs = [...positiveOtherBigInt.limbs].reverse(); // LSB first
      let resultLimbsReversed = [];
      let borrow = 0;

      const len1 = minuendLimbs.length; // Minuend is expected to be longer or equal for magnitude

      for (let i = 0; i < len1; i++) {
        let digit1 = minuendLimbs[i];
        const digit2 = subtrahendLimbs[i] || 0;
        let diff = digit1 - borrow - digit2;
        if (diff < 0) {
          diff += BASE;
          borrow = 1;
        } else {
          borrow = 0;
        }
        resultLimbsReversed.push(diff);
      }
      // If borrow is 1 here, it means subtrahend was actually larger, which violates precondition.

      let finalResultLimbs = resultLimbsReversed.reverse(); // Back to MSB first
      while (finalResultLimbs.length > 1 && finalResultLimbs[0] === 0) {
        finalResultLimbs.shift();
      }
      if (finalResultLimbs.length === 0) finalResultLimbs = [0];


      const resultNumCPU = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
      resultNumCPU.limbs = finalResultLimbs;
      resultNumCPU.sign = 1; // _core_subtract deals with magnitude
      if (resultNumCPU.isZero()) { resultNumCPU.exponent = 0; } // Normalize zero
      return resultNumCPU;
  }

  subtract(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive."); }

    const result = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU || otherBigInt.forceCPU });

    if (this.sign !== otherBigInt.sign) {
      // A - (-B) is A + B
      // (-A) - B is -(A + B)
      // This effectively becomes an addition with this.sign.
      // Example: this = -5, other = 3. subtract(-5, 3) means -5 - 3.
      // termToActuallyAdd = -3. Now we effectively add -5 and -3.
      // Example: this = 5, other = -3. subtract(5, -3) means 5 - (-3) = 5 + 3.
      // termToActuallyAdd = 3. Now we effectively add 5 and 3.
      const termToActuallyAdd = otherBigInt.negate();

      // The add method handles signs correctly.
      // We can call the public add method, which will handle exponent alignment and core_add.
      // The sign of the final result from add will be this.sign if they were originally different
      // and then termToActuallyAdd had its sign flipped to match this.sign (e.g. 5 - (-3) -> 5 + 3, result is positive)
      // Or if this was (-5) - 3 -> (-5) + (-3), result is negative.
      return this.add(termToActuallyAdd); // Delegate to add, which now handles all cases
    }

    // Signs are the same: A - B or (-A) - (-B)
    // Result sign depends on magnitudes.
    const commonExponent = Math.min(this.exponent, otherBigInt.exponent);
    const scaledThis = this._scaleToExponent(commonExponent);
    const scaledOther = otherBigInt._scaleToExponent(commonExponent);

    const comparison = scaledThis.compareMagnitude(scaledOther);

    if (comparison === 0) {
      result.limbs = [0];
      result.exponent = 0;
      result.sign = 1; // Zero is always positive sign, zero exponent
      return result;
    }

    let coreSubResult;
    if (comparison > 0) { // |scaledThis| > |scaledOther|
      coreSubResult = scaledThis._core_subtract(scaledOther);
      result.sign = this.sign; // Sign of the result is the same as this.sign
    } else { // |scaledThis| < |scaledOther|
      coreSubResult = scaledOther._core_subtract(scaledThis);
      result.sign = -this.sign; // Sign of the result is opposite of this.sign
    }
    result.limbs = coreSubResult.limbs;
    result.exponent = commonExponent;

    // Normalize if result is zero (e.g. if _core_subtract didn't normalize fully, though it should)
    if (result.isZero()) {
        result.exponent = 0;
        result.sign = 1;
    }
    return result;
  }

  _webgl_multiply_limb_by_bigint(singleLimbValue, otherBigIntLimbsArray) {
    const gl = this.gl;
    const maxLength = otherBigIntLimbsArray.length;

    if (maxLength === 0) return { limbs: [0] };

    // Shader expects LSB-first data if texCoord.x from 0 to 1 processes LSB to MSB.
    const otherNumData = new Float32Array([...otherBigIntLimbsArray].reverse()); // Convert to LSB-first for texture
    const carryInData = new Float32Array(maxLength).fill(0);

    const otherNumTexture = webglUtilsModule.createDataTexture(gl, otherNumData, maxLength, 1, false);
    const carryInTexture = webglUtilsModule.createDataTexture(gl, carryInData, maxLength, 1, false);
    const resultTexture = webglUtilsModule.createDataTexture(gl, null, maxLength, 1, true); // RGBA output

    if (!otherNumTexture || !carryInTexture || !resultTexture) {
        throw new Error("WebGL Error: Failed to create textures for multiply_limb operation.");
    }

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resultTexture, 0);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("WebGL Error: Framebuffer incomplete for multiply_limb. Status: " + gl.checkFramebufferStatus(gl.FRAMEBUFFER));
        throw new Error("WebGL framebuffer incomplete for multiply_limb operation.");
    }

    gl.viewport(0, 0, maxLength, 1);
    gl.useProgram(this.multiplyLimbProgramGL);

    this._setupQuadVertexBuffer(this.a_positionLocMul || this.a_positionLocAdd, this.quadVertexBufferGL);
    this._setupQuadVertexBuffer(this.a_texCoordLocMul || this.a_texCoordLocAdd, this.quadTexCoordBufferGL);

    gl.uniform1f(this.u_limbValLocMul, singleLimbValue);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, otherNumTexture); gl.uniform1i(this.u_otherNumTextureLocMul, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, carryInTexture); gl.uniform1i(this.u_carryTextureLocMul, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const rawOutputData = webglUtilsModule.readDataFromTexture(gl, fb, maxLength, 1, false); // Read RGBA

    let finalLimbsReversed = []; // Store LSB first
    let jsCarry = 0;
    // rawOutputData is LSB first as texture was processed from texCoord 0 to 1 (LSB to MSB)
    for (let i = 0; i < maxLength; i++) {
        const shaderLimb = rawOutputData[i * 4 + 0];
        const shaderCarry = rawOutputData[i * 4 + 1];

        const currentProductSum = shaderLimb + jsCarry;
        finalLimbsReversed.push(currentProductSum % BASE);
        jsCarry = Math.floor(currentProductSum / BASE) + shaderCarry;
    }
    while (jsCarry > 0) {
        finalLimbsReversed.push(jsCarry % BASE);
        jsCarry = Math.floor(jsCarry / BASE);
    }

    gl.deleteTexture(otherNumTexture);
    gl.deleteTexture(carryInTexture);
    gl.deleteTexture(resultTexture);
    gl.deleteFramebuffer(fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let finalLimbsMSB = finalLimbsReversed.length > 0 ? finalLimbsReversed.reverse() : [0];
    while(finalLimbsMSB.length > 1 && finalLimbsMSB[0] === 0) finalLimbsMSB.shift();
    if(finalLimbsMSB.length === 0 || (finalLimbsMSB.length === 1 && finalLimbsMSB[0] === 0)) finalLimbsMSB = [0];
    return { limbs: finalLimbsMSB };
}

  _webgl_multiply_limb_by_bigint(singleLimbValue, otherBigIntLimbsArray) {
    const gl = this.gl;
    const maxLength = otherBigIntLimbsArray.length;

    if (maxLength === 0) return { limbs: [0] };

    const otherNumData = new Float32Array([...otherBigIntLimbsArray].reverse());
    const carryInData = new Float32Array(maxLength).fill(0);

    const otherNumTexture = webglUtilsModule.createDataTexture(gl, otherNumData, maxLength, 1, false);
    const carryInTexture = webglUtilsModule.createDataTexture(gl, carryInData, maxLength, 1, false);
    const resultTexture = webglUtilsModule.createDataTexture(gl, null, maxLength, 1, true);

    if (!otherNumTexture || !carryInTexture || !resultTexture) {
        throw new Error("WebGL Error: Failed to create textures for multiply_limb operation.");
    }

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resultTexture, 0);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("WebGL Error: Framebuffer incomplete for multiply_limb. Status: " + gl.checkFramebufferStatus(gl.FRAMEBUFFER));
        throw new Error("WebGL framebuffer incomplete for multiply_limb operation.");
    }

    gl.viewport(0, 0, maxLength, 1);
    gl.useProgram(this.multiplyLimbProgramGL);

    this._setupQuadVertexBuffer(this.a_positionLocMul || this.a_positionLocAdd, this.quadVertexBufferGL);
    this._setupQuadVertexBuffer(this.a_texCoordLocMul || this.a_texCoordLocAdd, this.quadTexCoordBufferGL);

    gl.uniform1f(this.u_limbValLocMul, singleLimbValue);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, otherNumTexture); gl.uniform1i(this.u_otherNumTextureLocMul, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, carryInTexture); gl.uniform1i(this.u_carryTextureLocMul, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const rawOutputData = webglUtilsModule.readDataFromTexture(gl, fb, maxLength, 1, false);

    let finalLimbsReversed = [];
    let jsCarry = 0;
    for (let i = 0; i < maxLength; i++) {
        const shaderLimb = rawOutputData[i * 4 + 0];
        const shaderCarry = rawOutputData[i * 4 + 1];

        const currentProductSum = shaderLimb + jsCarry;
        finalLimbsReversed.push(currentProductSum % BASE);
        jsCarry = Math.floor(currentProductSum / BASE) + shaderCarry;
    }
    while (jsCarry > 0) {
        finalLimbsReversed.push(jsCarry % BASE);
        jsCarry = Math.floor(jsCarry / BASE);
    }

    gl.deleteTexture(otherNumTexture);
    gl.deleteTexture(carryInTexture);
    gl.deleteTexture(resultTexture);
    gl.deleteFramebuffer(fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let finalLimbsMSB = finalLimbsReversed.length > 0 ? finalLimbsReversed.reverse() : [0];
    while(finalLimbsMSB.length > 1 && finalLimbsMSB[0] === 0) finalLimbsMSB.shift();
    if(finalLimbsMSB.length === 0 || (finalLimbsMSB.length === 1 && finalLimbsMSB[0] === 0)) finalLimbsMSB = [0];
    return { limbs: finalLimbsMSB };
}

  _webgl_multiply_limb_by_bigint(singleLimbValue, otherBigIntLimbsArray) {
    const gl = this.gl;
    const maxLength = otherBigIntLimbsArray.length;

    if (maxLength === 0) return { limbs: [0] };

    const otherNumData = new Float32Array([...otherBigIntLimbsArray].reverse());
    const carryInData = new Float32Array(maxLength).fill(0);

    const otherNumTexture = webglUtilsModule.createDataTexture(gl, otherNumData, maxLength, 1, false);
    const carryInTexture = webglUtilsModule.createDataTexture(gl, carryInData, maxLength, 1, false);
    const resultTexture = webglUtilsModule.createDataTexture(gl, null, maxLength, 1, true);

    if (!otherNumTexture || !carryInTexture || !resultTexture) {
        throw new Error("WebGL Error: Failed to create textures for multiply_limb operation.");
    }

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resultTexture, 0);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("WebGL Error: Framebuffer incomplete for multiply_limb. Status: " + gl.checkFramebufferStatus(gl.FRAMEBUFFER));
        throw new Error("WebGL framebuffer incomplete for multiply_limb operation.");
    }

    gl.viewport(0, 0, maxLength, 1);
    gl.useProgram(this.multiplyLimbProgramGL);

    this._setupQuadVertexBuffer(this.a_positionLocMul || this.a_positionLocAdd, this.quadVertexBufferGL);
    this._setupQuadVertexBuffer(this.a_texCoordLocMul || this.a_texCoordLocAdd, this.quadTexCoordBufferGL);

    gl.uniform1f(this.u_limbValLocMul, singleLimbValue);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, otherNumTexture); gl.uniform1i(this.u_otherNumTextureLocMul, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, carryInTexture); gl.uniform1i(this.u_carryTextureLocMul, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const rawOutputData = webglUtilsModule.readDataFromTexture(gl, fb, maxLength, 1, false);

    let finalLimbsReversed = [];
    let jsCarry = 0;
    for (let i = 0; i < maxLength; i++) {
        const shaderLimb = rawOutputData[i * 4 + 0];
        const shaderCarry = rawOutputData[i * 4 + 1];

        const currentProductSum = shaderLimb + jsCarry;
        finalLimbsReversed.push(currentProductSum % BASE);
        jsCarry = Math.floor(currentProductSum / BASE) + shaderCarry;
    }
    while (jsCarry > 0) {
        finalLimbsReversed.push(jsCarry % BASE);
        jsCarry = Math.floor(jsCarry / BASE);
    }

    gl.deleteTexture(otherNumTexture);
    gl.deleteTexture(carryInTexture);
    gl.deleteTexture(resultTexture);
    gl.deleteFramebuffer(fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let finalLimbsMSB = finalLimbsReversed.length > 0 ? finalLimbsReversed.reverse() : [0];
    while(finalLimbsMSB.length > 1 && finalLimbsMSB[0] === 0) finalLimbsMSB.shift();
    if(finalLimbsMSB.length === 0 || (finalLimbsMSB.length === 1 && finalLimbsMSB[0] === 0)) finalLimbsMSB = [0];
    return { limbs: finalLimbsMSB };
}

  _webgl_multiply_limb_by_bigint(singleLimbValue, otherBigIntLimbsArray) {
    const gl = this.gl;
    const maxLength = otherBigIntLimbsArray.length;

    if (maxLength === 0) return { limbs: [0] }; // Should ideally not happen if otherBigInt is not zero

    // Shader usually processes textures from texCoord (0,0) up to (1,1).
    // For a 1D texture (height=1), if texCoord.x maps 0 to 1 for LSB to MSB of the number,
    // then data in texture should be LSB first.
    const otherNumData = new Float32Array([...otherBigIntLimbsArray].reverse()); // Reverse to LSB-first for texture
    const carryInData = new Float32Array(maxLength).fill(0); // Initial carry for mul_limb is 0 for each position

    const otherNumTexture = webglUtilsModule.createDataTexture(gl, otherNumData, maxLength, 1, false);
    const carryInTexture = webglUtilsModule.createDataTexture(gl, carryInData, maxLength, 1, false);
    const resultTexture = webglUtilsModule.createDataTexture(gl, null, maxLength, 1, true); // RGBA output

    if (!otherNumTexture || !carryInTexture || !resultTexture) {
        throw new Error("WebGL Error: Failed to create textures for multiply_limb operation.");
    }

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resultTexture, 0);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("WebGL Error: Framebuffer incomplete for multiply_limb. Status: " + gl.checkFramebufferStatus(gl.FRAMEBUFFER));
        throw new Error("WebGL framebuffer incomplete for multiply_limb operation.");
    }

    gl.viewport(0, 0, maxLength, 1);
    gl.useProgram(this.multiplyLimbProgramGL);

    // Use a_positionLocAdd/a_texCoordLocAdd as they are for the same quad geometry
    this._setupQuadVertexBuffer(this.a_positionLocMul || this.a_positionLocAdd, this.quadVertexBufferGL);
    this._setupQuadVertexBuffer(this.a_texCoordLocMul || this.a_texCoordLocAdd, this.quadTexCoordBufferGL);

    gl.uniform1f(this.u_limbValLocMul, singleLimbValue);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, otherNumTexture); gl.uniform1i(this.u_otherNumTextureLocMul, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, carryInTexture); gl.uniform1i(this.u_carryTextureLocMul, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const rawOutputData = webglUtilsModule.readDataFromTexture(gl, fb, maxLength, 1, false); // Read RGBA

    let finalLimbsReversed = []; // Store LSB first
    let jsCarry = 0;
    // rawOutputData is LSB first as texture was processed from texCoord 0 to 1
    for (let i = 0; i < maxLength; i++) {
        const shaderLimb = rawOutputData[i * 4 + 0];   // R component (limb part from shader)
        const shaderCarry = rawOutputData[i * 4 + 1]; // G component (carry-out from this limb's product)

        const currentProductSum = shaderLimb + jsCarry; // Add JS carry from previous (less significant) calculation
        finalLimbsReversed.push(currentProductSum % BASE);
        jsCarry = Math.floor(currentProductSum / BASE) + shaderCarry;
    }
    while (jsCarry > 0) {
        finalLimbsReversed.push(jsCarry % BASE);
        jsCarry = Math.floor(jsCarry / BASE);
    }

    // Cleanup
    gl.deleteTexture(otherNumTexture);
    gl.deleteTexture(carryInTexture);
    gl.deleteTexture(resultTexture);
    gl.deleteFramebuffer(fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Return limbs in MSB-first order as expected by BigIntPrimitive internal representation
    let finalLimbsMSB = finalLimbsReversed.length > 0 ? finalLimbsReversed.reverse() : [0];
    // Normalize by removing leading zeros if the result is not zero
    while(finalLimbsMSB.length > 1 && finalLimbsMSB[0] === 0) {
        finalLimbsMSB.shift();
    }
    if(finalLimbsMSB.length === 0 || (finalLimbsMSB.length === 1 && finalLimbsMSB[0] === 0)) { // Ensure zero is [0]
        finalLimbsMSB = [0];
    }
    return { limbs: finalLimbsMSB }; // Exponent is handled by caller (_core_multiply)
}

  _webgl_multiply_limb_by_bigint(singleLimbValue, otherBigIntLimbsArray) {
    const gl = this.gl;
    const maxLength = otherBigIntLimbsArray.length;

    if (maxLength === 0) return { limbs: [0] }; // Should ideally not happen if otherBigInt is not zero

    // Shader usually processes textures from texCoord (0,0) up to (1,1).
    // For a 1D texture (height=1), if texCoord.x maps 0 to 1 for LSB to MSB of the number,
    // then data in texture should be LSB first.
    const otherNumData = new Float32Array([...otherBigIntLimbsArray].reverse()); // Reverse to LSB-first for texture
    const carryInData = new Float32Array(maxLength).fill(0); // Initial carry for mul_limb is 0 for each position

    const otherNumTexture = webglUtilsModule.createDataTexture(gl, otherNumData, maxLength, 1, false);
    const carryInTexture = webglUtilsModule.createDataTexture(gl, carryInData, maxLength, 1, false);
    const resultTexture = webglUtilsModule.createDataTexture(gl, null, maxLength, 1, true); // RGBA output

    if (!otherNumTexture || !carryInTexture || !resultTexture) {
        throw new Error("WebGL Error: Failed to create textures for multiply_limb operation.");
    }

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resultTexture, 0);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("WebGL Error: Framebuffer incomplete for multiply_limb. Status: " + gl.checkFramebufferStatus(gl.FRAMEBUFFER));
        throw new Error("WebGL framebuffer incomplete for multiply_limb operation.");
    }

    gl.viewport(0, 0, maxLength, 1);
    gl.useProgram(this.multiplyLimbProgramGL);

    // Use a_positionLocAdd/a_texCoordLocAdd as they are for the same quad geometry
    this._setupQuadVertexBuffer(this.a_positionLocMul || this.a_positionLocAdd, this.quadVertexBufferGL);
    this._setupQuadVertexBuffer(this.a_texCoordLocMul || this.a_texCoordLocAdd, this.quadTexCoordBufferGL);

    gl.uniform1f(this.u_limbValLocMul, singleLimbValue);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, otherNumTexture); gl.uniform1i(this.u_otherNumTextureLocMul, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, carryInTexture); gl.uniform1i(this.u_carryTextureLocMul, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const rawOutputData = webglUtilsModule.readDataFromTexture(gl, fb, maxLength, 1, false); // Read RGBA

    let finalLimbsReversed = []; // Store LSB first
    let jsCarry = 0;
    // rawOutputData is LSB first as texture was processed from texCoord 0 to 1
    for (let i = 0; i < maxLength; i++) {
        const shaderLimb = rawOutputData[i * 4 + 0];   // R component from shader (limb part of product)
        const shaderCarry = rawOutputData[i * 4 + 1]; // G component from shader (carry-out from this limb's product)

        const currentProductSum = shaderLimb + jsCarry; // Add JS carry from previous (less significant) calculation
        finalLimbsReversed.push(currentProductSum % BASE);
        jsCarry = Math.floor(currentProductSum / BASE) + shaderCarry;
    }
    while (jsCarry > 0) {
        finalLimbsReversed.push(jsCarry % BASE);
        jsCarry = Math.floor(jsCarry / BASE);
    }

    // Cleanup
    gl.deleteTexture(otherNumTexture);
    gl.deleteTexture(carryInTexture);
    gl.deleteTexture(resultTexture);
    gl.deleteFramebuffer(fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Return limbs in MSB-first order as expected by BigIntPrimitive internal representation
    let finalLimbsMSB = finalLimbsReversed.length > 0 ? finalLimbsReversed.reverse() : [0];
    // Normalize by removing leading zeros if the result is not zero
    while(finalLimbsMSB.length > 1 && finalLimbsMSB[0] === 0) {
        finalLimbsMSB.shift();
    }
    if(finalLimbsMSB.length === 0 || (finalLimbsMSB.length === 1 && finalLimbsMSB[0] === 0)) { // Ensure zero is [0]
        finalLimbsMSB = [0];
    }
    return { limbs: finalLimbsMSB }; // Exponent is handled by caller (_core_multiply)
}

  _webgl_multiply_limb_by_bigint(singleLimbValue, otherBigIntLimbsArray) {
    const gl = this.gl;
    const maxLength = otherBigIntLimbsArray.length;

    if (maxLength === 0) return { limbs: [0] };

    // Shader expects LSB-first data if texCoord.x from 0 to 1 processes LSB to MSB.
    const otherNumData = new Float32Array([...otherBigIntLimbsArray].reverse()); // Convert to LSB-first for texture
    const carryInData = new Float32Array(maxLength).fill(0);

    const otherNumTexture = webglUtilsModule.createDataTexture(gl, otherNumData, maxLength, 1, false);
    const carryInTexture = webglUtilsModule.createDataTexture(gl, carryInData, maxLength, 1, false);
    const resultTexture = webglUtilsModule.createDataTexture(gl, null, maxLength, 1, true); // RGBA output

    if (!otherNumTexture || !carryInTexture || !resultTexture) {
        throw new Error("Failed to create WebGL textures for multiply_limb.");
    }

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resultTexture, 0);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("WebGL Error: Framebuffer incomplete for multiply_limb. Status: " + gl.checkFramebufferStatus(gl.FRAMEBUFFER));
        throw new Error("WebGL framebuffer incomplete for multiply_limb.");
    }

    gl.viewport(0, 0, maxLength, 1);
    gl.useProgram(this.multiplyLimbProgramGL);

    this._setupQuadVertexBuffer(this.a_positionLocMul || this.a_positionLocAdd, this.quadVertexBufferGL);
    this._setupQuadVertexBuffer(this.a_texCoordLocMul || this.a_texCoordLocAdd, this.quadTexCoordBufferGL);

    gl.uniform1f(this.u_limbValLocMul, singleLimbValue);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, otherNumTexture); gl.uniform1i(this.u_otherNumTextureLocMul, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, carryInTexture); gl.uniform1i(this.u_carryTextureLocMul, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const rawOutputData = webglUtilsModule.readDataFromTexture(gl, fb, maxLength, 1, false); // Read RGBA

    let finalLimbsReversed = []; // Store LSB first
    let jsCarry = 0;
    // rawOutputData is LSB first as texture was processed from texCoord 0 to 1 (LSB to MSB)
    for (let i = 0; i < maxLength; i++) {
        const shaderLimb = rawOutputData[i * 4 + 0];
        const shaderCarry = rawOutputData[i * 4 + 1];

        const currentProductSum = shaderLimb + jsCarry;
        finalLimbsReversed.push(currentProductSum % BASE);
        jsCarry = Math.floor(currentProductSum / BASE) + shaderCarry;
    }
    while (jsCarry > 0) {
        finalLimbsReversed.push(jsCarry % BASE);
        jsCarry = Math.floor(jsCarry / BASE);
    }

    gl.deleteTexture(otherNumTexture);
    gl.deleteTexture(carryInTexture);
    gl.deleteTexture(resultTexture);
    gl.deleteFramebuffer(fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let finalLimbsMSB = finalLimbsReversed.length > 0 ? finalLimbsReversed.reverse() : [0];
    while(finalLimbsMSB.length > 1 && finalLimbsMSB[0] === 0) finalLimbsMSB.shift();
    if(finalLimbsMSB.length === 0 || (finalLimbsMSB.length === 1 && finalLimbsMSB[0] === 0)) finalLimbsMSB = [0];
    return { limbs: finalLimbsMSB };
}

  _multiply_limb_by_bigint(limbValue, otherNumber) { // otherNumber is a BigIntPrimitive
      // limbValue is a number (one limb from the first operand, e.g., up to BASE-1)
      // otherNumber is a BigIntPrimitive (positive magnitude, exponent may not be 0)
      if (limbValue === 0 || otherNumber.isZero()) {
          return new BigIntPrimitive("0", this.canvas, { forceCPU: true });
      }

      let otherLimbs = [...otherNumber.limbs].reverse(); // LSB first
      let resultLimbsReversed = [];
      let carry = 0;

      for (let i = 0; i < otherLimbs.length; i++) {
          const product = otherLimbs[i] * limbValue + carry;
          resultLimbsReversed.push(product % BASE);
          carry = Math.floor(product / BASE);
      }
      while (carry > 0) {
          resultLimbsReversed.push(carry % BASE);
          carry = Math.floor(carry / BASE);
      }

      let finalResultLimbs = resultLimbsReversed.reverse(); // MSB first
      while (finalResultLimbs.length > 1 && finalResultLimbs[0] === 0) {
          finalResultLimbs.shift();
      }
      if (finalResultLimbs.length === 0) finalResultLimbs = [0];


      const resultNumCPU = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
      resultNumCPU.limbs = finalResultLimbs;
      resultNumCPU.sign = 1; // Sign is handled by caller
      resultNumCPU.exponent = otherNumber.exponent; // Exponent of this partial product before shifting by caller
      if (resultNumCPU.isZero()) { resultNumCPU.exponent = 0; }
      return resultNumCPU;
  }

   _core_multiply(num1, num2) { // num1 and num2 are positive BigIntPrimitives
    if (num1.isZero() || num2.isZero()) {
        const zeroRes = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
        zeroRes.exponent = 0; // Ensure exponent is normalized for zero
        return zeroRes;
    }

    // The final exponent will be the sum of the exponents of the operands.
    // _core_multiply should deal with coefficient multiplication.
    // The actual exponent adjustment happens in the public multiply method.
    const resultExponent = num1.exponent + num2.exponent;


    let totalResult = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    // Limbs are MSB-first. For schoolbook, iterate through multiplier's limbs LSB-first.
    const n1_limbs_reversed = [...num1.limbs].reverse(); // LSB first for num1 (multiplier)

    for (let i = 0; i < n1_limbs_reversed.length; i++) {
        const limbOfNum1 = n1_limbs_reversed[i]; // This is a numeric value of a limb
        if (limbOfNum1 === 0) continue;

        let partialProductLimbArray; // This will store MSB-first limbs
        let webglMultiplyLimbSuccess = false;

        // Try WebGL path for limb multiplication
        // Ensure num2.limbs exists and is not empty before attempting WebGL
        if (this.gl && this.multiplyLimbProgramGL && !this.forceCPU && !(num2.forceCPU) && num2.limbs && num2.limbs.length > 0) {
            try {
                // _webgl_multiply_limb_by_bigint expects MSB-first limb array for otherBigIntLimbsArray
                // and returns MSB-first limbs
                const webglResult = this._webgl_multiply_limb_by_bigint(limbOfNum1, num2.limbs);
                partialProductLimbArray = webglResult.limbs;
                webglMultiplyLimbSuccess = true;
            } catch (e) {
                console.warn("WebGL _webgl_multiply_limb_by_bigint failed, falling back to CPU for this partial product:", e);
                webglMultiplyLimbSuccess = false;
            }
        }

        if (!webglMultiplyLimbSuccess) {
            // CPU fallback for this partial product
            // _multiply_limb_by_bigint expects a BigIntPrimitive for otherNumber
            const tempNum2Clone = new BigIntPrimitive(num2); // Clone num2 to pass to CPU method
            tempNum2Clone.sign = 1; // Ensure it's positive for core multiplication
            const tempPartialProduct = this._multiply_limb_by_bigint(limbOfNum1, tempNum2Clone);
            partialProductLimbArray = tempPartialProduct.limbs; // MSB-first from CPU method
        }

        const partialProductMagnitude = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
        partialProductMagnitude.limbs = partialProductLimbArray;
        partialProductMagnitude.sign = 1;
        // The exponent of (limb * number) is initially the exponent of 'number' (num2)
        partialProductMagnitude.exponent = num2.exponent;

        if (partialProductMagnitude.isZero()) {
            partialProductMagnitude.exponent = 0;
        } else {
            // Shift for the position of limbOfNum1. i is 0-indexed from LSB.
            // Each limb position corresponds to a power of BASE (e.g. BASE^0, BASE^1, BASE^2...)
            // This means adding i * BASE_LOG10 to its exponent.
            partialProductMagnitude.exponent += (i * BASE_LOG10);
        }

        totalResult = totalResult.add(partialProductMagnitude);
    }
    totalResult.sign = 1;
    // The exponent of totalResult is managed by the .add() operations.
    // The public multiply() method will set the final correct exponent.
    return totalResult;
  }

  multiply(otherBigInt) { // Public method
    const self = this;
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive."); }
    if (self.isZero() || otherBigInt.isZero()) {
        return new BigIntPrimitive("0", self.canvas, { forceCPU: self.forceCPU || otherBigInt.forceCPU });
    }
    const finalExponent = self.exponent + otherBigInt.exponent;
    const resultSign = (self.sign === otherBigInt.sign) ? 1 : -1;

    const tempNum1 = new BigIntPrimitive(self.limbs.join('') + '0'.repeat(self.exponent), self.canvas, {forceCPU: true});
    const tempNum2 = new BigIntPrimitive(otherBigInt.limbs.join('') + '0'.repeat(otherBigInt.exponent), otherBigInt.canvas, {forceCPU: true});

    let absResult;
    let gl;
    if (!self.forceCPU && !otherBigInt.forceCPU && self.canvas && typeof webglUtilsModule !== 'undefined' && (gl = webglUtilsModule.initWebGL(self.canvas))) {
      absResult = self._core_multiply(tempNum1, tempNum2);
    } else {
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
    }
    absResult.exponent = finalExponent;
    absResult.sign = resultSign;
    if (absResult.isZero()) {
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
    const currentOptions = { forceCPU: this.forceCPU };
    const Ctor = BigIntPrimitive;
    let s_abs = this.abs().toString();

    let s_coeffs = s_abs;
    let s_abs_exp = 0;
    const dp_idx = s_abs.indexOf('.');
    if (dp_idx !== -1) {
        s_coeffs = s_abs.replace('.', '');
        s_abs_exp = -(s_abs.length - 1 - dp_idx);
    }

    let lowStr, highStr;
    if (m <= 0) {
        highStr = s_coeffs; lowStr = "0";
    } else if (m >= s_coeffs.length) {
        lowStr = s_coeffs; highStr = "0";
    } else {
        highStr = s_coeffs.substring(0, s_coeffs.length - m);
        lowStr = s_coeffs.substring(s_coeffs.length - m);
    }
    const high = new Ctor(highStr, this.canvas, currentOptions);
    const low = new Ctor(lowStr, this.canvas, currentOptions);

    high.exponent += (s_abs_exp + m);
    low.exponent += s_abs_exp;

    if(high.isZero()){ high.exponent = 0;} else { while(high.limbs.length > 1 && high.limbs[high.limbs.length-1]===0){ high.limbs.pop(); high.exponent++;}}
    if(low.isZero()){ low.exponent = 0;} else { while(low.limbs.length > 1 && low.limbs[low.limbs.length-1]===0){ low.limbs.pop(); low.exponent++;}}

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
    if (positiveDividend.isZero()) { return { quotient: new BigIntPrimitive("0", this.canvas), remainder: new BigIntPrimitive("0", this.canvas) }; }
    const comparison = positiveDividend.compareMagnitude(positiveDivisor);
    if (comparison < 0) { return { quotient: new BigIntPrimitive("0", this.canvas), remainder: new BigIntPrimitive(positiveDividend, this.canvas) }; }
    if (comparison === 0) { return { quotient: new BigIntPrimitive("1", this.canvas), remainder: new BigIntPrimitive("0", this.canvas) }; }

    let dividendStr = positiveDividend.abs().toString();
    let divisorStr = positiveDivisor.abs().toString();

    dividendStr = dividendStr.split('.')[0];
    divisorStr = divisorStr.split('.')[0];

    if (divisorStr === "0" || BigInt(divisorStr) === 0n) throw new Error("Division by zero.");
    if (dividendStr === "0") return { quotient: new BigIntPrimitive("0", this.canvas), remainder: new BigIntPrimitive("0", this.canvas) };

    const q = BigInt(dividendStr) / BigInt(divisorStr);
    const r = BigInt(dividendStr) % BigInt(divisorStr);
    return { quotient: new BigIntPrimitive(q.toString(), this.canvas), remainder: new BigIntPrimitive(r.toString(), this.canvas) };
  }

  // Method to perform division on absolute values, scaled for precision.
  // `this` is the dividend (must be positive BigIntPrimitive).
  // `divisorObj` is the divisor (must be positive BigIntPrimitive).
  // `precisionForScaling` is the number of decimal places to effectively shift the dividend for.
  _decimalDivide(divisorObj, precisionForScaling) {
    const dividendObj = this; // 'this' is the dividend

    if (divisorObj.isZero()) {
      throw new Error("Division by zero in _decimalDivide.");
    }
    if (dividendObj.isZero()) {
      return new BigIntPrimitive("0", this.canvas);
    }
    // Inputs are expected to be absolute values (positive)
     if (dividendObj.isNegative() || divisorObj.isNegative()) {
      throw new Error("_decimalDivide expects positive inputs.");
    }

    // Use new instances to avoid modifying the originals if they were 'this' or passed by reference elsewhere
    const dividendInternal = new BigIntPrimitive(dividendObj, this.canvas);
    const divisorInternal = new BigIntPrimitive(divisorObj, this.canvas);

    let d_val_str = dividendInternal.limbs.join('');
    let d_exp = dividendInternal.exponent;
    let v_val_str = divisorInternal.limbs.join('');
    let v_exp = divisorInternal.exponent;

    let dividendStrForScaling = d_val_str;
    // Correctly use precisionForScaling (the 2nd formal parameter to this method, after 'this')
    const actualNumDecimalPlaces = (typeof precisionForScaling === 'number' && precisionForScaling >= 0) ? precisionForScaling : 0;
    dividendStrForScaling += '0'.repeat(actualNumDecimalPlaces);

    const biDividend = BigInt(dividendStrForScaling);
    const biDivisor = BigInt(v_val_str);

    if (biDivisor === 0n) { // Should be caught by divisorObj.isZero() earlier, but as a safeguard
        throw new Error("Division by zero after BigInt conversion for divisor.");
    }
    const biResult = biDividend / biDivisor;
    const q_int_str = biResult.toString();

    const resultNum = new BigIntPrimitive(q_int_str, this.canvas, { forceCPU: true });

    const exponent_from_parsing_resultStr = resultNum.exponent; // exponent from parsing q_int_str
    // Adjust exponent: add original dividend's exponent, subtract original divisor's exponent,
    // and subtract the number of decimal places we scaled by.
    const final_exponent_for_resultNum = exponent_from_parsing_resultStr + d_exp - v_exp - actualNumDecimalPlaces;
    resultNum.exponent = final_exponent_for_resultNum;

    if (resultNum.isZero()) {
        resultNum.exponent = 0; // Normalize exponent for zero
    }
    resultNum.sign = 1; // Result of _decimalDivide is always positive (magnitude)

    return resultNum;
  }

  divideAndRemainder(divisorBigInt) {
    if (!(divisorBigInt instanceof BigIntPrimitive)) { throw new TypeError("Divisor must be an instance of BigIntPrimitive."); }
    if (divisorBigInt.isZero()) { throw new Error("Division by zero"); }

    const quotient = this.divide(divisorBigInt);

    const oldDP = BigIntPrimitive.DP;
    const oldRM = BigIntPrimitive.RM;

    let tempDP = oldDP;
    const thisStr = this.toString();
    const divisorStr = divisorBigInt.toString();
    const thisDP = (thisStr.includes('.')) ? thisStr.length - thisStr.indexOf('.') - 1 : 0;
    const divisorDPVal = (divisorStr.includes('.')) ? divisorStr.length - divisorStr.indexOf('.') - 1 : 0;
    tempDP = Math.max(oldDP, thisDP, divisorDPVal, Math.abs(quotient.exponent)) + 10;


    BigIntPrimitive.DP = tempDP;
    BigIntPrimitive.RM = BigIntPrimitive.roundDown;

    const product = quotient.multiply(divisorBigInt);
    const remainder = this.subtract(product);

    BigIntPrimitive.DP = oldDP;
    BigIntPrimitive.RM = oldRM;

    if (!remainder.isZero()) {
        remainder.sign = this.sign;
    } else {
        remainder.sign = 1;
        remainder.exponent = 0;
    }

    return { quotient, remainder };
  }

  divide(divisorBigInt) {
    if (!(divisorBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Divisor must be an instance of BigIntPrimitive.");
    }
    if (divisorBigInt.isZero()) {
      throw new Error("Division by zero");
    }
    if (this.isZero()) {
      return new BigIntPrimitive("0", this.canvas);
    }

    const quotientSign = (this.sign === divisorBigInt.sign) ? 1 : -1;

    const thisCoeffExp = this.exponent;
    const divisorCoeffExp = divisorBigInt.exponent;
    // Ensure internalPrecision is always a sensible, non-negative number
    let precisionBonus = 5;
    if (thisCoeffExp && typeof thisCoeffExp === 'number') precisionBonus += Math.abs(thisCoeffExp);
    if (divisorCoeffExp && typeof divisorCoeffExp === 'number') precisionBonus += Math.abs(divisorCoeffExp);
    const internalPrecision = BigIntPrimitive.DP + precisionBonus;

    let absDividend = this.abs();
    let absDivisor = divisorBigInt.abs();

    let quotient = absDividend._decimalDivide(absDivisor, internalPrecision);

    quotient = quotient.round(BigIntPrimitive.DP, BigIntPrimitive.RM);

    if (quotient.isZero()) {
      quotient.sign = 1;
      quotient.exponent = 0;
    } else {
      quotient.sign = quotientSign;
    }
    return quotient;
  }

  remainder(divisorBigInt) { const { remainder } = this.divideAndRemainder(divisorBigInt); return remainder; }

  static _staticRound(inputLimbsMsbFirst, inputExponent, inputSign, dpUndefined, rmUndefined) {
    const dp = dpUndefined === undefined ? 0 : dpUndefined;
    const rm = rmUndefined === undefined ? BigIntPrimitive.RM : rmUndefined;

    const tempNumForStr = new BigIntPrimitive("0");
    tempNumForStr.limbs = [...inputLimbsMsbFirst];
    tempNumForStr.exponent = inputExponent;

    if (tempNumForStr.isZero()) {
      return { limbs: [0], exponent: 0, sign: 1 };
    }

    const originalPETemp = BigIntPrimitive.PE;
    const originalNETemp = BigIntPrimitive.NE;
    BigIntPrimitive.PE = 1e9;
    BigIntPrimitive.NE = -1e9;
    let s = tempNumForStr.toString();
    BigIntPrimitive.PE = originalPETemp;
    BigIntPrimitive.NE = originalNETemp;

    let [integerS, fractionalS = ''] = s.split('.');
    if (integerS === "" && fractionalS !== "") integerS = "0";
    if (integerS === "-0" && inputSign === -1) {  }
    else if (integerS === "-0") integerS = "0";
    if (integerS === "") integerS = "0";

    let applyRoundingEffect = 0;
    const effectiveSign = (integerS === "0" && (!fractionalS || /^[0]*$/.test(fractionalS))) ? 1 : inputSign;


    if (dp >= 0) {
        if (dp >= fractionalS.length) {
        } else {
            const roundDigitVal = parseInt(fractionalS[dp], 10);
            const trailingDigitsStr = fractionalS.substring(dp + 1);
            const hasNonZeroTrailing = !/^[0]*$/.test(trailingDigitsStr);
            const isExactlyHalfWay = roundDigitVal === 5 && !hasNonZeroTrailing;

            switch (rm) {
                case BigIntPrimitive.roundDown: break;
                case BigIntPrimitive.roundHalfUp: if (roundDigitVal >= 5) applyRoundingEffect = 1; break;
                case BigIntPrimitive.roundHalfEven:
                    if (roundDigitVal > 5) applyRoundingEffect = 1;
                    else if (isExactlyHalfWay) {
                        const prevDigit = dp > 0 ? parseInt(fractionalS[dp - 1], 10) : parseInt(integerS[integerS.length - 1] || '0', 10);
                        if (prevDigit % 2 !== 0) applyRoundingEffect = 1;
                    } else if (roundDigitVal === 5 && hasNonZeroTrailing) {
                        applyRoundingEffect = 1;
                    }
                    break;
                case BigIntPrimitive.roundUp: if (!/^[0]*$/.test(fractionalS.substring(dp))) applyRoundingEffect = 1; break;
            }
            fractionalS = fractionalS.substring(0, dp);
        }
    } else {
        const roundPosInInt = integerS.length + dp;
        let originalFractionalForCheck = fractionalS;
        fractionalS = '';

        if (roundPosInInt <= 0) {
            const isEffectivelyZeroMagnitude = (integerS === "0" || integerS === "-0") && /^[0]*$/.test(originalFractionalForCheck);

            if (isEffectivelyZeroMagnitude) {
                 applyRoundingEffect = 0;
            } else {
                 const firstDiscardedDigit = (integerS.startsWith("-") ? integerS[1] : integerS[0]) || '0';
                 const firstDiscardedDigitVal = parseInt(firstDiscardedDigit, 10);
                 const allDiscardedAreZero = /^[0]*$/.test(integerS.substring(1 + (integerS.startsWith("-")?1:0))) && /^[0]*$/.test(originalFractionalForCheck);


                 switch (rm) {
                    case BigIntPrimitive.roundDown: break;
                    case BigIntPrimitive.roundHalfUp: if (firstDiscardedDigitVal >= 5) applyRoundingEffect = 1; break;
                    case BigIntPrimitive.roundHalfEven:
                        if (firstDiscardedDigitVal > 5) applyRoundingEffect = 1;
                        else if (firstDiscardedDigitVal === 5 && !allDiscardedAreZero ) {
                                applyRoundingEffect = 1;
                        }
                        break;
                    case BigIntPrimitive.roundUp: applyRoundingEffect = 1; break;
                }
            }
            integerS = applyRoundingEffect ? "1" : "0";
            applyRoundingEffect = 0;
        } else {
            const roundDigitVal = parseInt(integerS[roundPosInInt] || '0', 10);
            const discardedFollowingIntPartIsNonZero = !/^[0]*$/.test(integerS.substring(roundPosInInt + 1));
            const isExactlyHalfWay = roundDigitVal === 5 && !discardedFollowingIntPartIsNonZero && /^[0]*$/.test(originalFractionalForCheck);

            switch (rm) {
                case BigIntPrimitive.roundDown: break;
                case BigIntPrimitive.roundHalfUp: if (roundDigitVal >= 5) applyRoundingEffect = 1; break;
                case BigIntPrimitive.roundHalfEven:
                    if (roundDigitVal > 5) applyRoundingEffect = 1;
                    else if (isExactlyHalfWay) {
                        const prevDigit = parseInt(integerS[roundPosInInt - 1] || '0', 10);
                        if (prevDigit % 2 !== 0) applyRoundingEffect = 1;
                    } else if (roundDigitVal === 5 && !isExactlyHalfWay ) {
                         applyRoundingEffect = 1;
                    }
                    break;
                case BigIntPrimitive.roundUp: if (!/^[0]*$/.test(integerS.substring(roundPosInInt)) || !/^[0]*$/.test(originalFractionalForCheck)) applyRoundingEffect = 1; break;
            }
            integerS = integerS.substring(0, roundPosInInt);
            if(integerS === "" || integerS ==="-") integerS = effectiveSign === -1 && parseFloat(s) !==0 ? "-0" : "0";
        }
    }

    if (applyRoundingEffect && effectiveSign === -1) {
    }


    if (applyRoundingEffect) {
        let intPartForCarry = integerS.startsWith('-') ? integerS.substring(1) : integerS;
        let combinedStrForCarry = intPartForCarry + (dp > 0 ? fractionalS : "");
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

        const originalIntegerLengthBeforeCarry = intPartForCarry.length;
        let newIntegerLength = originalIntegerLengthBeforeCarry;
        if (digitsArr.length > combinedStrForCarry.length ) {
             if (dp <= 0 || (digitsArr.length - fractionalS.length > originalIntegerLengthBeforeCarry)) {
                newIntegerLength++;
             }
        }


        if (dp > 0) {
            integerS = digitsArr.slice(0, newIntegerLength).join('');
            fractionalS = digitsArr.slice(newIntegerLength).join('');
        } else {
            integerS = digitsArr.join('');
        }
        if (integerS === "") integerS = "0";
        if (effectiveSign === -1 && integerS !=="0") integerS = "-" + integerS;
    }

    let finalS;
    if (dp > 0) {
        finalS = (effectiveSign === -1 && integerS === "0" && !/^[0]*$/.test(fractionalS) ? "-0" : integerS) + '.' + (fractionalS || '').padEnd(dp, '0');
    } else if (dp < 0) {
        if (integerS === "0" || integerS === "-0") {
            finalS = "0";
        } else {
            finalS = integerS + "0".repeat(-dp);
        }
    } else {
        finalS = integerS;
    }

    const resultNum = new BigIntPrimitive(finalS);
    if (resultNum.isZero()) {
      resultNum.sign = 1;
      resultNum.exponent = 0;
    } else {
      resultNum.sign = effectiveSign;
    }

    return { limbs: resultNum.limbs, exponent: resultNum.exponent, sign: resultNum.sign };
  }

  round(dp, rm) {
    const roundingMode = rm === undefined ? BigIntPrimitive.RM : rm;
    const dpToUse = dp === undefined ? 0 : dp;

    const roundedParts = BigIntPrimitive._staticRound(
        this.limbs, this.exponent, this.sign, dpToUse, roundingMode
    );

    const result = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
    result.limbs = roundedParts.limbs;
    result.exponent = roundedParts.exponent;
    result.sign = roundedParts.sign;
    result._roundedDp = dpToUse;

    if (result.isZero()) {
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
        BigIntPrimitive.PE = 1e9; BigIntPrimitive.NE = -1e9;
        let coeffStrTemp = coeff.toString();
        BigIntPrimitive.PE = tempPE; BigIntPrimitive.NE = tempNE;
        if(coeffStrTemp.includes('.')) coeffStrTemp = coeffStrTemp.replace(/\.?0+$/, '');
        if(coeffStrTemp.startsWith('0.') && coeffStrTemp.length > 2) {  }
        else if (coeffStrTemp.includes('.') && coeffStrTemp.endsWith('.')) coeffStrTemp = coeffStrTemp.slice(0,-1);

        roundedCoeff = new BigIntPrimitive(coeffStrTemp, this.canvas, {forceCPU: this.forceCPU});

        const tempStr = roundedCoeff.toString();
        if (tempStr.includes('e')) {
            const [basePart, expPart] = tempStr.split('e');
            sciExp += parseInt(expPart);
            roundedCoeff = new BigIntPrimitive(basePart, this.canvas, {forceCPU: this.forceCPU});
        }


        if (roundedCoeff.limbs.join('').length + roundedCoeff.exponent > 1 && roundedCoeff.limbs[0] !==0 ) {
             sciExp += (roundedCoeff.limbs.join('').length + roundedCoeff.exponent -1);
             roundedCoeff.exponent = -(roundedCoeff.limbs.join('').length-1);
        }


    } else {
        let tempCoeffForRounding = new BigIntPrimitive(this, this.canvas, {forceCPU: true});
        tempCoeffForRounding.sign = 1;
        const originalLen = tempCoeffForRounding.limbs.length;
        const originalExp = tempCoeffForRounding.exponent;
        tempCoeffForRounding.exponent = -(originalLen -1);

        roundedCoeff = tempCoeffForRounding.round(dp, actualRm);
        sciExp = originalLen + originalExp -1;

        const roundedCoeffCoeffLen = roundedCoeff.limbs.join('').length;
        const roundedCoeffIntPartLen = roundedCoeffCoeffLen + roundedCoeff.exponent;

        if(roundedCoeffIntPartLen > 1){
            sciExp += (roundedCoeffIntPartLen -1);
            roundedCoeff.exponent -= (roundedCoeffIntPartLen -1);
        }
    }

    let coeffStrFinal = roundedCoeff.limbs.join('');
    if (roundedCoeff.exponent < 0) {
        const fracLen = -roundedCoeff.exponent;
        if (coeffStrFinal.length > fracLen) {
             coeffStrFinal = coeffStrFinal.slice(0, coeffStrFinal.length - fracLen) + "." + coeffStrFinal.slice(coeffStrFinal.length - fracLen);
        } else {
            coeffStrFinal = "0." + "0".repeat(fracLen - coeffStrFinal.length) + coeffStrFinal;
        }
    } else if (roundedCoeff.exponent > 0) {
        coeffStrFinal += "0".repeat(roundedCoeff.exponent);
    }

    if (dp !== undefined) {
        let [intPart, fracPart=""] = coeffStrFinal.split('.');
        fracPart = fracPart.padEnd(dp, '0').substring(0,dp);
        if (dp === 0) coeffStrFinal = intPart;
        else finalCoeffStr = intPart + "." + fracPart;
    } else {
        if (coeffStrFinal.includes('.')) coeffStrFinal = coeffStrFinal.replace(/\.0+$/, '').replace(/(\.[0-9]*[1-9])0+$/, '$1');
    }


    let res = (this.sign === -1 ? "-" : "") + coeffStrFinal;
    res += 'e' + (sciExp >= 0 ? '+' : '-') + Math.abs(sciExp);
    return res;
  }

  toFixed(dpUndefined, rmUndefined) {
    const actualRm = (rmUndefined === undefined ? BigIntPrimitive.RM : rmUndefined);
    let dp = dpUndefined;

    if (dp === undefined) {
        const oldPE = BigIntPrimitive.PE; BigIntPrimitive.PE = 1e9;
        const oldNE = BigIntPrimitive.NE; BigIntPrimitive.NE = -1e9;
        const originalRoundedDp = this._roundedDp;
        delete this._roundedDp;
        const str = this.toString();
        this._roundedDp = originalRoundedDp;
        BigIntPrimitive.PE = oldPE; BigIntPrimitive.NE = oldNE;
        return str;
    }

    if (typeof dp !== 'number' || !Number.isInteger(dp) || dp < 0 ) {
        throw new RangeError("toFixed() argument must be a non-negative integer.");
    }

    const oldPE = BigIntPrimitive.PE; BigIntPrimitive.PE = 1e9;
    const oldNE = BigIntPrimitive.NE; BigIntPrimitive.NE = -1e9;

    const roundedNum = this.round(dp, actualRm);

    BigIntPrimitive.PE = oldPE; BigIntPrimitive.NE = oldNE;

    return roundedNum.toString();
  }

  sqrt() { // Placeholder, not part of this subtask's focus
    if (this.isNegative()) {
      throw new Error('[big.js] No square root of negative number');
    }
    if (this.isZero()) {
      return new BigIntPrimitive('0', this.canvas);
    }

    const S = this;
    const two = new BigIntPrimitive('2', this.canvas);
    const one = new BigIntPrimitive('1', this.canvas);
    const originalDP = BigIntPrimitive.DP;
    const originalRM = BigIntPrimitive.RM;

    const sExponent = S.exponent;
    const sLimbsLength = S.limbs.join('').length;
    const internalDP = originalDP + Math.max(10, sExponent + sLimbsLength + 5);
    const guardDP = originalDP + 3;

    let current_x;

    if (S.eq(one)) {
        current_x = new BigIntPrimitive('1', this.canvas);
    } else {
        BigIntPrimitive.DP = internalDP;
        current_x = S.divide(two);
        BigIntPrimitive.DP = originalDP;

        if (current_x.isZero() && !S.isZero()) {
            if (S.lt(one)) {
                 current_x = new BigIntPrimitive('1', this.canvas);
            } else {
                 current_x = new BigIntPrimitive(S, this.canvas);
            }
        }
    }

    if (current_x.isZero() && !S.isZero()) {
        current_x = new BigIntPrimitive('1', this.canvas);
    }

    const maxIterations = Math.max(25, Math.min(100, originalDP + sLimbsLength + 10));

    for (let i = 0; i < maxIterations; i++) {
      const prev_x_rounded_string = current_x.round(guardDP, originalRM).toString();

      BigIntPrimitive.DP = internalDP;
      BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;

      if (current_x.isZero()) {
          break;
      }

      const S_div_xn = S.divide(current_x);
      let next_x = current_x.add(S_div_xn);
      next_x = next_x.divide(two);

      BigIntPrimitive.DP = originalDP;
      BigIntPrimitive.RM = originalRM;

      if (next_x.round(guardDP, originalRM).toString() === prev_x_rounded_string) {
        current_x = next_x;
        break;
      }
      current_x = next_x;

      if (i === maxIterations - 1) {
      }
    }
    return current_x.round(originalDP, originalRM);
  }

  _initWebGLPrograms() {
    if (!this.canvas || typeof webglUtilsModule === 'undefined') return;
    try {
        this.gl = webglUtilsModule.initWebGL(this.canvas);
        if (!this.gl) {
            this.canvas = null; // WebGL failed, fallback to CPU
            return;
        }

        // Addition Program
        const vsAdd = webglUtilsModule.createShader(this.gl, this.gl.VERTEX_SHADER, vertexShaderSrc);
        const fsAdd = webglUtilsModule.createShader(this.gl, this.gl.FRAGMENT_SHADER, fragmentShaderSrc);
        this.additionProgramGL = webglUtilsModule.createProgram(this.gl, vsAdd, fsAdd);

        if (this.additionProgramGL) {
            this.u_num1TextureLocAdd = this.gl.getUniformLocation(this.additionProgramGL, "u_num1Texture");
            this.u_num2TextureLocAdd = this.gl.getUniformLocation(this.additionProgramGL, "u_num2Texture");
            this.u_carryTextureLocAdd = this.gl.getUniformLocation(this.additionProgramGL, "u_carryTexture");
            this.a_positionLocAdd = this.gl.getAttribLocation(this.additionProgramGL, "a_position");
            this.a_texCoordLocAdd = this.gl.getAttribLocation(this.additionProgramGL, "a_texCoord");

            // Create buffers for a unit quad
            const gl = this.gl;
            this.quadVertexBufferGL = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVertexBufferGL);
            const positions = new Float32Array([
                -1, -1,  1, -1,  -1,  1,
                -1,  1,  1, -1,   1,  1,
            ]);
            gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

            this.quadTexCoordBufferGL = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadTexCoordBufferGL);
            const texCoords = new Float32Array([
                0, 0,  1, 0,  0, 1,
                0, 1,  1, 0,  1, 1,
            ]);
            gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

        } else {
            this.canvas = null; // Program creation failed
        }

        // Subtraction Program
        const vsSub = webglUtilsModule.createShader(this.gl, this.gl.VERTEX_SHADER, subtractVertexShaderSrc);
        const fsSub = webglUtilsModule.createShader(this.gl, this.gl.FRAGMENT_SHADER, subtractFragmentShaderSrc);
        this.subtractionProgramGL = webglUtilsModule.createProgram(this.gl, vsSub, fsSub);

        if (this.subtractionProgramGL) {
            this.u_num1TextureLocSub = this.gl.getUniformLocation(this.subtractionProgramGL, "u_num1Texture");
            this.u_num2TextureLocSub = this.gl.getUniformLocation(this.subtractionProgramGL, "u_num2Texture");
            this.u_borrowTextureLocSub = this.gl.getUniformLocation(this.subtractionProgramGL, "u_borrowTexture");
            this.a_positionLocSub = this.gl.getAttribLocation(this.subtractionProgramGL, "a_position");
            this.a_texCoordLocSub = this.gl.getAttribLocation(this.subtractionProgramGL, "a_texCoord");
        } else {
            this.canvas = null; // Subtraction program creation failed
        }

        // Multiply Limb Program
        const vsMulLimb = webglUtilsModule.createShader(this.gl, this.gl.VERTEX_SHADER, multiplyLimbVertexShaderSrc);
        const fsMulLimb = webglUtilsModule.createShader(this.gl, this.gl.FRAGMENT_SHADER, multiplyLimbFragmentShaderSrc);
        this.multiplyLimbProgramGL = webglUtilsModule.createProgram(this.gl, vsMulLimb, fsMulLimb);

        if (this.multiplyLimbProgramGL) {
            this.u_limbValLocMul = this.gl.getUniformLocation(this.multiplyLimbProgramGL, "u_limbVal");
            this.u_otherNumTextureLocMul = this.gl.getUniformLocation(this.multiplyLimbProgramGL, "u_otherNumTexture");
            this.u_carryTextureLocMul = this.gl.getUniformLocation(this.multiplyLimbProgramGL, "u_carryTexture");
            this.a_positionLocMul = this.gl.getAttribLocation(this.multiplyLimbProgramGL, "a_position");
            this.a_texCoordLocMul = this.gl.getAttribLocation(this.multiplyLimbProgramGL, "a_texCoord");
        } else {
            this.canvas = null; // Multiply limb program creation failed
        }

    } catch (error) {
        console.error("Error initializing WebGL programs:", error);
        this.canvas = null; // Fallback to CPU
    }
  }

  _setupQuadVertexBuffer(attrLocation, buffer) {
    const gl = this.gl;
    if (!gl || !buffer || attrLocation < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(attrLocation);
    gl.vertexAttribPointer(attrLocation, 2, gl.FLOAT, false, 0, 0); // 2 components per vertex
  }

}

export { BigIntPrimitive };
