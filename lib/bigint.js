import * as webglUtilsModule from './webgl-utils.js';
import vertexShaderSrc from './shaders/addition.vert?raw';
import fragmentShaderSrc from './shaders/addition.frag?raw';
import subtractVertexShaderSrc from './shaders/subtraction.vert?raw';
import subtractFragmentShaderSrc from './shaders/subtraction.frag?raw';
import multiplyLimbVertexShaderSrc from './shaders/multiply_limb.vert?raw';
import multiplyLimbFragmentShaderSrc from './shaders/multiply_limb.frag?raw';

const BASE = 10000;
const BASE_LOG10 = 4; // log10(BASE)
const KARATSUBA_THRESHOLD = 20;

class BigIntPrimitive {
  constructor(value, canvas, options = {}) {
    console.log("BigInt CONSTRUCTOR: Received value:", value, "canvas provided:", !!canvas, "options:", options);
    this.limbs = [];
    this.sign = 1;
    this.canvas = canvas;
    this.forceCPU = !!(options && options.forceCPU);

    if (value instanceof BigIntPrimitive) {
      this.limbs = [...value.limbs];
      this.sign = value.sign;
      // this.forceCPU is set from options for the new instance
    } else {
      let stringValue = '';
      if (typeof value === 'number') {
        if (!Number.isInteger(value)) {
          throw new TypeError("Numeric input must be an integer.");
        }
        stringValue = String(value);
      } else if (typeof value === 'string') {
        stringValue = value.trim();
      } else {
        throw new TypeError("Invalid input type for BigIntPrimitive. Expected string, number, or BigIntPrimitive instance.");
      }

      if (stringValue.startsWith('-')) {
        this.sign = -1;
        stringValue = stringValue.substring(1);
      } else {
        this.sign = 1;
      }
      console.log("BigInt CONSTRUCTOR: stringValue:", "'" + stringValue + "'", "sign:", this.sign);

      if (!/^\d+$/.test(stringValue) && stringValue !== "") {
          throw new TypeError("Invalid BigInt string format: contains non-digits or is just a sign.");
      }

      if (stringValue === "" || stringValue === "0") {
        this.limbs = [0];
      } else {
        stringValue = stringValue.replace(/^0+/, '');
        if (stringValue === "") {
            this.limbs = [0];
        } else {
          let tempLimbs = [];
          for (let i = stringValue.length; i > 0; i -= BASE_LOG10) {
            const start = Math.max(0, i - BASE_LOG10);
            tempLimbs.push(Number(stringValue.substring(start, i)));
          }
          console.log("BigInt CONSTRUCTOR: Raw limbs before normalization:", JSON.parse(JSON.stringify(tempLimbs)));
          this.limbs = this._normalize_limbs(tempLimbs);
        }
      }
    }

    if (this._is_limbs_zero(this.limbs)) {
        this.sign = 1;
    }
    console.log("BigInt CONSTRUCTOR: Normalized limbs:", JSON.parse(JSON.stringify(this.limbs)));
    console.log("BigInt CONSTRUCTOR: Instance this.canvas exists:", !!this.canvas, "Instance forceCPU:", this.forceCPU);
    console.log('[BigIntPrimitive Constructor] forceCPU initialized to:', this.forceCPU); // Added as per subtask step 2
  }

  _normalize_limbs(limbs) {
    let l = [...limbs];
    while (l.length > 1 && l[l.length - 1] === 0) {
      l.pop();
    }
    if (l.length === 0) {
      return [0];
    }
    return l;
  }

  _is_limbs_zero(limbs) {
    return limbs.length === 0 || (limbs.length === 1 && limbs[0] === 0);
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
    return this._compare_limbs_magnitude(this.limbs, otherBigInt.limbs);
  }

  toString() {
    if (this.isZero()) {
      return "0";
    }
    let s = String(this.limbs[this.limbs.length-1]);
    for (let i = this.limbs.length - 2; i >= 0; i--) {
      s += String(this.limbs[i]).padStart(BASE_LOG10, '0');
    }
    return (this.sign === -1 ? "-" : "") + s;
  }

  isZero() {
    return this._is_limbs_zero(this.limbs);
  }

  _core_add(positiveOtherBigInt) {
    console.log('[BigIntPrimitive _core_add] Method entry. this.forceCPU:', this.forceCPU);
    console.log("_core_add: THIS.limbs", JSON.parse(JSON.stringify(this.limbs)), "OTHER.limbs", JSON.parse(JSON.stringify(positiveOtherBigInt.limbs)), "forceCPU:", this.forceCPU, "CANVAS:", !!this.canvas);
    if (!(positiveOtherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive for _core_add.");
    }

    try {
      console.log("_core_add: Attempting WebGL path.");
      if (this.forceCPU) {
        console.log("_core_add: Forcing CPU due to this.forceCPU=true.");
        throw new Error("Forcing CPU path for _core_add via option");
      }
      if (!this.canvas) { throw new Error("Canvas not available for WebGL addition."); }
      const webglUtils = webglUtilsModule; const vsSource = vertexShaderSrc; const fsSource = fragmentShaderSrc;
      if (!webglUtils || !vsSource || !fsSource) { throw new Error("WebGL resources not available for addition."); }
      const gl = webglUtils.initWebGL(this.canvas);
      if (!gl) { throw new Error("Failed to initialize WebGL for addition."); }
      gl._programCache = gl._programCache || {}; const opKey = 'add'; let program = gl._programCache[opKey];
      if (!program) {
        let vertexShader = webglUtils.createShader(gl, gl.VERTEX_SHADER, vsSource);
        let fragmentShader = webglUtils.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        program = webglUtils.createProgram(gl, vertexShader, fragmentShader);
        if (program) { gl._programCache[opKey] = program; if (vertexShader) gl.deleteShader(vertexShader); if (fragmentShader) gl.deleteShader(fragmentShader); }
        else { if (vertexShader) gl.deleteShader(vertexShader); if (fragmentShader) gl.deleteShader(fragmentShader); throw new Error("Failed to create shader program for addition.");}
      }
      const maxLength = Math.max(this.limbs.length, positiveOtherBigInt.limbs.length);
      const texWidth = maxLength; const texHeight = 1;
      const num1LimbsData = new Float32Array(maxLength); const num2LimbsData = new Float32Array(maxLength); const carryInLimbsData = new Float32Array(maxLength);
      for (let i = 0; i < maxLength; i++) { num1LimbsData[i] = this.limbs[i] || 0; num2LimbsData[i] = positiveOtherBigInt.limbs[i] || 0; carryInLimbsData[i] = 0; }
      const texNum1 = webglUtils.createDataTexture(gl, num1LimbsData, texWidth, texHeight, false);
      const texNum2 = webglUtils.createDataTexture(gl, num2LimbsData, texWidth, texHeight, false);
      const texCarryIn = webglUtils.createDataTexture(gl, carryInLimbsData, texWidth, texHeight, false);
      const texOutput = webglUtils.createDataTexture(gl, new Float32Array(texWidth * texHeight * 4), texWidth, texHeight, true);
      if (!texNum1 || !texNum2 || !texCarryIn || !texOutput) { if (texNum1) gl.deleteTexture(texNum1); if (texNum2) gl.deleteTexture(texNum2); if (texCarryIn) gl.deleteTexture(texCarryIn); if (texOutput) gl.deleteTexture(texOutput); throw new Error("Failed to create data textures for addition."); }
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput); gl.deleteFramebuffer(fbo); throw new Error("Framebuffer incomplete."); }
      const vertexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      gl.viewport(0, 0, texWidth, texHeight); gl.useProgram(program);
      const aPosLoc = gl.getAttribLocation(program, "a_position"); gl.enableVertexAttribArray(aPosLoc);
      gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texNum1); gl.uniform1i(gl.getUniformLocation(program, "u_num1Texture"), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNum2); gl.uniform1i(gl.getUniformLocation(program, "u_num2Texture"), 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texCarryIn); gl.uniform1i(gl.getUniformLocation(program, "u_carryTexture"), 2);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const outputPixelDataRGBA = webglUtils.readDataFromTexture(gl, fbo, texWidth, texHeight, false);
      if (!outputPixelDataRGBA) { gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput); gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer); throw new Error("Failed to read pixel data."); }
      const resultLimbsFromGPU = new Float32Array(maxLength); const carryOutFromGPU = new Float32Array(maxLength);
      for (let i = 0; i < maxLength; i++) { resultLimbsFromGPU[i] = outputPixelDataRGBA[i * 4 + 0]; carryOutFromGPU[i] = outputPixelDataRGBA[i * 4 + 1];}
      let finalResultLimbs = []; let propagatedCarry = 0;
      for (let i = 0; i < maxLength; i++) {
        let sumWithPropagatedCarry = resultLimbsFromGPU[i] + propagatedCarry;
        finalResultLimbs.push(sumWithPropagatedCarry % BASE);
        propagatedCarry = carryOutFromGPU[i] + Math.floor(sumWithPropagatedCarry / BASE);
      }
      while (propagatedCarry > 0) { finalResultLimbs.push(propagatedCarry % BASE); propagatedCarry = Math.floor(propagatedCarry / BASE); }
      finalResultLimbs = this._normalize_limbs(finalResultLimbs);
      gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
      gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer);
      const resultNum = new this.constructor("0", this.canvas, { forceCPU: this.forceCPU });
      resultNum.limbs = finalResultLimbs; resultNum.sign = 1; if (resultNum.isZero()) resultNum.sign = 1;
      return resultNum;

    } catch (error) {
      console.log("[BigIntPrimitive _core_add] CPU Path Taken. Inputs: this.limbs", JSON.parse(JSON.stringify(this.limbs)), 'other.limbs', JSON.parse(JSON.stringify(positiveOtherBigInt.limbs)));
      console.log("_core_add: Using CPU path due to error in WebGL attempt or forceCPU. Error (if any):", error && error.message ? error.message : String(error));

      const num1Limbs = this.limbs;
      const num2Limbs = positiveOtherBigInt.limbs;

      let isDebugCase = false;
      if (num1Limbs && num1Limbs.length === 2 && num1Limbs[0] === 0 && num1Limbs[1] === 2 &&
          num2Limbs && num2Limbs.length === 1 && num2Limbs[0] === 5333) {
        isDebugCase = true;
        console.log('[DEBUG _core_add CPU] ENTERING SUSPECT CASE: 20000 + 5333');
        console.log('[DEBUG _core_add CPU] this.limbs (num1Limbs):', JSON.stringify(num1Limbs));
        console.log('[DEBUG _core_add CPU] positiveOtherBigInt.limbs (num2Limbs):', JSON.stringify(num2Limbs));
      }

      let resultLimbs = [];
      let carry = 0;
      const maxLength = Math.max(num1Limbs.length, num2Limbs.length);
      if (isDebugCase) console.log('[DEBUG _core_add CPU] maxLength:', maxLength, 'BASE:', BASE);

      for (let i = 0; i < maxLength; i++) {
        const limb1 = num1Limbs[i] || 0;
        const limb2 = num2Limbs[i] || 0;
        if (isDebugCase) console.log(`[DEBUG _core_add CPU] i=${i}, initial limb1=${num1Limbs[i]}, initial limb2=${num2Limbs[i]}`); // Log initial values from arrays
        if (isDebugCase) console.log(`[DEBUG _core_add CPU] i=${i}, used limb1=${limb1}, used limb2=${limb2}, carry_in=${carry}`);

        const sum = limb1 + limb2 + carry;
        const currentPushVal = sum % BASE;
        const currentCarryOut = Math.floor(sum / BASE);

        if (isDebugCase) console.log(`[DEBUG _core_add CPU] i=${i}, sum=${sum}, pushVal=${currentPushVal}, carry_out=${currentCarryOut}`);

        resultLimbs.push(currentPushVal);
        carry = currentCarryOut;
        if (isDebugCase) console.log(`[DEBUG _core_add CPU] Loop i=${i}: resultLimbs_so_far=${JSON.stringify(resultLimbs)}`);
      }

      if (isDebugCase) console.log('[DEBUG _core_add CPU] After loop, carry:', carry, 'resultLimbs:', JSON.stringify(resultLimbs));

      while (carry > 0) {
        const currentPushVal = carry % BASE; // Use a different variable name
        const nextCarry = Math.floor(carry / BASE); // Use a different variable name
        if (isDebugCase) console.log(`[DEBUG _core_add CPU] while_carry, pushVal=${currentPushVal}, new_carry=${nextCarry}`);
        resultLimbs.push(currentPushVal);
        carry = nextCarry; // Update original carry variable
        if (isDebugCase) console.log(`[DEBUG _core_add CPU] Final carry loop: resultLimbs_so_far=${JSON.stringify(resultLimbs)}`);
      }

      if (isDebugCase) console.log('[DEBUG _core_add CPU] Final resultLimbs before norm:', JSON.stringify(resultLimbs));
      resultLimbs = this._normalize_limbs(resultLimbs);
      if (isDebugCase) console.log('[DEBUG _core_add CPU] Final resultLimbs after norm:', JSON.stringify(resultLimbs));

      const resultNumCPU = new this.constructor("0", this.canvas, { forceCPU: this.forceCPU });
      resultNumCPU.limbs = resultLimbs;
      resultNumCPU.sign = 1;
      if (resultNumCPU.isZero()) {
          resultNumCPU.sign = 1;
      }
      return resultNumCPU;
    }
  }

  add(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    if (this.sign === otherBigInt.sign) {
      const absThis = this.abs();
      const absOther = otherBigInt.abs();
      const sumMagnitude = absThis._core_add(absOther);
      sumMagnitude.sign = this.sign;
      if (sumMagnitude.isZero()) {
          sumMagnitude.sign = 1;
      }
      return sumMagnitude;
    } else {
      return this.subtract(otherBigInt.negate());
    }
  }

  _core_subtract(positiveOtherBigInt) {
    console.log('[BigIntPrimitive _core_subtract] Method entry. this.forceCPU:', this.forceCPU);
    console.log("_core_subtract: THIS.limbs", JSON.parse(JSON.stringify(this.limbs)), "OTHER.limbs", JSON.parse(JSON.stringify(positiveOtherBigInt.limbs)), "forceCPU:", this.forceCPU, "CANVAS:", !!this.canvas);
    if (!(positiveOtherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive for _core_subtract.");
    }
    try {
      console.log("_core_subtract: Attempting WebGL path.");
      if (this.forceCPU) {
        console.log("_core_subtract: Forcing CPU due to this.forceCPU=true.");
        throw new Error("Forcing CPU path for _core_subtract via option");
      }
      if (!this.canvas) { throw new Error("Canvas not available for WebGL subtraction."); }
      const gl = webglUtilsModule.initWebGL(this.canvas);
      if (!gl) { throw new Error("Failed to initialize WebGL for subtraction."); }
      gl._programCache = gl._programCache || {}; const opKey = 'subtract'; let program = gl._programCache[opKey];
      if (!program) {
        let vertexShader = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, subtractVertexShaderSrc);
        let fragmentShader = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, subtractFragmentShaderSrc);
        program = webglUtilsModule.createProgram(gl, vertexShader, fragmentShader);
        if (program) { gl._programCache[opKey] = program; if (vertexShader) gl.deleteShader(vertexShader); if (fragmentShader) gl.deleteShader(fragmentShader); }
        else { if (vertexShader) gl.deleteShader(vertexShader); if (fragmentShader) gl.deleteShader(fragmentShader); throw new Error("Failed to create shader program for subtraction."); }
      }
      const maxLength = Math.max(this.limbs.length, positiveOtherBigInt.limbs.length);
      const texWidth = maxLength; const texHeight = 1;
      const num1LimbsData = new Float32Array(maxLength); const num2LimbsData = new Float32Array(maxLength); const borrowInLimbsData = new Float32Array(maxLength);
      for (let i = 0; i < maxLength; i++) { num1LimbsData[i] = this.limbs[i] || 0; num2LimbsData[i] = positiveOtherBigInt.limbs[i] || 0; borrowInLimbsData[i] = 0; }
      const texNum1 = webglUtilsModule.createDataTexture(gl, num1LimbsData, texWidth, texHeight, false);
      const texNum2 = webglUtilsModule.createDataTexture(gl, num2LimbsData, texWidth, texHeight, false);
      const texBorrowIn = webglUtilsModule.createDataTexture(gl, borrowInLimbsData, texWidth, texHeight, false);
      const texOutput = webglUtilsModule.createDataTexture(gl, new Float32Array(texWidth * texHeight * 4), texWidth, texHeight, true);
      if (!texNum1 || !texNum2 || !texBorrowIn || !texOutput) { /* ... cleanup ... */ throw new Error("Failed to create data textures for subtraction."); }
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { /* ... cleanup ... */ throw new Error("Framebuffer incomplete for subtraction."); }
      const vertexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      gl.viewport(0, 0, texWidth, texHeight); gl.useProgram(program);
      const aPosLoc = gl.getAttribLocation(program, "a_position"); gl.enableVertexAttribArray(aPosLoc);
      gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texNum1); gl.uniform1i(gl.getUniformLocation(program, "u_num1Texture"), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNum2); gl.uniform1i(gl.getUniformLocation(program, "u_num2Texture"), 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texBorrowIn); gl.uniform1i(gl.getUniformLocation(program, "u_borrowTexture"), 2);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.drawArrays(gl.TRIANGLES, 0, 6);
      const outputPixelDataRGBA = webglUtilsModule.readDataFromTexture(gl, fbo, texWidth, texHeight, false);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!outputPixelDataRGBA) { /* ... cleanup ... */ throw new Error("Failed to read pixel data for subtraction."); }
      const resultLimbsFromGPU = new Float32Array(maxLength); const borrowOutFromGPU = new Float32Array(maxLength);
      for (let i = 0; i < maxLength; i++) { resultLimbsFromGPU[i] = outputPixelDataRGBA[i * 4 + 0]; borrowOutFromGPU[i] = outputPixelDataRGBA[i * 4 + 1];}
      let finalResultLimbs = []; let propagatedBorrow = 0;
      for (let i = 0; i < maxLength; i++) {
          let diffLimbShaderOutput = resultLimbsFromGPU[i];
          let jsBorrowForThisLimb = propagatedBorrow;
          let currentLimbFinal = diffLimbShaderOutput - jsBorrowForThisLimb;
          propagatedBorrow = borrowOutFromGPU[i];
          if (currentLimbFinal < 0) { currentLimbFinal += BASE; propagatedBorrow += 1; }
          finalResultLimbs.push(currentLimbFinal);
      }
      if (propagatedBorrow > 0) { console.error("_core_subtract WebGL path: final propagatedBorrow > 0."); }
      finalResultLimbs = this._normalize_limbs(finalResultLimbs);
      gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texBorrowIn); gl.deleteTexture(texOutput);
      gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer);
      const resultNum = new this.constructor("0", this.canvas, { forceCPU: this.forceCPU });
      resultNum.limbs = finalResultLimbs; resultNum.sign = 1; if (resultNum.isZero()) { resultNum.sign = 1; }
      return resultNum;

    } catch (error) {
      console.log("[BigIntPrimitive _core_subtract] CPU Path Taken. Inputs: this.limbs", JSON.parse(JSON.stringify(this.limbs)), 'other.limbs', JSON.parse(JSON.stringify(positiveOtherBigInt.limbs)));
      console.log("_core_subtract: Using CPU path due to error in WebGL attempt or forceCPU. Error (if any):", error && error.message ? error.message : String(error));
      let resultLimbs = [];
      let borrow = 0;
      const minuendLimbs = this.limbs;
      const subtrahendLimbs = positiveOtherBigInt.limbs;
      const maxLength = minuendLimbs.length;

      for (let i = 0; i < maxLength; i++) {
        const limb1 = minuendLimbs[i] || 0;
        const limb2 = subtrahendLimbs[i] || 0;
        let diff = limb1 - limb2 - borrow;
        if (diff < 0) {
          diff += BASE;
          borrow = 1;
        } else {
          borrow = 0;
        }
        resultLimbs.push(diff);
      }

      if (borrow > 0) {
        console.error("_core_subtract CPU: final borrow was > 0. Minuend likely < subtrahend.");
      }

      resultLimbs = this._normalize_limbs(resultLimbs);

      const resultNumCPU = new this.constructor("0", this.canvas, { forceCPU: this.forceCPU });
      resultNumCPU.limbs = resultLimbs;
      resultNumCPU.sign = 1;
      if (resultNumCPU.isZero()) {
          resultNumCPU.sign = 1;
      }
      return resultNumCPU;
    }
  }

  subtract(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    if (this.sign !== otherBigInt.sign) {
      const absThis = this.abs();
      const absOther = otherBigInt.abs();
      const sumMagnitude = absThis._core_add(absOther);
      sumMagnitude.sign = this.sign;
      if (sumMagnitude.isZero()) {
          sumMagnitude.sign = 1;
      }
      return sumMagnitude;
    } else {
      const comp = this.compareMagnitude(otherBigInt);
      if (comp === 0) {
        return new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
      }
      let resultMagnitude;
      if (comp > 0) {
        resultMagnitude = this.abs()._core_subtract(otherBigInt.abs());
        resultMagnitude.sign = this.sign;
      } else {
        resultMagnitude = otherBigInt.abs()._core_subtract(this.abs());
        resultMagnitude.sign = this.sign * -1;
      }
      if (resultMagnitude.isZero()) {
          resultMagnitude.sign = 1;
      }
      return resultMagnitude;
    }
  }

  _multiply_limb_by_bigint(limbValue, otherNumber) {
       if (!this.canvas) {
           throw new Error("Canvas not available for WebGL operation.");
       }
       if (limbValue === 0 || otherNumber.isZero()) {
           return new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
       }

       const gl = webglUtilsModule.initWebGL(this.canvas);
       if (!gl) {
           throw new Error("Failed to initialize WebGL for _multiply_limb_by_bigint.");
       }
       gl._programCache = gl._programCache || {};
       const opKey = 'multiply_limb';
       let program = gl._programCache[opKey];
       let vertexShader, fragmentShader;

       if (!program) {
         vertexShader = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, multiplyLimbVertexShaderSrc);
         fragmentShader = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, multiplyLimbFragmentShaderSrc);
         program = webglUtilsModule.createProgram(gl, vertexShader, fragmentShader);

         if (program) {
           gl._programCache[opKey] = program;
           if (vertexShader) gl.deleteShader(vertexShader);
           if (fragmentShader) gl.deleteShader(fragmentShader);
         } else {
           if (vertexShader) gl.deleteShader(vertexShader);
           if (fragmentShader) gl.deleteShader(fragmentShader);
           throw new Error("Failed to create shader program for _multiply_limb_by_bigint.");
         }
       }

       const maxLength = otherNumber.limbs.length;
       const texWidth = maxLength;
       const texHeight = 1;

       const otherNumLimbsData = new Float32Array(maxLength);
       const carryInLimbsData = new Float32Array(maxLength);

       for (let i = 0; i < maxLength; i++) {
           otherNumLimbsData[i] = otherNumber.limbs[i] || 0;
           carryInLimbsData[i] = 0;
       }

       const texOtherNum = webglUtilsModule.createDataTexture(gl, otherNumLimbsData, texWidth, texHeight, false);
       const texCarryIn = webglUtilsModule.createDataTexture(gl, carryInLimbsData, texWidth, texHeight, false);
       const texOutput = webglUtilsModule.createDataTexture(gl, new Float32Array(texWidth * texHeight * 4), texWidth, texHeight, true);

       if (!texOtherNum || !texCarryIn || !texOutput) {
           if (texOtherNum) gl.deleteTexture(texOtherNum);
           if (texCarryIn) gl.deleteTexture(texCarryIn);
           if (texOutput) gl.deleteTexture(texOutput);
           throw new Error("Failed to create data textures for _multiply_limb_by_bigint.");
       }

       const fbo = gl.createFramebuffer();
       gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
       gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);

       if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
           gl.deleteTexture(texOtherNum); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
           gl.deleteFramebuffer(fbo);
           throw new Error("Framebuffer incomplete for _multiply_limb_by_bigint.");
       }

       const quadVertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
       const vertexBuffer = gl.createBuffer();
       gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
       gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

       gl.viewport(0, 0, texWidth, texHeight);
       gl.useProgram(program);

       const aPositionLocation = gl.getAttribLocation(program, "a_position");
       gl.enableVertexAttribArray(aPositionLocation);
       gl.vertexAttribPointer(aPositionLocation, 2, gl.FLOAT, false, 0, 0);

       gl.uniform1f(gl.getUniformLocation(program, "u_limbVal"), limbValue);
       gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texOtherNum);
       gl.uniform1i(gl.getUniformLocation(program, "u_otherNumTexture"), 0);
       gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texCarryIn);
       gl.uniform1i(gl.getUniformLocation(program, "u_carryTexture"), 1);

       gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
       gl.drawArrays(gl.TRIANGLES, 0, 6);
       const outputPixelDataRGBA = webglUtilsModule.readDataFromTexture(gl, fbo, texWidth, texHeight, false);
       gl.bindFramebuffer(gl.FRAMEBUFFER, null);

       if (!outputPixelDataRGBA) {
           gl.deleteTexture(texOtherNum); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
           gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer);
           throw new Error("Failed to read pixel data for _multiply_limb_by_bigint.");
       }

       const resultLimbsFromGPU = new Float32Array(maxLength);
       const carryOutFromGPU = new Float32Array(maxLength);
       for (let i = 0; i < maxLength; i++) {
           resultLimbsFromGPU[i] = outputPixelDataRGBA[i * 4 + 0];
           carryOutFromGPU[i] = outputPixelDataRGBA[i * 4 + 1];
       }

       const finalResultLimbs = [];
       let propagatedCarry = 0;
       for (let i = 0; i < maxLength; i++) {
           let currentProductSum = resultLimbsFromGPU[i] + propagatedCarry;
           finalResultLimbs.push(currentProductSum % BASE);
           propagatedCarry = carryOutFromGPU[i] + Math.floor(currentProductSum / BASE);
       }

       if (propagatedCarry > 0) {
           let currentCarry = propagatedCarry;
           while(currentCarry > 0) {
               finalResultLimbs.push(currentCarry % BASE);
               currentCarry = Math.floor(currentCarry / BASE);
           }
       }

       gl.deleteTexture(texOtherNum); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
       gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer);

       const resultNum = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
       resultNum.limbs = finalResultLimbs.length > 0 ? finalResultLimbs : [0];
       resultNum.sign = 1;
       if (resultNum.isZero()) resultNum.sign = 1;
       return resultNum;
   }

   _core_multiply(num1, num2) {
    if (num1.isZero() || num2.isZero()) {
        return new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
    }
    let totalResult = new BigIntPrimitive("0", this.canvas, { forceCPU: this.forceCPU });
    for (let i = 0; i < num1.limbs.length; i++) {
        const limbOfNum1 = num1.limbs[i];
        if (limbOfNum1 === 0) {
            continue;
        }
        let partialProduct = this._multiply_limb_by_bigint(limbOfNum1, num2);
        if (partialProduct.isZero()) {
            continue;
        }
        if (i > 0) {
            const shiftedLimbs = new Array(i).fill(0).concat(partialProduct.limbs);
            partialProduct.limbs = shiftedLimbs;
        }
        totalResult = totalResult.add(partialProduct);
        if (!totalResult) {
            throw new Error("Error during accumulation in _core_multiply.");
        }
    }
    totalResult.sign = 1;
    return totalResult;
  }

  multiply(otherBigInt) {
    const self = this;
    if (!(otherBigInt instanceof BigIntPrimitive)) {
        throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    if (self.isZero() || otherBigInt.isZero()) {
        return new BigIntPrimitive("0", self.canvas, { forceCPU: this.forceCPU });
    }
    const resultSign = (self.sign === otherBigInt.sign) ? 1 : -1;
    const absThis = self.abs();
    const absOther = otherBigInt.abs();
    let finalAbsResult;
    const absThisLen = absThis.isZero() ? 0 : absThis.limbs.length;
    const absOtherLen = absOther.isZero() ? 0 : absOther.limbs.length;

    if (absThisLen < KARATSUBA_THRESHOLD || absOtherLen < KARATSUBA_THRESHOLD) {
        finalAbsResult = self._core_multiply(absThis, absOther);
    } else {
        const n = Math.max(absThisLen, absOtherLen);
        const m = Math.floor(n / 2);
        if (m === 0) {
            finalAbsResult = self._core_multiply(absThis, absOther);
        } else {
            const { low: b, high: a } = absThis._splitAt(m);
            const { low: d, high: c } = absOther._splitAt(m);
            const p0 = a.multiply(c);
            const p1 = b.multiply(d);
            const sum_ab = a.add(b);
            const sum_cd = c.add(d);
            if (!sum_ab || !sum_cd) throw new Error("Karatsuba: Error in intermediate additions for p2_temp components.");
            const p2_temp = sum_ab.multiply(sum_cd);
            if (!p0 || !p1 || !p2_temp) throw new Error("Karatsuba: Error in recursive multiply calls.");
            const p0_plus_p1 = p0.add(p1);
            if(!p0_plus_p1) throw new Error("Karatsuba: Error in p0+p1 for p2 calculation.");
            const p2 = p2_temp.subtract(p0_plus_p1);
            if (!p2) throw new Error("Karatsuba: Error in p2_temp - (p0+p1) for p2 calculation.");
            const p0_shifted = new BigIntPrimitive("0", self.canvas, { forceCPU: this.forceCPU });
            if (!p0.isZero()) {
                p0_shifted.limbs = new Array(2 * m).fill(0).concat(p0.limbs);
                p0_shifted.sign = p0.sign;
            }
            if (p0_shifted.isZero()) p0_shifted.sign = 1;
            const p2_shifted = new BigIntPrimitive("0", self.canvas, { forceCPU: this.forceCPU });
            if (!p2.isZero()) {
                p2_shifted.limbs = new Array(m).fill(0).concat(p2.limbs);
                p2_shifted.sign = p2.sign;
            }
            if (p2_shifted.isZero()) p2_shifted.sign = 1;
            let tempSum = p0_shifted.add(p2_shifted);
            if (!tempSum) throw new Error("Karatsuba: Error in adding p0_shifted and p2_shifted");
            finalAbsResult = tempSum.add(p1);
            if (!finalAbsResult) throw new Error("Karatsuba: Error in adding sum and p1");
        }
    }
    if (finalAbsResult.isZero()) {
        finalAbsResult.sign = 1;
    } else {
        finalAbsResult.sign = resultSign;
    }
    if (finalAbsResult.canvas !== self.canvas) {
       finalAbsResult.canvas = self.canvas;
    }
     finalAbsResult.forceCPU = self.forceCPU;
    return finalAbsResult;
  }

  _shiftLeft(numLimbsToShift) {
    if (numLimbsToShift < 0) {
        throw new Error("numLimbsToShift must be non-negative.");
    }
    if (this.isZero() || numLimbsToShift === 0) {
        return new BigIntPrimitive(this, this.canvas, { forceCPU: this.forceCPU });
    }
    const newLimbs = new Array(numLimbsToShift).fill(0).concat(this.limbs);
    const Ctor = this.constructor;
    const shiftedBigInt = new Ctor("0", this.canvas, { forceCPU: this.forceCPU });
    shiftedBigInt.limbs = newLimbs;
    shiftedBigInt.sign = this.sign;
    return shiftedBigInt;
  }

  _splitAt(m) {
    const Ctor = this.constructor;
    let low, high;
    const commonOptions = { forceCPU: this.forceCPU };

    if (m <= 0) {
        low = new Ctor("0", this.canvas, commonOptions);
        high = new Ctor(this, this.canvas, commonOptions);
        return { low, high };
    }
    if (m >= this.limbs.length) {
        low = new Ctor(this, this.canvas, commonOptions);
        high = new Ctor("0", this.canvas, commonOptions);
        return { low, high };
    }

    low = new Ctor("0", this.canvas, commonOptions);
    let lowSlice = this.limbs.slice(0, m);
    low.limbs = this._normalize_limbs(lowSlice);  // Use prototype method
    low.sign = this._is_limbs_zero(low.limbs) ? 1 : 1; // Use prototype method

    high = new Ctor("0", this.canvas, commonOptions);
    let highSlice = this.limbs.slice(m);
    high.limbs = this._normalize_limbs(highSlice); // Use prototype method
    high.sign = this._is_limbs_zero(high.limbs) ? 1 : 1; // Use prototype method

    return { low, high };
  }

  _multiplyByPowerOfBase(inputLimbs, power) { // Changed signature
    if (typeof power !== 'number' || !Number.isInteger(power)) {
      throw new Error("Power must be an integer.");
    }
    if (power < 0) {
      throw new Error("Power must be non-negative for _multiplyByPowerOfBase.");
    }
    // Operate on inputLimbs instead of this.limbs
    if (this._is_limbs_zero(inputLimbs)) { // Use helper for zero check
      return [0]; // Return new limb array
    }
    if (power === 0) {
      return [...inputLimbs]; // Return a copy of the input limbs
    }
    const newLimbs = new Array(power).fill(0).concat(inputLimbs);
    return newLimbs.length > 0 ? newLimbs : [0]; // Return new limb array
  }

  _compare_limbs_magnitude(limbs1, limbs2) {
    const l1 = limbs1.length;
    const l2 = limbs2.length;
    if (l1 > l2) return 1;
    if (l1 < l2) return -1;
    for (let i = l1 - 1; i >= 0; i--) {
      if (limbs1[i] > limbs2[i]) return 1;
      if (limbs1[i] < limbs2[i]) return -1;
    }
    return 0;
  }

  _cpu_add_limbs(limbs1, limbs2) {
    let resultLimbs = [];
    let carry = 0;
    const maxLength = Math.max(limbs1.length, limbs2.length);
    for (let i = 0; i < maxLength; i++) {
      const limb1 = limbs1[i] || 0;
      const limb2 = limbs2[i] || 0;
      const sum = limb1 + limb2 + carry;
      resultLimbs.push(sum % BASE);
      carry = Math.floor(sum / BASE);
    }
    while (carry > 0) {
      resultLimbs.push(carry % BASE);
      carry = Math.floor(carry / BASE);
    }
    return this._normalize_limbs(resultLimbs);
  }

  _cpu_subtract_limbs(limbs1, limbs2) {
    let resultLimbs = [];
    let borrow = 0;
    const maxLength = limbs1.length;
    for (let i = 0; i < maxLength; i++) {
      const limb1 = limbs1[i] || 0;
      const limb2 = limbs2[i] || 0;
      let diff = limb1 - limb2 - borrow;
      if (diff < 0) {
        diff += BASE;
        borrow = 1;
      } else {
        borrow = 0;
      }
      resultLimbs.push(diff);
    }
    // Note: If borrow > 0 here, it means limbs1 < limbs2, which is a precondition violation for typical _core_subtract.
    // _longDivide must ensure this doesn't happen for intermediate subtractions where result needs to be positive.
    return this._normalize_limbs(resultLimbs);
  }

  _longDivide(positiveDividend, positiveDivisor) {
    console.log("_longDivide: DIVIDEND.limbs", JSON.parse(JSON.stringify(positiveDividend.limbs)), "DIVISOR.limbs", JSON.parse(JSON.stringify(positiveDivisor.limbs)));
    const Ctor = this.constructor;
    const commonOptions = { forceCPU: this.forceCPU };

    if (this._is_limbs_zero(positiveDivisor.limbs)) { throw new Error("Division by zero"); }
    if (this._is_limbs_zero(positiveDividend.limbs)) {
        return { quotient: new Ctor("0", this.canvas, commonOptions), remainder: new Ctor("0", this.canvas, commonOptions) };
    }

    const comparison = this._compare_limbs_magnitude(positiveDividend.limbs, positiveDivisor.limbs);
    console.log("_longDivide: Initial compareMagnitude result:", comparison);

    if (comparison < 0) {
        return { quotient: new Ctor("0", this.canvas, commonOptions), remainder: new Ctor(positiveDividend, this.canvas, commonOptions) };
    }
    if (comparison === 0) {
        return { quotient: new Ctor("1", this.canvas, commonOptions), remainder: new Ctor("0", this.canvas, commonOptions) };
    }

    let quotientBuildLimbs = [];
    let currentWorkingLimbs = [0];
    const dividendLimbs = positiveDividend.limbs;
    const divisorLimbs = positiveDivisor.limbs;

    for (let i = dividendLimbs.length - 1; i >= 0; i--) {
        const currentDividendLimb = dividendLimbs[i];
        console.log("_longDivide loop i:", i, "dividendLimb:", currentDividendLimb);
        console.log("_longDivide pre-mult_add currentWorkingLimbs:", JSON.parse(JSON.stringify(currentWorkingLimbs)));

        // Corrected method name and it now returns new limb array
        currentWorkingLimbs = this._multiplyByPowerOfBase(currentWorkingLimbs, 1);
        currentWorkingLimbs = this._cpu_add_limbs(currentWorkingLimbs, [currentDividendLimb]);
        console.log("_longDivide post-mult_add currentWorkingLimbs:", JSON.parse(JSON.stringify(currentWorkingLimbs)));

        let quotientLimbVal = 0;
        currentWorkingLimbs = this._normalize_limbs(currentWorkingLimbs);

        while (!this._is_limbs_zero(currentWorkingLimbs) && this._compare_limbs_magnitude(currentWorkingLimbs, divisorLimbs) >= 0) {
            console.log("_longDivide inner while: CWD_limbs:", JSON.parse(JSON.stringify(currentWorkingLimbs)), "Divisor_limbs:", JSON.parse(JSON.stringify(divisorLimbs)), "CompareMag:", this._compare_limbs_magnitude(currentWorkingLimbs, divisorLimbs));
            currentWorkingLimbs = this._cpu_subtract_limbs(currentWorkingLimbs, divisorLimbs);
            quotientLimbVal++;
            console.log("_longDivide inner while after subtract: CWD_limbs:", JSON.parse(JSON.stringify(currentWorkingLimbs)), "QLV:", quotientLimbVal);
        }
        quotientBuildLimbs.push(quotientLimbVal);
        console.log("_longDivide quotientBuildLimbs:", JSON.parse(JSON.stringify(quotientBuildLimbs)));
    }

    quotientBuildLimbs.reverse();
    quotientBuildLimbs = this._normalize_limbs(quotientBuildLimbs);

    let finalQuotientString = this._limbs_to_string(quotientBuildLimbs);

    const finalQuotient = new Ctor(finalQuotientString, this.canvas, commonOptions);
    finalQuotient.sign = 1;

    const finalRemainder = new Ctor("0", this.canvas, commonOptions);
    finalRemainder.limbs = this._normalize_limbs(currentWorkingLimbs);
    finalRemainder.sign = this._is_limbs_zero(finalRemainder.limbs) ? 1 : 1;

    console.log("_longDivide: finalQuotientString:", finalQuotientString, "finalRemainder.limbs:", JSON.parse(JSON.stringify(finalRemainder.limbs)));
    return {
        quotient: finalQuotient,
        remainder: finalRemainder
    };
  }

  _limbs_to_string(limbs_lsb_first) {
    if (this._is_limbs_zero(limbs_lsb_first)) return "0";

    let s = String(limbs_lsb_first[limbs_lsb_first.length-1]);
    for (let i = limbs_lsb_first.length - 2; i >= 0; i--) {
      s += String(limbs_lsb_first[i]).padStart(BASE_LOG10, '0');
    }
    return s;
  }


  divideAndRemainder(divisorBigInt) {
    if (!(divisorBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Divisor must be an instance of BigIntPrimitive.");
    }
    if (divisorBigInt.isZero()) {
      throw new Error("Division by zero");
    }
    const quotientSign = (this.sign === divisorBigInt.sign) ? 1 : -1;
    const remainderSign = this.sign;
    const absDividend = this.abs();
    const absDivisor = divisorBigInt.abs();
    const { quotient: absQuotient, remainder: absRemainder } = this._longDivide(absDividend, absDivisor);
    if (absQuotient.isZero()) {
      absQuotient.sign = 1;
    } else {
      absQuotient.sign = quotientSign;
    }
    if (absRemainder.isZero()) {
      absRemainder.sign = 1;
    } else {
      absRemainder.sign = remainderSign;
    }
    return { quotient: absQuotient, remainder: absRemainder };
  }

  divide(divisorBigInt) {
    const { quotient } = this.divideAndRemainder(divisorBigInt);
    return quotient;
  }

  remainder(divisorBigInt) {
    const { remainder } = this.divideAndRemainder(divisorBigInt);
    return remainder;
  }
}

export { BigIntPrimitive };
