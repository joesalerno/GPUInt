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
        throw new TypeError("Invalid BigInt string format: coefficient contains non-digits after sign/decimal/exponent processing.");
    }

    // Remove leading zeros from the coefficient string, unless it's just "0"
    if (coefficientStr.length > 1 && coefficientStr.startsWith('0')) {
        coefficientStr = coefficientStr.replace(/^0+/, '');
        if (coefficientStr === "") coefficientStr = "0"; // was all zeros
    }

    if (coefficientStr === "0") {
        this.limbs = [0];
        // this.exponent is already set from decimal/sci notation.
        // If it's "0" or "0.0" etc., exponent should be 0.
        // If it was "0e5", exponent is 5. Let's normalize to 0 for true zero.
        if (this.exponent !== 0) { // Check if it was like "0.000eX"
            let allZeros = true;
            for(let i = 0; i < mantissaStr.length; i++) {
                if (mantissaStr[i] !== '0' && mantissaStr[i] !== '.') {
                    allZeros = false;
                    break;
                }
            }
            if (allZeros) this.exponent = 0;
        }
        // sign is already determined. For "0", spec usually wants sign=1 unless it was "-0"
        // For "-0", this.sign is -1. We'll keep it for now, toString can normalize if needed.
        return;
    }

    let tempLimbs = [];
    let currentPos = coefficientStr.length;
    while (currentPos > 0) {
        const start = Math.max(0, currentPos - BASE_LOG10);
        tempLimbs.unshift(parseInt(coefficientStr.substring(start, currentPos), 10));
        currentPos = start;
    }
    this.limbs = tempLimbs;

    // Exponent adjustment due to limb creation is implicitly handled by how coefficientStr was formed.
    // Example: "123.45", BASE_LOG10=4. coefficientStr="12345", exponent=-2.
    // Limbs: [1, 2345], exponent should become -2 * BASE_LOG10 if we think of exponent per limb.
    // Or, more simply, the existing this.exponent refers to single digits.
    // If we parse "12345" into [1, 2345], the exponent needs to be adjusted.
    // Original thinking: this.exponent is number of zeros to add/remove.
    // If "123.45" -> coeff "12345", exp = -2 (meaning last 2 digits are fractional)
    // Limbs [1, 2345]. The "2345" limb contains two fractional digits.
    // The exponent should refer to the power of BASE for the last limb.
    // Number of digits in fractional part of last limb: (original_coeff_len + this.exponent) % BASE_LOG10
    // This is complex. Simpler: this.exponent is the power of 10.
    // Let's adjust it to be power of BASE for the RSL (Rightmost Significant Limb)
    // If "123.45" (coeff "12345", exp = -2), limbs [1, 2345].
    // It means 1 * BASE^1 + 2345 * BASE^0, and then the whole thing * 10^exp.
    // OR, it's 12345 * 10^-2.
    // If limbs are [L_n, ..., L_1, L_0], it's (L_n*BASE^n + ... + L_0*BASE^0) * 10^(this.exponent)
    // This interpretation of this.exponent (power of 10 multiplier for the entire number represented by limbs in some base) seems most consistent.
    // The issue is that the old code (BASE=10) had `this.exponent++` when removing trailing zero limbs.
    // That implies exponent was per-limb.
    // If "12300", limbs [1,2,3,0,0], exp 0. Pop "0", exp becomes 1. Pop "0", exp becomes 2. Limbs [1,2,3], exp 2. (123 * 10^2)
    // New: "123450000", BASE_LOG10=4. Coeff "123450000", exp=0. Limbs [1,2345,0].
    // We need to remove trailing zero limbs and adjust exponent.
    // Exponent should represent the power of BASE for the last limb.
    // "123450000" -> limbs [1,2345,0]. If we pop [0], exp becomes 1*BASE_LOG10.
    // So, current this.exponent is power of 10 for the whole number.
    // Let's keep it that way. toString will handle conversion.

    // Normalization: remove leading zero limbs if limbs.length > 1
    while (this.limbs.length > 1 && this.limbs[0] === 0) {
        this.limbs.shift();
        // Exponent doesn't change here as it's tied to the decimal point's original position
    }

    // Final check for zero after parsing (e.g. "0.00000")
    if (this.limbs.length === 1 && this.limbs[0] === 0) {
      this.exponent = 0; // True zero has exponent 0
      // this.sign might be -1 if input was "-0" or "-0.0". Let toString handle this.
    }
  }

  static fromCoefficientString(valueStr, canvas, options = {}) {
    const instance = new BigIntPrimitive("0", canvas, options); // Use existing constructor for setup
    instance.sign = 1;
    instance.exponent = 0;

    if (valueStr === null || valueStr === undefined || typeof valueStr !== 'string' || valueStr.trim() === "") {
        instance.limbs = [0];
        return instance;
    }

    let coeffStr = valueStr.trim();
    if (!/^\d+$/.test(coeffStr)) {
        // Or handle error appropriately, though problem implies it's a pure coefficient string
        instance.limbs = [0];
        return instance;
    }

    if (coeffStr.length > 1 && coeffStr.startsWith('0')) {
        coeffStr = coeffStr.replace(/^0+/, '');
        if (coeffStr === "") coeffStr = "0";
    }

    if (coeffStr === "0") {
        instance.limbs = [0];
        return instance;
    }

    let tempLimbs = [];
    let currentPos = coeffStr.length;
    while (currentPos > 0) {
        const start = Math.max(0, currentPos - BASE_LOG10);
        tempLimbs.unshift(parseInt(coeffStr.substring(start, currentPos), 10));
        currentPos = start;
    }
    instance.limbs = tempLimbs;

    // Normalize leading zero limbs, though for a pure coefficient string this should be rare
    // unless "0000123" was passed.
    while (instance.limbs.length > 1 && instance.limbs[0] === 0) {
        instance.limbs.shift();
    }
    if (instance.limbs.length === 0 || (instance.limbs.length === 1 && instance.limbs[0] === 0)) {
       instance.limbs = [0]; // Ensure it's [0] for zero
    }
    return instance;
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

    let coefficientString;
    if (this.limbs.length === 0) { // Should not happen if properly normalized to [0] for zero
        coefficientString = "0";
    } else {
        coefficientString = String(this.limbs[0]);
        for (let i = 1; i < this.limbs.length; i++) {
            coefficientString += String(this.limbs[i]).padStart(BASE_LOG10, '0');
        }
    }

    let s;
    const e = this.exponent; // Exponent is power of 10
    const numDigits = coefficientString.length;
    const decimalPointActualPosition = numDigits + e; // Position of decimal point if number were written out fully

    // Determine if scientific notation should be used
    const useSciNotation = (typeof this._roundedDp !== 'number') && // Not formatting to fixed DP
                           (decimalPointActualPosition <= BigIntPrimitive.NE || // Too small
                            decimalPointActualPosition > BigIntPrimitive.PE);   // Too large

    if (useSciNotation) {
        // Scientific notation: c.fff...e+exp
        s = coefficientString[0]; // First digit
        if (numDigits > 1) {
            s += '.' + coefficientString.substring(1); // Append fractional part
        }
        // Remove trailing zeros from fractional part if any, but only if there is a decimal point
        if (s.includes('.')) {
           s = s.replace(/\.?0+$/, '');
        }
        const scientificExponent = decimalPointActualPosition - 1;
        s += 'e' + (scientificExponent >= 0 ? '+' : '') + scientificExponent;
    } else {
        // Fixed-point notation
        if (e < 0) { // Negative exponent means decimal point is to the left
            if (decimalPointActualPosition > 0) {
                // Decimal point is within the coefficient string
                s = coefficientString.substring(0, decimalPointActualPosition) + '.' + coefficientString.substring(decimalPointActualPosition);
            } else {
                // Decimal point is to the left of the coefficient string
                s = '0.' + '0'.repeat(-decimalPointActualPosition) + coefficientString;
            }
        } else { // Positive or zero exponent means decimal point is to the right
            s = coefficientString + '0'.repeat(e);
        }

        if (typeof this._roundedDp === 'number') {
            let [integerPart, fractionalPart = ''] = s.split('.');
            if (this._roundedDp > 0) {
                fractionalPart = fractionalPart.padEnd(this._roundedDp, '0');
                // If original number had more precision than _roundedDp, it should have been rounded before toString
                // Here, we just format to the specified DP.
                fractionalPart = fractionalPart.substring(0, this._roundedDp);
                s = integerPart + '.' + fractionalPart;
            } else { // dp is 0
                s = integerPart;
            }
        } else if (s.includes('.')) { // No specific DP, remove trailing zeros from fraction
             s = s.replace(/\.?0+$/, '');
        }
         if (s.startsWith('.')) s = '0' + s; // e.g. ".5" -> "0.5"
         if (s === "") s = "0"; // e.g. if input was "0.0" and _roundedDp=0
    }

    // Add sign if negative, but not for "0" unless it's "-0" from constructor and no _roundedDp
    if (this.sign === -1) {
        if (s === "0" || (s.startsWith("0.") && parseFloat(s) === 0)) {
             // For "0" or "0.00", only add sign if it was specifically "-0" and not formatted to specific DPs
             if (this.limbs.length === 1 && this.limbs[0] === 0 && typeof this._roundedDp !== 'number') {
                 return "-" + s;
             }
             // Otherwise, positive "0" or "0.00"
        } else {
            return "-" + s;
        }
    }
    return s;
  }

  toNumber() {
    const originalString = this.toString(); // Get string representation once
    const primitiveNumber = Number(originalString);

    if (this.constructor.strict) {
        if (primitiveNumber === Infinity || primitiveNumber === -Infinity) {
            throw new TypeError("[big.js] Imprecise conversion: non-finite number");
        }
        // For numbers that become 0 or lose precision.
        // big.js groups these under "precision loss" for the message, but expects TypeError.
        if ( (primitiveNumber === 0 && !this.isZero()) ) {
             throw new TypeError("[big.js] Imprecise conversion: precision loss");
        }

        if (isFinite(primitiveNumber) && !(primitiveNumber === 0 && this.isZero())) {
            let tempBig;
            const OldStrict = this.constructor.strict;
            try {
                this.constructor.strict = false;
                tempBig = new BigIntPrimitive(primitiveNumber, this.canvas, { forceCPU: this.forceCPU });
                this.constructor.strict = OldStrict;
            } catch (e) {
                // This catch implies that primitiveNumber itself was problematic for the constructor
                // even if finite (e.g. if constructor had its own stricter parsing for numbers).
                // big.js philosophy seems to consider this an imprecise conversion.
                this.constructor.strict = OldStrict;
                throw new TypeError("[big.js] Imprecise conversion (constructor failed for finite number): " + e.message);
            }
            if (tempBig.toString() !== originalString) {
                 throw new TypeError("[big.js] Imprecise conversion: precision loss");
            }
        } else if (Number.isNaN(primitiveNumber)) {
            throw new TypeError("[big.js] Imprecise conversion: NaN");
        }
        // If primitiveNumber is 0 AND this.isZero(), it's correctly represented, no error.
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
    let rL = []; // resultLimbs (reversed)
    let cs = 0;  // carry sum
    // Ensure limbs are processed from least significant to most significant
    let tL = [...this.limbs].reverse(); // this.limbs reversed
    let oL = [...positiveOtherBigInt.limbs].reverse(); // other.limbs reversed

    const maxL = Math.max(tL.length, oL.length);

    for (let i = 0; i < maxL; i++) {
      let s = (tL[i] || 0) + (oL[i] || 0) + cs;
      rL.push(s % BASE);
      cs = Math.floor(s / BASE);
    }
    if (cs) { // If carry remains
      rL.push(cs);
    }

    let fL = rL.reverse(); // finalLimbs (correct order)
    while (fL.length > 1 && fL[0] === 0) { fL.shift(); } // Remove leading zero limbs
    if (fL.length === 0) fL = [0]; // Should not happen if inputs are normalized, but safeguard

    const res = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    res.limbs = fL;
    // sign and exponent are handled by the calling 'add' or 'subtract' method
    return res;
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

      let thisCoeffStr = (this.limbs.length === 0) ? "0" :
                         this.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('');
      let otherCoeffStr = (otherBigInt.limbs.length === 0) ? "0" :
                          otherBigInt.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('');

      thisCoeffStr += '0'.repeat(Math.max(0, this.exponent - commonExponent));
      otherCoeffStr += '0'.repeat(Math.max(0, otherBigInt.exponent - commonExponent));

      // Directly create limb arrays for core_add from scaled coefficient strings
      const limbsA = [];
      let currentPosA = thisCoeffStr.length;
      while (currentPosA > 0) {
          const startA = Math.max(0, currentPosA - BASE_LOG10);
          limbsA.unshift(parseInt(thisCoeffStr.substring(startA, currentPosA), 10));
          currentPosA = startA;
      }
      if (limbsA.length === 0) limbsA.push(0);

      const limbsB = [];
      let currentPosB = otherCoeffStr.length;
      while (currentPosB > 0) {
          const startB = Math.max(0, currentPosB - BASE_LOG10);
          limbsB.unshift(parseInt(otherCoeffStr.substring(startB, currentPosB), 10));
          currentPosB = startB;
      }
      if (limbsB.length === 0) limbsB.push(0);

      const tempThisMinimal = { limbs: limbsA, isZero: function() { return this.limbs.length === 1 && this.limbs[0] === 0; } };
      const tempOtherMinimal = { limbs: limbsB, isZero: function() { return this.limbs.length === 1 && this.limbs[0] === 0; } };

      const sumMagnitudeResult = this._core_add.call(tempThisMinimal, tempOtherMinimal);
      result.limbs = sumMagnitudeResult.limbs;
      result.exponent = commonExponent; // Exponent of the result is the common (smaller) exponent
      result.sign = this.sign;
    } else {
      // If signs are different, addition is subtraction: a + (-b) = a - b
      return this.subtract(otherBigInt.negate());
    }
    if (result.isZero()) {
      result.sign = 1; result.exponent = 0;
    } else {
      // Correctly adjust exponent when removing trailing zero limbs with new BASE
      while (result.limbs.length > 1 && result.limbs[result.limbs.length - 1] === 0) {
        result.limbs.pop();
        result.exponent += BASE_LOG10; // Add BASE_LOG10 for each full zero limb removed
      }
    }
    return result;
  }

  _core_subtract(positiveOtherBigInt) {
      // Assumes this.limbs represents a number greater than or equal to positiveOtherBigInt.limbs
      // and both are positive.
      let rL = []; // resultLimbs (reversed)
      let b = 0;   // borrow
      let tL = [...this.limbs].reverse(); // this.limbs reversed
      let oL = [...positiveOtherBigInt.limbs].reverse(); // other.limbs reversed

      const maxL = Math.max(tL.length, oL.length); // Should be tL.length if precondition holds

      for (let i = 0; i < maxL; i++) {
        let d = (tL[i] || 0) - b - (oL[i] || 0);
        if (d < 0) {
          d += BASE;
          b = 1;
        } else {
          b = 0;
        }
        rL.push(d);
      }
      // Note: If there's a borrow left (b=1), it implies minuend was smaller, which violates precondition.
      // However, the calling subtract method should handle this by swapping and changing sign.

      let fL = rL.reverse(); // finalLimbs
      while (fL.length > 1 && fL[0] === 0) { fL.shift(); }
      if (fL.length === 0) fL = [0];

      const resultNumCPU = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
      resultNumCPU.limbs = fL; // Fix: Was finalResultLimbs
      resultNumCPU.sign = 1;
      if (resultNumCPU.isZero()) { resultNumCPU.sign = 1; resultNumCPU.exponent = 0;}
      return resultNumCPU;
  }

  subtract(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive."); }
    const result = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU || otherBigInt.forceCPU });
    if (this.sign !== otherBigInt.sign) {
      // a - (-b)  === a + b
      // -a - b    === -(a + b) (handled by negate below if signs differ after this.add)
      const termToAdd = new BigIntPrimitive(otherBigInt, this.canvas, { forceCPU: otherBigInt.forceCPU });
      termToAdd.sign = -termToAdd.sign; // effectively otherBigInt.negate()
      return this.add(termToAdd);
    }

    // Signs are the same. Determine which number has greater magnitude.
    // Convert to coefficient strings with common exponent for comparison and subtraction.
    const commonExponent = Math.min(this.exponent, otherBigInt.exponent);

    let thisCoeffStr = (this.limbs.length === 0) ? "0" :
                       this.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('');
    let otherCoeffStr = (otherBigInt.limbs.length === 0) ? "0" :
                        otherBigInt.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('');

    thisCoeffStr += '0'.repeat(Math.max(0, this.exponent - commonExponent));
    otherCoeffStr += '0'.repeat(Math.max(0, otherBigInt.exponent - commonExponent));

    // Directly create limb arrays for comparison and core_subtract
    const limbsThisScaled = [];
    let currentPosThis = thisCoeffStr.length;
    while (currentPosThis > 0) {
        const startThis = Math.max(0, currentPosThis - BASE_LOG10);
        limbsThisScaled.unshift(parseInt(thisCoeffStr.substring(startThis, currentPosThis), 10));
        currentPosThis = startThis;
    }
    if (limbsThisScaled.length === 0) limbsThisScaled.push(0);

    const limbsOtherScaled = [];
    let currentPosOther = otherCoeffStr.length;
    while (currentPosOther > 0) {
        const startOther = Math.max(0, currentPosOther - BASE_LOG10);
        limbsOtherScaled.unshift(parseInt(otherCoeffStr.substring(startOther, currentPosOther), 10));
        currentPosOther = startOther;
    }
    if (limbsOtherScaled.length === 0) limbsOtherScaled.push(0);

    // Compare magnitudes of aligned coefficients (represented by their limb arrays)
    let comparison = 0;
    if (limbsThisScaled.length > limbsOtherScaled.length) comparison = 1;
    else if (limbsThisScaled.length < limbsOtherScaled.length) comparison = -1;
    else {
        for(let i=0; i < limbsThisScaled.length; i++) {
            if(limbsThisScaled[i] > limbsOtherScaled[i]) { comparison = 1; break; }
            if(limbsThisScaled[i] < limbsOtherScaled[i]) { comparison = -1; break; }
        }
    }

    if (comparison === 0) { // this magnitude === other magnitude
      result.limbs = [0]; result.exponent = 0; result.sign = 1; // Result is 0
      return result;
    }

    let minuendLimbs, subtrahendLimbs;
    if (comparison > 0) { // |this| > |other|
      minuendLimbs = limbsThisScaled;
      subtrahendLimbs = limbsOtherScaled;
      result.sign = this.sign; // Sign of the result is sign of the larger magnitude number
    } else { // |this| < |other|
      minuendLimbs = limbsOtherScaled;
      subtrahendLimbs = limbsThisScaled;
      result.sign = -this.sign; // Sign of the result is opposite sign of the larger magnitude number
    }

    const tempMinuendMinimal = { limbs: minuendLimbs, isZero: function() { return this.limbs.length === 1 && this.limbs[0] === 0; } };
    const tempSubtrahendMinimal = { limbs: subtrahendLimbs, isZero: function() { return this.limbs.length === 1 && this.limbs[0] === 0; } };

    const coreResult = this._core_subtract.call(tempMinuendMinimal, tempSubtrahendMinimal);
    result.limbs = coreResult.limbs;
    result.exponent = commonExponent; // Exponent of the result is the common (smaller) exponent

    if (result.isZero()) { result.sign = 1; result.exponent = 0; } // Normalize if zero
    else {
      // Correctly adjust exponent when removing trailing zero limbs with new BASE
      while (result.limbs.length > 1 && result.limbs[result.limbs.length - 1] === 0) {
        result.limbs.pop();
        result.exponent += BASE_LOG10; // Add BASE_LOG10 for each full zero limb removed
      }
    }
    return result;
  }

  _multiply_limb_by_bigint(limbValue, otherNumber) {
      // Multiplies a single limb (limbValue) by a multi-limb number (otherNumber)
      // Assumes otherNumber is positive.
      if (limbValue === 0 || otherNumber.isZero()) {
        return new BigIntPrimitive("0", this.canvas, { forceCPU: true });
      }

      const oLR = [...otherNumber.limbs].reverse(); // otherNumber.limbs reversed
      let rL = []; // resultLimbs (reversed)
      let c = 0;   // carry

      for (let i = 0; i < oLR.length; i++) {
        const p = oLR[i] * limbValue + c;
        rL.push(p % BASE);
        c = Math.floor(p / BASE);
      }
      while (c > 0) { // Handle remaining carry
        rL.push(c % BASE);
        c = Math.floor(c / BASE);
      }

      let fL = rL.reverse(); // finalLimbs
      // No leading zeros to remove usually, as carry propagation handles it.
      // But if otherNumber was [0, X], it might happen.
      while (fL.length > 1 && fL[0] === 0) { fL.shift(); }
      if (fL.length === 0) fL = [0];

      const res = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
      res.limbs = fL;
      res.sign = 1; // Result is positive magnitude
      // Exponent of otherNumber is not directly relevant here,
      // as this is coefficient multiplication. Exponents are handled in multiply().
      res.exponent = 0;
      if(res.isZero()) res.exponent = 0; // Normalize if it became zero
      return res;
  }

   _core_multiply(num1, num2) {
    if (num1.isZero() || num2.isZero()) {
        return new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    }
    // Core multiplication assuming num1, num2 are positive coefficient-like BigIntPrimitives (exponent=0)
    if (num1.isZero() || num2.isZero()) {
        return new BigIntPrimitive("0", this.canvas, { forceCPU: true }); // Exponent 0, Sign 1
    }

    let tR = new BigIntPrimitive("0", this.canvas, { forceCPU: true }); // totalResult, also exponent 0, sign 1
    const n1LR = [...num1.limbs].reverse(); // num1 limbs reversed (least significant first)

    for (let i = 0; i < n1LR.length; i++) {
        const d1 = n1LR[i]; // current limb of num1
        if (d1 === 0 && n1LR.length > 1 && num1.limbs.length > 1) continue; // Skip if limb is zero unless it's the only limb

        let pPM = this._multiply_limb_by_bigint(d1, num2); // partialProductMagnitude (is a BigIntPrimitive, exponent 0)

        if (!pPM.isZero()) { // Only add if partial product is not zero
            // Convert partial product magnitude to a coefficient string
            let pPMcoeffStr = "";
            if (pPM.limbs.length > 0) {
                pPMcoeffStr = String(pPM.limbs[0]);
                for (let k = 1; k < pPM.limbs.length; k++) {
                    pPMcoeffStr += String(pPM.limbs[k]).padStart(BASE_LOG10, '0');
                }
            } else {
                pPMcoeffStr = "0"; // Should ideally not happen if pPM not zero
            }

            // Shift partial product by i * BASE_LOG10 (effectively multiplying by BASE^i by appending zeros)
            let shiftedCoeffStr = pPMcoeffStr;
            if (i > 0 && pPMcoeffStr !== "0") {
                 shiftedCoeffStr += '0'.repeat(i * BASE_LOG10);
            }

            const sPP = BigIntPrimitive.fromCoefficientString(shiftedCoeffStr, this.canvas, {forceCPU: true});
            tR = tR.add(sPP);
        }
    }

    if (tR.isZero()) {
        tR.sign = 1; tR.exponent = 0;
    } else {
        // Ensure result is normalized (exponent 0, sign 1 for positive magnitude)
        tR.sign = 1;
        // The exponent for _core_multiply should be 0 as it deals with coefficients.
        // The add method might introduce an exponent if intermediate sums get very large,
        // but for coefficient multiplication, the final exponent should be reset or handled carefully.
        // For now, assuming add method on coefficients (like tR and sPP) maintains exponent 0 if inputs have exp 0.
        // This needs to be true for _core_add when used by this _core_multiply.
        // Let's ensure the exponent of tR is 0 if it's not truly zero.
        if(!tR.isZero()) tR.exponent = 0;
    }
    return tR;
  }

  multiply(otherBigInt) {
    const self = this;
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive."); }
    if (self.isZero() || otherBigInt.isZero()) {
        return new BigIntPrimitive("0", self.canvas, { forceCPU: self.forceCPU || otherBigInt.forceCPU });
    }
    const finalExponent = self.exponent + otherBigInt.exponent; // Sum of original exponents
    const resultSign = (self.sign === otherBigInt.sign) ? 1 : -1;

    // Multiply coefficients (abs values, treat exponents as zero for this part)
    const selfCoeff = new BigIntPrimitive(this, this.canvas, {forceCPU: true});
    selfCoeff.sign = 1; selfCoeff.exponent = 0; // Create positive coefficient version

    const otherCoeff = new BigIntPrimitive(otherBigInt, this.canvas, {forceCPU: true});
    otherCoeff.sign = 1; otherCoeff.exponent = 0; // Create positive coefficient version

    let absResult; // This will be the BigIntPrimitive result of multiplying coefficients
    let gl; // WebGL instance
    if (!self.forceCPU && !otherBigInt.forceCPU && self.canvas && typeof webglUtilsModule !== 'undefined' && (gl = webglUtilsModule.initWebGL(self.canvas))) {
      absResult = self._core_multiply(selfCoeff, otherCoeff); // Fix: Use selfCoeff, otherCoeff
    } else {
       if (selfCoeff.limbs.length < KARATSUBA_THRESHOLD || otherCoeff.limbs.length < KARATSUBA_THRESHOLD) { // Fix: Use selfCoeff, otherCoeff
           absResult = self._core_multiply(selfCoeff, otherCoeff); // Fix: Use selfCoeff, otherCoeff
       } else {
           const n = Math.max(selfCoeff.limbs.length, otherCoeff.limbs.length); // Fix: Use selfCoeff, otherCoeff
           const m = Math.floor(n / 2);
           if (m === 0) { absResult = self._core_multiply(selfCoeff, otherCoeff); // Fix: Use selfCoeff, otherCoeff
           } else {
               const { low: b, high: a } = selfCoeff._splitAt(m); // Fix: Use selfCoeff
               const { low: d, high: c } = otherCoeff._splitAt(m); // Fix: Use otherCoeff
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
         // Trailing zero limbs in the coefficient product (absResult from _core_multiply)
         // should have been handled by _core_multiply returning a normalized coefficient.
         // The finalExponent is applied after.
         // If absResult itself has limbs like [X, 0, 0] and represents a whole number,
         // this loop might incorrectly adjust finalExponent.
         // For now, let's assume _core_multiply returns a compact coefficient.
         // The main concern here is if absResult is e.g. [ limb1, 0 ] representing value limb1*BASE.
         // toString() should handle this.
         // Let's remove this potentially problematic loop for now, as exponent is global.
         // The exponent adjustment for trailing zeros is more complex with a global exponent and multi-digit limbs.
         // It's better handled by toString or a dedicated normalization step if needed.
         // For now, rely on _core_multiply returning normalized coefficient limbs.
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

  _decimalDivide(divisorParam, numDecimalPlacesParam) {
    const dividend = new BigIntPrimitive(this, this.canvas);
    const divisor = new BigIntPrimitive(divisorParam, this.canvas);

    if (divisor.isZero()) {
      throw new Error("Division by zero in _decimalDivide.");
    }
    if (dividend.isZero()) {
      return new BigIntPrimitive("0", this.canvas);
    }
    if (dividend.isNegative() || divisor.isNegative()) {
      throw new Error("_decimalDivide expects positive inputs after re-instantiation.");
    }

    let d_val_str = dividend.limbs.join('');
    let d_exp = dividend.exponent;
    let v_val_str = divisor.limbs.join('');
    let v_exp = divisor.exponent;

    let dividendStrForScaling = d_val_str;
    // Ensure numDecimalPlaces is a non-negative integer for '0'.repeat()
    const actualNumDecimalPlaces = (typeof numDecimalPlacesParam === 'number' && numDecimalPlacesParam >= 0) ? numDecimalPlacesParam : 0;
    dividendStrForScaling += '0'.repeat(actualNumDecimalPlaces);

    const biDividend = BigInt(dividendStrForScaling);
    const biDivisor = BigInt(v_val_str);

    if (biDivisor === 0n) {
        throw new Error("Division by zero after BigInt conversion for divisor.");
    }
    const biResult = biDividend / biDivisor;
    const q_int_str = biResult.toString();

    const resultNum = new BigIntPrimitive(q_int_str, this.canvas, { forceCPU: true });
    const exponent_from_parsing_resultStr = resultNum.exponent;
    const final_exponent_for_resultNum = exponent_from_parsing_resultStr + d_exp - v_exp - actualNumDecimalPlaces;
    resultNum.exponent = final_exponent_for_resultNum;

    if (resultNum.isZero()) {
        resultNum.exponent = 0;
    }

    resultNum.sign = 1;
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

    // quotient = quotient.round(BigIntPrimitive.DP, BigIntPrimitive.RM); // COMMENTED OUT FOR DEBUGGING

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
    if (dp === undefined) dp = 0; // Default dp to 0 if undefined
    else if (typeof dp !== 'number' || !Number.isInteger(dp) || dp < 0) {
        // Test expects "Invalid decimal places" for other formatting methods,
        // but for round itself, a RangeError is fine or use a specific message if tests target it.
        throw new RangeError("Decimal places NaN or negative");
    }
    const roundingMode = (rm === undefined) ? this.constructor.RM : rm;
    if (roundingMode !== 0 && roundingMode !== 1 && roundingMode !== 2 && roundingMode !== 3) {
        throw new RangeError("Invalid rounding mode");
    }

    if (this.isZero()) {
        const zero = new BigIntPrimitive(this);
        zero._roundedDp = dp;
        if (dp > 0 && zero.sign === -1) zero.sign = 1; // Positive "0.00"
        else if (dp === 0 && zero.sign === -1) { /* keep sign for -0 when dp=0 */ }
        else zero.sign = 1;
        return zero;
    }

    // 1. Get the full coefficient string (all digits of the number, no decimal point)
    let coeffStr = this.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('');

    // 2. Determine the effective number of integer digits in the coefficient string if the exponent were applied.
    const numDigitsInCoeff = coeffStr.length;
    const effectiveIntegerDigits = numDigitsInCoeff + this.exponent; // num digits to left of decimal point

    // 3. Calculate decisionIndex: how many digits of coeffStr to keep for the desired precision *before* rounding.
    const decisionIndex = effectiveIntegerDigits + dp;

    // 4. Call _staticRound_cpu
    const newCoeffStr = this._staticRound_cpu(coeffStr, decisionIndex, roundingMode, this.sign === -1);

    // 5. Create a new BigIntPrimitive from newCoeffStr
    const result = BigIntPrimitive.fromCoefficientString(newCoeffStr, this.canvas, { forceCPU: this.forceCPU });
    result.sign = (result.isZero()) ? 1 : this.sign;

    // The newCoeffStr is an integer. The number of decimal places is 'dp'.
    // So, the exponent needs to make the last 'dp' digits of newCoeffStr fractional.
    // fromCoefficientString sets exponent to 0.
    // If newCoeffStr = "12345" (from 123.45, dp=2), result from fromCoeff is (limbs=[1,2345], exp=0).
    // We want it to represent 123.45, so exp should be -2.
    // If newCoeffStr = "123" (from 1.23, dp=2), result from fromCoeff is (limbs=[123], exp=0)
    // We want it to represent 1.23, so exp should be -2.
    // If newCoeffStr = "12300" (from 123, dp=2, after padding in toString), this is handled by toString.
    // The result of round should be the actual rounded numerical value.
    // The exponent should be set such that newCoeffStr represents the integer part and 'dp' fractional digits.
    // No, newCoeffStr is the *entire sequence of digits*. The exponent makes it correct.
    // If round("123.456", 0) -> newCoeffStr "123". Result is (limbs=[123], exp=0).
    // If round("123.456", 1) -> newCoeffStr "1235". Result is (limbs=[1235], exp=-1 for 123.5).
    // The exponent of the result of round should be (original coeff str length + original exponent) - new coeff str length - dp.
    // This is too complex. Let's simplify: the newCoeffStr *is* the coefficient of the rounded number.
    // The number of decimal places it has is specified by dp. So its exponent is -dp.
    // This was the previous logic and it passed _staticRound_cpu tests because they check the string.
    // The issue is how this interacts with toFixed/toExponential's own formatting.
    // Let's keep result.exponent = -dp as it was when _staticRound_cpu tests passed.
    // The problem must be in toExponential/toFixed's interpretation or re-rounding.

    result.exponent = -dp; // This makes newCoeffStr have 'dp' decimal places.

    if (result.isZero()) {
        result.exponent = 0; // True zero has exponent 0
        if (this.sign === -1 && dp === 0 && newCoeffStr === "0") {
            // Preserve -0 if input was negative and rounded to 0 at 0dp.
             result.sign = -1;
        } else {
             result.sign = 1;
        }
    }

    result._roundedDp = dp;
    return result;
  }

  toExponential(dpUndefined, rmUndefined) {
    const Ctor = this.constructor;
    const actualRm = (rmUndefined === undefined) ? Ctor.RM : rmUndefined;
    let dp = dpUndefined;

    if (dp !== undefined && (typeof dp !== 'number' || !Number.isInteger(dp) || dp < 0 || dp > 1E6)) {
      throw new RangeError("Invalid decimal places");
    }
    if (rmUndefined !== undefined && (rmUndefined < 0 || rmUndefined > 3 || !Number.isInteger(rmUndefined))) {
      throw new RangeError("Invalid rounding mode");
    }

    if (this.isZero()) {
      let zeroStr = "0";
      if (dp !== undefined && dp > 0) { zeroStr += "." + "0".repeat(dp); }
      return zeroStr + "e+0";
    }

    // 1. Get the full coefficient string (all digits) and current power-of-10 exponent
    let coeffStr = this.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('');
    let currentExponent = this.exponent; // This is power of 10 for the coefficient string

    // 2. Calculate the scientific exponent
    let sciExp = (coeffStr.length - 1) + currentExponent;

    // 3. Create the significand (a number like d.ffffff...)
    // The significand's value is coeffStr * 10^(currentExponent - sciExp)
    // Example: this = 123.45 (coeffStr="12345", currentExponent=-2). sciExp = (5-1)+(-2) = 2.
    // Significand should be 1.2345. Its exponent is currentExponent - sciExp = -2 - 2 = -4.
    // So, significand is "12345" * 10^-4.
    const significand = Ctor.fromCoefficientString(coeffStr, this.canvas, { forceCPU: true });
    significand.exponent = currentExponent - sciExp; // Make it represent number like X.YYYY
    significand.sign = 1; // Rounding is done on absolute value

    // 4. Determine dp for rounding the significand
    // If dpUndefined is undefined, we need to show all significant digits of the original number's coefficient.
    // The significand already has all these digits. We want dp to be coeffStr.length - 1.
    const dpForRounding = (dp === undefined) ? coeffStr.length - 1 : dp;

    // 5. Round the significand
    let roundedSignificand = significand.round(dpForRounding, actualRm);

    // 6. Adjust sciExp if rounding changed the magnitude of the significand
    // (e.g., 9.99 rounded to 1 dp becomes 10.0, which is 1.0e+1)
    // Get the coefficient string of the rounded significand
    let roundedCoeffStr = roundedSignificand.limbs.map((l, i) => (i === 0) ? String(l) : String(l).padStart(BASE_LOG10, '0')).join('');
    let roundedCoeffExp = roundedSignificand.exponent; // This is -dpForRounding (or 0 if dpForRounding was 0 and it became integer)

    // Number of integer digits in the rounded significand's coefficient
    let roundedNumIntegerDigits = roundedCoeffStr.length + roundedCoeffExp;

    if (roundedCoeffStr !== "0" && roundedNumIntegerDigits !== 1) {
        sciExp += (roundedNumIntegerDigits - 1);
        roundedSignificand.exponent -= (roundedNumIntegerDigits - 1); // Adjust exponent to make it d.ffff
        // Re-round to the correct number of decimal places *after* this magnitude adjustment
        // if dp was specified.
        if (dp !== undefined) {
             roundedSignificand = roundedSignificand.round(dp, actualRm);
        }
    }

    // 7. Format the output string
    let finalCoeffStr = roundedSignificand.toString(); // This will have one leading digit due to previous adjustments/rounding for sci notation

    // Ensure correct number of decimal places if dp is specified
    if (dp !== undefined) {
        let parts = finalCoeffStr.split('.');
        if (dp === 0) {
            finalCoeffStr = parts[0];
        } else {
            let fractionalPart = parts[1] || "";
            finalCoeffStr = parts[0] + "." + fractionalPart.padEnd(dp, '0').substring(0, dp);
        }
    } else { // dp undefined, remove trailing .0 if any
        if (finalCoeffStr.includes('.') && finalCoeffStr.endsWith('.0')) {
             // This case might be covered by toString's own logic of .replace(/\.?0+$/, '')
        } else if (finalCoeffStr.includes('.') && !finalCoeffStr.substring(finalCoeffStr.indexOf('.')+1).match(/[1-9]/) ) {
            finalCoeffStr = finalCoeffStr.split('.')[0]; // e.g. "1.000" -> "1"
        }
    }


    let res = (this.sign === -1 && parseFloat(finalCoeffStr) !== 0 ? "-" : "") + finalCoeffStr;
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

    if (typeof dp !== 'number' || !Number.isInteger(dp) || dp < 0 || dp > 1e6 ) { // Max dp from big.js
        throw new RangeError("Invalid decimal places");
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
    const sLimbsLength = S.limbs.map(l => String(l).length).reduce((a,b)=>a+b,0) - (S.limbs.length > 0 ? S.limbs.length-1 : 0) + (S.limbs.length > 1 ? (S.limbs.length-1)*(BASE_LOG10-String(S.limbs[0]).length) : 0) ; // Approximate length of coefficient string
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
}

BigIntPrimitive.prototype._staticRound_cpu = function(coeffStr, decisionIndex, rm, isNegativeOriginal) {
    const Ctor = this.constructor; // Use this.constructor in a prototype method
    let isNegative = isNegativeOriginal; // Use a mutable variable for sign if needed for rounding logic itself

    if (coeffStr === "0") return "0";

    // If decisionIndex means we keep no digits or round to an empty string.
    if (decisionIndex <= 0) {
        // Check the first digit that would be part of the fractional part to round
        const firstDigitToConsider = coeffStr[0] ? parseInt(coeffStr[0], 10) : 0;
        let shouldRoundUpToOne = false;
        if (rm === Ctor.roundHalfUp && firstDigitToConsider >= 5) shouldRoundUpToOne = true;
        else if (rm === Ctor.roundHalfEven) {
            if (firstDigitToConsider > 5) shouldRoundUpToOne = true;
            else if (firstDigitToConsider === 5) {
                let allFollowingAreZero = true;
                for (let k = 1; k < coeffStr.length; k++) {
                    if (coeffStr[k] !== '0') {
                        allFollowingAreZero = false;
                        break;
                    }
                }
                if (!allFollowingAreZero) shouldRoundUpToOne = true;
            }
        } else if (rm === Ctor.roundUp && !isNegative && firstDigitToConsider > 0) {
             shouldRoundUpToOne = true;
        }
        // For negative numbers and roundUp, no increment on magnitude (closer to zero).
        return shouldRoundUpToOne ? "1" : "0";
    }

    if (decisionIndex > coeffStr.length) {
        // Pad with zeros if we are rounding to more places than available in coeffStr
        return coeffStr + '0'.repeat(decisionIndex - coeffStr.length);
    }

    // If decisionIndex === coeffStr.length, no rounding is needed, keep all digits.
    if (decisionIndex === coeffStr.length) {
        return coeffStr;
    }

    // decisionIndex < coeffStr.length, so actual rounding/truncation happens.
    let partToKeep = coeffStr.substring(0, decisionIndex);
    const roundingDigit = parseInt(coeffStr[decisionIndex], 10);
    let exactHalf = true;
    for (let i = decisionIndex + 1; i < coeffStr.length; i++) {
        if (coeffStr[i] !== '0') {
            exactHalf = false;
            break;
        }
    }

    let increment = false;
    if (rm === Ctor.roundDown) { /* no change */ }
    else if (rm === Ctor.roundHalfUp) { if (roundingDigit >= 5) increment = true; }
    else if (rm === Ctor.roundHalfEven) {
        if (roundingDigit > 5) increment = true;
        else if (roundingDigit === 5) {
            if (!exactHalf) increment = true; // e.g., x.500...1
            else { // Exactly x.500...0
                const prevDigit = partToKeep.length > 0 ? parseInt(partToKeep[partToKeep.length - 1], 10) : 0;
                if (prevDigit % 2 !== 0) increment = true; // Ends in odd, round up
            }
        }
    } else if (rm === Ctor.roundUp) {
        if (isNegative) { /* For negative, roundUp means towards zero, so no increment on magnitude */ }
        else if (roundingDigit > 0 || !exactHalf) { // For positive, if any discarded part > 0
            increment = true;
        }
    }

    if (increment) {
        if (partToKeep === "") partToKeep = "0"; // Handle case where partToKeep might be empty if decisionIndex was 0
        let i = partToKeep.length - 1;
        let newCoeffArr = partToKeep.split('');
        while (i >= 0) {
            if (newCoeffArr[i] === '9') {
                newCoeffArr[i] = '0';
                i--;
            } else {
                newCoeffArr[i] = (parseInt(newCoeffArr[i], 10) + 1).toString();
                break;
            }
        }
        if (i < 0) { // All were '9's, prepend '1'
            newCoeffArr.unshift('1');
        }
        partToKeep = newCoeffArr.join('');
    }

    return partToKeep === "" ? "0" : partToKeep; // Ensure "0" if string becomes empty
};


export { BigIntPrimitive };
