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
  static DP = 20;
  static RM = 1;

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
    if (thisIsZero) { return otherBigInt.sign === 1 ? -1 : 1; }
    if (otherIsZero) { return this.sign === 1 ? 1 : -1; }
    if (this.sign !== otherBigInt.sign) { return this.sign === 1 ? 1 : -1; }

    let magResult = this.compareMagnitude(otherBigInt);
    if (this.sign === 1) { return magResult; }
    else { return magResult === 0 ? 0 : magResult * -1; }
  }

  toString() {
    if (this.isZero()) { return "0"; }
    let coefficientString = this.limbs.join('');
    let s;
    const e = this.exponent;
    const len = coefficientString.length;
    const decimalPointActualPosition = len + e;

    if (decimalPointActualPosition <= BigIntPrimitive.NE || decimalPointActualPosition > BigIntPrimitive.PE) {
      s = coefficientString[0];
      if (len > 1) { s += '.' + coefficientString.substring(1); }
      s += 'e' + (decimalPointActualPosition - 1);
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
    }
    if (s.includes('.')) {
      s = s.replace(/\.?0+$/, '');
      if (s === "") s = "0";
      if (s.startsWith('.')) s = '0' + s;
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
      const resultNumCPU = new this.constructor("0", this.canvas, { forceCPU: this.forceCPU });
      resultNumCPU.limbs = finalResultLimbs;
      resultNumCPU.sign = 1;
      if (resultNumCPU.isZero()) { resultNumCPU.sign = 1; }
      return resultNumCPU;
  }

  add(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive."); }
    if (this.sign === otherBigInt.sign) {
      const absThis = this.abs();
      const absOther = otherBigInt.abs();
      const sumMagnitude = absThis._core_add(absOther);
      sumMagnitude.sign = this.sign;
      if (sumMagnitude.isZero()) { sumMagnitude.sign = 1; }
      return sumMagnitude;
    } else {
      return this.subtract(otherBigInt.negate());
    }
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
      const resultNumCPU = new this.constructor("0", this.canvas, { forceCPU: this.forceCPU });
      resultNumCPU.limbs = finalResultLimbs;
      resultNumCPU.sign = 1;
      if (resultNumCPU.isZero()) { resultNumCPU.sign = 1; }
      return resultNumCPU;
  }

  subtract(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive."); }
    if (this.sign !== otherBigInt.sign) {
      const absThis = this.abs();
      const absOther = otherBigInt.abs();
      const sumMagnitude = absThis._core_add(absOther);
      sumMagnitude.sign = this.sign;
      if (sumMagnitude.isZero()) { sumMagnitude.sign = 1; }
      return sumMagnitude;
    } else {
      const comp = this.compareMagnitude(otherBigInt);
      if (comp === 0) { return new BigIntPrimitive("0", this.canvas); }
      let resultMagnitude;
      if (comp > 0) {
        resultMagnitude = this.abs()._core_subtract(otherBigInt.abs());
        resultMagnitude.sign = this.sign;
      } else {
        resultMagnitude = otherBigInt.abs()._core_subtract(this.abs());
        resultMagnitude.sign = this.sign * -1;
      }
      if (resultMagnitude.isZero()) { resultMagnitude.sign = 1; }
      return resultMagnitude;
    }
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
      if (resultNumCPU.isZero()) { resultNumCPU.sign = 1; }
      return resultNumCPU;
  }

   _core_multiply(num1, num2) {
    if (num1.isZero() || num2.isZero()) { return new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU }); }
    let totalResult = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
    const n1_limbs_reversed = [...num1.limbs].reverse();
    for (let i = 0; i < n1_limbs_reversed.length; i++) {
        const digitOfNum1 = n1_limbs_reversed[i];
        if (digitOfNum1 === 0) { continue; }
        let partialProductMagnitude = this._multiply_limb_by_bigint(digitOfNum1, num2);
        if (partialProductMagnitude.isZero()) { continue; }
        let shiftedLimbs = [...partialProductMagnitude.limbs];
        if (!(shiftedLimbs.length === 1 && shiftedLimbs[0] === 0)) {
            for (let j = 0; j < i; j++) { shiftedLimbs.push(0); }
        }
        if (shiftedLimbs.length === 0) { shiftedLimbs = [0]; }
        else {
            let firstNonZero = -1; for(let k=0; k < shiftedLimbs.length; ++k) if(shiftedLimbs[k] !== 0) {firstNonZero = k; break;}
            if(firstNonZero === -1) { shiftedLimbs = [0]; } else if (firstNonZero > 0) { shiftedLimbs = shiftedLimbs.slice(firstNonZero); }
            if (shiftedLimbs.length === 0) shiftedLimbs = [0];
        }
        const shiftedPartialProduct = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
        shiftedPartialProduct.limbs = shiftedLimbs;
        shiftedPartialProduct.sign = 1;
        if (shiftedPartialProduct.limbs.length === 1 && shiftedPartialProduct.limbs[0] === 0) { shiftedPartialProduct.exponent = 0; }
        totalResult = totalResult.add(shiftedPartialProduct);
        if (!totalResult) { throw new Error("Error during accumulation in _core_multiply."); }
    }
    totalResult.sign = 1;
    if (totalResult.isZero()) totalResult.sign = 1;
    return totalResult;
  }

  multiply(otherBigInt) {
    const self = this;
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive."); }
    if (self.isZero() || otherBigInt.isZero()) { return new BigIntPrimitive("0", self.canvas); }
    const resultSign = (self.sign === otherBigInt.sign) ? 1 : -1;
    const absThis = self.abs(); const absOther = otherBigInt.abs();
    let finalAbsResult;
    const absThisLen = absThis.isZero() ? 0 : absThis.limbs.length;
    const absOtherLen = absOther.isZero() ? 0 : absOther.limbs.length;
    if (absThisLen < KARATSUBA_THRESHOLD || absOtherLen < KARATSUBA_THRESHOLD) {
        finalAbsResult = self._core_multiply(absThis, absOther);
    } else {
        const n = Math.max(absThisLen, absOtherLen); const m = Math.floor(n / 2);
        if (m === 0) { finalAbsResult = self._core_multiply(absThis, absOther); }
        else {
            const { low: b, high: a } = absThis._splitAt(m);
            const { low: d, high: c } = absOther._splitAt(m);
            const p0 = a.multiply(c); const p1 = b.multiply(d);
            const sum_ab = a.add(b); const sum_cd = c.add(d);
            if (!sum_ab || !sum_cd) throw new Error("Karatsuba: Error in intermediate additions for p2_temp components.");
            const p2_temp = sum_ab.multiply(sum_cd);
            if (!p0 || !p1 || !p2_temp) throw new Error("Karatsuba: Error in recursive multiply calls.");
            const p0_plus_p1 = p0.add(p1);
            if(!p0_plus_p1) throw new Error("Karatsuba: Error in p0+p1 for p2 calculation.");
            const p2 = p2_temp.subtract(p0_plus_p1);
            if (!p2) throw new Error("Karatsuba: Error in p2_temp - (p0+p1) for p2 calculation.");
            const p0_shifted = p0._multiplyByPowerOfBase(2 * m);
            const p2_shifted = p2._multiplyByPowerOfBase(m);
            let tempSum = p0_shifted.add(p2_shifted);
            if (!tempSum) throw new Error("Karatsuba: Error in adding p0_shifted and p2_shifted");
            finalAbsResult = tempSum.add(p1);
            if (!finalAbsResult) throw new Error("Karatsuba: Error in adding sum and p1");
            if (finalAbsResult.isZero()) { finalAbsResult.sign = 1;} else {finalAbsResult.sign = 1;}
        }
    }
    if (finalAbsResult.isZero()) { finalAbsResult.sign = 1; } else { finalAbsResult.sign = resultSign; }
    if (finalAbsResult.canvas !== self.canvas) { finalAbsResult.canvas = self.canvas; }
    return finalAbsResult;
  }

  pow(exp) {
    if (typeof exp !== 'number' || !Number.isInteger(exp)) { throw new TypeError("Exponent must be an integer."); }
    if (exp < 0) { throw new TypeError("Exponent must be non-negative."); }
    if (exp > 1000000) { throw new Error("Exponent too large.");}
    const currentOptions = { forceCPU: this.forceCPU };
    if (exp === 0) { return new BigIntPrimitive("1", this.canvas, currentOptions); }
    if (this.isZero()) { return new BigIntPrimitive(this, this.canvas, currentOptions); }
    if (this.limbs.length === 1 && this.limbs[0] === 1) {
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
    const newLimbs = new Array(numLimbsToShift).fill(0).concat(this.limbs);
    const Ctor = this.constructor; const shiftedBigInt = new Ctor("0", this.canvas);
    shiftedBigInt.limbs = newLimbs; shiftedBigInt.sign = this.sign;
    return shiftedBigInt;
  }

  _splitAt(m) {
    const Ctor = this.constructor; const currentOptions = { forceCPU: this.forceCPU };
    let low, high; const len = this.limbs.length;
    if (m <= 0) { high = new Ctor(this, this.canvas, currentOptions); low = new Ctor("0", this.canvas, currentOptions); return { low, high }; }
    if (m >= len) { low = new Ctor(this, this.canvas, currentOptions); high = new Ctor("0", this.canvas, currentOptions); return { low, high }; }
    let highSlice = this.limbs.slice(0, len - m); let lowSlice = this.limbs.slice(len - m);
    high = new Ctor("0", this.canvas, currentOptions);
    while (highSlice.length > 1 && highSlice[0] === 0) highSlice.shift();
    if (highSlice.length === 0 || (highSlice.length === 1 && highSlice[0] === 0)) high.limbs = [0]; else high.limbs = highSlice;
    high.sign = high.isZero() ? 1 : 1;
    low = new Ctor("0", this.canvas, currentOptions);
    while (lowSlice.length > 1 && lowSlice[0] === 0) lowSlice.shift();
    if (lowSlice.length === 0 || (lowSlice.length === 1 && lowSlice[0] === 0)) low.limbs = [0]; else low.limbs = lowSlice;
    low.sign = low.isZero() ? 1 : 1;
    return { low, high };
  }

  _multiplyByPowerOfBase(power) {
    const currentOptions = { forceCPU: this.forceCPU };
    if (typeof power !== 'number' || !Number.isInteger(power)) { throw new Error("Power must be an integer.");}
    if (power < 0) { throw new Error("Power must be non-negative for _multiplyByPowerOfBase.");}
    if (this.isZero()) { return new BigIntPrimitive("0", this.canvas, currentOptions); }
    if (power === 0) { return new BigIntPrimitive(this, this.canvas, currentOptions); }
    let newLimbs = [...this.limbs];
    if (newLimbs.length === 0 && !this.isZero()) { console.warn("_multiplyByPowerOfBase: called on non-zero BigIntPrimitive with empty limbs."); return new BigIntPrimitive(this, this.canvas, currentOptions); }
    for (let i = 0; i < power; i++) { newLimbs.push(0); }
    const Ctor = this.constructor; const result = new Ctor("0", this.canvas, currentOptions);
    if (newLimbs.length === 0) { result.limbs = [0]; }
    else { let allZerosCheck = true; for(const digit of newLimbs) if(digit !== 0) { allZerosCheck = false; break; }
           if (allZerosCheck) { result.limbs = [0]; } else { result.limbs = newLimbs; }
    }
    result.sign = this.sign;
    if (result.limbs.length === 1 && result.limbs[0] === 0) { result.sign = 1; result.exponent = 0; }
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
    let quotientLimbs = [];
    let currentWorkingDividend = new Ctor("0", this.canvas, { forceCPU: this.forceCPU });
    for (let i = 0; i < positiveDividend.limbs.length; i++) {
      const dividendLimbDigit = positiveDividend.limbs[i];
      currentWorkingDividend = currentWorkingDividend._multiplyByPowerOfBase(1);
      const limbAsBigInt = new Ctor(String(dividendLimbDigit), this.canvas, { forceCPU: this.forceCPU });
      currentWorkingDividend = currentWorkingDividend.add(limbAsBigInt);
      let quotientLimbValue = 0;
      while (!currentWorkingDividend.isZero() && currentWorkingDividend.compareMagnitude(positiveDivisor) >= 0) {
        currentWorkingDividend = currentWorkingDividend._core_subtract(positiveDivisor);
        quotientLimbValue++;
      }
      quotientLimbs.push(quotientLimbValue);
    }
    while (quotientLimbs.length > 1 && quotientLimbs[0] === 0) { quotientLimbs.shift(); }
    if (quotientLimbs.length === 0) { quotientLimbs = [0]; }
    const finalQuotientString = quotientLimbs.join('');
    const finalQuotient = new Ctor(finalQuotientString === "" ? "0" : finalQuotientString, this.canvas, { forceCPU: this.forceCPU });
    finalQuotient.sign = 1;
    if (currentWorkingDividend.isZero()) { currentWorkingDividend.sign = 1; currentWorkingDividend.exponent = 0; }
    else { currentWorkingDividend.sign = 1; }
    return { quotient: finalQuotient, remainder: currentWorkingDividend };
  }

  divideAndRemainder(divisorBigInt) {
    if (!(divisorBigInt instanceof BigIntPrimitive)) { throw new TypeError("Divisor must be an instance of BigIntPrimitive."); }
    if (divisorBigInt.isZero()) { throw new Error("Division by zero"); }
    const quotientSign = (this.sign === divisorBigInt.sign) ? 1 : -1;
    const remainderSign = this.sign;
    const absDividend = this.abs(); const absDivisor = divisorBigInt.abs();
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

    if (inputLimbsMsbFirst.length === 1 && inputLimbsMsbFirst[0] === 0) {
      return { limbs: [0], exponent: 0, sign: 1 };
    }

    // 1. Create a plain decimal string representation of the number's magnitude
    let s;
    const coeffStr = inputLimbsMsbFirst.join('');
    const exp = inputExponent;
    const len = coeffStr.length;

    if (exp >= 0) { s = coeffStr + '0'.repeat(exp); }
    else { // Negative exponent means decimal point
        const decPos = len + exp;
        if (decPos > 0) { s = coeffStr.substring(0, decPos) + '.' + coeffStr.substring(decPos); }
        else { s = '0.' + '0'.repeat(-decPos) + coeffStr; }
    }

    if (s === "0" || s === "0.0" || s === "") return { limbs: [0], exponent: 0, sign: 1 };

    let [integerS, fractionalS = ''] = s.split('.');
    if (integerS === "") integerS = "0";

    let applyRoundingEffect = 0;

    if (dp >= 0) {
        if (dp >= fractionalS.length) {
            fractionalS = fractionalS.padEnd(dp, '0');
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
            const firstDigitVal = parseInt(integerS[0] || '0', 10);
            const discardedPartIsNonZero = !(/^[0]*$/.test(integerS.substring(1)) && /^[0]*$/.test(originalFractionalForCheck));

            switch (rm) {
                case 0: break;
                case 1: if (firstDigitVal >= 5) applyRoundingEffect = 1; break;
                case 2:
                    if (firstDigitVal > 5) applyRoundingEffect = 1;
                    else if (firstDigitVal === 5) { if (discardedPartIsNonZero) applyRoundingEffect = 1; }
                    break;
                case 3: if (!(/^[0]*$/.test(integerS) && /^[0]*$/.test(originalFractionalForCheck)) ) applyRoundingEffect = 1; break;
            }
            integerS = "0";
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
                    } else if (roundDigitVal === 5 && !isExactlyHalfWay) {
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
        let partToModifyArr;
        let isIntegerPartModified = (dp <= 0);
        let propagateCarryToInteger = false;

        if (isIntegerPartModified) {
            partToModifyArr = integerS.split('');
            if (integerS === "0") partToModifyArr = ['0'];
        } else {
            partToModifyArr = fractionalS.split('');
        }

        if (isIntegerPartModified && partToModifyArr.join('') === "0" && applyRoundingEffect) {
             partToModifyArr = ['0'];
        } else if (partToModifyArr.length === 0 && isIntegerPartModified && applyRoundingEffect) {
            partToModifyArr = ['0'];
        }

        let i = partToModifyArr.length - 1;
        if (i < 0 && isIntegerPartModified) {
            partToModifyArr = ['0'];
            i = 0;
        } else if (i < 0 && !isIntegerPartModified && dp > 0) {
             propagateCarryToInteger = true;
             applyRoundingEffect = 0;
        }

        if(applyRoundingEffect){
            while (i >= 0) {
                if (partToModifyArr[i] === '9') {
                    partToModifyArr[i] = '0';
                    if (i === 0) {
                        if (isIntegerPartModified) { partToModifyArr.unshift('1');}
                        else { propagateCarryToInteger = true; }
                        break;
                    }
                    i--;
                } else {
                    partToModifyArr[i] = String(parseInt(partToModifyArr[i], 10) + 1);
                    propagateCarryToInteger = false;
                    break;
                }
            }
        }
         if (i < 0 && isIntegerPartModified && partToModifyArr.length > 0 && partToModifyArr[0] === '0') {
            partToModifyArr.unshift('1');
        }

        if (isIntegerPartModified) {
            integerS = partToModifyArr.join('');
        } else {
            fractionalS = partToModifyArr.join('');
            if (propagateCarryToInteger) {
                let j = integerS.length - 1;
                let intArr = integerS.split('');
                if (integerS === "0" && j < 0) { intArr = ['0']; j = 0; }
                else if (j < 0) {intArr.unshift('0'); j = 0;}

                while (j >= 0) {
                    if (intArr[j] === '9') { intArr[j] = '0'; if (j === 0) { intArr.unshift('1'); break; } j--;}
                    else { intArr[j] = String(parseInt(intArr[j], 10) + 1); break; }
                }
                integerS = intArr.join('');
            }
        }
    }

    let finalRoundedStr = integerS;
    if (dp > 0) {
        finalRoundedStr += '.' + (fractionalS || '').padEnd(dp, '0');
    } else if (dp < 0 && integerS !== "0") {
        finalRoundedStr = integerS.padEnd(integerS.length + (-dp), '0');
    } else if (integerS === "0" && (dp < 0 || dp === 0)){
         finalRoundedStr = "0";
    }

    if (inputSign === -1 && !(finalRoundedStr === "0" || /^[0.]+$/.test(finalRoundedStr) && parseFloat(finalRoundedStr) === 0) ) {
      if(!finalRoundedStr.startsWith('-')) finalRoundedStr = '-' + finalRoundedStr;
    }

    const resultNum = new BigIntPrimitive(finalRoundedStr);

    return {
        limbs: resultNum.limbs,
        exponent: resultNum.exponent,
        sign: resultNum.sign
    };
  }

  round(dp, rm) {
    const roundingMode = rm === undefined ? this.constructor.RM : rm;
    const dpToUse = dp === undefined ? 0 : dp;

    const roundedParts = BigIntPrimitive._staticRound(
        this.limbs,
        this.exponent,
        this.sign,
        dpToUse,
        roundingMode
    );

    const result = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
    result.limbs = roundedParts.limbs;
    result.exponent = roundedParts.exponent;
    result.sign = roundedParts.sign;

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
      if (dp !== undefined && dp > 0) {
        zeroStr += "." + "0".repeat(dp);
      }
      return zeroStr + "e+0";
    }

    if (dp !== undefined && dp < 0) {
        throw new RangeError("toExponential() argument must be non-negative");
    }

    let sciExp = (this.limbs.length - 1) + this.exponent;

    // Create a temporary BigInt for the coefficient: C = this.value / 10^sciExp
    // So, C will have limbs from this.limbs, and its exponent will be (this.exponent - sciExp)
    // which is this.exponent - ((this.limbs.length - 1) + this.exponent) = -(this.limbs.length - 1)
    // This makes the first digit of this.limbs be the integer part of the coefficient.
    const coeff = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
    coeff.limbs = [...this.limbs];
    coeff.exponent = -(this.limbs.length - 1);
    coeff.sign = 1; // Coefficient for sci notation is positive, sign handled at the end.

    let roundedCoeff;
    if (dp === undefined) {
        // Default: minimum number of digits necessary.
        // toString() of coeff already does this if PE/NE are wide.
        const tempPE = BigIntPrimitive.PE;
        const tempNE = BigIntPrimitive.NE;
        BigIntPrimitive.PE = 10000; BigIntPrimitive.NE = -10000;
        roundedCoeffStr = coeff.toString();
        BigIntPrimitive.PE = tempPE; BigIntPrimitive.NE = tempNE;
        // Need to potentially re-parse roundedCoeffStr if it became e.g. "10"
        const tempRoundedCoeff = new BigIntPrimitive(roundedCoeffStr);
        if (tempRoundedCoeff.limbs.length > 1 && tempRoundedCoeff.exponent === 0 && tempRoundedCoeff.limbs[0] !==0) { // e.g. 9.9 -> 10
             sciExp += (tempRoundedCoeff.limbs.length -1); // For "10", sciExp increases by 1
             tempRoundedCoeff.exponent = -(tempRoundedCoeff.limbs.length -1); // "10" -> "1.0"
        }
         roundedCoeff = tempRoundedCoeff;

    } else {
        roundedCoeff = coeff.round(dp, actualRm);
        // Check if rounding caused coefficient to gain a digit (e.g. 9.99 -> 10.0)
        // compare magnitude of roundedCoeff vs 10.
        // A simpler check: if original coeff was < 10 (std sci form), and rounded is >= 10
        const ten = new BigIntPrimitive("10");
        if (coeff.compareMagnitude(ten) < 0 && roundedCoeff.compareMagnitude(ten) >= 0) {
            sciExp++;
            roundedCoeff.exponent--; // e.g. 10.0 -> 1.0 (exponent change)
        } else if (coeff.compareMagnitude(ten) >=0 && roundedCoeff.compareMagnitude(ten) < 0) {
            // This case should not happen if rounding correctly (e.g. 10.1 cannot round to 9.xxx)
        }
    }

    let coeffStr = roundedCoeff.limbs.join('');
    let res = (this.sign === -1 ? "-" : "") + coeffStr[0];

    if (dp === undefined) { // Default precision
        if (coeffStr.length > 1 || roundedCoeff.exponent < 0) { // Only add decimal if there are digits for it
            let fractionalPart = coeffStr.substring(1);
            if (roundedCoeff.exponent < 0) { // e.g. 1.0023 with exp -3 for coeff
                 fractionalPart = '0'.repeat(-roundedCoeff.exponent - (coeffStr.length -1) ) + coeffStr;
                 fractionalPart = fractionalPart.substring(1); // remove the integer part that's already there
            }
             // Remove trailing zeros from this constructed fractionalPart
            fractionalPart = fractionalPart.replace(/0+$/, '');
            if(fractionalPart.length > 0) res += '.' + fractionalPart;
        }
    } else if (dp > 0) {
        res += '.';
        if (coeffStr.length > 1) {
            res += coeffStr.substring(1, dp + 1);
        }
        if (res.length < ( (this.sign === -1 ? 1:0) + 2 + dp) ) { // sign + digit + dot + dp_digits
            res = res.padEnd((this.sign === -1 ? 1:0) + 2 + dp, '0');
        }
    }
    // else dp is 0, no decimal point.

    res += 'e' + (sciExp >= 0 ? '+' : '-') + Math.abs(sciExp);
    return res;
  }

  toFixed(dpUndefined, rmUndefined) {
    const actualRm = (rmUndefined === undefined ? BigIntPrimitive.RM : rmUndefined);
    let dp = dpUndefined;

    if (dp === undefined) { // big.js behavior: no dp = full number in normal notation
        const tempPE = BigIntPrimitive.PE;
        const tempNE = BigIntPrimitive.NE;
        BigIntPrimitive.PE = 10000; // Effectively disable sci notation
        BigIntPrimitive.NE = -10000;
        const str = this.toString();
        BigIntPrimitive.PE = tempPE;
        BigIntPrimitive.NE = tempNE;
        return str;
    }

    if (dp < 0 || typeof dp !== 'number' || !Number.isInteger(dp)) { // toFixed dp must be 0 or positive integer
        throw new RangeError("toFixed() argument must be a non-negative integer.");
    }

    const roundedNum = this.round(dp, actualRm);

    if (roundedNum.isZero()) {
        return dp > 0 ? '0.' + '0'.repeat(dp) : '0';
    }

    let str = roundedNum.sign === -1 ? "-" : "";
    let coeffStr = roundedNum.limbs.join('');
    let exp = roundedNum.exponent;
    const len = coeffStr.length;

    const numIntegerDigits = len + exp;

    if (numIntegerDigits > 0) { // Has an integer part
        str += coeffStr.substring(0, numIntegerDigits);
        if (dp > 0) {
            let fractionalPart = coeffStr.substring(numIntegerDigits);
            str += '.' + fractionalPart.padEnd(dp, '0').substring(0,dp);
        }
    } else { // Number is like 0.xxxx
        str += '0';
        if (dp > 0) {
            const numLeadingZeros = -numIntegerDigits;
            let fractionalPart = '0'.repeat(numLeadingZeros) + coeffStr;
            str += '.' + fractionalPart.padEnd(dp, '0').substring(0,dp);
        }
    }
    return str;
  }
}

export { BigIntPrimitive };
