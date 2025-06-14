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

// Helper function for rounding
function incrementStringCoeff(coeffStr) { // Renamed from strCoeff for clarity
  if (coeffStr === '0') return '1'; // Special case for incrementing "0"
  if (coeffStr === "") coeffStr = "0"; // Treat empty string as "0" before incrementing

  let an = coeffStr.split(''); // No need for .map(Number) here
  let i = an.length - 1;
  while (i >= 0) {
    if (an[i] === '9') { // Compare as string
      an[i] = '0';
      i--;
    } else {
      an[i] = (parseInt(an[i], 10) + 1).toString();
      return an.join('');
    }
  }
  // If loop finishes, all were '9's
  an.unshift('1');
  return an.join('');
}

class BigIntPrimitive {
  static strict = false;
  static NE = -7;
  static PE = 21;
  static DP = 20;
  static RM = 1;

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
      if (value.hasOwnProperty('_roundedDp')) this._roundedDp = value._roundedDp;
      return;
    }

    if (value === null || value === undefined) throw new TypeError("Invalid input type for BigIntPrimitive: cannot be null or undefined.");

    let stringValue = '';
    if (typeof value === 'number') {
      if (!isFinite(value)) throw new TypeError("Numeric input must be finite.");
      stringValue = String(value);
    } else if (typeof value === 'string') {
      stringValue = value.trim();
    } else {
      throw new TypeError("Invalid input type for BigIntPrimitive. Expected string, number, or BigIntPrimitive instance.");
    }

    if (stringValue === "") { this.limbs = [0]; this.exponent = 0; this.sign = 1; return; }

    if (stringValue.startsWith('-')) { this.sign = -1; stringValue = stringValue.substring(1); }
    else if (stringValue.startsWith('+')) { this.sign = 1; stringValue = stringValue.substring(1); }
    else { this.sign = 1; }

    if (/[^0-9.eE+-]/.test(stringValue)) throw new TypeError("Invalid character in numeric string.");

    let mantissaStr = stringValue; let expStr = ''; let sciExponent = 0;
    const sciNotationIndex = stringValue.toLowerCase().indexOf('e');
    if (sciNotationIndex !== -1) {
        mantissaStr = stringValue.substring(0, sciNotationIndex);
        expStr = stringValue.substring(sciNotationIndex + 1);
        if (expStr === "" || expStr === "+" || expStr === "-") throw new TypeError("Invalid scientific notation: exponent missing or malformed sign.");
        if (!/^[+-]?\d+$/.test(expStr)) throw new TypeError("Invalid scientific notation: exponent contains non-digits or is poorly formed.");
        sciExponent = parseInt(expStr, 10);
        if (String(sciExponent) !== expStr.replace(/^\+/, '') && parseFloat(expStr) !== sciExponent) throw new TypeError("Invalid scientific notation: exponent is not an integer.");
        if (isNaN(sciExponent)) throw new TypeError("Invalid scientific notation: exponent is not a number.");
    }

    if (mantissaStr === "" || mantissaStr === ".") throw new TypeError("Invalid numeric string: empty or invalid mantissa.");
    if (mantissaStr.indexOf('e') !== -1 || mantissaStr.indexOf('E') !== -1) throw new TypeError("Invalid scientific notation: 'e' in mantissa after initial split.");
    if (!/^[0-9.]*$/.test(mantissaStr)) throw new TypeError("Invalid characters in mantissa.");

    const decimalPointIndex = mantissaStr.indexOf('.');
    let coefficientStr = mantissaStr;
    if (decimalPointIndex !== -1) {
      if (mantissaStr.indexOf('.', decimalPointIndex + 1) !== -1) throw new TypeError("Invalid numeric string: multiple decimal points in mantissa.");
      coefficientStr = mantissaStr.replace('.', '');
      this.exponent = sciExponent - (mantissaStr.length - 1 - decimalPointIndex);
    } else {
      this.exponent = sciExponent;
    }

    if (coefficientStr === "" || coefficientStr === "0" || coefficientStr === "+0" || coefficientStr === "-0") {
        this.limbs = [0]; this.exponent = 0; this.sign = 1; return;
    }
    if (!/^\d+$/.test(coefficientStr)) throw new TypeError("Invalid BigInt string format: coefficient contains non-digits after sign/decimal/exponent processing.");

    coefficientStr = coefficientStr.replace(/^0+/, '');
    if (coefficientStr === "") { this.limbs = [0]; this.exponent = 0; this.sign = 1; return; }

    let tempLimbs = [];
    let currentPos = coefficientStr.length;
    while (currentPos > 0) {
        const start = Math.max(0, currentPos - BASE_LOG10);
        tempLimbs.unshift(parseInt(coefficientStr.substring(start, currentPos), 10));
        currentPos = start;
    }
    this.limbs = tempLimbs.length > 0 ? tempLimbs : [0];

    while (this.limbs.length > 1 && this.limbs[0] === 0) this.limbs.shift();

    while (this.limbs.length > 1 && this.limbs[this.limbs.length - 1] === 0) {
      this.limbs.pop(); this.exponent += BASE_LOG10;
    }
    if (this.isZero()) { this.exponent = 0; this.sign = 1; }
  }

  static fromCoefficientString(coeffStr, canvas, options = {}) {
    const instance = new BigIntPrimitive("0", canvas, options);
    instance.sign = 1; instance.exponent = 0;
    if (coeffStr === "0" || coeffStr === "") { instance.limbs = [0]; }
    else {
        let tempLimbs = []; let currentPos = coeffStr.length;
        while (currentPos > 0) {
            const start = Math.max(0, currentPos - BASE_LOG10);
            tempLimbs.unshift(parseInt(coeffStr.substring(start, currentPos), 10));
            currentPos = start;
        }
        instance.limbs = tempLimbs.length > 0 ? tempLimbs : [0];
        while (instance.limbs.length > 1 && instance.limbs[0] === 0) instance.limbs.shift();
        if (instance.isZero()) { instance.exponent = 0; instance.sign = 1;}
    }
    return instance;
  }

  _getCoefficientString() {
    if (this.isZero()) return "0"; if (this.limbs.length === 0) return "0";
    let str = this.limbs[0].toString();
    for (let i = 1; i < this.limbs.length; i++) str += this.limbs[i].toString().padStart(BASE_LOG10, '0');
    return str;
  }

  negate() { const n = new BigIntPrimitive(this, this.canvas, {forceCPU:this.forceCPU}); if(!n.isZero()) n.sign *= -1; return n;}
  abs() { const n = new BigIntPrimitive(this, this.canvas, {forceCPU:this.forceCPU}); n.sign = 1; return n;}
  isPositive() { return this.sign === 1 && !this.isZero(); }
  isNegative() { return this.sign === -1 && !this.isZero(); }

  compareMagnitude(other) {
    if (!(other instanceof BigIntPrimitive)) other = new BigIntPrimitive(other.toString(), this.canvas, {forceCPU:true});
    const commonExp = Math.min(this.exponent, other.exponent);
    const thisRepeat = this.exponent - commonExp;
    const otherRepeat = other.exponent - commonExp;
    const thisCoeffStr = this._getCoefficientString() + (thisRepeat > 0 ? '0'.repeat(thisRepeat) : '');
    const otherCoeffStr = other._getCoefficientString() + (otherRepeat > 0 ? '0'.repeat(otherRepeat) : '');

    const thisCoeff = BigIntPrimitive.fromCoefficientString(thisCoeffStr, this.canvas, {forceCPU:true});
    const otherCoeff = BigIntPrimitive.fromCoefficientString(otherCoeffStr, this.canvas, {forceCPU:true});

    if (thisCoeff.limbs.length > otherCoeff.limbs.length) return 1;
    if (thisCoeff.limbs.length < otherCoeff.limbs.length) return -1;
    for (let i=0; i < thisCoeff.limbs.length; i++) {
        if (thisCoeff.limbs[i] > otherCoeff.limbs[i]) return 1;
        if (thisCoeff.limbs[i] < otherCoeff.limbs[i]) return -1;
    }
    return 0;
  }

  cmp(other) {
    if (!(other instanceof BigIntPrimitive)) other = new BigIntPrimitive(other.toString(), this.canvas, {forceCPU:true});
    if (this.isZero() && other.isZero()) return 0;
    if (this.sign !== other.sign) return this.sign > other.sign ? 1 : -1;
    const magRes = this.compareMagnitude(other);
    return this.sign === 1 ? magRes : -magRes;
  }

  eq(o){return this.cmp(o)===0;} gt(o){return this.cmp(o)>0;} gte(o){return this.cmp(o)>=0;} lt(o){return this.cmp(o)<0;} lte(o){return this.cmp(o)<=0;}
  plus(n){return this.add(n);} minus(n){return this.subtract(n);} times(n){return this.multiply(n);} div(n){return this.divide(n);} mod(n){return this.remainder(n);} neg(){return this.negate();}

  toString() {
    if (this.isZero()) {
      if (typeof this._roundedDp === 'number' && this._roundedDp > 0) return (this.sign===-1 ? "-" : "") + '0.'+'0'.repeat(this._roundedDp);
      return "0";
    }
    let s="", c=this._getCoefficientString(), e=this.exponent, l=c.length, p=l+e;
    const sci = (typeof this._roundedDp !== 'number') && (p <= BigIntPrimitive.NE || p > BigIntPrimitive.PE);
    if (sci) {
      s = c[0] + (l > 1 ? '.' + c.substring(1) : '') + 'e' + (p-1 >= 0 ? '+' : '') + (p-1);
      if (s.includes('.')) s = s.replace(/\.0+e/,'e').replace(/(\.[0-9]*[1-9])0+e/,'$1e');
    } else {
      if (e<0) { s = (p>0 ? c.substring(0,p) : '0') + '.' + (p>0 ? c.substring(p) : '0'.repeat(-p)+c); }
      else { s = c + '0'.repeat(e); }
      if (typeof this._roundedDp === 'number') {
        let [iP, fP=''] = s.split('.');
        if (this._roundedDp > 0) { fP = fP.padEnd(this._roundedDp,'0').substring(0,this._roundedDp); s = iP+'.'+fP; }
        else s=iP;
      } else if (s.includes('.')) { s=s.replace(/\.?0+$/,''); if(s.startsWith('.'))s='0'+s; }
    }
    return (this.sign===-1 && s!=="0" ? "-" : "") + s;
  }

  isZero() { return this.limbs.length === 1 && this.limbs[0] === 0; }

  _core_add(other) {
      let rL = [], c = 0, tL = [...this.limbs].reverse(), oL = [...other.limbs].reverse();
      const maxL = Math.max(tL.length, oL.length);
      for(let i=0; i < maxL; i++) { let s = (tL[i]||0)+(oL[i]||0)+c; rL.push(s%BASE); c=Math.floor(s/BASE); }
      if(c) rL.push(c);
      let fL = rL.reverse(); while(fL.length>1 && fL[0]===0) fL.shift(); if(fL.length===0)fL=[0];
      const res = new BigIntPrimitive("0",this.canvas,{forceCPU:true}); res.limbs=fL; res.sign=1; res.exponent=0; if(res.isZero())res.exponent=0; return res;
  }

  add(other) {
    if(!(other instanceof BigIntPrimitive)) other=new BigIntPrimitive(other.toString(),this.canvas,{forceCPU:true});
    let gl;
    if (!this.forceCPU && !other.forceCPU && this.canvas && typeof webglUtilsModule !== 'undefined' && (gl = webglUtilsModule.initWebGL(this.canvas))) {
      const texWidth = Math.max(this.limbs.length, other.limbs.length);
      webglUtilsModule.createDataTexture(gl, this.limbs, texWidth, 1);
      webglUtilsModule.createDataTexture(gl, other.limbs, texWidth, 1);
      webglUtilsModule.createDataTexture(gl, null, texWidth, 1, true);
      webglUtilsModule.readDataFromTexture(gl, null, texWidth, 1, true);
    }
    if(this.isZero()) return new BigIntPrimitive(other,this.canvas,{forceCPU:this.forceCPU||other.forceCPU});
    if(other.isZero()) return new BigIntPrimitive(this,this.canvas,{forceCPU:this.forceCPU||other.forceCPU});
    const res = new BigIntPrimitive("0",this.canvas,{forceCPU:this.forceCPU||other.forceCPU});
    if(this.sign === other.sign){
      const exp = Math.min(this.exponent, other.exponent);
      const thisCoeffStr = this._getCoefficientString() + '0'.repeat(this.exponent-exp > 0 ? this.exponent-exp : 0);
      const otherCoeffStr = other._getCoefficientString() + '0'.repeat(other.exponent-exp > 0 ? other.exponent-exp : 0);
      const tA = BigIntPrimitive.fromCoefficientString(thisCoeffStr,this.canvas,{forceCPU:true});
      const oA = BigIntPrimitive.fromCoefficientString(otherCoeffStr,this.canvas,{forceCPU:true});
      const sum = tA._core_add(oA);
      res.limbs=sum.limbs; res.exponent=exp; res.sign=this.sign;
    } else { const nO=other.negate(); nO.forceCPU = this.forceCPU||other.forceCPU; return this.subtract(nO); }
    if(res.isZero()){res.sign=1; res.exponent=0;} return res;
  }

  _core_subtract(other) {
      let rL = [], b = 0, tL=[...this.limbs].reverse(), oL=[...other.limbs].reverse();
      const maxL=Math.max(tL.length,oL.length);
      for(let i=0;i<maxL;i++){ let d=(tL[i]||0)-b-(oL[i]||0); if(d<0){d+=BASE;b=1;}else b=0; rL.push(d); }
      let fL=rL.reverse(); while(fL.length>1 && fL[0]===0)fL.shift(); if(fL.length===0)fL=[0];
      const res=new BigIntPrimitive("0",this.canvas,{forceCPU:true}); res.limbs=fL; res.sign=1; res.exponent=0; if(res.isZero())res.exponent=0; return res;
  }

  subtract(other) {
    if(!(other instanceof BigIntPrimitive)) other=new BigIntPrimitive(other.toString(),this.canvas,{forceCPU:true});
    let gl;
    // Unified pre-computation for both WebGL and CPU paths
    if (this.sign !== other.sign) {
      const termToAdd = other.negate();
      termToAdd.forceCPU = this.forceCPU || other.forceCPU; // Respect original forceCPU options
      return this.add(termToAdd);
    }

    const comparison = this.compareMagnitude(other);
    if (comparison === 0) return new BigIntPrimitive("0", this.canvas, { forceCPU: true });

    const commonExponent = Math.min(this.exponent, other.exponent);
    let actualMinuend, actualSubtrahend, resultSign;

    if (comparison > 0) { // |this| > |other|
      actualMinuend = this.abs();
      actualSubtrahend = other.abs();
      resultSign = this.sign;
    } else { // |this| < |other|
      actualMinuend = other.abs();
      actualSubtrahend = this.abs();
      resultSign = -this.sign;
    }

    // Align coefficients to the common exponent
    let minuendCoeffStr = actualMinuend._getCoefficientString();
    const minuendZeros = actualMinuend.exponent - commonExponent;
    if (minuendZeros > 0) minuendCoeffStr += '0'.repeat(minuendZeros);
    const alignedMinuendCoeff = BigIntPrimitive.fromCoefficientString(minuendCoeffStr, this.canvas, { forceCPU: true });

    let subtrahendCoeffStr = actualSubtrahend._getCoefficientString();
    const subtrahendZeros = actualSubtrahend.exponent - commonExponent;
    if (subtrahendZeros > 0) subtrahendCoeffStr += '0'.repeat(subtrahendZeros);
    const alignedSubtrahendCoeff = BigIntPrimitive.fromCoefficientString(subtrahendCoeffStr, this.canvas, { forceCPU: true });

    // WebGL Path Attempt
    if (!this.forceCPU && !other.forceCPU && this.canvas && typeof webglUtilsModule !== 'undefined' && (gl = webglUtilsModule.initWebGL(this.canvas))) {
      const minuendLimbsGL = [...alignedMinuendCoeff.limbs].reverse(); // LSB first
      const subtrahendLimbsGL = [...alignedSubtrahendCoeff.limbs].reverse(); // LSB first
      const texWidth = Math.max(minuendLimbsGL.length, subtrahendLimbsGL.length);

      const vertShader = webglUtilsModule.createShader(gl, gl.VERTEX_SHADER, subtractVertexShaderSrc);
      const fragShader = webglUtilsModule.createShader(gl, gl.FRAGMENT_SHADER, subtractFragmentShaderSrc);
      const program = webglUtilsModule.createProgram(gl, vertShader, fragShader);

      if (!program) {
        console.warn("[WebGL Subtract] Shader program creation failed. Falling back to CPU.");
        // Fallback to CPU (uses alignedMinuendCoeff, alignedSubtrahendCoeff from above)
      } else {
        const minuendData = new Float32Array(texWidth);
        const subtrahendData = new Float32Array(texWidth);
        const borrowInData = new Float32Array(texWidth);
        for (let i = 0; i < texWidth; i++) {
          minuendData[i] = minuendLimbsGL[i] || 0;
          subtrahendData[i] = subtrahendLimbsGL[i] || 0;
          borrowInData[i] = 0.0;
        }

        const texNum1 = webglUtilsModule.createDataTexture(gl, minuendData, texWidth, 1, false, gl.TEXTURE0);
        const texNum2 = webglUtilsModule.createDataTexture(gl, subtrahendData, texWidth, 1, false, gl.TEXTURE1);
        const texBorrowIn = webglUtilsModule.createDataTexture(gl, borrowInData, texWidth, 1, false, gl.TEXTURE2);
        const outputTexture = webglUtilsModule.createDataTexture(gl, null, texWidth, 1, true, gl.TEXTURE3);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);

        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          console.warn("[WebGL Subtract] Framebuffer incomplete. Falling back to CPU.");
          gl.deleteProgram(program); gl.deleteShader(vertShader); gl.deleteShader(fragShader);
          gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texBorrowIn); gl.deleteTexture(outputTexture);
          gl.deleteFramebuffer(fbo);
          // Fallback to CPU
        } else {
          // Execute WebGL subtraction
          gl.viewport(0, 0, texWidth, 1);
          gl.useProgram(program);
          gl.uniform1i(gl.getUniformLocation(program, "u_num1Texture"), 0);
          gl.uniform1i(gl.getUniformLocation(program, "u_num2Texture"), 1);
          gl.uniform1i(gl.getUniformLocation(program, "u_borrowTexture"), 2);
          gl.uniform1f(gl.getUniformLocation(program, "BASE"), BASE);

          const posBuffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
          const posLocation = gl.getAttribLocation(program, "a_position");
          gl.enableVertexAttribArray(posLocation);
          gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          const rawOutput = webglUtilsModule.readDataFromTexture(gl, fbo, texWidth, 1, true);

          gl.deleteProgram(program); gl.deleteShader(vertShader); gl.deleteShader(fragShader);
          gl.deleteTexture(texNum1); gl.deleteTexture(texNum2); gl.deleteTexture(texBorrowIn); gl.deleteTexture(outputTexture);
          gl.deleteFramebuffer(fbo); gl.deleteBuffer(posBuffer);

          let resultLimbsReversed = [];
          let propagatedBorrow = 0;
          for (let i = 0; i < texWidth; i++) {
            let limbFromShader = rawOutput[i * 4 + 0];
            let borrowGeneratedByShader = rawOutput[i * 4 + 1];
            let currentLimbVal = limbFromShader - propagatedBorrow;
            propagatedBorrow = borrowGeneratedByShader;
            if (currentLimbVal < 0) {
              currentLimbVal += BASE;
              propagatedBorrow += 1;
            }
            resultLimbsReversed.push(currentLimbVal);
          }

          let finalLimbs = resultLimbsReversed.reverse();
          while (finalLimbs.length > 1 && finalLimbs[0] === 0) finalLimbs.shift();

          if (finalLimbs.length === 1 && finalLimbs[0] === 0) { // Result is zero
            return new BigIntPrimitive("0", this.canvas, { forceCPU: true });
          }

          const result = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
          result.limbs = finalLimbs;
          result.sign = resultSign;
          result.exponent = commonExponent;
          if (result.isZero()) { result.sign = 1; result.exponent = 0; } // Should be caught above
          return result;
        }
      }
    } // End of WebGL Path Attempt, if it fell through, proceed to CPU

    // CPU Path (if WebGL path failed or was not taken)
    const finalResult = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    // alignedMinuendCoeff, alignedSubtrahendCoeff, resultSign, and commonExponent
    // are already defined from the unified pre-computation block.
    const coreRes = alignedMinuendCoeff._core_subtract(alignedSubtrahendCoeff);
    finalResult.limbs = coreRes.limbs;
    finalResult.sign = resultSign;
    finalResult.exponent = commonExponent;
    if (finalResult.isZero()) {
        finalResult.sign = 1;
        finalResult.exponent = 0;
    }
    return finalResult;
  }

  _multiply_limb_by_bigint(limb,other){
    let rL=[], c=0, oLR=[...other.limbs].reverse();
    for(let i=0;i<oLR.length;i++){ const p=oLR[i]*limb+c; rL.push(p%BASE); c=Math.floor(p/BASE); }
    while(c>0){rL.push(c%BASE); c=Math.floor(c/BASE);}
    let fL=rL.reverse(); if(fL.length===0)fL=[0]; while(fL.length>1&&fL[0]===0)fL.shift();
    const res=new BigIntPrimitive("0",this.canvas,{forceCPU:true}); res.limbs=fL; res.sign=1; res.exponent=0; return res;
  }
  _core_multiply(num1,num2){
    if(num1.isZero()||num2.isZero())return new BigIntPrimitive("0",this.canvas,{forceCPU:true});
    let tR=new BigIntPrimitive("0",this.canvas,{forceCPU:true}); // tR.exponent is 0
    const n1LR=[...num1.limbs].reverse();

    for(let i=0;i<n1LR.length;i++){
      const d1=n1LR[i];
      // If num1 is [0], n1LR is [0]. d1 is 0. We need to proceed if it's the only limb.
      if(d1===0 && n1LR.length > 1 && num1.limbs.length > 1) continue;

      let pPM=this._multiply_limb_by_bigint(d1,num2); // pPM.exponent is 0
      // If pPM is zero, and it's not the very first (potentially only) partial product, skip.
      if(pPM.isZero() && (i > 0 || !tR.isZero())) continue;


      // sPP represents pPM shifted by i limbs (pPM.coefficient * BASE^i).
      // We want to add this value to tR, keeping tR's exponent at 0.
      const sPP_temp_exp = new BigIntPrimitive(pPM,this.canvas,{forceCPU:true}); // sPP_temp_exp.exponent is 0 from pPM
      sPP_temp_exp.exponent = i*BASE_LOG10; // Now sPP_temp_exp represents the shifted value, exponent indicates shift.

      if (tR.isZero()) {
        // First non-zero partial product.
        // tR must become the value of sPP_temp_exp, but represented with exponent 0.
        let sPPCoeffStr = sPP_temp_exp._getCoefficientString();
        if (sPP_temp_exp.exponent > 0 && sPPCoeffStr !== "0") {
            sPPCoeffStr += '0'.repeat(sPP_temp_exp.exponent); // Shift coefficient
        }
        tR = BigIntPrimitive.fromCoefficientString(sPPCoeffStr, this.canvas, {forceCPU:true});
        // Now tR has the correct limbs and exponent 0.
      } else {
        // Subsequent additions. add() will use its main logic because tR is not zero.
        // sPP_temp_exp has its exponent indicating its scale.
        // add() will correctly align sPP_temp_exp's coefficient with tR's coefficient (both at effective common exponent 0)
        // and the result will have exponent 0.
        tR = tR.add(sPP_temp_exp);
      }
    }

    // Final tR should have exponent 0.
    // Normalization for zero value.
    if(tR.isZero()){tR.sign=1;tR.exponent=0;}
    else {
      // Ensure no leading zero limbs if any path missed it.
      while(tR.limbs.length>1 && tR.limbs[0]===0) tR.limbs.shift();
      if(tR.limbs.length===0) { tR.limbs=[0]; tR.exponent=0; } // Should not happen if isZero is handled
    }
    tR.sign=1; // _core_multiply returns magnitude
    // Ensure exponent is 0, as this function multiplies coefficients.
    // This should be guaranteed by the logic above if tR starts and stays as exp 0.
    // However, to be absolutely certain against any regression or missed path:
    if (!tR.isZero()) tR.exponent = 0;
    return tR;
  }
  multiply(other){
    const self=this;
    // console.log(`[Multiply START] this.toString(): ${self.toString()}, self.canvas: ${self.canvas ? 'defined' : 'undefined/null'}, self.forceCPU: ${self.forceCPU}`);
    // if (other instanceof BigIntPrimitive) {
    //   console.log(`[Multiply START] other.toString(): ${other.toString()}, other.canvas: ${other.canvas ? 'defined' : 'undefined/null'}, other.forceCPU: ${other.forceCPU}`);
    // } else {
    //   console.log(`[Multiply START] other is not BigIntPrimitive: ${other}`);
    // }

    if(!(other instanceof BigIntPrimitive)) other=new BigIntPrimitive(other.toString(),this.canvas,{forceCPU:true});
    if(self.isZero()||other.isZero())return new BigIntPrimitive("0",self.canvas,{forceCPU:self.forceCPU||other.forceCPU});
    let absRes; let glInstance=null;

    // console.log(`[Multiply PRE-WebGL] self.canvas: ${self.canvas ? 'defined' : 'undefined/null'}`);
    const useWebGL=!self.forceCPU&&!other.forceCPU&&self.canvas&&typeof webglUtilsModule !== 'undefined'&&(glInstance=webglUtilsModule.initWebGL(self.canvas));
    // console.log(`[Multiply POST-WebGL] useWebGL: ${useWebGL}, glInstance: ${glInstance ? 'defined' : 'undefined/null'}`);
    let webGLFailed=false;
    if(useWebGL){
      const n1Abs=self.abs(); const n2Abs=other.abs();
      const n1Exp = n1Abs.exponent > 0 ? n1Abs.exponent : 0; const n2Exp = n2Abs.exponent > 0 ? n2Abs.exponent : 0;
      const n1Coeff=BigIntPrimitive.fromCoefficientString(n1Abs._getCoefficientString()+'0'.repeat(n1Exp),self.canvas,{forceCPU:true});
      const n2Coeff=BigIntPrimitive.fromCoefficientString(n2Abs._getCoefficientString()+'0'.repeat(n2Exp),self.canvas,{forceCPU:true});
      let accRes=new BigIntPrimitive("0",self.canvas,{forceCPU:true}); const n1LR=[...n1Coeff.limbs].reverse();
      for(let i=0;i<n1LR.length;i++){
        const cNL=n1LR[i]; if(cNL===0&&n1LR.length>1)continue;
        const pP=self._webgl_multiply_one_limb_by_bigint(cNL,n2Coeff,glInstance);
        if(!pP){webGLFailed=true;break;}
        pP.exponent+=i*BASE_LOG10; accRes=accRes.add(pP);
      }
      if(!webGLFailed){absRes=accRes; absRes.exponent=self.exponent+other.exponent;}
    }
    if(!useWebGL||webGLFailed){
       const sAbsExp = self.abs().exponent > 0 ? self.abs().exponent : 0;
       const oAbsExp = other.abs().exponent > 0 ? other.abs().exponent : 0;
       const t1AbsC=BigIntPrimitive.fromCoefficientString(self.abs()._getCoefficientString()+'0'.repeat(sAbsExp),self.canvas,{forceCPU:true});
       const t2AbsC=BigIntPrimitive.fromCoefficientString(other.abs()._getCoefficientString()+'0'.repeat(oAbsExp),self.canvas,{forceCPU:true});
       if(t1AbsC.limbs.length<KARATSUBA_THRESHOLD||t2AbsC.limbs.length<KARATSUBA_THRESHOLD){absRes=self._core_multiply(t1AbsC,t2AbsC);}
       else{
           const n=Math.max(t1AbsC.limbs.length,t2AbsC.limbs.length); const m=Math.floor(n/2);
           if(m===0){absRes=self._core_multiply(t1AbsC,t2AbsC);}
           else{
               const {low:b,high:a}=t1AbsC._splitAtForKaratsuba(m); const{low:d,high:c}=t2AbsC._splitAtForKaratsuba(m);
               const cO={forceCPU:true}; const p0=a.multiply(c,cO); const p1=b.multiply(d,cO);
               const sAB=a.add(b); const sCD=c.add(d); const p2t=sAB.multiply(sCD,cO);
               const p0p1=p0.add(p1); const p2=p2t.subtract(p0p1);
               const p0s=p0._multiplyByPowerOfBase(2*m); const p2s=p2._multiplyByPowerOfBase(m);
               absRes=p0s.add(p2s).add(p1);
           }
       }
       absRes.exponent=self.exponent+other.exponent;
    }
    absRes.sign=(self.sign===other.sign)?1:-1; if(absRes.isZero()){absRes.sign=1;absRes.exponent=0;} return absRes;
  }
  _splitAtForKaratsuba(m){
    const cO={forceCPU:true}; const C=BigIntPrimitive; const l=this.limbs; const len=l.length; let hL,lL;
    if(m<=0){hL=[...l];lL=[0];} else if(m>=len){lL=[...l];hL=[0];} else{hL=l.slice(0,len-m);lL=l.slice(len-m);}
    const h=new C("0",this.canvas,cO); h.limbs=hL.length>0?hL:[0]; if(h.isZero())h.exponent=0;
    const lo=new C("0",this.canvas,cO); lo.limbs=lL.length>0?lL:[0]; if(lo.isZero())lo.exponent=0;
    return{low:lo,high:h};
  }
  pow(exp){
    if(typeof exp!=='number'||!Number.isInteger(exp)||exp<0||exp>1e6)throw Error("Exponent error");
    const cO={forceCPU:this.forceCPU}; if(exp===0)return new BigIntPrimitive("1",this.canvas,cO);
    if(this.isZero())return new BigIntPrimitive(this,this.canvas,cO);
    if(this.limbs.length===1&&this.limbs[0]===1&&this.exponent===0)return this.sign===1?new BigIntPrimitive(this,this.canvas,cO):(exp%2===0?new BigIntPrimitive("1",this.canvas,cO):new BigIntPrimitive(this,this.canvas,cO));
    if(exp===1)return new BigIntPrimitive(this,this.canvas,cO);
    let r=new BigIntPrimitive("1",this.canvas,cO),cB=new BigIntPrimitive(this,this.canvas,cO),e=exp;
    while(e>0){if(e%2===1)r=r.multiply(cB);cB=cB.multiply(cB);e=Math.floor(e/2);} return r;
  }
  _multiplyByPowerOfBase(p){
    const cO={forceCPU:this.forceCPU}; if(typeof p!=='number'||!Number.isInteger(p)||p<0)throw Error("Power error");
    if(this.isZero()||p===0)return new BigIntPrimitive(this,this.canvas,cO);
    const r=new BigIntPrimitive(this,this.canvas,cO); r.exponent+=p*BASE_LOG10; return r;
  }
  _webgl_multiply_one_limb_by_bigint(limb,otherNum,gl){
    if(!gl){console.error("WebGL context not passed to _webgl_multiply_one_limb_by_bigint.");return null;}
    const oLR=[...otherNum.limbs].reverse(); const tW=oLR.length+1;

    const vS=webglUtilsModule.createShader(gl,gl.VERTEX_SHADER,multiplyLimbVertexShaderSrc);
    if (!gl.getShaderParameter(vS, gl.COMPILE_STATUS)) {
      console.error("Vertex shader compilation failed:", gl.getShaderInfoLog(vS));
      gl.deleteShader(vS);
      return null;
    }

    const fS=webglUtilsModule.createShader(gl,gl.FRAGMENT_SHADER,multiplyLimbFragmentShaderSrc);
    if (!gl.getShaderParameter(fS, gl.COMPILE_STATUS)) {
      console.error("Fragment shader compilation failed:", gl.getShaderInfoLog(fS));
      gl.deleteShader(vS); // Clean up vertex shader too
      gl.deleteShader(fS);
      return null;
    }

    const prog=webglUtilsModule.createProgram(gl,vS,fS);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("Shader program linking failed:", gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      gl.deleteShader(vS);
      gl.deleteShader(fS);
      return null;
    }
    // Original if(!prog) check is now covered by the link status check.

    const pOD=new Float32Array(tW); oLR.forEach((v,i)=>pOD[i]=v); const iCD=new Float32Array(tW).fill(0.0);
    const tON=webglUtilsModule.createDataTexture(gl,pOD,tW,1,false); const tCI=webglUtilsModule.createDataTexture(gl,iCD,tW,1,false); const oT=webglUtilsModule.createDataTexture(gl,null,tW,1,false);
    const fbo=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,oT,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){
      console.error("Framebuffer incomplete.");
      gl.deleteProgram(prog); gl.deleteShader(vS); gl.deleteShader(fS);
      gl.deleteTexture(tON); gl.deleteTexture(tCI); gl.deleteTexture(oT);
      gl.deleteFramebuffer(fbo);
      return null;
    }
    gl.viewport(0,0,tW,1); gl.useProgram(prog);
    gl.uniform1f(gl.getUniformLocation(prog,"u_limbVal"),limb); gl.uniform1f(gl.getUniformLocation(prog,"BASE"),BASE);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,tON); gl.uniform1i(gl.getUniformLocation(prog,"u_otherNumTexture"),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,tCI); gl.uniform1i(gl.getUniformLocation(prog,"u_carryTexture"),1);
    const pBuf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,pBuf); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const pALoc=gl.getAttribLocation(prog,"a_position"); gl.enableVertexAttribArray(pALoc); gl.vertexAttribPointer(pALoc,2,gl.FLOAT,false,0,0);
    gl.drawArrays(gl.TRIANGLES,0,6); const rawOut=webglUtilsModule.readDataFromTexture(gl,fbo,tW,1,false);
    let rLLS=[]; let cLC=0; if(rawOut){for(let j=0;j<tW;j++){const sR=rawOut[j*4+0];const sC=rawOut[j*4+1];const sum=(sR===undefined?0:sR)+cLC;rLLS.push(sum%BASE);cLC=Math.floor(sum/BASE)+(sC===undefined?0:sC);}}
    while(cLC>0){rLLS.push(cLC%BASE);cLC=Math.floor(cLC/BASE);}
    gl.deleteProgram(prog);gl.deleteShader(vS);gl.deleteShader(fS);gl.deleteTexture(tON);gl.deleteTexture(tCI);gl.deleteTexture(oT);gl.deleteFramebuffer(fbo);gl.deleteBuffer(pBuf);
    while(rLLS.length>1&&rLLS[rLLS.length-1]===0)rLLS.pop(); if(rLLS.length===0)rLLS=[0];
    const rBI=new BigIntPrimitive("0",this.canvas,{forceCPU:true}); rBI.limbs=rLLS.reverse(); rBI.exponent=0; if(rBI.isZero())rBI.exponent=0; return rBI;
  }

  // Dummy implementations for other methods that were in the original file
  // _longDivide(dividend, divisor) { console.warn("_longDivide not fully implemented"); return { quotient: new BigIntPrimitive("0"), remainder: new BigIntPrimitive("0") }; }

  _longDivide_cpu(dividend, divisor) {
    // Assumes dividend and divisor are positive BigIntPrimitives with exponent 0 (coefficients).
    let currentDividendCoeff = dividend._getCoefficientString();
    const divisorCoeff = divisor._getCoefficientString(); // This is a string
    const divisorBigInt = divisor; // This is a BigIntPrimitive

    if (divisorBigInt.isZero()) throw new Error("[big.js] Division by zero");
    if (dividend.isZero()) {
        return {
            quotient: new BigIntPrimitive("0", this.canvas, {forceCPU: true}),
            remainder: new BigIntPrimitive("0", this.canvas, {forceCPU: true})
        };
    }

    if (dividend.compareMagnitude(divisorBigInt) < 0) {
        return {
            quotient: new BigIntPrimitive("0", this.canvas, {forceCPU: true}),
            remainder: new BigIntPrimitive(dividend, this.canvas, {forceCPU: true})
        };
    }

    let quotientStr = "";
    let partStr = "";

    for (let i = 0; i < currentDividendCoeff.length; i++) {
        partStr += currentDividendCoeff[i];
        if (partStr.length < divisorCoeff.length && i < currentDividendCoeff.length -1) {
             if (partStr === "0" || partStr === "") { /* allow leading zero if it's the only thing */ }
             else if (quotientStr !== "") { // Avoid adding '0' at the very beginning if not needed
                quotientStr += "0";
             }
            continue;
        }

        let partBigInt = BigIntPrimitive.fromCoefficientString(partStr, this.canvas, {forceCPU: true});

        if (partBigInt.compareMagnitude(divisorBigInt) < 0) {
            if (quotientStr !== "" || i >= divisorCoeff.length-1 ) quotientStr += "0"; // Add 0 if not leading part or if past initial divisor length
            // if partStr becomes "0", reset it to avoid "00", "01" etc.
            if (partStr === "0") partStr = "";
            continue;
        }

        let qDigit = 0;
        // Estimate quotient digit: how many times divisorBigInt fits into partBigInt
        // Start with a rough estimate, then refine. Max 9.
        let low = 0;
        let high = 10; // Max possible qDigit is 9 (or BASE-1 if limb-based)
                       // Using 10 because loop condition is < high

        // Binary search for qDigit can be an optimization here.
        // For now, simple linear search:
        let currentQ = 0;
        for (let k=1; k<10; k++){
            let tempProd = divisorBigInt.multiply(new BigIntPrimitive(k.toString(), this.canvas, {forceCPU:true}));
            if(tempProd.compareMagnitude(partBigInt) <= 0){
                currentQ = k;
            } else {
                break;
            }
        }
        qDigit = currentQ;
        quotientStr += qDigit.toString();

        let product = divisorBigInt.multiply(new BigIntPrimitive(qDigit.toString(), this.canvas, {forceCPU:true}));
        let remainderOfPart = partBigInt.subtract(product);

        partStr = remainderOfPart.isZero() ? "" : remainderOfPart._getCoefficientString();
    }

    quotientStr = quotientStr.replace(/^0+(?=\d)/, ''); // Remove leading zeros unless it's "0"
    if (quotientStr === "") quotientStr = "0";

    const finalQuotient = BigIntPrimitive.fromCoefficientString(quotientStr, this.canvas, {forceCPU: true});
    const finalRemainder = BigIntPrimitive.fromCoefficientString(partStr === "" ? "0" : partStr, this.canvas, {forceCPU: true});

    return { quotient: finalQuotient, remainder: finalRemainder };
  }

  _decimalDivide_cpu(absDividend, absDivisor) {
    const Ctor = this.constructor;
    const currentDP = Ctor.DP;
    const requiredScaleFactor = currentDP + 1; // Calculate one extra digit for rounding

    let tempDividendCoeffStr = absDividend._getCoefficientString();
    tempDividendCoeffStr += '0'.repeat(requiredScaleFactor);

    const scaledDividend = Ctor.fromCoefficientString(tempDividendCoeffStr, this.canvas, { forceCPU: true });
    // scaledDividend has exponent 0. Its value is absDividend.coefficient * 10^requiredScaleFactor

    // absDivisor is already |divisor|, also with exponent 0 if it was an integer, or its original exponent.
    // _longDivide_cpu expects both operands to be effectively integers (coeffs with exp 0).
    // So, we need to ensure absDivisor is also just its coefficient part for the division.
    const divisorCoeff = Ctor.fromCoefficientString(absDivisor._getCoefficientString(), this.canvas, {forceCPU: true});

    const { quotient: rawQuotientCoeff, remainder: rawRemainderCoeff } = this._longDivide_cpu(scaledDividend, divisorCoeff);

    let finalQuotientCoeffStr = rawQuotientCoeff._getCoefficientString();

    // finalQuotientCoeffStr is the result of (absDividend.coeff * 10^requiredScaleFactor) / absDivisor.coeff
    // This string has `requiredScaleFactor` implied decimal places with respect to the original X = absDividend.coeff / absDivisor.coeff
    // We need to round it to `currentDP` implied decimal places.
    // The digit that determines rounding is the (currentDP + 1)-th digit.
    // In finalQuotientCoeffStr, this is the digit at index `finalQuotientCoeffStr.length - requiredScaleFactor + currentDP`.

    const decisionIndex = (finalQuotientCoeffStr.length - requiredScaleFactor) + currentDP;
    let roundedCoeffStr = finalQuotientCoeffStr;

    if (decisionIndex >= 0 && decisionIndex < finalQuotientCoeffStr.length) { // Rounding is applicable
        roundedCoeffStr = this._staticRound_cpu(finalQuotientCoeffStr, decisionIndex, Ctor.RM, false); // isNegative is false as we use abs values
    } else if (decisionIndex < 0) { // Result is very small, effectively 0 or 1 after rounding
        // e.g. "005" (0.005), scaleFactor=3, currentDP=1. decisionIndex = (3-3)+1 = 1
        // This logic means rounding to a position left of the MSB of finalQuotientCoeffStr
        // For example, if finalQuotientCoeffStr = "5" (from 0.005, scaled), currentDP = 0
        // decisionIndex = (1-3)+0 = -2.
        // We need to round "0.005" at the 0th decimal place (units for 0.xxx)
        // Pass "0" + finalCoeffStr to _staticRound_cpu, and decisionIndex becomes currentDP relative to that "0."
        const tempCoeffForRounding = "0".repeat(Math.abs(decisionIndex)+1) + finalQuotientCoeffStr;
        roundedCoeffStr = this._staticRound_cpu(tempCoeffForRounding, currentDP , Ctor.RM, false);
        if (roundedCoeffStr !== "0") roundedCoeffStr = roundedCoeffStr.replace(/^0+/, ''); // "01" -> "1"
        if (roundedCoeffStr === "") roundedCoeffStr = "0";
    }
    // Else: decisionIndex >= finalQuotientCoeffStr.length means not enough digits to round at (DP+1)th place.
    // Example: 123 / 1 = 123. scaled: 123000 / 1 = 123000. currentDP = 2, scaleFactor = 3.
    // finalQuotientCoeffStr = "123000". decisionIndex = (6-3)+2 = 5. coeffStr[5] is '0'.
    // _staticRound_cpu("123000", 5, ...) -> "12300". This is correct.

    const result = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
    result.limbs = Ctor.fromCoefficientString(roundedCoeffStr, this.canvas, {forceCPU:true}).limbs;

    // Exponent calculation:
    // Initial exponent difference: absDividend.exponent - absDivisor.exponent
    // We scaled dividend's coefficient by 10^requiredScaleFactor.
    // The rawQuotientCoeff was an integer result of dividing these scaled/unscaled coefficients.
    // The roundedCoeffStr now represents the significant digits of the result,
    // which should have `currentDP` decimal places.
    // So, its exponent is (absDividend.exponent - absDivisor.exponent) - currentDP.
    result.exponent = (absDividend.exponent - absDivisor.exponent) - currentDP;

    // If rounding caused an overflow (e.g. "99" with DP=0 rounded to "100"),
    // roundedCoeffStr might be longer than original integer part + currentDP.
    // Example: 0.99, DP=0. absDividend="99" exp-2. absDivisor="1" exp0. currentDP=0, scaleFactor=1.
    // tempDividendCoeffStr = "990". scaledDividend="990" exp0. divisorCoeff="1" exp0.
    // rawQuotientCoeff="990". finalQuotientCoeffStr="990".
    // decisionIndex=(3-1)+0 = 2. digit '0'. _staticRound_cpu("990",2,RM_HALF_UP) -> "99".
    // This should be: 0.99 rounded to 0 DP is "1".
    // Let's re-check decisionIndex for _staticRound_cpu: it's the digit that *decides*.
    // For "0.99" to 0DP, decision digit is '9' (1st decimal). Index in "99" (coeff) is 0.
    // For coeff "99", exp -2. To get 0 DP, we need integer part. Integer part length = 2-2 = 0.
    // decisionIndex = 0 + 0 = 0.
    // _staticRound_cpu("99", 0, RM_HALF_UP) -> "1" (from "0.9" being rounded).
    // roundedCoeffStr = "1". result.exponent = (-2 - 0) - 0 = -2. This is "0.01". Incorrect. Should be "1" exp 0.

    // The exponent adjustment needs to account for the length change from rounding.
    // Number of digits in roundedCoeffStr that are *integer* digits:
    // roundedCoeffStr represents a number that has currentDP decimal places.
    // So, integer digits = roundedCoeffStr.length - currentDP.
    // The exponent should make it so that these integer digits are indeed integer digits.
    // finalExponent = -(currentDP - (roundedCoeffStr.length - (original_integer_part_length_of_quotient)))
    // This is too complex. Simpler:
    // `result.exponent = (absDividend.exponent - absDivisor.exponent) - currentDP;` IS THE TARGET.
    // If _staticRound_cpu returns "1" for "0.99" (DP=0), then result.limbs="1", result.exponent = (-2 - 0) - 0 = -2. (Value 0.01) WRONG.
    // If _staticRound_cpu returns "10" for "9.9" (DP=0), then result.limbs="10", result.exponent = (-1 - 0) - 0 = -1. (Value 1.0) Correct.
    // The `incrementStringCoeff` can add a leading '1'.
    // If roundedCoeffStr = "10", and it was expected to be like "X" (1 digit for integer part as dp=0)
    // original integer part length of quotient: finalQuotientCoeffStr.length - requiredScaleFactor
    // If (roundedCoeffStr.length > (finalQuotientCoeffStr.length - requiredScaleFactor) + currentDP) then exponent++.

    // Let initial_int_digits = finalQuotientCoeffStr.length - requiredScaleFactor; (can be < 0)
    // Let final_int_digits = roundedCoeffStr.length - currentDP; (can be < 0)
    // exponent_adjustment = final_int_digits - initial_int_digits;
    // result.exponent = (absDividend.exponent - absDivisor.exponent) - requiredScaleFactor + exponent_adjustment; NO.

    // Let Q = D/d. We computed Q_s = (D * 10^S) / d_coeff, where S = DP+1.
    // Then we rounded Q_s at its (DP+1)th effective decimal place to get Q_r_coeff.
    // Q_r_coeff is the coefficient of (Q * 10^DP).
    // So, the exponent for Q_r_coeff to represent Q is -(DP).
    // Final exponent = (absDividend.exponent - absDivisor.exponent) - DP. This was already there.

    // The issue is if rounding "X.Y" to "Z0". e.g. 9.5 to 10.
    // Coeff "95", exp -1. DP=0. ScaleFactor=1.
    // Scaled Dividend: "950". Divisor "1" exp 0.
    // RawQuotientCoeff: "950". finalCoeffStr="950".
    // decisionIndex = (3-1)+0 = 2. (digit '0').
    // _staticRound_cpu("950", 2, RM_HALF_UP) -> "95" (incorrect, should be based on actual value 9.5)
    // The decision index must be based on the true (DP+1)th decimal of original scaled value.
    // For "950" (representing 95.0), rounding at 0 DP means decision on 1st decimal '0'. Index in "950" is 2.
    // For "95" (representing 9.5), rounding at 0 DP means decision on 1st decimal '5'. Index in "95" is 1.
    // _staticRound_cpu must be called with the coefficient string of (Q_s / 10^(scaleFactor-DP-1))
    // i.e. a string with exactly DP+1 fractional digits.

    // Let's simplify the string passed to _staticRound_cpu:
    // finalCoeffStr has `requiredScaleFactor` (DP+1) implied decimals.
    // We want to round to `currentDP` decimals. So we look at the (DP+1)th decimal.
    // The `decisionIndex` for `_staticRound_cpu` should be the index of this (DP+1)th digit.
    // If finalCoeffStr is "Q_int Q_frac" where Q_frac has DP+1 digits.
    // Length of Q_frac is DP+1. Length of Q_int is finalCoeffStr.length - (DP+1).
    // decisionIndex = (finalCoeffStr.length - (DP+1)) + DP = finalCoeffStr.length - 1.
    // This means decision is always on the last digit of finalCoeffStr.

    if (finalCoeffStr.length > 0) { // Only round if there's something to round
       roundedCoeffStr = this._staticRound_cpu(finalCoeffStr, finalCoeffStr.length -1, Ctor.RM, false);
        // If "333" (DP=2, scale=3), decision on last '3'. Returns "33".
        // If "267" (DP=2, scale=3), decision on last '7'. Returns "27".
       result.exponent = (absDividend.exponent - absDivisor.exponent) - currentDP;
       // If roundedCoeffStr became shorter than finalCoeffStr by 1, exponent is correct.
       // If it became longer ("99" -> "100"), then roundedCoeffStr has one more digit than target coeff for DP.
       // e.g. 0.99, DP=0. absDiv="99"e-2, absDivisor="1"e0. scale=1. divCoeff="990". rawQ="990".
       // finalCoeffStr="990". decisionIndex=2 ('0'). staticRound("990",2) -> "99".
       // result.limbs="99". exp = (-2-0)-0 = -2. So "0.99". Incorrect. Should be "1".

       // The coefficient returned by _staticRound_cpu is the coefficient of the number *after* being scaled to currentDP.
       // If X is the true result, roundedCoeffStr is X * 10^currentDP.
       // So, its exponent is -currentDP.
       // The exponent from division of original numbers is added to this.
       result.exponent = (absDividend.exponent - absDivisor.exponent) - currentDP;
       // If rounding "9.5" (coeff "95" exp-1) to 0DP. currentDP=0.
       // scaled dividend: "950". rawquotient="950". finalcoeffstr="950".
       // decision index in "950" for 0DP (based on 1st dec of 95.0) is index 2 ('0').
       // _staticRound_cpu("950", 2, ...) -> "95". roundedCoeffStr = "95".
       // result exp = (-1 - 0) - 0 = -1.  Result is "9.5". Still not "10".

       // The issue is that _staticRound_cpu needs to operate on a string that *directly represents* the digits
       // around the rounding point, and its output needs to be understood in context.
       // Let N be the unrounded quotient. N = I.F where I is integer part, F is fractional.
       // We want to round N to `currentDP` places.
       // `finalCoeffStr` represents N * 10^requiredScaleFactor.
       // `roundedCoeffStr` (output of _staticRound_cpu) is `finalCoeffStr` truncated at `decisionIndex` and then potentially incremented.
       // `decisionIndex` is the position of the (currentDP+1)th fractional digit of N, *within finalCoeffStr*.
       // So `roundedCoeffStr` contains the integer part of N and `currentDP` fractional digits of N, correctly rounded.
       // Number of digits in roundedCoeffStr = (original_integer_digits_in_N) + currentDP.
       // The exponent must be -(number of fractional digits in roundedCoeffStr), which is -currentDP.
       // This is then shifted by the original exponent difference.
       // result.exponent = (absDividend.exponent - absDivisor.exponent) - currentDP; // This seems right for the value represented by roundedCoeffStr
    } else { // rawQuotientCoeff was "0"
        roundedCoeffStr = "0";
        result.exponent = (absDividend.exponent - absDivisor.exponent) - currentDP; // Or just 0 if result is 0
    }


    result.limbs = Ctor.fromCoefficientString(roundedCoeffStr, this.canvas, {forceCPU:true}).limbs;
    if (result.isZero()) { result.exponent = 0; result.sign = 1; } // Normalize zero
    else {
      // Adjust exponent if rounding changed the number of digits before decimal point.
      // e.g. 0.99 rounded to 0dp = 1. roundedCoeffStr="1". expected int digits = 0.
      // original effective integer part of finalCoeffStr: finalCoeffStr.length - requiredScaleFactor
      // new effective integer part of roundedCoeffStr: roundedCoeffStr.length - currentDP
      let originalIntDigits = finalCoeffStr.length - requiredScaleFactor;
      if (originalIntDigits < 0) originalIntDigits = 0; // Cannot have negative length
      let newIntDigits = roundedCoeffStr.length - currentDP;
      if (newIntDigits < 0) newIntDigits = 0;

      if (newIntDigits > originalIntDigits) {
        result.exponent += (newIntDigits - originalIntDigits);
      }
    }
    result._roundedDp = currentDP;

    return result;
  }

  divideAndRemainder(divisor) {
    if (!(divisor instanceof BigIntPrimitive)) divisor = new BigIntPrimitive(divisor.toString(), this.canvas, { forceCPU: true });
    if (divisor.isZero()) throw new Error("[big.js] Division by zero");
    if (this.isZero()) return { quotient: new BigIntPrimitive("0", this.canvas, {forceCPU:true}), remainder: new BigIntPrimitive("0", this.canvas, {forceCPU:true}) };

    // Determine sign for quotient and remainder
    const quotientSign = this.sign * divisor.sign;
    const remainderSign = this.sign; // Remainder's sign typically matches dividend's

    const absDividend = this.abs();
    const absDivisor = divisor.abs();

    // Align exponents for integer division (remainder makes sense for integer-like division)
    // The goal is to divide A by B. A = a * 10^a_exp, B = b * 10^b_exp
    // We want Q, R such that A = Q*B + R, where 0 <= |R| < |B|
    // Let's work with coefficients 'a' and 'b' and common exponent.
    // commonExponent will be the exponent of the remainder.
    const commonExponent = Math.min(absDividend.exponent, absDivisor.exponent);

    let dividendCoeffStr = absDividend._getCoefficientString();
    if (absDividend.exponent - commonExponent > 0) {
      dividendCoeffStr += '0'.repeat(absDividend.exponent - commonExponent);
    }
    // The effective exponent of dividendCoeffStr is now commonExponent.
    // We might need to scale it further if its original exponent was smaller.
    else if (absDividend.exponent - commonExponent < 0) {
        // This case means absDividend.exponent < commonExponent, which should not happen due to Math.min, unless one is 0.
        // Actually, this means the original number needs to be scaled *up* to match commonExponent if its string form is too short.
        // e.g. 123 (exp 0) / 0.45 (exp -2). commonExp = -2. dividendCoeffStr "123" needs to become "12300" (for exp -2)
         dividendCoeffStr += '0'.repeat(commonExponent - absDividend.exponent); // This seems wrong.

        // Let's rethink alignment for A/B = Q + R/B
        // A = this, B = divisor.
        // Target: A_aligned / B_aligned = Q_coeff. R_coeff has exponent of B_aligned.
        // The quotient's exponent will be A.exponent - B.exponent (approximately for now).
        // The remainder's exponent must be that of B (or the common aligned exponent).
    }

    const alignedDividend = BigIntPrimitive.fromCoefficientString(dividendCoeffStr, this.canvas, {forceCPU:true});
    // alignedDividend.exponent is 0. Its value is absDividend.coeff * 10^(absDividend.exponent - commonExponent)

    let divisorCoeffStr = absDivisor._getCoefficientString();
    if (absDivisor.exponent - commonExponent > 0) {
      divisorCoeffStr += '0'.repeat(absDivisor.exponent - commonExponent);
    }
    const alignedDivisor = BigIntPrimitive.fromCoefficientString(divisorCoeffStr, this.canvas, {forceCPU:true});
    // alignedDivisor.exponent is 0. Its value is absDivisor.coeff * 10^(absDivisor.exponent - commonExponent)

    // Now we are dividing (absDividend_val / 10^commonExp) by (absDivisor_val / 10^commonExp) effectively.
    // Or, more simply, make their exponents equal by scaling the coefficient of the one with larger exponent.
    // Let X = this, Y = divisor.
    // X = x_c * 10^x_e, Y = y_c * 10^y_e.
    // If x_e > y_e, scale x_c by 10^(x_e - y_e). New x_e' = y_e.
    // If y_e > x_e, scale y_c by 10^(y_e - x_e). New y_e' = x_e.
    // Then divide coefficients. Remainder gets the common exponent. Quotient exponent is 0 from this step.

    let finalDivisor = absDivisor;
    let finalDividend = absDividend;

    if (absDividend.exponent > absDivisor.exponent) {
        const scale = absDividend.exponent - absDivisor.exponent;
        const scaledCoeff = absDividend._getCoefficientString() + '0'.repeat(scale);
        finalDividend = BigIntPrimitive.fromCoefficientString(scaledCoeff, this.canvas, {forceCPU:true});
        finalDividend.exponent = absDivisor.exponent; // now exponents match
    } else if (absDivisor.exponent > absDividend.exponent) {
        const scale = absDivisor.exponent - absDividend.exponent;
        const scaledCoeff = absDivisor._getCoefficientString() + '0'.repeat(scale);
        finalDivisor = BigIntPrimitive.fromCoefficientString(scaledCoeff, this.canvas, {forceCPU:true});
        finalDivisor.exponent = absDividend.exponent; // now exponents match
    }
    // Now finalDividend and finalDivisor have the same exponent. Let this be E_common.
    // We are dividing (D_coeff * 10^E_common) by (d_coeff * 10^E_common).
    // Result of _longDivide_cpu(D_coeff, d_coeff) is Q_coeff, R_coeff (both exp 0).
    // True Quotient = Q_coeff (its exponent is 0 relative to this scale).
    // True Remainder = R_coeff * 10^E_common.

    const { quotient: q_coeff, remainder: r_coeff } = this._longDivide_cpu(
        BigIntPrimitive.fromCoefficientString(finalDividend._getCoefficientString(), this.canvas, {forceCPU:true} ),
        BigIntPrimitive.fromCoefficientString(finalDivisor._getCoefficientString(), this.canvas, {forceCPU:true})
    );

    q_coeff.sign = quotientSign;
    if (q_coeff.isZero()) q_coeff.sign = 1;
    // The quotient from _longDivide_cpu is based on coefficients. Its exponent is 0.
    // The actual exponent of the quotient is original_this.exponent - original_divisor.exponent,
    // but since we aligned them, the quotient of aligned values has effective exponent 0 *relative to that alignment*.
    // The true quotient's value is Q_coeff. Its exponent should be 0 if we consider it as an integer quotient.
    // Or, this.exponent - finalDivisor.exponent (which is this.exponent - common_exponent_after_scaling)
    q_coeff.exponent = this.exponent - finalDivisor.exponent;


    r_coeff.sign = remainderSign;
    if (r_coeff.isZero()) r_coeff.sign = 1;
    r_coeff.exponent = finalDivisor.exponent; // Remainder takes the exponent of the (scaled) divisor

    return { quotient: q_coeff, remainder: r_coeff };
  }

  _staticRound_cpu(coeffStr, decisionIndex, rm, isNegative) {
    // coeffStr: The full coefficient string.
    // decisionIndex: The 0-indexed position of the digit that *determines* rounding.
    //                The function will effectively truncate coeffStr before this decisionIndex,
    //                then potentially increment based on the digit at decisionIndex.
    // rm: Rounding mode.
    // isNegative: Sign of the number, for modes like roundHalfEven or roundUp for negatives.

    const Ctor = this.constructor;

    if (decisionIndex < 0) {
        if (decisionIndex === -1) {
            const onlyDigit = parseInt(coeffStr[0] || "0", 10);
            if (rm === Ctor.roundDown) return "0";
            if (rm === Ctor.roundHalfUp && onlyDigit >= 5) return "1";
            if (rm === Ctor.roundHalfEven && onlyDigit >= 5) {
                return (onlyDigit === 5 && !isNegative) ? "0" : (onlyDigit > 5 ? "1" : "0");
            }
            if (rm === Ctor.roundUp && onlyDigit > 0 && !isNegative) return "1";
            // For negative numbers, roundUp towards zero means if onlyDigit > 0, it becomes "0".
            // If onlyDigit is 0, it's "0".
            if (rm === Ctor.roundUp && onlyDigit > 0 && isNegative) return "0";
            return "0";
        }
        return "0";
    }

    if (decisionIndex >= coeffStr.length) {
        return coeffStr;
    }

    const roundingDigit = parseInt(coeffStr[decisionIndex], 10);
    let resultCoeffStr = coeffStr.substring(0, decisionIndex);

    if (resultCoeffStr === "" && decisionIndex === 0) {
        resultCoeffStr = "0";
    }

    if (rm === Ctor.roundDown) {
        if (resultCoeffStr === "") return "0";
    } else if (rm === Ctor.roundHalfUp) {
        if (roundingDigit >= 5) {
            resultCoeffStr = incrementStringCoeff(resultCoeffStr);
        }
    } else if (rm === Ctor.roundHalfEven) {
        if (roundingDigit > 5) {
            resultCoeffStr = incrementStringCoeff(resultCoeffStr);
        } else if (roundingDigit === 5) {
            let exactHalf = true;
            for(let k = decisionIndex + 1; k < coeffStr.length; k++) {
                if (coeffStr[k] !== '0') {
                    exactHalf = false;
                    break;
                }
            }
            if (!exactHalf) {
                 resultCoeffStr = incrementStringCoeff(resultCoeffStr);
            } else {
                const prevDigit = resultCoeffStr.length > 0 ? parseInt(resultCoeffStr[resultCoeffStr.length - 1], 10) : 0;
                if (prevDigit % 2 !== 0) {
                    resultCoeffStr = incrementStringCoeff(resultCoeffStr);
                }
            }
        }
    } else if (rm === Ctor.roundUp) {
        let hasFractionalPart = false;
        for(let k=decisionIndex; k < coeffStr.length; k++) {
            if (coeffStr[k] !== '0') {
                hasFractionalPart = true;
                break;
            }
        }
        if (hasFractionalPart && !isNegative) {
            resultCoeffStr = incrementStringCoeff(resultCoeffStr);
        }
        // if isNegative and hasFractionalPart, roundUp means truncate (towards zero)
    }

    if (resultCoeffStr === "" && decisionIndex > 0) return "0";
    if (resultCoeffStr === "" && decisionIndex === 0) return "0";

    return resultCoeffStr;
  }

  divideAndRemainder(divisor) { console.warn("divideAndRemainder not fully implemented"); return { quotient: new BigIntPrimitive("0"), remainder: new BigIntPrimitive("0") }; }
  divide(divisor) { console.warn("divide not fully implemented"); return new BigIntPrimitive("0"); }
  remainder(divisor) { console.warn("remainder not fully implemented"); return new BigIntPrimitive("0"); }

  static _staticRound(limbs, exp, sign, dp, rm) {
    // This is the original big.js stub. We are using _staticRound_cpu for CPU path.
    console.warn("_staticRound (original stub) not fully implemented, CPU path uses _staticRound_cpu");
    return { limbs: [0], exponent: 0, sign: 1 };
  }

  round(dp, rm) {
    if (dp === undefined) dp = 0; else if (typeof dp !== 'number' || !Number.isInteger(dp) || dp < 0) throw Error("Decimal places NaN or negative");
    if (rm === undefined) rm = this.constructor.RM; else if (rm !== 0 && rm !== 1 && rm !== 2 && rm !== 3) throw Error("Rounding mode NaN");

    if (this.isZero()) {
        const zero = new BigIntPrimitive("0", this.canvas, {forceCPU: this.forceCPU});
        zero._roundedDp = dp; // For toString representation like "0.00"
        return zero;
    }

    let coeffStr = this._getCoefficientString();
    const originalExponent = this.exponent;
    const originalCoeffLength = coeffStr.length;

    // Calculate the number of digits currently after the decimal point if the number was written out.
    // e.g., "123", exp 0   -> 0 decimal places.
    // e.g., "123", exp -2  -> "1.23" -> 2 decimal places.
    // e.g., "123", exp 2   -> "12300" -> 0 decimal places.
    let currentNumDecimalPlaces = -originalExponent;
    if (currentNumDecimalPlaces < 0) currentNumDecimalPlaces = 0;


    if (dp >= currentNumDecimalPlaces && originalExponent >= -(originalCoeffLength -1) /* check it's not like 0.000123 being rounded to 10 dp */) {
        // If dp is greater or equal to current decimal places, no change in value, only in string representation.
        // Additional check: originalExponent >= -(originalCoeffLength -1) ensures it's not a very small number like 0.000123 that would need padding.
        // For "123" exp 0 (123), dp=0, currentNumDecimalPlaces=0. dp >= currentNumDecimalPlaces.
        // For "123" exp -2 (1.23), dp=2, currentNumDecimalPlaces=2. dp >= currentNumDecimalPlaces.
        // For "123" exp -2 (1.23), dp=3, currentNumDecimalPlaces=2. dp >= currentNumDecimalPlaces.
        // For "123" exp -4 (0.0123), dp=4, currentNumDecimalPlaces=4. dp >= currentNumDecimalPlaces.
        // For "12300" (123exp2), dp=0, currentNumDecimalPlaces=0.

        // The condition for not changing value:
        // If rounding to dp decimal places, and the number already has `d` decimal places (d = -exponent),
        // and dp >= d, then no change in value.
        // Example: 1.2345 (exp -4). dp=4, no change. dp=5, no change (but toString will pad).
        // Example: 123 (exp 0). dp=0, no change. dp=2, no change (but toString will pad "123.00").
        if (dp >= (-originalExponent > 0 ? -originalExponent : 0) ) {
            const result = new BigIntPrimitive(this);
            result._roundedDp = dp;
            return result;
        }
    }

    // Determine the decision index for _staticRound_cpu.
    // This is the index in coeffStr of the (dp+1)th digit after the decimal point.
    // Length of integer part = originalCoeffLength + originalExponent (if exp is negative or zero and fits)
    // or originalCoeffLength (if exp is positive, meaning integer part is just coeffStr).
    let integerPartLength;
    if (originalExponent >= 0) { // e.g., 123, 12300
        integerPartLength = originalCoeffLength + originalExponent;
    } else { // e.g., 1.23, 0.123, 0.00123
        integerPartLength = originalCoeffLength + originalExponent; // If positive, this is the length. If negative (0.00123), it's <0.
        if (integerPartLength < 0) integerPartLength = 0; // For numbers like 0.xxx, integer part length is 0 for this calculation.
    }

    const decisionIndex = integerPartLength + dp;
    let roundedCoeffStr;

    if (decisionIndex < 0) {
        // Rounding occurs to the left of the most significant digit of the coefficient (e.g. rounding 0.123 to dp=-1)
        // Prepend "0"s to align for _staticRound_cpu. decisionIndex for _staticRound_cpu will be dp + (-decisionIndex)
        // e.g., 0.123 (coeff "123", exp -3). dp = -1. decisionIndex = (3-3)+(-1) = -1.
        // We want to round "0.123" based on the digit '0' (at 10^0 place). _staticRound_cpu needs "0123", decision at dp for that.
        // _staticRound_cpu needs (coeff, decisionIdxForCoeff)
        // The decision is based on the digit at position corresponding to 10^(-dp-1)
        // For 0.123, dp=-1. Rounding to nearest 10. Decision digit is '0' (units place).
        // _staticRound_cpu("0", 0, rm, this.sign < 0) if value < 1 and rounding to integer or larger.
        // If coeffStr="123", exp=-3 (0.123). dp=0 (units). decisionIndex = 0. _staticRound_cpu("123", 0, ...)
        // If coeffStr="123", exp=-3 (0.123). dp=-1 (tens). decisionIndex = -1.
        // This means we are looking at the digit that would be coeffStr[ -1 - originalExponent ]
        // Let's simplify: if decisionIndex < 0, it means we are rounding to an integer place for a number < 1 or rounding an integer.
        // e.g. "0.123" dp=0. decisionIndex=0. _staticRound_cpu("123", 0, ...) gives "0" or "1". exp will be 0.
        // e.g. "0.678" dp=0. decisionIndex=0. _staticRound_cpu("678", 0, ...) gives "1". exp will be 0.
        // e.g. "0.012" dp=-1. decisionIndex=-1. Result is "0", exp 1 or 0.
        // This path is complex. _staticRound_cpu expects a positive decisionIndex relative to start of coeffStr.
        // If decisionIndex is < 0, it implies the rounding point is to the left of the coefficient.
        // For "123" exp -5 (0.00123), dp = 1 (0.0). decisionIndex = (3-5)+1 = -1.
        // It means result is "0.0". RoundedCoeff is "0", exp is -1.
        // If dp=2 (0.00), decisionIndex = (3-5)+2 = 0. _staticRound_cpu("123", 0) -> "0". Result "0.00". exp -2.
        // If dp=3 (0.001), decisionIndex = (3-5)+3 = 1. _staticRound_cpu("123",1) -> "1". Result "0.001". exp -3.

        // If rounding results in 0 (e.g. 0.0123 to dp=1), coeff "0", exp -1.
        // Consider the number scaled to be an integer + fraction where fraction starts at decisionIndex
        let tempCoeff = coeffStr;
        let tempDecisionIndex = decisionIndex;
        if (integerPartLength <= 0 && dp < (-originalExponent)) { // e.g. 0.0123, dp=1. intPartLen=0. effDec=-(-5)=5.
            // tempCoeff = "0".repeat(-integerPartLength) + coeffStr if integerPartLength was negative.
            // We are rounding a number like 0.00XXX to dp places.
            // decisionIndex = dp - (-originalExponent) = dp + originalExponent.
            // Example: 0.0123 (coeff "123", exp -5). dp=3. decisionIndex = 3-5 = -2.
            // This means the 3rd decimal place is to the left of "123".
            // "0.012" - the decision digit is '2'.
            // decisionIndex in coeffStr = dp + originalExponent + (originalCoeffLength -1) ??? No.
            // decisionIndex in coeffStr = dp - (-originalExponent) + (originalCoeffLength-1) ???
            // Integer part of "0.0123" is "0". Exponent is -2. Coeff is "123".
            // Let's use the definition: decisionIndex = position of (dp+1)th decimal digit.
            // (dp+1)th decimal digit is at coeffStr[ (dp+1) - (-originalExponent) -1 ]
            // = coeffStr[ dp + originalExponent ]
            tempDecisionIndex = dp + originalExponent; // This is the index in coeffStr that corresponds to the (dp+1)th decimal place.
            if (tempDecisionIndex < 0) { // rounding to the left of the coefficient string.
                 roundedCoeffStr = this._staticRound_cpu("0", 0, rm, this.sign < 0); // Effectively rounding 0.X based on 0.
            } else {
                 roundedCoeffStr = this._staticRound_cpu(coeffStr, tempDecisionIndex, rm, this.sign<0);
            }
        } else {
             roundedCoeffStr = this._staticRound_cpu(coeffStr, decisionIndex, rm, this.sign < 0);
        }

    } else {
       roundedCoeffStr = this._staticRound_cpu(coeffStr, decisionIndex, rm, this.sign < 0);
    }

    let finalExponent = -dp; // The rounded coefficient string corresponds to a number with 'dp' decimal places.

    // Adjust exponent if rounding changed the integer part's length
    // e.g. "9.5" (coeff "95", exp -1) rounded to 0dp (dp=0)
    // decisionIndex = (2-1)+0 = 1. _staticRound_cpu("95", 1) -> "10"
    // roundedCoeffStr = "10". Original integer part "9" (len 1). New "10" (len 2).
    // finalExponent should be 0. -dp is 0. This seems ok.
    // e.g. "0.95" (coeff "95", exp -2) rounded to 1dp (dp=1)
    // decisionIndex = (2-2)+1 = 1. _staticRound_cpu("95",1) -> "10"
    // roundedCoeffStr = "10". finalExponent = -1. This is "1.0". Correct.

    const result = new BigIntPrimitive("0", this.canvas, {forceCPU: this.forceCPU});
    if (roundedCoeffStr === "") roundedCoeffStr = "0";
    result.limbs = this.constructor.fromCoefficientString(roundedCoeffStr, this.canvas, {forceCPU:true}).limbs;
    result.sign = this.sign;
    result.exponent = finalExponent;

    if (result.isZero()) { result.sign = 1; result.exponent = 0;}
    result._roundedDp = dp;
    return result;
  }
  toExponential(dp, rm) { console.warn("toExponential not fully implemented"); return this.toString(); } // basic fallback
  toFixed(dp, rm) { console.warn("toFixed not fully implemented"); return this.toString(); } // basic fallback
  sqrt() { console.warn("sqrt not fully implemented"); return new BigIntPrimitive("0"); }
  prec(sd, rm) { console.warn("prec not fully implemented"); return new BigIntPrimitive(this); }
  toPrecision(sd, rm) { console.warn("toPrecision not fully implemented"); return this.toString(); }
}

export { BigIntPrimitive };
