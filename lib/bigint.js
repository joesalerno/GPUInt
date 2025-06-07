import * as webglUtilsModule from './webgl-utils.js';
import vertexShaderSrc from './shaders/addition.vert?raw';
import fragmentShaderSrc from './shaders/addition.frag?raw';
import subtractVertexShaderSrc from './shaders/subtraction.vert?raw';
import subtractFragmentShaderSrc from './shaders/subtraction.frag?raw';
import multiplyLimbVertexShaderSrc from './shaders/multiply_limb.vert?raw';
import multiplyLimbFragmentShaderSrc from './shaders/multiply_limb.frag?raw';

// Shader sources are still expected to be globally available via
// window.vertexShaderSrc, and window.fragmentShaderSrc
// as set up by the HTML page. Access to these will remain conditional.

// Module-level constants moved to static class properties

/**
 * @class BigIntPrimitive
 * @description Represents a large integer, potentially using WebGL for operations.
 */
class BigIntPrimitive {
  static BASE = 10000;
  static BASE_LOG10 = 4; // Math.log10(BigIntPrimitive.BASE) would be more dynamic but 4 is fine for const BASE
  static KARATSUBA_THRESHOLD = 20;

  /**
   * Creates an instance of BigIntPrimitive.
   * @param {string | number | BigIntPrimitive} value The initial value. Can be a string of digits, a number, or another BigIntPrimitive.
   * @param {HTMLCanvasElement} [canvas] Optional canvas element for WebGL operations.
   * @throws {TypeError} If the input string is not a valid representation of an integer or input type is wrong.
   */
  constructor(value, canvas) {
    this.limbs = [];
    this.sign = 1;
    this.canvas = canvas;

    if (value instanceof BigIntPrimitive) {
      this.limbs = [...value.limbs]; // Ensure deep copy of limbs array
      this.sign = value.sign;
      this.canvas = canvas || value.canvas; // Prefer new canvas, fallback to original's
      return;
    }

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

    if (!/^\d+$/.test(stringValue) && stringValue !== "") {
        throw new TypeError("Invalid BigInt string format: contains non-digits or is just a sign.");
    }

    if (stringValue === "" || stringValue === "0") {
      this.limbs = [0];
      this.sign = 1;
    } else {
      stringValue = stringValue.replace(/^0+/, '');
      if (stringValue === "") {
          this.limbs = [0];
          this.sign = 1;
      } else {
        for (let i = stringValue.length; i > 0; i -= BigIntPrimitive.BASE_LOG10) {
          const start = Math.max(0, i - BigIntPrimitive.BASE_LOG10);
          this.limbs.push(Number(stringValue.substring(start, i)));
        }
        while (this.limbs.length > 1 && this.limbs[this.limbs.length - 1] === 0) {
            this.limbs.pop();
        }
        if (this.limbs.length === 0) {
            this.limbs = [0];
            this.sign = 1;
        }
      }
    }
    if (this.isZero()) { // Final normalization for zero
        this.sign = 1;
    }
  }

  negate() {
    const negated = new BigIntPrimitive(this, this.canvas);
    if (!negated.isZero()) {
        negated.sign *= -1;
    }
    return negated;
  }

  abs() {
    const absolute = new BigIntPrimitive(this, this.canvas);
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
    const l1 = this.limbs.length;
    const l2 = otherBigInt.limbs.length;
    if (l1 > l2) return 1;
    if (l1 < l2) return -1;
    for (let i = l1 - 1; i >= 0; i--) {
      if (this.limbs[i] > otherBigInt.limbs[i]) return 1;
      if (this.limbs[i] < otherBigInt.limbs[i]) return -1;
    }
    return 0;
  }

  toString() {
    if (this.isZero()) {
      return "0";
    }
    let s = "";
    for (let i = 0; i < this.limbs.length; i++) {
      let limbStr = String(this.limbs[i]);
      if (i < this.limbs.length - 1) {
        limbStr = limbStr.padStart(BigIntPrimitive.BASE_LOG10, '0');
      }
      s = limbStr + s;
    }
    return (this.sign === -1 ? "-" : "") + s;
  }

  isZero() {
    return this.limbs.length === 1 && this.limbs[0] === 0;
  }

  _core_add(positiveOtherBigInt) {
    if (!(positiveOtherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive for _core_add.");
    }
    if (!this.canvas) {
        throw new Error("Canvas not available for WebGL addition.");
    }
    const gl = webglUtilsModule.initWebGL(this.canvas);
    if (!gl) throw new Error("Failed to initialize WebGL for addition.");
    if (!gl.getExtension('WEBGL_color_buffer_float')) {
        const errorMsg = 'WEBGL_color_buffer_float extension is not supported. This is required for GPGPU operations involving rendering to float textures.';
        console.error(errorMsg);
        throw new Error(errorMsg);
    }
    const vertexShader = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, vertexShaderSrc);
    const fragmentShader = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSrc);
    const program = webglUtilsModule.createProgram(gl, vertexShader, fragmentShader);
    if (!program) { if (vertexShader) gl.deleteShader(vertexShader); if (fragmentShader) gl.deleteShader(fragmentShader); throw new Error("Failed to create shader program for addition."); }

    const maxLength = Math.max(this.limbs.length, positiveOtherBigInt.limbs.length);
    const texWidth = maxLength; const texHeight = 1;
    const num1LimbsData = new Float32Array(maxLength); const num2LimbsData = new Float32Array(maxLength);
    const carryInLimbsData = new Float32Array(maxLength);
    for (let i = 0; i < maxLength; i++) {
      num1LimbsData[i] = this.limbs[i] || 0;
      num2LimbsData[i] = positiveOtherBigInt.limbs[i] || 0;
      carryInLimbsData[i] = 0;
    }
    const texNum1 = webglUtilsModule.createDataTexture(gl, num1LimbsData, texWidth, texHeight, false);
    const texNum2 = webglUtilsModule.createDataTexture(gl, num2LimbsData, texWidth, texHeight, false);
    const texCarryIn = webglUtilsModule.createDataTexture(gl, carryInLimbsData, texWidth, texHeight, false);
    const texOutput = webglUtilsModule.createDataTexture(gl, new Float32Array(texWidth * texHeight * 4), texWidth, texHeight, true);
    if (!texNum1 || !texNum2 || !texCarryIn || !texOutput) { /* cleanup */ throw new Error("Failed to create data textures for addition."); }
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { /* cleanup */ throw new Error("Framebuffer incomplete for addition."); }
    const quadVertices = new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]);
    const vertexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
    gl.viewport(0,0,texWidth,texHeight); gl.useProgram(program);
    const aPosLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(aPosLoc); gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texNum1); gl.uniform1i(gl.getUniformLocation(program, "u_num1Texture"),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNum2); gl.uniform1i(gl.getUniformLocation(program, "u_num2Texture"),1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texCarryIn); gl.uniform1i(gl.getUniformLocation(program, "u_carryTexture"),2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const outputBytes = webglUtilsModule.readDataFromTexture(gl, fbo, texWidth, texHeight, false);
    if(!outputBytes) { /* cleanup */ throw new Error("Failed to read pixel data for addition.");}
    const finalLimbs = []; let propCarry = 0;
    for(let i=0; i<maxLength; ++i) {
        let sum = outputBytes[i*4+0] + propCarry;
        finalLimbs.push(sum % BigIntPrimitive.BASE);
        propCarry = outputBytes[i*4+1] + Math.floor(sum / BigIntPrimitive.BASE);
    }
    while(propCarry > 0) { finalLimbs.push(propCarry % BigIntPrimitive.BASE); propCarry = Math.floor(propCarry / BigIntPrimitive.BASE); }
    while(finalLimbs.length > 1 && finalLimbs[finalLimbs.length-1] === 0) { finalLimbs.pop(); }
    gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
    gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer); gl.deleteProgram(program); gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader);
    const res = new BigIntPrimitive("0", this.canvas); res.limbs = finalLimbs.length > 0 ? finalLimbs : [0]; res.sign = 1;
    return res;
  }

  add(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    if (this.sign === otherBigInt.sign) {
      const absThis = this.abs(); const absOther = otherBigInt.abs();
      const sumMagnitude = absThis._core_add(absOther);
      sumMagnitude.sign = this.sign;
      if (sumMagnitude.isZero()) sumMagnitude.sign = 1;
      return sumMagnitude;
    } else {
      return this.subtract(otherBigInt.negate());
    }
  }

  _core_subtract(positiveOtherBigInt) {
    if (!(positiveOtherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive for _core_subtract.");
    }
    if (!this.canvas) {
        throw new Error("Canvas not available for WebGL subtraction.");
    }
    const gl = webglUtilsModule.initWebGL(this.canvas);
    if (!gl) throw new Error("Failed to initialize WebGL for subtraction.");
    if (!gl.getExtension('WEBGL_color_buffer_float')) {
        const errorMsg = 'WEBGL_color_buffer_float extension is not supported. This is required for GPGPU operations involving rendering to float textures.';
        console.error(errorMsg);
        throw new Error(errorMsg);
    }
    const vertexShader = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, subtractVertexShaderSrc);
    const fragmentShader = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, subtractFragmentShaderSrc);
    const program = webglUtilsModule.createProgram(gl, vertexShader, fragmentShader);
    if (!program) { if (vertexShader) gl.deleteShader(vertexShader); if (fragmentShader) gl.deleteShader(fragmentShader); throw new Error("Failed to create shader program for subtraction.");}
    const maxLength = Math.max(this.limbs.length, positiveOtherBigInt.limbs.length);
    const texWidth = maxLength; const texHeight = 1;
    const num1Data = new Float32Array(maxLength); const num2Data = new Float32Array(maxLength); const borrowInData = new Float32Array(maxLength);
    for(let i=0; i<maxLength; ++i){ num1Data[i]=this.limbs[i]||0; num2Data[i]=positiveOtherBigInt.limbs[i]||0; borrowInData[i]=0; }
    const texNum1 = webglUtilsModule.createDataTexture(gl, num1Data, texWidth, texHeight, false);
    const texNum2 = webglUtilsModule.createDataTexture(gl, num2Data, texWidth, texHeight, false);
    const texBorrowIn = webglUtilsModule.createDataTexture(gl, borrowInData, texWidth, texHeight, false);
    const texOutput = webglUtilsModule.createDataTexture(gl, new Float32Array(texWidth*texHeight*4), texWidth, texHeight, true);
    if(!texNum1 || !texNum2 || !texBorrowIn || !texOutput) { /* cleanup */ throw new Error("Failed to create data textures for subtraction.");}
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { /* cleanup */ throw new Error("Framebuffer incomplete for subtraction.");}
    const quadV = new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]);
    const vBuff = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vBuff); gl.bufferData(gl.ARRAY_BUFFER, quadV, gl.STATIC_DRAW);
    gl.viewport(0,0,texWidth,texHeight); gl.useProgram(program);
    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texNum1); gl.uniform1i(gl.getUniformLocation(program, "u_num1Texture"),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNum2); gl.uniform1i(gl.getUniformLocation(program, "u_num2Texture"),1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texBorrowIn); gl.uniform1i(gl.getUniformLocation(program, "u_borrowTexture"),2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.drawArrays(gl.TRIANGLES,0,6); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const outBytes = webglUtilsModule.readDataFromTexture(gl, fbo, texWidth, texHeight, false);
    if(!outBytes) { /* cleanup */ throw new Error("Failed to read pixel data for subtraction.");}
    const finalLimbs = []; let propBorrow = 0;
    for(let i=0; i<maxLength; ++i){
        let diffLimbShader = outBytes[i*4+0]; let jsBorrow = propBorrow;
        let currentLimb = diffLimbShader - jsBorrow;
        propBorrow = outBytes[i*4+1];
        if(currentLimb < 0){ currentLimb += BigIntPrimitive.BASE; propBorrow += 1; }
        finalLimbs.push(currentLimb);
    }
    if(propBorrow > 0) { console.error("_core_subtract resulted in final borrow."); }
    while(finalLimbs.length > 1 && finalLimbs[finalLimbs.length-1]===0){ finalLimbs.pop(); }
    if(finalLimbs.length===0) finalLimbs.push(0);
    gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texBorrowIn); gl.deleteTexture(texOutput);
    gl.deleteFramebuffer(fbo); gl.deleteBuffer(vBuff); gl.deleteProgram(program); gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader);
    const res = new BigIntPrimitive("0",this.canvas); res.limbs=finalLimbs; res.sign=1;
    if(res.isZero()) res.sign=1;
    return res;
  }

  subtract(otherBigInt) {
    if (!(otherBigInt instanceof BigIntPrimitive)) {
      throw new TypeError("Input must be an instance of BigIntPrimitive.");
    }
    if (this.sign !== otherBigInt.sign) {
      const absThis = this.abs(); const absOther = otherBigInt.abs();
      const sumMagnitude = absThis._core_add(absOther);
      sumMagnitude.sign = this.sign;
      if (sumMagnitude.isZero()) sumMagnitude.sign = 1;
      return sumMagnitude;
    } else {
      const comp = this.compareMagnitude(otherBigInt);
      if (comp === 0) return new BigIntPrimitive("0", this.canvas);
      let resultMagnitude;
      if (comp > 0) {
        resultMagnitude = this.abs()._core_subtract(otherBigInt.abs());
        resultMagnitude.sign = this.sign;
      } else {
        resultMagnitude = otherBigInt.abs()._core_subtract(this.abs());
        resultMagnitude.sign = this.sign * -1;
      }
      if (resultMagnitude.isZero()) resultMagnitude.sign = 1;
      return resultMagnitude;
    }
  }

  _multiply_limb_by_bigint(limbValue, otherNumber) {
       if (!this.canvas) { throw new Error("Canvas not available for WebGL operation."); }
       if (limbValue === 0 || otherNumber.isZero()) { return new BigIntPrimitive("0", this.canvas); }
       const gl = webglUtilsModule.initWebGL(this.canvas);
       if (!gl) { throw new Error("Failed to initialize WebGL for _multiply_limb_by_bigint."); }
       if (!gl.getExtension('WEBGL_color_buffer_float')) {
           const errorMsg = 'WEBGL_color_buffer_float extension is not supported. This is required for GPGPU operations involving rendering to float textures.';
           console.error(errorMsg);
           throw new Error(errorMsg);
       }
       const vertexShader = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, multiplyLimbVertexShaderSrc);
       const fragmentShader = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, multiplyLimbFragmentShaderSrc);
       const program = webglUtilsModule.createProgram(gl, vertexShader, fragmentShader);
       if (!program) { /* cleanup */ throw new Error("Failed to create shader program for _multiply_limb_by_bigint."); }
       const maxLength = otherNumber.limbs.length;
       const texWidth = maxLength; const texHeight = 1;
       const otherNumLimbsData = new Float32Array(maxLength); const carryInLimbsData = new Float32Array(maxLength);
       for (let i = 0; i < maxLength; i++) { otherNumLimbsData[i] = otherNumber.limbs[i] || 0; carryInLimbsData[i] = 0; }
       const texOtherNum = webglUtilsModule.createDataTexture(gl, otherNumLimbsData, texWidth, texHeight, false);
       const texCarryIn = webglUtilsModule.createDataTexture(gl, carryInLimbsData, texWidth, texHeight, false);
       const texOutput = webglUtilsModule.createDataTexture(gl, new Float32Array(texWidth * texHeight * 4), texWidth, texHeight, true);
       if (!texOtherNum || !texCarryIn || !texOutput) { /* cleanup */ throw new Error("Failed to create data textures for _multiply_limb_by_bigint."); }
       const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
       gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texOutput, 0);
       if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { /* cleanup */ throw new Error("Framebuffer incomplete for _multiply_limb_by_bigint."); }
       const quadVertices = new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]);
       const vertexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
       gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
       gl.viewport(0,0,texWidth,texHeight); gl.useProgram(program);
       const aPosLoc = gl.getAttribLocation(program, "a_position");
       gl.enableVertexAttribArray(aPosLoc); gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false,0,0);
       gl.uniform1f(gl.getUniformLocation(program, "u_limbVal"), limbValue);
       gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texOtherNum); gl.uniform1i(gl.getUniformLocation(program, "u_otherNumTexture"),0);
       gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texCarryIn); gl.uniform1i(gl.getUniformLocation(program, "u_carryTexture"),1);
       gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.drawArrays(gl.TRIANGLES,0,6); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
       const outputBytes = webglUtilsModule.readDataFromTexture(gl, fbo, texWidth, texHeight, false);
       if(!outputBytes) { /* cleanup */ throw new Error("Failed to read pixel data for _multiply_limb_by_bigint.");}
       const finalResultLimbs = []; let propCarry = 0;
       for(let i=0; i<maxLength; ++i) {
           let currentProdSum = outputBytes[i*4+0] + propCarry;
           finalResultLimbs.push(currentProdSum % BigIntPrimitive.BASE);
           propCarry = outputBytes[i*4+1] + Math.floor(currentProdSum / BigIntPrimitive.BASE);
       }
       while(propCarry > 0) { finalResultLimbs.push(propCarry % BigIntPrimitive.BASE); propCarry = Math.floor(propCarry / BigIntPrimitive.BASE); }
       gl.deleteTexture(texOtherNum); gl.deleteTexture(texCarryIn); gl.deleteTexture(texOutput);
       gl.deleteFramebuffer(fbo); gl.deleteBuffer(vertexBuffer); gl.deleteProgram(program); gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader);
       const res = new BigIntPrimitive("0",this.canvas); res.limbs = finalResultLimbs.length > 0 ? finalResultLimbs : [0]; res.sign=1;
       if(res.isZero()) res.sign=1;
       return res;
   }

   _core_multiply(num1, num2) {
    if (num1.isZero() || num2.isZero()) { return new BigIntPrimitive("0", this.canvas); }
    let totalResult = new BigIntPrimitive("0", this.canvas);
    for (let i = 0; i < num1.limbs.length; i++) {
        const limbOfNum1 = num1.limbs[i];
        if (limbOfNum1 === 0) { continue; }
        let partialProduct = this._multiply_limb_by_bigint(limbOfNum1, num2);
        if (partialProduct.isZero()) { continue; }
        if (i > 0) {
            const shiftedLimbs = new Array(i).fill(0).concat(partialProduct.limbs);
            partialProduct.limbs = shiftedLimbs;
        }
        totalResult = totalResult.add(partialProduct);
        if (!totalResult) { throw new Error("Error during accumulation in _core_multiply."); }
    }
    totalResult.sign = 1;
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

    if (absThisLen < BigIntPrimitive.KARATSUBA_THRESHOLD || absOtherLen < BigIntPrimitive.KARATSUBA_THRESHOLD) {
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

            const p0_shifted = p0._shiftLeft(2 * m);
            const p2_shifted = p2._shiftLeft(m);

            let tempSum = p0_shifted.add(p2_shifted);
            if (!tempSum) throw new Error("Karatsuba: Error in adding p0_shifted and p2_shifted");
            finalAbsResult = tempSum.add(p1);
            if (!finalAbsResult) throw new Error("Karatsuba: Error in adding sum and p1");
        }
    }
    if (finalAbsResult.isZero()) { finalAbsResult.sign = 1; } else { finalAbsResult.sign = resultSign; }
    if (finalAbsResult.canvas !== self.canvas) { finalAbsResult.canvas = self.canvas; }
    return finalAbsResult;
  }

  _shiftLeft(numLimbsToShift) {
    if (numLimbsToShift < 0) {
        throw new Error("numLimbsToShift must be non-negative.");
    }
    if (this.isZero() || numLimbsToShift === 0) {
        return new BigIntPrimitive(this, this.canvas);
    }
    const newLimbs = new Array(numLimbsToShift).fill(0).concat(this.limbs);
    const Ctor = this.constructor;
    const shiftedBigInt = new Ctor("0", this.canvas);
    shiftedBigInt.limbs = newLimbs;
    shiftedBigInt.sign = this.sign;
    return shiftedBigInt;
  }

  _splitAt(m) {
    const Ctor = this.constructor;
    let low, high;
    if (m <= 0) {
        low = new Ctor("0", this.canvas);
        high = new Ctor(this, this.canvas);
        return { low, high };
    }
    if (m >= this.limbs.length) {
        low = new Ctor(this, this.canvas);
        high = new Ctor("0", this.canvas);
        return { low, high };
    }
    low = new Ctor("0", this.canvas);
    let lowSlice = this.limbs.slice(0, m);
    while (lowSlice.length > 1 && lowSlice[lowSlice.length - 1] === 0) { lowSlice.pop(); }
    if (lowSlice.length === 0 || (lowSlice.length === 1 && lowSlice[0] === 0)) { low.limbs = [0]; }
    else { low.limbs = lowSlice; }
    low.sign = low.isZero() ? 1 : 1;
    high = new Ctor("0", this.canvas);
    let highSlice = this.limbs.slice(m);
    while (highSlice.length > 1 && highSlice[highSlice.length - 1] === 0) { highSlice.pop(); }
    if (highSlice.length === 0 || (highSlice.length === 1 && highSlice[0] === 0)) { high.limbs = [0]; }
    else { high.limbs = highSlice; }
    high.sign = high.isZero() ? 1 : 1;
    return { low, high };
  }

  _estimate_quotient_limb(currentDividendSegment, absDivisor) {
    // Estimates q_limb such that q_limb * absDivisor <= currentDividendSegment
    // and (q_limb+1) * absDivisor > currentDividendSegment.
    // Assumes currentDividendSegment and absDivisor are positive, absDivisor is non-zero.

    if (currentDividendSegment.compareMagnitude(absDivisor) < 0) {
        return 0; // If current segment is less than divisor, quotient limb is 0.
    }

    // We are looking for largest q in [0, BASE-1] such that q * D <= S
    // where D = absDivisor, S = currentDividendSegment
    let q_candidate = 0;
    let min_q = 0;
    let max_q = BigIntPrimitive.BASE - 1; // Max possible value for a limb.

    while (min_q <= max_q) {
        const current_q_test = Math.floor((min_q + max_q) / 2);

        // _multiply_limb_by_bigint handles current_q_test = 0 correctly (returns zero BigInt).
        const product = this._multiply_limb_by_bigint(current_q_test, absDivisor);

        if (product.compareMagnitude(currentDividendSegment) <= 0) {
            // current_q_test * D <= S. This current_q_test is a possible candidate.
            // Try for a larger q.
            q_candidate = Math.max(q_candidate, current_q_test);
            min_q = current_q_test + 1;
        } else {
            // current_q_test * D > S. This current_q_test is too large.
            max_q = current_q_test - 1;
        }
    }
    return q_candidate; // This will be the largest q_limb found.
  }

  divide(divisor) {
    const self = this;

    if (!(divisor instanceof BigIntPrimitive)) {
        throw new TypeError("Input divisor must be an instance of BigIntPrimitive.");
    }

    if (divisor.isZero()) {
        throw new Error("Division by zero.");
    }

    if (self.isZero()) {
        return {
            quotient: new BigIntPrimitive("0", self.canvas),
            remainder: new BigIntPrimitive("0", self.canvas)
        };
    }

    const quotientSign = (self.sign === divisor.sign) ? 1 : -1;
    const remainderSign = self.sign;

    const absDividend = self.abs();
    const absDivisor = divisor.abs();

    if (absDividend.compareMagnitude(absDivisor) < 0) {
        return {
            quotient: new BigIntPrimitive("0", self.canvas),
            remainder: new BigIntPrimitive(self, self.canvas)
        };
    }

    // Stub _core_divide if it doesn't exist yet, or ensure it's callable
    // Note: The prompt includes a dynamic stubbing mechanism.
    // For this step, we are adding _core_divide as a proper method,
    // so this dynamic check might be redundant if the method is added correctly.
    // However, including it as per the prompt for robustness during development.
    if (typeof self._core_divide !== 'function') {
        // This is a fallback, ideally _core_divide is defined on the prototype.
        // console.warn("Dynamic stubbing for _core_divide invoked. This is unexpected if _core_divide is defined on prototype.");
        BigIntPrimitive.prototype._core_divide = function(coreAbsDividend, coreAbsDivisor) {
            // console.warn("Temporary dynamic stub for BigIntPrimitive._core_divide.");
            if (coreAbsDividend.compareMagnitude(coreAbsDivisor) === 0) {
                return {
                    quotient: new BigIntPrimitive("1", this.canvas),
                    remainder: new BigIntPrimitive("0", this.canvas)
                };
            }
            const tempRemainder = coreAbsDividend.subtract(coreAbsDivisor);
            return {
                quotient: new BigIntPrimitive("1", this.canvas),
                remainder: tempRemainder
            };
        };
    }

    const { quotient: absQuotient, remainder: absRemainder } = self._core_divide(absDividend, absDivisor);

    absQuotient.sign = absQuotient.isZero() ? 1 : quotientSign;
    absRemainder.sign = absRemainder.isZero() ? 1 : remainderSign;

    return { quotient: absQuotient, remainder: absRemainder };
  }

  _core_divide(absDividend, absDivisor) {
    // Assumes absDividend >= absDivisor, and both are positive, non-zero.
    const Ctor = this.constructor; // BigIntPrimitive
    const canvas = this.canvas; // Canvas from the original 'this' instance

    // quotientLimbs will be built up in LSL-first order.
    // Max possible quotient limbs length is absDividend.limbs.length.
    let quotientLimbs = new Array(absDividend.limbs.length).fill(0);
    let currentWorkingDividend = new Ctor("0", canvas);

    // Iterate through the limbs of absDividend from most significant to least.
    // absDividend.limbs are stored [least_significant, ..., most_significant].
    for (let i = absDividend.limbs.length - 1; i >= 0; i--) {
        // "Bring down" the next limb: currentWorkingDividend = currentWorkingDividend * BASE + dividend_limb[i]
        // currentWorkingDividend * BASE is effectively currentWorkingDividend._shiftLeft(1)
        // if BASE corresponds to one limb shift.
        currentWorkingDividend = currentWorkingDividend._shiftLeft(1);

        const currentDividendLimbValue = absDividend.limbs[i];
        const currentDividendLimbAsBigInt = new Ctor(String(currentDividendLimbValue), canvas);
        currentWorkingDividend = currentWorkingDividend.add(currentDividendLimbAsBigInt);

        // Now, currentWorkingDividend contains the segment of the dividend to test against absDivisor.
        let q_limb = 0;
        // Only try to estimate and subtract if currentWorkingDividend is actually larger or equal to absDivisor.
        if (currentWorkingDividend.compareMagnitude(absDivisor) >= 0) {
            q_limb = this._estimate_quotient_limb(currentWorkingDividend, absDivisor);

            if (q_limb > 0) {
                const productToSubtract = this._multiply_limb_by_bigint(q_limb, absDivisor);
                currentWorkingDividend = currentWorkingDividend.subtract(productToSubtract);
            }
        }
        // Store quotient limb at its correct positional value.
        // If loop is i = absDividend.limbs.length - 1 down to 0,
        // then quotientLimbs[i] corresponds to the limb at position 'i'.
        quotientLimbs[i] = q_limb;
    }

    // currentWorkingDividend is now the final remainder.
    const finalRemainder = currentWorkingDividend;

    // Normalize quotientLimbs: remove leading zeros.
    // Since quotientLimbs were stored with MSL at higher indices, leading zeros are at the end of the array.
    while (quotientLimbs.length > 1 && quotientLimbs[quotientLimbs.length - 1] === 0) {
        quotientLimbs.pop();
    }
    // If quotientLimbs becomes empty (e.g. 0/X), it should be [0].
    if (quotientLimbs.length === 0) {
        quotientLimbs = [0];
    }

    const finalQuotient = new Ctor("0", canvas);
    finalQuotient.limbs = quotientLimbs; // Already LSL-first as per loop structure
    finalQuotient.sign = 1; // Core method returns positive results
    if (finalQuotient.isZero()) {
        finalQuotient.sign = 1; // Normalize zero
    }

    // Ensure remainder is also normalized (it should be by construction, but good check)
    if (finalRemainder.isZero()) {
        finalRemainder.sign = 1;
    } else {
        finalRemainder.sign = 1; // Remainder is always positive from this core method
    }

    return { quotient: finalQuotient, remainder: finalRemainder };
  }
}

export { BigIntPrimitive };
