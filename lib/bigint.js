
import * as webglUtilsModule from './webgl-utils.js'
import vertexShaderSrc from './shaders/addition.vert?raw'
import fragmentShaderSrc from './shaders/addition.frag?raw'
let instanceCounter = 0 // Instance counter for debugging
import subtractVertexShaderSrc from './shaders/subtraction.vert?raw'
import subtractFragmentShaderSrc from './shaders/subtraction.frag?raw'
import multiplyLimbVertexShaderSrc from './shaders/multiply_limb.vert?raw'
import multiplyLimbFragmentShaderSrc from './shaders/multiply_limb.frag?raw'
import multiplyFullVertexShaderSrc from './shaders/multiply_full.vert?raw'
import multiplyFullFragmentShaderSrc from './shaders/multiply_full.frag?raw'

const KARATSUBA_THRESHOLD = 20
const BASE_LOG10 = 4
const BASE = 10000

class BigIntPrimitive {
  // Persistent WebGL resource cache (per-canvas)
  static _webglResourceCache = new WeakMap();

  // Get or create persistent WebGL resources for a given canvas
  static _getWebGLResources(canvas) {
    if (!canvas) return null;
    let cache = BigIntPrimitive._webglResourceCache.get(canvas);
    if (!cache) {
      const gl = webglUtilsModule.initWebGL(canvas);
      if (!gl) return null;
      cache = {
        gl,
        programs: {}, // { opType: program }
        shaders: {},  // { opType: {vs, fs} }
        buffers: {},  // { name: buffer }
        textures: {}, // { name: texture }
        framebuffers: {}, // { name: framebuffer }
        texSizes: {}, // { name: {w, h} }
      };
      BigIntPrimitive._webglResourceCache.set(canvas, cache);
    }
    return cache;
  }

  // Utility to get or create a shader program for an operation
  static _getOrCreateProgram(cache, opType, vsSource, fsSource) {
    if (cache.programs[opType]) return cache.programs[opType];
    const gl = cache.gl;
    const vs = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) throw new Error(`Failed to compile shaders for ${opType}`);
    const program = webglUtilsModule.createProgram(gl, vs, fs);
    if (!program) throw new Error(`Failed to link program for ${opType}`);
    cache.programs[opType] = program;
    cache.shaders[opType] = { vs, fs };
    return program;
  }

  // Utility to get or create a buffer
  static _getOrCreateBuffer(cache, name, data) {
    const gl = cache.gl;
    let buf = cache.buffers[name];
    if (!buf) {
      buf = gl.createBuffer();
      cache.buffers[name] = buf;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    if (data) gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buf;
  }

  // Utility to get or create a texture (resized as needed)
  static _getOrCreateTexture(cache, name, width, height, useRGBA = false) {
    const gl = cache.gl;
      let tex = cache.textures[name];
      const texInfo = cache._textureInfo = cache._textureInfo || {};
      const info = texInfo[name] || {};
      const needsResize = (width > (info.width || 0)) || (height > (info.height || 0)) || (info.useRGBA !== useRGBA);
      if (tex) {
        if (needsResize) {
          gl.deleteTexture(tex);
          tex = webglUtilsModule.createDataTexture(gl, null, width, height, useRGBA);
          cache.textures[name] = tex;
          texInfo[name] = { width, height, useRGBA };
        }
      } else {
        tex = webglUtilsModule.createDataTexture(gl, null, width, height, useRGBA);
        cache.textures[name] = tex;
        texInfo[name] = { width, height, useRGBA };
      }
      return tex;
  }

  // Utility to get or create a framebuffer for a texture
  static _getOrCreateFramebuffer(cache, name, tex) {
    const gl = cache.gl;
    let fb = cache.framebuffers[name];
    if (!fb) {
      fb = gl.createFramebuffer();
      cache.framebuffers[name] = fb;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return fb;
  }
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
    this._instanceId = instanceCounter++ // Corrected placement
    this.limbs = []
    this.sign = 1
    this.exponent = 0
    this.canvas = canvas
    this.forceCPU = !!(options && options.forceCPU)

    if (this.constructor.strict && typeof value === 'number') {
      throw new TypeError("[big.js] String expected")
    }

    if (value instanceof BigIntPrimitive) {
      this.sign = value.sign
      this.exponent = value.exponent // Assign exponent first
      this.limbs = [...value.limbs] // Then limbs
      this.canvas = canvas !== undefined ? canvas : value.canvas
      this.forceCPU = (options && options.hasOwnProperty('forceCPU')) ? options.forceCPU : value.forceCPU

      if (value.hasOwnProperty('_roundedDp')) {
        this._roundedDp = value._roundedDp
      }
      return
    }

    if (value === null || value === undefined) {
      throw new TypeError("Invalid input type for BigIntPrimitive: cannot be null or undefined.")
    }

    let stringValue = ''
    if (typeof value === 'number') {
      if (!isFinite(value)) {
        throw new TypeError("Numeric input must be finite.")
      }
      stringValue = String(value)
    } else if (typeof value === 'string') {
      stringValue = value.trim()
    } else {
      throw new TypeError("Invalid input type for BigIntPrimitive. Expected string, number, or BigIntPrimitive instance.")
    }

    if (stringValue === "") {
      this.limbs = [0]
      this.exponent = 0
      this.sign = 1
      return
    }

    if (stringValue.startsWith('-')) {
      this.sign = -1
      stringValue = stringValue.substring(1)
    } else if (stringValue.startsWith('+')) {
      this.sign = 1
      stringValue = stringValue.substring(1)
    } else {
      this.sign = 1
    }

    if (/[^0-9.eE+-]/.test(stringValue)) {
      throw new TypeError("Invalid character in numeric string.")
    }

    let mantissaStr = stringValue
    let expStr = ''
    let sciExponent = 0

    const sciNotationIndex = stringValue.toLowerCase().indexOf('e')
    if (sciNotationIndex !== -1) {
      mantissaStr = stringValue.substring(0, sciNotationIndex)
      expStr = stringValue.substring(sciNotationIndex + 1)

      if (expStr === "" || expStr === "+" || expStr === "-") {
        throw new TypeError("Invalid scientific notation: exponent missing or malformed sign.")
      }
      if (!/^[+-]?\d+$/.test(expStr)) {
        throw new TypeError("Invalid scientific notation: exponent contains non-digits or is poorly formed.")
      }
      sciExponent = parseInt(expStr, 10)
      if (String(sciExponent) !== expStr.replace(/^\+/, '')) {
        if (parseFloat(expStr) !== sciExponent) {
          throw new TypeError("Invalid scientific notation: exponent is not an integer.")
        }
      }
      if (isNaN(sciExponent)) {
        throw new TypeError("Invalid scientific notation: exponent is not a number.")
      }
    }

    if (mantissaStr === "" || mantissaStr === ".") {
      throw new TypeError("Invalid numeric string: empty or invalid mantissa.")
    }
    if (mantissaStr.indexOf('e') !== -1 || mantissaStr.indexOf('E') !== -1) {
      throw new TypeError("Invalid scientific notation: 'e' in mantissa after initial split.")
    }
    if (!/^[0-9.]*$/.test(mantissaStr)) {
      throw new TypeError("Invalid characters in mantissa.")
    }

    const decimalPointIndex = mantissaStr.indexOf('.')
    let coefficientStr = mantissaStr

    if (decimalPointIndex !== -1) {
      if (mantissaStr.indexOf('.', decimalPointIndex + 1) !== -1) {
        throw new TypeError("Invalid numeric string: multiple decimal points in mantissa.")
      }
      coefficientStr = mantissaStr.replace('.', '')
      this.exponent = sciExponent - (mantissaStr.length - 1 - decimalPointIndex)
    } else {
      this.exponent = sciExponent
    }

    if (coefficientStr === "") {
      this.limbs = [0]
      this.exponent = 0
      this.sign = 1
      return
    }
    if (!/^\d+$/.test(coefficientStr)) {
      throw new TypeError("Invalid BigInt string format: coefficient contains non-digits after sign/decimal/exponent processing.")
    }

    if (coefficientStr.length > 1 && coefficientStr.startsWith('0')) {
      coefficientStr = coefficientStr.replace(/^0+/, '')
      if (coefficientStr === "") coefficientStr = "0"
    }

    if (coefficientStr === "0") {
      this.limbs = [0]
      if (this.exponent !== 0) {
        let allZeros = true
        for (let i = 0; i < mantissaStr.length; i++) {
          if (mantissaStr[i] !== '0' && mantissaStr[i] !== '.') {
            allZeros = false
            break
          }
        }
        if (allZeros) this.exponent = 0
      }
      return
    }

    let tempLimbs = []
    let currentPos = coefficientStr.length
    while (currentPos > 0) {
      const start = Math.max(0, currentPos - BASE_LOG10)
      tempLimbs.unshift(parseInt(coefficientStr.substring(start, currentPos), 10))
      currentPos = start
    }
    this.limbs = tempLimbs

    while (this.limbs.length > 1 && this.limbs[0] === 0) {
      this.limbs.shift()
    }

    if (this.limbs.length === 1 && this.limbs[0] === 0) {
      this.exponent = 0
    }
    // const finalLimbsStr = `[${this.limbs.join(',')}]`;
    // console.log(`[Instance Created ID: ${this._instanceId}] Input type: ${typeof value}, Value (partial): ${String(value).substring(0, 50)}, ForceCPU: ${options?.forceCPU}, Final limbs: ${finalLimbsStr}, Final exponent: ${this.exponent}`);
  }

  static fromCoefficientString(valueStr, canvas, options = {}) {
    // console.log(`[fromCoefficientString ENTRY] valueStr: '${valueStr}'`);
    const instance = new BigIntPrimitive("0", canvas, options)
    instance.sign = 1
    instance.exponent = 0

    if (valueStr === null || valueStr === undefined || typeof valueStr !== 'string' || valueStr.trim() === "") {
      instance.limbs = [0]
      return instance
    }

    let coeffStr = valueStr.trim()
    if (!/^\d+$/.test(coeffStr)) {
      instance.limbs = [0]
      return instance
    }

    if (coeffStr.length > 1 && coeffStr.startsWith('0')) {
      coeffStr = coeffStr.replace(/^0+/, '')
      if (coeffStr === "") coeffStr = "0"
    }

    if (coeffStr === "0") {
      instance.limbs = [0]
      return instance
    }

    let tempLimbs = []
    let currentPos = coeffStr.length
    while (currentPos > 0) {
      const start = Math.max(0, currentPos - BASE_LOG10)
      tempLimbs.unshift(parseInt(coeffStr.substring(start, currentPos), 10))
      currentPos = start
    }
    instance.limbs = tempLimbs

    while (instance.limbs.length > 1 && instance.limbs[0] === 0) {
      instance.limbs.shift()
    }
    if (instance.limbs.length === 0 || (instance.limbs.length === 1 && instance.limbs[0] === 0)) {
      instance.limbs = [0]
    }
    // console.log(`[fromCoefficientString PRE-RETURN] instance.limbs: [${instance.limbs.join(',')}] for input '${valueStr}'`);
    return instance
  }

  negate() {
    const negated = new BigIntPrimitive(this, this.canvas, { forceCPU: this.forceCPU })
    if (!negated.isZero()) {
      negated.sign *= -1
    }
    return negated
  }

  abs() {
    const absolute = new BigIntPrimitive(this, this.canvas, { forceCPU: this.forceCPU })
    absolute.sign = 1
    return absolute
  }

  isPositive() {
    return this.sign === 1 && !this.isZero()
  }

  isNegative() {
    return this.sign === -1 && !this.isZero()
  }

  compareMagnitude(other) {
    if (!(other instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.")
    }
    if (this.isZero() && other.isZero()) return 0
    if (this.isZero()) return -1
    if (other.isZero()) return 1

    const tc = this.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('')
    const oc = other.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('')

    const tExp = this.exponent + (tc.length - 1)
    const oExp = other.exponent + (oc.length - 1)

    if (tExp > oExp) return 1
    if (tExp < oExp) return -1

    const len = Math.max(tc.length, oc.length)
    for (let i = 0; i < len; i++) {
      const td = (i < tc.length) ? parseInt(tc[i], 10) : 0
      const od = (i < oc.length) ? parseInt(oc[i], 10) : 0

      if (td > od) return 1
      if (td < od) return -1
    }
    return 0
  }

  cmp(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.")
    }
    const thisIsZero = this.isZero()
    const otherIsZero = otherBigInt.isZero()

    if (thisIsZero && otherIsZero) { return 0 }
    if (this.sign !== otherBigInt.sign) {
      return this.sign > otherBigInt.sign ? 1 : -1
    }
    let magResult = this.compareMagnitude(otherBigInt)
    if (this.sign === 1) {
      return magResult
    } else {
      return magResult === 0 ? 0 : -magResult
    }
  }

  eq(other) { return this.cmp(other) === 0 }
  gt(other) { return this.cmp(other) > 0 }
  gte(other) { return this.cmp(other) >= 0 }
  lt(other) { return this.cmp(other) < 0 }
  lte(other) { return this.cmp(other) <= 0 }

  plus(n) { return this.add(n) }
  minus(n) { return this.subtract(n) }
  times(n) { return this.multiply(n) }
  div(n) { return this.divide(n) }
  mod(n) { return this.remainder(n) }
  neg() { return this.negate() }

  toString() {
    // console.log(`[toString ENTRY ID: ${this._instanceId}] current _roundedDp: ${this._roundedDp}, exp: ${this.exponent}, sign: ${this.sign}`);
    if (this.isZero()) {
      if (typeof this._roundedDp === 'number' && this._roundedDp > 0) {
        return '0.' + '0'.repeat(this._roundedDp)
      }
      return "0"
    }

    let coefficientString
    if (this.limbs.length === 0) {
      coefficientString = "0"
    } else {
      coefficientString = String(this.limbs[0])
      for (let i = 1; i < this.limbs.length; i++) {
        coefficientString += String(this.limbs[i]).padStart(BASE_LOG10, '0')
      }
    }

    let s
    const e = this.exponent
    const numDigits = coefficientString.length
    const decimalPointActualPosition = numDigits + e

    const useSciNotation = (this._roundedDp === null || this._roundedDp === undefined) &&
      (decimalPointActualPosition <= BigIntPrimitive.NE ||
        decimalPointActualPosition > BigIntPrimitive.PE)

    if (useSciNotation) {
      s = coefficientString[0]
      if (numDigits > 1) {
        s += '.' + coefficientString.substring(1)
      }
      if (s.includes('.')) {
        s = s.replace(/\.?0+$/, '')
      }
      const scientificExponent = decimalPointActualPosition - 1
      s += 'e' + (scientificExponent >= 0 ? '+' : '') + scientificExponent
    } else {
      if (e < 0) {
        if (decimalPointActualPosition > 0) {
          s = coefficientString.substring(0, decimalPointActualPosition) + '.' + coefficientString.substring(decimalPointActualPosition)
        } else {
          s = '0.' + '0'.repeat(-decimalPointActualPosition) + coefficientString
        }
      } else {
        s = coefficientString + '0'.repeat(e)
      }

      // This block was responsible for padding based on _roundedDp.
      // For default toString, we want the shortest representation.
      // if (typeof this._roundedDp === 'number' && this._roundedDp >= 0) {
      //     let [integerPart, fractionalPart = ''] = s.split('.');
      //     if (this._roundedDp > 0) {
      //         fractionalPart = fractionalPart.padEnd(this._roundedDp, '0');
      //         fractionalPart = fractionalPart.substring(0, this._roundedDp);
      //         s = integerPart + '.' + fractionalPart;
      //     } else {
      //         s = integerPart;
      //     }
      // } else

      // Always trim trailing zeros from the fractional part for default toString.
      if (s.includes('.')) {
        s = s.replace(/\.?0+$/, '')
      }
      if (s === "") s = "0" // Handles case where "0." became ""
      if (s.startsWith('.')) s = '0' + s // Handles ".5" -> "0.5"
    }

    // Apply sign
    let outputStr = s
    const preSign = (this.sign === -1 && !this.isZero()) ? "-" : ""
    if (preSign === "-") {
      const isZeroOutput = (outputStr === "0" || (outputStr.includes(".") && parseFloat(outputStr) === 0))
      if (isZeroOutput) {
        if (this.limbs.length === 1 && this.limbs[0] === 0 && (this._roundedDp === null || this._roundedDp === undefined)) {
          return "-0" // This specific case for -0 might be from big.js, review if needed.
        }
        return outputStr
      }
      return preSign + outputStr
    }
    return outputStr
  }

  toNumber() {
    const originalString = this.toString()
    const primitiveNumber = Number(originalString)

    if (this.constructor.strict) {
      if (primitiveNumber === Infinity || primitiveNumber === -Infinity) {
        throw new TypeError("[big.js] Imprecise conversion: non-finite number")
      }
      if ((primitiveNumber === 0 && !this.isZero())) {
        throw new TypeError("[big.js] Imprecise conversion: precision loss")
      }

      if (isFinite(primitiveNumber) && !(primitiveNumber === 0 && this.isZero())) {
        let tempBig
        const OldStrict = this.constructor.strict
        try {
          this.constructor.strict = false
          tempBig = new BigIntPrimitive(primitiveNumber, this.canvas, { forceCPU: this.forceCPU })
          this.constructor.strict = OldStrict
        } catch (e) {
          this.constructor.strict = OldStrict
          throw new TypeError("[big.js] Imprecise conversion (constructor failed for finite number): " + e.message)
        }
        if (tempBig.toString() !== originalString) {
          throw new TypeError("[big.js] Imprecise conversion: precision loss")
        }
      } else if (Number.isNaN(primitiveNumber)) {
        throw new TypeError("[big.js] Imprecise conversion: NaN")
      }
    }
    return primitiveNumber
  }
  toJSON() { return this.toString() }

  toFormat(options = {}) {
    try {
      // Convert BigIntPrimitive to number for Intl.NumberFormat
      const numberValue = this.toNumber()

      // Use Intl.NumberFormat with provided options
      const formatter = new Intl.NumberFormat(undefined, options)
      return formatter.format(numberValue)
    } catch (e) {
      // If conversion fails, return the string representation
      return this.toString()
    }
  }

  valueOf() {
    if (this.constructor.strict) {
      throw new Error("[big.js] valueOf disallowed")
    }
    return this.toString()
  }
  isZero() { return this.limbs.length === 1 && this.limbs[0] === 0 }

  static _coeffStrToPaddedLimbs(coeffStr, targetLimbLength, baseLog10Val = BASE_LOG10) {
    let limbs = []
    if (coeffStr === "0") {
      limbs.push(0)
    } else if (coeffStr.length > 0) {
      let currentPos = coeffStr.length
      while (currentPos > 0) {
        const start = Math.max(0, currentPos - baseLog10Val)
        limbs.push(parseInt(coeffStr.substring(start, currentPos), 10))
        currentPos = start
      }
    }
    if (limbs.length === 0) {
      limbs.push(0)
    }

    const paddedLimbs = new Float32Array(targetLimbLength)
    for (let i = 0; i < targetLimbLength; i++) {
      paddedLimbs[i] = (i < limbs.length) ? limbs[i] : 0
    }
    return paddedLimbs
  }

  _core_add(positiveOtherBigInt) {
    let rL = []
    let cs = 0
    let tL = [...this.limbs].reverse()
    let oL = [...positiveOtherBigInt.limbs].reverse()

    const maxL = Math.max(tL.length, oL.length)

    for (let i = 0; i < maxL; i++) {
      let s = (tL[i] || 0) + (oL[i] || 0) + cs
      rL.push(s % BASE)
      cs = Math.floor(s / BASE)
    }
    if (cs) {
      rL.push(cs)
    }

    let fL = rL.reverse()
    while (fL.length > 1 && fL[0] === 0) { fL.shift() }
    if (fL.length === 0) fL = [0]

    const res = new BigIntPrimitive("0", this.canvas, { forceCPU: true })
    res.limbs = fL
    return res
  }

  add(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive.") }

    if (this.isZero()) {
      const result = new BigIntPrimitive(otherBigInt, this.canvas)
      result.forceCPU = this.forceCPU || otherBigInt.forceCPU
      return result
    }
    if (otherBigInt.isZero()) {
      const result = new BigIntPrimitive(this, this.canvas)
      result.forceCPU = this.forceCPU || otherBigInt.forceCPU
      return result
    }

    if (this.sign !== otherBigInt.sign) {
      return this.subtract(otherBigInt.negate())
    }

    // WebGL path for same signs
    if (!this.forceCPU && !otherBigInt.forceCPU && this.canvas && typeof webglUtilsModule !== 'undefined') {
      try {
        const cache = BigIntPrimitive._getWebGLResources(this.canvas);
        if (!cache) throw new Error("WEBGL_CAPABILITY_ERROR: WebGL context not obtainable.");
        const gl = cache.gl;

        const commonExponent = Math.min(this.exponent, otherBigInt.exponent);
        let thisCoeffStr = this.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('');
        let otherCoeffStr = otherBigInt.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('');
        thisCoeffStr += '0'.repeat(Math.max(0, this.exponent - commonExponent));
        otherCoeffStr += '0'.repeat(Math.max(0, otherBigInt.exponent - commonExponent));
        
        const texWidth = Math.max(Math.ceil(thisCoeffStr.length / BASE_LOG10) || 1, Math.ceil(otherCoeffStr.length / BASE_LOG10) || 1) + 1;
        const limbsA_scaled_f32 = BigIntPrimitive._coeffStrToPaddedLimbs(thisCoeffStr, texWidth, BASE_LOG10);
        const limbsB_scaled_f32 = BigIntPrimitive._coeffStrToPaddedLimbs(otherCoeffStr, texWidth, BASE_LOG10);

        const addProgram = BigIntPrimitive._getOrCreateProgram(cache, 'add', vertexShaderSrc, fragmentShaderSrc);
        const positionBuffer = BigIntPrimitive._getOrCreateBuffer(cache, 'add_position', new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]));
        const texCoordBuffer = BigIntPrimitive._getOrCreateBuffer(cache, 'add_texCoord', new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));
        
        const texNum1 = BigIntPrimitive._getOrCreateTexture(cache, 'add_num1', texWidth, 1, false);
        const texNum2 = BigIntPrimitive._getOrCreateTexture(cache, 'add_num2', texWidth, 1, false);
        const texOutput = BigIntPrimitive._getOrCreateTexture(cache, 'add_output', texWidth, 1, true);

        gl.bindTexture(gl.TEXTURE_2D, texNum1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, texWidth, 1, gl.RGBA, gl.FLOAT, (() => { let arr = new Float32Array(texWidth * 4); for (let i = 0; i < texWidth; i++) arr[i * 4] = limbsA_scaled_f32[i]; return arr; })());
        gl.bindTexture(gl.TEXTURE_2D, texNum2);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, texWidth, 1, gl.RGBA, gl.FLOAT, (() => { let arr = new Float32Array(texWidth * 4); for (let i = 0; i < texWidth; i++) arr[i * 4] = limbsB_scaled_f32[i]; return arr; })());

        const fbOutput = BigIntPrimitive._getOrCreateFramebuffer(cache, 'add_fb', texOutput);
        const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (fbStatus !== gl.FRAMEBUFFER_COMPLETE) {
          const statusString = webglUtilsModule.getFramebufferStatusString(gl, fbStatus);
          throw new Error(`WEBGL_FRAMEBUFFER_ERROR: Framebuffer incomplete for addition. Status: ${statusString}`);
        }
        
        gl.useProgram(addProgram);
        gl.viewport(0, 0, texWidth, 1);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texNum1); gl.uniform1i(gl.getUniformLocation(addProgram, "u_num1Texture"), 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNum2); gl.uniform1i(gl.getUniformLocation(addProgram, "u_num2Texture"), 1);
        gl.uniform1f(gl.getUniformLocation(addProgram, "u_base"), BASE);
        gl.uniform1f(gl.getUniformLocation(addProgram, "u_texWidth"), texWidth);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        const positionAttributeLocation = gl.getAttribLocation(addProgram, "a_position");
        gl.enableVertexAttribArray(positionAttributeLocation);
        gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        const texCoordAttributeLocation = gl.getAttribLocation(addProgram, "a_texCoord");
        gl.enableVertexAttribArray(texCoordAttributeLocation);
        gl.vertexAttribPointer(texCoordAttributeLocation, 2, gl.FLOAT, false, 0, 0);
        
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        const rawResult = webglUtilsModule.readDataFromTexture(gl, fbOutput, texWidth, 1, false);

        const finalLimbsArrLSL = new Array(texWidth).fill(0);
        let carry = 0;
        for (let i = 0; i < texWidth; i++) {
          const limbSum = rawResult[i * 4] + carry;
          finalLimbsArrLSL[i] = limbSum % BASE;
          carry = Math.floor(limbSum / BASE) + rawResult[i * 4 + 1];
        }

        while (carry > 0) {
          finalLimbsArrLSL.push(carry % BASE);
          carry = Math.floor(carry / BASE);
        }

        while (finalLimbsArrLSL.length > 1 && finalLimbsArrLSL[finalLimbsArrLSL.length - 1] === 0) {
          finalLimbsArrLSL.pop();
        }
        if (finalLimbsArrLSL.length === 0) finalLimbsArrLSL.push(0);

        const finalLimbsMSL = finalLimbsArrLSL.reverse();
        let finalCoeffStr = String(finalLimbsMSL[0]);
        for (let i = 1; i < finalLimbsMSL.length; i++) {
          finalCoeffStr += String(finalLimbsMSL[i]).padStart(BASE_LOG10, '0');
        }
        const webGLResult = BigIntPrimitive.fromCoefficientString(finalCoeffStr, this.canvas, { forceCPU: true });
        webGLResult.sign = this.sign;
        webGLResult.exponent = commonExponent;
        if (webGLResult.isZero()) { webGLResult.sign = 1; webGLResult.exponent = 0; }
        return webGLResult;

      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        if (msg.includes("WEBGL_CAPABILITY_ERROR") || msg.includes("WEBGL_FRAMEBUFFER_ERROR")) {
          console.warn(`[BigInt.add] WebGL add not viable: ${msg}. Falling back to CPU.`);
        } else {
          console.warn(`[BigInt.add] Unexpected WebGL error during add: ${msg}. Falling back to CPU.`);
        }
      }
    }

    // CPU Path
    const result = new BigIntPrimitive("0", this.canvas, { forceCPU: true })
    const commonExponent = Math.min(this.exponent, otherBigInt.exponent)
    let thisCoeffStr = (this.limbs.length === 0) ? "0" : this.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('')
    let otherCoeffStr = (otherBigInt.limbs.length === 0) ? "0" : otherBigInt.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('')
    thisCoeffStr += '0'.repeat(Math.max(0, this.exponent - commonExponent))
    otherCoeffStr += '0'.repeat(Math.max(0, otherBigInt.exponent - commonExponent))
    const limbsA = []; let currentPosA = thisCoeffStr.length; while (currentPosA > 0) { const startA = Math.max(0, currentPosA - BASE_LOG10); limbsA.unshift(parseInt(thisCoeffStr.substring(startA, currentPosA), 10)); currentPosA = startA } if (limbsA.length === 0) limbsA.push(0)
    const limbsB = []; let currentPosB = otherCoeffStr.length; while (currentPosB > 0) { const startB = Math.max(0, currentPosB - BASE_LOG10); limbsB.unshift(parseInt(otherCoeffStr.substring(startB, currentPosB), 10)); currentPosB = startB } if (limbsB.length === 0) limbsB.push(0)
    const tempThisMinimal = { limbs: limbsA, isZero: function () { return this.limbs.length === 1 && this.limbs[0] === 0 } }
    const tempOtherMinimal = { limbs: limbsB, isZero: function () { return this.limbs.length === 1 && this.limbs[0] === 0 } }
    const sumMagnitudeResult = this._core_add.call(tempThisMinimal, tempOtherMinimal)
    result.limbs = sumMagnitudeResult.limbs
    result.exponent = commonExponent
    result.sign = this.sign
    
    if (result.isZero()) { result.sign = 1; result.exponent = 0 }
    else { while (result.limbs.length > 1 && result.limbs[result.limbs.length - 1] === 0) { result.limbs.pop(); result.exponent += BASE_LOG10 } }
    return result
  }

  subtract(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive.") }

    if (this.sign !== otherBigInt.sign) {
      const termToAdd = new BigIntPrimitive(otherBigInt, this.canvas, { forceCPU: otherBigInt.forceCPU })
      termToAdd.sign = -termToAdd.sign // Negate its sign
      return this.add(termToAdd) // Call add, which has its own WebGL/CPU logic
    }

    // If signs are the same, it's a true magnitude subtraction.
    if (!this.forceCPU && !otherBigInt.forceCPU && this.canvas && typeof webglUtilsModule !== 'undefined') {
      try {
        const cache = BigIntPrimitive._getWebGLResources(this.canvas);
        if (!cache) throw new Error("WEBGL_CAPABILITY_ERROR: WebGL context not obtainable.");
        const gl = cache.gl;

        const commonExponent = Math.min(this.exponent, otherBigInt.exponent)
        let thisCoeffStr = this.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('')
        let otherCoeffStr = otherBigInt.limbs.map((l, i) => (i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0'))).join('')
        thisCoeffStr += '0'.repeat(Math.max(0, this.exponent - commonExponent))
        otherCoeffStr += '0'.repeat(Math.max(0, otherBigInt.exponent - commonExponent))

        let minuendStr, subtrahendStr, resultSign
        let comparison = 0 // Determine which (thisCoeffStr or otherCoeffStr) is larger
        if (thisCoeffStr.length > otherCoeffStr.length) comparison = 1
        else if (thisCoeffStr.length < otherCoeffStr.length) comparison = -1
        else { if (thisCoeffStr > otherCoeffStr) comparison = 1; else if (thisCoeffStr < otherCoeffStr) comparison = -1 }

        if (comparison === 0) return new BigIntPrimitive("0", this.canvas, { forceCPU: true })

        if (comparison > 0) { minuendStr = thisCoeffStr; subtrahendStr = otherCoeffStr; resultSign = this.sign }
        else { minuendStr = otherCoeffStr; subtrahendStr = thisCoeffStr; resultSign = -this.sign }

        const texWidth = Math.max(Math.ceil(minuendStr.length / BASE_LOG10) || 1, Math.ceil(subtrahendStr.length / BASE_LOG10) || 1)
        const minuendLimbsLSL = BigIntPrimitive._coeffStrToPaddedLimbs(minuendStr, texWidth, BASE_LOG10)
        const subtrahendLimbsLSL = BigIntPrimitive._coeffStrToPaddedLimbs(subtrahendStr, texWidth, BASE_LOG10)

        // --- WebGL Path ---
        
        const subProgram = BigIntPrimitive._getOrCreateProgram(cache, 'subtract', subtractVertexShaderSrc, subtractFragmentShaderSrc);
        const positionBuffer = BigIntPrimitive._getOrCreateBuffer(cache, 'subtract_position', new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]));
        const texCoordBuffer = BigIntPrimitive._getOrCreateBuffer(cache, 'subtract_texCoord', new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));

        const texMinuend = BigIntPrimitive._getOrCreateTexture(cache, 'subtract_minuend', texWidth, 1, false);
        const texSubtrahend = BigIntPrimitive._getOrCreateTexture(cache, 'subtract_subtrahend', texWidth, 1, false);
        const texOutput = BigIntPrimitive._getOrCreateTexture(cache, 'subtract_output', texWidth, 1, true);

        gl.bindTexture(gl.TEXTURE_2D, texMinuend);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, texWidth, 1, gl.RGBA, gl.FLOAT, (() => { let arr = new Float32Array(texWidth * 4); for (let i = 0; i < texWidth; i++) arr[i * 4] = minuendLimbsLSL[i]; return arr; })());
        gl.bindTexture(gl.TEXTURE_2D, texSubtrahend);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, texWidth, 1, gl.RGBA, gl.FLOAT, (() => { let arr = new Float32Array(texWidth * 4); for (let i = 0; i < texWidth; i++) arr[i * 4] = subtrahendLimbsLSL[i]; return arr; })());

        const fbOutput = BigIntPrimitive._getOrCreateFramebuffer(cache, 'subtract_fb', texOutput);
        const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (fbStatus !== gl.FRAMEBUFFER_COMPLETE) {
          const statusString = webglUtilsModule.getFramebufferStatusString(gl, fbStatus);
          throw new Error(`WEBGL_FRAMEBUFFER_ERROR: Framebuffer incomplete for subtraction. Status: ${statusString}`);
        }

        gl.useProgram(subProgram);
        gl.viewport(0, 0, texWidth, 1);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texMinuend);
        gl.uniform1i(gl.getUniformLocation(subProgram, "u_num1Texture"), 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texSubtrahend);
        gl.uniform1i(gl.getUniformLocation(subProgram, "u_num2Texture"), 1);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        const posAttrLoc = gl.getAttribLocation(subProgram, "a_position");
        gl.enableVertexAttribArray(posAttrLoc);
        gl.vertexAttribPointer(posAttrLoc, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        const texCoordAttrLoc = gl.getAttribLocation(subProgram, "a_texCoord");
        gl.enableVertexAttribArray(texCoordAttrLoc);
        gl.vertexAttribPointer(texCoordAttrLoc, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        const rawResult = webglUtilsModule.readDataFromTexture(gl, fbOutput, texWidth, 1, false);

        // CPU-based borrow propagation
        const actualLimbsArrLSL = new Array(texWidth).fill(0);
        let borrow = 0;
        for (let i = 0; i < texWidth; i++) {
            let diff = rawResult[i * 4] - borrow; // rawResult[i*4] is the raw difference
            if (diff < 0) {
                diff += BASE;
                borrow = 1;
            } else {
                borrow = 0;
            }
            actualLimbsArrLSL[i] = diff;
        }

        while (actualLimbsArrLSL.length > 1 && actualLimbsArrLSL[actualLimbsArrLSL.length - 1] === 0) {
          actualLimbsArrLSL.pop();
        }
        if (actualLimbsArrLSL.length === 0) actualLimbsArrLSL.push(0);
        
        let finalCoeffStr = "";
        if (actualLimbsArrLSL.length === 0 || (actualLimbsArrLSL.length === 1 && actualLimbsArrLSL[0] === 0)) { finalCoeffStr = "0" }
        else { let tempFinalLimbs = [...actualLimbsArrLSL].reverse(); while (tempFinalLimbs.length > 1 && tempFinalLimbs[0] === 0) tempFinalLimbs.shift(); finalCoeffStr = String(tempFinalLimbs[0]); for (let i = 1; i < tempFinalLimbs.length; i++) finalCoeffStr += String(tempFinalLimbs[i]).padStart(BASE_LOG10, '0') }

        const webGLResult = BigIntPrimitive.fromCoefficientString(finalCoeffStr, this.canvas, { forceCPU: true })
        webGLResult.sign = resultSign; webGLResult.exponent = commonExponent
        if (webGLResult.isZero()) { webGLResult.sign = 1; webGLResult.exponent = 0 }
        return webGLResult

      } catch (e) {
        const msg = e && e.message ? e.message : String(e)
        if (msg.includes("WEBGL_CAPABILITY_ERROR") || msg.includes("WEBGL_FRAMEBUFFER_ERROR")) {
          console.warn(`[BigInt.subtract] WebGL subtract not viable: ${msg}. Falling back to CPU.`)
        } else {
          console.warn(`[BigInt.subtract] Unexpected WebGL error during subtract: ${msg}. Falling back to CPU.`)
        }
      }
    }

    // CPU Path for subtraction
    const result = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU || otherBigInt.forceCPU })
    const commonExponentCPU = Math.min(this.exponent, otherBigInt.exponent)
    let thisCoeffStrCPU = (this.limbs.length === 0) ? "0" : this.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('')
    let otherCoeffStrCPU = (otherBigInt.limbs.length === 0) ? "0" : otherBigInt.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join('')
    thisCoeffStrCPU += '0'.repeat(Math.max(0, this.exponent - commonExponentCPU))
    otherCoeffStrCPU += '0'.repeat(Math.max(0, otherBigInt.exponent - commonExponentCPU))
    const limbsThisScaledCPU = []; let currentPosThisCPU = thisCoeffStrCPU.length; while (currentPosThisCPU > 0) { const startThis = Math.max(0, currentPosThisCPU - BASE_LOG10); limbsThisScaledCPU.unshift(parseInt(thisCoeffStrCPU.substring(startThis, currentPosThisCPU), 10)); currentPosThisCPU = startThis } if (limbsThisScaledCPU.length === 0) limbsThisScaledCPU.push(0)
    const limbsOtherScaledCPU = []; let currentPosOtherCPU = otherCoeffStrCPU.length; while (currentPosOtherCPU > 0) { const startOther = Math.max(0, currentPosOtherCPU - BASE_LOG10); limbsOtherScaledCPU.unshift(parseInt(otherCoeffStrCPU.substring(startOther, currentPosOtherCPU), 10)); currentPosOtherCPU = startOther } if (limbsOtherScaledCPU.length === 0) limbsOtherScaledCPU.push(0)
    let comparisonCPU = 0; if (limbsThisScaledCPU.length > limbsOtherScaledCPU.length) comparisonCPU = 1; else if (limbsThisScaledCPU.length < limbsOtherScaledCPU.length) comparisonCPU = -1; else { for (let i = 0; i < limbsThisScaledCPU.length; i++) { if (limbsThisScaledCPU[i] > limbsOtherScaledCPU[i]) { comparisonCPU = 1; break } if (limbsThisScaledCPU[i] < limbsOtherScaledCPU[i]) { comparisonCPU = -1; break } } }
    if (comparisonCPU === 0) { result.limbs = [0]; result.exponent = 0; result.sign = 1; return result }
    let minuendLimbsCPU, subtrahendLimbsCPU
    if (comparisonCPU > 0) { minuendLimbsCPU = limbsThisScaledCPU; subtrahendLimbsCPU = limbsOtherScaledCPU; result.sign = this.sign }
    else { minuendLimbsCPU = limbsOtherScaledCPU; subtrahendLimbsCPU = limbsThisScaledCPU; result.sign = -this.sign }
    const tempMinuendMinimalCPU = { limbs: minuendLimbsCPU }; const tempSubtrahendMinimalCPU = { limbs: subtrahendLimbsCPU }
    const coreResultCPU = this._core_subtract.call(tempMinuendMinimalCPU, tempSubtrahendMinimalCPU)
    result.limbs = coreResultCPU.limbs; result.exponent = commonExponentCPU
    if (result.isZero()) { result.sign = 1; result.exponent = 0 }
    else { while (result.limbs.length > 1 && result.limbs[result.limbs.length - 1] === 0) { result.limbs.pop(); result.exponent += BASE_LOG10 } }
    return result
  }

  _core_subtract(positiveOtherBigInt) {
    let rL = []
    let b = 0
    let tL = [...this.limbs].reverse()
    let oL = [...positiveOtherBigInt.limbs].reverse()
    const maxL = Math.max(tL.length, oL.length)
    for (let i = 0; i < maxL; i++) {
      let d = (tL[i] || 0) - b - (oL[i] || 0)
      if (d < 0) { d += BASE; b = 1 } else { b = 0 }
      rL.push(d)
    }
    let fL = rL.reverse()
    while (fL.length > 1 && fL[0] === 0) { fL.shift() }
    if (fL.length === 0) fL = [0]
    const resultNumCPU = new BigIntPrimitive("0", this.canvas, { forceCPU: true })
    resultNumCPU.limbs = fL; resultNumCPU.sign = 1
    if (resultNumCPU.isZero()) { resultNumCPU.sign = 1; resultNumCPU.exponent = 0 }
    return resultNumCPU
  }

  _webgl_multiply_full(cache, num1, num2) {
    const gl = cache.gl;
    const num1LimbsLSL = [...num1.limbs].reverse();
    const num2LimbsLSL = [...num2.limbs].reverse();

    try {
      const lenA = num1LimbsLSL.length;
      const lenB = num2LimbsLSL.length;
      const outputTexWidthCoeffSums = lenA + lenB - 1;

      if (lenA === 0 || lenB === 0) {
        const zeroResult = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
        zeroResult.exponent = num1.exponent + num2.exponent;
        return zeroResult;
      }

      const partialProductTexDim = Math.max(lenA, lenB);
      const paddedNum1LimbsLSL = new Float32Array(partialProductTexDim); for (let i = 0; i < lenA; i++) paddedNum1LimbsLSL[i] = num1LimbsLSL[i];
      const paddedNum2LimbsLSL = new Float32Array(partialProductTexDim); for (let i = 0; i < lenB; i++) paddedNum2LimbsLSL[i] = num2LimbsLSL[i];

      const program = BigIntPrimitive._getOrCreateProgram(cache, 'multiply_full', multiplyFullVertexShaderSrc, multiplyFullFragmentShaderSrc);
      const positionBuffer = BigIntPrimitive._getOrCreateBuffer(cache, 'multiply_full_position', new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]));
      const texCoordBuffer = BigIntPrimitive._getOrCreateBuffer(cache, 'multiply_full_texCoord', new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));
      
      const texNum1 = BigIntPrimitive._getOrCreateTexture(cache, 'multiply_full_num1', partialProductTexDim, 1, false);
      const texNum2 = BigIntPrimitive._getOrCreateTexture(cache, 'multiply_full_num2', partialProductTexDim, 1, false);
      const texPartialProducts = BigIntPrimitive._getOrCreateTexture(cache, 'multiply_full_partialProducts', partialProductTexDim, partialProductTexDim, true);

      gl.bindTexture(gl.TEXTURE_2D, texNum1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, partialProductTexDim, 1, gl.RGBA, gl.FLOAT, (() => { let arr = new Float32Array(partialProductTexDim * 4); for (let i = 0; i < partialProductTexDim; i++) arr[i * 4] = paddedNum1LimbsLSL[i]; return arr; })());
      gl.bindTexture(gl.TEXTURE_2D, texNum2);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, partialProductTexDim, 1, gl.RGBA, gl.FLOAT, (() => { let arr = new Float32Array(partialProductTexDim * 4); for (let i = 0; i < partialProductTexDim; i++) arr[i * 4] = paddedNum2LimbsLSL[i]; return arr; })());

      const fbPartialProducts = BigIntPrimitive._getOrCreateFramebuffer(cache, 'multiply_full_fb', texPartialProducts);
      const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (fbStatus !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`WEBGL_FRAMEBUFFER_ERROR: Framebuffer incomplete for partial products. Status: ${webglUtilsModule.getFramebufferStatusString(gl, fbStatus)}`);
      }

      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texNum1); gl.uniform1i(gl.getUniformLocation(program, "u_num1Texture"), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNum2); gl.uniform1i(gl.getUniformLocation(program, "u_num2Texture"), 1);
      gl.uniform1f(gl.getUniformLocation(program, "u_texWidth"), partialProductTexDim);
      gl.uniform1f(gl.getUniformLocation(program, "u_base"), BASE);
      
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      const posAttrLocMultiply = gl.getAttribLocation(program, "a_position");
      gl.enableVertexAttribArray(posAttrLocMultiply);
      gl.vertexAttribPointer(posAttrLocMultiply, 2, gl.FLOAT, false, 0, 0);
      
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      const texCoordAttrLoc = gl.getAttribLocation(program, "a_texCoord");
      gl.enableVertexAttribArray(texCoordAttrLoc);
      gl.vertexAttribPointer(texCoordAttrLoc, 2, gl.FLOAT, false, 0, 0);

      gl.viewport(0, 0, partialProductTexDim, partialProductTexDim);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      const partialProducts = webglUtilsModule.readDataFromTexture(gl, fbPartialProducts, partialProductTexDim, partialProductTexDim, false);

      const resultLimbs = new Array(outputTexWidthCoeffSums + 1).fill(0);
      for (let i = 0; i < partialProductTexDim; i++) {
        for (let j = 0; j < partialProductTexDim; j++) {
          const k = i + j;
          const product = partialProducts[(i * partialProductTexDim + j) * 4];
          const carry = partialProducts[(i * partialProductTexDim + j) * 4 + 1];
          resultLimbs[k] += product;
          if (k + 1 < resultLimbs.length) {
            resultLimbs[k + 1] += carry;
          }
        }
      }

      let carry = 0;
      for (let i = 0; i < resultLimbs.length; i++) {
        const sum = resultLimbs[i] + carry;
        resultLimbs[i] = sum % BASE;
        carry = Math.floor(sum / BASE);
      }

      while (carry > 0) {
        resultLimbs.push(carry % BASE);
        carry = Math.floor(carry / BASE);
      }

      const finalLimbsLSL = resultLimbs;
      let resultCoeffStr = "";
      if (finalLimbsLSL.length === 0) { resultCoeffStr = "0" }
      else { let mslIdx = finalLimbsLSL.length - 1; while (mslIdx > 0 && finalLimbsLSL[mslIdx] === 0) mslIdx--; resultCoeffStr = String(finalLimbsLSL[mslIdx]); for (let i = mslIdx - 1; i >= 0; i--) resultCoeffStr += String(finalLimbsLSL[i]).padStart(BASE_LOG10, '0') }
      if (resultCoeffStr === "" || /[^0-9]/.test(resultCoeffStr)) {
        console.warn("[WebGL Multiply] Invalid coefficient string from GPU, falling back to CPU.", resultCoeffStr);
        return this._core_multiply_cpu(num1, num2);
      }

      const resultBigInt = BigIntPrimitive.fromCoefficientString(resultCoeffStr, this.canvas, { forceCPU: true });
      resultBigInt.sign = num1.sign * num2.sign;
      resultBigInt.exponent = num1.exponent + num2.exponent;
      return resultBigInt;

    } catch (e) {
      console.warn(`[BigInt._webgl_multiply_full] WebGL error during multiply: ${e.message}. Falling back to CPU.`);
      return this._core_multiply_cpu(num1, num2);
    }
  }

  _multiply_limb_by_bigint(limbValue, otherNumber) { // CPU fallback
    if (limbValue === 0 || otherNumber.isZero()) return new BigIntPrimitive("0", this.canvas, { forceCPU: true })
    const oLR = [...otherNumber.limbs].reverse(); let rL = []; let c = 0
    for (let i = 0; i < oLR.length; i++) { const p = oLR[i] * limbValue + c; rL.push(p % BASE); c = Math.floor(p / BASE) }
    while (c > 0) { rL.push(c % BASE); c = Math.floor(c / BASE) }
    let fL = rL.reverse(); while (fL.length > 1 && fL[0] === 0) fL.shift(); if (fL.length === 0) fL = [0]
    const res = new BigIntPrimitive("0", this.canvas, { forceCPU: true }); res.limbs = fL; res.sign = 1; res.exponent = 0; if (res.isZero()) res.exponent = 0; return res
  }

  _core_multiply_cpu(num1, num2) { // CPU fallback for full multiplication
    if (num1.isZero() || num2.isZero()) return new BigIntPrimitive("0", this.canvas, { forceCPU: true })
    let tR = new BigIntPrimitive("0", this.canvas, { forceCPU: true }); const n1LR = [...num1.limbs].reverse()
    for (let i = 0; i < n1LR.length; i++) {
      const d1 = n1LR[i]; if (d1 === 0 && n1LR.length > 1 && num1.limbs.length > 1) continue
      let pPM = this._multiply_limb_by_bigint(d1, num2) // Uses CPU limb mult
      if (!pPM.isZero()) {
        let pPMcoeffStr = pPM.limbs.map((l, idx) => idx === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0')).join('')
        if (i > 0 && pPMcoeffStr !== "0") pPMcoeffStr += '0'.repeat(i * BASE_LOG10)
        const sPP = BigIntPrimitive.fromCoefficientString(pPMcoeffStr, this.canvas, { forceCPU: true })
        tR = tR.add(sPP) // Uses CPU add
      }
    }
    if (tR.isZero()) { tR.sign = 1; tR.exponent = 0 } else { tR.sign = 1; if (!tR.isZero()) tR.exponent = 0 }
    return tR
  }

  multiply(otherBigInt) {
    const self = this;
    if (!(otherBigInt instanceof BigIntPrimitive)) { throw new TypeError("Input must be an instance of BigIntPrimitive.") }
    if (self.isZero() || otherBigInt.isZero()) {
      return new BigIntPrimitive("0", self.canvas, { forceCPU: self.forceCPU || otherBigInt.forceCPU });
    }
    const finalExponent = self.exponent + otherBigInt.exponent;
    const resultSign = (self.sign === otherBigInt.sign) ? 1 : -1;

    const selfCoeffStr = self.limbs.map((l, idx) => idx === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0')).join('');
    const selfCoeff = BigIntPrimitive.fromCoefficientString(selfCoeffStr, self.canvas, { forceCPU: true });
    const otherCoeffStr = otherBigInt.limbs.map((l, idx) => idx === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0')).join('');
    const otherCoeff = BigIntPrimitive.fromCoefficientString(otherCoeffStr, self.canvas, { forceCPU: true });

    let absResult;
    if (!self.forceCPU && !otherBigInt.forceCPU && self.canvas && typeof webglUtilsModule !== 'undefined') {
      let cache;
      try {
        cache = BigIntPrimitive._getWebGLResources(self.canvas);
        if (cache && cache.gl) {
          absResult = self._webgl_multiply_full(cache, selfCoeff, otherCoeff);
        } else {
          // WebGL not available, fall back to CPU
          absResult = self._core_multiply_cpu(selfCoeff, otherCoeff);
        }
      } catch (e) {
        console.warn(`[BigInt.multiply] WebGL multiplication failed: ${e.message}. Falling back to CPU.`);
        absResult = self._core_multiply_cpu(selfCoeff, otherCoeff);
      }
    } else {
      // Use CPU if forced
      absResult = self._core_multiply_cpu(selfCoeff, otherCoeff);
    }

    // Post-processing of absResult (which has exponent 0 and sign 1)
    let finalNumString;
    if (absResult.isZero()) {
      finalNumString = "0";
    } else {
      let coeffStr = absResult.limbs.map((l, idx) => (idx === 0) ? String(l) : String(l).padStart(BASE_LOG10, '0')).join('');
      let tempForStrFormat = BigIntPrimitive.fromCoefficientString(coeffStr, self.canvas, { forceCPU: true });
      tempForStrFormat.exponent = finalExponent;
      tempForStrFormat.sign = resultSign;
      if (tempForStrFormat.isZero() && resultSign === -1) { finalNumString = "0" }
      else { finalNumString = tempForStrFormat.toString() }
    }
    const finalResult = new BigIntPrimitive(finalNumString, self.canvas, { forceCPU: self.forceCPU || otherBigInt.forceCPU });
    return finalResult;
  }

  _createTextureForBigInt(gl, bigIntValue, texWidth, texHeight = 1, isOutputTexture = false) {
    if (!(bigIntValue instanceof BigIntPrimitive)) throw new TypeError("_createTextureForBigInt expects a BigIntPrimitive instance.")
    if (!gl) throw new Error("_createTextureForBigInt requires a WebGL context.")
    let limbData
    if (isOutputTexture) { limbData = null }
    else { const lslLimbs = [...bigIntValue.limbs].reverse(); const totalElements = texWidth * texHeight; limbData = new Float32Array(totalElements); for (let i = 0; i < totalElements; i++) limbData[i] = (i < lslLimbs.length) ? lslLimbs[i] : 0 }
    return webglUtilsModule.createDataTexture(gl, limbData, texWidth, texHeight, isOutputTexture)
  }

  _bigIntFromTextureData(gl, framebuffer, texWidth, texHeight = 1, targetExponent, targetSign) {
    if (!gl) throw new Error("_bigIntFromTextureData requires a WebGL context.")
    if (!framebuffer) throw new Error("_bigIntFromTextureData requires a framebuffer.")
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    const textureDataRGBA = webglUtilsModule.readDataFromTexture(gl, framebuffer, texWidth, texHeight, false)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const lslLimbs = []; const totalElements = texWidth * texHeight
    for (let i = 0; i < totalElements; i++) lslLimbs.push(textureDataRGBA[i * 4 + 0])
    while (lslLimbs.length > 1 && lslLimbs[lslLimbs.length - 1] === 0) lslLimbs.pop()
    if (lslLimbs.length === 0) lslLimbs.push(0)
    let coeffStr = ""
    if (lslLimbs.length > 0) { coeffStr = String(lslLimbs[lslLimbs.length - 1]); for (let i = lslLimbs.length - 2; i >= 0; i--) coeffStr += String(lslLimbs[i]).padStart(BASE_LOG10, '0') }
    else { coeffStr = "0" }
    if (coeffStr === "") coeffStr = "0"
    const resultBigInt = BigIntPrimitive.fromCoefficientString(coeffStr, this.canvas, { forceCPU: true })
    resultBigInt.exponent = targetExponent; resultBigInt.sign = targetSign
    if (resultBigInt.isZero()) { resultBigInt.exponent = 0; resultBigInt.sign = 1 }
    return resultBigInt
  }

  _webgl_multiply_textures(gl, texA, texAWidth, texB, texBWidth, targetResultLimbLength) {
    // ... (This method seems complex and might be part of an older approach, ensure it's still needed or simplify/remove)
    // For now, assuming it's correctly implemented or will be reviewed later if division relies on it heavily.
    // It should also adopt the error throwing pattern for capability/framebuffer issues.
    // Placeholder for brevity, original content was extensive.
    console.warn("_webgl_multiply_textures called. Ensure its error handling is robust.")
    throw new Error("WEBGL_CAPABILITY_ERROR: _webgl_multiply_textures placeholder hit, needs review or indicates path error.")
  }

  _webgl_subtract_textures(gl, texMinuend, texSubtrahend, texWidth) {
    // ... (Similar to _webgl_multiply_textures, review if essential for division's WebGL path)
    // Placeholder for brevity.
    console.warn("_webgl_subtract_textures called. Ensure its error handling is robust.")
    throw new Error("WEBGL_CAPABILITY_ERROR: _webgl_subtract_textures placeholder hit, needs review or indicates path error.")
  }


  _webgl_reciprocal_using_bigint_ops(B_prime_BigInt, X0_BigInt, numIterations, targetOutputDP) {
    console.log(`[_webgl_reciprocal_using_bigint_ops START] B_prime: ${B_prime_BigInt.toString()}, X0: ${X0_BigInt.toString()}, iterations: ${numIterations}, targetDP: ${targetOutputDP}`)

    const originalDP = BigIntPrimitive.DP
    const originalRM = BigIntPrimitive.RM

    const inputSizeForWork = Math.max(this.limbs.length, B_prime_BigInt.limbs.length)
    const workingDP = Math.max(50, targetOutputDP + 50) + Math.min(inputSizeForWork * 10, 50)
    BigIntPrimitive.DP = workingDP
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfEven

    console.log(`[_webgl_reciprocal_using_bigint_ops] Working precision: ${workingDP}`)

    const B_prime = new BigIntPrimitive(B_prime_BigInt, this.canvas)
    let X_current = new BigIntPrimitive(X0_BigInt, this.canvas)
    const two = new BigIntPrimitive("2", this.canvas)

    console.log(`[_webgl_reciprocal_using_bigint_ops] B_prime: ${B_prime.toString()}`)
    console.log(`[_webgl_reciprocal_using_bigint_ops] X0: ${X_current.toString()}`)

    for (let i = 0; i < numIterations; i++) {
      console.log(`[_webgl_reciprocal_using_bigint_ops Iter ${i + 1}] X_current: ${X_current.toString()}`)

      const prod_BX = B_prime.multiply(X_current)
      console.log(`[_webgl_reciprocal_using_bigint_ops Iter ${i + 1}] B * X: ${prod_BX.toString()}`)

      const term_2_minus_BX = two.subtract(prod_BX)
      console.log(`[_webgl_reciprocal_using_bigint_ops Iter ${i + 1}] 2 - BX: ${term_2_minus_BX.toString()}`)

      const next_X = X_current.multiply(term_2_minus_BX)
      console.log(`[_webgl_reciprocal_using_bigint_ops Iter ${i + 1}] X * (2 - BX): ${next_X.toString()}`)

      if (i > 0) {
        const diff = next_X.subtract(X_current).abs()
        const threshold = new BigIntPrimitive("1e-" + (workingDP - 2), this.canvas)

        if (diff.lt(threshold)) {
          console.log(`[_webgl_reciprocal_using_bigint_ops] Converged at iteration ${i + 1}`)
          X_current = next_X
          break
        }
      }

      X_current = next_X
    }

    console.log(`[_webgl_reciprocal_using_bigint_ops] Final X: ${X_current.toString()}`)

    const verification = X_current.multiply(B_prime)
    console.log(`[_webgl_reciprocal_using_bigint_ops] Verification: X * B = ${verification.toString()}`)

    BigIntPrimitive.DP = originalDP
    BigIntPrimitive.RM = originalRM

    const final_reciprocal = X_current.round(targetOutputDP, BigIntPrimitive.RM)
    console.log(`[_webgl_reciprocal_using_bigint_ops] Final reciprocal: ${final_reciprocal.toString()}`)

    return final_reciprocal
  }

  pow(exp) {
    if (typeof exp !== 'number' || !Number.isInteger(exp)) { throw new TypeError("Exponent must be an integer.") }
    if (exp < 0) { const one = new BigIntPrimitive("1", this.canvas, { forceCPU: this.forceCPU }); const positivePowerResult = this.pow(Math.abs(exp)); return one.divide(positivePowerResult) } // divide will use its new logic
    if (exp > 1000000) { throw new Error("Exponent too large.") }
    const currentOptions = { forceCPU: this.forceCPU }
    if (exp === 0) { return new BigIntPrimitive("1", this.canvas, currentOptions) }
    if (this.isZero()) { return new BigIntPrimitive(this, this.canvas, currentOptions) }
    if (this.limbs.length === 1 && this.limbs[0] === 1 && this.exponent === 0) { if (this.sign === 1) return new BigIntPrimitive(this, this.canvas, currentOptions); else return exp % 2 === 0 ? new BigIntPrimitive("1", this.canvas, currentOptions) : new BigIntPrimitive(this, this.canvas, currentOptions) }
    if (exp === 1) { return new BigIntPrimitive(this, this.canvas, currentOptions) }
    let res = new BigIntPrimitive("1", this.canvas, currentOptions); let currentBase = new BigIntPrimitive(this, this.canvas, currentOptions); let e = exp
    while (e > 0) { if (e % 2 === 1) res = res.multiply(currentBase); currentBase = currentBase.multiply(currentBase); e = Math.floor(e / 2) } // multiply will use its new logic
    return res
  }

  _shiftLeft(numLimbsToShift) { /* ... unchanged ... */ if (numLimbsToShift < 0) { throw new Error("numLimbsToShift must be non-negative.") } if (this.isZero() || numLimbsToShift === 0) { return new BigIntPrimitive(this, this.canvas) } const result = new BigIntPrimitive(this, this.canvas); result.exponent += numLimbsToShift * BASE_LOG10; return result }
  _splitAt(m) { /* ... unchanged ... */ const currentOptions = { forceCPU: this.forceCPU }; const Ctor = BigIntPrimitive; let s_abs = this.abs().toString(); let s_coeffs = s_abs; let s_abs_exp = 0; const dp_idx = s_abs.indexOf('.'); if (dp_idx !== -1) { s_coeffs = s_abs.replace('.', ''); s_abs_exp = -(s_abs.length - 1 - dp_idx) } let lowStr, highStr; if (m <= 0) { highStr = s_coeffs; lowStr = "0" } else if (m >= s_coeffs.length) { lowStr = s_coeffs; highStr = "0" } else { highStr = s_coeffs.substring(0, s_coeffs.length - m); lowStr = s_coeffs.substring(s_coeffs.length - m) } const high = new Ctor(highStr, this.canvas, currentOptions); const low = new Ctor(lowStr, this.canvas, currentOptions); high.exponent += (s_abs_exp + m); low.exponent += s_abs_exp; if (high.isZero()) { high.exponent = 0 } else { while (high.limbs.length > 1 && high.limbs[high.limbs.length - 1] === 0) { high.limbs.pop(); high.exponent++ } } if (low.isZero()) { low.exponent = 0 } else { while (low.limbs.length > 1 && low.limbs[low.limbs.length - 1] === 0) { low.limbs.pop(); low.exponent++ } } return { low, high } }
  _multiplyByPowerOfBase(power) { /* ... unchanged ... */ const currentOptions = { forceCPU: this.forceCPU }; if (typeof power !== 'number' || !Number.isInteger(power)) { throw new Error("Power must be an integer.") } if (this.isZero()) { return new BigIntPrimitive("0", this.canvas, currentOptions) } if (power === 0) { return new BigIntPrimitive(this, this.canvas, currentOptions) } const result = new BigIntPrimitive(this, this.canvas, currentOptions); result.exponent += power * BASE_LOG10; return result } // Corrected to use BASE_LOG10
  _longDivide(positiveDividend, positiveDivisor) { /* ... unchanged, uses BigInt, assumes it's for integer part primarily ... */ if (!(positiveDividend instanceof BigIntPrimitive) || !(positiveDivisor instanceof BigIntPrimitive)) { throw new TypeError("Inputs to _longDivide must be BigIntPrimitive instances.") } if (positiveDivisor.isZero()) { throw new Error("Division by zero") } if (positiveDividend.isZero()) { return { quotient: new BigIntPrimitive("0", this.canvas), remainder: new BigIntPrimitive("0", this.canvas) } } const comparison = positiveDividend.compareMagnitude(positiveDivisor); if (comparison < 0) { return { quotient: new BigIntPrimitive("0", this.canvas), remainder: new BigIntPrimitive(positiveDividend, this.canvas) } } if (comparison === 0) { return { quotient: new BigIntPrimitive("1", this.canvas), remainder: new BigIntPrimitive("0", this.canvas) } } let dividendStr = positiveDividend.abs().toString().split('.')[0]; let divisorStr = positiveDivisor.abs().toString().split('.')[0]; if (divisorStr === "0" || BigInt(divisorStr) === 0n) throw new Error("Division by zero."); if (dividendStr === "0") return { quotient: new BigIntPrimitive("0", this.canvas), remainder: new BigIntPrimitive("0", this.canvas) }; const q = BigInt(dividendStr) / BigInt(divisorStr); const r = BigInt(dividendStr) % BigInt(divisorStr); return { quotient: new BigIntPrimitive(q.toString(), this.canvas), remainder: new BigIntPrimitive(r.toString(), this.canvas) } }
  _decimalDivide(divisorParam, numDecimalPlacesParam) { /* ... unchanged, CPU division logic ... */ const dividend = new BigIntPrimitive(this, this.canvas); const divisor = new BigIntPrimitive(divisorParam, this.canvas); if (divisor.isZero()) throw new Error("Division by zero in _decimalDivide."); if (dividend.isZero()) return new BigIntPrimitive("0", this.canvas); if (dividend.isNegative() || divisor.isNegative()) throw new Error("_decimalDivide expects positive inputs."); let d_val_str = dividend.limbs.map((l, i) => i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0')).join(''); let d_exp = dividend.exponent; let v_val_str = divisor.limbs.map((l, i) => i === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0')).join(''); let v_exp = divisor.exponent; let dividendStrForScaling = d_val_str; const actualNumDecimalPlaces = (typeof numDecimalPlacesParam === 'number' && numDecimalPlacesParam >= 0) ? numDecimalPlacesParam : 0; dividendStrForScaling += '0'.repeat(actualNumDecimalPlaces); const biDividend = BigInt(dividendStrForScaling); const biDivisor = BigInt(v_val_str); if (biDivisor === 0n) throw new Error("Division by zero after BigInt conversion for divisor."); const biResult = biDividend / biDivisor; const q_int_str = biResult.toString(); const resultNum = new BigIntPrimitive(q_int_str, this.canvas, { forceCPU: true }); const exponent_from_parsing_resultStr = resultNum.exponent; const final_exponent_for_resultNum = exponent_from_parsing_resultStr + d_exp - v_exp - actualNumDecimalPlaces; resultNum.exponent = final_exponent_for_resultNum; if (resultNum.isZero()) resultNum.exponent = 0; resultNum.sign = 1; return resultNum }

  divideAndRemainder(divisorBigInt) {
    if (!(divisorBigInt instanceof BigIntPrimitive)) { throw new TypeError("Divisor must be an instance of BigIntPrimitive.") }
    if (divisorBigInt.isZero()) { throw new Error("Division by zero") }
    const quotient = this.divide(divisorBigInt) // This will use the updated divide logic
    const oldDP = BigIntPrimitive.DP; const oldRM = BigIntPrimitive.RM
    // Determine a safe DP for intermediate product and subtraction
    let tempDP = Math.max(oldDP, Math.abs(this.exponent), Math.abs(divisorBigInt.exponent), Math.abs(quotient.exponent)) +
      this.limbs.length * BASE_LOG10 + divisorBigInt.limbs.length * BASE_LOG10 + 10
    BigIntPrimitive.DP = tempDP; BigIntPrimitive.RM = BigIntPrimitive.roundDown // Use roundDown for remainder calculation precision
    const product = quotient.multiply(divisorBigInt) // multiply will use its updated logic
    const remainder = this.subtract(product)    // subtract will use its updated logic
    BigIntPrimitive.DP = oldDP; BigIntPrimitive.RM = oldRM
    if (!remainder.isZero()) { remainder.sign = this.sign } else { remainder.sign = 1; remainder.exponent = 0 }
    return { quotient, remainder }
  }

  divide(divisorBigInt) {
    if (!(divisorBigInt instanceof BigIntPrimitive)) { throw new TypeError("Divisor must be an instance of BigIntPrimitive.") }
    if (divisorBigInt.isZero()) { throw new Error("[big.js] Division by zero") }
    if (this.isZero()) { return new BigIntPrimitive("0", this.canvas) }

    const quotientSign = (this.sign === divisorBigInt.sign) ? 1 : -1;
    const absDividend = this.abs();
    const absDivisor = divisorBigInt.abs();

    if (!this.forceCPU && !divisorBigInt.forceCPU && this.canvas && typeof webglUtilsModule !== 'undefined') {
      try {
        const gl = webglUtilsModule.initWebGL(this.canvas);
        if (!gl) throw new Error("WEBGL_CAPABILITY_ERROR: WebGL context not obtainable.");

        console.log("[GPU Divide Path START]");

        const originalDP = BigIntPrimitive.DP;
        const originalRM = BigIntPrimitive.RM;

        // Use a high precision for the reciprocal calculation
        const reciprocalDP = originalDP + absDividend.limbs.length * BASE_LOG10 + absDivisor.limbs.length * BASE_LOG10 + 15;
        
        // Initial guess for reciprocal
        const initialGuessNumber = 1 / absDivisor.toNumber();
        const X0 = new BigIntPrimitive(initialGuessNumber, this.canvas, { forceCPU: true });

        // Calculate reciprocal using (currently CPU-based) Newton-Raphson
        const reciprocal = this._webgl_reciprocal_using_bigint_ops(absDivisor, X0, 5, reciprocalDP);

        // Multiply dividend by reciprocal. This can use WebGL.
        const quotient = absDividend.multiply(reciprocal);

        // Set sign and round to the originally requested precision
        quotient.sign = quotientSign;
        if (quotient.isZero()) {
            quotient.sign = 1;
            quotient.exponent = 0;
        }

        BigIntPrimitive.DP = originalDP;
        BigIntPrimitive.RM = originalRM;
        
        const finalQuotient = quotient.round(BigIntPrimitive.DP, BigIntPrimitive.RM);

        if (finalQuotient.isZero()) {
            finalQuotient.sign = 1; // Reset sign for zero
            if (quotientSign === -1 && !this.isZero() && BigIntPrimitive.DP === 0) {
               finalQuotient.sign = -1;
            }
        }
        finalQuotient._roundedDp = BigIntPrimitive.DP;
        
        console.log("[GPU Divide Path END]");
        return finalQuotient;

      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.warn(`[BigInt.divide] WebGL path failed: ${msg}. Falling back to CPU.`);
      }
    }

    // CPU fallback
    const originalGlobalDP = BigIntPrimitive.DP
    const originalGlobalRM = BigIntPrimitive.RM
    const internalPrecisionCPU = Math.max(originalGlobalDP, Math.abs(this.exponent), Math.abs(divisorBigInt.exponent)) +
      this.limbs.length * BASE_LOG10 + divisorBigInt.limbs.length * BASE_LOG10 + 25
    BigIntPrimitive.DP = internalPrecisionCPU
    BigIntPrimitive.RM = BigIntPrimitive.roundDown

    let quotientCPU = absDividend._decimalDivide(absDivisor, internalPrecisionCPU) // _decimalDivide is CPU
    quotientCPU.sign = quotientSign
    if (quotientCPU.isZero()) { quotientCPU.sign = 1; quotientCPU.exponent = 0 }

    BigIntPrimitive.DP = originalGlobalDP
    BigIntPrimitive.RM = originalGlobalRM

    quotientCPU = quotientCPU.round(BigIntPrimitive.DP, BigIntPrimitive.RM)
    if (quotientCPU.isZero() && BigIntPrimitive.DP === 0 && quotientSign === -1 && !this.isZero()) {
      quotientCPU.sign = -1
    } else if (quotientCPU.isZero()) {
      quotientCPU.sign = 1
    }

    quotientCPU._roundedDp = BigIntPrimitive.DP
    return quotientCPU
  }

  

  remainder(divisorBigInt) { const { remainder } = this.divideAndRemainder(divisorBigInt); return remainder }

  static _staticRound(inputLimbsMsbFirst, inputExponent, inputSign, dpUndefined, rmUndefined) { /* ... unchanged ... */ const dp = dpUndefined === undefined ? 0 : dpUndefined; const rm = rmUndefined === undefined ? BigIntPrimitive.RM : rmUndefined; const tempNumForStr = new BigIntPrimitive("0"); tempNumForStr.limbs = [...inputLimbsMsbFirst]; tempNumForStr.exponent = inputExponent; if (tempNumForStr.isZero()) { return { limbs: [0], exponent: 0, sign: 1 } } const originalPETemp = BigIntPrimitive.PE; const originalNETemp = BigIntPrimitive.NE; BigIntPrimitive.PE = 1e9; BigIntPrimitive.NE = -1e9; let s = tempNumForStr.toString(); BigIntPrimitive.PE = originalPETemp; BigIntPrimitive.NE = originalNETemp; let [integerS, fractionalS = ''] = s.split('.'); if (integerS === "" && fractionalS !== "") integerS = "0"; if (integerS === "-0" && inputSign === -1) { } else if (integerS === "-0") integerS = "0"; if (integerS === "") integerS = "0"; let applyRoundingEffect = 0; const effectiveSign = (integerS === "0" && (!fractionalS || /^[0]*$/.test(fractionalS))) ? 1 : inputSign; if (dp >= 0) { if (dp >= fractionalS.length) { } else { const roundDigitVal = parseInt(fractionalS[dp], 10); const trailingDigitsStr = fractionalS.substring(dp + 1); const hasNonZeroTrailing = !/^[0]*$/.test(trailingDigitsStr); const isExactlyHalfWay = roundDigitVal === 5 && !hasNonZeroTrailing; switch (rm) { case BigIntPrimitive.roundDown: break; case BigIntPrimitive.roundHalfUp: if (roundDigitVal >= 5) applyRoundingEffect = 1; break; case BigIntPrimitive.roundHalfEven: if (roundDigitVal > 5) applyRoundingEffect = 1; else if (isExactlyHalfWay) { const prevDigit = dp > 0 ? parseInt(fractionalS[dp - 1], 10) : parseInt(integerS[integerS.length - 1] || '0', 10); if (prevDigit % 2 !== 0) applyRoundingEffect = 1 } else if (roundDigitVal === 5 && hasNonZeroTrailing) { applyRoundingEffect = 1 } break; case BigIntPrimitive.roundUp: if (!/^[0]*$/.test(fractionalS.substring(dp))) applyRoundingEffect = 1; break } fractionalS = fractionalS.substring(0, dp) } } else { const roundPosInInt = integerS.length + dp; let originalFractionalForCheck = fractionalS; fractionalS = ''; if (roundPosInInt <= 0) { const isEffectivelyZeroMagnitude = (integerS === "0" || integerS === "-0") && /^[0]*$/.test(originalFractionalForCheck); if (isEffectivelyZeroMagnitude) { applyRoundingEffect = 0 } else { const firstDiscardedDigit = (integerS.startsWith("-") ? integerS[1] : integerS[0]) || '0'; const firstDiscardedDigitVal = parseInt(firstDiscardedDigit, 10); const allDiscardedAreZero = /^[0]*$/.test(integerS.substring(1 + (integerS.startsWith("-") ? 1 : 0))) && /^[0]*$/.test(originalFractionalForCheck); switch (rm) { case BigIntPrimitive.roundDown: break; case BigIntPrimitive.roundHalfUp: if (firstDiscardedDigitVal >= 5) applyRoundingEffect = 1; break; case BigIntPrimitive.roundHalfEven: if (firstDiscardedDigitVal > 5) applyRoundingEffect = 1; else if (firstDiscardedDigitVal === 5 && !allDiscardedAreZero) { applyRoundingEffect = 1 } break; case BigIntPrimitive.roundUp: applyRoundingEffect = 1; break } } integerS = applyRoundingEffect ? "1" : "0"; applyRoundingEffect = 0 } else { const roundDigitVal = parseInt(integerS[roundPosInInt] || '0', 10); const discardedFollowingIntPartIsNonZero = !/^[0]*$/.test(integerS.substring(roundPosInInt + 1)); const isExactlyHalfWay = roundDigitVal === 5 && !discardedFollowingIntPartIsNonZero && /^[0]*$/.test(originalFractionalForCheck); switch (rm) { case BigIntPrimitive.roundDown: break; case BigIntPrimitive.roundHalfUp: if (roundDigitVal >= 5) applyRoundingEffect = 1; break; case BigIntPrimitive.roundHalfEven: if (roundDigitVal > 5) applyRoundingEffect = 1; else if (isExactlyHalfWay) { const prevDigit = parseInt(integerS[roundPosInInt - 1] || '0', 10); if (prevDigit % 2 !== 0) applyRoundingEffect = 1 } else if (roundDigitVal === 5 && !isExactlyHalfWay) { applyRoundingEffect = 1 } break; case BigIntPrimitive.roundUp: if (!/^[0]*$/.test(integerS.substring(roundPosInInt)) || !/^[0]*$/.test(originalFractionalForCheck)) applyRoundingEffect = 1; break } integerS = integerS.substring(0, roundPosInInt); if (integerS === "" || integerS === "-") integerS = effectiveSign === -1 && parseFloat(s) !== 0 ? "-0" : "0" } } if (applyRoundingEffect) { let intPartForCarry = integerS.startsWith('-') ? integerS.substring(1) : integerS; let combinedStrForCarry = intPartForCarry + (dp > 0 ? fractionalS : ""); let digitsArr = combinedStrForCarry.split(''); let carry = 1; let k = digitsArr.length - 1; while (k >= 0 && carry > 0) { let digitVal = parseInt(digitsArr[k], 10) + carry; digitsArr[k] = String(digitVal % 10); carry = Math.floor(digitVal / 10); if (carry === 0) break; k-- } if (carry > 0) { digitsArr.unshift(String(carry)) } const originalIntegerLengthBeforeCarry = intPartForCarry.length; let newIntegerLength = originalIntegerLengthBeforeCarry; if (digitsArr.length > combinedStrForCarry.length) { if (dp <= 0 || (digitsArr.length - fractionalS.length > originalIntegerLengthBeforeCarry)) { newIntegerLength++ } } if (dp > 0) { integerS = digitsArr.slice(0, newIntegerLength).join(''); fractionalS = digitsArr.slice(newIntegerLength).join('') } else { integerS = digitsArr.join('') } if (integerS === "") integerS = "0"; if (effectiveSign === -1 && integerS !== "0") integerS = "-" + integerS } let finalS; if (dp > 0) { finalS = (effectiveSign === -1 && integerS === "0" && !/^[0]*$/.test(fractionalS) ? "-0" : integerS) + '.' + (fractionalS || '').padEnd(dp, '0') } else if (dp < 0) { if (integerS === "0" || integerS === "-0") { finalS = "0" } else { finalS = integerS + "0".repeat(-dp) } } else { finalS = integerS } const resultNum = new BigIntPrimitive(finalS); if (resultNum.isZero()) { resultNum.sign = 1; resultNum.exponent = 0 } else { resultNum.sign = effectiveSign } return { limbs: resultNum.limbs, exponent: resultNum.exponent, sign: resultNum.sign } }

  round(dpUndefined, rmUndefined) { /* ... unchanged, uses _staticRound_cpu ... */ let dp = dpUndefined; let rmResolved = rmUndefined; if (dp === undefined) dp = 0; else if (typeof dp !== 'number' || !Number.isInteger(dp) || dp < 0 || dp > 1e6) throw new RangeError("Decimal places NaN or negative or too large"); if (rmResolved === undefined) rmResolved = this.constructor.RM; if (rmResolved !== 0 && rmResolved !== 1 && rmResolved !== 2 && rmResolved !== 3) throw new RangeError("Invalid rounding mode"); const roundingMode = rmResolved; if (this.isZero()) { const zero = new BigIntPrimitive(this); zero._roundedDp = dp; if (dp > 0 && zero.sign === -1) zero.sign = 1; else if (dp === 0 && zero.sign === -1) { /* keep -0 for dp=0 */ } else zero.sign = 1; return zero } let coeffStr = this.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join(''); const numDigitsInCoeff = coeffStr.length; const effectiveIntegerDigits = numDigitsInCoeff + this.exponent; const decisionIndex = effectiveIntegerDigits + dp; const newCoeffStr = this._staticRound_cpu(coeffStr, decisionIndex, roundingMode, this.sign === -1); const result = BigIntPrimitive.fromCoefficientString(newCoeffStr, this.canvas, { forceCPU: this.forceCPU }); result.sign = (result.isZero()) ? 1 : this.sign; result.exponent = -dp; if (result.isZero()) { result.exponent = 0; if (this.sign === -1 && dp === 0 && newCoeffStr === "0") result.sign = -1; else result.sign = 1 } result._roundedDp = dp; return result }
  toExponential(dpUndefined, rmUndefined) { /* ... unchanged, uses round ... */ const Ctor = this.constructor; const actualRm = (rmUndefined === undefined) ? Ctor.RM : rmUndefined; let dp = dpUndefined; if (dp !== undefined && (typeof dp !== 'number' || !Number.isInteger(dp) || dp < 0 || dp > 1E6)) throw new RangeError("Invalid decimal places"); if (rmUndefined !== undefined && (rmUndefined < 0 || rmUndefined > 3 || !Number.isInteger(rmUndefined))) throw new RangeError("Invalid rounding mode"); if (this.isZero()) { let zeroStr = "0"; if (dp !== undefined && dp > 0) { zeroStr += "." + "0".repeat(dp) } return zeroStr + "e+0" } let coeffStr = this.limbs.map((limb, idx) => (idx === 0) ? String(limb) : String(limb).padStart(BASE_LOG10, '0')).join(''); let currentExponent = this.exponent; let sciExp = (coeffStr.length - 1) + currentExponent; const significand = Ctor.fromCoefficientString(coeffStr, this.canvas, { forceCPU: true }); significand.exponent = currentExponent - sciExp; significand.sign = 1; const dpForRounding = (dp === undefined) ? coeffStr.length - 1 : dp; let roundedSignificand = significand.round(dpForRounding, actualRm); let roundedCoeffStr = roundedSignificand.limbs.map((l, i) => (i === 0) ? String(l) : String(l).padStart(BASE_LOG10, '0')).join(''); let roundedCoeffExp = roundedSignificand.exponent; let roundedNumIntegerDigits = roundedCoeffStr.length + roundedCoeffExp; if (roundedCoeffStr !== "0" && roundedNumIntegerDigits !== 1) { sciExp += (roundedNumIntegerDigits - 1); roundedSignificand.exponent -= (roundedNumIntegerDigits - 1); if (dp !== undefined) roundedSignificand = roundedSignificand.round(dp, actualRm) } let finalCoeffStr = roundedSignificand.toString(); if (dp !== undefined) { let parts = finalCoeffStr.split('.'); if (dp === 0) finalCoeffStr = parts[0]; else { let fractionalPart = parts[1] || ""; finalCoeffStr = parts[0] + "." + fractionalPart.padEnd(dp, '0').substring(0, dp) } } else { if (finalCoeffStr.includes('.') && !finalCoeffStr.substring(finalCoeffStr.indexOf('.') + 1).match(/[1-9]/)) finalCoeffStr = finalCoeffStr.split('.')[0] } let res = (this.sign === -1 && parseFloat(finalCoeffStr) !== 0 ? "-" : "") + finalCoeffStr; res += 'e' + (sciExp >= 0 ? '+' : '-') + Math.abs(sciExp); return res }
  toFixed(dpUndefined, rmUndefined) {
    const Ctor = this.constructor
    const actualRm = (rmUndefined === undefined ? Ctor.RM : rmUndefined)
    let dp = dpUndefined

    if (dp === undefined) {
      const oldPE = Ctor.PE; Ctor.PE = 1e9
      const oldNE = Ctor.NE; Ctor.NE = -1e9
      const str = this.toString() // Will be compact due to toString() changes
      Ctor.PE = oldPE; Ctor.NE = oldNE
      return str
    }

    if (typeof dp !== 'number' || !Number.isInteger(dp) || dp < 0 || dp > 1e6) {
      throw new RangeError("Invalid decimal places")
    }

    const oldPE = Ctor.PE; Ctor.PE = 1e9
    const oldNE = Ctor.NE; Ctor.NE = -1e9
    // round() correctly rounds the number to dp decimal places.
    // The _roundedDp property on roundedNum is set by round(), but toString() now ignores it for general formatting.
    const roundedNum = this.round(dp, actualRm)
    Ctor.PE = oldPE; Ctor.NE = oldNE

    if (roundedNum.isZero()) {
      if (dp > 0) return '0.' + '0'.repeat(dp)
      // big.js behavior: new Big(-0.123).toFixed(0) is '-0'.
      // Check if the original number `this` was non-zero and negative.
      const originalWasNonZeroNegative = this.sign === -1 && (this.limbs.length > 1 || this.limbs[0] !== 0 || this.exponent !== 0)
      return originalWasNonZeroNegative ? '-0' : '0'
    }

    // Get the compact string representation of the (correctly rounded) number.
    // This string will not have unnecessary trailing zeros (e.g., "123", "0.25").
    // It will correctly reflect the sign of roundedNum (e.g. "-0.25" if it was negative).
    let baseStr = roundedNum.toString()

    let signPrefix = ""
    if (baseStr.startsWith('-')) {
      signPrefix = "-"
      baseStr = baseStr.substring(1) // Work with magnitude string
    }

    let [integerPart, fractionalPart = ''] = baseStr.split('.')

    if (dp === 0) {
      return signPrefix + integerPart
    } else {
      fractionalPart = fractionalPart.padEnd(dp, '0')
      // The round(dp) call should have ensured that the fractional part
      // (before padding) is not longer than dp significant digits relative to rounding point.
      // So, we only need to padEnd, not substring.
      return signPrefix + integerPart + '.' + fractionalPart
    }
  }
  sqrt() { /* ... unchanged, uses divide/add/multiply ... */ if (this.isNegative()) throw new Error('[big.js] No square root of negative number'); if (this.isZero()) return new BigIntPrimitive('0', this.canvas); const S = this; const two = new BigIntPrimitive('2', this.canvas); const one = new BigIntPrimitive('1', this.canvas); const originalDP = BigIntPrimitive.DP; const originalRM = BigIntPrimitive.RM; const sExponent = S.exponent; const sLimbsStr = S.limbs.map((l, idx) => idx === 0 ? String(l) : String(l).padStart(BASE_LOG10, '0')).join(''); const sNumDigits = sLimbsStr.length; const internalDP = originalDP + Math.max(10, sExponent + sNumDigits + 5); const guardDP = originalDP + 3; let current_x; if (S.eq(one)) { current_x = new BigIntPrimitive('1', this.canvas) } else { BigIntPrimitive.DP = internalDP; current_x = S.divide(two); BigIntPrimitive.DP = originalDP; if (current_x.isZero() && !S.isZero()) current_x = S.lt(one) ? new BigIntPrimitive('1', this.canvas) : new BigIntPrimitive(S, this.canvas) } if (current_x.isZero() && !S.isZero()) current_x = new BigIntPrimitive('1', this.canvas); const maxIterations = Math.max(25, Math.min(100, originalDP + sNumDigits + 10)); for (let i = 0; i < maxIterations; i++) { const prev_x_rounded_string = current_x.round(guardDP, originalRM).toString(); BigIntPrimitive.DP = internalDP; BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp; const y = current_x.add(S.divide(current_x)).divide(two); const y_rounded_string = y.round(guardDP, originalRM).toString(); if (prev_x_rounded_string === y_rounded_string) { current_x = y; break } current_x = y } BigIntPrimitive.DP = originalDP; BigIntPrimitive.RM = originalRM; return current_x.round(originalDP, originalRM) }
  prec(sdUndefined, rmUndefined) { /* ... unchanged, uses toExponential & constructor ... */ const Ctor = this.constructor; let actualRm; let sd = sdUndefined; if (sd === undefined || sd === null || typeof sd !== 'number' || !Number.isInteger(sd) || sd < 1) throw new RangeError('[big.js] Significant digits NaN or less than 1'); if (rmUndefined === undefined) actualRm = Ctor.RM; else if (typeof rmUndefined !== 'number' || !Number.isInteger(rmUndefined) || rmUndefined < 0 || rmUndefined > 3) throw new RangeError('[big.js] Rounding mode NaN or invalid'); else actualRm = rmUndefined; if (this.isZero()) { const zeroResult = new Ctor("0", this.canvas, { forceCPU: this.forceCPU }); zeroResult._roundedDp = sd - 1; return zeroResult } const exponentialString = this.toExponential(sd - 1, actualRm); const resultInstance = new Ctor(exponentialString, this.canvas, { forceCPU: this.forceCPU }); return resultInstance }
  toPrecision(sdUndefined, rmUndefined) { /* ... unchanged, uses prec/toFixed/toExponential ... */ const Ctor = this.constructor; let actualRm; let sd = sdUndefined; if (sd === undefined || sd === null) throw new TypeError('[big.js] Argument undefined'); if (typeof sd !== 'number' || !Number.isInteger(sd) || sd < 1 || sd > 1E6) throw new RangeError('[big.js] Significant digits NaN or out of range'); if (rmUndefined === undefined) actualRm = Ctor.RM; else if (typeof rmUndefined !== 'number' || !Number.isInteger(rmUndefined) || rmUndefined < 0 || rmUndefined > 3) throw new RangeError('[big.js] Rounding mode NaN or invalid'); else actualRm = rmUndefined; let str; if (this.isZero()) { str = "0"; if (sd > 1) str += "." + "0".repeat(sd - 1); return str } const roundedNum = this.prec(sd, actualRm); if (roundedNum.isZero()) { str = "0"; if (sd > 1) str += "." + "0".repeat(sd - 1); return str } const roundedNumCoeffStr = roundedNum.limbs.map((l, i) => (i === 0) ? String(l) : String(l).padStart(BASE_LOG10, '0')).join(''); const roundedNumCurrentExponent = roundedNum.exponent; const sciExp = (roundedNumCoeffStr.length - 1) + roundedNumCurrentExponent; const useExponential = sciExp <= Ctor.NE || sciExp >= sd; if (useExponential) return roundedNum.toExponential(sd - 1, actualRm); else { const dpForFixed = Math.max(0, sd - (sciExp + 1)); return roundedNum.toFixed(dpForFixed, actualRm) } }

  // divideAndRemainder method for tests
  divideAndRemainder(divisorBigInt) {
    if (!(divisorBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    
    if (divisorBigInt.isZero()) {
      throw new Error("Division by zero");
    }
    
    if (this.isZero()) { 
      return {
        quotient: new BigIntPrimitive("0", this.canvas),
        remainder: new BigIntPrimitive("0", this.canvas)
      };
    }

    const quotient = this.divide(divisorBigInt);
    const product = quotient.multiply(divisorBigInt);
    const remainder = this.subtract(product);
    
    return {
      quotient: quotient,
      remainder: remainder
    };
  }

}

BigIntPrimitive.prototype._staticRound_cpu = function (coeffStr, decisionIndex, rm, isNegativeOriginal) { /* ... unchanged ... */ const Ctor = this.constructor; let isNegative = isNegativeOriginal; if (coeffStr === "0") return "0"; if (decisionIndex <= 0) { const firstDigitToConsider = coeffStr[0] ? parseInt(coeffStr[0], 10) : 0; let shouldRoundUpToOne = false; if (rm === Ctor.roundHalfUp && firstDigitToConsider >= 5) shouldRoundUpToOne = true; else if (rm === Ctor.roundHalfEven) { if (firstDigitToConsider > 5) shouldRoundUpToOne = true; else if (firstDigitToConsider === 5) { let allFollowingAreZero = true; for (let k = 1; k < coeffStr.length; k++) if (coeffStr[k] !== '0') { allFollowingAreZero = false; break } if (!allFollowingAreZero) shouldRoundUpToOne = true } } else if (rm === Ctor.roundUp && !isNegative && firstDigitToConsider > 0) shouldRoundUpToOne = true; return shouldRoundUpToOne ? "1" : "0" } if (decisionIndex > coeffStr.length) return coeffStr + '0'.repeat(decisionIndex - coeffStr.length); if (decisionIndex === coeffStr.length) return coeffStr; let partToKeep = coeffStr.substring(0, decisionIndex); const roundingDigit = parseInt(coeffStr[decisionIndex], 10); let exactHalf = true; for (let i = decisionIndex + 1; i < coeffStr.length; i++) if (coeffStr[i] !== '0') { exactHalf = false; break } let increment = false; if (rm === Ctor.roundDown) { } else if (rm === Ctor.roundHalfUp) { if (roundingDigit >= 5) increment = true } else if (rm === Ctor.roundHalfEven) { if (roundingDigit > 5) increment = true; else if (roundingDigit === 5) { if (!exactHalf) increment = true; else { const prevDigit = partToKeep.length > 0 ? parseInt(partToKeep[partToKeep.length - 1], 10) : 0; if (prevDigit % 2 !== 0) increment = true } } } else if (rm === Ctor.roundUp) { if (isNegative) { } else if (roundingDigit > 0 || !exactHalf) increment = true } if (increment) { if (partToKeep === "") partToKeep = "0"; let i = partToKeep.length - 1; let newCoeffArr = partToKeep.split(''); while (i >= 0) { if (newCoeffArr[i] === '9') { newCoeffArr[i] = '0'; i-- } else { newCoeffArr[i] = (parseInt(newCoeffArr[i], 10) + 1).toString(); break } } if (i < 0) newCoeffArr.unshift('1'); partToKeep = newCoeffArr.join('') } return partToKeep === "" ? "0" : partToKeep }
BigIntPrimitive.prototype._webgl_multiply_one_limb_by_bigint = function (limbValue, otherBigInt) {
  console.log(`[WebGL MultLimb Debug] Entry: limbValueToMultiply=${limbValue}, otherNumber=${otherBigInt.toString()}`)
  if (limbValue === 0 || otherBigInt.isZero()) return new BigIntPrimitive("0", this.canvas, { forceCPU: true })

  let gl; let program, texOtherNumber, texOutput, fbOutput, positionBuffer, texCoordBuffer
  try {
    gl = webglUtilsModule.initWebGL(this.canvas)
    if (!gl) throw new Error("WEBGL_CAPABILITY_ERROR: WebGL not supported or float textures not available for multiply limb.")

    // Clear any existing errors
    while (gl.getError() !== gl.NO_ERROR) { }

    const otherLimbs = [...otherBigInt.limbs].reverse()
    const texWidth = otherLimbs.length + 3
    const otherLimbsF32 = new Float32Array(texWidth)
    for (let i = 0; i < otherLimbs.length; i++) otherLimbsF32[i] = otherLimbs[i]

    const vs = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, multiplyLimbVertexShaderSrc)
    const fs = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, multiplyLimbFragmentShaderSrc)
    program = webglUtilsModule.createProgram(gl, vs, fs)
    if (!program) throw new Error('WebGL program creation failed for multiply limb.')

    gl.useProgram(program)
    texOtherNumber = webglUtilsModule.createDataTexture(gl, otherLimbsF32, texWidth, 1, false)
    texOutput = webglUtilsModule.createDataTexture(gl, null, texWidth, 1, true)
    console.log(`[WebGL MultLimb Debug Step 2] Textures created.`)

    fbOutput = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0)

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`WEBGL_FRAMEBUFFER_ERROR: Framebuffer incomplete for multiply limb. Status: ${webglUtilsModule.getFramebufferStatusString(gl, gl.checkFramebufferStatus(gl.FRAMEBUFFER))}`)
    }

    gl.viewport(0, 0, texWidth, 1)
    const uOtherNumberTexLoc = gl.getUniformLocation(program, "u_otherNumTexture")
    const uLimbValueLoc = gl.getUniformLocation(program, "u_limbValue")
    const uBaseLoc = gl.getUniformLocation(program, "u_base")
    const uTexWidthLoc = gl.getUniformLocation(program, "u_texWidth")

    console.log(`[WebGL MultLimb Debug Step 3] Locations: uOtherNumberTexLoc=${uOtherNumberTexLoc}, uLimbValueLoc=${uLimbValueLoc}, uBaseLoc=${uBaseLoc}`)

    if (!uOtherNumberTexLoc || !uLimbValueLoc || !uBaseLoc) throw new Error("Failed to get essential uniform locations for multiply limb shader.")

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texOtherNumber)
    gl.uniform1i(uOtherNumberTexLoc, 0)
    gl.uniform1f(uLimbValueLoc, limbValue)
    gl.uniform1f(uBaseLoc, BASE)
    if (uTexWidthLoc) gl.uniform1f(uTexWidthLoc, texWidth)
    console.log(`[WebGL MultLimb Debug Step 4] Uniforms set.`)

    positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    const posAttrLoc = gl.getAttribLocation(program, "a_position")
    gl.enableVertexAttribArray(posAttrLoc)
    gl.vertexAttribPointer(posAttrLoc, 2, gl.FLOAT, false, 0, 0)
    console.log(`[WebGL MultLimb Debug Step 5] Attributes configured.`)

    texCoordBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW)
    const texCoordAttrLoc = gl.getAttribLocation(program, "a_texCoord")
    gl.enableVertexAttribArray(texCoordAttrLoc)
    gl.vertexAttribPointer(texCoordAttrLoc, 2, gl.FLOAT, false, 0, 0)

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbOutput)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    console.log(`[WebGL MultLimb Debug Step 6] Shader executed.`)

    const outputDataRGBA = webglUtilsModule.readDataFromTexture(gl, fbOutput, texWidth, 1, false)
    console.log(`[WebGL MultLimb Debug Step 7] Raw output from GPU`)
    const gpuLimbProducts = new Float32Array(texWidth)
    const gpuShaderCarries = new Float32Array(texWidth)

    for (let i = 0; i < texWidth; i++) {
      gpuLimbProducts[i] = outputDataRGBA[i * 4 + 0]
      gpuShaderCarries[i] = outputDataRGBA[i * 4 + 1]
    }

    const actualLimbsArrReversed = []
    let currentPropagatedCarry = 0

    for (let i = 0; i < texWidth; i++) {
      let limbProductVal = isNaN(gpuLimbProducts[i]) ? 0 : gpuLimbProducts[i]
      let shaderCarryVal = isNaN(gpuShaderCarries[i]) ? 0 : gpuShaderCarries[i]
      let sumForThisLimb = limbProductVal + currentPropagatedCarry
      actualLimbsArrReversed.push(sumForThisLimb % BASE)
      currentPropagatedCarry = Math.floor(sumForThisLimb / BASE) + shaderCarryVal
    }

    while (currentPropagatedCarry > 0) {
      actualLimbsArrReversed.push(currentPropagatedCarry % BASE)
      currentPropagatedCarry = Math.floor(currentPropagatedCarry / BASE)
    }

    let finalCoeffStr = ""
    if (actualLimbsArrReversed.length === 0) {
      finalCoeffStr = "0"
    } else {
      let tempFinalLimbs = [...actualLimbsArrReversed].reverse()
      while (tempFinalLimbs.length > 1 && tempFinalLimbs[0] === 0) tempFinalLimbs.shift()
      finalCoeffStr = String(tempFinalLimbs[0])
      for (let i = 1; i < tempFinalLimbs.length; i++) {
        finalCoeffStr += String(tempFinalLimbs[i]).padStart(BASE_LOG10, '0')
      }
    }

    const result = BigIntPrimitive.fromCoefficientString(finalCoeffStr, this.canvas, { forceCPU: true })
    result.sign = 1
    result.exponent = 0
    if (result.isZero()) result.exponent = 0
    console.log(`[WebGL MultLimb Debug Step 12] WebGL Result: ${finalCoeffStr}`)
    return result

  } catch (e) {
    console.warn(`[BigInt._webgl_multiply_one_limb_by_bigint] WebGL error: ${e.message}. Falling back to CPU.`)
    return this._multiply_limb_by_bigint(limbValue, otherBigInt)
  } finally {
    if (gl) {
      if (program) gl.deleteProgram(program)
      if (texOtherNumber) gl.deleteTexture(texOtherNumber)
      if (texOutput) gl.deleteTexture(texOutput)
      if (fbOutput) gl.deleteFramebuffer(fbOutput)
      if (positionBuffer) gl.deleteBuffer(positionBuffer)
      if (texCoordBuffer) gl.deleteBuffer(texCoordBuffer)
    }
  }
}


export { BigIntPrimitive }
