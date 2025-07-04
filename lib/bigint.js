import * as webglUtilsModule from './webgl-utils.js';
import vertexShaderSrc from './shaders/addition.vert?raw';
import fragmentShaderSrc from './shaders/addition.frag?raw';
let instanceCounter = 0; // Instance counter for debugging
import subtractVertexShaderSrc from './shaders/subtraction.vert?raw';
import subtractFragmentShaderSrc from './shaders/subtraction.frag?raw';
import multiplyLimbVertexShaderSrc from './shaders/multiply_limb.vert?raw';
import multiplyLimbFragmentShaderSrc from './shaders/multiply_limb.frag?raw';
import multiplyFullVertexShaderSrc from './shaders/multiply_full.vert?raw';
import multiplyFullFragmentShaderSrc from './shaders/multiply_full.frag?raw';
import sumColumnsFragmentShaderSrc from './shaders/sum_columns.frag?raw';
import propagateCarriesFragmentShaderSrc from './shaders/propagate_carries.frag?raw';

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

    if (coefficientStr.length > 1 && coefficientStr.startsWith('0')) {
        coefficientStr = coefficientStr.replace(/^0+/, '');
        if (coefficientStr === "") coefficientStr = "0";
    }

    if (coefficientStr === "0") {
        this.limbs = [0];
        if (this.exponent !== 0) {
            let allZeros = true;
            for(let i = 0; i < mantissaStr.length; i++) {
                if (mantissaStr[i] !== '0' && mantissaStr[i] !== '.') {
                    allZeros = false;
                    break;
                }
            }
            if (allZeros) this.exponent = 0;
        }
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

    while (this.limbs.length > 1 && this.limbs[0] === 0) {
        this.limbs.shift();
    }

    if (this.limbs.length === 1 && this.limbs[0] === 0) {
      this.exponent = 0;
    }
    const finalLimbsStr = `[${this.limbs.join(',')}]`;
    console.log(`[Instance Created ID: ${this._instanceId}] Input type: ${typeof value}, Value (partial): ${String(value).substring(0, 50)}, ForceCPU: ${options?.forceCPU}, Final limbs: ${finalLimbsStr}, Final exponent: ${this.exponent}`);
  }

  static fromCoefficientString(valueStr, canvas, options = {}) {
    const instance = new BigIntPrimitive("0", canvas, options);
    instance.sign = 1;
    instance.exponent = 0;

    if (valueStr === null || valueStr === undefined || typeof valueStr !== 'string' || valueStr.trim() === "") {
        instance.limbs = [0];
        return instance;
    }

    let coeffStr = valueStr.trim();
    if (!/^\d+$/.test(coeffStr)) {
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

    while (instance.limbs.length > 1 && instance.limbs[0] === 0) {
        instance.limbs.shift();
    }
    if (instance.limbs.length === 0 || (instance.limbs.length === 1 && instance.limbs[0] === 0)) {
       instance.limbs = [0];
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
    if (this.isZero()) return -1;
    if (other.isZero()) return 1;

    const tc = this.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('');
    const oc = other.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('');

    const tExp = this.exponent + (tc.length - 1);
    const oExp = other.exponent + (oc.length - 1);

    if (tExp > oExp) return 1;
    if (tExp < oExp) return -1;

    const len = Math.max(tc.length, oc.length);
    for (let i = 0; i < len; i++) {
      const td = (i < tc.length) ? parseInt(tc[i], 10) : 0;
      const od = (i < oc.length) ? parseInt(oc[i], 10) : 0;

      if (td > od) return 1;
      if (td < od) return -1;
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
    console.log(`[toString ENTRY ID: ${this._instanceId}] current _roundedDp: ${this._roundedDp}, exp: ${this.exponent}, sign: ${this.sign}`);
    if (this.isZero()) {
        if (typeof this._roundedDp === 'number' && this._roundedDp > 0) {
            return '0.' + '0'.repeat(this._roundedDp);
        }
        return "0";
    }

    let coefficientString;
    if (this.limbs.length === 0) {
        coefficientString = "0";
    } else {
        coefficientString = String(this.limbs[0]);
        for (let i = 1; i < this.limbs.length; i++) {
            coefficientString += String(this.limbs[i]).padStart(BASE_LOG10, '0');
        }
    }

    let s;
    const e = this.exponent;
    const numDigits = coefficientString.length;
    const decimalPointActualPosition = numDigits + e;

    const useSciNotation = (this._roundedDp === null || this._roundedDp === undefined) &&
                           (decimalPointActualPosition <= BigIntPrimitive.NE ||
                            decimalPointActualPosition > BigIntPrimitive.PE);

    if (useSciNotation) {
        s = coefficientString[0];
        if (numDigits > 1) {
            s += '.' + coefficientString.substring(1);
        }
        if (s.includes('.')) {
           s = s.replace(/\.?0+$/, '');
        }
        const scientificExponent = decimalPointActualPosition - 1;
        s += 'e' + (scientificExponent >= 0 ? '+' : '') + scientificExponent;
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

        if (typeof this._roundedDp === 'number' && this._roundedDp >= 0) {
            let [integerPart, fractionalPart = ''] = s.split('.');
            if (this._roundedDp > 0) {
                fractionalPart = fractionalPart.padEnd(this._roundedDp, '0');
                fractionalPart = fractionalPart.substring(0, this._roundedDp);
                s = integerPart + '.' + fractionalPart;
            } else {
                s = integerPart;
            }
        } else if (s.includes('.')) {
             s = s.replace(/\.?0+$/, '');
        }
        if (s === "") s = "0";
        if (s.startsWith('.')) s = '0' + s;
    }

    const preSign = (this.sign === -1 && !this.isZero()) ? "-" : "";
    let outputStr = s;

    console.log(`[toString DEBUG ID: ${this._instanceId}] Value for formatting: ${s}, Exp: ${this.exponent}, Sign: ${this.sign}, Current _roundedDp: ${this._roundedDp}`);

    if (typeof this._roundedDp === 'number' && this._roundedDp >= 0) {
        if (this.isZero()) {
            outputStr = (this._roundedDp > 0) ? '0.' + '0'.repeat(this._roundedDp) : '0';
            return outputStr;
        }
        let baseFixedS;
        const currentCoeff = this.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('');
        const currentExp = this.exponent;
        const currentNumDigits = currentCoeff.length;
        const currentDecimalPos = currentNumDigits + currentExp;

        if (currentExp < 0) {
            if (currentDecimalPos > 0) {
                baseFixedS = currentCoeff.substring(0, currentDecimalPos) + '.' + currentCoeff.substring(currentDecimalPos);
            } else {
                baseFixedS = '0.' + '0'.repeat(-currentDecimalPos) + currentCoeff;
            }
        } else {
            baseFixedS = currentCoeff + '0'.repeat(currentExp);
        }

        let [integerPart, fractionalPart = ''] = baseFixedS.split('.');

        if (this._roundedDp === 0) {
            outputStr = integerPart;
        } else {
            fractionalPart = fractionalPart.padEnd(this._roundedDp, '0');
            fractionalPart = fractionalPart.substring(0, this._roundedDp);
            outputStr = integerPart + '.' + fractionalPart;
        }
    }

    if (preSign === "-") {
        const isZeroOutput = (outputStr === "0" || (outputStr.includes(".") && parseFloat(outputStr) === 0));
        if (isZeroOutput) {
            if (this.limbs.length === 1 && this.limbs[0] === 0 && (this._roundedDp === null || this._roundedDp === undefined)) {
                 return "-0";
            }
            return outputStr;
        }
        return preSign + outputStr;
    }
    return outputStr;
  }

  toNumber() {
    const originalString = this.toString();
    const primitiveNumber = Number(originalString);

    if (this.constructor.strict) {
        if (primitiveNumber === Infinity || primitiveNumber === -Infinity) {
            throw new TypeError("[big.js] Imprecise conversion: non-finite number");
        }
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
                this.constructor.strict = OldStrict;
                throw new TypeError("[big.js] Imprecise conversion (constructor failed for finite number): " + e.message);
            }
            if (tempBig.toString() !== originalString) {
                 throw new TypeError("[big.js] Imprecise conversion: precision loss");
            }
        } else if (Number.isNaN(primitiveNumber)) {
            throw new TypeError("[big.js] Imprecise conversion: NaN");
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

  static _coeffStrToPaddedLimbs(coeffStr, targetLimbLength, baseLog10Val = BASE_LOG10) {
    let limbs = [];
    if (coeffStr === "0") {
        limbs.push(0);
    } else if (coeffStr.length > 0) {
        let currentPos = coeffStr.length;
        while (currentPos > 0) {
            const start = Math.max(0, currentPos - baseLog10Val);
            limbs.push(parseInt(coeffStr.substring(start, currentPos), 10));
            currentPos = start;
        }
    }
    if (limbs.length === 0) {
        limbs.push(0);
    }

    const paddedLimbs = new Float32Array(targetLimbLength);
    for (let i = 0; i < targetLimbLength; i++) {
      paddedLimbs[i] = (i < limbs.length) ? limbs[i] : 0;
    }
    return paddedLimbs;
  }

  _core_add(positiveOtherBigInt) {
    let rL = [];
    let cs = 0;
    let tL = [...this.limbs].reverse();
    let oL = [...positiveOtherBigInt.limbs].reverse();

    const maxL = Math.max(tL.length, oL.length);

    for (let i = 0; i < maxL; i++) {
      let s = (tL[i] || 0) + (oL[i] || 0) + cs;
      rL.push(s % BASE);
      cs = Math.floor(s / BASE);
    }
    if (cs) {
      rL.push(cs);
    }

    let fL = rL.reverse();
    while (fL.length > 1 && fL[0] === 0) { fL.shift(); }
    if (fL.length === 0) fL = [0];

    const res = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    res.limbs = fL;
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
    let webglSuccess = false;
    let webglAttempted = false;

    if (!this.forceCPU && !otherBigInt.forceCPU && this.canvas && typeof webglUtilsModule !== 'undefined') {
      webglAttempted = true;
      gl = webglUtilsModule.initWebGL(this.canvas);
      if (gl && gl.getExtension('OES_texture_float')) {
        if (this.sign !== otherBigInt.sign) {
        } else {
          let addProgram, texNum1, texNum2, texCarryIn, texOutput, fbOutput, positionBuffer;
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
            const texWidth = Math.max(thisScaledLimbsCount, otherScaledLimbsCount) + 1;
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
            texOutput = webglUtilsModule.createDataTexture(gl, null, texWidth, 1, true);
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
             if (positionAttributeLocation === -1) {
                console.error("[WebGL Add Debug] a_position attribute not found in shader program.");
                throw new Error("a_position attribute not found.");
            }
             gl.enableVertexAttribArray(positionAttributeLocation);
             gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
             gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

            const texCoordBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);
            const texCoordAttributeLocation = gl.getAttribLocation(addProgram, "a_texCoord");
            if (texCoordAttributeLocation === -1) {
                console.error("[WebGL Add Debug] a_texCoord attribute not found in shader program.");
                throw new Error("a_texCoord attribute not found.");
            }
            gl.enableVertexAttribArray(texCoordAttributeLocation);
            gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
            gl.vertexAttribPointer(texCoordAttributeLocation, 2, gl.FLOAT, false, 0, 0);

            gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput);
            gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            console.log(`[WebGL Add Debug] GPU draw call complete. Expecting ${texWidth}x1 RGBA output.`);

            this._webglTempData = { texOutput, texWidth, commonExponent, sign: this.sign, glContext: gl, fbOutput };
            webglSuccess = true;

            if(vs) gl.deleteShader(vs);
            if(fs) gl.deleteShader(fs);
            gl.deleteProgram(addProgram);
            gl.deleteTexture(texNum1);
            gl.deleteTexture(texNum2);
            gl.deleteTexture(texCarryIn);
            gl.deleteBuffer(positionBuffer);
            if (texCoordBuffer) gl.deleteBuffer(texCoordBuffer);

            const { texOutput: texOutputFromData, texWidth: texWidthFromData, commonExponent: retrievedCommonExponent, sign: resultSign, glContext: glCtx, fbOutput: fbOutputFromData } = this._webglTempData;

            glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, fbOutputFromData);
            const outputDataRGBA = webglUtilsModule.readDataFromTexture(glCtx, fbOutputFromData, texWidthFromData, 1, false);
            glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, null);
            console.log(`[WebGL Add Debug] outputDataRGBA (raw from GPU, length ${outputDataRGBA.length}): [${Array.from(outputDataRGBA).join(', ')}]`);

            const gpuLimbs = new Float32Array(texWidthFromData);
            const gpuInitialCarries = new Float32Array(texWidthFromData);

            for (let i = 0; i < texWidthFromData; i++) {
                gpuLimbs[i] = outputDataRGBA[i * 4 + 0];
                gpuInitialCarries[i] = outputDataRGBA[i * 4 + 1];
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

            glCtx.deleteTexture(texOutputFromData);
            glCtx.deleteFramebuffer(fbOutputFromData);
            delete this._webglTempData;

            webglSuccess = true;
            return webGLResult;

          } catch (e) {
            console.error("WebGL add path error:", e);
            webglSuccess = false;
            if (gl && this._webglTempData) {
                const errGL = this._webglTempData.glContext || gl;
                if (this._webglTempData.texOutput) errGL.deleteTexture(this._webglTempData.texOutput);
                if (this._webglTempData.fbOutput) errGL.deleteFramebuffer(this._webglTempData.fbOutput);
            }
            if (this._webglTempData) delete this._webglTempData;
          }
        }
      } else {
      }
    }

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
    throw new Error("add method did not return a result through WebGL or CPU paths.");
  }

  _core_subtract(positiveOtherBigInt) {
      let rL = [];
      let b = 0;
      let tL = [...this.limbs].reverse();
      let oL = [...positiveOtherBigInt.limbs].reverse();

      const maxL = Math.max(tL.length, oL.length);

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

      let fL = rL.reverse();
      while (fL.length > 1 && fL[0] === 0) { fL.shift(); }
      if (fL.length === 0) fL = [0];

      const resultNumCPU = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
      resultNumCPU.limbs = fL;
      resultNumCPU.sign = 1;
      if (resultNumCPU.isZero()) { resultNumCPU.sign = 1; resultNumCPU.exponent = 0;}
      return resultNumCPU;
  }

  subtract(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive."); }

    if (this.sign !== otherBigInt.sign) {
      const termToAdd = new BigIntPrimitive(otherBigInt, this.canvas, { forceCPU: otherBigInt.forceCPU });
      termToAdd.sign = -termToAdd.sign;
      return this.add(termToAdd);
    }

    let webglSuccess = false;

    if (!this.forceCPU && !otherBigInt.forceCPU && this.canvas && typeof webglUtilsModule !== 'undefined') {
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
            return zeroResult;
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

        if (webGLResult.isZero()) {
            webGLResult.sign = 1;
            webGLResult.exponent = 0;
        }

        console.log(`[WebGL Subtract Path] Result: ${webGLResult.toString()}`);
        webglSuccess = true;
        return webGLResult;

      } catch (e) {
        console.error("WebGL subtract path error:", e);
      }
    }

    const result = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU || otherBigInt.forceCPU });
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
    let program, texMinuend, texSubtrahend, texBorrowIn, texOutput, fbOutput, positionBuffer, texCoordBuffer, texCoordAttrLoc;

    try {
        gl = webglUtilsModule.initWebGL(this.canvas);
        if (!gl || !gl.getExtension('OES_texture_float')) {
            throw new Error("WebGL not supported or float textures not available for subtraction.");
        }
        while (gl.getError() !== gl.NO_ERROR) {}

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
        texBorrowIn = webglUtilsModule.createDataTexture(gl, new Float32Array(texWidth).fill(0), texWidth, 1, false);
        texOutput = webglUtilsModule.createDataTexture(gl, null, texWidth, 1, true);
        if (!texMinuend || !texSubtrahend || !texBorrowIn || !texOutput) throw new Error('WebGL texture creation failed for subtraction.');

        fbOutput = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error('WebGL framebuffer incomplete for subtraction.');
        }

        gl.viewport(0, 0, texWidth, 1);

        const uNum1Loc = gl.getUniformLocation(program, "u_num1Texture");
        const uNum2Loc = gl.getUniformLocation(program, "u_num2Texture");
        const uBorrowInLoc = gl.getUniformLocation(program, "u_borrowTexture");
        if (!uNum1Loc || !uNum2Loc || !uBorrowInLoc) {
             throw new Error("Failed to get essential uniform locations for subtraction shader.");
        }

        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texMinuend); gl.uniform1i(uNum1Loc, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texSubtrahend); gl.uniform1i(uNum2Loc, 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texBorrowIn); gl.uniform1i(uBorrowInLoc, 2);

        positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
        const posAttrLoc = gl.getAttribLocation(program, "a_position");
        if (posAttrLoc === -1) throw new Error("a_position attribute not found in subtraction shader.");
        gl.enableVertexAttribArray(posAttrLoc);
        gl.vertexAttribPointer(posAttrLoc, 2, gl.FLOAT, false, 0, 0);

        

        gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput);
        gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput);
        const outputDataRGBA = webglUtilsModule.readDataFromTexture(gl, fbOutput, texWidth, 1, false);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        console.log(`[WebGL Subtract Debug] Raw output from GPU (RGBA, len ${outputDataRGBA.length}): [${Array.from(outputDataRGBA).join(', ')}]`);

        const gpuResultLimbs = new Float32Array(texWidth);
        const gpuShaderBorrows = new Float32Array(texWidth);
        for (let i = 0; i < texWidth; i++) {
            gpuResultLimbs[i] = outputDataRGBA[i * 4 + 0];
            gpuShaderBorrows[i] = outputDataRGBA[i * 4 + 1];
        }
        console.log(`[WebGL Subtract Debug] GPU Result Limbs (from .r): [${Array.from(gpuResultLimbs).join(', ')}]`);
        console.log(`[WebGL Subtract Debug] GPU Shader Borrows (from .g): [${Array.from(gpuShaderBorrows).join(', ')}]`);

        const actualLimbsArrLSL = [];
        let currentPropagatedBorrow = 0;
        for (let i = 0; i < texWidth; i++) {
            let diff = gpuResultLimbs[i] - currentPropagatedBorrow;
            if (diff < 0) {
                actualLimbsArrLSL.push(diff + BASE);
                currentPropagatedBorrow = 1;
            } else {
                actualLimbsArrLSL.push(diff);
                currentPropagatedBorrow = 0;
            }
            currentPropagatedBorrow += gpuShaderBorrows[i];
            currentPropagatedBorrow = Math.min(currentPropagatedBorrow, 1);
        }

        console.log(`[WebGL Subtract Debug] Actual Limbs (LSL first, after CPU borrow propagation): [${actualLimbsArrLSL.join(', ')}]`);
        if (currentPropagatedBorrow > 0) {
            console.warn(`[WebGL Subtract Debug] Final propagated borrow is ${currentPropagatedBorrow}. This might indicate minuend < subtrahend passed to _webgl_subtract.`);
        }

        while (actualLimbsArrLSL.length > 1 && actualLimbsArrLSL[actualLimbsArrLSL.length - 1] === 0) {
            actualLimbsArrLSL.pop();
        }
        if (actualLimbsArrLSL.length === 0) actualLimbsArrLSL.push(0);


        return actualLimbsArrLSL;

    } catch (e) {
        console.error("[WebGL Subtract Debug] WebGL execution error in _webgl_subtract:", e.message, e.stack);
        throw e;
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
        }
        console.log("[WebGL Subtract Debug] WebGL resources cleaned up (if initialized).");
    }
  }

  _webgl_multiply_full(num1, num2) {
    let gl;
    let program = null, texNum1 = null, texNum2 = null, fbOutput = null, positionBuffer = null, texCoordBuffer = null, texPartialProducts = null;
    let sumColumnsProgram = null, propagateCarriesProgram = null;
    let currentInputTexture = null, currentOutputTexture = null, currentOutputFramebuffer = null;
    let texColumnSums = null;
    let texSumPing = null, texSumPong = null, fbSumPing = null, fbSumPong = null;
    let texPropagatePing = null, texPropagatePong = null, fbPropagatePing = null, fbPropagatePong = null;
    let currentPropagateInputTexture = null, currentPropagateOutputTexture = null, currentPropagateOutputFramebuffer = null;

    // Specific debug for "7" * "8" case
    const isDebugCaseMultiply = num1.limbs.length === 1 && num1.limbs[0] === 7 && num2.limbs.length === 1 && num2.limbs[0] === 8;

    try {
        gl = webglUtilsModule.initWebGL(this.canvas);
        if (!gl || !gl.getExtension('OES_texture_float')) {
            throw new Error("WebGL not supported or float textures not available for full multiplication.");
        }
        while (gl.getError() !== gl.NO_ERROR) {}

        const num1Limbs = num1.limbs;
        const num2Limbs = num2.limbs;

        if (isDebugCaseMultiply) {
            console.log(`[Multiply Debug 7*8] num1: ${num1.toString()}, num2: ${num2.toString()}`);
            console.log(`[Multiply Debug 7*8] num1.limbs: [${num1Limbs.join(',')}], num2.limbs: [${num2Limbs.join(',')}]`);
        }

        const maxInputLen = Math.max(num1Limbs.length, num2Limbs.length);
        const resultLen = num1Limbs.length + num2Limbs.length;

        if (isDebugCaseMultiply) {
            console.log(`[Multiply Debug 7*8] maxInputLen: ${maxInputLen}, resultLen: ${resultLen}`);
        }
        if (maxInputLen === 0) {
            console.warn("[Multiply Debug] maxInputLen is 0, returning zero result.");
            const zeroResult = new BigIntPrimitive("0", this.canvas, {forceCPU: true});
            zeroResult.exponent = num1.exponent + num2.exponent;
            return zeroResult;
        }

        const paddedNum1Limbs = new Float32Array(maxInputLen);
        for (let i = 0; i < num1Limbs.length; i++) paddedNum1Limbs[i] = num1Limbs[i];
        const paddedNum2Limbs = new Float32Array(maxInputLen);
        for (let i = 0; i < num2Limbs.length; i++) paddedNum2Limbs[i] = num2Limbs[i];

        texNum1 = webglUtilsModule.createDataTexture(gl, paddedNum1Limbs, maxInputLen, 1, false);
        texNum2 = webglUtilsModule.createDataTexture(gl, paddedNum2Limbs, maxInputLen, 1, false);

        const productTexWidth = maxInputLen;
        const productTexHeight = maxInputLen;
        texPartialProducts = webglUtilsModule.createDataTexture(gl, null, productTexWidth, productTexHeight, true);

        fbOutput = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texPartialProducts, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error('WebGL framebuffer incomplete for full multiplication.');
        }

        const vsMultiply = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, multiplyFullVertexShaderSrc);
        const fsMultiply = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, multiplyFullFragmentShaderSrc);
        program = webglUtilsModule.createProgram(gl, vsMultiply, fsMultiply);
        if (!program) throw new Error('WebGL program creation failed for full multiplication.');
        gl.useProgram(program);

        if (isDebugCaseMultiply) {
            console.log(`[Multiply Debug 7*8] productTexWidth: ${productTexWidth}, productTexHeight: ${productTexHeight}`);
            console.log(`[Multiply Debug 7*8] paddedNum1Limbs: [${Array.from(paddedNum1Limbs).join(',')}]`);
            console.log(`[Multiply Debug 7*8] paddedNum2Limbs: [${Array.from(paddedNum2Limbs).join(',')}]`);
        }

        const uNum1Loc = gl.getUniformLocation(program, "u_num1Texture");
        const uNum2Loc = gl.getUniformLocation(program, "u_num2Texture");
        const uTexWidthLoc = gl.getUniformLocation(program, "u_texWidth");
        const uBaseLoc = gl.getUniformLocation(program, "u_base");

        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texNum1); gl.uniform1i(uNum1Loc, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNum2); gl.uniform1i(uNum2Loc, 1);
        gl.uniform1f(uTexWidthLoc, productTexWidth);
        gl.uniform1f(uBaseLoc, BASE);

        positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
        const posAttrLoc = gl.getAttribLocation(program, "a_position");
        gl.enableVertexAttribArray(posAttrLoc);
        gl.vertexAttribPointer(posAttrLoc, 2, gl.FLOAT, false, 0, 0);

        texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);
        const texCoordAttrLoc = gl.getAttribLocation(program, "a_texCoord");
        gl.enableVertexAttribArray(texCoordAttrLoc);
        gl.vertexAttribPointer(texCoordAttrLoc, 2, gl.FLOAT, false, 0, 0);

        gl.viewport(0, 0, productTexWidth, productTexHeight);
        gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        if (isDebugCaseMultiply) {
            const partialProductsDataRGBA = webglUtilsModule.readDataFromTexture(gl, fbOutput, productTexWidth, productTexHeight, false);
            console.log(`[Multiply Debug 7*8] Pass 1 (PartialProducts) output (RGBA, ${productTexWidth}x${productTexHeight}): [${Array.from(partialProductsDataRGBA).join(',')}]`);
        }

        const vsSumColumns = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, multiplyFullVertexShaderSrc);
        const fsSumColumns = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, sumColumnsFragmentShaderSrc);
        sumColumnsProgram = webglUtilsModule.createProgram(gl, vsSumColumns, fsSumColumns);
        if (!sumColumnsProgram) throw new Error('WebGL program creation failed for column summation.');
        gl.useProgram(sumColumnsProgram);

        const uInputTexLocSum = gl.getUniformLocation(sumColumnsProgram, "u_inputTexture");
        const uTexHeightLocSum = gl.getUniformLocation(sumColumnsProgram, "u_textureHeight");
        const uBaseLocSum = gl.getUniformLocation(sumColumnsProgram, "u_base");

        currentInputTexture = texPartialProducts;
        let currentSumInputHeight = productTexHeight;
        texSumPing = webglUtilsModule.createDataTexture(gl, null, productTexWidth, productTexHeight, true);
        texSumPong = webglUtilsModule.createDataTexture(gl, null, productTexWidth, productTexHeight, true);
        fbSumPing = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbSumPing);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texSumPing, 0);
        fbSumPong = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbSumPong);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texSumPong, 0);

        currentOutputTexture = texSumPing;
        currentOutputFramebuffer = fbSumPing;

        while (currentSumInputHeight > 1) {
            const outputHeight = Math.ceil(currentSumInputHeight / 2);
            gl.bindFramebuffer(gl.FRAMEBUFFER, currentOutputFramebuffer);
            gl.viewport(0, 0, productTexWidth, outputHeight);
            gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);

            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, currentInputTexture); gl.uniform1i(uInputTexLocSum, 0);
            gl.uniform1f(uTexHeightLocSum, currentSumInputHeight);
            gl.uniform1f(uBaseLocSum, BASE);

            gl.drawArrays(gl.TRIANGLES, 0, 6);

            let tempTex = currentInputTexture;
            currentInputTexture = currentOutputTexture;
            currentOutputTexture = tempTex;
            currentOutputFramebuffer = (currentOutputFramebuffer === fbSumPing) ? fbSumPong : fbSumPing;
            currentSumInputHeight = outputHeight;
        }
        texColumnSums = currentInputTexture;

        let fbToReadColumnSumsFrom;
        if (productTexHeight === 1 && texColumnSums === texPartialProducts) {
            fbToReadColumnSumsFrom = fbOutput;
        } else {
            fbToReadColumnSumsFrom = (texColumnSums === texSumPing) ? fbSumPing : fbSumPong;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, fbToReadColumnSumsFrom);
        const texColumnSumsDataRGBA = webglUtilsModule.readDataFromTexture(gl, fbToReadColumnSumsFrom, productTexWidth, 1, false);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        if (isDebugCaseMultiply) {
            console.log(`[Multiply Debug 7*8] Pass 2 (ColumnSums) output (RGBA, ${productTexWidth}x1): [${Array.from(texColumnSumsDataRGBA).join(',')}]`);
        }

        // Pass 2.5: JS Pre-processing to prepare initial values for carry propagation.
        let propagateTexWidthActual = resultLen + 1;
        let propagateTexWidthForTexture = propagateTexWidthActual;

        if (propagateTexWidthForTexture < 4 && propagateTexWidthForTexture > 0) {
            console.warn(`[Multiply Debug] Padded propagateTexWidthForTexture from ${propagateTexWidthActual} to 4`);
            propagateTexWidthForTexture = 4;
        } else if (propagateTexWidthForTexture === 0 ) {
             console.warn(`[Multiply Debug] original propagateTexWidth was 0, setting to 1 for texture operations.`);
             propagateTexWidthForTexture = 1;
             if(propagateTexWidthActual === 0) propagateTexWidthActual = 1;
        }


        const initialPropagationDataR = new Float32Array(propagateTexWidthForTexture);
        for (let k = 0; k < propagateTexWidthActual; k++) {
            const L_k = (k < productTexWidth) ? texColumnSumsDataRGBA[k * 4 + 0] : 0;
            const C_k_minus_1 = (k > 0 && (k - 1) < productTexWidth) ? texColumnSumsDataRGBA[(k - 1) * 4 + 1] : 0;
            if (k < initialPropagationDataR.length) {
                initialPropagationDataR[k] = L_k + C_k_minus_1;
            }
        }

        if (isDebugCaseMultiply) {
            console.log(`[Multiply Debug 7*8] Pass 2.5 (InitialPropagationDataR for Pass 3 input, texture_width ${propagateTexWidthForTexture}, data_content_width ${propagateTexWidthActual}): [${Array.from(initialPropagationDataR).join(',')}]`);
        }

        texPropagatePing = webglUtilsModule.createDataTexture(gl, initialPropagationDataR, propagateTexWidthForTexture, 1, false);
        texPropagatePong = webglUtilsModule.createDataTexture(gl, null, propagateTexWidthForTexture, 1, true);

        fbPropagatePing = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbPropagatePing);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texPropagatePing, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer for texPropagatePing incomplete.');

        fbPropagatePong = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbPropagatePong);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texPropagatePong, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer for texPropagatePong incomplete.');

        const vsPropagate = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, multiplyFullVertexShaderSrc);
        const fsPropagate = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, propagateCarriesFragmentShaderSrc);
        propagateCarriesProgram = webglUtilsModule.createProgram(gl, vsPropagate, fsPropagate);
        if (!propagateCarriesProgram) throw new Error('WebGL program creation failed for carry propagation.');
        gl.useProgram(propagateCarriesProgram);

        const uInputTexLocProp = gl.getUniformLocation(propagateCarriesProgram, "u_inputTexture");
        const uCarryInTexLocProp = gl.getUniformLocation(propagateCarriesProgram, "u_carryInTexture");
        const uBaseLocProp = gl.getUniformLocation(propagateCarriesProgram, "u_base");
        const uTexWidthLocProp = gl.getUniformLocation(propagateCarriesProgram, "u_textureWidth");

        currentPropagateInputTexture = texPropagatePing;
        currentPropagateOutputTexture = texPropagatePong;
        currentPropagateOutputFramebuffer = fbPropagatePong;

        let carriesRemaining = true;
        let iterationCount = 0;
        const MAX_ITERATIONS = resultLen + 5;

        while (carriesRemaining && iterationCount < MAX_ITERATIONS) {
            carriesRemaining = false;
            iterationCount++;

            gl.bindFramebuffer(gl.FRAMEBUFFER, currentPropagateOutputFramebuffer);
            gl.viewport(0, 0, propagateTexWidthForTexture, 1);
            gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);

            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, currentPropagateInputTexture); gl.uniform1i(uInputTexLocProp, 0);
            if (uCarryInTexLocProp) {
                 gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, currentPropagateInputTexture); gl.uniform1i(uCarryInTexLocProp, 1);
            }

            gl.uniform1f(uBaseLocProp, BASE);
            gl.uniform1f(uTexWidthLocProp, propagateTexWidthForTexture);

            gl.drawArrays(gl.TRIANGLES, 0, 6);

            const outputData = webglUtilsModule.readDataFromTexture(gl, currentPropagateOutputFramebuffer, propagateTexWidthForTexture, 1, false);
            if (isDebugCaseMultiply && iterationCount === 1) {
                 console.log(`[Multiply Debug 7*8] Pass 3 (Carry Propagation) iter 1 output (RGBA, ${propagateTexWidthForTexture}x1): [${Array.from(outputData).join(',')}]`);
            }

            for (let i = 0; i < propagateTexWidthActual; i++) {
                if (outputData[i * 4 + 1] > 0) {
                    carriesRemaining = true;
                    break;
                }
            }

            let tempTex = currentPropagateInputTexture;
            currentPropagateInputTexture = currentOutputTexture;
            currentPropagateOutputTexture = tempTex;
            currentPropagateOutputFramebuffer = (currentPropagateOutputFramebuffer === fbPropagatePing) ? fbPropagatePong : fbPropagatePing;
        }
        const finalResultTexture = currentPropagateInputTexture;
        const finalResultFramebuffer = (currentPropagateInputTexture === texPropagatePing) ? fbPropagatePing : fbPropagatePong;

        const finalResultRGBA = webglUtilsModule.readDataFromTexture(gl, finalResultFramebuffer, propagateTexWidthForTexture, 1, false);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        if (isDebugCaseMultiply) {
            console.log(`[Multiply Debug 7*8] Pass 3 Final Output (RGBA, ${propagateTexWidthForTexture}x1): [${Array.from(finalResultRGBA).join(',')}]`);
        }

        const finalLimbs = [];
        for (let i = 0; i < propagateTexWidthActual; i++) {
            const val = finalResultRGBA[i * 4 + 0];
            finalLimbs.push(val === undefined || isNaN(val) ? 0 : val);
        }
         if (isDebugCaseMultiply) {
            console.log(`[Multiply Debug 7*8] Final Limbs (LSL, sanitized, original_width ${propagateTexWidthActual}): [${finalLimbs.join(',')}]`);
        }


        let resultCoeffStr = "";
        if (finalLimbs.length === 0) {
            resultCoeffStr = "0";
        } else {
            let mostSignificantLimbIndex = finalLimbs.length - 1;
            while (mostSignificantLimbIndex > 0 && finalLimbs[mostSignificantLimbIndex] === 0) {
                mostSignificantLimbIndex--;
            }
            if (isDebugCaseMultiply) {
                console.log(`[Multiply Debug 7*8] mostSignificantLimbIndex: ${mostSignificantLimbIndex}`);
                console.log(`[Multiply Debug 7*8] finalLimbs[mostSignificantLimbIndex]: ${finalLimbs[mostSignificantLimbIndex]}`);
            }
            resultCoeffStr = String(finalLimbs[mostSignificantLimbIndex]);
            for (let i = mostSignificantLimbIndex - 1; i >= 0; i--) {
                resultCoeffStr += String(finalLimbs[i]).padStart(BASE_LOG10, '0');
            }
        }
        if (resultCoeffStr === "") resultCoeffStr = "0";
        if (isDebugCaseMultiply) {
            console.log(`[Multiply Debug 7*8] Result Coeff String: ${resultCoeffStr}`);
        }


        const resultBigInt = BigIntPrimitive.fromCoefficientString(resultCoeffStr, this.canvas, { forceCPU: true });
        resultBigInt.exponent = num1.exponent + num2.exponent;

        return resultBigInt;

    } catch (e) {
        console.error("WebGL full multiply path error:", e);
        throw e;
    } finally {
        if (gl) {
            if (program) gl.deleteProgram(program);
            if (sumColumnsProgram) gl.deleteProgram(sumColumnsProgram);
            if (propagateCarriesProgram) gl.deleteProgram(propagateCarriesProgram);
            if (texNum1) gl.deleteTexture(texNum1);
            if (texNum2) gl.deleteTexture(texNum2);
            if (texPartialProducts) gl.deleteTexture(texPartialProducts);
            if (texColumnSums && texColumnSums !== texPartialProducts && texColumnSums !== texSumPing && texColumnSums !== texSumPong) {
                 gl.deleteTexture(texColumnSums);
            }
            if (texSumPing && texSumPing !== texColumnSums) gl.deleteTexture(texSumPing);
            if (texSumPong && texSumPong !== texColumnSums) gl.deleteTexture(texSumPong);
            if (fbSumPing) gl.deleteFramebuffer(fbSumPing);
            if (fbSumPong) gl.deleteFramebuffer(fbSumPong);
            if (texPropagatePing) gl.deleteTexture(texPropagatePing);
            if (texPropagatePong) gl.deleteTexture(texPropagatePong);
            if (fbPropagatePing) gl.deleteFramebuffer(fbPropagatePing);
            if (fbPropagatePong) gl.deleteFramebuffer(fbPropagatePong);
            if (fbOutput) gl.deleteFramebuffer(fbOutput);
            if (positionBuffer) gl.deleteBuffer(positionBuffer);
            if (texCoordBuffer) gl.deleteBuffer(texCoordBuffer);
        }
    }
  }

  _multiply_limb_by_bigint(limbValue, otherNumber) {
      if (limbValue === 0 || otherNumber.isZero()) {
        return new BigIntPrimitive("0", this.canvas, { forceCPU: true });
      }

      const oLR = [...otherNumber.limbs].reverse();
      let rL = [];
      let c = 0;

      for (let i = 0; i < oLR.length; i++) {
        const p = oLR[i] * limbValue + c;
        rL.push(p % BASE);
        c = Math.floor(p / BASE);
      }
      while (c > 0) {
        rL.push(c % BASE);
        c = Math.floor(c / BASE);
      }

      let fL = rL.reverse();
      while (fL.length > 1 && fL[0] === 0) { fL.shift(); }
      if (fL.length === 0) fL = [0];

      const res = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
      res.limbs = fL;
      res.sign = 1;
      res.exponent = 0;
      if(res.isZero()) res.exponent = 0;
      return res;
  }

   _core_multiply_cpu(num1, num2) {
    if (num1.isZero() || num2.isZero()) {
        return new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    }
    if (num1.isZero() || num2.isZero()) {
        return new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    }

    let tR = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    const n1LR = [...num1.limbs].reverse();

    for (let i = 0; i < n1LR.length; i++) {
        const d1 = n1LR[i];
        if (d1 === 0 && n1LR.length > 1 && num1.limbs.length > 1) continue;

        let pPM = this._multiply_limb_by_bigint(d1, num2);

        if (!pPM.isZero()) {
            let pPMcoeffStr = "";
            if (pPM.limbs.length > 0) {
                pPMcoeffStr = String(pPM.limbs[0]);
                for (let k = 1; k < pPM.limbs.length; k++) {
                    pPMcoeffStr += String(pPM.limbs[k]).padStart(BASE_LOG10, '0');
                }
            } else {
                pPMcoeffStr = "0";
            }

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
        tR.sign = 1;
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
    const finalExponent = self.exponent + otherBigInt.exponent;
    const resultSign = (self.sign === otherBigInt.sign) ? 1 : -1;

    const selfCoeff = new BigIntPrimitive(this, this.canvas, {forceCPU: true});
    selfCoeff.sign = 1; selfCoeff.exponent = 0;

    const otherCoeff = new BigIntPrimitive(otherBigInt, this.canvas, {forceCPU: true});
    otherCoeff.sign = 1; otherCoeff.exponent = 0;

    let absResult;
    let gl;
    if (!self.forceCPU && !otherBigInt.forceCPU && self.canvas && typeof webglUtilsModule !== 'undefined' && (gl = webglUtilsModule.initWebGL(self.canvas))) {
      try {
        absResult = self._webgl_multiply_full(selfCoeff, otherCoeff);
      } catch (e) {
        console.warn("WebGL full multiply failed, falling back to CPU:", e);
        absResult = self._core_multiply_cpu(selfCoeff, otherCoeff);
      }
    } else {
       absResult = self._core_multiply_cpu(selfCoeff, otherCoeff);
    }
    absResult.exponent = finalExponent;
    absResult.sign = resultSign;
    if (absResult.isZero()) {
        absResult.sign = 1; absResult.exponent = 0;
    } else {
    }
    return absResult;
  }

  _createTextureForBigInt(gl, bigIntValue, texWidth, texHeight = 1, isOutputTexture = false) {
    if (!(bigIntValue instanceof BigIntPrimitive)) {
        throw new TypeError("_createTextureForBigInt expects a BigIntPrimitive instance.");
    }
    if (!gl) {
        throw new Error("_createTextureForBigInt requires a WebGL context.");
    }

    let limbData;
    if (isOutputTexture) {
        limbData = null;
    } else {
        const lslLimbs = [...bigIntValue.limbs].reverse();
        const totalElements = texWidth * texHeight;
        limbData = new Float32Array(totalElements);
        for (let i = 0; i < totalElements; i++) {
            limbData[i] = (i < lslLimbs.length) ? lslLimbs[i] : 0;
        }
    }
    return webglUtilsModule.createDataTexture(gl, limbData, texWidth, texHeight, isOutputTexture);
  }

  _bigIntFromTextureData(gl, framebuffer, texWidth, texHeight = 1, targetExponent, targetSign) {
    if (!gl) {
        throw new Error("_bigIntFromTextureData requires a WebGL context.");
    }
    if (!framebuffer) {
        throw new Error("_bigIntFromTextureData requires a framebuffer to read from.");
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const textureDataRGBA = webglUtilsModule.readDataFromTexture(gl, framebuffer, texWidth, texHeight, false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const lslLimbs = [];
    const totalElements = texWidth * texHeight;
    for (let i = 0; i < totalElements; i++) {
        lslLimbs.push(textureDataRGBA[i * 4 + 0]);
    }

    while (lslLimbs.length > 1 && lslLimbs[lslLimbs.length - 1] === 0) {
        lslLimbs.pop();
    }
    if (lslLimbs.length === 0) lslLimbs.push(0);

    let coeffStr = "";
    if (lslLimbs.length > 0) {
        coeffStr = String(lslLimbs[lslLimbs.length - 1]);
        for (let i = lslLimbs.length - 2; i >= 0; i--) {
            coeffStr += String(lslLimbs[i]).padStart(BASE_LOG10, '0');
        }
    } else {
        coeffStr = "0";
    }

    if (coeffStr === "") coeffStr = "0";

    const resultBigInt = BigIntPrimitive.fromCoefficientString(coeffStr, this.canvas, { forceCPU: true });
    resultBigInt.exponent = targetExponent;
    resultBigInt.sign = targetSign;

    if (resultBigInt.isZero()) {
        resultBigInt.exponent = 0;
        resultBigInt.sign = 1;
    }
    return resultBigInt;
  }

  _webgl_multiply_textures(gl, texA, texAWidth, texB, texBWidth, targetResultLimbLength) {
    let program = null, texPartialProducts = null, fbPartialProducts = null;
    let sumColumnsProgram = null, propagateCarriesProgram = null;
    let currentInputTexture = null, currentOutputTexture = null, currentOutputFramebuffer = null;
    let texColumnSums = null;
    let texSumPing = null, texSumPong = null, fbSumPing = null, fbSumPong = null;
    let texPropagatePing = null, texPropagatePong = null, fbPropagatePing = null, fbPropagatePong = null;
    let positionBuffer = null, texCoordBuffer = null;

    try {
        if (!gl || !gl.getExtension('OES_texture_float')) {
            throw new Error("WebGL not supported or float textures not available for texture multiplication.");
        }
        while (gl.getError() !== gl.NO_ERROR) {}

        const productTexWidth = Math.max(texAWidth, texBWidth);
        const productTexHeight = productTexWidth;

        texPartialProducts = webglUtilsModule.createDataTexture(gl, null, productTexWidth, productTexHeight, true);
        fbPartialProducts = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbPartialProducts);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texPartialProducts, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error('WebGL framebuffer incomplete for partial products in texture multiplication.');
        }

        const vsMultiply = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, multiplyFullVertexShaderSrc);
        const fsMultiply = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, multiplyFullFragmentShaderSrc);
        program = webglUtilsModule.createProgram(gl, vsMultiply, fsMultiply);
        if (!program) throw new Error('WebGL program creation failed for multiplyFullFragmentShaderSrc.');
        gl.useProgram(program);

        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texA); gl.uniform1i(gl.getUniformLocation(program, "u_num1Texture"), 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texB); gl.uniform1i(gl.getUniformLocation(program, "u_num2Texture"), 1);
        gl.uniform1f(gl.getUniformLocation(program, "u_texWidth"), productTexWidth);
        gl.uniform1f(gl.getUniformLocation(program, "u_base"), BASE);

        positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
        const posAttrLoc = gl.getAttribLocation(program, "a_position");
        gl.enableVertexAttribArray(posAttrLoc);
        gl.vertexAttribPointer(posAttrLoc, 2, gl.FLOAT, false, 0, 0);

        texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);
        const texCoordAttrLoc = gl.getAttribLocation(program, "a_texCoord");
        gl.enableVertexAttribArray(texCoordAttrLoc);
        gl.vertexAttribPointer(texCoordAttrLoc, 2, gl.FLOAT, false, 0, 0);

        gl.viewport(0, 0, productTexWidth, productTexHeight);
        gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        const vsSumColumns = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, multiplyFullVertexShaderSrc);
        const fsSumColumns = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, sumColumnsFragmentShaderSrc);
        sumColumnsProgram = webglUtilsModule.createProgram(gl, vsSumColumns, fsSumColumns);
        if (!sumColumnsProgram) throw new Error('WebGL program creation failed for sumColumnsFragmentShaderSrc.');
        gl.useProgram(sumColumnsProgram);

        currentInputTexture = texPartialProducts;
        let currentSumInputHeight = productTexHeight;
        texSumPing = webglUtilsModule.createDataTexture(gl, null, productTexWidth, productTexHeight, true);
        texSumPong = webglUtilsModule.createDataTexture(gl, null, productTexWidth, productTexHeight, true);
        fbSumPing = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbSumPing); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texSumPing, 0);
        fbSumPong = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbSumPong); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texSumPong, 0);

        currentOutputTexture = texSumPing;
        currentOutputFramebuffer = fbSumPing;

        while (currentSumInputHeight > 1) {
            const outputHeight = Math.ceil(currentSumInputHeight / 2);
            gl.bindFramebuffer(gl.FRAMEBUFFER, currentOutputFramebuffer);
            gl.viewport(0, 0, productTexWidth, outputHeight);
            gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);

            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, currentInputTexture); gl.uniform1i(gl.getUniformLocation(sumColumnsProgram, "u_inputTexture"), 0);
            gl.uniform1f(gl.getUniformLocation(sumColumnsProgram, "u_textureHeight"), currentSumInputHeight);
            gl.uniform1f(gl.getUniformLocation(sumColumnsProgram, "u_base"), BASE);

            gl.drawArrays(gl.TRIANGLES, 0, 6);

            let tempTex = currentInputTexture; currentInputTexture = currentOutputTexture; currentOutputTexture = tempTex;
            currentOutputFramebuffer = (currentOutputFramebuffer === fbSumPing) ? fbSumPong : fbSumPing;
            currentSumInputHeight = outputHeight;
        }
        texColumnSums = currentInputTexture;

        let fbToReadColumnSumsFrom = (productTexHeight === 1 && texColumnSums === texPartialProducts) ? fbPartialProducts : ((texColumnSums === texSumPing) ? fbSumPing : fbSumPong);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbToReadColumnSumsFrom);
        const texColumnSumsDataRGBA = webglUtilsModule.readDataFromTexture(gl, fbToReadColumnSumsFrom, productTexWidth, 1, false);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        const propagateTexWidth = targetResultLimbLength;
        const initialPropagationDataR = new Float32Array(propagateTexWidth);
        for (let k = 0; k < propagateTexWidth; k++) {
            const L_k = (k < productTexWidth) ? texColumnSumsDataRGBA[k * 4 + 0] : 0;
            const C_k_minus_1 = (k > 0 && (k - 1) < productTexWidth) ? texColumnSumsDataRGBA[(k - 1) * 4 + 1] : 0;
            initialPropagationDataR[k] = L_k + C_k_minus_1;
        }

        texPropagatePing = webglUtilsModule.createDataTexture(gl, initialPropagationDataR, propagateTexWidth, 1, false);
        texPropagatePong = webglUtilsModule.createDataTexture(gl, null, propagateTexWidth, 1, true);
        fbPropagatePing = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbPropagatePing); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texPropagatePing, 0);
        fbPropagatePong = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbPropagatePong); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texPropagatePong, 0);

        const vsPropagate = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, multiplyFullVertexShaderSrc);
        const fsPropagate = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, propagateCarriesFragmentShaderSrc);
        propagateCarriesProgram = webglUtilsModule.createProgram(gl, vsPropagate, fsPropagate);
        if (!propagateCarriesProgram) throw new Error('WebGL program creation failed for propagateCarriesFragmentShaderSrc.');
        gl.useProgram(propagateCarriesProgram);

        currentPropagateInputTexture = texPropagatePing;
        currentPropagateOutputTexture = texPropagatePong;
        currentPropagateOutputFramebuffer = fbPropagatePong;

        let carriesRemaining = true; let iterationCount = 0; const MAX_ITERATIONS = propagateTexWidth + 5;
        while (carriesRemaining && iterationCount < MAX_ITERATIONS) {
            iterationCount++; carriesRemaining = false;
            gl.bindFramebuffer(gl.FRAMEBUFFER, currentPropagateOutputFramebuffer);
            gl.viewport(0, 0, propagateTexWidth, 1);
            gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);

            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, currentPropagateInputTexture); gl.uniform1i(gl.getUniformLocation(propagateCarriesProgram, "u_inputTexture"), 0);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, currentPropagateInputTexture); gl.uniform1i(gl.getUniformLocation(propagateCarriesProgram, "u_carryInTexture"), 1);
            gl.uniform1f(gl.getUniformLocation(propagateCarriesProgram, "u_base"), BASE);
            gl.uniform1f(gl.getUniformLocation(propagateCarriesProgram, "u_textureWidth"), propagateTexWidth);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            const outputData = webglUtilsModule.readDataFromTexture(gl, currentPropagateOutputFramebuffer, propagateTexWidth, 1, false);
            for (let i = 0; i < propagateTexWidth; i++) {
                if (outputData[i * 4 + 1] > 0) {
                    carriesRemaining = true;
                    break;
                }
            }
            let tempTex = currentPropagateInputTexture; currentPropagateInputTexture = currentOutputTexture; currentOutputTexture = tempTex;
            currentPropagateOutputFramebuffer = (currentPropagateOutputFramebuffer === fbPropagatePing) ? fbPropagatePong : fbPropagatePing;
        }

        const finalResultTexture = currentPropagateInputTexture;
        const finalResultFramebuffer = (currentPropagateOutputFramebuffer === fbPropagatePing) ? fbPropagatePong : fbPropagatePing;

        if (program) gl.deleteProgram(program);
        if (sumColumnsProgram) gl.deleteProgram(sumColumnsProgram);
        if (propagateCarriesProgram) gl.deleteProgram(propagateCarriesProgram);
        if (texPartialProducts) gl.deleteTexture(texPartialProducts);
        if (fbPartialProducts) gl.deleteFramebuffer(fbPartialProducts);
        if (texColumnSums && texColumnSums !== texPartialProducts && texColumnSums !== texSumPing && texColumnSums !== texSumPong) gl.deleteTexture(texColumnSums);

        if (texSumPing && texSumPing !== finalResultTexture) gl.deleteTexture(texSumPing);
        if (fbSumPing && fbSumPing !== finalResultFramebuffer) gl.deleteFramebuffer(fbSumPing);
        if (texSumPong && texSumPong !== finalResultTexture) gl.deleteTexture(texSumPong);
        if (fbSumPong && fbSumPong !== finalResultFramebuffer) gl.deleteFramebuffer(fbSumPong);

        if (texPropagatePing && texPropagatePing !== finalResultTexture) gl.deleteTexture(texPropagatePing);
        if (fbPropagatePing && fbPropagatePing !== finalResultFramebuffer) gl.deleteFramebuffer(fbPropagatePing);
        if (texPropagatePong && texPropagatePong !== finalResultTexture) gl.deleteTexture(texPropagatePong);
        if (fbPropagatePong && fbPropagatePong !== finalResultFramebuffer) gl.deleteFramebuffer(fbPropagatePong);

        if (positionBuffer) gl.deleteBuffer(positionBuffer);
        if (texCoordBuffer) gl.deleteBuffer(texCoordBuffer);

        return { texture: finalResultTexture, framebuffer: finalResultFramebuffer, width: propagateTexWidth, height: 1 };

    } catch (e) {
        console.error("WebGL multiply textures error:", e);
        if (gl) {
            if (program) gl.deleteProgram(program);
            if (sumColumnsProgram) gl.deleteProgram(sumColumnsProgram);
            if (propagateCarriesProgram) gl.deleteProgram(propagateCarriesProgram);
            if (texPartialProducts) gl.deleteTexture(texPartialProducts);
            if (fbPartialProducts) gl.deleteFramebuffer(fbPartialProducts);
            if (texColumnSums && texColumnSums !== texPartialProducts && texColumnSums !== texSumPing && texColumnSums !== texSumPong) gl.deleteTexture(texColumnSums);
            if (texSumPing) gl.deleteTexture(texSumPing);
            if (fbSumPing) gl.deleteFramebuffer(fbSumPing);
            if (texSumPong) gl.deleteTexture(texSumPong);
            if (fbSumPong) gl.deleteFramebuffer(fbSumPong);
            if (texPropagatePing) gl.deleteTexture(texPropagatePing);
            if (fbPropagatePing) gl.deleteFramebuffer(fbPropagatePing);
            if (texPropagatePong) gl.deleteTexture(texPropagatePong);
            if (fbPropagatePong) gl.deleteFramebuffer(fbPropagatePong);
            if (positionBuffer) gl.deleteBuffer(positionBuffer);
            if (texCoordBuffer) gl.deleteBuffer(texCoordBuffer);
        }
        throw e;
    }
  }

  _webgl_subtract_textures(gl, texMinuend, texSubtrahend, texWidth) {
    let program = null, texOutput = null, fbOutput = null, positionBuffer = null, texCoordBuffer = null;
    let texBorrowIn = null; // Declare here for finally block

    try {
        if (!gl || !gl.getExtension('OES_texture_float')) {
            throw new Error("WebGL not supported or float textures not available for texture subtraction.");
        }
        while (gl.getError() !== gl.NO_ERROR) {}

        const vs = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, subtractVertexShaderSrc);
        const fs = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, subtractFragmentShaderSrc);
        program = webglUtilsModule.createProgram(gl, vs, fs);
        if (!program) throw new Error('WebGL program creation failed for subtraction shader in texture subtraction.');
        gl.useProgram(program);

        texOutput = webglUtilsModule.createDataTexture(gl, null, texWidth, 1, true);
        fbOutput = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error('WebGL framebuffer incomplete for texture subtraction.');
        }

        gl.viewport(0, 0, texWidth, 1);

        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texMinuend);
        gl.uniform1i(gl.getUniformLocation(program, "u_num1Texture"), 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texSubtrahend);
        gl.uniform1i(gl.getUniformLocation(program, "u_num2Texture"), 1);

        const borrowInLimbs = new Float32Array(texWidth).fill(0);
        texBorrowIn = webglUtilsModule.createDataTexture(gl, borrowInLimbs, texWidth, 1, false);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texBorrowIn);
        gl.uniform1i(gl.getUniformLocation(program, "u_borrowTexture"), 2);


        positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
        const posAttrLoc = gl.getAttribLocation(program, "a_position");
        gl.enableVertexAttribArray(posAttrLoc);
        gl.vertexAttribPointer(posAttrLoc, 2, gl.FLOAT, false, 0, 0);

        texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);
        const texCoordAttrLoc = gl.getAttribLocation(program, "a_texCoord");
         if (texCoordAttrLoc !== -1) {
            gl.enableVertexAttribArray(texCoordAttrLoc);
            gl.vertexAttribPointer(texCoordAttrLoc, 2, gl.FLOAT, false, 0, 0);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput);
        gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return { texture: texOutput, framebuffer: fbOutput, width: texWidth, height: 1 };

    } catch (e) {
        console.error("WebGL subtract textures error:", e);
        throw e; // Re-throw after cleanup attempt in finally
    } finally {
        if (gl) {
            if (program) gl.deleteProgram(program);
            if (positionBuffer) gl.deleteBuffer(positionBuffer);
            if (texCoordBuffer) gl.deleteBuffer(texCoordBuffer);
            if (texBorrowIn) gl.deleteTexture(texBorrowIn);
            // texOutput and fbOutput are returned, so not cleaned here on success
            // On error, the caller or a higher-level try/catch should handle them if partially created.
        }
    }
  }

  _webgl_reciprocal(gl, texB, texBWidth, texX0, texX0Width, numIterations, targetPrecisionLimbs) {
    let texCurrentX = texX0;
    let currentXWidth = texX0Width;
    let texCurrentX = texX0;
    let currentXWidth = texX0Width;
    let fbCurrentX = null;
    let texTwo = null, fbTwo = null;
    let createdResources = []; // To track resources for cleanup

    try {
        const twoValue = new BigIntPrimitive("2", this.canvas, {forceCPU: true});
        // Ensure texTwo is wide enough for all operations.
        // It needs to be at least as wide as the widest intermediate result it might be subtracted from/by.
        // Max width could be targetPrecisionLimbs (for X_next) or productLimbPrecision (for B*X_i).
        const texTwoWidth = Math.max(targetPrecisionLimbs, texBWidth + currentXWidth) + 5; // Ensure texTwo is wide enough

        texTwo = this._createTextureForBigInt(gl, twoValue, texTwoWidth, 1, false);
        fbTwo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbTwo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texTwo, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        createdResources.push({texture: texTwo, framebuffer: fbTwo});

        console.log(`[Reciprocal Start] Iterations: ${numIterations}, Target Limbs: ${targetPrecisionLimbs}`);
        console.log(`[Reciprocal Start] Initial X0 width: ${currentXWidth}, texTwoWidth: ${texTwoWidth}`);

        for (let i = 0; i < numIterations; i++) {
            console.log(`[Reciprocal Iteration ${i+1}] Current X width: ${currentXWidth}`);

            const productLimbPrecision = Math.min(targetPrecisionLimbs, currentXWidth + texBWidth + 2);
            console.log(`[Reciprocal Iteration ${i+1}] B*X_i product precision: ${productLimbPrecision}`);

            const bxResult = this._webgl_multiply_textures(gl, texB, texBWidth, texCurrentX, currentXWidth, productLimbPrecision);
            createdResources.push(bxResult);
            console.log(`[Reciprocal Iteration ${i+1}] B*X_i result texture width: ${bxResult.width}`);

            const subtractionWidth = bxResult.width;
            console.log(`[Reciprocal Iteration ${i+1}] 2-(B*X_i) subtraction input widths: texTwo (${texTwoWidth}), texBX (${bxResult.width}) -> effective width ${subtractionWidth}`);
            const twoMinusBXResult = this._webgl_subtract_textures(gl, texTwo, bxResult.texture, subtractionWidth);
            createdResources.push(twoMinusBXResult);

            gl.deleteTexture(bxResult.texture);
            gl.deleteFramebuffer(bxResult.framebuffer);
            createdResources = createdResources.filter(r => r.texture !== bxResult.texture);


            console.log(`[Reciprocal Iteration ${i+1}] X_next = X_i * (2-BX) target precision: ${targetPrecisionLimbs}`);
            const nextXResult = this._webgl_multiply_textures(gl, texCurrentX, currentXWidth, twoMinusBXResult.texture, twoMinusBXResult.width, targetPrecisionLimbs);

            if (texCurrentX !== texX0) {
                 if(texCurrentX) gl.deleteTexture(texCurrentX);
                 if(fbCurrentX) gl.deleteFramebuffer(fbCurrentX);
            }
            createdResources = createdResources.filter(r => r.texture !== texCurrentX && r.texture !== twoMinusBXResult.texture);
            gl.deleteTexture(twoMinusBXResult.texture);
            gl.deleteFramebuffer(twoMinusBXResult.framebuffer);

            texCurrentX = nextXResult.texture;
            fbCurrentX = nextXResult.framebuffer;
            currentXWidth = nextXResult.width;

            console.log(`[Reciprocal Iteration ${i+1}] New X width: ${currentXWidth}`);
        }
        return { texture: texCurrentX, framebuffer: fbCurrentX, width: currentXWidth, height: 1 };

    } catch(e) {
        console.error("Error in _webgl_reciprocal:", e);
        createdResources.forEach(r => {
            if (r.texture) gl.deleteTexture(r.texture);
            if (r.framebuffer) gl.deleteFramebuffer(r.framebuffer);
        });
        if (texCurrentX && texCurrentX !== texX0) gl.deleteTexture(texCurrentX);
        if (fbCurrentX) gl.deleteFramebuffer(fbCurrentX);
        throw e;
    } finally {
        if (texTwo && (!fbCurrentX || texCurrentX !== texTwo)) {
             gl.deleteTexture(texTwo);
        }
        if (fbTwo && (!fbCurrentX || fbCurrentX !== fbTwo)) {
            gl.deleteFramebuffer(fbTwo);
        }
    }
}


  pow(exp) {
    if (typeof exp !== 'number' || !Number.isInteger(exp)) { throw new TypeError("Exponent must be an integer."); }

    if (exp < 0) {
      const one = new BigIntPrimitive("1", this.canvas, { forceCPU: this.forceCPU });
      const positivePowerResult = this.pow(Math.abs(exp));
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
      throw new Error("[big.js] Division by zero");
    }
    if (this.isZero()) {
      return new BigIntPrimitive("0", this.canvas);
    }

    const quotientSign = (this.sign === divisorBigInt.sign) ? 1 : -1;
    const absDividend = this.abs();
    const absDivisor = divisorBigInt.abs();
    let texB_prime = null, fbB_prime = null, texX0 = null, fbX0 = null, reciprocalResult = null;


    // WebGL Path Attempt
    if (!this.forceCPU && !absDivisor.forceCPU && this.canvas && typeof webglUtilsModule !== 'undefined' ) {
        let gl = webglUtilsModule.initWebGL(this.canvas);
        if (gl && gl.getExtension('OES_texture_float')) {
            try {
                let divisorCoeffStr = absDivisor.limbs.map((l,idx) => idx === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0')).join('');
                divisorCoeffStr = divisorCoeffStr.replace(/^0+/, '');
                if (divisorCoeffStr === "") divisorCoeffStr = "0";
                if (divisorCoeffStr === "0") throw new Error("Division by zero (divisor coefficient is zero).");

                const scale_exponent = absDivisor.exponent + divisorCoeffStr.length;

                const B_prime_bigint = new BigIntPrimitive("0", this.canvas, {forceCPU: true});
                B_prime_bigint.limbs = BigIntPrimitive.fromCoefficientString(divisorCoeffStr, this.canvas, {forceCPU:true}).limbs;
                B_prime_bigint.exponent = -B_prime_bigint.limbs.length * BASE_LOG10; // Exponent for 0.xxxx form
                B_prime_bigint.sign = 1;

                let X0_float;
                const first_digit_str = divisorCoeffStr.substring(0,1);
                const first_digit_val = parseInt(first_digit_str, 10);

                if (first_digit_val === 0) {
                     throw new Error("Normalized divisor B_prime starts with zero, unexpected.");
                } else {
                     // Create a string like "0.12345" for parseFloat
                     let tempCoeffForApprox = divisorCoeffStr;
                     let shiftForApprox = 0;
                     if (tempCoeffForApprox.length > 15) tempCoeffForApprox = tempCoeffForApprox.substring(0,15); // Limit length for float precision

                     const bPrimeApproxStr = "0." + tempCoeffForApprox;
                     const bPrimeApproxNum = parseFloat(bPrimeApproxStr);

                     if (bPrimeApproxNum === 0) throw new Error("parseFloat(B_prime approximation) is zero.");
                     X0_float = 1.0 / bPrimeApproxNum;
                }

                const tempDP = BigIntPrimitive.DP;
                const internalReciprocalDP = Math.max(BigIntPrimitive.DP, divisorCoeffStr.length + B_prime_bigint.limbs.length) + 15;
                BigIntPrimitive.DP = internalReciprocalDP;
                const X0_bigint = new BigIntPrimitive(X0_float.toPrecision(20), this.canvas, {forceCPU: true});
                BigIntPrimitive.DP = tempDP;

                console.log(`[GPU Divide Path] absDivisor: ${absDivisor.toString()}, B_prime: ${B_prime_bigint.toString()}, scale_exponent: ${scale_exponent}`);
                console.log(`[GPU Divide Path] Initial guess X0 for 1/B_prime: ${X0_bigint.toString()} (from float ${X0_float})`);

                const B_prime_width = B_prime_bigint.limbs.length + 2;
                const X0_width = X0_bigint.limbs.length + 2;
                const targetPrecisionLimbs = Math.ceil(internalReciprocalDP / BASE_LOG10) + B_prime_width + X0_width + 5; // Generous precision for reciprocal

                texB_prime = this._createTextureForBigInt(gl, B_prime_bigint, B_prime_width, 1, false);
                // fbB_prime is not strictly needed if texB_prime is input-only to _webgl_reciprocal
                texX0 = this._createTextureForBigInt(gl, X0_bigint, X0_width, 1, false);
                // fbX0 similarly

                const numIterations = 4;
                reciprocalResult = this._webgl_reciprocal(gl, texB_prime, B_prime_width, texX0, X0_width, numIterations, targetPrecisionLimbs);

                // Determine exponent for inv_B_prime_webgl:
                // B_prime_bigint.exponent is like -N (for N limbs in its fractional part).
                // X0_bigint.exponent is usually positive (e.g., for 1/0.5 = 2, exp=1).
                // The result of reciprocal should be roughly 1 / B_prime_bigint.
                // If B_prime_bigint is 0.d1d2d3... (exponent = -number_of_fractional_limbs)
                // Then 1/B_prime_bigint is approximately 10^(number_of_fractional_limbs) / (d1d2d3...).
                // The exponent of the resulting BigInt from texture data has to be figured out.
                // Let's assume the texture data represents an integer coefficient.
                // The exponent for inv_B_prime_webgl should make its value approximately 1/B_prime_bigint.
                // Since B_prime_bigint is < 1, inv_B_prime_webgl will be > 1.
                // Its exponent will be roughly -(B_prime_bigint.exponent) - (number of limbs in inv_B_prime_webgl - 1)
                // This is very heuristic.
                let inv_B_prime_exponent_guess = 1 - reciprocalResult.width; // Heuristic: if result is "X.YYY", width is #limbs for XYYY.
                                                                        // If B_prime was 0.5 (1 limb frac), 1/B_prime = 2 (1 limb int). exp = 1-1=0.
                                                                        // If B_prime was 0.005 (1 limb frac, but value shifted), 1/B_prime = 200.
                                                                        // This needs to be more robust.
                                                                        // The value from texture is an integer coefficient.
                                                                        // The exponent of B_prime_bigint is - (num limbs of B_prime_bigint.coeff)
                                                                        // The exponent of X0_bigint can be positive.
                                                                        // The exponent of the result from _bigIntFromTextureData needs to be set so that
                                                                        // (B_prime_bigint_value) * (inv_B_prime_webgl_value) approx = 1.
                                                                        // B_prime_bigint.exponent is e.g. -3 if it's 0.xyz
                                                                        // inv_B_prime_webgl should have exponent such that its value is 10^3 / xyz
                                                                        // If inv_B_prime_webgl coefficient has L limbs, its value is coeff * BASE^(exp_inv_B_prime)
                                                                        // (coeff_B * BASE^(exp_B)) * (coeff_inv_B * BASE^(exp_inv_B)) = 1
                                                                        // coeff_B * coeff_inv_B * BASE^(exp_B + exp_inv_B) = 1
                                                                        // log_BASE(coeff_B * coeff_inv_B) + exp_B + exp_inv_B = 0
                                                                        // exp_inv_B = -exp_B - log_BASE(coeff_B * coeff_inv_B)
                                                                        // exp_inv_B is roughly -exp_B - (limbs_B + limbs_inv_B -1) if thinking about raw coefficient product
                                                                        // Let's use a simpler heuristic for now: the exponent of the reciprocal is such that its first limb is the integer part.
                                                                        // So, exponent = (1 - number of limbs in the result).

                const inv_B_prime_webgl = this._bigIntFromTextureData(gl, reciprocalResult.framebuffer, reciprocalResult.width, 1, 0, 1); // Initial exponent 0 for coeff
                // Adjust exponent: if B_prime_bigint is 0.C (exp_B = -len(C)), then 1/B_prime is X.Y (exp_X = 1-len(XY))
                // So, final_exp_inv_B = -B_prime_bigint.exponent - (inv_B_prime_webgl.limbs.length - 1)
                // This is still not quite right. The exponent from _bigIntFromTextureData is relative to its coefficient string.
                // The exponent of inv_B_prime should be -(B_prime_bigint.exponent + B_prime_bigint.limbs.length) + 1 for the integer part.
                // Let's assume the result of reciprocal is a number like X.YZ, so its exponent should be -(number of fractional limbs).
                // The number of fractional limbs is result.width - 1 if the first limb is the integer part.
                // Heuristic: exponent = 1 - reciprocalResult.width (if first limb is integer part)
                // This is hard to get right without knowing the scale of numbers in texture.
                // For now, let's assume the texture from reciprocal is an integer, and its value is C.
                // We want C * 10^E_inv_b_prime to be approx 1 / (B_prime_coeff * 10^E_b_prime)
                // E_inv_b_prime = -E_b_prime - log10(B_prime_coeff * C)
                // The exponent of B_prime_bigint is already set correctly for its value.
                // The exponent of X0_bigint is also set for its value.
                // The result of _webgl_reciprocal contains limbs.
                // The exponent should be set such that (value of B_prime_bigint) * (value of inv_B_prime_webgl) is approx 1.
                // Let inv_B_prime_webgl.exponent = -B_prime_bigint.exponent - (inv_B_prime_webgl.limbs.length -1) - (B_prime_bigint.limbs.length-1); // very rough
                // A simpler approach: the result of reciprocal is X_n. Its exponent needs to be set relative to B_prime's exponent.
                // If B_prime is 0.xyz (exp = -num_frac_digits), then 1/B_prime is roughly 10^num_frac_digits / xyz.
                // The limbs from texture are L0, L1, ... Lk-1 (MSL to LSL). Coeff = L0*BASE^(k-1) + ...
                // We need Coeff * 10^(E_set) * B_prime_value = 1.
                // E_set = -log10(Coeff) - log10(B_prime_value).
                // Let's try: exponent for inv_B_prime_webgl = -B_prime_bigint.exponent - (number of significant limbs in inv_B_prime_webgl - 1 if value > 1)
                // The most important part is that B_prime_bigint.exponent is for 0.XXX form.
                // So inv_B_prime_webgl should have an exponent that makes it roughly 1 / (value of B_prime_bigint).
                // If B_prime_bigint is like C_B * 10^(E_B), and inv_B is C_invB * 10^(E_invB)
                // C_B * C_invB * 10^(E_B + E_invB) = 1.
                // E_invB = -E_B - log10(C_B * C_invB).
                // The _bigIntFromTextureData gives C_invB, and E_invB needs to be set.
                // The exponent of inv_B_prime_webgl should be set to make its value correct.
                // B_prime_bigint.exponent is like -(length of fractional part in digits).
                // The reciprocal will have an integer part. Its exponent should be -(length of its fractional part).
                // If reciprocal.width is W, assume W-1 fractional limbs if first limb is int part. Exp = -(W-1).
                // This is tricky. Let's use the CPU reciprocal's exponent as a guide for now.
                const cpu_reciprocal_for_exponent_guide = (new BigIntPrimitive("1", this.canvas, {forceCPU:true})).divide(B_prime_bigint);
                inv_B_prime_webgl.exponent = cpu_reciprocal_for_exponent_guide.exponent;


                console.log(`[GPU Divide Path] WebGL Reciprocal 1/B_prime: ${inv_B_prime_webgl.toString()} (exponent guided by CPU: ${inv_B_prime_webgl.exponent})`);

                gl.deleteTexture(texB_prime);
                if (texX0 !== reciprocalResult.texture) gl.deleteTexture(texX0); // texX0 might be returned by _webgl_reciprocal if iterations=0
                gl.deleteTexture(reciprocalResult.texture);
                gl.deleteFramebuffer(reciprocalResult.framebuffer);
                texB_prime = texX0 = reciprocalResult = null; // Mark as cleaned

                let quotient = absDividend.multiply(inv_B_prime_webgl);
                quotient.exponent -= scale_exponent;
                quotient.sign = quotientSign;

                if (quotient.isZero()) {
                    quotient.exponent = 0;
                    quotient.sign = 1;
                }

                quotient = quotient.round(BigIntPrimitive.DP, BigIntPrimitive.RM);
                if (quotient.isZero() && BigIntPrimitive.DP > 0) {
                    quotient._roundedDp = BigIntPrimitive.DP;
                }

                console.log(`[GPU Divide Path] Final quotient: ${quotient.toString()}`);
                return quotient;

            } catch (e) {
                console.warn("WebGL divide path error, falling back to CPU:", e);
                if (gl) {
                    if (texB_prime) gl.deleteTexture(texB_prime);
                    if (texX0 && (!reciprocalResult || texX0 !== reciprocalResult.texture)) gl.deleteTexture(texX0);
                    if (reciprocalResult && reciprocalResult.texture) gl.deleteTexture(reciprocalResult.texture);
                    if (reciprocalResult && reciprocalResult.framebuffer) gl.deleteFramebuffer(reciprocalResult.framebuffer);
                }
            }
        }
    }

    // CPU Path (original logic)
    const internalPrecisionCPU = BigIntPrimitive.DP + (this.exponent > 0 ? this.exponent : 0) +
                              (divisorBigInt.exponent > 0 ? divisorBigInt.exponent : 0) +
                              Math.max(String(this.limbs[0]).length, String(divisorBigInt.limbs[0]).length) + 5;

    let quotientCPU = absDividend._decimalDivide(absDivisor, internalPrecisionCPU);
    quotientCPU = quotientCPU.round(BigIntPrimitive.DP, BigIntPrimitive.RM);

    if (quotientCPU.isZero() && BigIntPrimitive.DP > 0) {
      quotientCPU._roundedDp = BigIntPrimitive.DP;
    }
    if (quotientCPU.isZero()) {
      if (typeof quotientCPU._roundedDp !== 'number' || quotientCPU._roundedDp === 0) {
         quotientCPU.sign = 1;
      }
      quotientCPU.exponent = 0;
    } else {
      quotientCPU.sign = quotientSign;
    }
    return quotientCPU;
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
        if (dp > 0 && zero.sign === -1) zero.sign = 1;
        else if (dp === 0 && zero.sign === -1) {  }
        else zero.sign = 1;
        return zero;
    }

    let coeffStr = this.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('');

    const numDigitsInCoeff = coeffStr.length;
    const effectiveIntegerDigits = numDigitsInCoeff + this.exponent;

    const decisionIndex = effectiveIntegerDigits + dp;

    const newCoeffStr = this._staticRound_cpu(coeffStr, decisionIndex, roundingMode, this.sign === -1);

    const result = BigIntPrimitive.fromCoefficientString(newCoeffStr, this.canvas, { forceCPU: this.forceCPU });
    result.sign = (result.isZero()) ? 1 : this.sign;

    result.exponent = -dp;

    if (result.isZero()) {
        result.exponent = 0;
        if (this.sign === -1 && dp === 0 && newCoeffStr === "0") {
             result.sign = -1;
        } else {
             result.sign = 1;
        }
    }

    const rdp = result._roundedDp;
    const rexp = result.exponent;
    const rId = result._instanceId;
    console.log(`[round EXIT ID: ${this._instanceId}] ret ID: ${rId}, ret._roundedDp: ${rdp}, ret.exp: ${rexp}`);
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

    let coeffStr = this.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('');
    let currentExponent = this.exponent;

    let sciExp = (coeffStr.length - 1) + currentExponent;

    const significand = Ctor.fromCoefficientString(coeffStr, this.canvas, { forceCPU: true });
    significand.exponent = currentExponent - sciExp;
    significand.sign = 1;

    const dpForRounding = (dp === undefined) ? coeffStr.length - 1 : dp;

    let roundedSignificand = significand.round(dpForRounding, actualRm);

    let roundedCoeffStr = roundedSignificand.limbs.map((l, i) => (i === 0) ? String(l) : String(l).padStart(BASE_LOG10, '0')).join('');
    let roundedCoeffExp = roundedSignificand.exponent;

    let roundedNumIntegerDigits = roundedCoeffStr.length + roundedCoeffExp;

    if (roundedCoeffStr !== "0" && roundedNumIntegerDigits !== 1) {
        sciExp += (roundedNumIntegerDigits - 1);
        roundedSignificand.exponent -= (roundedNumIntegerDigits - 1);
        if (dp !== undefined) {
             roundedSignificand = roundedSignificand.round(dp, actualRm);
        }
    }

    let finalCoeffStr = roundedSignificand.toString();

    if (dp !== undefined) {
        let parts = finalCoeffStr.split('.');
        if (dp === 0) {
            finalCoeffStr = parts[0];
        } else {
            let fractionalPart = parts[1] || "";
            finalCoeffStr = parts[0] + "." + fractionalPart.padEnd(dp, '0').substring(0, dp);
        }
    } else {
        if (finalCoeffStr.includes('.') && !finalCoeffStr.substring(finalCoeffStr.indexOf('.')+1).match(/[1-9]/) ) {
            finalCoeffStr = finalCoeffStr.split('.')[0];
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

    if (typeof dp !== 'number' || !Number.isInteger(dp) || dp < 0 || dp > 1e6 ) {
        throw new RangeError("Invalid decimal places");
    }

    const oldPE = BigIntPrimitive.PE; BigIntPrimitive.PE = 1e9;
    const oldNE = BigIntPrimitive.NE; BigIntPrimitive.NE = -1e9;

    const roundedNum = this.round(dp, actualRm);
    console.log(`[toFixed after round ID: ${this._instanceId}] roundedNum ID: ${roundedNum._instanceId}, roundedNum._roundedDp: ${roundedNum._roundedDp}`);

    BigIntPrimitive.PE = oldPE; BigIntPrimitive.NE = oldNE;
    roundedNum._roundedDp = dp;

    const s = roundedNum.toString();
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
    const sLimbsLength = S.limbs.map(l => String(l).length).reduce((a,b)=>a+b,0) - (S.limbs.length > 0 ? S.limbs.length-1 : 0) + (S.limbs.length > 1 ? (S.limbs.length-1)*(BASE_LOG10-String(S.limbs[0]).length) : 0) ;
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

      const y = current_x.add(S.divide(current_x)).divide(two);

      const y_rounded_string = y.round(guardDP, originalRM).toString();
      if (prev_x_rounded_string === y_rounded_string) {
        current_x = y;
        break;
      }
      current_x = y;
    }

    BigIntPrimitive.DP = originalDP;
    BigIntPrimitive.RM = originalRM;

    return current_x.round(originalDP, originalRM);
  }

  prec(sdUndefined, rmUndefined) {
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
      zeroResult._roundedDp = sd -1;
      return zeroResult;
    }

    const exponentialString = this.toExponential(sd - 1, actualRm);
    const resultInstance = new Ctor(exponentialString, this.canvas, { forceCPU: this.forceCPU });
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
      console.log(`[toPrecision RETURNING ZEROVAL ID: ${this._instanceId}] final string: '${returnValue}', type: ${typeof returnValue}`);
      return returnValue;
    }

    const roundedNum = this.prec(sd, actualRm);

    console.log(`[toPrecision PRE-SCI-CALC ID: ${this._instanceId}] roundedNum ID: ${roundedNum._instanceId}, roundedNum.exponent: ${roundedNum.exponent}, roundedNum._roundedDp: ${roundedNum._roundedDp}`);

    if (roundedNum.isZero()) {
        str = "0";
        if (sd > 1) str += "." + "0".repeat(sd - 1);
        let returnValue = str;
        console.log(`[toPrecision RETURNING ROUNDEDZEROVAL ID: ${this._instanceId}] final string: '${returnValue}', type: ${typeof returnValue}`);
        return returnValue;
    }

    console.log(`[toPrecision PRE-COEFF-STR-CALC ID: ${this._instanceId}] For roundedNum (ID: ${roundedNum._instanceId}), roundedNum.limbs: ${JSON.stringify(roundedNum.limbs)}, BASE_LOG10 (module const): ${BASE_LOG10}`);
    const roundedNumCoeffStr = roundedNum.limbs.map((l, i) => (i === 0) ? String(l) : String(l).padStart(BASE_LOG10, '0')).join('');
    const roundedNumCurrentExponent = roundedNum.exponent;
    console.log(`[toPrecision SCI-CALC INPUTS ID: ${this._instanceId}] roundedNumId: ${roundedNum._instanceId}, roundedNumCoeffStr: '${roundedNumCoeffStr}', roundedNumCoeffStr.length: ${roundedNumCoeffStr.length}, roundedNumCurrentExponent: ${roundedNumCurrentExponent}`);
    const sciExp = (roundedNumCoeffStr.length - 1) + roundedNumCurrentExponent;

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
    const Ctor = this.constructor;
    let isNegative = isNegativeOriginal;

    if (coeffStr === "0") return "0";

    if (decisionIndex <= 0) {
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
        return shouldRoundUpToOne ? "1" : "0";
    }

    if (decisionIndex > coeffStr.length) {
        return coeffStr + '0'.repeat(decisionIndex - coeffStr.length);
    }

    if (decisionIndex === coeffStr.length) {
        return coeffStr;
    }

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
    if (rm === Ctor.roundDown) {  }
    else if (rm === Ctor.roundHalfUp) { if (roundingDigit >= 5) increment = true; }
    else if (rm === Ctor.roundHalfEven) {
        if (roundingDigit > 5) increment = true;
        else if (roundingDigit === 5) {
            if (!exactHalf) increment = true;
            else {
                const prevDigit = partToKeep.length > 0 ? parseInt(partToKeep[partToKeep.length - 1], 10) : 0;
                if (prevDigit % 2 !== 0) increment = true;
            }
        }
    } else if (rm === Ctor.roundUp) {
        if (isNegative) {  }
        else if (roundingDigit > 0 || !exactHalf) {
            increment = true;
        }
    }

    if (increment) {
        if (partToKeep === "") partToKeep = "0";
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
        if (i < 0) {
            newCoeffArr.unshift('1');
        }
        partToKeep = newCoeffArr.join('');
    }

    return partToKeep === "" ? "0" : partToKeep;
};

BigIntPrimitive.prototype._webgl_multiply_one_limb_by_bigint = function(limbValue, otherBigInt) {
    if (limbValue === 0 || otherBigInt.isZero()) {
        return new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    }

    let gl;
    let program, texOtherNumber, texOutput, fbOutput, positionBuffer, texCoordBuffer;

    try {
        gl = webglUtilsModule.initWebGL(this.canvas);
        if (!gl || !gl.getExtension('OES_texture_float')) {
            throw new Error("WebGL not supported or float textures not available.");
        }

        while (gl.getError() !== gl.NO_ERROR) {
        }

        const otherLimbs = [...otherBigInt.limbs].reverse();
        const texWidth = otherLimbs.length + 3;

        const otherLimbsF32 = new Float32Array(texWidth);
        for (let i = 0; i < otherLimbs.length; i++) {
            otherLimbsF32[i] = otherLimbs[i];
        }

        console.log(`[WebGL MultLimb Debug] Entry: limbValueToMultiply=${limbValue}, otherNumber=${otherBigInt.toString()}`);
        console.log(`[WebGL MultLimb Debug Step 1] Prepared otherLimbsF32 (LSL first, len ${texWidth}): [${Array.from(otherLimbsF32).join(', ')}]`);


        if (typeof multiplyLimbVertexShaderSrc !== 'string' || typeof multiplyLimbFragmentShaderSrc !== 'string') {
            throw new Error('Multiply limb shader source not loaded');
        }
        const vs = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, multiplyLimbVertexShaderSrc);
        const fs = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, multiplyLimbFragmentShaderSrc);

        if (vs) console.log("[WebGL MultLimb Debug] Vertex shader compiled. Info: " + gl.getShaderInfoLog(vs)); else console.error("[WebGL MultLimb Debug] Vertex shader FAILED compilation.");
        if (fs) console.log("[WebGL MultLimb Debug] Fragment shader compiled. Info: " + gl.getShaderInfoLog(fs)); else console.error("[WebGL MultLimb Debug] Fragment shader FAILED compilation.");

        program = webglUtilsModule.createProgram(gl, vs, fs);
        if (!program) {
            throw new Error('WebGL program creation failed for multiply limb.');
        } else {
            console.log("[WebGL MultLimb Debug] Program linked. Info: " + gl.getProgramInfoLog(program));
        }

        gl.useProgram(program);

        texOtherNumber = webglUtilsModule.createDataTexture(gl, otherLimbsF32, texWidth, 1, false);
        texOutput = webglUtilsModule.createDataTexture(gl, null, texWidth, 1, true);
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

        const uOtherNumberTexLoc = gl.getUniformLocation(program, "u_otherNumTexture");
        const uLimbValueLoc = gl.getUniformLocation(program, "u_limbValue");
        const uBaseLoc = gl.getUniformLocation(program, "u_base");
        const uTexWidthLoc = gl.getUniformLocation(program, "u_texWidth");

        console.log(`[WebGL MultLimb Debug Step 3] Locations: uOtherNumberTexLoc=${uOtherNumberTexLoc}, uLimbValueLoc=${uLimbValueLoc}, uBaseLoc=${uBaseLoc}, uTexWidthLoc=${uTexWidthLoc}`);

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

        gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        console.log("[WebGL MultLimb Debug Step 6] Shader executed.");

        gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput);
        console.log(`[WebGL MultLimb Debug PRE-READ] Reading from texture with texWidth: ${texWidth}`);
        const outputDataRGBA = webglUtilsModule.readDataFromTexture(gl, fbOutput, texWidth, 1, false);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        console.log(`[WebGL MultLimb Debug Step 7] Raw output from GPU (RGBA, len ${outputDataRGBA.length}): [${Array.from(outputDataRGBA).join(', ')}]`);

        const gpuLimbProducts = new Float32Array(texWidth);
        const gpuShaderCarries = new Float32Array(texWidth);
        for (let i = 0; i < texWidth; i++) {
            if ((i * 4 + 1) < outputDataRGBA.length) {
                gpuLimbProducts[i] = outputDataRGBA[i * 4 + 0];
                gpuShaderCarries[i] = outputDataRGBA[i * 4 + 1];
            } else {
                gpuLimbProducts[i] = 0;
                gpuShaderCarries[i] = 0;
                console.warn(`[WebGL MultLimb Debug] outputDataRGBA seems too short. Index ${i*4+1} out of length ${outputDataRGBA.length}. Using 0 for limb/carry.`);
            }
        }
        console.log(`[WebGL MultLimb Debug Step 8] GPU Limb Products (from .r): [${Array.from(gpuLimbProducts).join(', ')}]`);
        console.log(`[WebGL MultLimb Debug Step 9] GPU Shader Carries (from .g): [${Array.from(gpuShaderCarries).join(', ')}]`);

        const actualLimbsArrReversed = [];
        let currentPropagatedCarry = 0;
        for (let i = 0; i < texWidth; i++) {
            let limbProductVal = isNaN(gpuLimbProducts[i]) ? 0 : gpuLimbProducts[i];
            let shaderCarryVal = isNaN(gpuShaderCarries[i]) ? 0 : gpuShaderCarries[i];

            let sumForThisLimb = limbProductVal + currentPropagatedCarry;
            actualLimbsArrReversed.push(sumForThisLimb % BASE);
            currentPropagatedCarry = Math.floor(sumForThisLimb / BASE) + shaderCarryVal;
        }
        while (currentPropagatedCarry > 0) {
            actualLimbsArrReversed.push(currentPropagatedCarry % BASE);
            currentPropagatedCarry = Math.floor(currentPropagatedCarry / BASE);
        }
        console.log(`[WebGL MultLimb Debug Step 10] Actual Limbs (LSL first, after CPU carry): [${actualLimbsArrReversed.join(', ')}]`);

        let finalCoeffStr = "";
        if (actualLimbsArrReversed.length === 0) {
            finalCoeffStr = "0";
        } else {
            let tempFinalLimbs = [...actualLimbsArrReversed].reverse();
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
        result.sign = 1;
        result.exponent = 0;
        if(result.isZero()) result.exponent = 0;

        console.log(`[WebGL MultLimb Debug Step 12] WebGL Result: ${result.toString()}`);
        return result;

    } catch (e) {
        console.error("[WebGL MultLimb Debug] WebGL execution error in _webgl_multiply_one_limb_by_bigint:", e.message, e.stack);
        return this._multiply_limb_by_bigint(limbValue, otherBigInt);
    } finally {
        if (gl) {
            if (program) gl.deleteProgram(program);
            if (texOtherNumber) gl.deleteTexture(texOtherNumber);
            if (texOutput) gl.deleteTexture(texOutput);
            if (fbOutput) gl.deleteFramebuffer(fbOutput);
            if (positionBuffer) gl.deleteBuffer(positionBuffer);
            if (texCoordBuffer) gl.deleteBuffer(texCoordBuffer);
        }
        console.log("[WebGL MultLimb Debug] WebGL resources cleaned up (if initialized).");
    }
};

export { BigIntPrimitive };

[end of lib/bigint.js]

[end of lib/bigint.js]
