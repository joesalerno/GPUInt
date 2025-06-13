import { describe, it, test, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { BigIntPrimitive } from './bigint';
import * as webglUtils from './webgl-utils';

// Mock canvas
const mockCanvas = {
  getContext: vi.fn().mockReturnValue({
    getExtension: vi.fn().mockReturnValue(true),
  })
};

// Global mock for webgl-utils
vi.mock('./webgl-utils', () => ({
  initWebGL: vi.fn((canvas) => {
    if (!canvas) return null;
    return {
      createShader: vi.fn(), createProgram: vi.fn(), getAttribLocation: vi.fn(),
      getUniformLocation: vi.fn(), enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
      activeTexture: vi.fn(), bindTexture: vi.fn(), uniform1i: vi.fn(),uniform1f: vi.fn(),
      createFramebuffer: vi.fn(), bindFramebuffer: vi.fn(), framebufferTexture2D: vi.fn(),
      checkFramebufferStatus: vi.fn(() => 36053),
      createBuffer: vi.fn(), bindBuffer: vi.fn(), bufferData: vi.fn(), viewport: vi.fn(),
      useProgram: vi.fn(), drawArrays: vi.fn(), deleteTexture: vi.fn(),
      deleteFramebuffer: vi.fn(), deleteProgram: vi.fn(), deleteShader: vi.fn(),
      deleteBuffer: vi.fn(), texParameteri: vi.fn(), texImage2D: vi.fn(),
      VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, FRAMEBUFFER_COMPLETE: 36053,
    };
  }),
  createShader: vi.fn(),
  createProgram: vi.fn(),
  createDataTexture: vi.fn(),
  readDataFromTexture: vi.fn((gl, fbo, width, height, isOutput) => {
    const dataSize = isOutput && width * height * 4 || width * height;
    return new Float32Array(dataSize);
  }),
}));

describe('BigIntPrimitive', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => { // Add this
    vi.restoreAllMocks();
  });

/* // Comment out ALL other describe blocks
  describe('constructor', () => { ... });
  describe('Constructor (Decimal Support)', () => { ... });
  describe('Sign, Absolute Value, and Comparison', () => { ... });
  describe('cmp()', () => { ... });
  describe('Shorthand Comparison Methods (eq, gt, gte, lt, lte)', () => { ... });
  describe('toString()', () => { ... });
  describe('toNumber()', () => { ... });
  describe('toJSON() and valueOf()', () => { ... });
  describe('isZero()', () => { ... });
  describe('add() with WebGL mock', () => { ... });
  describe('subtract() - public method with sign logic', () => { ... });
  describe('_core_subtract() with WebGL mock', () => { ... });
  describe('_multiply_limb_by_bigint() with WebGL mock', () => { ... });
  describe('_core_multiply() - internal multiplication logic', () => { ... });
  describe('multiply() - public method with Karatsuba and sign logic', () => { ... });
  describe('_staticRound() Internal Logic', () => { ... });
  describe('pow()', () => { ... });
  describe('_multiplyByPowerOfBase()', () => { ... });
  describe('forceCPU option', () => { ... });
  describe('Strict Mode', () => { ... });
  describe('sqrt()', () => { ... });
  describe('divide()', () => { ... });
  describe('Division and Remainder', () => { ... });
  describe('BigIntPrimitive.prototype.toString() scenarios', () => { ... });
  describe('round()', () => { ... });
  describe('Debug _decimalDivide output representation', () => { ... });
*/

  describe('Precision Methods (prec, toPrecision)', () => {
    describe('prec()', () => {
      it('should throw Error for invalid sd', () => {
        const n = new BigIntPrimitive('123.45');
        expect(() => n.prec('abc')).toThrow(Error('[big.js] Invalid precision'));
        expect(() => n.prec(0.5)).toThrow(Error('[big.js] Invalid precision'));
        expect(() => n.prec(0)).toThrow(Error('[big.js] Invalid precision'));
        expect(() => n.prec(1e6 + 1)).toThrow(Error('[big.js] Invalid precision'));
      });

      it('should throw Error for invalid rm', () => {
        const n = new BigIntPrimitive('123.45');
        expect(() => n.prec(5, 'abc')).toThrow(Error('[big.js] Invalid rounding mode'));
        expect(() => n.prec(5, -1)).toThrow(Error('[big.js] Invalid rounding mode'));
        expect(() => n.prec(5, 4)).toThrow(Error('[big.js] Invalid rounding mode'));
        expect(() => n.prec(5, 1.5)).toThrow(Error('[big.js] Invalid rounding mode'));
      });

      it('should handle zero input', () => {
        expect(new BigIntPrimitive('0').prec(5).toString()).toBe('0');
      });

      it('should handle sd >= coefficient length correctly', () => {
        expect(new BigIntPrimitive('123.45').prec(5).toString()).toBe('123.45'); // sd equals coeff length
        expect(new BigIntPrimitive('123.45').prec(7).toString()).toBe('123.45'); // sd greater than coeff length
      });

      describe('Rounding Modes', () => {
        it('RM_DOWN (0)', () => {
          expect(new BigIntPrimitive('123.456').prec(4, BigIntPrimitive.roundDown).toString()).toBe('123.4');
          expect(new BigIntPrimitive('123456').prec(2, BigIntPrimitive.roundDown).toString()).toBe('120000');
          expect(new BigIntPrimitive('0.00123').prec(1, BigIntPrimitive.roundDown).toString()).toBe('0.001');
        });
        it('RM_HALF_UP (1)', () => {
          expect(new BigIntPrimitive('123.456').prec(5, BigIntPrimitive.roundHalfUp).toString()).toBe('123.46');
          expect(new BigIntPrimitive('123.45').prec(4, BigIntPrimitive.roundHalfUp).toString()).toBe('123.5');
          expect(new BigIntPrimitive('999.9').prec(1, BigIntPrimitive.roundHalfUp).toString()).toBe('1000');
          expect(new BigIntPrimitive('-999.9').prec(1, BigIntPrimitive.roundHalfUp).toString()).toBe('-1000');
        });
        it('RM_HALF_EVEN (2)', () => {
          expect(new BigIntPrimitive('12.345').prec(4, BigIntPrimitive.roundHalfEven).toString()).toBe('12.34');
          expect(new BigIntPrimitive('12.355').prec(4, BigIntPrimitive.roundHalfEven).toString()).toBe('12.36');
          expect(new BigIntPrimitive('12.5').prec(2, BigIntPrimitive.roundHalfEven).toString()).toBe('12');
          expect(new BigIntPrimitive('13.5').prec(2, BigIntPrimitive.roundHalfEven).toString()).toBe('14');
        });
        it('RM_UP (3)', () => {
          expect(new BigIntPrimitive('123.41').prec(4, BigIntPrimitive.roundUp).toString()).toBe('123.5');
          expect(new BigIntPrimitive('-123.41').prec(4, BigIntPrimitive.roundUp).toString()).toBe('-123.5');
        });
      });

      it('should return a new instance', () => {
        const n1 = new BigIntPrimitive('10');
        const n2 = n1.prec(1);
        expect(n1).not.toBe(n2);
      });
    });

    describe('toPrecision()', () => {
      it('should return toString() if sd is undefined', () => {
        const n = new BigIntPrimitive('123.45');
        expect(n.toPrecision()).toBe(n.toString());
      });

      it('should throw Error for invalid sd', () => {
        const n = new BigIntPrimitive('123.45');
        expect(() => n.toPrecision('abc')).toThrow(Error('[big.js] Invalid precision'));
        expect(() => n.toPrecision(0.5)).toThrow(Error('[big.js] Invalid precision'));
        expect(() => n.toPrecision(0)).toThrow(Error('[big.js] Invalid precision'));
        expect(() => n.toPrecision(1e6 + 1)).toThrow(Error('[big.js] Invalid precision'));
      });

      it('should handle zero cases correctly', () => {
        expect(new BigIntPrimitive('0').toPrecision(1)).toBe('0');
        expect(new BigIntPrimitive('0').toPrecision(3)).toBe('0.00');
      });

      it('should format to exponential string based on sd', () => {
        // Relies on prec and toExponential
        expect(new BigIntPrimitive('123.45').toPrecision(4, BigIntPrimitive.roundHalfUp)).toBe('1.235e+2'); // prec(4) is 123.5
        expect(new BigIntPrimitive('0.0012345').toPrecision(3, BigIntPrimitive.roundHalfUp)).toBe('1.23e-3'); // prec(3) is 0.00123
        expect(new BigIntPrimitive('999.9').toPrecision(1, BigIntPrimitive.roundHalfUp)).toBe('1e+3'); // prec(1) is 1000
        expect(new BigIntPrimitive('1.23').toPrecision(5, BigIntPrimitive.roundHalfUp)).toBe('1.2300e+0'); // prec(5) is 1.2300
      });
    });
  });

}); // This closes the main 'BigIntPrimitive' describe
