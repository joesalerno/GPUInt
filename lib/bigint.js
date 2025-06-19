import * as webglUtilsModule from './webgl-utils.js';
import vertexShaderSrc from './shaders/addition.vert?raw';
import fragmentShaderSrc from './shaders/addition.frag?raw';
let instanceCounter = 0; // Instance counter for debugging
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
    this._instanceId = instanceCounter++; // Corrected placement
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
    // Basic log, avoid overly complex stringification here if value is an object
    const finalLimbsStr = `[${this.limbs.join(',')}]`;
    console.log(`[Instance Created ID: ${this._instanceId}] Input type: ${typeof value}, Value (partial): ${String(value).substring(0, 50)}, ForceCPU: ${options?.forceCPU}, Final limbs: ${finalLimbsStr}, Final exponent: ${this.exponent}`);
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

  compareMagnitude(other) {
    if (!(other instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    if (this.isZero() && other.isZero()) return 0;
    if (this.isZero()) return -1; // other is non-zero
    if (other.isZero()) return 1; // this is non-zero

    // 1. Get coefficient strings (these are the raw digits, correctly ordered)
    const tc = this.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('');
    const oc = other.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('');

    // 2. Determine effective exponent of the MSD for each number
    // This is the power of 10 for the first digit of the coefficient string.
    const tExp = this.exponent + (tc.length - 1);
    const oExp = other.exponent + (oc.length - 1);

    if (tExp > oExp) return 1;
    if (tExp < oExp) return -1;

    // 3. MSDs are at the same power of 10. Compare digit by digit.
    // The loop should go for the maximum possible number of digits influenced by these coefficients
    // starting from the common MSD exponent `tExp`.
    const len = Math.max(tc.length, oc.length);
    for (let i = 0; i < len; i++) {
      // Get digits from tc and oc. If one string is shorter, its subsequent digits are effectively 0.
      const td = (i < tc.length) ? parseInt(tc[i], 10) : 0;
      const od = (i < oc.length) ? parseInt(oc[i], 10) : 0;

      if (td > od) return 1;
      if (td < od) return -1;
    }

    // All compared digits were identical.
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
    // const limbString = this.limbs.length > 20 ? `[${this.limbs.slice(0,10).join(',')}...${this.limbs.slice(-10).join(',')}]` : `[${this.limbs.join(',')}]`;
    // console.log(`[toString ENTRY ID: ${this._instanceId}] current _roundedDp: ${this._roundedDp}, limbs: ${limbString}, exp: ${this.exponent}, sign: ${this.sign}`);
    console.log(`[toString ENTRY ID: ${this._instanceId}] current _roundedDp: ${this._roundedDp}, exp: ${this.exponent}, sign: ${this.sign}`);
    if (this.isZero()) {
        // If _roundedDp is set and positive, format as 0.00...
        if (typeof this._roundedDp === 'number' && this._roundedDp > 0) {
            // For "0.00", sign is always positive unless it was specifically "-0" and _roundedDp is not forcing positive zero.
            // However, standard behavior for formatted "0.00" is positive.
            return '0.' + '0'.repeat(this._roundedDp);
        }
        // If _roundedDp is 0 or not set, return "0" (sign is handled later for "-0" if needed)
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
    const useSciNotation = (this._roundedDp === null || this._roundedDp === undefined) && // Only use NE/PE if not formatting to a specific dp
                           (decimalPointActualPosition <= BigIntPrimitive.NE ||
                            decimalPointActualPosition > BigIntPrimitive.PE);

    if (useSciNotation) {
        // Scientific notation: c.fff...e+exp
        s = coefficientString[0]; // First digit
        if (numDigits > 1) {
            s += '.' + coefficientString.substring(1); // Append fractional part
        }
        // For scientific notation without specific _roundedDp, remove trailing fractional zeros
        if (s.includes('.')) {
           s = s.replace(/\.?0+$/, '');
        }
        const scientificExponent = decimalPointActualPosition - 1;
        s += 'e' + (scientificExponent >= 0 ? '+' : '') + scientificExponent;
    } else {
        // Fixed-point notation
        if (e < 0) { // Negative exponent means decimal point is to the left
            if (decimalPointActualPosition > 0) {
                s = coefficientString.substring(0, decimalPointActualPosition) + '.' + coefficientString.substring(decimalPointActualPosition);
            } else {
                s = '0.' + '0'.repeat(-decimalPointActualPosition) + coefficientString;
            }
        } else { // Positive or zero exponent
            s = coefficientString + '0'.repeat(e);
        }

        // Handle formatting based on _roundedDp
        if (typeof this._roundedDp === 'number' && this._roundedDp >= 0) {
            let [integerPart, fractionalPart = ''] = s.split('.');
            if (this._roundedDp > 0) {
                fractionalPart = fractionalPart.padEnd(this._roundedDp, '0');
                fractionalPart = fractionalPart.substring(0, this._roundedDp); // Ensure it's exactly _roundedDp length
                s = integerPart + '.' + fractionalPart;
            } else { // _roundedDp is 0
                s = integerPart;
            }
        } else if (s.includes('.')) { // _roundedDp is not set (null/undefined), remove trailing fractional zeros
             s = s.replace(/\.?0+$/, '');
        }
        // Ensure "0" if string becomes empty after formatting (e.g. "0.0" with _roundedDp=0)
        if (s === "") s = "0";
        // Ensure leading zero if it's like ".5"
        if (s.startsWith('.')) s = '0' + s;
    }

    // Store the sign and handle it at the very end.
    const preSign = (this.sign === -1 && !this.isZero()) ? "-" : "";
    let outputStr = s; // s is the string from main formatting logic before this final step

    // DEBUG: Log the state of _roundedDp before the critical formatting block
    // Simplified to reduce potential side effects of logging complex properties.
    console.log(`[toString DEBUG ID: ${this._instanceId}] Value for formatting: ${s}, Exp: ${this.exponent}, Sign: ${this.sign}, Current _roundedDp: ${this._roundedDp}`);

    // Explicit re-formatting if _roundedDp is set.
    // This section ensures that if _roundedDp was set by an operation like toFixed() or round(),
    // the output string strictly adheres to that number of decimal places.
    if (typeof this._roundedDp === 'number' && this._roundedDp >= 0) {
        if (this.isZero()) {
            // For 0, _roundedDp determines trailing zeros. Sign is positive for "0.00".
            outputStr = (this._roundedDp > 0) ? '0.' + '0'.repeat(this._roundedDp) : '0';
            // For "0" or "0.00", sign is positive unless it was input as "-0" AND _roundedDp is null/undefined.
            // Since _roundedDp is set here, "-0.00" is not standard; it becomes "0.00".
            return outputStr;
        }

        // For non-zero numbers, regenerate a clean fixed-point representation from current limbs/exponent.
        // This ensures 's' (now baseFixedS) is not some intermediate state from earlier toString logic if that was problematic.
        let baseFixedS;
        const currentCoeff = this.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('');
        const currentExp = this.exponent;
        const currentNumDigits = currentCoeff.length;
        const currentDecimalPos = currentNumDigits + currentExp;

        if (currentExp < 0) {
            if (currentDecimalPos > 0) { // e.g., 123.45 (coeff 12345, exp -2 => currentDecimalPos 3)
                baseFixedS = currentCoeff.substring(0, currentDecimalPos) + '.' + currentCoeff.substring(currentDecimalPos);
            } else { // e.g., 0.0123 (coeff 123, exp -4 => currentDecimalPos -1)
                baseFixedS = '0.' + '0'.repeat(-currentDecimalPos) + currentCoeff;
            }
        } else { // Positive or zero exponent, e.g., 12300 (coeff 123, exp 2 => currentDecimalPos 5) or 123 (coeff 123, exp 0)
            baseFixedS = currentCoeff + '0'.repeat(currentExp);
        }

        let [integerPart, fractionalPart = ''] = baseFixedS.split('.');

        if (this._roundedDp === 0) {
            outputStr = integerPart;
        } else { // this._roundedDp > 0
            fractionalPart = fractionalPart.padEnd(this._roundedDp, '0');
            fractionalPart = fractionalPart.substring(0, this._roundedDp); // Ensure exactly _roundedDp length
            outputStr = integerPart + '.' + fractionalPart;
        }
    }
    // If _roundedDp was null, outputStr remains 's' from the primary formatting logic (sci or compact fixed).

    // Apply sign.
    if (preSign === "-") {
        // Avoid "-0" or "-0.00" unless it was an original "-0" and no _roundedDp formatting was applied.
        const isZeroOutput = (outputStr === "0" || (outputStr.includes(".") && parseFloat(outputStr) === 0));
        if (isZeroOutput) {
            // Only return "-0" if it was truly "-0" from constructor AND _roundedDp was NOT involved in formatting it to "0" or "0.0..."
            if (this.limbs.length === 1 && this.limbs[0] === 0 && (this._roundedDp === null || this._roundedDp === undefined)) {
                 return "-0";
            }
            return outputStr; // Otherwise, "0" or "0.00" is positive
        }
        return preSign + outputStr;
    }
    return outputStr;
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

  static _coeffStrToPaddedLimbs(coeffStr, targetLimbLength, baseLog10Val = BASE_LOG10) {
    let limbs = []; // Build LSL first
    if (coeffStr === "0") {
        limbs.push(0);
    } else if (coeffStr.length > 0) {
        let currentPos = coeffStr.length;
        while (currentPos > 0) {
            const start = Math.max(0, currentPos - baseLog10Val);
            limbs.push(parseInt(coeffStr.substring(start, currentPos), 10)); // Push LSL first
            currentPos = start;
        }
        // limbs is now [LSL, ..., MSL] e.g. "123456789" -> [6789, 2345, 1]
    }
    // If after parsing, limbs is empty (e.g. coeffStr was empty or invalid), ensure it's [0]
    if (limbs.length === 0) {
        limbs.push(0);
    }

    const paddedLimbs = new Float32Array(targetLimbLength);
    for (let i = 0; i < targetLimbLength; i++) {
      paddedLimbs[i] = (i < limbs.length) ? limbs[i] : 0; // Pad with trailing zeros
    }
    return paddedLimbs; // Float32Array is [LSL, ..., MSL, 0, 0...]
  }

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

    let gl;
    let webglSuccess = false; // Flag to track if WebGL path executes successfully up to a point
    let webglAttempted = false;

    if (!this.forceCPU && !otherBigInt.forceCPU && this.canvas && typeof webglUtilsModule !== 'undefined') {
      webglAttempted = true;
      gl = webglUtilsModule.initWebGL(this.canvas);
      if (gl && gl.getExtension('OES_texture_float')) {
        if (this.sign !== otherBigInt.sign) {
          // Delegate to CPU subtract for different signs (for now)
          // To use WebGL subtract, this logic path would need its own WebGL setup for subtraction.
          // By not setting webglSuccess = true, it will fall through to CPU.
        } else {
          let addProgram, texNum1, texNum2, texCarryIn, texOutput, fbOutput, positionBuffer; // For cleanup
          try {
            const commonExponent = Math.min(this.exponent, otherBigInt.exponent);
            let thisCoeffStr = this.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('');
            let otherCoeffStr = otherBigInt.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('');

            console.log(`[WebGL Add Debug] this: ${this.toString()}, other: ${otherBigInt.toString()}`);
            console.log(`[WebGL Add Debug] commonExponent: ${commonExponent}`);

            thisCoeffStr += '0'.repeat(Math.max(0, this.exponent - commonExponent));
            otherCoeffStr += '0'.repeat(Math.max(0, otherBigInt.exponent - commonExponent));
            console.log(`[WebGL Add Debug] thisCoeffStr (scaled): ${thisCoeffStr}`);
            console.log(`[WebGL Add Debug] otherCoeffStr (scaled): ${otherCoeffStr}`);

            const thisScaledLimbsCount = Math.ceil(thisCoeffStr.length / BASE_LOG10) || 1;
            const otherScaledLimbsCount = Math.ceil(otherCoeffStr.length / BASE_LOG10) || 1;
            const texWidth = Math.max(thisScaledLimbsCount, otherScaledLimbsCount) + 1; // +1 for potential carry
            console.log(`[WebGL Add Debug] thisScaledLimbsCount: ${thisScaledLimbsCount}, otherScaledLimbsCount: ${otherScaledLimbsCount}, texWidth: ${texWidth}`);

            const limbsA_scaled_f32 = BigIntPrimitive._coeffStrToPaddedLimbs(thisCoeffStr, texWidth, BASE_LOG10);
            const limbsB_scaled_f32 = BigIntPrimitive._coeffStrToPaddedLimbs(otherCoeffStr, texWidth, BASE_LOG10);
            console.log(`[WebGL Add Debug] limbsA_scaled_f32: [${Array.from(limbsA_scaled_f32).join(', ')}]`);
            console.log(`[WebGL Add Debug] limbsB_scaled_f32: [${Array.from(limbsB_scaled_f32).join(', ')}]`);

            if (typeof vertexShaderSrc !== 'string' || typeof fragmentShaderSrc !== 'string') {
               throw new Error('Shader source not loaded');
            }
            const vs = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, vertexShaderSrc);
            const fs = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSrc);
            addProgram = webglUtilsModule.createProgram(gl, vs, fs);
            if (!addProgram) throw new Error('WebGL program creation failed for addition.');

            texNum1 = webglUtilsModule.createDataTexture(gl, limbsA_scaled_f32, texWidth, 1, false);
            texNum2 = webglUtilsModule.createDataTexture(gl, limbsB_scaled_f32, texWidth, 1, false);
            texCarryIn = webglUtilsModule.createDataTexture(gl, new Float32Array(texWidth).fill(0), texWidth, 1, false);
            texOutput = webglUtilsModule.createDataTexture(gl, null, texWidth, 1, true); // RGBA for resultLimb & carryOut
            if (!texNum1 || !texNum2 || !texCarryIn || !texOutput) throw new Error('WebGL texture creation failed.');

            fbOutput = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
              throw new Error('WebGL framebuffer incomplete.');
            }

            gl.useProgram(addProgram);
            gl.viewport(0, 0, texWidth, 1);

            const uNum1Loc = gl.getUniformLocation(addProgram, "u_num1Texture");
            const uNum2Loc = gl.getUniformLocation(addProgram, "u_num2Texture");
            const uCarryInLoc = gl.getUniformLocation(addProgram, "u_carryTexture");
             const uBaseLoc = gl.getUniformLocation(addProgram, "u_base");
             const uTexWidthLoc = gl.getUniformLocation(addProgram, "u_texWidth");

             if (!uBaseLoc || !uTexWidthLoc) {
                console.error("[WebGL Add Debug] Failed to get location for u_base or u_texWidth.");
                throw new Error("Uniform location error for u_base or u_texWidth.");
             }

            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texNum1); gl.uniform1i(uNum1Loc, 0);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNum2); gl.uniform1i(uNum2Loc, 1);
            gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texCarryIn); gl.uniform1i(uCarryInLoc, 2);
             gl.uniform1f(uBaseLoc, BASE);
             gl.uniform1f(uTexWidthLoc, texWidth);

            positionBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
            const positionAttributeLocation = gl.getAttribLocation(addProgram, "a_position");

             console.log(`[WebGL Add Debug] positionAttributeLocation for a_position: ${positionAttributeLocation}`);
             if (positionAttributeLocation === -1) { // Check specifically for -1
                console.error("[WebGL Add Debug] a_position attribute not found in shader program.");
                throw new Error("a_position attribute not found.");
            }
             gl.enableVertexAttribArray(positionAttributeLocation);
             gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer); // Re-bind before vertexAttribPointer
             gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

            // Setup texture coordinates
            const texCoordBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);
            const texCoordAttributeLocation = gl.getAttribLocation(addProgram, "a_texCoord");
            if (texCoordAttributeLocation === -1) {
                console.error("[WebGL Add Debug] a_texCoord attribute not found in shader program.");
                throw new Error("a_texCoord attribute not found.");
            }
            gl.enableVertexAttribArray(texCoordAttributeLocation);
            gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer); // Re-bind before vertexAttribPointer
            gl.vertexAttribPointer(texCoordAttributeLocation, 2, gl.FLOAT, false, 0, 0);

            gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput);
            gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            console.log(`[WebGL Add Debug] GPU draw call complete. Expecting ${texWidth}x1 RGBA output.`);

            this._webglTempData = { texOutput, texWidth, commonExponent, sign: this.sign, glContext: gl, fbOutput };
            webglSuccess = true;

            // Minimal cleanup for resources not needed for output reading
            if(vs) gl.deleteShader(vs);
            if(fs) gl.deleteShader(fs);
            gl.deleteProgram(addProgram); // Program deleted before resources it might hold are used/deleted later
            gl.deleteTexture(texNum1);
            gl.deleteTexture(texNum2);
            gl.deleteTexture(texCarryIn);
            gl.deleteBuffer(positionBuffer);
            if (texCoordBuffer) gl.deleteBuffer(texCoordBuffer); // Delete texCoordBuffer

            // --- Start of NEW code for this step (CPU post-processing) ---
            const { texOutput: texOutputFromData, texWidth: texWidthFromData, commonExponent: retrievedCommonExponent, sign: resultSign, glContext: glCtx, fbOutput: fbOutputFromData } = this._webglTempData;

            glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, fbOutputFromData); // Use glCtx from _webglTempData
            const outputDataRGBA = webglUtilsModule.readDataFromTexture(glCtx, fbOutputFromData, texWidthFromData, 1, false);
            glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, null);
            console.log(`[WebGL Add Debug] outputDataRGBA (raw from GPU, length ${outputDataRGBA.length}): [${Array.from(outputDataRGBA).join(', ')}]`);

            const gpuLimbs = new Float32Array(texWidthFromData);
            const gpuInitialCarries = new Float32Array(texWidthFromData);

            for (let i = 0; i < texWidthFromData; i++) {
                gpuLimbs[i] = outputDataRGBA[i * 4 + 0];      // .r component
                gpuInitialCarries[i] = outputDataRGBA[i * 4 + 1]; // .g component
            }
            console.log(`[WebGL Add Debug] gpuLimbs (from .r): [${Array.from(gpuLimbs).join(', ')}]`);
            console.log(`[WebGL Add Debug] gpuInitialCarries (from .g): [${Array.from(gpuInitialCarries).join(', ')}]`);

            const actualLimbsArr = [];
            let currentPropagatedCarry = 0;
            for (let i = 0; i < texWidthFromData; i++) {
                let sumForThisLimb = gpuLimbs[i] + currentPropagatedCarry;
                actualLimbsArr.push(sumForThisLimb % BASE);
                currentPropagatedCarry = Math.floor(sumForThisLimb / BASE) + gpuInitialCarries[i];
            }

            if (currentPropagatedCarry > 0) {
                actualLimbsArr.push(currentPropagatedCarry);
            }
            console.log(`[WebGL Add Debug] actualLimbsArr (LSL first, after CPU carry): [${actualLimbsArr.join(', ')}]`);
            console.log(`[WebGL Add Debug] final carry after loop: ${currentPropagatedCarry}`);

            while (actualLimbsArr.length > 1 && actualLimbsArr[actualLimbsArr.length - 1] === 0) {
                actualLimbsArr.pop();
            }
            if (actualLimbsArr.length === 0) actualLimbsArr.push(0);

            let finalCoeffStr = "";
            if (actualLimbsArr.length > 0) {
                finalCoeffStr = String(actualLimbsArr[actualLimbsArr.length - 1]);
                for (let i = actualLimbsArr.length - 2; i >= 0; i--) {
                    finalCoeffStr += String(actualLimbsArr[i]).padStart(BASE_LOG10, '0');
                }
            } else {
                finalCoeffStr = "0";
            }
            console.log(`[WebGL Add Debug] finalCoeffStr (MSL first): ${finalCoeffStr}`);

            const webGLResult = BigIntPrimitive.fromCoefficientString(finalCoeffStr, this.canvas, { forceCPU: true });
            webGLResult.sign = resultSign;
            webGLResult.exponent = retrievedCommonExponent;

            if (webGLResult.isZero()) {
                webGLResult.sign = 1;
                webGLResult.exponent = 0;
            }
            console.log(`[WebGL Add Debug] webGLResult.toString(): ${webGLResult.toString()}`);
            console.log(`[WebGL Add Debug] webGLResult details: limbs=[${webGLResult.limbs.join(',')}], exp=${webGLResult.exponent}, sign=${webGLResult.sign}`);

            glCtx.deleteTexture(texOutputFromData); // Use glCtx
            glCtx.deleteFramebuffer(fbOutputFromData); // Use glCtx
            delete this._webglTempData;

            webglSuccess = true; // Mark that WebGL path completed fully and processed result
            return webGLResult;

          } catch (e) {
            console.error("WebGL add path error:", e);
            webglSuccess = false; // Fallback to CPU
            // More robust cleanup in case of error during WebGL phase
            if (gl && this._webglTempData) { // Check gl as well
                const errGL = this._webglTempData.glContext || gl; // Prefer glContext if available
                if (this._webglTempData.texOutput) errGL.deleteTexture(this._webglTempData.texOutput);
                if (this._webglTempData.fbOutput) errGL.deleteFramebuffer(this._webglTempData.fbOutput);
                // positionBuffer and texCoordBuffer are cleaned up earlier or should be here if error was before their cleanup
                // if (positionBuffer) errGL.deleteBuffer(positionBuffer); // Already deleted in success path
                // if (texCoordBuffer) errGL.deleteBuffer(texCoordBuffer); // Already deleted in success path
            }
            if (this._webglTempData) delete this._webglTempData; // Clear temp data
          }
        }
      } else { // gl init failed or float textures not supported
         // webglSuccess remains false
      }
    } // End of WebGL attempt block

    // If WebGL was not attempted, or it was attempted but not successfully processed:
    if (!webglSuccess) {
      const result = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU || otherBigInt.forceCPU });
      if (this.sign === otherBigInt.sign) {
        const commonExponent = Math.min(this.exponent, otherBigInt.exponent);
        let thisCoeffStr = (this.limbs.length === 0) ? "0" : this.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('');
        let otherCoeffStr = (otherBigInt.limbs.length === 0) ? "0" : otherBigInt.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('');
        thisCoeffStr += '0'.repeat(Math.max(0, this.exponent - commonExponent));
        otherCoeffStr += '0'.repeat(Math.max(0, otherBigInt.exponent - commonExponent));
        const limbsA = [];
        let currentPosA = thisCoeffStr.length;
        while (currentPosA > 0) { const startA = Math.max(0, currentPosA - BASE_LOG10); limbsA.unshift(parseInt(thisCoeffStr.substring(startA, currentPosA), 10)); currentPosA = startA; }
        if (limbsA.length === 0) limbsA.push(0);
        const limbsB = [];
        let currentPosB = otherCoeffStr.length;
        while (currentPosB > 0) { const startB = Math.max(0, currentPosB - BASE_LOG10); limbsB.unshift(parseInt(otherCoeffStr.substring(startB, currentPosB), 10)); currentPosB = startB; }
        if (limbsB.length === 0) limbsB.push(0);
        const tempThisMinimal = { limbs: limbsA, isZero: function() { return this.limbs.length === 1 && this.limbs[0] === 0; } };
        const tempOtherMinimal = { limbs: limbsB, isZero: function() { return this.limbs.length === 1 && this.limbs[0] === 0; } };
        const sumMagnitudeResult = this._core_add.call(tempThisMinimal, tempOtherMinimal);
        result.limbs = sumMagnitudeResult.limbs;
        result.exponent = commonExponent;
        result.sign = this.sign;
      } else {
        return this.subtract(otherBigInt.negate());
      }

      if (result.isZero()) { result.sign = 1; result.exponent = 0; }
      else {
        while (result.limbs.length > 1 && result.limbs[result.limbs.length - 1] === 0) {
          result.limbs.pop();
          result.exponent += BASE_LOG10;
        }
      }
      return result;
    }
    // Fallback, should ideally not be reached if all paths return.
    // To satisfy linters/compilers that demand a return statement outside the if/else.
    // This indicates a logical flaw if ever executed.
    throw new Error("add method did not return a result through WebGL or CPU paths.");
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

    if (this.sign !== otherBigInt.sign) {
      // a - (-b)  === a + b
      // -a - b    === -(a + b)
      const termToAdd = new BigIntPrimitive(otherBigInt, this.canvas, { forceCPU: otherBigInt.forceCPU });
      termToAdd.sign = -termToAdd.sign; // effectively otherBigInt.negate()
      return this.add(termToAdd); // Delegate to add, which has its own WebGL/CPU paths
    }

    // Signs are the same.
    let webglSuccess = false;
    // let webglAttempted = false; // Keep this if you want to log if WebGL was skipped due to flags/canvas

    if (!this.forceCPU && !otherBigInt.forceCPU && this.canvas && typeof webglUtilsModule !== 'undefined') {
      // webglAttempted = true;
      let gl = null;
      try {
        gl = webglUtilsModule.initWebGL(this.canvas);
        if (!gl || !gl.getExtension('OES_texture_float')) {
          throw new Error("WebGL not supported or float textures not available for subtraction path.");
        }

        const commonExponent = Math.min(this.exponent, otherBigInt.exponent);
        let thisCoeffStr = this.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('');
        let otherCoeffStr = otherBigInt.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('');

        thisCoeffStr += '0'.repeat(Math.max(0, this.exponent - commonExponent));
        otherCoeffStr += '0'.repeat(Math.max(0, otherBigInt.exponent - commonExponent));

        let minuendStr, subtrahendStr, resultSign;
        let comparison = 0;

        if (thisCoeffStr.length > otherCoeffStr.length) comparison = 1;
        else if (thisCoeffStr.length < otherCoeffStr.length) comparison = -1;
        else {
            if (thisCoeffStr > otherCoeffStr) comparison = 1;
            else if (thisCoeffStr < otherCoeffStr) comparison = -1;
        }

        if (comparison === 0) {
            const zeroResult = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
            return zeroResult; // Already normalized (sign 1, exp 0) by constructor for "0"
        }

        if (comparison > 0) {
            minuendStr = thisCoeffStr;
            subtrahendStr = otherCoeffStr;
            resultSign = this.sign;
        } else {
            minuendStr = otherCoeffStr;
            subtrahendStr = thisCoeffStr;
            resultSign = -this.sign;
        }

        const minuendScaledLimbsCount = Math.ceil(minuendStr.length / BASE_LOG10) || 1;
        const subtrahendScaledLimbsCount = Math.ceil(subtrahendStr.length / BASE_LOG10) || 1;
        const texWidth = Math.max(minuendScaledLimbsCount, subtrahendScaledLimbsCount);

        const minuendLimbsLSLPadded = BigIntPrimitive._coeffStrToPaddedLimbs(minuendStr, texWidth, BASE_LOG10);
        const subtrahendLimbsLSLPadded = BigIntPrimitive._coeffStrToPaddedLimbs(subtrahendStr, texWidth, BASE_LOG10);

        const actualLimbsLSL = this._webgl_subtract(minuendLimbsLSLPadded, subtrahendLimbsLSLPadded, texWidth);

        let finalCoeffStr = "";
        if (actualLimbsLSL.length === 0 || (actualLimbsLSL.length === 1 && actualLimbsLSL[0] === 0)) {
            finalCoeffStr = "0";
        } else {
            let tempFinalLimbs = [...actualLimbsLSL].reverse();
            while (tempFinalLimbs.length > 1 && tempFinalLimbs[0] === 0) { tempFinalLimbs.shift(); }
            finalCoeffStr = String(tempFinalLimbs[0]);
            for (let i = 1; i < tempFinalLimbs.length; i++) {
                finalCoeffStr += String(tempFinalLimbs[i]).padStart(BASE_LOG10, '0');
            }
        }

        const webGLResult = BigIntPrimitive.fromCoefficientString(finalCoeffStr, this.canvas, { forceCPU: true });
        webGLResult.sign = resultSign;
        webGLResult.exponent = commonExponent;

        if (webGLResult.isZero()) { // Normalize zero
            webGLResult.sign = 1;
            webGLResult.exponent = 0;
        }

        console.log(`[WebGL Subtract Path] Result: ${webGLResult.toString()}`);
        webglSuccess = true;
        return webGLResult;

      } catch (e) {
        console.error("WebGL subtract path error:", e);
        // webglSuccess remains false, will fall through to CPU
      }
    }

    // CPU Path (if WebGL not attempted, failed, or if signs differed initially handled by add)
    const result = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU || otherBigInt.forceCPU });
    // This is the original CPU path logic for same signs:
    const commonExponentCPU = Math.min(this.exponent, otherBigInt.exponent);
    let thisCoeffStrCPU = (this.limbs.length === 0) ? "0" : this.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('');
    let otherCoeffStrCPU = (otherBigInt.limbs.length === 0) ? "0" : otherBigInt.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('');
    thisCoeffStrCPU += '0'.repeat(Math.max(0, this.exponent - commonExponentCPU));
    otherCoeffStrCPU += '0'.repeat(Math.max(0, otherBigInt.exponent - commonExponentCPU));

    const limbsThisScaledCPU = [];
    let currentPosThisCPU = thisCoeffStrCPU.length;
    while (currentPosThisCPU > 0) { const startThis = Math.max(0, currentPosThisCPU - BASE_LOG10); limbsThisScaledCPU.unshift(parseInt(thisCoeffStrCPU.substring(startThis, currentPosThisCPU), 10)); currentPosThisCPU = startThis; }
    if (limbsThisScaledCPU.length === 0) limbsThisScaledCPU.push(0);

    const limbsOtherScaledCPU = [];
    let currentPosOtherCPU = otherCoeffStrCPU.length;
    while (currentPosOtherCPU > 0) { const startOther = Math.max(0, currentPosOtherCPU - BASE_LOG10); limbsOtherScaledCPU.unshift(parseInt(otherCoeffStrCPU.substring(startOther, currentPosOtherCPU), 10)); currentPosOtherCPU = startOther; }
    if (limbsOtherScaledCPU.length === 0) limbsOtherScaledCPU.push(0);

    let comparisonCPU = 0;
    if (limbsThisScaledCPU.length > limbsOtherScaledCPU.length) comparisonCPU = 1;
    else if (limbsThisScaledCPU.length < limbsOtherScaledCPU.length) comparisonCPU = -1;
    else { for(let i=0; i < limbsThisScaledCPU.length; i++) { if(limbsThisScaledCPU[i] > limbsOtherScaledCPU[i]) { comparisonCPU = 1; break; } if(limbsThisScaledCPU[i] < limbsOtherScaledCPU[i]) { comparisonCPU = -1; break; } } }

    if (comparisonCPU === 0) { result.limbs = [0]; result.exponent = 0; result.sign = 1; return result; }

    let minuendLimbsCPU, subtrahendLimbsCPU;
    if (comparisonCPU > 0) { minuendLimbsCPU = limbsThisScaledCPU; subtrahendLimbsCPU = limbsOtherScaledCPU; result.sign = this.sign; }
    else { minuendLimbsCPU = limbsOtherScaledCPU; subtrahendLimbsCPU = limbsThisScaledCPU; result.sign = -this.sign; }

    const tempMinuendMinimalCPU = { limbs: minuendLimbsCPU, isZero: function() { return this.limbs.length === 1 && this.limbs[0] === 0; } };
    const tempSubtrahendMinimalCPU = { limbs: subtrahendLimbsCPU, isZero: function() { return this.limbs.length === 1 && this.limbs[0] === 0; } };

    const coreResultCPU = this._core_subtract.call(tempMinuendMinimalCPU, tempSubtrahendMinimalCPU);
    result.limbs = coreResultCPU.limbs;
    result.exponent = commonExponentCPU;

    if (result.isZero()) { result.sign = 1; result.exponent = 0; }
    else { while (result.limbs.length > 1 && result.limbs[result.limbs.length - 1] === 0) { result.limbs.pop(); result.exponent += BASE_LOG10; } }
    return result;
  }

  _webgl_subtract(minuendLimbsLSLPadded, subtrahendLimbsLSLPadded, texWidth) {
    let gl;
    let program, texMinuend, texSubtrahend, texBorrowIn, texOutput, fbOutput, positionBuffer, texCoordBuffer;

    try {
        gl = webglUtilsModule.initWebGL(this.canvas);
        if (!gl || !gl.getExtension('OES_texture_float')) {
            throw new Error("WebGL not supported or float textures not available for subtraction.");
        }
        while (gl.getError() !== gl.NO_ERROR) {} // Clear any lingering errors

        console.log(`[WebGL Subtract Debug] Entry: texWidth=${texWidth}`);
        console.log(`[WebGL Subtract Debug] Minuend (LSL, padded): [${Array.from(minuendLimbsLSLPadded).join(', ')}]`);
        console.log(`[WebGL Subtract Debug] Subtrahend (LSL, padded): [${Array.from(subtrahendLimbsLSLPadded).join(', ')}]`);

        if (typeof subtractVertexShaderSrc !== 'string' || typeof subtractFragmentShaderSrc !== 'string') {
            throw new Error('Subtract shader source not loaded');
        }
        const vs = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, subtractVertexShaderSrc);
        const fs = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, subtractFragmentShaderSrc);
        program = webglUtilsModule.createProgram(gl, vs, fs);
        if (!program) throw new Error('WebGL program creation failed for subtraction.');
        gl.useProgram(program);

        texMinuend = webglUtilsModule.createDataTexture(gl, minuendLimbsLSLPadded, texWidth, 1, false);
        texSubtrahend = webglUtilsModule.createDataTexture(gl, subtrahendLimbsLSLPadded, texWidth, 1, false);
        // Initial borrow texture - all zeros. Shader expects borrow input per limb.
        texBorrowIn = webglUtilsModule.createDataTexture(gl, new Float32Array(texWidth).fill(0), texWidth, 1, false);
        texOutput = webglUtilsModule.createDataTexture(gl, null, texWidth, 1, true); // RGBA for resultLimb & borrowOut
        if (!texMinuend || !texSubtrahend || !texBorrowIn || !texOutput) throw new Error('WebGL texture creation failed for subtraction.');

        fbOutput = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error('WebGL framebuffer incomplete for subtraction.');
        }

        gl.viewport(0, 0, texWidth, 1);

        const uNum1Loc = gl.getUniformLocation(program, "u_num1Texture"); // Minuend
        const uNum2Loc = gl.getUniformLocation(program, "u_num2Texture"); // Subtrahend
        const uBorrowInLoc = gl.getUniformLocation(program, "u_borrowTexture");
        const uBaseLoc = gl.getUniformLocation(program, "u_base");
        const uTexWidthLoc = gl.getUniformLocation(program, "u_texWidth");
        if (!uNum1Loc || !uNum2Loc || !uBorrowInLoc || !uBaseLoc || !uTexWidthLoc ) {
             throw new Error("Failed to get essential uniform locations for subtraction shader.");
        }

        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texMinuend); gl.uniform1i(uNum1Loc, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texSubtrahend); gl.uniform1i(uNum2Loc, 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texBorrowIn); gl.uniform1i(uBorrowInLoc, 2);
        gl.uniform1f(uBaseLoc, BASE);
        gl.uniform1f(uTexWidthLoc, texWidth);

        positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
        const posAttrLoc = gl.getAttribLocation(program, "a_position");
        if (posAttrLoc === -1) throw new Error("a_position attribute not found in subtraction shader.");
        gl.enableVertexAttribArray(posAttrLoc);
        gl.vertexAttribPointer(posAttrLoc, 2, gl.FLOAT, false, 0, 0);

        texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);
        const texCoordAttrLoc = gl.getAttribLocation(program, "a_texCoord");
        if (texCoordAttrLoc === -1) throw new Error("a_texCoord attribute not found in subtraction shader.");
        gl.enableVertexAttribArray(texCoordAttrLoc);
        gl.vertexAttribPointer(texCoordAttrLoc, 2, gl.FLOAT, false, 0, 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput);
        gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput); // Ensure bound for reading
        const outputDataRGBA = webglUtilsModule.readDataFromTexture(gl, fbOutput, texWidth, 1, false);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        console.log(`[WebGL Subtract Debug] Raw output from GPU (RGBA, len ${outputDataRGBA.length}): [${Array.from(outputDataRGBA).join(', ')}]`);

        const gpuResultLimbs = new Float32Array(texWidth);
        const gpuShaderBorrows = new Float32Array(texWidth); // Borrows generated by shader for each limb op
        for (let i = 0; i < texWidth; i++) {
            gpuResultLimbs[i] = outputDataRGBA[i * 4 + 0];   // .r component (limb result from shader)
            gpuShaderBorrows[i] = outputDataRGBA[i * 4 + 1]; // .g component (borrow_out from shader)
        }
        console.log(`[WebGL Subtract Debug] GPU Result Limbs (from .r): [${Array.from(gpuResultLimbs).join(', ')}]`);
        console.log(`[WebGL Subtract Debug] GPU Shader Borrows (from .g): [${Array.from(gpuShaderBorrows).join(', ')}]`);

        // CPU Post-Processing for borrow propagation
        const actualLimbsArrLSL = []; // LSL first
        let currentPropagatedBorrow = 0;
        for (let i = 0; i < texWidth; i++) {
            let diff = gpuResultLimbs[i] - currentPropagatedBorrow;
            if (diff < 0) {
                actualLimbsArrLSL.push(diff + BASE);
                currentPropagatedBorrow = 1; // This borrow needs to be covered by the next higher limb
            } else {
                actualLimbsArrLSL.push(diff);
                currentPropagatedBorrow = 0;
            }
            // Add borrow from shader output for this position (already handled by shader for its calculation)
            // This shader_borrow is what the *next* GPU stage would take as input if it were pipelined.
            // Here, it informs if the current GPU limb op itself needed to borrow.
            // The currentPropagatedBorrow is the crucial one for CPU sequential propagation.
            currentPropagatedBorrow += gpuShaderBorrows[i]; // If shader said it borrowed, this must be propagated
            currentPropagatedBorrow = Math.min(currentPropagatedBorrow, 1); // Cap borrow at 1 (cannot borrow more than 1 from next limb)
        }

        console.log(`[WebGL Subtract Debug] Actual Limbs (LSL first, after CPU borrow propagation): [${actualLimbsArrLSL.join(', ')}]`);
        if (currentPropagatedBorrow > 0) {
            // This signifies that the overall subtraction resulted in a negative number,
            // which means minuendForShader was smaller than subtrahendForShader.
            // The calling `subtract` method should have ensured minuend >= subtrahend for this raw WebGL call.
            console.warn(`[WebGL Subtract Debug] Final propagated borrow is ${currentPropagatedBorrow}. This might indicate minuend < subtrahend passed to _webgl_subtract.`);
            // Depending on strategy, could throw error or return with this state.
            // For now, returning the limbs as calculated; the caller might need to handle this.
        }

        // Normalize result: remove trailing zero limbs (which are leading in LSL)
        while (actualLimbsArrLSL.length > 1 && actualLimbsArrLSL[actualLimbsArrLSL.length - 1] === 0) {
            actualLimbsArrLSL.pop();
        }
        if (actualLimbsArrLSL.length === 0) actualLimbsArrLSL.push(0);


        return actualLimbsArrLSL; // LSL first

    } catch (e) {
        console.error("[WebGL Subtract Debug] WebGL execution error in _webgl_subtract:", e.message, e.stack);
        throw e; // Re-throw to be caught by the main subtract method's try-catch
    } finally {
        if (gl) {
            if (program) gl.deleteProgram(program);
            if (texMinuend) gl.deleteTexture(texMinuend);
            if (texSubtrahend) gl.deleteTexture(texSubtrahend);
            if (texBorrowIn) gl.deleteTexture(texBorrowIn);
            if (texOutput) gl.deleteTexture(texOutput);
            if (fbOutput) gl.deleteFramebuffer(fbOutput);
            if (positionBuffer) gl.deleteBuffer(positionBuffer);
            if (texCoordBuffer) gl.deleteBuffer(texCoordBuffer);
             // Shaders are deleted by createProgram on success. If createProgram fails, they might linger.
        }
        console.log("[WebGL Subtract Debug] WebGL resources cleaned up (if initialized).");
    }
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

    if (exp < 0) {
      const one = new BigIntPrimitive("1", this.canvas, { forceCPU: this.forceCPU });
      const positivePowerResult = this.pow(Math.abs(exp));
      // The precision of 1 / x^n will depend on the current BigIntPrimitive.DP setting,
      // as it's used by the .divide() method.
      return one.divide(positivePowerResult);
    }

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

    quotient = quotient.round(BigIntPrimitive.DP, BigIntPrimitive.RM);

    // If rounding was performed to a specific number of decimal places (BigIntPrimitive.DP),
    // and the result of the division is zero, then the quotient should retain
    // this DP information for toString() formatting (e.g., to get "0.00").
    // For non-zero results, toString() should produce the most compact representation
    // based on the calculated value, not necessarily padded to BigIntPrimitive.DP.
    if (quotient.isZero() && typeof BigIntPrimitive.DP === 'number' && BigIntPrimitive.DP > 0) {
      quotient._roundedDp = BigIntPrimitive.DP;
    }

    if (quotient.isZero()) {
      // Ensure sign is positive and exponent is 0 for zero, unless _roundedDp handles it.
      // If _roundedDp is set (e.g. for "0.00"), toString() will handle the sign.
      if (typeof quotient._roundedDp !== 'number' || quotient._roundedDp === 0) {
         quotient.sign = 1;
      }
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

  round(dpUndefined, rmUndefined) {
    console.log(`[round ENTRY ID: ${this._instanceId}] dp: ${dpUndefined}, rm: ${rmUndefined}, current this._roundedDp: ${this._roundedDp}`);
    let dp = dpUndefined;
    let rmResolved = rmUndefined;

    if (dp === undefined) dp = 0;
    else if (typeof dp !== 'number' || !Number.isInteger(dp) || dp < 0) {
        throw new RangeError("Decimal places NaN or negative");
    }

    if (rmResolved === undefined) rmResolved = this.constructor.RM;
    if (rmResolved !== 0 && rmResolved !== 1 && rmResolved !== 2 && rmResolved !== 3) {
        throw new RangeError("Invalid rounding mode");
    }
    const roundingMode = rmResolved;

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

    result.exponent = -dp;

    if (result.isZero()) {
        result.exponent = 0;
        if (this.sign === -1 && dp === 0 && newCoeffStr === "0") {
             result.sign = -1;
        } else {
             result.sign = 1;
        }
    }

    // result._roundedDp = dp;
    const rdp = result._roundedDp; // This will now be undefined if it wasn't set before round
    const rexp = result.exponent;
    const rId = result._instanceId;
    console.log(`[round EXIT ID: ${this._instanceId}] ret ID: ${rId}, ret._roundedDp: ${rdp}, ret.exp: ${rexp}`);
    return result;
  }

  toExponential(dpUndefined, rmUndefined) {
    // console.log(`[toExponential ENTRY ID: ${this._instanceId}] dp: ${dpUndefined}, rm: ${rmUndefined}, current _roundedDp: ${this._roundedDp}`);
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
    console.log(`[toFixed ENTRY ID: ${this._instanceId}] dp: ${dpUndefined}, rm: ${rmUndefined}, current this._roundedDp: ${this._roundedDp}, this_value: ${this.toString()}`);
    const actualRm = (rmUndefined === undefined ? BigIntPrimitive.RM : rmUndefined);
    let dp = dpUndefined;

    if (dp === undefined) { // This is for toFixed() without arguments, like big.js
        const oldPE = BigIntPrimitive.PE; BigIntPrimitive.PE = 1e9;
        const oldNE = BigIntPrimitive.NE; BigIntPrimitive.NE = -1e9;
        const originalRoundedDp = this._roundedDp;
        delete this._roundedDp; // Force natural toString
        const str = this.toString();
        this._roundedDp = originalRoundedDp; // Restore
        BigIntPrimitive.PE = oldPE; BigIntPrimitive.NE = oldNE;
        return str;
    }

    if (typeof dp !== 'number' || !Number.isInteger(dp) || dp < 0 || dp > 1e6 ) { // Max dp from big.js
        throw new RangeError("Invalid decimal places");
    }

    const oldPE = BigIntPrimitive.PE; BigIntPrimitive.PE = 1e9;
    const oldNE = BigIntPrimitive.NE; BigIntPrimitive.NE = -1e9;

    const roundedNum = this.round(dp, actualRm);
    // Simplified log:
    console.log(`[toFixed after round ID: ${this._instanceId}] roundedNum ID: ${roundedNum._instanceId}, roundedNum._roundedDp: ${roundedNum._roundedDp}`);

    BigIntPrimitive.PE = oldPE; BigIntPrimitive.NE = oldNE;

    // After rounding, roundedNum has the correct numerical value.
    // We need to ensure its string representation is formatted to 'dp' decimal places.
    // So, set _roundedDp on the roundedNum BEFORE calling toString() on it.
    roundedNum._roundedDp = dp;

    const s = roundedNum.toString();
    // The toString() call above will have its own [toString ENTRY] log.
    console.log(`[toFixed EXIT ID: ${this._instanceId}] final string: ${s}, from roundedNum ID: ${roundedNum._instanceId} which had _roundedDp: ${roundedNum._roundedDp}`);
    return s;
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

  prec(sdUndefined, rmUndefined) {
    // console.log(`[prec ENTRY ID: ${this._instanceId}] sd: ${sdUndefined}, rm: ${rmUndefined}, current _roundedDp: ${this._roundedDp}`);
    const Ctor = this.constructor;
    let actualRm;
    let sd = sdUndefined;

    if (sd === undefined || sd === null || typeof sd !== 'number' || !Number.isInteger(sd) || sd < 1) {
      throw new RangeError('[big.js] Significant digits NaN or less than 1');
    }

    if (rmUndefined === undefined) {
      actualRm = Ctor.RM;
    } else if (typeof rmUndefined !== 'number' || !Number.isInteger(rmUndefined) || rmUndefined < 0 || rmUndefined > 3) {
      throw new RangeError('[big.js] Rounding mode NaN or invalid');
    } else {
      actualRm = rmUndefined;
    }

    if (this.isZero()) {
      const zeroResult = new Ctor("0", this.canvas, { forceCPU: this.forceCPU });
      // For "0.prec(3)" -> "0.00"
      // toExponential(sd-1) for 0 is "0.00e+0" if sd=3
      // Parsing "0.00e+0" gives a BigIntPrimitive(0)
      // We need to set _roundedDp for toString to format it like "0.00"
      // Number of digits after decimal point is sd - 1 (for significand like d.fff)
      // If sd=1, 0 dp. If sd=3, 2 dp.
      // This is for the *value* 0.
      // big.js: new Big(0).prec(3).toString() is "0.00"
      // My toExponential(2) for 0 is "0.00e+0". new Ctor("0.00e+0") is BigInt(0).
      // Its toString will be "0".
      // The _roundedDp needs to be sd - 1 for the *output string format*.
      zeroResult._roundedDp = sd -1;
      return zeroResult;
    }

    // Use toExponential to round to sd significant digits.
    // dp for toExponential is sd - 1.
    const exponentialString = this.toExponential(sd - 1, actualRm);

    // Create a new instance from this string.
    // The new instance will have its value correctly rounded.
    const resultInstance = new Ctor(exponentialString, this.canvas, { forceCPU: this.forceCPU });

    // For zeroResult, _roundedDp was already set to sd - 1. This is specific for "0.00" like output.
    // For non-zero, do not set _roundedDp by default from prec.
    // toPrecision will call toFixed or toExponential on this resultInstance,
    // and those methods will set _roundedDp appropriately for their specific formatting needs.
    // The resultInstance itself is numerically correct to 'sd' significant digits.
    return resultInstance;
  }

  toPrecision(sdUndefined, rmUndefined) {
    console.log(`[toPrecision ENTRY ${this._instanceId}] this._roundedDp: ${this._roundedDp}, sd: ${sdUndefined}`);
    const Ctor = this.constructor;
    let actualRm;
    let sd = sdUndefined;

    if (sd === undefined || sd === null) {
      throw new TypeError('[big.js] Argument undefined');
    }
    if (typeof sd !== 'number' || !Number.isInteger(sd) || sd < 1 || sd > 1E6) {
      throw new RangeError('[big.js] Significant digits NaN or out of range');
    }

    if (rmUndefined === undefined) {
      actualRm = Ctor.RM;
    } else if (typeof rmUndefined !== 'number' || !Number.isInteger(rmUndefined) || rmUndefined < 0 || rmUndefined > 3) {
      throw new RangeError('[big.js] Rounding mode NaN or invalid');
    } else {
      actualRm = rmUndefined;
    }

    let str;
    if (this.isZero()) {
      str = "0";
      if (sd > 1) str += "." + "0".repeat(sd - 1);
      let returnValue = str;
      console.log(`[toPrecision RETURNING ZEROVAL ID: ${this._instanceId}] final string: '${returnValue}', type: ${typeof returnValue}`); // Clarified log
      return returnValue;
    }

    const roundedNum = this.prec(sd, actualRm);

    // ADD LOG HERE:
    console.log(`[toPrecision PRE-SCI-CALC ID: ${this._instanceId}] roundedNum ID: ${roundedNum._instanceId}, roundedNum.exponent: ${roundedNum.exponent}, roundedNum._roundedDp: ${roundedNum._roundedDp}`);

    // If rounding to 0 (e.g. new Big("0.00000000001").toPrecision(1) )
    if (roundedNum.isZero()) {
        str = "0";
        if (sd > 1) str += "." + "0".repeat(sd - 1);
        let returnValue = str;
        console.log(`[toPrecision RETURNING ROUNDEDZEROVAL ID: ${this._instanceId}] final string: '${returnValue}', type: ${typeof returnValue}`); // Clarified log
        return returnValue;
    }

    // Determine scientific exponent of roundedNum
    console.log(`[toPrecision PRE-COEFF-STR-CALC ID: ${this._instanceId}] For roundedNum (ID: ${roundedNum._instanceId}), roundedNum.limbs: ${JSON.stringify(roundedNum.limbs)}, BASE_LOG10 (module const): ${BASE_LOG10}`);
    const roundedNumCoeffStr = roundedNum.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('');
    const roundedNumCurrentExponent = roundedNum.exponent;
    console.log(`[toPrecision SCI-CALC INPUTS ID: ${this._instanceId}] roundedNumId: ${roundedNum._instanceId}, roundedNumCoeffStr: '${roundedNumCoeffStr}', roundedNumCoeffStr.length: ${roundedNumCoeffStr.length}, roundedNumCurrentExponent: ${roundedNumCurrentExponent}`);
    const sciExp = (roundedNumCoeffStr.length - 1) + roundedNumCurrentExponent; // Power of 10 for the first digit of coeffStr

    console.log(`[toPrecision DEBUG ID: ${this._instanceId}] sd: ${sd}, sciExp_calculated_from_roundedNum: ${sciExp}, Ctor.NE: ${Ctor.NE}, Ctor.PE: ${Ctor.PE}`);

    const useExponential = sciExp <= Ctor.NE || sciExp >= sd;

    if (useExponential) {
      let expStr = roundedNum.toExponential(sd - 1, actualRm);
      const valToReturnExp = expStr;
      console.log(`[toPrecision RETURNING EXPONENTIAL ID: ${this._instanceId}] final string: '${valToReturnExp}', type: ${typeof valToReturnExp}`);
      return valToReturnExp;
    } else {
      console.log(`[toPrecision DEBUG FIXEDPATH ID: ${this._instanceId}] sd: ${sd}, Using sciExp_calculated_from_roundedNum: ${sciExp}`);
      const dpForFixed = Math.max(0, sd - (sciExp + 1));
      console.log(`[toPrecision ID: ${this._instanceId}] calling toFixed(${dpForFixed}) on roundedNum (ID: ${roundedNum._instanceId}, _roundedDp: ${roundedNum._roundedDp})`);
      let fixedStr = roundedNum.toFixed(dpForFixed, actualRm);
      const valToReturnFixed = fixedStr;
      console.log(`[toPrecision RETURNING FIXED ID: ${this._instanceId}] final string: '${valToReturnFixed}', type: ${typeof valToReturnFixed}`);
      return valToReturnFixed;
    }
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

BigIntPrimitive.prototype._webgl_multiply_one_limb_by_bigint = function(limbValue, otherBigInt) {
    if (limbValue === 0 || otherBigInt.isZero()) {
        return new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    }

    let gl;
    let program, texOtherNumber, texOutput, fbOutput, positionBuffer, texCoordBuffer; // For cleanup

    try {
        gl = webglUtilsModule.initWebGL(this.canvas);
        if (!gl || !gl.getExtension('OES_texture_float')) {
            throw new Error("WebGL not supported or float textures not available.");
        }

        // Attempt to clear any lingering GL errors from previous operations/tests
        while (gl.getError() !== gl.NO_ERROR) {
            // Keep calling gl.getError until it returns NO_ERROR
        }

        const otherLimbs = [...otherBigInt.limbs].reverse(); // LSL first
        const texWidth = otherLimbs.length + 3; // +3 for potential carries and safety margin

        const otherLimbsF32 = new Float32Array(texWidth);
        for (let i = 0; i < otherLimbs.length; i++) {
            otherLimbsF32[i] = otherLimbs[i];
        }
        // The rest of otherLimbsF32 is already 0.0 due to Float32Array initialization.

        console.log(`[WebGL MultLimb Debug] Entry: limbValueToMultiply=${limbValue}, otherNumber=${otherBigInt.toString()}`);
        console.log(`[WebGL MultLimb Debug Step 1] Prepared otherLimbsF32 (LSL first, len ${texWidth}): [${Array.from(otherLimbsF32).join(', ')}]`);


        if (typeof multiplyLimbVertexShaderSrc !== 'string' || typeof multiplyLimbFragmentShaderSrc !== 'string') {
            throw new Error('Multiply limb shader source not loaded');
        }
        const vs = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, multiplyLimbVertexShaderSrc);
        const fs = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, multiplyLimbFragmentShaderSrc);

        // Extra logging for shader/program compilation
        if (vs) console.log("[WebGL MultLimb Debug] Vertex shader compiled. Info: " + gl.getShaderInfoLog(vs)); else console.error("[WebGL MultLimb Debug] Vertex shader FAILED compilation.");
        if (fs) console.log("[WebGL MultLimb Debug] Fragment shader compiled. Info: " + gl.getShaderInfoLog(fs)); else console.error("[WebGL MultLimb Debug] Fragment shader FAILED compilation.");

        program = webglUtilsModule.createProgram(gl, vs, fs);
        if (!program) {
            throw new Error('WebGL program creation failed for multiply limb.');
        } else {
            console.log("[WebGL MultLimb Debug] Program linked. Info: " + gl.getProgramInfoLog(program));
        }

        gl.useProgram(program); // Use program early for uniform locations

        texOtherNumber = webglUtilsModule.createDataTexture(gl, otherLimbsF32, texWidth, 1, false); // Input texture for otherBigInt.limbs (LSL first)
        texOutput = webglUtilsModule.createDataTexture(gl, null, texWidth, 1, true);      // RGBA for (limbProduct, carryOut)
        if (!texOtherNumber || !texOutput) throw new Error('WebGL texture creation failed for multiply limb.');
        console.log("[WebGL MultLimb Debug Step 2] Textures created.");

        fbOutput = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error('WebGL framebuffer incomplete for multiply limb.');
        }
        console.log("[WebGL MultLimb Debug Step 3] Framebuffer configured.");

        gl.viewport(0, 0, texWidth, 1);

        // Uniforms
        const uOtherNumberTexLoc = gl.getUniformLocation(program, "u_otherNumTexture"); // Corrected to match shader
        const uLimbValueLoc = gl.getUniformLocation(program, "u_limbValue");
        const uBaseLoc = gl.getUniformLocation(program, "u_base");
        const uTexWidthLoc = gl.getUniformLocation(program, "u_texWidth"); // This might be null if not used in shader

        // Log locations before checking them, so we see what was retrieved.
        console.log(`[WebGL MultLimb Debug Step 3] Locations: uOtherNumberTexLoc=${uOtherNumberTexLoc}, uLimbValueLoc=${uLimbValueLoc}, uBaseLoc=${uBaseLoc}, uTexWidthLoc=${uTexWidthLoc}`);

        // Restore uniform checks and setting for the calculating shader.
        // uTexWidthLoc is not used by multiply_limb.frag, so it can be null.
        if (!uOtherNumberTexLoc || !uLimbValueLoc || !uBaseLoc ) {
             throw new Error("Failed to get essential uniform locations for multiply limb shader (otherNum, limbVal, base).");
        }

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texOtherNumber);
        gl.uniform1i(uOtherNumberTexLoc, 0);

        gl.uniform1f(uLimbValueLoc, limbValue);
        gl.uniform1f(uBaseLoc, BASE);

        if (uTexWidthLoc) {
            gl.uniform1f(uTexWidthLoc, texWidth);
        }
        console.log("[WebGL MultLimb Debug Step 4] Uniforms set.");

        // Attributes
        positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
        const positionAttribLoc = gl.getAttribLocation(program, "a_position");
        if (positionAttribLoc === -1) throw new Error("a_position attribute not found in multiply limb shader.");
        gl.enableVertexAttribArray(positionAttribLoc);
        gl.vertexAttribPointer(positionAttribLoc, 2, gl.FLOAT, false, 0, 0);

        texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
        const texCoordAttribLoc = gl.getAttribLocation(program, "a_texCoord");
        if (texCoordAttribLoc === -1) throw new Error("a_texCoord attribute not found in multiply limb shader.");
        gl.enableVertexAttribArray(texCoordAttribLoc);
        gl.vertexAttribPointer(texCoordAttribLoc, 2, gl.FLOAT, false, 0, 0);
        console.log("[WebGL MultLimb Debug Step 5] Attributes configured.");

        // Execute shader
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput); // Ensure correct framebuffer is bound
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        // DO NOT unbind framebuffer here, readDataFromTexture needs it bound for reading.
        console.log("[WebGL MultLimb Debug Step 6] Shader executed.");

        // Read back data
        // texOutput was created with isOutputOrRgba32f = true, so read should match this.
        // Pass false for extractSingleComponent to get full RGBA data.
        // Ensure fbOutput is bound before reading
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput);
        console.log(`[WebGL MultLimb Debug PRE-READ] Reading from texture with texWidth: ${texWidth}`);
        const outputDataRGBA = webglUtilsModule.readDataFromTexture(gl, fbOutput, texWidth, 1, false);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Unbind after reading
        console.log(`[WebGL MultLimb Debug Step 7] Raw output from GPU (RGBA, len ${outputDataRGBA.length}): [${Array.from(outputDataRGBA).join(', ')}]`);

        // CPU-side post-processing
        const gpuLimbProducts = new Float32Array(texWidth);
        const gpuShaderCarries = new Float32Array(texWidth);
        for (let i = 0; i < texWidth; i++) {
            if ((i * 4 + 1) < outputDataRGBA.length) { // Ensure we can read both R and G components
                gpuLimbProducts[i] = outputDataRGBA[i * 4 + 0]; // .r
                gpuShaderCarries[i] = outputDataRGBA[i * 4 + 1]; // .g
            } else {
                gpuLimbProducts[i] = 0; // Default to 0 if data is unexpectedly short
                gpuShaderCarries[i] = 0;
                console.warn(`[WebGL MultLimb Debug] outputDataRGBA seems too short. Index ${i*4+1} out of length ${outputDataRGBA.length}. Using 0 for limb/carry.`);
            }
        }
        console.log(`[WebGL MultLimb Debug Step 8] GPU Limb Products (from .r): [${Array.from(gpuLimbProducts).join(', ')}]`);
        console.log(`[WebGL MultLimb Debug Step 9] GPU Shader Carries (from .g): [${Array.from(gpuShaderCarries).join(', ')}]`);

        const actualLimbsArrReversed = []; // LSL first
        let currentPropagatedCarry = 0;
        for (let i = 0; i < texWidth; i++) {
            // Check if gpuLimbProducts[i] or gpuShaderCarries[i] could be NaN due to earlier issues
            // (though the new check above should prevent it from undefined access)
            let limbProductVal = isNaN(gpuLimbProducts[i]) ? 0 : gpuLimbProducts[i];
            let shaderCarryVal = isNaN(gpuShaderCarries[i]) ? 0 : gpuShaderCarries[i];

            let sumForThisLimb = limbProductVal + currentPropagatedCarry;
            actualLimbsArrReversed.push(sumForThisLimb % BASE);
            currentPropagatedCarry = Math.floor(sumForThisLimb / BASE) + shaderCarryVal;
        }
        // If final carry remains, push it as a new limb
        while (currentPropagatedCarry > 0) {
            actualLimbsArrReversed.push(currentPropagatedCarry % BASE);
            currentPropagatedCarry = Math.floor(currentPropagatedCarry / BASE);
        }
        console.log(`[WebGL MultLimb Debug Step 10] Actual Limbs (LSL first, after CPU carry): [${actualLimbsArrReversed.join(', ')}]`);


        // Convert actualLimbsArr (which is LSL first) to MSL first for fromCoefficientString
        let finalCoeffStr = "";
        if (actualLimbsArrReversed.length === 0) {
            finalCoeffStr = "0";
        } else {
            let tempFinalLimbs = [...actualLimbsArrReversed].reverse(); // MSL first
            // Remove leading zeros from limbs array (e.g. if result is [0, 0, 123, 45])
            while (tempFinalLimbs.length > 1 && tempFinalLimbs[0] === 0) {
                tempFinalLimbs.shift();
            }
            finalCoeffStr = String(tempFinalLimbs[0]);
            for (let i = 1; i < tempFinalLimbs.length; i++) {
                finalCoeffStr += String(tempFinalLimbs[i]).padStart(BASE_LOG10, '0');
            }
        }
        console.log(`[WebGL MultLimb Debug Step 11] Final Coefficient String (MSL first): ${finalCoeffStr}`);

        const result = BigIntPrimitive.fromCoefficientString(finalCoeffStr, this.canvas, { forceCPU: true });
        result.sign = 1; // Result of limb multiplication is positive magnitude
        result.exponent = 0; // Dealing with coefficients, exponent is 0
        if(result.isZero()) result.exponent = 0;

        console.log(`[WebGL MultLimb Debug Step 12] WebGL Result: ${result.toString()}`);
        return result;

    } catch (e) {
        console.error("[WebGL MultLimb Debug] WebGL execution error in _webgl_multiply_one_limb_by_bigint:", e.message, e.stack);
        // Fallback to CPU
        return this._multiply_limb_by_bigint(limbValue, otherBigInt);
    } finally {
        if (gl) {
            if (program) gl.deleteProgram(program);
            if (texOtherNumber) gl.deleteTexture(texOtherNumber);
            if (texOutput) gl.deleteTexture(texOutput);
            if (fbOutput) gl.deleteFramebuffer(fbOutput);
            if (positionBuffer) gl.deleteBuffer(positionBuffer);
            if (texCoordBuffer) gl.deleteBuffer(texCoordBuffer);
            // Note: Shaders (vs, fs) are deleted by createProgram if linking is successful.
            // If createProgram fails, they might need explicit deletion, but typically not an issue here.
        }
        console.log("[WebGL MultLimb Debug] WebGL resources cleaned up (if initialized).");
    }
};

export { BigIntPrimitive };
