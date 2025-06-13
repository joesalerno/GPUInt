import * as webglUtilsModule from './webgl-utils.js';
import vertexShaderSrc from './shaders/addition.vert?raw';
import fragmentShaderSrc from './shaders/addition.frag?raw';
import subtractVertexShaderSrc from './shaders/subtraction.vert?raw';
import subtractFragmentShaderSrc from './shaders/subtraction.frag?raw';
import multiplyLimbVertexShaderSrc from './shaders/multiply_limb.vert?raw';
import multiplyLimbFragmentShaderSrc from './shaders/multiply_limb.frag?raw';

const KARATSUBA_THRESHOLD = 20;
const BASE_LOG10 = 1;
const BASE = 10; // Assuming BASE is 10 for limb-based operations

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
    const result = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU || otherBigInt.forceCPU });
    if (this.sign !== otherBigInt.sign) {
      const termToAdd = new BigIntPrimitive(otherBigInt, this.canvas, { forceCPU: otherBigInt.forceCPU });
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
    const tempMinuend = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    const tempSubtrahend = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
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

    const finalExponent = self.exponent + otherBigInt.exponent;
    const resultSign = (self.sign === otherBigInt.sign) ? 1 : -1;

    // Work with absolute values for magnitude calculation
    const selfAbs = self.abs();
    const otherAbs = otherBigInt.abs();

    // Create true coefficient representations for Karatsuba/core_multiply
    const num1_for_mag_calc = new BigIntPrimitive(selfAbs.limbs.join(''), self.canvas, {forceCPU: self.forceCPU || otherBigInt.forceCPU, isCoefficient: true});
    // num1_for_mag_calc.exponent = 0; // Constructor with isCoefficient should handle this

    const num2_for_mag_calc = new BigIntPrimitive(otherAbs.limbs.join(''), self.canvas, {forceCPU: self.forceCPU || otherBigInt.forceCPU, isCoefficient: true});
    // num2_for_mag_calc.exponent = 0; // Constructor with isCoefficient should handle this

    let absResultMagnitude;
    let gl; // For WebGL path, not currently implemented here but placeholder

    // Decision for Karatsuba vs. schoolbook (using num_for_mag_calc)
    if (! (self.forceCPU || otherBigInt.forceCPU) && false /* WebGL path disabled for now */ && self.canvas && typeof webglUtilsModule !== 'undefined' && (gl = webglUtilsModule.initWebGL(self.canvas))) {
       absResultMagnitude = self._core_multiply(num1_for_mag_calc, num2_for_mag_calc);

    } else { // CPU Path
       if (num1_for_mag_calc.limbs.length < KARATSUBA_THRESHOLD || num2_for_mag_calc.limbs.length < KARATSUBA_THRESHOLD) {
           absResultMagnitude = self._core_multiply(num1_for_mag_calc, num2_for_mag_calc);
       } else {
           const n = Math.max(num1_for_mag_calc.limbs.length, num2_for_mag_calc.limbs.length);
           const m = (n <= 1) ? 0 : Math.floor(n / 2);

           if (m === 0) {
               absResultMagnitude = self._core_multiply(num1_for_mag_calc, num2_for_mag_calc);
           } else {
               const { low: b, high: a } = num1_for_mag_calc._splitAt(m);
               const { low: d, high: c } = num2_for_mag_calc._splitAt(m);

               const p0_ac = a.multiply(c);
               const p1_bd = b.multiply(d);

               const sum_ab = a.add(b);
               const sum_cd = c.add(d);
               const p2_sumabcd = sum_ab.multiply(sum_cd);

               const p0_plus_p1 = p0_ac.add(p1_bd);
               const p2_middle_term = p2_sumabcd.subtract(p0_plus_p1);

               const p0_ac_shifted = p0_ac._multiplyByPowerOfBase(2 * m);
               const p2_middle_term_shifted = p2_middle_term._multiplyByPowerOfBase(m);

               let tempSum = p0_ac_shifted.add(p2_middle_term_shifted);
               absResultMagnitude = tempSum.add(p1_bd);
           }
       }
    }

    // Create the final result object
    // The absResultMagnitude should have exponent 0 as it's a product of coefficients.
    // The finalExponent carries the true exponent.
    const finalResult = new BigIntPrimitive("0", self.canvas, {forceCPU: true});
    finalResult.limbs = [...absResultMagnitude.limbs];
    finalResult.exponent = absResultMagnitude.exponent + finalExponent; // Add original total exponent
    finalResult.sign = resultSign;

    if (finalResult.isZero()) {
        finalResult.sign = 1;
        finalResult.exponent = 0;
    } else {
        while (finalResult.limbs.length > 1 && finalResult.limbs[finalResult.limbs.length - 1] === 0) {
            finalResult.limbs.pop();
            finalResult.exponent++;
        }
        if (finalResult.limbs.length === 1 && finalResult.limbs[0] === 0) {
             finalResult.exponent = 0;
             finalResult.sign = 1;
        }
    }
    return finalResult;
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
    const high = new Ctor(highStr, this.canvas, { ...currentOptions, isCoefficient: true }); // Changed
    const low = new Ctor(lowStr, this.canvas, { ...currentOptions, isCoefficient: true });   // Changed

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
    const dividend = new BigIntPrimitive(positiveDividendArg, this.canvas);
    const divisor = new BigIntPrimitive(positiveDivisorArg, this.canvas);

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
    const actualNumDecimalPlaces = (typeof numDecimalPlaces === 'number' && numDecimalPlaces >= 0) ? numDecimalPlaces : 0;
    dividendStrForScaling += '0'.repeat(actualNumDecimalPlaces);

    const biDividend = BigInt(dividendStrForScaling);
    const biDivisor = BigInt(v_val_str);

    const origDividendStrForLog = positiveDividendArg.toString();
    const origDivisorStrForLog = positiveDivisorArg.toString();
    console.log(`DEBUG: _decimalDivide for D_str=${origDividendStrForLog}, V_str=${origDivisorStrForLog}, numDP_arg=${numDecimalPlaces} (actual used for repeat: ${actualNumDecimalPlaces})`);
    console.log(`DEBUG:   d_val_str=${d_val_str}, d_exp_original=${d_exp}`);
    console.log(`DEBUG:   v_val_str=${v_val_str}, v_exp_original=${v_exp}`);
    console.log(`DEBUG:   scaled_d_val_str=${dividendStrForScaling}`);
    console.log(`DEBUG:   biDividend=${biDividend.toString()}, biDivisor=${biDivisor.toString()}`);

    if (biDivisor === 0n) {
        throw new Error("Division by zero after BigInt conversion for divisor.");
    }
    const biResult = biDividend / biDivisor;
    const q_int_str = biResult.toString();
    console.log(`DEBUG:   q_int_str=${q_int_str}`);

    const resultNum = new BigIntPrimitive(q_int_str, this.canvas, { forceCPU: true });
    const exponent_from_parsing_resultStr = resultNum.exponent;
    const final_exponent_for_resultNum = exponent_from_parsing_resultStr + d_exp - v_exp - actualNumDecimalPlaces;
    resultNum.exponent = final_exponent_for_resultNum;

    const tempParse = new BigIntPrimitive(q_int_str); // Re-parse to show its original state
    console.log(`DEBUG:   resultNum after new BigIntPrimitive(q_int_str): limbs=${JSON.stringify(tempParse.limbs)}, exponent_from_parsing=${tempParse.exponent}`);
    console.log(`DEBUG:   Calculated final exponent for resultNum: ${final_exponent_for_resultNum}`);
    console.log(`DEBUG:   resultNum BEFORE RETURN: limbs=${JSON.stringify(resultNum.limbs)}, exponent=${resultNum.exponent}, sign=${resultNum.sign}`);
    let temp_toString_val = "N/A";
    try {
      const oldPE_temp = BigIntPrimitive.PE; BigIntPrimitive.PE = 1e9;
      const oldNE_temp = BigIntPrimitive.NE; BigIntPrimitive.NE = -1e9;
      temp_toString_val = resultNum.toString();
      BigIntPrimitive.PE = oldPE_temp; BigIntPrimitive.NE = oldNE_temp;
    } catch (e) { temp_toString_val = "Error in toString: " + e.message; }
    console.log(`DEBUG:   resultNum.toString() just before return: "${temp_toString_val}"`);

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
}

export { BigIntPrimitive };
