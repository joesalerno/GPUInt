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
import sumAntidiagonalsFragmentShaderSrc from './shaders/sum_antidiagonals.frag?raw';

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
      this.sign = value.sign;
      this.exponent = value.exponent; // Assign exponent first
      this.limbs = [...value.limbs]; // Then limbs
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
    console.log(`[fromCoefficientString ENTRY] valueStr: '${valueStr}'`);
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
    console.log(`[fromCoefficientString PRE-RETURN] instance.limbs: [${instance.limbs.join(',')}] for input '${valueStr}'`);
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
    let program = null, texNum1 = null, texNum2 = null, fbPartialProducts = null, positionBuffer = null, texCoordBuffer = null, texPartialProducts = null;
    let sumAntidiagonalsProgram = null, propagateCarriesProgram = null;
    // let currentInputTexture = null, currentOutputTexture = null, currentOutputFramebuffer = null; // Might not be needed with direct pass
    let texCoeffSums = null, fbCoeffSums = null; // For sum_antidiagonals output
    // let texSumPing = null, texSumPong = null, fbSumPing = null, fbSumPong = null; // No longer needed for sum_columns
    let texPropagatePing = null, texPropagatePong = null, fbPropagatePing = null, fbPropagatePong = null;
    let currentPropagateInputTexture = null, currentPropagateOutputTexture = null, currentPropagateOutputFramebuffer = null;

    // Use LSL (Least Significant Limb first) for internal WebGL processing
    // Define these early as they might be used in debug flag definitions below.
    const num1LimbsLSL = [...num1.limbs].reverse(); // num1 is selfCoeff (exponent 0)
    const num2LimbsLSL = [...num2.limbs].reverse(); // num2 is otherCoeff (exponent 0)

    // Specific debug cases based on original limb values before reversing
    // num1 and num2 here are the coefficient versions (exponent 0)
    const is7x8Check = num1.limbs.length === 1 && num1.limbs[0] === 7 && num2.limbs.length === 1 && num2.limbs[0] === 8;
    const isLargeNumTimesOneCheck = num2.limbs.length === 1 && num2.limbs[0] === 1 && num1.limbs.length > 1;
    const is9999x9999Check = num1.limbs.length === 1 && num1.limbs[0] === 9999 && num2.limbs.length === 1 && num2.limbs[0] === 9999;

    // For is99999999x99999999, num1.limbs (MSL) would be [9999, 9999]
    const is99999999x99999999Check =
        (num1.limbs.length === 2 && num1.limbs[0] === 9999 && num1.limbs[1] === 9999 &&
         num2.limbs.length === 2 && num2.limbs[0] === 9999 && num2.limbs[1] === 9999);

    // Specific check for the failing large multiplication test case
    // num1 (selfCoeff) is "1234567890123456" -> limbs [1234, 5678, 9012, 3456] (MSL)
    // num2 (otherCoeff) is "9876543210987654" -> limbs [9876, 5432, 1098, 7654] (MSL)
    const isFailingLargeCaseCheck =
        num1.limbs.length === 4 && num1.limbs[0] === 1234 && num1.limbs[1] === 5678 && num1.limbs[2] === 9012 && num1.limbs[3] === 3456 &&
        num2.limbs.length === 4 && num2.limbs[0] === 9876 && num2.limbs[1] === 5432 && num2.limbs[2] === 1098 && num2.limbs[3] === 7654;

    let debugCaseName = "N/A";
    if (is7x8Check) {
        debugCaseName = "7*8";
    } else if (isLargeNumTimesOneCheck) {
        debugCaseName = "largeN*1";
    } else if (is9999x9999Check) {
        debugCaseName = "9999*9999";
    } else if (is99999999x99999999Check) {
        debugCaseName = "99999999*99999999";
    } else if (isFailingLargeCaseCheck) {
        debugCaseName = "FailingLargeCase";
    }

    const isDebugCaseMultiply = debugCaseName !== "N/A"; // True if any of the above specific cases match


    try {
        gl = webglUtilsModule.initWebGL(this.canvas);
        if (!gl || !gl.getExtension('OES_texture_float')) {
            throw new Error("WebGL not supported or float textures not available for full multiplication.");
        }
        while (gl.getError() !== gl.NO_ERROR) {} // Clear any existing GL errors

        // num1LimbsLSL and num2LimbsLSL are already defined above.

        if (isDebugCaseMultiply) {
            console.log(`[Multiply Debug 7*8] num1: ${num1.toString()}, num2: ${num2.toString()}`);
            console.log(`[Multiply Debug 7*8] num1.limbs (LSL): [${num1LimbsLSL.join(',')}], num2.limbs (LSL): [${num2LimbsLSL.join(',')}]`);
        }

        const lenA = num1LimbsLSL.length;
        const lenB = num2LimbsLSL.length;
        // resultLen is the number of limbs in the final product, typically lenA + lenB or lenA + lenB - 1
        // For S_k where k from 0 to lenA+lenB-2, so lenA+lenB-1 coefficients.
        const outputTexWidthCoeffSums = lenA + lenB -1;


        if (lenA === 0 || lenB === 0) { // Should be caught by isZero earlier, but good check
            console.warn("[Multiply Debug] One of the operands has zero limbs, returning zero result.");
            const zeroResult = new BigIntPrimitive("0", this.canvas, {forceCPU: true});
            zeroResult.exponent = num1.exponent + num2.exponent;
            return zeroResult;
        }

        // Pad to same length for texPartialProducts (square texture)
        // This might be an oversimplification if lenA and lenB are very different.
        // multiply_full.frag samples based on v_texCoord.x and v_texCoord.y mapped to this square dimension.
        const partialProductTexDim = Math.max(lenA, lenB);


        const paddedNum1LimbsLSL = new Float32Array(partialProductTexDim);
        for (let i = 0; i < lenA; i++) paddedNum1LimbsLSL[i] = num1LimbsLSL[i];
        const paddedNum2LimbsLSL = new Float32Array(partialProductTexDim);
        for (let i = 0; i < lenB; i++) paddedNum2LimbsLSL[i] = num2LimbsLSL[i];

        texNum1 = webglUtilsModule.createDataTexture(gl, paddedNum1LimbsLSL, partialProductTexDim, 1, false);
        texNum2 = webglUtilsModule.createDataTexture(gl, paddedNum2LimbsLSL, partialProductTexDim, 1, false);

        // Pass 1: Calculate Partial Products P_ij = A_i * B_j
        // Output: texPartialProducts (2D texture, partialProductTexDim x partialProductTexDim)
        // Each element stores (P_ij % BASE, floor(P_ij / BASE))
        texPartialProducts = webglUtilsModule.createDataTexture(gl, null, partialProductTexDim, partialProductTexDim, true);
        fbPartialProducts = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbPartialProducts);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texPartialProducts, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error('WebGL framebuffer incomplete for partial products.');
        }

        const vsMultiply = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, multiplyFullVertexShaderSrc);
        const fsMultiply = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, multiplyFullFragmentShaderSrc);
        program = webglUtilsModule.createProgram(gl, vsMultiply, fsMultiply);
        if (!program) throw new Error('WebGL program creation failed for multiply_full.frag.');
        gl.useProgram(program);

        if (isDebugCaseMultiply) {
            console.log(`[Multiply Debug 7*8] Pass 1 Inputs: partialProductTexDim=${partialProductTexDim}`);
            console.log(`[Multiply Debug 7*8] paddedNum1LimbsLSL: [${Array.from(paddedNum1LimbsLSL).join(',')}]`);
            console.log(`[Multiply Debug 7*8] paddedNum2LimbsLSL: [${Array.from(paddedNum2LimbsLSL).join(',')}]`);
        }

        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texNum1); gl.uniform1i(gl.getUniformLocation(program, "u_num1Texture"), 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNum2); gl.uniform1i(gl.getUniformLocation(program, "u_num2Texture"), 1);
        gl.uniform1f(gl.getUniformLocation(program, "u_texWidth"), partialProductTexDim); // texWidth for multiply_full is the dim of input limb textures
        gl.uniform1f(gl.getUniformLocation(program, "u_base"), BASE);

        positionBuffer = gl.createBuffer(); // Create and setup position buffer once
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
        const posAttrLocMultiply = gl.getAttribLocation(program, "a_position");
        gl.enableVertexAttribArray(posAttrLocMultiply);
        gl.vertexAttribPointer(posAttrLocMultiply, 2, gl.FLOAT, false, 0, 0);

        texCoordBuffer = gl.createBuffer(); // Create and setup texCoord buffer once
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);
        const texCoordAttrLocMultiply = gl.getAttribLocation(program, "a_texCoord");
        gl.enableVertexAttribArray(texCoordAttrLocMultiply);
        gl.vertexAttribPointer(texCoordAttrLocMultiply, 2, gl.FLOAT, false, 0, 0);

        gl.viewport(0, 0, partialProductTexDim, partialProductTexDim);
        gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        let errorCheck = gl.getError(); if (errorCheck !== gl.NO_ERROR) console.error(`[Multiply Debug ${debugCaseName}] GL Error after Pass 1 draw: ${errorCheck}`);


        if (isDebugCaseMultiply) {
            const partialProductsDataRGBA = webglUtilsModule.readDataFromTexture(gl, fbPartialProducts, partialProductTexDim, partialProductTexDim, false);
            console.log(`[Multiply Debug 7*8] Pass 1 (PartialProducts) output (RGBA, ${partialProductTexDim}x${partialProductTexDim}): [${Array.from(partialProductsDataRGBA).join(',')}]`);
        }
        if(vsMultiply) gl.deleteShader(vsMultiply); if(fsMultiply) gl.deleteShader(fsMultiply); gl.deleteProgram(program); program = null; // Clean up Pass 1 program

        // Pass 2: Sum Anti-diagonals S_k = sum(P_ij) for i+j=k
        // Input: texPartialProducts (2D)
        // Output: texCoeffSums (1D texture, width outputTexWidthCoeffSums)
        // Each element stores (S_k % BASE, floor(S_k / BASE) + sum_carries_from_Pij)
        texCoeffSums = webglUtilsModule.createDataTexture(gl, null, outputTexWidthCoeffSums, 1, true);
        fbCoeffSums = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbCoeffSums);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texCoeffSums, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error('WebGL framebuffer incomplete for coefficient sums.');
        }

        const vsSumAntiDiag = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, multiplyFullVertexShaderSrc); // Can reuse simple vertex shader
        const fsSumAntiDiag = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, sumAntidiagonalsFragmentShaderSrc);
        sumAntidiagonalsProgram = webglUtilsModule.createProgram(gl, vsSumAntiDiag, fsSumAntiDiag);
        if (!sumAntidiagonalsProgram) throw new Error('WebGL program creation failed for sum_antidiagonals.frag.');
        gl.useProgram(sumAntidiagonalsProgram);

        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texPartialProducts);
        gl.uniform1i(gl.getUniformLocation(sumAntidiagonalsProgram, "u_partialProductsTexture"), 0);
        // Corrected uniform name and type for u_texWidth (dimension of partialProductsTex)
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texPartialProducts);
        gl.uniform1i(gl.getUniformLocation(sumAntidiagonalsProgram, "u_partialProductsTexture"), 0);
        // Corrected uniform name and type for u_texWidth (dimension of partialProductsTex)
        gl.uniform1i(gl.getUniformLocation(sumAntidiagonalsProgram, "u_texWidth"), partialProductTexDim);
        gl.uniform1f(gl.getUniformLocation(sumAntidiagonalsProgram, "u_base"), BASE);

        const uKLocPass2 = gl.getUniformLocation(sumAntidiagonalsProgram, "u_k");
        if (uKLocPass2 === null || uKLocPass2 === -1) { // Check for invalid location robustly
             console.error("[Multiply Debug] Uniform u_k location not found in sumAntidiagonalsProgram.");
             throw new Error("Uniform u_k not found in sumAntidiagonalsProgram.");
        }
        // Removed uniforms not declared in sum_antidiagonals.frag (already done in previous step)

        // Re-bind attributes for the sumAntidiagonalsProgram (needed before any draw calls with this program)
        const posAttrLocSum = gl.getAttribLocation(sumAntidiagonalsProgram, "a_position");
        gl.enableVertexAttribArray(posAttrLocSum);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer); // Position data is already in this buffer
        gl.vertexAttribPointer(posAttrLocSum, 2, gl.FLOAT, false, 0, 0);

        const texCoordAttrLocSum = gl.getAttribLocation(sumAntidiagonalsProgram, "a_texCoord");
        gl.enableVertexAttribArray(texCoordAttrLocSum);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer); // TexCoord data is already in this buffer
        gl.vertexAttribPointer(texCoordAttrLocSum, 2, gl.FLOAT, false, 0, 0);

        // Loop for Pass 2: Iterate for each k, draw to the k-th pixel of texCoeffSums
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbCoeffSums); // Bind the framebuffer for texCoeffSums
        gl.clearColor(0,0,0,0); // Clear it once before the loop
        gl.clear(gl.COLOR_BUFFER_BIT);

        for (let k_val = 0; k_val < outputTexWidthCoeffSums; k_val++) {
            gl.uniform1i(uKLocPass2, k_val); // Set the current anti-diagonal index k
            gl.viewport(k_val, 0, 1, 1);    // Set viewport to target the k-th pixel column
            gl.drawArrays(gl.TRIANGLES, 0, 6); // Draw the quad, shader computes for this k
            errorCheck = gl.getError();
            if (errorCheck !== gl.NO_ERROR) {
                console.error(`[Multiply Debug ${debugCaseName}] GL Error after Pass 2 draw for k=${k_val}: ${errorCheck}`);
                // Potentially throw or break, depending on desired error handling
            }
        }
        // Restore viewport after the loop (e.g., to next pass's requirements or full canvas)
        // For Pass 3, the viewport will be set to (0, 0, propagateTexWidthForTexture, 1)
        // So, no specific restoration needed here if Pass 3 sets its own viewport.

        if (isDebugCaseMultiply) {
            // Reading the entire texture at once after all k have been drawn
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbCoeffSums); // Ensure correct FBO is bound for reading
            const coeffSumsDataRGBA = webglUtilsModule.readDataFromTexture(gl, fbCoeffSums, outputTexWidthCoeffSums, 1, false);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Unbind FBO
            console.log(`[Multiply Debug 7*8] Pass 2 (SumAntiDiagonals) output (RGBA, ${outputTexWidthCoeffSums}x1): [${Array.from(coeffSumsDataRGBA).join(',')}]`);
        }
        if(vsSumAntiDiag) gl.deleteShader(vsSumAntiDiag); if(fsSumAntiDiag) gl.deleteShader(fsSumAntiDiag); gl.deleteProgram(sumAntidiagonalsProgram); sumAntidiagonalsProgram = null;

        // Pass 3: Propagate Carries
        // Input: texCoeffSums (1D texture from sum_antidiagonals)
        // Output: final result limbs (1D texture)
        // This pass iteratively resolves carries.
        // The initial input for propagation will be texCoeffSums.
        // Its .r channel is the summed limb value (mod BASE), .g is the initial carry for that position.

        let propagateTexWidthActual = outputTexWidthCoeffSums + 1; // Potentially one more limb for final carry
        let propagateTexWidthForTexture = Math.max(4, propagateTexWidthActual); // Ensure texture width is at least 4 for some WebGL implementations if issues arise, or just use actual.
                                                                               // For now, let's use a slightly larger texture to be safe, can optimize later.
        propagateTexWidthForTexture = propagateTexWidthActual; // Revert to actual needed, padding if small can be issue.

        // Prepare initial data for propagation: take texCoeffSums and put it into a texture of width propagateTexWidthForTexture
        // If texCoeffSums is already suitable, we might directly use it or copy.
        // Let's read texCoeffSums and prepare initialPropagationDataR based on its content.
        const coeffSumsRawData = webglUtilsModule.readDataFromTexture(gl, fbCoeffSums, outputTexWidthCoeffSums, 1, false);
        const initialPropagationDataR = new Float32Array(propagateTexWidthForTexture * 4); // RGBA
        for (let k = 0; k < outputTexWidthCoeffSums; k++) {
            initialPropagationDataR[k * 4 + 0] = coeffSumsRawData[k*4+0]; // L_k from sum_antidiagonals
            initialPropagationDataR[k * 4 + 1] = coeffSumsRawData[k*4+1]; // C_k from sum_antidiagonals
            initialPropagationDataR[k * 4 + 2] = 0.0;
            initialPropagationDataR[k * 4 + 3] = 1.0;
        }
        // Fill remaining (if propagateTexWidthForTexture > outputTexWidthCoeffSums) with zeros
        for (let k = outputTexWidthCoeffSums; k < propagateTexWidthForTexture; k++) {
            initialPropagationDataR[k * 4 + 0] = 0.0;
            initialPropagationDataR[k * 4 + 1] = 0.0;
            initialPropagationDataR[k * 4 + 2] = 0.0;
            initialPropagationDataR[k * 4 + 3] = 1.0;
        }


        if (isDebugCaseMultiply) {
            const initialPropDataForLog = [];
            for(let i=0; i<propagateTexWidthForTexture; ++i) initialPropDataForLog.push(initialPropagationDataR[i*4], initialPropagationDataR[i*4+1]);
            console.log(`[Multiply Debug 7*8] Pass 3 Initial Data for Propagation (R,G pairs from texCoeffSums, texture_width ${propagateTexWidthForTexture}): [${initialPropDataForLog.join(',')}]`);
        }

        texPropagatePing = webglUtilsModule.createDataTexture(gl, initialPropagationDataR, propagateTexWidthForTexture, 1, true); // True because data is already RGBA
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
        // MAX_ITERATIONS for carry propagation should be related to propagateTexWidthForTexture
        const MAX_ITERATIONS = propagateTexWidthForTexture + 5;

        while (carriesRemaining && iterationCount < MAX_ITERATIONS) {
            carriesRemaining = false;
            iterationCount++;

            gl.bindFramebuffer(gl.FRAMEBUFFER, currentPropagateOutputFramebuffer);
            gl.viewport(0, 0, propagateTexWidthForTexture, 1);
            gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);

            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, currentPropagateInputTexture); gl.uniform1i(uInputTexLocProp, 0);
            // uCarryInTexLocProp is not used if propagate_carries.frag reads carry from previous texel in the same input texture.
            // if (uCarryInTexLocProp) { // This was for a different carry model
            //      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, currentPropagateInputTexture); gl.uniform1i(uCarryInTexLocProp, 1);
            // }

            gl.uniform1f(uBaseLocProp, BASE);
            gl.uniform1f(uTexWidthLocProp, propagateTexWidthForTexture);

            // Re-bind attributes for propagateCarriesProgram
            const posAttrLocProp = gl.getAttribLocation(propagateCarriesProgram, "a_position");
            gl.enableVertexAttribArray(posAttrLocProp);
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.vertexAttribPointer(posAttrLocProp, 2, gl.FLOAT, false, 0, 0);

            const texCoordAttrLocProp = gl.getAttribLocation(propagateCarriesProgram, "a_texCoord");
            gl.enableVertexAttribArray(texCoordAttrLocProp);
            gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
            gl.vertexAttribPointer(texCoordAttrLocProp, 2, gl.FLOAT, false, 0, 0);

            gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.finish(); // Ensure drawing is complete before reading
            errorCheck = gl.getError(); if (errorCheck !== gl.NO_ERROR) console.error(`[Multiply Debug ${debugCaseName}] GL Error after Pass 3 iter ${iterationCount} draw: ${errorCheck}`);

            // Read back the output of this iteration to check for remaining carries
            const outputData = webglUtilsModule.readDataFromTexture(gl, currentPropagateOutputFramebuffer, propagateTexWidthForTexture, 1, false); // false = get RGBA
            if (isDebugCaseMultiply && iterationCount <= 3) { // Log first few iterations
                const logDataDetailed = [];
                for(let i=0; i<propagateTexWidthForTexture; ++i) {
                    logDataDetailed.push(`R${i}:${outputData[i*4].toPrecision(10)} G${i}:${outputData[i*4+1].toPrecision(10)}`);
                }
                console.log(`[Multiply Debug ${debugCaseName}] Pass 3 (Carry Propagation) iter ${iterationCount} output (Detailed R,G pairs): [${logDataDetailed.join('; ')}]`);
            }

            for (let i = 0; i < propagateTexWidthForTexture; i++) {
                // Check .g channel for carries. Use a small epsilon for float comparison.
                if (Math.abs(outputData[i * 4 + 1]) > 0.0001) {
                    carriesRemaining = true;
                    break;
                }
            }
            if (iterationCount === 1 && !carriesRemaining && propagateTexWidthForTexture > 1) {
                 // If no carries on first iteration for non-trivial case, something might be wrong or it's a very simple number
                 console.log(`[Multiply Debug 7*8] Carry propagation finished in 1 iteration. Initial state might have been already resolved or error in shader.`);
            }


            let tempTex = currentPropagateInputTexture;
            currentPropagateInputTexture = currentPropagateOutputTexture;
            currentPropagateOutputTexture = tempTex;
            // Swap framebuffers by re-binding the texture to the other framebuffer
            // This is slightly confusing. The currentPropagateOutputFramebuffer IS the one we just drew to.
            // So, for the next iteration, currentPropagateInputTexture becomes currentPropagateOutputTexture (which was ping/pong).
            // And currentPropagateOutputFramebuffer needs to be the one associated with the NEW currentPropagateOutputTexture.
             if (currentPropagateOutputFramebuffer === fbPropagatePing) {
                currentPropagateOutputFramebuffer = fbPropagatePong;
             } else {
                currentPropagateOutputFramebuffer = fbPropagatePing;
             }
        }
        // After loop, currentPropagateInputTexture holds the final result texture
        const finalResultTexture = currentPropagateInputTexture;
        // And currentPropagateOutputFramebuffer is the one NOT last drawn to, so the one associated with finalResultTexture
        const finalResultFramebuffer = (finalResultTexture === texPropagatePing) ? fbPropagatePing : fbPropagatePong;

        gl.finish(); // Ensure all operations are complete before final read
        const finalResultRGBA = webglUtilsModule.readDataFromTexture(gl, finalResultFramebuffer, propagateTexWidthForTexture, 1, false);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        if (isDebugCaseMultiply) {
            const logData = []; for(let i=0; i<propagateTexWidthForTexture; ++i) logData.push(finalResultRGBA[i*4], finalResultRGBA[i*4+1]);
            console.log(`[Multiply Debug 7*8] Pass 3 Final Output (R,G pairs from texture_width ${propagateTexWidthForTexture}): [${logData.join(',')}]`);
        }

        const finalLimbsLSL = [];
        if (isDebugCaseMultiply) {
            console.log(`[Multiply Debug ${debugCaseName}] Raw finalResultRGBA (for finalLimbsLSL construction, width ${propagateTexWidthForTexture}): [${Array.from(finalResultRGBA).slice(0, propagateTexWidthActual * 4).join(',')}]`);
        }
        for (let i = 0; i < propagateTexWidthActual; i++) { // Read up to actual needed limbs
            const val = finalResultRGBA[i * 4 + 0]; // .r channel
            if (isDebugCaseMultiply) {
                console.log(`[Multiply Debug ${debugCaseName}] finalLimbsLSL construction: i=${i}, raw_val=${val}, rounded_val=${Math.round(val)}`);
            }
            finalLimbsLSL.push(val === undefined || isNaN(val) ? 0 : Math.round(val)); // Round to nearest int due to potential float inaccuracies
        }
         if (isDebugCaseMultiply) {
            console.log(`[Multiply Debug 7*8] Final Limbs (LSL, sanitized, width ${propagateTexWidthActual}): [${finalLimbsLSL.join(',')}]`);
        }

        // Convert LSL limbs to MSL coefficient string
        let resultCoeffStr = "";
        if (finalLimbsLSL.length === 0) {
            resultCoeffStr = "0";
        } else {
            let mostSignificantLimbIndex = finalLimbsLSL.length - 1;
            while (mostSignificantLimbIndex > 0 && finalLimbsLSL[mostSignificantLimbIndex] === 0) {
                mostSignificantLimbIndex--;
            }
            if (isDebugCaseMultiply) {
                console.log(`[Multiply Debug 7*8] LSL limbs for coeff str conversion (up to MSL index ${mostSignificantLimbIndex}): [${finalLimbsLSL.slice(0, mostSignificantLimbIndex+1).join(',')}]`);
            }
            resultCoeffStr = String(finalLimbsLSL[mostSignificantLimbIndex]);
            for (let i = mostSignificantLimbIndex - 1; i >= 0; i--) {
                resultCoeffStr += String(finalLimbsLSL[i]).padStart(BASE_LOG10, '0');
            }
        }
        if (resultCoeffStr === "" || /[^0-9]/.test(resultCoeffStr)) { // Check for empty or non-numeric from errors
             console.warn(`[Multiply Debug] resultCoeffStr is invalid ('${resultCoeffStr}'), defaulting to "0".`);
             resultCoeffStr = "0";
        }

        if (isDebugCaseMultiply) {
            console.log(`[Multiply Debug 7*8] Result Coeff String (MSL): ${resultCoeffStr}`);
        }

        const tempCoeffResult = BigIntPrimitive.fromCoefficientString(resultCoeffStr, this.canvas, { forceCPU: true });

        if (isDebugCaseMultiply) {
            console.log(`[Multiply Debug ${debugCaseName}] MID-POINT _webgl_multiply_full: tempCoeffResult.toString()=${tempCoeffResult.toString()}, limbs=[${tempCoeffResult.limbs.join()}], exp=${tempCoeffResult.exponent}, sign=${tempCoeffResult.sign}`);
        }

        const resultBigInt = new BigIntPrimitive(tempCoeffResult, this.canvas, {forceCPU: true}); // CLONE tempCoeffResult
        resultBigInt.exponent = num1.exponent + num2.exponent; // Set exponent on the CLONE
        // Sign is handled by the caller `multiply` method. This function returns magnitude (sign should be 1 from clone).

        // Workaround for potential corruption if resultBigInt became zero unexpectedly
        if (resultBigInt.isZero() && resultCoeffStr !== "0" && resultCoeffStr !== "") {
            if (isDebugCaseMultiply) {
                console.log(`[Multiply Debug ${debugCaseName}] WARNING: resultBigInt became zero. Reconstructing from resultCoeffStr: '${resultCoeffStr}'`);
            }
            const reconstructed = BigIntPrimitive.fromCoefficientString(resultCoeffStr, this.canvas, { forceCPU: true });
            resultBigInt.limbs = reconstructed.limbs;
            resultBigInt.sign = 1; // Magnitude, so sign is 1
            resultBigInt.exponent = num1.exponent + num2.exponent;
        }

        if (isDebugCaseMultiply) {
            const currentLimbsStr = resultBigInt.limbs.join(',');
            const currentExp = resultBigInt.exponent;
            const currentSign = resultBigInt.sign;
            const currentToString = resultBigInt.toString(); // Call this LAST
            console.log(`[Multiply Debug ${debugCaseName}] FINAL PRE-RETURN _webgl_multiply_full (OrderTest): toStringResult=${currentToString}, limbsDirect=[${currentLimbsStr}], expDirect=${currentExp}, signDirect=${currentSign}`);
        }
        return resultBigInt;

    } catch (e) {
        console.error("WebGL full multiply path error:", e);
        throw e; // Re-throw to allow fallback to CPU if defined in multiply()
    } finally {
        // Extensive cleanup
        if (gl) {
            if (program) gl.deleteProgram(program); // For multiply_full pass
            if (sumAntidiagonalsProgram) gl.deleteProgram(sumAntidiagonalsProgram); // For sum_antidiagonals pass
            if (propagateCarriesProgram) gl.deleteProgram(propagateCarriesProgram);

            if (texNum1) gl.deleteTexture(texNum1);
            if (texNum2) gl.deleteTexture(texNum2);
            if (texPartialProducts) gl.deleteTexture(texPartialProducts);
            if (fbPartialProducts) gl.deleteFramebuffer(fbPartialProducts);

            if (texCoeffSums) gl.deleteTexture(texCoeffSums);
            if (fbCoeffSums) gl.deleteFramebuffer(fbCoeffSums);

            if (texPropagatePing) gl.deleteTexture(texPropagatePing);
            if (texPropagatePong) gl.deleteTexture(texPropagatePong);
            if (fbPropagatePing) gl.deleteFramebuffer(fbPropagatePing);
            if (fbPropagatePong) gl.deleteFramebuffer(fbPropagatePong);

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

    // Create true coefficient versions (exponent 0, sign 1)
    const selfCoeffStr = (self.limbs.length === 0 || (self.limbs.length === 1 && self.limbs[0] === 0)) ? "0" :
                         self.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('');
    const selfCoeff = BigIntPrimitive.fromCoefficientString(selfCoeffStr, self.canvas, {forceCPU: true});

    const otherCoeffStr = (otherBigInt.limbs.length === 0 || (otherBigInt.limbs.length === 1 && otherBigInt.limbs[0] === 0)) ? "0" :
                          otherBigInt.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('');
    const otherCoeff = BigIntPrimitive.fromCoefficientString(otherCoeffStr, self.canvas, {forceCPU: true});
    // selfCoeff and otherCoeff are now guaranteed to have exponent 0 and sign 1 from fromCoefficientString

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

    // absResult is the magnitude from _webgl_multiply_full or _core_multiply_cpu.
    // It has sign:1 and exponent:0 relative to its coefficient string.

    let finalNumString;
    if (absResult.isZero()) {
        finalNumString = "0";
    } else {
        // Get the coefficient string of absResult (which has exp 0)
        let coeffStr = absResult.limbs.map((l, idx) => (idx === 0) ? String(l) : String(l).padStart(BASE_LOG10, '0')).join('');

        // Create a temporary BigInt from this coefficient string, then set its final exponent and sign,
        // then convert to string. This ensures that if exponent/sign assignment has side effects,
        // it happens on a temporary object, and we get a canonical string representation.
        let tempForStrFormat = BigIntPrimitive.fromCoefficientString(coeffStr, self.canvas, {forceCPU:true});
        tempForStrFormat.exponent = finalExponent; // finalExponent is self.exponent + otherBigInt.exponent
        tempForStrFormat.sign = resultSign;

        // Normalize if it became zero after exponent (e.g. very small number rounded to 0 with fixed DP)
        // However, simple multiplication shouldn't do this unless DP is involved.
        // Standard toString() should handle this.
        if (tempForStrFormat.isZero() && resultSign === -1) {
            // Avoid "-0" unless it's a specific formatted requirement (handled by toFixed/toExponential)
            // For multiplication result, "0" is standard.
             finalNumString = "0";
        } else {
             finalNumString = tempForStrFormat.toString();
        }
    }

    // Create the very final result from this canonical string.
    const finalResult = new BigIntPrimitive(finalNumString, self.canvas, {forceCPU: self.forceCPU || otherBigInt.forceCPU});

    // console.log(`[Multiply Method Pre-Return] absResult (intermediate): ${absResult.toString()}, finalNumString='${finalNumString}', finalResult: ${finalResult.toString()}`);
    return finalResult;
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

  // Refactored to use BigIntPrimitive operations for clarity and robustness.
  // targetOutputDP is the number of decimal places the result should be accurate to.
  _webgl_reciprocal_using_bigint_ops(B_prime_BigInt, X0_BigInt, numIterations, targetOutputDP) {
    console.log(`[_webgl_reciprocal_using_bigint_ops START] B_prime: ${B_prime_BigInt.toString()}, X0: ${X0_BigInt.toString()}, iterations: ${numIterations}, targetDP: ${targetOutputDP}`);

    let current_X_BigInt = new BigIntPrimitive(X0_BigInt, this.canvas); // Ensure it's a new instance we can modify
    const Two_BigInt = new BigIntPrimitive("2", this.canvas, { forceCPU: this.forceCPU }); // Use instance forceCPU

    const originalDP = BigIntPrimitive.DP;
    const originalRM = BigIntPrimitive.RM;

    // Determine internal working precision: should be higher than targetOutputDP.
    // Each iteration roughly doubles precision. If X0 has P correct digits, after N iterations, P * 2^N digits.
    // Let's set a high working precision for all intermediate steps.
    // The precision of B_prime_BigInt and current_X_BigInt also matters.
    // Max possible limbs for B_prime or X: targetOutputDP/BASE_LOG10 + some_buffer.
    // Max limbs for product: sum of operand limbs.
    const limbsForTargetDP = Math.ceil(targetOutputDP / BASE_LOG10) + 1;
    const bPrimeLimbs = B_prime_BigInt.limbs.length;
    // Estimate precision needed for intermediate products:
    // Precision of X doubles each time. Start with X0's precision.
    // Let's estimate X0's precision. If X0 is e.g. "3.1415", its coeff is "31415", exp is -4.
    // Number of digits in X0 coeff: String(X0_BigInt.limbs.join('')).length
    // For simplicity, use a large enough internal DP.
    // This should be related to 2*targetOutputDP to ensure intermediate calcs don't lose precision for the next step.
    // let internalDP = targetOutputDP * 2 + bPrimeLimbs * BASE_LOG10 + String(X0_BigInt.limbs.join('')).length + 20; // Generous buffer
    let internalDP = targetOutputDP + 10; // Simplified internal precision for testing

    console.log(`[_webgl_reciprocal_using_bigint_ops] Setting internalDP to ${internalDP}`);
    BigIntPrimitive.DP = internalDP;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp; // Consistent rounding for internal ops

    for (let i = 0; i < numIterations; i++) {
        // prod_B_X = B_prime_BigInt * current_X_BigInt
        // The multiply method itself uses the current BigIntPrimitive.DP for its internal _decimalDivide if used by Karatsuba, or for intermediate rounding if applicable.
        // Ensure forceCPU is consistent if we want to test GPU path for these.
        const prod_B_X = B_prime_BigInt.multiply(current_X_BigInt);
        console.log(`[_webgl_reciprocal_using_bigint_ops Iter ${i+1}] B_prime * X_n = ${prod_B_X.toString()}`);

        // term_2_minus_BX = Two_BigInt - prod_B_X
        const term_2_minus_BX = Two_BigInt.subtract(prod_B_X);
        console.log(`[_webgl_reciprocal_using_bigint_ops Iter ${i+1}] 2 - (B_prime * X_n) = ${term_2_minus_BX.toString()}`);

        // next_X_BigInt = current_X_BigInt * term_2_minus_BX
        const next_X_BigInt = current_X_BigInt.multiply(term_2_minus_BX);
        console.log(`[_webgl_reciprocal_using_bigint_ops Iter ${i+1}] X_n+1 = X_n * (2 - BX) = ${next_X_BigInt.toString()}`);

        // No explicit rounding per iteration for now, let precision accumulate.
        // Rounding at each step to an increasing precision (P, 2P, 4P...) can save computation
        // but is more complex to manage correctly with BigIntPrimitive's global DP.
        // For now, keep full precision from high internalDP.
        current_X_BigInt = next_X_BigInt;
    }

    BigIntPrimitive.DP = originalDP; // Restore original precision
    BigIntPrimitive.RM = originalRM;

    // Final rounding of the result to the targetOutputDP
    const final_reciprocal = current_X_BigInt.round(targetOutputDP, BigIntPrimitive.RM);
    console.log(`[_webgl_reciprocal_using_bigint_ops END] Final reciprocal (rounded to ${targetOutputDP} DP): ${final_reciprocal.toString()}`);
    return final_reciprocal;
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

    // WebGL Path Attempt
    if (!this.forceCPU && !absDivisor.forceCPU && this.canvas && typeof webglUtilsModule !== 'undefined') {
        let gl = webglUtilsModule.initWebGL(this.canvas);
        if (gl && gl.getExtension('OES_texture_float')) {
            const originalGlobalDP = BigIntPrimitive.DP;
            const originalGlobalRM = BigIntPrimitive.RM;
            try {
                console.log(`[GPU Divide Path START] this: ${this.toString()}, divisor: ${divisorBigInt.toString()}`);

                // 1. Normalize absDivisor to B_prime_bigint such that its value is in [0.1, 1.0)
                //    absDivisor_val = B_prime_val * BASE^scale_exponent_adjustment
                //    scale_exponent_adjustment is the power of BASE that absDivisor was divided by to get B_prime's magnitude.
                let B_prime_bigint;
                let scale_exponent_adjustment; // This is 'k' such that absDivisor_val = B_prime_val * BASE^k

                BigIntPrimitive.DP = Math.max(20, absDivisor.limbs.length * BASE_LOG10 + absDivisor.exponent + 15); // Temp high precision for normalization
                BigIntPrimitive.RM = BigIntPrimitive.roundDown;

                if (absDivisor.isZero()) throw new Error("Division by zero during normalization step.");

                const absDivisorCoeffStr = absDivisor.limbs.map((l,idx) => idx === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0')).join('');
                const absDivisorOriginalExponent = absDivisor.exponent; // This is power of 10.

                B_prime_bigint = BigIntPrimitive.fromCoefficientString(absDivisorCoeffStr, this.canvas, {forceCPU: true});
                // B_prime_bigint now has coefficient of absDivisor, and exponent = 0.
                // We want B_prime_bigint's value to be Coeff * 10^(-num_digits_in_Coeff)
                // e.g. if Coeff is "8000", value is 0.8. exp = -3.
                // e.g. if Coeff is "123", value is 0.123. exp = -2.
                let numActualDigitsInCoeff = absDivisorCoeffStr.replace(/^0+/, "").length;
                // Handle the case where absDivisorCoeffStr might be "0" or "00", resulting in numActualDigitsInCoeff = 0
                // For normalization, even "0" should be treated as having 1 digit for exponent calculation.
                if (absDivisorCoeffStr.length > 0 && numActualDigitsInCoeff === 0) {
                    numActualDigitsInCoeff = 1;
                } else if (absDivisorCoeffStr.length === 0) { // Should not happen if absDivisor is not zero, but defensive
                    numActualDigitsInCoeff = 1; // Treat empty coeff string as "0" -> 1 digit
                }

                B_prime_bigint.exponent = -numActualDigitsInCoeff;
                B_prime_bigint.sign = 1;

                // Calculate k_10 such that absDivisor_val = B_prime_val * 10^k_10
                // absDivisor_val = Coeff_absDiv * 10^absDivisorOriginalExponent
                // B_prime_val    = Coeff_absDiv * 10^(-numActualDigitsInCoeff)
                // So, Coeff_absDiv * 10^absDivisorOriginalExponent = (Coeff_absDiv * 10^(-numActualDigitsInCoeff)) * 10^k_10
                // absDivisorOriginalExponent = -numActualDigitsInCoeff + k_10
                // k_10 = absDivisorOriginalExponent + numActualDigitsInCoeff
                scale_exponent_adjustment = absDivisorOriginalExponent + numActualDigitsInCoeff;

                BigIntPrimitive.DP = originalGlobalDP; // Restore DP after normalization
                BigIntPrimitive.RM = originalGlobalRM;

                console.log(`[GPU Divide Path] Normalized B_prime: ${B_prime_bigint.toString()} (Value: ${B_prime_bigint.toNumber().toPrecision(10)})`);
                console.log(`[GPU Divide Path] scale_exponent_adjustment (power of 10): ${scale_exponent_adjustment}`);

                // 2. Initial guess X0 for 1/B_prime_bigint
                let X0_val_float = 1.0 / B_prime_bigint.toNumber();
                const X0_bigint = new BigIntPrimitive(X0_val_float.toPrecision(15), this.canvas, { forceCPU: true });
                X0_bigint.sign = 1;
                console.log(`[GPU Divide Path] Initial guess X0 for 1/B_prime: ${X0_bigint.toString()} (from float ${X0_val_float.toPrecision(10)})`);

                // 3. Determine target precision for reciprocal and number of iterations
                const finalQuotientDP = originalGlobalDP;
                let dp_for_reciprocal = finalQuotientDP + Math.abs(absDividend.exponent) + Math.abs(B_prime_bigint.exponent) + 2*BASE_LOG10 + 15; // Generous

                const numIterations = 4;

                // 4. Call _webgl_reciprocal_using_bigint_ops
                const inv_B_prime_bigint = this._webgl_reciprocal_using_bigint_ops(B_prime_bigint, X0_bigint, numIterations, dp_for_reciprocal);
                console.log(`[GPU Divide Path] Reciprocal 1/B_prime (from GPU path, rounded to ${dp_for_reciprocal} DP): ${inv_B_prime_bigint.toString()}`);

                // Restore global DP/RM before final multiplication and rounding
                BigIntPrimitive.DP = originalGlobalDP;
                BigIntPrimitive.RM = originalGlobalRM;

                // 5. Final quotient calculation
                // quotient_val = absDividend_val * inv_B_prime_val * 10^(-scale_exponent_adjustment)
                let dp_for_product = finalQuotientDP + Math.abs(scale_exponent_adjustment) + 15; // Sufficient DP for product before final rounding

                BigIntPrimitive.DP = dp_for_product;

                let quotient = absDividend.multiply(inv_B_prime_bigint);
                console.log(`[GPU Divide Path] absDividend * inv_B_prime = ${quotient.toString()}`);

                quotient.exponent -= scale_exponent_adjustment;
                quotient.sign = quotientSign;

                BigIntPrimitive.DP = originalGlobalDP;
                BigIntPrimitive.RM = originalGlobalRM;

                if (quotient.isZero()) {
                    quotient.exponent = 0;
                    quotient.sign = 1;
                }

                quotient = quotient.round(BigIntPrimitive.DP, BigIntPrimitive.RM);

                if (quotient.isZero()) { // Handle -0 if DP is 0, otherwise ensure positive zero for "0.00"
                    if (BigIntPrimitive.DP === 0 && quotientSign === -1 && !(this.isZero())) {
                         quotient.sign = -1;
                    } else {
                         quotient.sign = 1;
                    }
                    quotient._roundedDp = BigIntPrimitive.DP;
                }


                console.log(`[GPU Divide Path END] Final quotient: ${quotient.toString()}`);
                return quotient;

            } catch (e) {
                console.warn("WebGL divide path error, falling back to CPU:", e, e.stack);
                BigIntPrimitive.DP = originalGlobalDP; // Ensure DP/RM are restored on error
                BigIntPrimitive.RM = originalGlobalRM;
            }
        }
    }

    // CPU Path (original logic if WebGL fails or not available)
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
