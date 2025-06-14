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

    // Correct limb parsing based on BASE_LOG10
    let tempLimbs = [];
    if (coefficientStr === "0") {
        tempLimbs = [0];
    } else {
        let currentPos = coefficientStr.length;
        while (currentPos > 0) {
            const start = Math.max(0, currentPos - BASE_LOG10);
            const limbStr = coefficientStr.substring(start, currentPos);
            tempLimbs.unshift(parseInt(limbStr, 10));
            currentPos = start;
        }
    }
    this.limbs = tempLimbs.length > 0 ? tempLimbs : [0]; // Ensure limbs is never empty

    // Normalization: Remove leading zeros from the limbs array (e.g. [0, 123] -> [123])
    // This is mostly for internal consistency if parsing "00123" with BASE_LOG10=2 results in [0, 1, 23] initially.
    // The above parsing loop should generally avoid creating true leading zero limbs like [0, x, y],
    // but if coefficientStr itself was "007" and BASE_LOG10=4, it would be [7], not [0,7].
    // This handles cases like "0000" parsed into [0,0] for BASE_LOG10=2 -> [0]
    while (this.limbs.length > 1 && this.limbs[0] === 0) {
        this.limbs.shift();
        // Exponent does not change here because these are leading zero limbs, not trailing fractional zero limbs.
    }

    // Normalization: Remove trailing zero limbs from fractional parts if they were somehow introduced
    // AND adjust exponent. This was original logic.
    // Example: If parsing "123.4500" with BASE_LOG10=2, coefficientStr "1234500", exponent initially points after "5".
    // Limbs: [1, 23, 45, 0]. We want [1, 23, 45] and adjust exponent.
    // The original exponent calculation based on decimal point already handles the main part.
    // This loop is more about normalizing if the coefficient string itself had trailing zeros that became full limbs.
    // E.g. string "1230000" with exp 0, BASE_LOG10=4. Limbs: [123, 0]. We want [123] exp 1 (if interpreted as 123 * BASE^1).
    // The current coefficientStr parsing `parseInt` on substrings of length BASE_LOG10 handles this.
    // "1230000" -> limbs [123, 0].  If this were from "123.0000", exp would be -4.
    // The original logic for removing trailing zeros from this.limbs and incrementing exponent
    // was for when this.limbs were single digits.
    // With new limb system, if this.limbs = [val, 0] and exp = N, this means (val * BASE + 0) * 10^N.
    // If we pop the 0, it becomes val * 10^(N + BASE_LOG10).
    // This needs careful review. The original `while (this.limbs.length > 1 && this.limbs[this.limbs.length - 1] === 0)`
    // was for single digits, where popping a zero digit meant multiplying the number by 10, hence exponent++.
    // Now, if a limb is 0, it's a full zero limb. E.g. "10000" is `[1,0]` if BASE_LOG10=4. (No, "10000" is [1] exp 1)
    // Let's consider "1.0000" (BASE_LOG10=4). coeff="10000", exp=-4. Limbs=[1,0]. We want [1], exp=0.
    // So if last limb is 0, and length > 1, pop it and add BASE_LOG10 to exponent.
    while (this.limbs.length > 1 && this.limbs[this.limbs.length - 1] === 0) {
      this.limbs.pop();
      this.exponent += BASE_LOG10;
    }

    // Final normalization for zero
    if (this.limbs.length === 1 && this.limbs[0] === 0) {
      this.exponent = 0; // True zero has exponent 0
      this.sign = 1;     // And positive sign
    }
  }

  _getCoefficientString() {
    // Assuming BASE_LOG10 is accessible as a module constant.
    if (this.isZero()) return "0";
    if (this.limbs.length === 0) return "0";

    let str = this.limbs[0].toString();
    for (let i = 1; i < this.limbs.length; i++) {
        str += this.limbs[i].toString().padStart(BASE_LOG10, '0');
    }
    return str;
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
    if (this.isZero()) {
        if (typeof this._roundedDp === 'number' && this._roundedDp > 0) {
            return (this.sign === -1 && !(this.limbs.length === 1 && this.limbs[0] === 0) ? "-" : "") + '0.' + '0'.repeat(this._roundedDp);
        }
        return "0";
    }

    // let coefficientString = this.limbs.join(''); // Original problematic line
    let coefficientString;
    if (this.isZero()) {
        coefficientString = "0";
    } else {
        coefficientString = this.limbs[0].toString();
        for (let i = 1; i < this.limbs.length; i++) {
            coefficientString += this.limbs[i].toString().padStart(BASE_LOG10, '0');
        }
    }

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
      const resultNumCPU = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
      resultNumCPU.limbs = finalResultLimbs;
      resultNumCPU.sign = 1;
      if (resultNumCPU.isZero()) { resultNumCPU.exponent = 0; }
      return resultNumCPU;
  }

  add(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive."); }
    let gl;
    if (!this.forceCPU && this.canvas && typeof webglUtilsModule !== 'undefined' && (gl = webglUtilsModule.initWebGL(this.canvas))) {
      const texWidth = Math.max(this.limbs.length, otherBigInt.limbs.length);
      webglUtilsModule.createDataTexture(gl, this.limbs, texWidth, 1);
      webglUtilsModule.createDataTexture(gl, otherBigInt.limbs, texWidth, 1);
      webglUtilsModule.createDataTexture(gl, null, texWidth, 1, true);
      webglUtilsModule.readDataFromTexture(gl, null, texWidth, 1, true);
    }
    if (this.isZero()) {
      const result = new BigIntPrimitive(otherBigInt, this.canvas);
      result.forceCPU = this.forceCPU || otherBigInt.forceCPU;
      return result;
    }
    if (otherBigInt.isZero()) {
      const result = new BigIntPrimitive(this, this.canvas);
      result.forceCPU = this.forceCPU || otherBigInt.forceCPU;
      return result;
    }
    const result = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU || otherBigInt.forceCPU });
    if (this.sign === otherBigInt.sign) {
      const commonExponent = Math.min(this.exponent, otherBigInt.exponent);
      const tempThis = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
      tempThis.limbs = [...this.limbs];
      for (let i = 0; i < (this.exponent - commonExponent); i++) { tempThis.limbs.push(0); }
      tempThis.sign = 1;
      const tempOther = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
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

    let gl;
    if (!this.forceCPU && !otherBigInt.forceCPU && this.canvas && typeof webglUtilsModule !== 'undefined' && (gl = webglUtilsModule.initWebGL(this.canvas))) {
      // WebGL Path for Subtraction
      // Ensure alignment and handle signs appropriately before shader.
      // The shader likely expects positive numbers and a separate sign uniform, or handles magnitude.
      // For simplicity, let's assume the shader handles positive numbers and we manage sign outside.

      const comparison = this.compareMagnitude(otherBigInt);
      let minuend, subtrahend;
      let resultSign = this.sign;

      if (comparison === 0) {
        return new BigIntPrimitive("0", this.canvas, { forceCPU: true }); // Result is zero
      } else if (comparison > 0) {
        minuend = this.abs();
        subtrahend = otherBigInt.abs();
        resultSign = this.sign; // or 1 if this.sign === otherBigInt.sign
      } else { // comparison < 0
        minuend = otherBigInt.abs();
        subtrahend = this.abs();
        resultSign = -this.sign; // or -1 if this.sign === otherBigInt.sign
      }
      // If signs were originally different, this.add(other.negate()) handles it,
      // so here signs are the same. If this.sign is -1, then resultSign should be -resultSign.
      if (this.sign === -1 && otherBigInt.sign === -1) {
          // e.g. -A - (-B) = -A + B = B - A.
          // If |A| > |B|, then -(A-B), so resultSign needs to be flipped from the magnitude comparison.
          // If |B| > |A|, then B-A, resultSign is correct from magnitude comparison.
          // The resultSign determined by magnitude comparison above is for (Mag(larger) - Mag(smaller)).
          // If original signs were both negative, this resultSign needs to be flipped.
          resultSign *= -1;
      }


      const texWidth = Math.max(minuend.limbs.length, subtrahend.limbs.length) + 1; // +1 for potential borrow propagation

      const minuendLimbsLSB = [...minuend.limbs].reverse();
      const subtrahendLimbsLSB = [...subtrahend.limbs].reverse();

      const vertShader = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, subtractVertexShaderSrc);
      const fragShader = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, subtractFragmentShaderSrc);
      const program = webglUtilsModule.createProgram(gl, vertShader, fragShader);

      // DEBUGGING LOGS
      console.log("[WebGL Subtract] Minuend LSB Limbs:", JSON.stringify(minuendLimbsLSB));
      console.log("[WebGL Subtract] Subtrahend LSB Limbs:", JSON.stringify(subtrahendLimbsLSB));
      console.log("[WebGL Subtract] texWidth:", texWidth);

      const u_num1TextureLoc = gl.getUniformLocation(program, "u_num1Texture");
      const u_num2TextureLoc = gl.getUniformLocation(program, "u_num2Texture");
      const u_borrowTextureLoc = gl.getUniformLocation(program, "u_borrowTexture");
      console.log(`[WebGL Subtract Setup] Uniform Locations: u_num1TextureLoc=${u_num1TextureLoc}, u_num2TextureLoc=${u_num2TextureLoc}, u_borrowTextureLoc=${u_borrowTextureLoc}`);

      // Pad input arrays to texWidth
      const paddedMinuendData = new Float32Array(texWidth);
      minuendLimbsLSB.forEach((val, idx) => paddedMinuendData[idx] = val);
      // Any remaining elements in paddedMinuendData will be 0.0 due to Float32Array initialization.

      const paddedSubtrahendData = new Float32Array(texWidth);
      subtrahendLimbsLSB.forEach((val, idx) => paddedSubtrahendData[idx] = val);

      console.log("[WebGL Subtract] Padded Minuend Data:", JSON.stringify(Array.from(paddedMinuendData)));
      console.log("[WebGL Subtract] Padded Subtrahend Data:", JSON.stringify(Array.from(paddedSubtrahendData)));

      if (!program) {
        console.error("Failed to create shader program for subtraction. Falling back to CPU.");
        console.log("[WebGL Subtract] Triggering fallback due to !program"); // DEBUG
        // Fallback to CPU - need to re-implement the CPU path call here
        // This is a simplified fallback for now. A more robust solution would re-execute the CPU path logic.
        // The actual CPU path involves aligning numbers based on commonExponent first.
        // Let's try to mimic parts of the CPU path's setup:
        const cpuMinuend = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
        cpuMinuend.limbs = minuend.limbs; // minuend is already abs()
        const cpuSubtrahend = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
        cpuSubtrahend.limbs = subtrahend.limbs; // subtrahend is already abs()

        const cpuResult = cpuMinuend._core_subtract(cpuSubtrahend);
        cpuResult.sign = resultSign;
        // Exponent handling for fallback would also be complex, mimicking commonExponent logic
        // For now, this fallback is still very basic.
        return cpuResult;
      }

      const textureA = webglUtilsModule.createDataTexture(gl, paddedMinuendData, texWidth, 1, false); // false for single component
      const textureB = webglUtilsModule.createDataTexture(gl, paddedSubtrahendData, texWidth, 1, false); // false for single component
      const outputTexture = webglUtilsModule.createDataTexture(gl, null, texWidth, 1, false); // false for single component initially, will be read as such

      // Create a framebuffer
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);

      // Check if framebuffer is complete
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("Framebuffer incomplete. Falling back to CPU.");
        console.log("[WebGL Subtract] Triggering fallback due to framebuffer incomplete"); // DEBUG
        gl.deleteProgram(program); gl.deleteShader(vertShader); gl.deleteShader(fragShader);
        gl.deleteTexture(textureA); gl.deleteTexture(textureB); gl.deleteTexture(outputTexture);
        gl.deleteFramebuffer(fbo);
        // Simplified fallback (same as above for now)
        const cpuMinuendFb = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
        cpuMinuendFb.limbs = minuend.limbs;
        const cpuSubtrahendFb = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
        cpuSubtrahendFb.limbs = subtrahend.limbs;

        const cpuResultFallback = cpuMinuendFb._core_subtract(cpuSubtrahendFb);
        cpuResultFallback.sign = resultSign;
        return cpuResultFallback;
      }

      gl.viewport(0, 0, texWidth, 1);
      gl.useProgram(program);

      // Set up uniforms
      const baseUniformLocation = gl.getUniformLocation(program, "BASE");
      gl.uniform1f(baseUniformLocation, BASE);
      const texWidthUniformLocation = gl.getUniformLocation(program, "TEX_WIDTH");
      gl.uniform1f(texWidthUniformLocation, texWidth);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textureA);
      gl.uniform1i(u_num1TextureLoc, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, textureB);
      gl.uniform1i(u_num2TextureLoc, 1);

      // Create and bind a zero-filled texture for u_borrowTexture for the first pass
      gl.activeTexture(gl.TEXTURE2); // Activate texture unit 2 BEFORE creating zeroBorrowTexture
      const zeroBorrowData = new Float32Array(texWidth).fill(0.0);
      const zeroBorrowTexture = webglUtilsModule.createDataTexture(gl, zeroBorrowData, texWidth, 1, false); // This will use active unit 2
      // createDataTexture leaves the texture bound to the active unit, then unbinds it.
      // We need to ensure it's bound for the uniform sampler.
      gl.bindTexture(gl.TEXTURE_2D, zeroBorrowTexture); // Bind it explicitly to unit 2 again
      gl.uniform1i(u_borrowTextureLoc, 2);

      // Conditional log for "123" - "34"
      if (minuend.limbs.length === 1 && minuend.limbs[0] === 123 &&
          subtrahend.limbs.length === 1 && subtrahend.limbs[0] === 34) {
          console.log('[WebGL Subtract Setup Debug Case 123-34] minuendTexture (textureA):', textureA);
          console.log('[WebGL Subtract Setup Debug Case 123-34] subtrahendTexture (textureB):', textureB);
          console.log(`[WebGL Subtract Setup Debug Case 123-34] Uniform u_num1TextureLoc (${u_num1TextureLoc}) set to 0`);
          console.log(`[WebGL Subtract Setup Debug Case 123-34] Uniform u_num2TextureLoc (${u_num2TextureLoc}) set to 1`);
      }

      // Standard GPGPU: set up a simple quad to draw on
      const positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1,
      ]), gl.STATIC_DRAW);
      const positionAttributeLocation = gl.getAttribLocation(program, "a_position");
      gl.enableVertexAttribArray(positionAttributeLocation);
      gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

      // Draw
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Read data (note: readDataFromTexture expects framebuffer to be bound)
      // Modify to get full RGBA to check debug output from shader
      const rawOutputDataRGBA = webglUtilsModule.readDataFromTexture(gl, fbo, texWidth, 1, false); // false to get full RGBA
      console.log("[WebGL Subtract] Raw RGBA Output Data from Texture:", JSON.stringify(Array.from(rawOutputDataRGBA || []))); // DEBUG

      // Cleanup
      gl.deleteProgram(program);
      gl.deleteShader(vertShader);
      gl.deleteShader(fragShader);
      gl.deleteTexture(textureA);
      gl.deleteTexture(textureB);
      gl.deleteTexture(outputTexture);
      gl.deleteTexture(zeroBorrowTexture); // Clean up the borrow texture
      gl.deleteFramebuffer(fbo);
      gl.deleteBuffer(positionBuffer);
      let resultLimbsReversed = [];
      if (rawOutputDataRGBA) {
        for (let i = 0; i < texWidth; i++) {
          const r = rawOutputDataRGBA[i*4 + 0];
          const g = rawOutputDataRGBA[i*4 + 1];
          const b = rawOutputDataRGBA[i*4 + 2];
          // const a = rawOutputDataRGBA[i*4 + 3];
          console.log(`[WebGL Subtract] Shader Output Texel ${i}: limb1_val(R)=${r}, limb2_val(G)=${g}, borrowIn_val(B)=${b}`);
          // For now, push R to keep structure similar, though this isn't the final subtraction result
          resultLimbsReversed.push(r);
        }
      } else {
        console.error("rawOutputDataRGBA from WebGL read was null. Subtraction may be incorrect.");
        // Potentially push a default error indicator or handle as CPU fallback earlier
        // For now, this will likely lead to an empty limbs array or NaNs down the line if not caught.
      }


      // Remove leading zeros from the result (still reversed)
      while (resultLimbsReversed.length > 1 && resultLimbsReversed[resultLimbsReversed.length - 1] === 0) {
        resultLimbsReversed.pop();
      }
      if (resultLimbsReversed.length === 0) resultLimbsReversed = [0]; // Should not happen if handled correctly

      const finalResultLimbs = resultLimbsReversed.reverse();
      const resultNumWebGL = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
      resultNumWebGL.limbs = finalResultLimbs;
      resultNumWebGL.sign = (resultNumWebGL.isZero()) ? 1 : resultSign;
      // Exponent handling for WebGL path needs careful consideration based on how alignment was done.
      // For now, assuming _core_subtract's exponent logic or similar would be needed if not handled by inputs.
      // The commonExponent logic from CPU path might be reusable.
      // Let's assume for now the shader inputs are pre-aligned and exponent is handled post-shader.

      // Placeholder for exponent logic - this is complex and needs to match CPU path's alignment
      // For now, let's assume the commonExponent logic from the CPU path should be applied.
      // This part needs to be robust.
      const commonExponent = Math.min(this.exponent, otherBigInt.exponent);
      resultNumWebGL.exponent = commonExponent;
       if (!resultNumWebGL.isZero()) {
            while (resultNumWebGL.limbs.length > 1 && resultNumWebGL.limbs[resultNumWebGL.limbs.length - 1] === 0) {
                resultNumWebGL.limbs.pop();
                resultNumWebGL.exponent++;
            }
      }


      return resultNumWebGL;
    }

    // CPU Path (original logic)
    const result = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU || otherBigInt.forceCPU });
    if (this.sign !== otherBigInt.sign) {
      const termToAdd = new BigIntPrimitive(otherBigInt, this.canvas, { forceCPU: otherBigInt.forceCPU });
      termToAdd.sign = -termToAdd.sign; // effectively otherBigInt.negate()
      return this.add(termToAdd); // This .add() could use WebGL if 'termToAdd' also has a canvas
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
    // CPU Path continued
    const tempMinuend = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    const tempSubtrahend = new BigIntPrimitive("0", this.canvas, { forceCPU: true });

    if (comparison > 0) {
      tempMinuend.limbs = thisLimbsAligned;
      tempSubtrahend.limbs = otherLimbsAligned;
      result.sign = this.sign;
    } else { // comparison < 0
      tempMinuend.limbs = otherLimbsAligned;
      tempSubtrahend.limbs = thisLimbsAligned;
      result.sign = -this.sign; // Sign of the result is opposite of this.sign
    }
    // If original signs were both negative, the result.sign determined here needs to be flipped.
    // e.g. -A - (-B) = B - A.
    // If |A|>|B|, then comparison > 0. tempMinuend=|A|, tempSubtrahend=|B|. result.sign = this.sign (-1).
    //   coreResult = |A|-|B|. Final result should be -( |A|-|B| ), so result.sign is correct.
    // If |B|>|A|, then comparison < 0. tempMinuend=|B|, tempSubtrahend=|A|. result.sign = -this.sign (1).
    //   coreResult = |B|-|A|. Final result should be ( |B|-|A| ), so result.sign is correct.
    // Oh, the logic for this.sign === -1 && otherBigInt.sign === -1 seems to be okay here too.
    // Let's trace:
    // (-5) - (-2) = -3. this.sign=-1. other.sign=-1. commonExp=0.
    // thisLA=[5], otherLA=[2]. comparison=1.
    // tempMinuend=[5], tempSub=[2]. result.sign = this.sign = -1.
    // coreResult = [3]. result.limbs=[3]. result.exponent=0. result.sign = -1. Correct.
    //
    // (-2) - (-5) = 3. this.sign=-1. other.sign=-1. commonExp=0.
    // thisLA=[2], otherLA=[5]. comparison=-1.
    // tempMinuend=[5], tempSub=[2]. result.sign = -this.sign = 1.
    // coreResult = [3]. result.limbs=[3]. result.exponent=0. result.sign = 1. Correct.

    const coreResult = tempMinuend._core_subtract(tempSubtrahend);
    result.limbs = coreResult.limbs;
    result.exponent = commonExponent;
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
    if (totalResult.isZero()) {
        totalResult.sign = 1; totalResult.exponent = 0;
    } else {
      while (totalResult.limbs.length > 1 && totalResult.limbs[totalResult.limbs.length - 1] === 0) {
        totalResult.limbs.pop();
      }
      if (totalResult.limbs.length === 0) { totalResult.limbs = [0]; totalResult.exponent = 0;}
    }
    totalResult.sign = 1;
    return totalResult;
  }

  multiply(otherBigInt) {
    const self = this;
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive."); }
    if (self.isZero() || otherBigInt.isZero()) {
        return new BigIntPrimitive("0", self.canvas, { forceCPU: self.forceCPU || otherBigInt.forceCPU });
    }


    let absResult;
    let gl;

    if (!self.forceCPU && !otherBigInt.forceCPU && self.canvas && typeof webglUtilsModule !== 'undefined' && (gl = webglUtilsModule.initWebGL(self.canvas))) {
      // WebGL Path for Multiplication
      const tempNum1Abs = self.abs();
      const tempNum2Abs = otherBigInt.abs();
      console.warn("WebGL path for multiply entered, but not fully implemented. Falling back to CPU multiply.");
      absResult = self._core_multiply(tempNum1Abs, tempNum2Abs); // Still CPU, but uses abs values
      absResult.exponent = self.exponent + otherBigInt.exponent;
    } else {
       // CPU Path
       // Original CPU path used potentially non-absolute numbers with exponents for _core_multiply or Karatsuba.
       // Let's ensure we are taking absolute values if _core_multiply expects them,
       // or that _core_multiply can handle signs (it's supposed to return an absolute value).
       // The _core_multiply is defined as `_core_multiply(num1, num2)` and num1, num2 are expected positive.
       // The constructor `new BigIntPrimitive(self.limbs.join('') + '0'.repeat(self.exponent))` creates positive numbers.
       const tempNum1 = new BigIntPrimitive(self.limbs.join('') + '0'.repeat(self.exponent), self.canvas, {forceCPU: true});
       const tempNum2 = new BigIntPrimitive(otherBigInt.limbs.join('') + '0'.repeat(otherBigInt.exponent), otherBigInt.canvas, {forceCPU: true});

       if (tempNum1.limbs.length < KARATSUBA_THRESHOLD || tempNum2.limbs.length < KARATSUBA_THRESHOLD) {
           absResult = self._core_multiply(tempNum1, tempNum2);
       } else {
           const n = Math.max(tempNum1.limbs.length, tempNum2.limbs.length);
           const m = Math.floor(n / 2);
           if (m === 0) {
               absResult = self._core_multiply(tempNum1, tempNum2);
           } else {
               const { low: b, high: a } = tempNum1._splitAt(m); // These need to be positive for Karatsuba
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
               absResult = tempSum.add(p1); // All these are CPU ops
           }
       }
       // Exponent adjustment for CPU path if inputs had exponents
       absResult.exponent = self.exponent + otherBigInt.exponent;
    }

    // Common post-processing
    // Normalization of limbs and exponent (should happen before sign for zero check)
    if (!absResult.isZero()) {
        while (absResult.limbs.length > 1 && absResult.limbs[absResult.limbs.length - 1] === 0) {
            absResult.limbs.pop();
            absResult.exponent++;
        }
    }

    absResult.sign = (self.sign === otherBigInt.sign) ? 1 : -1;
    if (absResult.isZero()) { // Final check for zero to normalize sign and exponent
        absResult.sign = 1;
        absResult.exponent = 0;
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

  _decimalDivide(positiveDividendArg, positiveDivisorArg, numDecimalPlaces) {
    console.log(`_decimalDivide ENTRY: positiveDividendArg=${positiveDividendArg.toString()}, positiveDivisorArg=${positiveDivisorArg.toString()}, numDecimalPlaces=${numDecimalPlaces}`);
    const isDebugTarget = positiveDividendArg.toString() === "10" && positiveDivisorArg.toString() === "4";
    // Only log extensively if it's the specific 10/4 case we're interested in.
    // The numDecimalPlaces for this case should be 6 if DP=1 in the test.

    if (isDebugTarget) {
      console.log(`DEBUG_10/4: _decimalDivide invoked. positiveDividendArg=${positiveDividendArg.toString()}, positiveDivisorArg=${positiveDivisorArg.toString()}, numDecimalPlaces=${numDecimalPlaces}`);
    }

    const dividend = new BigIntPrimitive(positiveDividendArg, this.canvas); // Re-instantiate to ensure clean state for this specific call
    const divisor = new BigIntPrimitive(positiveDivisorArg, this.canvas);

    if (divisor.isZero()) {
      throw new Error("Division by zero in _decimalDivide.");
    }
    if (dividend.isZero()) {
      return new BigIntPrimitive("0", this.canvas);
    }
     if (dividend.isNegative() || divisor.isNegative()) { // Should not happen if abs() was called before
      throw new Error("_decimalDivide expects positive inputs after re-instantiation.");
    }


    let d_val_str = dividend._getCoefficientString();
    let d_exp = dividend.exponent;
    let v_val_str = divisor._getCoefficientString();
    let v_exp = divisor.exponent;

    let dividendStrForScaling = d_val_str;
    const actualNumDecimalPlaces = (typeof numDecimalPlaces === 'number' && numDecimalPlaces >= 0) ? numDecimalPlaces : 0;
    dividendStrForScaling += '0'.repeat(actualNumDecimalPlaces);

    const biDividend = BigInt(dividendStrForScaling);
    const biDivisor = BigInt(v_val_str);

    console.log(`_decimalDivide PRE-BIGINT-DIV: d_val_str='${d_val_str}', d_exp=${d_exp}, v_val_str='${v_val_str}', v_exp=${v_exp}`);
    console.log(`_decimalDivide PRE-BIGINT-DIV: actualNumDecimalPlaces=${actualNumDecimalPlaces}, dividendStrForScaling='${dividendStrForScaling}'`);
    if (typeof biDividend !== 'undefined' && typeof biDivisor !== 'undefined') {
        console.log(`_decimalDivide PRE-BIGINT-DIV: biDividend=${biDividend.toString()}n, biDivisor=${biDivisor.toString()}n`);
    } else {
        console.log(`_decimalDivide PRE-BIGINT-DIV: biDividend or biDivisor is undefined. biDividend='${biDividend}', biDivisor='${biDivisor}'`);
    }

    if (isDebugTarget) {
      console.log(`DEBUG_10/4: d_val_str=${d_val_str}, d_exp_original=${d_exp}`);
      console.log(`DEBUG_10/4: v_val_str=${v_val_str}, v_exp_original=${v_exp}`);
      console.log(`DEBUG_10/4: scaled_d_val_str=${dividendStrForScaling}, actualNumDecimalPlaces=${actualNumDecimalPlaces}`);
      console.log(`DEBUG_10/4: biDividend=${biDividend.toString()}n, biDivisor=${biDivisor.toString()}n`);
    }

    if (biDivisor === 0n) {
        throw new Error("Division by zero after BigInt conversion for divisor.");
    }
    const biResult = biDividend / biDivisor;
    const q_int_str = biResult.toString();

    if (isDebugTarget) {
      console.log(`DEBUG_10/4: q_int_str=${q_int_str}`);
    }

    const tempResultNum = new BigIntPrimitive(q_int_str, this.canvas, { forceCPU: true });
    console.log(`_decimalDivide INTERNAL: tempResultNum POST-CONSTRUCTOR for q_int_str='${q_int_str}': limbs=${JSON.stringify(tempResultNum.limbs)}, exponent=${tempResultNum.exponent}, toString=${tempResultNum.toString()}`);
    if (isDebugTarget) {
        console.log(`DEBUG_10/4: tempResultNum from q_int_str="${q_int_str}": limbs=${JSON.stringify(tempResultNum.limbs)}, exponent=${tempResultNum.exponent}, sign=${tempResultNum.sign}, isZero=${tempResultNum.isZero()}`);
    }

    // Check for the specific problematic case
    if (isDebugTarget && q_int_str === "2500000" && tempResultNum.isZero() && numDecimalPlaces === 6) {
      throw new Error(
        `_decimalDivide Initial Check (10/4 specific): q_int_str was "${q_int_str}", but tempResultNum became zero. ` +
        `tempResultNum state: limbs=${JSON.stringify(tempResultNum.limbs)}, exponent=${tempResultNum.exponent}, sign=${tempResultNum.sign}.`
      );
    }

    const resultNum = tempResultNum;
    const exponent_from_parsing_resultStr = resultNum.exponent;
    const final_exponent_for_resultNum = exponent_from_parsing_resultStr + d_exp - v_exp - actualNumDecimalPlaces;
    resultNum.exponent = final_exponent_for_resultNum;

    if (isDebugTarget) {
        console.log(`DEBUG_10/4: Calculated final_exponent_for_resultNum: ${final_exponent_for_resultNum}. resultNum state: limbs=${JSON.stringify(resultNum.limbs)}, exponent=${resultNum.exponent}, sign=${resultNum.sign}, isZero=${resultNum.isZero()}`);
    }

    if (isDebugTarget) {
        console.log(`DEBUG_10/4: BEFORE isZero() check. limbs=${JSON.stringify(resultNum.limbs)}, exponent=${resultNum.exponent}, isZero=${resultNum.isZero()}`);
    }

    console.log(`_decimalDivide INTERNAL: resultNum PRE-ISZERO for q_int_str='${q_int_str}': limbs=${JSON.stringify(resultNum.limbs)}, exponent=${resultNum.exponent}, toString=${resultNum.toString()}`);
    if (resultNum.isZero()) {
        if (isDebugTarget) console.log(`DEBUG_10/4: INSIDE isZero() true block. limbs=${JSON.stringify(resultNum.limbs)}. Setting exponent to 0.`);
        resultNum.exponent = 0;
    } else {
        if (isDebugTarget) console.log(`DEBUG_10/4: INSIDE isZero() false block. limbs=${JSON.stringify(resultNum.limbs)}.`);
    }

    resultNum.sign = 1; // _decimalDivide is for absolute values

    if (isDebugTarget && numDecimalPlaces === 6 && resultNum.isZero()) {
      const initialTempResultNumState = new BigIntPrimitive(q_int_str, this.canvas, { forceCPU: true }); // Re-create for logging
      throw new Error(
        `_decimalDivide Final Check (10/4 specific): For 10/4 with internalPrecision=${numDecimalPlaces}, resultNum is zero before return. ` +
        `q_int_str="${q_int_str}". ` +
        `biDividend=${biDividend.toString()}n, biDivisor=${biDivisor.toString()}n, biResult=${biResult.toString()}n. ` +
        `Initial tempResultNum (from q_int_str): limbs=${JSON.stringify(initialTempResultNumState.limbs)}, exponent=${initialTempResultNumState.exponent}, sign=${initialTempResultNumState.sign}. ` +
        `Calculated final_exponent_for_resultNum: ${final_exponent_for_resultNum}. ` +
        `resultNum state before this throw: limbs=${JSON.stringify(resultNum.limbs)}, exponent=${resultNum.exponent}, sign=${resultNum.sign}.`
      );
    }

    if (isDebugTarget) {
        console.log(`DEBUG_10/4: Returning from _decimalDivide. resultNum: limbs=${JSON.stringify(resultNum.limbs)}, exponent=${resultNum.exponent}, sign=${resultNum.sign}, toString()="${resultNum.toString()}"`);
        if (q_int_str === "2500000" && resultNum.isZero()) {
            throw new Error("DEBUG_10/4: _decimalDivide is about to return ZERO for 2.5 case!");
        }
    }
    // return resultNum;
    // Let's try returning a brand new object from the final state to rule out aliasing issues.
    const finalReturnObject = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    finalReturnObject.limbs = [...resultNum.limbs];
    finalReturnObject.exponent = resultNum.exponent;
    finalReturnObject.sign = resultNum.sign;
    if (finalReturnObject.isZero()) { // re-normalize if it became zero through this process
        finalReturnObject.exponent = 0;
        finalReturnObject.sign = 1;
    }
    return finalReturnObject;
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
    const currentDP = (typeof BigIntPrimitive.DP === 'number' && isFinite(BigIntPrimitive.DP)) ? BigIntPrimitive.DP : 20; // Default to 20 if DP is not a valid number
    const internalPrecision = currentDP + precisionBonus;

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
        else coeffStrFinal = intPart + "." + fracPart;
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

  sqrt() {
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

  // Insert this method into the BigIntPrimitive class
  prec(sd, rm) {
    if (typeof sd !== 'number' || !Number.isInteger(sd) || sd < 1 || sd > 1e6) {
      throw new Error('[big.js] Invalid precision');
    }

    const roundingMode = (rm === undefined ? BigIntPrimitive.RM : rm);
    if (typeof roundingMode !== 'number' || !Number.isInteger(roundingMode) || roundingMode < 0 || roundingMode > 3) {
      throw new Error('[big.js] Invalid rounding mode');
    }

    if (this.isZero()) {
      return new BigIntPrimitive('0', this.canvas, { forceCPU: this.forceCPU });
    }

    const absNum = this.abs();
    const fullCoeffStr = absNum._getCoefficientString(); // Renamed for clarity
    // const effectiveExponent = absNum.exponent; // Exponent for coeffStr based on internal limb structure - This will be replaced by scientificExponent logic

    // Get Scientific Exponent
    let currentScientificExponent = 0;
    if (!absNum.isZero()) { // Avoid calling toExponential on zero if it's not robust
        // Use a temporary BigInt to get its scientific exponent without altering BigIntPrimitive.PE/NE
        const tempPE = BigIntPrimitive.PE;
        const tempNE = BigIntPrimitive.NE;
        BigIntPrimitive.PE = 1e9; // Force scientific for exponent extraction
        BigIntPrimitive.NE = -1e9;
        const sciStr = absNum.toString(); // Use absNum's toString which should be normalized for this
        BigIntPrimitive.PE = tempPE;
        BigIntPrimitive.NE = tempNE;

        const eIndex = sciStr.indexOf('e');
        if (eIndex !== -1) {
            currentScientificExponent = parseInt(sciStr.substring(eIndex + 1));
        } else { // It's not in scientific, calculate from decimal point
            const dotIndex = sciStr.indexOf('.');
            if (dotIndex === -1) { // Integer
                currentScientificExponent = fullCoeffStr.length -1;
            } else { // Has a decimal
                 currentScientificExponent = dotIndex -1;
                 if (parseFloat(sciStr) < 1.0 && parseFloat(sciStr) > 0) { // Numbers like 0.xxxx
                    let firstNonZero = 0;
                    for(let i = dotIndex + 1; i < sciStr.length; i++) {
                        if(sciStr[i] !== '0') {
                            firstNonZero = i;
                            break;
                        }
                    }
                    currentScientificExponent = -(firstNonZero - dotIndex);
                 }
            }
        }
    }

    const coeffLen = fullCoeffStr.length;

    if (sd >= coeffLen) {
      return new BigIntPrimitive(this); // No change to significant digits
    }

    let digitsToKeepStr = fullCoeffStr.substring(0, sd);
    const roundDigitChar = fullCoeffStr[sd];
    let trailingNonZero = false;
    for (let i = sd + 1; i < coeffLen; i++) {
      if (fullCoeffStr[i] !== '0') {
        trailingNonZero = true;
        break;
      }
    }
    const roundDigitVal = parseInt(roundDigitChar, 10);

    let carry = 0;
    const isExactlyHalf = (roundDigitVal === 5 && !trailingNonZero);

    switch (roundingMode) {
      case BigIntPrimitive.roundDown: // 0
        // carry remains 0
        break;
      case BigIntPrimitive.roundUp: // 3
        if (roundDigitVal > 0 || trailingNonZero) {
          carry = 1;
        }
        break;
      case BigIntPrimitive.roundHalfUp: // 1
        if (roundDigitVal >= 5) {
          carry = 1;
        }
        break;
      case BigIntPrimitive.roundHalfEven: // 2
        if (roundDigitVal > 5) {
          carry = 1;
        } else if (isExactlyHalf) {
          if (sd > 0 && parseInt(digitsToKeepStr[sd - 1], 10) % 2 !== 0) {
            carry = 1;
          }
        }
        break;
    }

    let finalLeadingCoeffPart = digitsToKeepStr;
    if (carry === 1) {
      let newCoeffChars = digitsToKeepStr.split('');
      for (let i = sd - 1; i >= 0; i--) {
        let digit = parseInt(newCoeffChars[i], 10) + carry;
        newCoeffChars[i] = (digit % 10).toString();
        carry = Math.floor(digit / 10); // carry for next digit to the left
        if (carry === 0) break;
      }
      if (carry > 0) { // If carry propagated all the way to the left
        finalLeadingCoeffPart = carry.toString() + newCoeffChars.join('');
      } else {
        finalLeadingCoeffPart = newCoeffChars.join('');
      }
    }

    // Adjust scientificExponent if finalLeadingCoeffPart length changes due to carry
    // (e.g., "99".prec(1) with roundHalfUp becomes "10", length increases, exponent increases)
    if (finalLeadingCoeffPart.length > sd) {
      currentScientificExponent++;
    }

    if (new BigIntPrimitive(finalLeadingCoeffPart).isZero()) { // Check if it rounded to "0"
        return new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
    }

    let resultConstructorString = (this.sign === -1 ? "-" : "");
    resultConstructorString += finalLeadingCoeffPart[0]; // First digit
    if (finalLeadingCoeffPart.length > 1) {
        resultConstructorString += "." + finalLeadingCoeffPart.substring(1); // Decimal and rest
    }
    resultConstructorString += "e" + currentScientificExponent.toString(); // Apply scientific exponent

    return new BigIntPrimitive(resultConstructorString, this.canvas, { forceCPU: this.forceCPU });
  }

  toPrecision(sd, rm) {
    if (sd === undefined) {
      return this.toString();
    }

    if (typeof sd !== 'number' || !Number.isInteger(sd) || sd < 1 || sd > 1e6) {
      throw new Error('[big.js] Invalid precision');
    }

    // 'rm' will be validated by this.prec(sd, rm)

    const roundedNum = this.prec(sd, rm);

    if (roundedNum.isZero()) {
      let zeroStr = "0";
      if (sd > 1) {
        zeroStr += "." + "0".repeat(sd - 1);
      }
      return zeroStr;
    }

    // toExponential's dp is the number of digits to appear after the decimal point.
    // For 'sd' significant digits, toExponential needs sd-1 decimal places.
    return roundedNum.toExponential(sd - 1, rm);
  }
}

export { BigIntPrimitive };
