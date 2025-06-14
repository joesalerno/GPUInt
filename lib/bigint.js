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
  static NE = -7; // Negative Exponent: values less than 1e-7 will be sci
  static PE = 21; // Positive Exponent: values >= 1e21 will be sci
  static DP = 20; // Default Decimal Places for division
  static RM = 1;  // Default Rounding Mode (roundHalfUp)

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
}

BigIntPrimitive.fromCoefficientString = function(coeffStr, canvas, options = {}) {
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
};

BigIntPrimitive.prototype._getCoefficientString = function() {
  if (this.isZero()) return "0"; if (this.limbs.length === 0) return "0";
  let str = this.limbs[0].toString();
  for (let i = 1; i < this.limbs.length; i++) str += this.limbs[i].toString().padStart(BASE_LOG10, '0');
  return str;
};

BigIntPrimitive.prototype.negate = function() { const n = new BigIntPrimitive(this, this.canvas, {forceCPU:this.forceCPU}); if(!n.isZero()) n.sign *= -1; return n;};
BigIntPrimitive.prototype.abs = function() { const n = new BigIntPrimitive(this, this.canvas, {forceCPU:this.forceCPU}); n.sign = 1; return n;};
BigIntPrimitive.prototype.isPositive = function() { return this.sign === 1 && !this.isZero(); };
BigIntPrimitive.prototype.isNegative = function() { return this.sign === -1 && !this.isZero(); };

BigIntPrimitive.prototype.compareMagnitude = function(other) {
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
  for (let i=0; i < thisCoeff.limbs.length; i++) { if (thisCoeff.limbs[i] > otherCoeff.limbs[i]) return 1; if (thisCoeff.limbs[i] < otherCoeff.limbs[i]) return -1; }
  return 0;
};

BigIntPrimitive.prototype.cmp = function(other) {
  if (!(other instanceof BigIntPrimitive)) other = new BigIntPrimitive(other.toString(), this.canvas, {forceCPU:true});
  if (this.isZero() && other.isZero()) return 0;
  if (this.sign !== other.sign) return this.sign > other.sign ? 1 : -1;
  const magRes = this.compareMagnitude(other);
  return this.sign === 1 ? magRes : -magRes;
};

BigIntPrimitive.prototype.eq = function(o){return this.cmp(o)===0;};
BigIntPrimitive.prototype.gt = function(o){return this.cmp(o)>0;};
BigIntPrimitive.prototype.gte = function(o){return this.cmp(o)>=0;};
BigIntPrimitive.prototype.lt = function(o){return this.cmp(o)<0;};
BigIntPrimitive.prototype.lte = function(o){return this.cmp(o)<=0;};
BigIntPrimitive.prototype.plus = function(n){return this.add(n);};
BigIntPrimitive.prototype.minus = function(n){return this.subtract(n);};
BigIntPrimitive.prototype.times = function(n){return this.multiply(n);};
BigIntPrimitive.prototype.div = function(n){return this.divide(n);};
BigIntPrimitive.prototype.mod = function(n){return this.remainder(n);};
BigIntPrimitive.prototype.neg = function(){return this.negate();};

BigIntPrimitive.prototype.toString = function() {
  if (this.isZero()) {
    if (typeof this._roundedDp === 'number' && this._roundedDp > 0) {
      return '0.' + '0'.repeat(this._roundedDp);
    }
    return "0";
  }
  let s = "", c = this._getCoefficientString(), e = this.exponent, l = c.length, p = l + e;
  if ((typeof this._roundedDp !== 'number') && (p <= BigIntPrimitive.NE || p > BigIntPrimitive.PE)) {
    s = c[0] + (l > 1 ? '.' + c.substring(1) : '') + 'e' + (p - 1 >= 0 ? '+' : '') + (p - 1);
    if (s.includes('.')) s = s.replace(/\.0+e/, 'e').replace(/(\.[0-9]*[1-9])0+e/, '$1e');
  } else {
    if (e < 0) { s = (p > 0 ? c.substring(0, p) : '0') + '.' + (p > 0 ? c.substring(p) : '0'.repeat(-p) + c); }
    else { s = c + '0'.repeat(e); }
    if (typeof this._roundedDp === 'number') {
      let [iP, fP = ''] = s.split('.');
      if (this._roundedDp > 0) {
        fP = fP.padEnd(this._roundedDp, '0');
        fP = fP.substring(0, this._roundedDp);
        fP = fP.replace(/0+$/, "");
        if (fP.length > 0) s = iP + '.' + fP; else s = iP;
      } else s = iP;
    } else if (s.includes('.')) { s = s.replace(/\.?0+$/, ''); if(s.startsWith('.')) s = '0' + s; }
  }
  if (this.sign === -1 && !this.isZero() && !(s === "0" || (s.startsWith("0.") && parseFloat(s) === 0))) return "-" + s;
  return s;
};

BigIntPrimitive.prototype.isZero = function() { return this.limbs.length === 1 && this.limbs[0] === 0; };

BigIntPrimitive.prototype._core_add = function(other) {
    let rL = [], c = 0, tL = [...this.limbs].reverse(), oL = [...other.limbs].reverse();
    const maxL = Math.max(tL.length, oL.length);
    for(let i=0; i < maxL; i++) { let s = (tL[i]||0)+(oL[i]||0)+c; rL.push(s%BASE); c=Math.floor(s/BASE); }
    if(c) rL.push(c);
    let fL = rL.reverse(); while(fL.length>1 && fL[0]===0) fL.shift(); if(fL.length===0)fL=[0];
    const res = new BigIntPrimitive("0",this.canvas,{forceCPU:true}); res.limbs=fL; res.sign=1; res.exponent=0; if(res.isZero())res.exponent=0; return res;
};

BigIntPrimitive.prototype.add = function(other) {
  if(!(other instanceof BigIntPrimitive)) other=new BigIntPrimitive(other.toString(),this.canvas,{forceCPU:true});
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
};

BigIntPrimitive.prototype._core_subtract = function(other) {
    let rL = [], b = 0, tL=[...this.limbs].reverse(), oL=[...other.limbs].reverse();
    const maxL=Math.max(tL.length,oL.length);
    for(let i=0;i<maxL;i++){ let d=(tL[i]||0)-b-(oL[i]||0); if(d<0){d+=BASE;b=1;}else b=0; rL.push(d); }
    let fL=rL.reverse(); while(fL.length>1 && fL[0]===0)fL.shift(); if(fL.length===0)fL=[0];
    const res=new BigIntPrimitive("0",this.canvas,{forceCPU:true}); res.limbs=fL; res.sign=1; res.exponent=0; if(res.isZero())res.exponent=0; return res;
};

BigIntPrimitive.prototype.subtract = function(other) {
  if(!(other instanceof BigIntPrimitive)) other=new BigIntPrimitive(other.toString(),this.canvas,{forceCPU:true});
  if (this.sign !== other.sign) { const termToAdd = other.negate(); termToAdd.forceCPU = this.forceCPU || other.forceCPU; return this.add(termToAdd); }
  const comparison = this.compareMagnitude(other);
  if (comparison === 0) return new BigIntPrimitive("0", this.canvas, { forceCPU: true });
  const commonExponent = Math.min(this.exponent, other.exponent);
  let actualMinuend, actualSubtrahend, resultSign;
  if (comparison > 0) { actualMinuend = this.abs(); actualSubtrahend = other.abs(); resultSign = this.sign; }
  else { actualMinuend = other.abs(); actualSubtrahend = this.abs(); resultSign = -this.sign; }
  let minuendCoeffStr = actualMinuend._getCoefficientString();
  if (actualMinuend.exponent - commonExponent > 0) minuendCoeffStr += '0'.repeat(actualMinuend.exponent - commonExponent);
  const alignedMinuendCoeff = BigIntPrimitive.fromCoefficientString(minuendCoeffStr, this.canvas, { forceCPU: true });
  let subtrahendCoeffStr = actualSubtrahend._getCoefficientString();
  if (actualSubtrahend.exponent - commonExponent > 0) subtrahendCoeffStr += '0'.repeat(actualSubtrahend.exponent - commonExponent);
  const alignedSubtrahendCoeff = BigIntPrimitive.fromCoefficientString(subtrahendCoeffStr, this.canvas, { forceCPU: true });
  const finalResult = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
  const coreRes = alignedMinuendCoeff._core_subtract(alignedSubtrahendCoeff);
  finalResult.limbs = coreRes.limbs; finalResult.sign = resultSign; finalResult.exponent = commonExponent;
  if (finalResult.isZero()) { finalResult.sign = 1; finalResult.exponent = 0; }
  return finalResult;
};

BigIntPrimitive.prototype._multiply_limb_by_bigint = function(limb,other){
  let rL=[], c=0, oLR=[...other.limbs].reverse();
  for(let i=0;i<oLR.length;i++){ const p=oLR[i]*limb+c; rL.push(p%BASE); c=Math.floor(p/BASE); }
  while(c>0){rL.push(c%BASE); c=Math.floor(c/BASE);}
  let fL=rL.reverse(); if(fL.length===0)fL=[0]; while(fL.length>1&&fL[0]===0)fL.shift();
  const res=new BigIntPrimitive("0",this.canvas,{forceCPU:true}); res.limbs=fL; res.sign=1; res.exponent=0; return res;
};

BigIntPrimitive.prototype._core_multiply = function(num1,num2){
  if(num1.isZero()||num2.isZero())return new BigIntPrimitive("0",this.canvas,{forceCPU:true});
  let tR=new BigIntPrimitive("0",this.canvas,{forceCPU:true});
  const n1LR=[...num1.limbs].reverse();
  for(let i=0;i<n1LR.length;i++){
    const d1=n1LR[i];
    if(d1===0 && n1LR.length > 1 && num1.limbs.length > 1) continue;
    let pPM=this._multiply_limb_by_bigint(d1,num2);
    if(pPM.isZero() && (i > 0 || !tR.isZero())) continue;
    const sPP_temp_exp = new BigIntPrimitive(pPM,this.canvas,{forceCPU:true});
    sPP_temp_exp.exponent = i*BASE_LOG10;
    if (tR.isZero()) {
      let sPPCoeffStr = sPP_temp_exp._getCoefficientString();
      if (sPP_temp_exp.exponent > 0 && sPPCoeffStr !== "0") sPPCoeffStr += '0'.repeat(sPP_temp_exp.exponent);
      tR = BigIntPrimitive.fromCoefficientString(sPPCoeffStr, this.canvas, {forceCPU:true});
    } else tR = tR.add(sPP_temp_exp);
  }
  if(tR.isZero()){tR.sign=1;tR.exponent=0;}
  else { while(tR.limbs.length>1 && tR.limbs[0]===0) tR.limbs.shift(); if(tR.limbs.length===0) { tR.limbs=[0]; tR.exponent=0; } }
  tR.sign=1; if (!tR.isZero()) tR.exponent = 0; return tR;
};

BigIntPrimitive.prototype.multiply = function(other) {
  const self = this;
  if (!(other instanceof BigIntPrimitive)) other = new BigIntPrimitive(other.toString(), this.canvas, { forceCPU: true });
  if (self.isZero() || other.isZero()) return new BigIntPrimitive("0", self.canvas, { forceCPU: self.forceCPU || other.forceCPU });
  let absRes; let glInstance = null;
  const useWebGL = !self.forceCPU && !other.forceCPU && self.canvas && typeof webglUtilsModule !== 'undefined' && (glInstance = webglUtilsModule.initWebGL(self.canvas));
  let webGLAttemptedAndSucceeded = false;
  if (useWebGL) {
    let currentWebGLFailed = false;
    const n1Abs = self.abs(); const n2Abs = other.abs();
    const n1Exp = n1Abs.exponent > 0 ? n1Abs.exponent : 0; const n2Exp = n2Abs.exponent > 0 ? n2Abs.exponent : 0;
    const n1Coeff = BigIntPrimitive.fromCoefficientString(n1Abs._getCoefficientString() + '0'.repeat(n1Exp), self.canvas, { forceCPU: true });
    const n2Coeff = BigIntPrimitive.fromCoefficientString(n2Abs._getCoefficientString() + '0'.repeat(n2Exp), self.canvas, { forceCPU: true });
    let accRes = new BigIntPrimitive("0", self.canvas, { forceCPU: true });
    const n1LR = [...n1Coeff.limbs].reverse();
    for (let i = 0; i < n1LR.length; i++) {
      const cNL = n1LR[i];
      if (cNL === 0 && n1LR.length > 1) continue;
      const pP = self._webgl_multiply_one_limb_by_bigint(cNL, n2Coeff, glInstance);
      if (!pP) { currentWebGLFailed = true; break; }
      pP.exponent += i * BASE_LOG10; accRes = accRes.add(pP);
    }
    if (!currentWebGLFailed) { absRes = accRes; webGLAttemptedAndSucceeded = true; }
  }
  if (!webGLAttemptedAndSucceeded) {
    const sAbsExp = self.abs().exponent > 0 ? self.abs().exponent : 0;
    const oAbsExp = other.abs().exponent > 0 ? other.abs().exponent : 0;
    const t1AbsC = BigIntPrimitive.fromCoefficientString(self.abs()._getCoefficientString() + '0'.repeat(sAbsExp), self.canvas, { forceCPU: true });
    const t2AbsC = BigIntPrimitive.fromCoefficientString(other.abs()._getCoefficientString() + '0'.repeat(oAbsExp), self.canvas, { forceCPU: true });
    if (t1AbsC.limbs.length < KARATSUBA_THRESHOLD || t2AbsC.limbs.length < KARATSUBA_THRESHOLD) {
      absRes = self._core_multiply(t1AbsC, t2AbsC);
    } else {
      const n = Math.max(t1AbsC.limbs.length, t2AbsC.limbs.length); const m = Math.floor(n / 2);
      if (m === 0) absRes = self._core_multiply(t1AbsC, t2AbsC);
      else {
        const { low: b, high: a } = t1AbsC._splitAtForKaratsuba(m); const { low: d, high: c } = t2AbsC._splitAtForKaratsuba(m);
        const cO = { forceCPU: true }; const p0 = a.multiply(c, cO); const p1 = b.multiply(d, cO);
        const sAB = a.add(b); const sCD = c.add(d); const p2t = sAB.multiply(sCD, cO);
        const p0p1 = p0.add(p1); const p2 = p2t.subtract(p0p1);
        const p0s = p0._multiplyByPowerOfBase(2 * m); const p2s = p2._multiplyByPowerOfBase(m);
        absRes = p0s.add(p2s).add(p1);
      }
    }
  }
  absRes.exponent = self.exponent + other.exponent;
  absRes.sign = (self.sign === other.sign) ? 1 : -1;
  if (absRes.isZero()) { absRes.sign = 1; absRes.exponent = 0; }
  return absRes;
};

BigIntPrimitive.prototype._splitAtForKaratsuba = function(m){
  const cO={forceCPU:true}; const C=BigIntPrimitive; const l=this.limbs; const len=l.length; let hL,lL;
  if(m<=0){hL=[...l];lL=[0];} else if(m>=len){lL=[...l];hL=[0];} else{hL=l.slice(0,len-m);lL=l.slice(len-m);}
  const h=new C("0",this.canvas,cO); h.limbs=hL.length>0?hL:[0]; if(h.isZero())h.exponent=0;
  const lo=new C("0",this.canvas,cO); lo.limbs=lL.length>0?lL:[0]; if(lo.isZero())lo.exponent=0;
  return{low:lo,high:h};
};

BigIntPrimitive.prototype.pow = function(exp){
  if(typeof exp!=='number'||!Number.isInteger(exp)||exp<0||exp>1e6)throw Error("Exponent error");
  const cO={forceCPU:this.forceCPU}; if(exp===0)return new BigIntPrimitive("1",this.canvas,cO);
  if(this.isZero())return new BigIntPrimitive(this,this.canvas,cO);
  if(this.limbs.length===1&&this.limbs[0]===1&&this.exponent===0)return this.sign===1?new BigIntPrimitive(this,this.canvas,cO):(exp%2===0?new BigIntPrimitive("1",this.canvas,cO):new BigIntPrimitive(this,this.canvas,cO));
  if(exp===1)return new BigIntPrimitive(this,this.canvas,cO);
  let r=new BigIntPrimitive("1",this.canvas,cO),cB=new BigIntPrimitive(this,this.canvas,cO),e=exp;
  while(e>0){if(e%2===1)r=r.multiply(cB);cB=cB.multiply(cB);e=Math.floor(e/2);} return r;
};

BigIntPrimitive.prototype._multiplyByPowerOfBase = function(p){
  const cO={forceCPU:this.forceCPU}; if(typeof p!=='number'||!Number.isInteger(p)||p<0)throw Error("Power error");
  if(this.isZero()||p===0)return new BigIntPrimitive(this,this.canvas,cO);
  const r=new BigIntPrimitive(this,this.canvas,cO); r.exponent+=p*BASE_LOG10; return r;
};

BigIntPrimitive.prototype._webgl_multiply_one_limb_by_bigint = function(limb,otherNum,gl){ return null; };

BigIntPrimitive.prototype._longDivide_cpu = function(dividend, divisor) {
  let currentDividendCoeff = dividend._getCoefficientString(); const divisorCoeff = divisor._getCoefficientString(); const divisorBigInt = divisor;
  if (divisorBigInt.isZero()) throw new Error("[big.js] Division by zero");
  if (dividend.isZero()) return { quotient: new BigIntPrimitive("0", this.canvas, {forceCPU: true}), remainder: new BigIntPrimitive("0", this.canvas, {forceCPU: true}) };
  if (dividend.compareMagnitude(divisorBigInt) < 0) return { quotient: new BigIntPrimitive("0", this.canvas, {forceCPU: true}), remainder: new BigIntPrimitive(dividend, this.canvas, {forceCPU: true}) };
  let quotientStr = ""; let partStr = "";
  for (let i = 0; i < currentDividendCoeff.length; i++) {
    partStr += currentDividendCoeff[i];
    if (partStr.length < divisorCoeff.length && i < currentDividendCoeff.length -1) { if (quotientStr.length > 0) quotientStr += "0"; continue; }
    let partBigInt = BigIntPrimitive.fromCoefficientString(partStr, this.canvas, {forceCPU: true});
    if (partBigInt.compareMagnitude(divisorBigInt) < 0) { if (quotientStr.length > 0) quotientStr += "0"; if (partStr === "0") partStr = ""; continue; }
    let qDigit = 0; let currentQ = 0;
    for (let k=1; k<10; k++){ let tempProd = divisorBigInt.multiply(new BigIntPrimitive(k.toString(), this.canvas, {forceCPU:true})); if(tempProd.compareMagnitude(partBigInt) <= 0) currentQ = k; else break; }
    qDigit = currentQ; quotientStr += qDigit.toString();
    let product = divisorBigInt.multiply(new BigIntPrimitive(qDigit.toString(), this.canvas, {forceCPU:true}));
    partStr = partBigInt.subtract(product)._getCoefficientString();
    if (partStr === "0") partStr = "";
  }
  quotientStr = quotientStr.replace(/^0+(?=\d)/, ''); if (quotientStr === "") quotientStr = "0";
  return { quotient: BigIntPrimitive.fromCoefficientString(quotientStr, this.canvas, {forceCPU: true}), remainder: BigIntPrimitive.fromCoefficientString(partStr === "" ? "0" : partStr, this.canvas, {forceCPU: true}) };
};

BigIntPrimitive.prototype._decimalDivide_cpu = function(absDividend, absDivisor) {
  const Ctor = this.constructor; const currentDP = Ctor.DP; const requiredScaleFactor = currentDP + 1;
  let tempDividendCoeffStr = absDividend._getCoefficientString();
  tempDividendCoeffStr += '0'.repeat(requiredScaleFactor);
  const scaledDividend = Ctor.fromCoefficientString(tempDividendCoeffStr, this.canvas, { forceCPU: true });
  const divisorCoeff = Ctor.fromCoefficientString(absDivisor._getCoefficientString(), this.canvas, {forceCPU: true});
  const { quotient: rawQuotientCoeff } = this._longDivide_cpu(scaledDividend, divisorCoeff);
  let finalQuotientCoeffStr = rawQuotientCoeff._getCoefficientString();
  const decisionIndex = finalQuotientCoeffStr.length - 1;
  let roundedCoeffStr = finalQuotientCoeffStr;
  if (finalQuotientCoeffStr.length > 0) {
      roundedCoeffStr = this._staticRound_cpu(finalQuotientCoeffStr, decisionIndex, Ctor.RM, false);
  } else roundedCoeffStr = "0";
  const result = new BigIntPrimitive("0", this.canvas, { forceCPU: true });
  result.limbs = Ctor.fromCoefficientString(roundedCoeffStr, this.canvas, {forceCPU:true}).limbs;
  result.exponent = (absDividend.exponent - absDivisor.exponent) - currentDP;
  if (result.isZero()) { result.exponent = 0; result.sign = 1; }
  result._roundedDp = currentDP;
  return result;
};

BigIntPrimitive.prototype.divideAndRemainder = function(divisor) {
  if (!(divisor instanceof BigIntPrimitive)) divisor = new BigIntPrimitive(divisor.toString(), this.canvas, { forceCPU: true });
  if (divisor.isZero()) throw new Error("[big.js] Division by zero");
  if (this.isZero()) return { quotient: new BigIntPrimitive("0", this.canvas, {forceCPU:true}), remainder: new BigIntPrimitive("0", this.canvas, {forceCPU:true}) };
  const quotientSign = this.sign * divisor.sign; const remainderSign = this.sign;
  const absDividend = this.abs(); const absDivisor = divisor.abs();
  let finalDivisor = absDivisor; let finalDividend = absDividend;
  if (absDividend.exponent > absDivisor.exponent) {
      const scale = absDividend.exponent - absDivisor.exponent;
      finalDividend = BigIntPrimitive.fromCoefficientString(absDividend._getCoefficientString() + '0'.repeat(scale), this.canvas, {forceCPU:true});
      finalDividend.exponent = absDivisor.exponent;
  } else if (absDivisor.exponent > absDividend.exponent) {
      const scale = absDivisor.exponent - absDividend.exponent;
      finalDivisor = BigIntPrimitive.fromCoefficientString(absDivisor._getCoefficientString() + '0'.repeat(scale), this.canvas, {forceCPU:true});
      finalDivisor.exponent = absDividend.exponent;
  }
  const { quotient: q_coeff, remainder: r_coeff } = this._longDivide_cpu(
      BigIntPrimitive.fromCoefficientString(finalDividend._getCoefficientString(), this.canvas, {forceCPU:true} ),
      BigIntPrimitive.fromCoefficientString(finalDivisor._getCoefficientString(), this.canvas, {forceCPU:true})
  );
  q_coeff.sign = quotientSign; if (q_coeff.isZero()) q_coeff.sign = 1;
  q_coeff.exponent = this.exponent - finalDivisor.exponent;
  r_coeff.sign = remainderSign; if (r_coeff.isZero()) r_coeff.sign = 1;
  r_coeff.exponent = finalDivisor.exponent;
  return { quotient: q_coeff, remainder: r_coeff };
};

BigIntPrimitive.prototype.divide = function(n) {
  if (!(n instanceof BigIntPrimitive)) n = new BigIntPrimitive(n.toString(), this.canvas, { forceCPU: true });
  if (n.isZero()) throw new Error('[big.js] Division by zero');
  if (this.isZero()) return new BigIntPrimitive('0', this.canvas, { forceCPU: this.forceCPU || n.forceCPU });
  const resultSign = this.sign * n.sign;
  const absThis = this.abs(); const absOther = n.abs();
  const resultFromCpu = this._decimalDivide_cpu(absThis, absOther);
  let finalResult = resultFromCpu; finalResult.sign = resultSign;
  if (finalResult.isZero()) { finalResult.sign = 1; finalResult.exponent = 0; }
  return finalResult;
};

BigIntPrimitive.prototype.remainder = function(n) {
  if (!(n instanceof BigIntPrimitive)) {
    n = new BigIntPrimitive(n.toString(), this.canvas, { forceCPU: true });
  }
  if (n.isZero()) {
    throw new Error('[big.js] Division by zero');
  }
  if (this.isZero()) {
    return new BigIntPrimitive('0', this.canvas, { forceCPU: this.forceCPU || n.forceCPU });
  }
  const original_x_sign = this.sign;
  // Calculate quotient using current global DP, then truncate.
  const quotient = this.divide(n);
  const integerPartOfQuotient = quotient.round(0, BigIntPrimitive.roundDown);

  const termToSubtract = integerPartOfQuotient.multiply(n);
  let finalRemainder = this.subtract(termToSubtract);

  if (finalRemainder.isZero()) {
    finalRemainder.sign = 1;
    finalRemainder.exponent = 0;
  } else {
    finalRemainder.sign = original_x_sign;
  }
  return finalRemainder;
};

BigIntPrimitive._staticRound = function(limbs, exp, sign, dp, rm) {
  console.warn("_staticRound (original stub) not fully implemented, CPU path uses _staticRound_cpu");
  return { limbs: [0], exponent: 0, sign: 1 };
};

BigIntPrimitive.prototype._staticRound_cpu = function(coeffStr, decisionIndex, rm, isNegative) {
    const Ctor = this.constructor;
    if (decisionIndex < 0) {
        if (rm === Ctor.roundDown || (rm === Ctor.roundUp && isNegative)) return "0";
        if (coeffStr !== "0" && coeffStr !== "") { // Check first digit if rounding 0.xxx
             const firstDigit = parseInt(coeffStr[0] || "0", 10);
             if (rm === Ctor.roundHalfUp && firstDigit >= 5) return "1";
             if (rm === Ctor.roundHalfEven && firstDigit >=5) {
                if (firstDigit > 5) return "1"; // 0.6 -> 1
                // Check if exactly 0.5
                let exactHalf = true;
                for(let k=1; k<coeffStr.length; k++) if(coeffStr[k] !== '0') {exactHalf=false; break;}
                if (exactHalf) return "0"; // 0.5 to nearest even is 0
                else return "1"; // 0.5... > 0.5
             }
             if (rm === Ctor.roundUp && firstDigit > 0 && !isNegative) return "1";
        }
        return "0";
    }
    if (decisionIndex >= coeffStr.length) return coeffStr;
    const roundingDigit = parseInt(coeffStr[decisionIndex], 10);
    let resultCoeffStr = coeffStr.substring(0, decisionIndex);
    if (resultCoeffStr === "" && decisionIndex === 0) resultCoeffStr = "0";
    if (rm === Ctor.roundDown) { /* no change */ }
    else if (rm === Ctor.roundHalfUp) { if (roundingDigit >= 5) resultCoeffStr = incrementStringCoeff(resultCoeffStr); }
    else if (rm === Ctor.roundHalfEven) {
        if (roundingDigit > 5) resultCoeffStr = incrementStringCoeff(resultCoeffStr);
        else if (roundingDigit === 5) {
            let exactHalf = true;
            for(let k = decisionIndex + 1; k < coeffStr.length; k++) if (coeffStr[k] !== '0') { exactHalf = false; break; }
            if (!exactHalf) resultCoeffStr = incrementStringCoeff(resultCoeffStr);
            else { const prevDigit = resultCoeffStr.length > 0 ? parseInt(resultCoeffStr[resultCoeffStr.length - 1], 10) : 0; if (prevDigit % 2 !== 0) resultCoeffStr = incrementStringCoeff(resultCoeffStr); }
        }
    } else if (rm === Ctor.roundUp) {
        let hasFractionalPart = false;
        for(let k=decisionIndex; k < coeffStr.length; k++) if (coeffStr[k] !== '0') { hasFractionalPart = true; break; }
        if (hasFractionalPart && !isNegative) resultCoeffStr = incrementStringCoeff(resultCoeffStr);
    }
    if (resultCoeffStr === "" && decisionIndex > 0) return "0";
    if (resultCoeffStr === "" && decisionIndex === 0) return "0";
    return resultCoeffStr;
};

BigIntPrimitive.prototype.round = function(dp, rm) {
  if (dp === undefined) dp = 0; else if (typeof dp !== 'number' || !Number.isInteger(dp) || dp < 0) throw Error("Decimal places NaN or negative");
  if (rm === undefined) rm = this.constructor.RM; else if (rm !== 0 && rm !== 1 && rm !== 2 && rm !== 3) throw Error("Rounding mode NaN");
  if (this.isZero()) { const zero = new BigIntPrimitive("0", this.canvas, {forceCPU: this.forceCPU}); zero._roundedDp = dp; return zero; }
  let coeffStr = this._getCoefficientString();
  const originalExponent = this.exponent; const originalCoeffLength = coeffStr.length;
  let actualDecimalPlaces = -originalExponent;
  if (actualDecimalPlaces < 0) actualDecimalPlaces = 0;
  if (dp >= actualDecimalPlaces && originalExponent >= -(originalCoeffLength -1) ) {
      const result = new BigIntPrimitive(this); result._roundedDp = dp; return result;
  }
  const effectiveIntPartLength = originalCoeffLength + originalExponent;
  const decisionIndexInCoeff = effectiveIntPartLength + dp;
  let roundedCoeffStr;

  if (decisionIndexInCoeff < 0) {
    // Rounding to a position left of the most significant digit.
    // Create a temporary coefficient string that represents the number as 0.xxxx or X.xxxx
    // where the decision is on the first digit of this temp string for rounding to integer.
    let tempShift = effectiveIntPartLength + dp; // How many places to shift coeffStr right to align dp=0 with current decision point
    let shiftedCoeffStr = coeffStr;
    if (tempShift < 0) { // Need to prepend zeros
        shiftedCoeffStr = "0".repeat(-tempShift) + coeffStr;
        tempShift = 0;
    }
    // The decision for _staticRound_cpu is on the digit that is now at index dp relative to the new shiftedCoeffStr's decimal point
    // which is index `dp` if we consider the (new) effectiveIntPartLength to be 0.
    // The decisionIndex for _staticRound_cpu should be `dp` if we were rounding `0.shiftedCoeffStr`
    // But _staticRound_cpu expects index relative to start of string.
    // Decision is at index `dp` of the fractional part.
    // The part to keep is `dp` digits of the fractional part.
    // The `decisionIndexInCoeff` is the correct index into original `coeffStr`
    // The logic for `_staticRound_cpu` when `decisionIndex < 0` handles this by rounding to "0" or "1".
    roundedCoeffStr = this._staticRound_cpu(coeffStr, decisionIndexInCoeff, rm, this.sign < 0);

  } else {
     roundedCoeffStr = this._staticRound_cpu(coeffStr, decisionIndexInCoeff, rm, this.sign < 0);
  }

  let finalExponent = -dp;

  const result = new BigIntPrimitive("0", this.canvas, {forceCPU: this.forceCPU});
  if (roundedCoeffStr === "") roundedCoeffStr = "0";
  result.limbs = this.constructor.fromCoefficientString(roundedCoeffStr, this.canvas, {forceCPU:true}).limbs;
  result.sign = (result.isZero()) ? 1 : this.sign;
  result.exponent = finalExponent;

  if (result.isZero()) { result.sign = 1; result.exponent = 0;}
  result._roundedDp = dp;
  return result;
};

BigIntPrimitive.prototype.toExponential = function(dp, rm) { console.warn("toExponential not fully implemented"); return this.toString(); };
BigIntPrimitive.prototype.toFixed = function(dp, rm) { console.warn("toFixed not fully implemented"); return this.toString(); };
BigIntPrimitive.prototype.sqrt = function() { console.warn("sqrt not fully implemented"); return new BigIntPrimitive("0"); };
BigIntPrimitive.prototype.prec = function(sd, rm) { console.warn("prec not fully implemented"); return new BigIntPrimitive(this); };
BigIntPrimitive.prototype.toPrecision = function(sd, rm) { console.warn("toPrecision not fully implemented"); return this.toString(); };

export { BigIntPrimitive };
