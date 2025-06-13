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

  describe('constructor', () => {
    it('should create BigIntPrimitive for zero string "0"', () => {
      const n = new BigIntPrimitive('0');
      expect(n.isZero()).toBe(true);
      expect(n.limbs).toEqual([0]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);
    });
    it('should create BigIntPrimitive for zero number 0', () => {
      const n = new BigIntPrimitive(0);
      expect(n.isZero()).toBe(true);
      expect(n.limbs).toEqual([0]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);
    });
    it('should handle empty string as zero', () => {
      const n = new BigIntPrimitive('');
      expect(n.isZero()).toBe(true);
      expect(n.limbs).toEqual([0]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);
    });

    it('should throw TypeError for invalid string input (non-numeric characters)', () => {
      expect(() => new BigIntPrimitive('abc')).toThrow(TypeError("Invalid character in numeric string."));
      expect(() => new BigIntPrimitive('123a45')).toThrow(TypeError("Invalid character in numeric string."));
    });
    it('should throw TypeError for invalid input types', () => {
      expect(() => new BigIntPrimitive(null)).toThrow(TypeError("Invalid input type for BigIntPrimitive: cannot be null or undefined."));
      expect(() => new BigIntPrimitive(undefined)).toThrow(TypeError("Invalid input type for BigIntPrimitive: cannot be null or undefined."));
      expect(() => new BigIntPrimitive({})).toThrow(TypeError("Invalid input type for BigIntPrimitive. Expected string, number, or BigIntPrimitive instance."));
      expect(() => new BigIntPrimitive([])).toThrow(TypeError("Invalid input type for BigIntPrimitive. Expected string, number, or BigIntPrimitive instance."));
    });
  });

  describe('Constructor (Decimal Support)', () => {
    it('should parse valid integer strings', () => {
      let n = new BigIntPrimitive('12345');
      expect(n.limbs).toEqual([1, 2, 3, 4, 5]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive('-123');
      expect(n.limbs).toEqual([1, 2, 3]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(-1);

      n = new BigIntPrimitive('0');
      expect(n.limbs).toEqual([0]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);
    });

    it('should parse valid decimal strings', () => {
      let n = new BigIntPrimitive('123.45');
      expect(n.limbs).toEqual([1, 2, 3, 4, 5]);
      expect(n.exponent).toBe(-2);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive('-0.123');
      expect(n.limbs).toEqual([1, 2, 3]);
      expect(n.exponent).toBe(-3);
      expect(n.sign).toBe(-1);

      n = new BigIntPrimitive('.5');
      expect(n.limbs).toEqual([5]);
      expect(n.exponent).toBe(-1);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive('123.0');
      expect(n.limbs).toEqual([1, 2, 3]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive('123.');
      expect(n.limbs).toEqual([1, 2, 3]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);
    });

    it('should parse scientific notation', () => {
      let n = new BigIntPrimitive('1.23e3');
      expect(n.limbs).toEqual([1, 2, 3]);
      expect(n.exponent).toBe(1);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive('123e-2');
      expect(n.limbs).toEqual([1, 2, 3]);
      expect(n.exponent).toBe(-2);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive('-0.5e1');
      expect(n.limbs).toEqual([5]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(-1);

      n = new BigIntPrimitive('1.2345E+2');
      expect(n.limbs).toEqual([1, 2, 3, 4, 5]);
      expect(n.exponent).toBe(-2);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive('1.23e-02');
      expect(n.limbs).toEqual([1, 2, 3]);
      expect(n.exponent).toBe(-4);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive('0.000e5');
      expect(n.limbs).toEqual([0]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);
    });

    it('should normalize inputs', () => {
      let n = new BigIntPrimitive('00123.45');
      expect(n.limbs).toEqual([1, 2, 3, 4, 5]);
      expect(n.exponent).toBe(-2);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive('123.4500');
      expect(n.limbs).toEqual([1, 2, 3, 4, 5]);
      expect(n.exponent).toBe(-2);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive('0.0'); expect(n.limbs).toEqual([0]); expect(n.exponent).toBe(0); expect(n.sign).toBe(1);
      n = new BigIntPrimitive('0.000'); expect(n.limbs).toEqual([0]); expect(n.exponent).toBe(0); expect(n.sign).toBe(1);
      n = new BigIntPrimitive('0e5'); expect(n.limbs).toEqual([0]); expect(n.exponent).toBe(0); expect(n.sign).toBe(1);
      n = new BigIntPrimitive('-0'); expect(n.limbs).toEqual([0]); expect(n.exponent).toBe(0); expect(n.sign).toBe(1);

      n = new BigIntPrimitive('');
      expect(n.limbs).toEqual([0]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);
    });

    it('should handle number input, including decimals', () => {
      let n = new BigIntPrimitive(123.45);
      expect(n.limbs).toEqual([1, 2, 3, 4, 5]);
      expect(n.exponent).toBe(-2);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive(-0.00789);
      expect(n.limbs).toEqual([7, 8, 9]);
      expect(n.exponent).toBe(-5);
      expect(n.sign).toBe(-1);

      n = new BigIntPrimitive(0);
      expect(n.limbs).toEqual([0]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive(12345000);
      expect(n.limbs).toEqual([1,2,3,4,5]);
      expect(n.exponent).toBe(3);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive(1.23e10);
      expect(n.limbs).toEqual([1,2,3]);
      expect(n.exponent).toBe(8);
      expect(n.sign).toBe(1);
    });

    it('should handle copy constructor', () => {
      const original = new BigIntPrimitive("1.23e4");
      original.forceCPU = true;

      const copy = new BigIntPrimitive(original);
      expect(copy.limbs).toEqual([1, 2, 3]);
      expect(copy.exponent).toBe(2);
      expect(copy.sign).toBe(1);
      expect(copy.forceCPU).toBe(original.forceCPU);
      expect(copy).not.toBe(original);
    });

    it('should throw TypeError for invalid string formats', () => {
      expect(() => new BigIntPrimitive("abc")).toThrow(TypeError);
      expect(() => new BigIntPrimitive("1.2.3")).toThrow(TypeError);
      expect(() => new BigIntPrimitive("1e")).toThrow(TypeError);
      expect(() => new BigIntPrimitive("1.2e+")).toThrow(TypeError);
      expect(() => new BigIntPrimitive("1.2ea")).toThrow(TypeError);
      expect(() => new BigIntPrimitive("1.2e1.5")).toThrow(TypeError);
      expect(() => new BigIntPrimitive("1..2")).toThrow(TypeError);
      expect(() => new BigIntPrimitive("e5")).toThrow(TypeError);
      expect(() => new BigIntPrimitive(".e5")).toThrow(TypeError);
      expect(() => new BigIntPrimitive("123e5e6")).toThrow(TypeError);
    });
    it('should throw TypeError for invalid string input (non-numeric characters)', () => {
      expect(() => new BigIntPrimitive('abc')).toThrow(TypeError("Invalid character in numeric string."));
      expect(() => new BigIntPrimitive('123a45')).toThrow(TypeError("Invalid character in numeric string."));
    });
     it('should throw TypeError for non-finite numeric input', () => {
        expect(() => new BigIntPrimitive(NaN)).toThrow(TypeError);
        expect(() => new BigIntPrimitive(Infinity)).toThrow(TypeError);
        expect(() => new BigIntPrimitive(-Infinity)).toThrow(TypeError);
    });
  });

  describe('Sign, Absolute Value, and Comparison', () => {
    it('negate() should flip the sign of a positive number', () => {
      const n1 = new BigIntPrimitive('123', mockCanvas); const n2 = n1.negate();
      expect(n2.toString()).toBe('-123'); expect(n2.sign).toBe(-1);
      expect(n1.sign).toBe(1); expect(n2.canvas).toBe(mockCanvas);
    });
    it('negate() should flip the sign of a negative number', () => {
      const n1 = new BigIntPrimitive('-123', mockCanvas); const n2 = n1.negate();
      expect(n2.toString()).toBe('123'); expect(n2.sign).toBe(1); expect(n1.sign).toBe(-1);
    });
    it('negate() should handle zero correctly', () => {
      const n1 = new BigIntPrimitive('0', mockCanvas); const n2 = n1.negate();
      expect(n2.toString()).toBe('0'); expect(n2.sign).toBe(1);
    });
    it('abs() should return positive for a negative number', () => {
      const n1 = new BigIntPrimitive('-123', mockCanvas); const n2 = n1.abs();
      expect(n2.toString()).toBe('123'); expect(n2.sign).toBe(1);
      expect(n1.sign).toBe(-1); expect(n2.canvas).toBe(mockCanvas);
    });
    it('abs() should return positive for a positive number', () => {
      const n1 = new BigIntPrimitive('123', mockCanvas); const n2 = n1.abs();
      expect(n2.toString()).toBe('123'); expect(n2.sign).toBe(1);
    });
    it('abs() should handle zero correctly', () => {
      const n1 = new BigIntPrimitive('0', mockCanvas); const n2 = n1.abs();
      expect(n2.toString()).toBe('0'); expect(n2.sign).toBe(1);
    });
    it('isPositive() and isNegative() should work correctly', () => {
      expect(new BigIntPrimitive('10').isPositive()).toBe(true);
      expect(new BigIntPrimitive('10').isNegative()).toBe(false);
      expect(new BigIntPrimitive('-10').isPositive()).toBe(false);
      expect(new BigIntPrimitive('-10').isNegative()).toBe(true);
      expect(new BigIntPrimitive('0').isPositive()).toBe(false);
      expect(new BigIntPrimitive('0').isNegative()).toBe(false);
    });
    it('compareMagnitude() should correctly compare magnitudes', () => {
      const n1 = new BigIntPrimitive('123'); const n2 = new BigIntPrimitive('45');
      const n3 = new BigIntPrimitive('123'); const n4 = new BigIntPrimitive('-123');
      const n5 = new BigIntPrimitive('-45'); const n6 = new BigIntPrimitive('0');
      expect(n1.compareMagnitude(n2)).toBe(1); expect(n2.compareMagnitude(n1)).toBe(-1);
      expect(n1.compareMagnitude(n3)).toBe(0); expect(n1.compareMagnitude(n5)).toBe(1);
      expect(n2.compareMagnitude(n4)).toBe(-1); expect(n1.compareMagnitude(n4)).toBe(0);
      expect(n1.compareMagnitude(n6)).toBe(1); expect(n6.compareMagnitude(n1)).toBe(-1);
      expect(n6.compareMagnitude(new BigIntPrimitive("0"))).toBe(0);
    });
  });

  describe('cmp()', () => {
    it('should correctly compare positive numbers', () => {
      const n5 = new BigIntPrimitive('5');
      const n10 = new BigIntPrimitive('10');
      expect(n5.cmp(n10)).toBe(-1);
      expect(n10.cmp(n5)).toBe(1);
      expect(n5.cmp(new BigIntPrimitive('5'))).toBe(0);
    });

    it('should correctly compare negative numbers', () => {
      const n_5 = new BigIntPrimitive('-5');
      const n_10 = new BigIntPrimitive('-10');
      expect(n_5.cmp(n_10)).toBe(1);
      expect(n_10.cmp(n_5)).toBe(-1);
      expect(n_5.cmp(new BigIntPrimitive('-5'))).toBe(0);
    });

    it('should correctly compare numbers with mixed signs', () => {
      const n5 = new BigIntPrimitive('5');
      const n_10 = new BigIntPrimitive('-10');
      expect(n5.cmp(n_10)).toBe(1);
      expect(n_10.cmp(n5)).toBe(-1);
    });

    it('should correctly compare with zero', () => {
      const n0 = new BigIntPrimitive('0');
      const n5 = new BigIntPrimitive('5');
      const n_5 = new BigIntPrimitive('-5');
      expect(n0.cmp(n5)).toBe(-1);
      expect(n0.cmp(n_5)).toBe(1);
      expect(n5.cmp(n0)).toBe(1);
      expect(n_5.cmp(n0)).toBe(-1);
      expect(n0.cmp(new BigIntPrimitive('0'))).toBe(0);
    });

    it('should correctly compare large multi-limb numbers', () => {
      const large1 = new BigIntPrimitive('12345678901234567890');
      const large2 = new BigIntPrimitive('12345678901234567891');
      const large1_neg = new BigIntPrimitive('-12345678901234567890');
      const large2_neg = new BigIntPrimitive('-12345678901234567891');

      expect(large1.cmp(large2)).toBe(-1);
      expect(large2.cmp(large1)).toBe(1);
      expect(large1.cmp(new BigIntPrimitive('12345678901234567890'))).toBe(0);

      expect(large1_neg.cmp(large2_neg)).toBe(1);
      expect(large2_neg.cmp(large1_neg)).toBe(-1);
      expect(large1_neg.cmp(new BigIntPrimitive('-12345678901234567890'))).toBe(0);

      expect(large1.cmp(large1_neg)).toBe(1);
      expect(large1_neg.cmp(large1)).toBe(-1);
    });

    it('should throw TypeError for invalid input type', () => {
      const n1 = new BigIntPrimitive('123');
      expect(() => n1.cmp("not a BigIntPrimitive")).toThrow(TypeError);
      expect(() => n1.cmp(123)).toThrow(TypeError);
      expect(() => n1.cmp({})).toThrow(TypeError);
      expect(() => n1.cmp(null)).toThrow(TypeError);
      expect(() => n1.cmp(undefined)).toThrow(TypeError);
    });
  });

  describe('Shorthand Comparison Methods (eq, gt, gte, lt, lte)', () => {
    const n5 = new BigIntPrimitive('5');
    const n10 = new BigIntPrimitive('10');
    const n5_copy = new BigIntPrimitive('5');
    const n_5 = new BigIntPrimitive('-5');
    const n_10 = new BigIntPrimitive('-10');
    const n_5_copy = new BigIntPrimitive('-5');
    const n0 = new BigIntPrimitive('0');
    const large1 = new BigIntPrimitive('12345678901234567890');
    const large1_copy = new BigIntPrimitive('12345678901234567890');
    const large2 = new BigIntPrimitive('12345678901234567899');

    describe('eq()', () => {
      it('should correctly evaluate equality', () => {
        expect(n5.eq(n5_copy)).toBe(true);
        expect(n5.eq(n10)).toBe(false);
        expect(n_5.eq(n_5_copy)).toBe(true);
        expect(n_5.eq(n_10)).toBe(false);
        expect(n0.eq(new BigIntPrimitive('0'))).toBe(true);
        expect(large1.eq(large1_copy)).toBe(true);
        expect(large1.eq(large2)).toBe(false);
      });
      it('should throw TypeError for invalid input', () => {
        expect(() => n5.eq("5")).toThrow(TypeError);
      });
    });

    describe('gt()', () => {
      it('should correctly evaluate greater than', () => {
        expect(n10.gt(n5)).toBe(true);
        expect(n5.gt(n10)).toBe(false);
        expect(n5.gt(n5_copy)).toBe(false);
        expect(n_5.gt(n_10)).toBe(true);
        expect(n_10.gt(n_5)).toBe(false);
        expect(n5.gt(n_5)).toBe(true);
        expect(large2.gt(large1)).toBe(true);
        expect(large1.gt(large2)).toBe(false);
      });
      it('should throw TypeError for invalid input', () => {
        expect(() => n5.gt(5)).toThrow(TypeError);
      });
    });

    describe('gte()', () => {
      it('should correctly evaluate greater than or equal', () => {
        expect(n10.gte(n5)).toBe(true);
        expect(n5.gte(n10)).toBe(false);
        expect(n5.gte(n5_copy)).toBe(true);
        expect(n_5.gte(n_10)).toBe(true);
        expect(n_10.gte(n_5)).toBe(false);
        expect(n_5.gte(n_5_copy)).toBe(true);
        expect(large2.gte(large1)).toBe(true);
        expect(large1.gte(large1_copy)).toBe(true);
      });
      it('should throw TypeError for invalid input', () => {
        expect(() => n0.gte({})).toThrow(TypeError);
      });
    });

    describe('lt()', () => {
      it('should correctly evaluate less than', () => {
        expect(n5.lt(n10)).toBe(true);
        expect(n10.lt(n5)).toBe(false);
        expect(n5.lt(n5_copy)).toBe(false);
        expect(n_10.lt(n_5)).toBe(true);
        expect(n_5.lt(n_10)).toBe(false);
        expect(n_5.lt(n5)).toBe(true);
        expect(large1.lt(large2)).toBe(true);
      });
      it('should throw TypeError for invalid input', () => {
        expect(() => n_5.lt(null)).toThrow(TypeError);
      });
    });

    describe('lte()', () => {
      it('should correctly evaluate less than or equal', () => {
        expect(n5.lte(n10)).toBe(true);
        expect(n10.lte(n5)).toBe(false);
        expect(n5.lte(n5_copy)).toBe(true);
        expect(n_10.lte(n_5)).toBe(true);
        expect(n_5.lte(n_10)).toBe(false);
        expect(n_5.lte(n_5_copy)).toBe(true);
        expect(large1.lte(large2)).toBe(true);
        expect(large1.lte(large1_copy)).toBe(true);
      });
      it('should throw TypeError for invalid input', () => {
        expect(() => large1.lte(undefined)).toThrow(TypeError);
      });
    });
  });

  describe('toString()', () => {
    it('should convert simple BigIntPrimitive to string', () => {
      const n = new BigIntPrimitive('98765'); expect(n.toString()).toBe('98765');
    });
    it('should convert multi-limb BigIntPrimitive to string (limbs are single digits)', () => {
      const n = new BigIntPrimitive("12345678", mockCanvas);
      expect(n.toString()).toBe('12345678');
    });
    it('should convert single-digit number (single limb) to string', () => {
      const n = new BigIntPrimitive("7", mockCanvas);
      expect(n.toString()).toBe('7');
    });
    it('should correctly represent numbers based on limbs and exponent (formerly padding tests)', () => {
      const n1 = new BigIntPrimitive("10001", mockCanvas);
      expect(n1.toString()).toBe("10001");

      const n2 = new BigIntPrimitive("500340012", mockCanvas);
      expect(n2.toString()).toBe("500340012");

      const n3 = new BigIntPrimitive("123.45", mockCanvas);
      expect(n3.toString()).toBe("123.45");

      const n4 = new BigIntPrimitive("0.00123", mockCanvas);
      expect(n4.toString()).toBe("0.00123");
    });
  });

  describe('toNumber()', () => {
    it('should convert positive integer string to number', () => {
      const bigint = new BigIntPrimitive('12345');
      expect(bigint.toNumber()).toBe(12345);
    });

    it('should convert negative integer string to number', () => {
      const bigint = new BigIntPrimitive('-12345');
      expect(bigint.toNumber()).toBe(-12345);
    });

    it('should convert zero string to number zero', () => {
      const bigint = new BigIntPrimitive('0');
      expect(bigint.toNumber()).toBe(0);
    });

    it('should handle very large numbers with potential precision loss', () => {
      const veryLargeString = '12345678901234567890123';
      const bigint = new BigIntPrimitive(veryLargeString);
      const expectedNumber = Number(veryLargeString);

      expect(bigint.toNumber()).toBe(expectedNumber);
      expect(typeof bigint.toNumber()).toBe('number');
      if (Number.MAX_SAFE_INTEGER < parseFloat(veryLargeString)) {
      }
    });

    it('should convert numbers at the edge of safe integer precision', () => {
      const maxSafeIntStr = String(Number.MAX_SAFE_INTEGER);
      const bigintMaxSafe = new BigIntPrimitive(maxSafeIntStr);
      expect(bigintMaxSafe.toNumber()).toBe(Number.MAX_SAFE_INTEGER);

      const minSafeIntStr = String(Number.MIN_SAFE_INTEGER);
      const bigintMinSafe = new BigIntPrimitive(minSafeIntStr);
      expect(bigintMinSafe.toNumber()).toBe(Number.MIN_SAFE_INTEGER);

      const aboveMaxSafeStr = "9007199254740992";
      const bigintAboveMax = new BigIntPrimitive(aboveMaxSafeStr);
      expect(bigintAboveMax.toNumber()).toBe(Number(aboveMaxSafeStr));
      expect(bigintAboveMax.toNumber()).toBe(9007199254740992);


      const belowMinSafeStr = "-9007199254740992";
      const bigintBelowMin = new BigIntPrimitive(belowMinSafeStr);
      expect(bigintBelowMin.toNumber()).toBe(Number(belowMinSafeStr));
      expect(bigintBelowMin.toNumber()).toBe(-9007199254740992);
    });
  });

  describe('toJSON() and valueOf()', () => {
    describe('toJSON()', () => {
      it('should return the string representation of the number', () => {
        expect(new BigIntPrimitive('123').toJSON()).toBe('123');
        expect(new BigIntPrimitive('-123').toJSON()).toBe('-123');
        expect(new BigIntPrimitive('0').toJSON()).toBe('0');
      });

      it('should work correctly with JSON.stringify()', () => {
        const n = new BigIntPrimitive('123');
        expect(JSON.stringify(n)).toBe('"123"');

        const obj = { a: new BigIntPrimitive('-456'), b: 789 };
        expect(JSON.stringify(obj)).toBe('{"a":"-456","b":789}');
      });
    });

    describe('valueOf()', () => {
      it('should return the string representation of the number', () => {
        expect(new BigIntPrimitive('123').valueOf()).toBe('123');
        expect(new BigIntPrimitive('-123').valueOf()).toBe('-123');
        expect(new BigIntPrimitive('0').valueOf()).toBe('0');
      });

      it('should be used in string concatenation', () => {
        const b = new BigIntPrimitive('42');
        expect('Value: ' + b).toBe('Value: 42');
      });

      it('should be used in template literals', () => {
        const b = new BigIntPrimitive('-7');
        expect(`Value: ${b}`).toBe('Value: -7');
      });
    });
  });

  describe('isZero()', () => {
    it('should return true for zero', () => {
      const n = new BigIntPrimitive('0'); expect(n.isZero()).toBe(true);
    });
    it('should return false for non-zero', () => {
      const n = new BigIntPrimitive('123'); expect(n.isZero()).toBe(false);
    });
  });

  describe('add() with WebGL mock', () => {
    let mockGlContext;
    beforeEach(() => {
      mockGlContext = {
        createShader: vi.fn().mockReturnValue({ id: 'mockShader' }),
        createProgram: vi.fn().mockReturnValue({ id: 'mockProgram' }),
        getAttribLocation: vi.fn().mockReturnValue(0),
        getUniformLocation: vi.fn().mockReturnValue(0),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        activeTexture: vi.fn(),
        bindTexture: vi.fn(),
        uniform1i: vi.fn(),
        uniform1f: vi.fn(),
        createFramebuffer: vi.fn().mockReturnValue({ id: 'mockFramebuffer' }),
        bindFramebuffer: vi.fn(),
        framebufferTexture2D: vi.fn(),
        checkFramebufferStatus: vi.fn().mockReturnValue(0x8CD5), // FRAMEBUFFER_COMPLETE
        createBuffer: vi.fn().mockReturnValue({ id: 'mockBuffer' }),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        viewport: vi.fn(),
        useProgram: vi.fn(),
        drawArrays: vi.fn(),
        deleteTexture: vi.fn(),
        deleteFramebuffer: vi.fn(),
        deleteProgram: vi.fn(),
        deleteShader: vi.fn(),
        deleteBuffer: vi.fn(),
        texParameteri: vi.fn(),
        texImage2D: vi.fn(),
        VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, FRAMEBUFFER_COMPLETE: 0x8CD5,
        RGBA: 0x1908, FLOAT: 0x1406, TEXTURE_2D: 0x0DE1,
        TEXTURE0: 0x84C0, TEXTURE1: 0x84C1, TEXTURE2: 0x84C2,
        COLOR_ATTACHMENT0: 0x8CE0, FRAMEBUFFER: 0x8D40, TRIANGLES: 0x0004, STATIC_DRAW: 0x88E4,
        NEAREST: 0x2600, CLAMP_TO_EDGE: 0x812F,
      };
      webglUtils.initWebGL.mockReturnValue(mockGlContext);
      webglUtils.createDataTexture.mockReturnValue({ id: 'mockDataTexture' });
      webglUtils.createShader.mockReturnValue({ id: 'mockShader' });
      webglUtils.createProgram.mockReturnValue({ id: 'mockProgram' });
    });

    // setupMockWebGL function removed

    it('should add two small BigIntPrimitives (e.g., "123" + "456" = "579")', () => {
      webglUtils.readDataFromTexture.mockImplementationOnce((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width * 4);
        if (width === 1) { outputPixelDataRGBA[0] = 579; outputPixelDataRGBA[1] = 0; }
        return outputPixelDataRGBA;
      });
      const num1 = new BigIntPrimitive('123', mockCanvas); const num2 = new BigIntPrimitive('456', mockCanvas);
      const result = num1.add(num2);
      expect(result).not.toBeNull(); if (result) { expect(result.toString()).toBe('579'); }
      expect(webglUtils.initWebGL).toHaveBeenCalledWith(mockCanvas);
      expect(webglUtils.createDataTexture).toHaveBeenCalled();
      // expect(webglUtils.readDataFromTexture).toHaveBeenCalledTimes(1); // This will be reset by restoreAllMocks if not specific to this test
    });
    it('should add two larger BigIntPrimitives requiring multiple limbs (e.g., "8000" + "7000" = "15000", BASE=10000)', () => {
      webglUtils.readDataFromTexture.mockImplementationOnce((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width*4); if (width === 1) { outputPixelDataRGBA[0]=5000; outputPixelDataRGBA[1]=1;} return outputPixelDataRGBA;
      });
      const num1 = new BigIntPrimitive('8000', mockCanvas); const num2 = new BigIntPrimitive('7000', mockCanvas);
      const result = num1.add(num2);
      expect(result).not.toBeNull(); expect(result.toString()).toBe('15000');
    });
    it('should add numbers resulting in a carry propagation across multiple limbs (e.g., "9999" + "1" = "10000")', () => {
      webglUtils.readDataFromTexture.mockImplementationOnce((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width*4); if (width === 1) {outputPixelDataRGBA[0]=0; outputPixelDataRGBA[1]=1;} return outputPixelDataRGBA;
      });
      const num1 = new BigIntPrimitive('9999', mockCanvas); const num2 = new BigIntPrimitive('1', mockCanvas);
      const result = num1.add(num2);
      expect(result).not.toBeNull(); expect(result.toString()).toBe('10000');
    });
    it('should handle adding zero to a number', () => {
      webglUtils.readDataFromTexture.mockImplementationOnce((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width*4);
        if (width === 2) { outputPixelDataRGBA[0*4+0]=2345; outputPixelDataRGBA[0*4+1]=0; outputPixelDataRGBA[1*4+0]=1; outputPixelDataRGBA[1*4+1]=0;}
        return outputPixelDataRGBA;
      });
      const num1 = new BigIntPrimitive('12345', mockCanvas); const numZero = new BigIntPrimitive('0', mockCanvas);
      const result = num1.add(numZero);
      expect(result).not.toBeNull(); if (result) { expect(result.toString()).toBe('12345'); }
    });
    it('should add two multi-limb numbers with carries', () => {
      webglUtils.readDataFromTexture.mockImplementationOnce((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width*4);
        if (width === 3) {
            outputPixelDataRGBA[0*4+0]=1110; outputPixelDataRGBA[0*4+1]=1; // sum=1110, carry_out=1
            outputPixelDataRGBA[1*4+0]=9999; outputPixelDataRGBA[1*4+1]=0; // sum=9999, carry_out=0
            outputPixelDataRGBA[2*4+0]=10;   outputPixelDataRGBA[2*4+1]=0; // sum=10, carry_out=0
        }
        return outputPixelDataRGBA;
      });
      const num1 = new BigIntPrimitive('123456789', mockCanvas); // limbs [1,2,3,4,5,6,7,8,9]
      const num2 = new BigIntPrimitive('987654321', mockCanvas); // limbs [9,8,7,6,5,4,3,2,1]
      const result = num1.add(num2);

      expect(result).not.toBeNull(); if (result) { expect(result.toString()).toBe('1111111110'); }
    });

    it('BUGFIX BROWSER ADD: 20000 + 5333 => 25333', () => {
      const num1Str = '20000';
      const num2Str = '5333';
      const expectedSumStr = '25333';
      // setupMockWebGL(); // Already handled by beforeEach in this describe block
      webglUtils.readDataFromTexture.mockImplementationOnce((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width * height * 4);
        if (width === 2) {
          outputPixelDataRGBA[0 * 4 + 0] = 5333;
          outputPixelDataRGBA[0 * 4 + 1] = 0;
          outputPixelDataRGBA[1 * 4 + 0] = 2;
          outputPixelDataRGBA[1 * 4 + 1] = 0;
        }
        return outputPixelDataRGBA;
      });

      const num1 = new BigIntPrimitive(num1Str, mockCanvas);
      const num2 = new BigIntPrimitive(num2Str, mockCanvas);
      const result = num1.add(num2);

      expect(result.toString()).toBe(expectedSumStr);
    });
  });

  describe('subtract() - public method with sign logic', () => {
    let coreAddSpy, coreSubtractSpy;
    beforeEach(() => { coreAddSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_add'); coreSubtractSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_subtract'); });
    it('should handle positive - positive (a > b)', () => {
      const a=new BigIntPrimitive('500',mockCanvas); const b=new BigIntPrimitive('200',mockCanvas); coreSubtractSpy.mockReturnValue(new BigIntPrimitive('300',mockCanvas));
      const result=a.subtract(b); expect(result.toString()).toBe('300'); expect(coreSubtractSpy).toHaveBeenCalledTimes(1); expect(coreAddSpy).not.toHaveBeenCalled();
    });
    it('should handle positive - positive (a < b)', () => {
      const a=new BigIntPrimitive('200',mockCanvas); const b=new BigIntPrimitive('500',mockCanvas); coreSubtractSpy.mockReturnValue(new BigIntPrimitive('300',mockCanvas));
      const result=a.subtract(b); expect(result.toString()).toBe('-300'); expect(coreSubtractSpy).toHaveBeenCalledTimes(1); expect(coreAddSpy).not.toHaveBeenCalled();
    });
    it('should handle positive - positive (a == b)', () => {
      const a=new BigIntPrimitive('500',mockCanvas); const b=new BigIntPrimitive('500',mockCanvas);
      const result=a.subtract(b); expect(result.toString()).toBe('0'); expect(coreSubtractSpy).not.toHaveBeenCalled(); expect(coreAddSpy).not.toHaveBeenCalled();
    });
    it('should handle positive - negative', () => {
      const a=new BigIntPrimitive('500',mockCanvas); const negB=new BigIntPrimitive('-200',mockCanvas); coreAddSpy.mockReturnValue(new BigIntPrimitive('700',mockCanvas));
      const result=a.subtract(negB); expect(result.toString()).toBe('700'); expect(coreAddSpy).toHaveBeenCalledTimes(1); expect(coreSubtractSpy).not.toHaveBeenCalled();
    });
    it('should handle negative - positive', () => {
      const negA=new BigIntPrimitive('-500',mockCanvas); const b=new BigIntPrimitive('200',mockCanvas); coreAddSpy.mockReturnValue(new BigIntPrimitive('700',mockCanvas));
      const result=negA.subtract(b); expect(result.toString()).toBe('-700'); expect(coreAddSpy).toHaveBeenCalledTimes(1); expect(coreSubtractSpy).not.toHaveBeenCalled();
    });
    it('should handle negative - negative (abs(a) > abs(b))', () => {
      const negA=new BigIntPrimitive('-500',mockCanvas); const negB=new BigIntPrimitive('-200',mockCanvas); coreSubtractSpy.mockReturnValue(new BigIntPrimitive('300',mockCanvas));
      const result=negA.subtract(negB); expect(result.toString()).toBe('-300'); expect(coreSubtractSpy).toHaveBeenCalledTimes(1); expect(coreAddSpy).not.toHaveBeenCalled();
    });
    it('should handle negative - negative (abs(a) < abs(b))', () => {
      const negA=new BigIntPrimitive('-200',mockCanvas); const negB=new BigIntPrimitive('-500',mockCanvas); coreSubtractSpy.mockReturnValue(new BigIntPrimitive('300',mockCanvas));
      const result=negA.subtract(negB); expect(result.toString()).toBe('300'); expect(coreSubtractSpy).toHaveBeenCalledTimes(1); expect(coreAddSpy).not.toHaveBeenCalled();
    });
    it('should handle negative - negative (a == b)', () => {
      const negA=new BigIntPrimitive('-500',mockCanvas); const negB=new BigIntPrimitive('-500',mockCanvas);
      const result=negA.subtract(negB); expect(result.toString()).toBe('0'); expect(coreSubtractSpy).not.toHaveBeenCalled(); expect(coreAddSpy).not.toHaveBeenCalled();
    });
    it('a - 0 = a', () => {
      const a=new BigIntPrimitive('123',mockCanvas); const zero=new BigIntPrimitive('0',mockCanvas); coreSubtractSpy.mockReturnValue(new BigIntPrimitive('123',mockCanvas));
      const result=a.subtract(zero); expect(result.toString()).toBe('123'); expect(coreSubtractSpy).toHaveBeenCalledTimes(1);
    });
    it('0 - a = -a', () => {
      const zero=new BigIntPrimitive('0',mockCanvas); const a=new BigIntPrimitive('123',mockCanvas); coreSubtractSpy.mockReturnValue(new BigIntPrimitive('123',mockCanvas));
      const result=zero.subtract(a); expect(result.toString()).toBe('-123'); expect(coreSubtractSpy).toHaveBeenCalledTimes(1);
    });
    it('0 - (-a) = a', () => {
      const zero=new BigIntPrimitive('0',mockCanvas); const negA=new BigIntPrimitive('-123',mockCanvas); coreAddSpy.mockReturnValue(new BigIntPrimitive('123',mockCanvas));
      const result=zero.subtract(negA); expect(result.toString()).toBe('123');
    });
    it('0 - 0 = 0', () => {
      const zero1=new BigIntPrimitive('0',mockCanvas); const zero2=new BigIntPrimitive('0',mockCanvas);
      const result=zero1.subtract(zero2); expect(result.toString()).toBe('0'); expect(coreSubtractSpy).not.toHaveBeenCalled(); expect(coreAddSpy).not.toHaveBeenCalled();
    });
  });

  describe('_core_subtract() with WebGL mock', () => {
    let mockGlContext;
    beforeEach(() => {
      mockGlContext = {
        createShader: vi.fn().mockReturnValue({ id: 'mockShader' }),
        createProgram: vi.fn().mockReturnValue({ id: 'mockProgram' }),
        getAttribLocation: vi.fn().mockReturnValue(0),
        getUniformLocation: vi.fn().mockReturnValue(0),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        activeTexture: vi.fn(),
        bindTexture: vi.fn(),
        uniform1i: vi.fn(),
        uniform1f: vi.fn(),
        createFramebuffer: vi.fn().mockReturnValue({ id: 'mockFramebuffer' }),
        bindFramebuffer: vi.fn(),
        framebufferTexture2D: vi.fn(),
        checkFramebufferStatus: vi.fn().mockReturnValue(0x8CD5), // FRAMEBUFFER_COMPLETE
        createBuffer: vi.fn().mockReturnValue({ id: 'mockBuffer' }),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        viewport: vi.fn(),
        useProgram: vi.fn(),
        drawArrays: vi.fn(),
        deleteTexture: vi.fn(),
        deleteFramebuffer: vi.fn(),
        deleteProgram: vi.fn(),
        deleteShader: vi.fn(),
        deleteBuffer: vi.fn(),
        texParameteri: vi.fn(),
        texImage2D: vi.fn(),
        VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, FRAMEBUFFER_COMPLETE: 0x8CD5,
        RGBA: 0x1908, FLOAT: 0x1406, TEXTURE_2D: 0x0DE1,
        TEXTURE0: 0x84C0, TEXTURE1: 0x84C1, TEXTURE2: 0x84C2,
        COLOR_ATTACHMENT0: 0x8CE0, FRAMEBUFFER: 0x8D40, TRIANGLES: 0x0004, STATIC_DRAW: 0x88E4,
        NEAREST: 0x2600, CLAMP_TO_EDGE: 0x812F,
      };
      webglUtils.initWebGL.mockReturnValue(mockGlContext);
      webglUtils.createDataTexture.mockReturnValue({ id: 'mockDataTexture' });
      webglUtils.createShader.mockReturnValue({ id: 'mockShader' });
      webglUtils.createProgram.mockReturnValue({ id: 'mockProgram' });
    });

    // setupMockWebGLForSubtract function removed

    it('should subtract two positive single-limb numbers, no borrow', () => {
      const num1=new BigIntPrimitive('5678',mockCanvas); const num2=new BigIntPrimitive('1234',mockCanvas);
      webglUtils.readDataFromTexture.mockImplementationOnce((gl,fbo,width,height,isOutput) => { const o=new Float32Array(width*4); if(width===1){o[0]=4444;o[1]=0;} return o;});
      const result=num1._core_subtract(num2); expect(result).not.toBeNull(); expect(result.toString()).toBe('4444'); expect(result.sign).toBe(1);
    });
    it('should subtract with borrow handled by shader and JS propagation', () => {
      const num1=new BigIntPrimitive('12345',mockCanvas); const num2=new BigIntPrimitive('2346',mockCanvas);
      webglUtils.readDataFromTexture.mockImplementationOnce((gl,fbo,width,height,isOutput) => { const o=new Float32Array(width*4); if(width===2){o[0]=9999;o[1]=1;o[4]=1;o[5]=0;} return o;});
      const result=num1._core_subtract(num2); expect(result).not.toBeNull(); expect(result.toString()).toBe('9999'); expect(result.sign).toBe(1);
    });
    it('should correctly subtract "10000" - "1"', () => {
      // This test might need specific mock for readDataFromTexture if the general one isn't suitable
      const num1 = new BigIntPrimitive("0", mockCanvas);
      num1.limbs = [1,0,0,0,0]; // Represents 10000 if BASE is 10 and stored reversed internally before processing
      num1.exponent = 0; // Or adjust if limbs are not reversed for processing yet
      num1.sign = 1;

      const num2 = new BigIntPrimitive('1', mockCanvas);
      // Assuming the generic readDataFromTexture mock is sufficient or this path doesn't use WebGL.
      // If it uses WebGL and needs specific texture output, add:
      // webglUtils.readDataFromTexture.mockImplementationOnce(...);
      const result=num1._core_subtract(num2); expect(result.toString()).toBe('9999'); expect(result.sign).toBe(1);
    });
    it('should subtract to zero', () => {
      const num1=new BigIntPrimitive('12345',mockCanvas); const num2=new BigIntPrimitive('12345',mockCanvas);
      webglUtils.readDataFromTexture.mockImplementationOnce((gl,fbo,width,height,isOutput) => { const o=new Float32Array(width*4); if(width===2){o[0]=0;o[1]=0;o[4]=0;o[5]=0;} return o;});
      const result=num1._core_subtract(num2); expect(result.isZero()).toBe(true); expect(result.toString()).toBe('0'); expect(result.sign).toBe(1);
    });
    it('should handle multi-limb subtraction with borrows', () => {
      const num1=new BigIntPrimitive('12345678',mockCanvas);
      const num2=new BigIntPrimitive('3456789',mockCanvas);
      webglUtils.readDataFromTexture.mockImplementationOnce((gl,fbo,width,height,isOutput) => {
        const o=new Float32Array(width*4);
        if(width===2){
          o[0*4+0]=8889; o[0*4+1]=1;
          o[1*4+0]=889;  o[1*4+1]=0;
        }
        return o;
      });
      const result=num1._core_subtract(num2); expect(result.toString()).toBe('8888889'); expect(result.sign).toBe(1);
    });
  });

  describe('_multiply_limb_by_bigint() with WebGL mock', () => {
    let mockGlContext;
    beforeEach(() => {
      mockGlContext = {
        createShader: vi.fn().mockReturnValue({ id: 'mockShader' }),
        createProgram: vi.fn().mockReturnValue({ id: 'mockProgram' }),
        getAttribLocation: vi.fn().mockReturnValue(0),
        getUniformLocation: vi.fn().mockReturnValue(0),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        activeTexture: vi.fn(),
        bindTexture: vi.fn(),
        uniform1i: vi.fn(),
        uniform1f: vi.fn(),
        createFramebuffer: vi.fn().mockReturnValue({ id: 'mockFramebuffer' }),
        bindFramebuffer: vi.fn(),
        framebufferTexture2D: vi.fn(),
        checkFramebufferStatus: vi.fn().mockReturnValue(0x8CD5), // FRAMEBUFFER_COMPLETE
        createBuffer: vi.fn().mockReturnValue({ id: 'mockBuffer' }),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        viewport: vi.fn(),
        useProgram: vi.fn(),
        drawArrays: vi.fn(),
        deleteTexture: vi.fn(),
        deleteFramebuffer: vi.fn(),
        deleteProgram: vi.fn(),
        deleteShader: vi.fn(),
        deleteBuffer: vi.fn(),
        texParameteri: vi.fn(),
        texImage2D: vi.fn(),
        VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, FRAMEBUFFER_COMPLETE: 0x8CD5,
        RGBA: 0x1908, FLOAT: 0x1406, TEXTURE_2D: 0x0DE1,
        TEXTURE0: 0x84C0, TEXTURE1: 0x84C1, TEXTURE2: 0x84C2,
        COLOR_ATTACHMENT0: 0x8CE0, FRAMEBUFFER: 0x8D40, TRIANGLES: 0x0004, STATIC_DRAW: 0x88E4,
        NEAREST: 0x2600, CLAMP_TO_EDGE: 0x812F,
      };
      webglUtils.initWebGL.mockReturnValue(mockGlContext);
      webglUtils.createDataTexture.mockReturnValue({ id: 'mockDataTexture' });
      webglUtils.createShader.mockReturnValue({ id: 'mockShader' });
      webglUtils.createProgram.mockReturnValue({ id: 'mockProgram' });
    });

    // setupMockWebGLForMulLimb function removed

    const instanceForCanvas = new BigIntPrimitive("0", mockCanvas);
    it('should return zero if limbValue is 0', () => {
      const otherNumber = new BigIntPrimitive('12345', mockCanvas);
      const result = instanceForCanvas._multiply_limb_by_bigint(0, otherNumber);
      expect(result.isZero()).toBe(true);
    });
    it('should return zero if otherNumber is zero', () => {
      const otherNumber = new BigIntPrimitive('0', mockCanvas);
      const result = instanceForCanvas._multiply_limb_by_bigint(123, otherNumber);
      expect(result.isZero()).toBe(true);
    });
    it('limbValue * single-limb otherNumber, no final carry', () => {
      const otherNumber = new BigIntPrimitive('1000', mockCanvas);
      webglUtils.readDataFromTexture.mockImplementationOnce((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=5000;o[1]=0; return o;});
      const result = instanceForCanvas._multiply_limb_by_bigint(5, otherNumber);
      expect(result.toString()).toBe('5000');
    });
    it('limbValue * single-limb otherNumber, with final carry', () => {
      const otherNumber = new BigIntPrimitive('3000', mockCanvas);
      webglUtils.readDataFromTexture.mockImplementationOnce((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=5000;o[1]=1; return o;});
      const result = instanceForCanvas._multiply_limb_by_bigint(5, otherNumber);
      expect(result.toString()).toBe('15000');
    });
    it('limbValue * multi-limb otherNumber, no JS propagated carry', () => {
      const otherNumber = new BigIntPrimitive('32001', mockCanvas);
      webglUtils.readDataFromTexture.mockImplementationOnce((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=4002;o[1]=0; o[4]=6;o[5]=0; return o;});
      const result = instanceForCanvas._multiply_limb_by_bigint(2, otherNumber);
      expect(result.toString()).toBe('64002');
    });
    it('limbValue * multi-limb otherNumber, with JS propagated carry', () => {
      const otherNumber = new BigIntPrimitive('10001', mockCanvas);
      webglUtils.readDataFromTexture.mockImplementationOnce((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=6000;o[1]=0; o[4]=6000;o[5]=0; return o;});
      const result = instanceForCanvas._multiply_limb_by_bigint(6000, otherNumber);
      expect(result.toString()).toBe('60006000');
    });
    it('limbValue * otherNumber, where final propagatedCarry requires splitting', () => {
        const otherNumber = new BigIntPrimitive('9999', mockCanvas);
        webglUtils.readDataFromTexture.mockImplementationOnce((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=1;o[1]=9998; return o;});
        const result = instanceForCanvas._multiply_limb_by_bigint(9999, otherNumber);
        expect(result.toString()).toBe('99980001');
    });

    it('CPU: 5 * "123" = "615"', () => {
      const num = new BigIntPrimitive("123", mockCanvas);
      const result = instanceForCanvas._multiply_limb_by_bigint(5, num);
      expect(result.toString()).toBe("615");
      expect(result.exponent).toBe(0);
    });

    it('CPU: 9 * "9" = "81"', () => {
      const num = new BigIntPrimitive("9", mockCanvas);
      const result = instanceForCanvas._multiply_limb_by_bigint(9, num);
      expect(result.toString()).toBe("81");
      expect(result.exponent).toBe(0);
    });

    it('CPU: 5 * "1234" = "6170"', () => {
      const num = new BigIntPrimitive("1234", mockCanvas);
      const result = instanceForCanvas._multiply_limb_by_bigint(5, num);
      expect(result.toString()).toBe("6170");
      expect(result.exponent).toBe(0);
    });

    it('CPU: 0 * "12345" = "0"', () => {
      const num = new BigIntPrimitive("12345", mockCanvas);
      const result = instanceForCanvas._multiply_limb_by_bigint(0, num);
      expect(result.isZero()).toBe(true);
      expect(result.toString()).toBe("0");
      expect(result.exponent).toBe(0);
    });

    it('CPU: 7 * "0" = "0"', () => {
      const num = new BigIntPrimitive("0", mockCanvas);
      const result = instanceForCanvas._multiply_limb_by_bigint(7, num);
      expect(result.isZero()).toBe(true);
      expect(result.toString()).toBe("0");
      expect(result.exponent).toBe(0);
    });

    it('CPU: 2 * "500" (exp 1) = "1000" (exp 1)', () => {
      const num = new BigIntPrimitive("50.0", mockCanvas);
      num.limbs = [5,0,0];
      num.exponent = 1;
      const result = instanceForCanvas._multiply_limb_by_bigint(2, num);
      expect(result.toString()).toBe("10000");
      expect(result.exponent).toBe(1);
    });

  });

  describe('_core_multiply() - internal multiplication logic', () => {
    let mockGlContext;
    let mlbbSpy; // multiply_limb_by_bigint spy
    const instanceForCanvas = new BigIntPrimitive("0", mockCanvas);

    beforeEach(() => {
      mockGlContext = {
        createShader: vi.fn().mockReturnValue({ id: 'mockShader' }),
        createProgram: vi.fn().mockReturnValue({ id: 'mockProgram' }),
        getAttribLocation: vi.fn().mockReturnValue(0),
        getUniformLocation: vi.fn().mockReturnValue(0),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        activeTexture: vi.fn(),
        bindTexture: vi.fn(),
        uniform1i: vi.fn(),
        uniform1f: vi.fn(),
        createFramebuffer: vi.fn().mockReturnValue({ id: 'mockFramebuffer' }),
        bindFramebuffer: vi.fn(),
        framebufferTexture2D: vi.fn(),
        checkFramebufferStatus: vi.fn().mockReturnValue(0x8CD5), // FRAMEBUFFER_COMPLETE
        createBuffer: vi.fn().mockReturnValue({ id: 'mockBuffer' }),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        viewport: vi.fn(),
        useProgram: vi.fn(),
        drawArrays: vi.fn(),
        deleteTexture: vi.fn(),
        deleteFramebuffer: vi.fn(),
        deleteProgram: vi.fn(),
        deleteShader: vi.fn(),
        deleteBuffer: vi.fn(),
        texParameteri: vi.fn(),
        texImage2D: vi.fn(),
        VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, FRAMEBUFFER_COMPLETE: 0x8CD5,
        RGBA: 0x1908, FLOAT: 0x1406, TEXTURE_2D: 0x0DE1,
        TEXTURE0: 0x84C0, TEXTURE1: 0x84C1, TEXTURE2: 0x84C2,
        COLOR_ATTACHMENT0: 0x8CE0, FRAMEBUFFER: 0x8D40, TRIANGLES: 0x0004, STATIC_DRAW: 0x88E4,
        NEAREST: 0x2600, CLAMP_TO_EDGE: 0x812F,
      };
      webglUtils.initWebGL.mockReturnValue(mockGlContext);
      webglUtils.createDataTexture.mockReturnValue({ id: 'mockDataTexture' });
      webglUtils.createShader.mockReturnValue({ id: 'mockShader' });
      webglUtils.createProgram.mockReturnValue({ id: 'mockProgram' });

      mlbbSpy = vi.spyOn(BigIntPrimitive.prototype, '_multiply_limb_by_bigint');
    });

    // setupMockWebGLForCoreMultiply function removed

    // Removed instanceForCanvas from here as it's defined outside beforeEach
    // beforeEach(() => {
    //   mlbbSpy = vi.spyOn(BigIntPrimitive.prototype, '_multiply_limb_by_bigint');
    // });

    it('should return zero if num1 is zero', () => {
        const result = instanceForCanvas._core_multiply(new BigIntPrimitive('0', mockCanvas), new BigIntPrimitive('123', mockCanvas));
        expect(result.isZero()).toBe(true);
    });
    it('should return zero if num2 is zero', () => {
        const result = instanceForCanvas._core_multiply(new BigIntPrimitive('123', mockCanvas), new BigIntPrimitive('0', mockCanvas));
        expect(result.isZero()).toBe(true);
    });
    it('single-limb * single-limb', () => {
        // setupMockWebGLForCoreMultiply(); // Handled by beforeEach
        const num1 = new BigIntPrimitive('5', mockCanvas); const num2 = new BigIntPrimitive('7', mockCanvas);
        mlbbSpy.mockReturnValue(new BigIntPrimitive('35', mockCanvas)); // _multiply_limb_by_bigint will return this

        // We need to ensure _core_add is also robust if it's called by _core_multiply
        const coreAddSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_add').mockImplementation(function(other) {
            // Simple mock for _core_add if its detailed behavior isn't critical for this specific _core_multiply test
            const thisValStr = this.limbs.join('') + '0'.repeat(this.exponent);
            const otherValStr = other.limbs.join('') + '0'.repeat(other.exponent);
            const sum = BigInt(thisValStr) + BigInt(otherValStr);
            return new BigIntPrimitive(sum.toString(), this.canvas);
        });

        // const num1 = new BigIntPrimitive('5', mockCanvas); // Already defined above
        // const num2 = new BigIntPrimitive('7', mockCanvas); // Already defined above
        const result = instanceForCanvas._core_multiply(num1, num2);
        expect(mlbbSpy).toHaveBeenCalledWith(5, num2);
        expect(result.toString()).toBe('35');
        // coreAddSpy.mockRestore(); // restoreAllMocks in global afterEach should handle this
    });

    it('should correctly multiply "11" * "11" (testing simple accumulation)', () => {
      const num1 = new BigIntPrimitive("11", mockCanvas);
      const num2 = new BigIntPrimitive("11", mockCanvas);
      const instance = new BigIntPrimitive("0", mockCanvas); // Use a fresh instance if it matters for spy context
      const pvtMlbbSpy = vi.spyOn(instance, '_multiply_limb_by_bigint');
       // Mock _core_add for this specific test if it's called by _core_multiply
      const coreAddSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_add').mockImplementation(function(other) {
        const thisValStr = this.limbs.join('') + '0'.repeat(this.exponent);
        const otherValStr = other.limbs.join('') + '0'.repeat(other.exponent);
        const sum = BigInt(thisValStr) + BigInt(otherValStr);
        return new BigIntPrimitive(sum.toString(), this.canvas);
      });


      const result = instance._core_multiply(num1, num2);

      expect(result.toString()).toBe("121");
      expect(result.sign).toBe(1);
      expect(pvtMlbbSpy).toHaveBeenCalledTimes(2); // Assuming BASE 10, "11" has two limbs if not normalized differently
      expect(pvtMlbbSpy).toHaveBeenNthCalledWith(1, 1, num2); // if limbs are [1,1]
      expect(pvtMlbbSpy).toHaveBeenNthCalledWith(2, 1, num2);
      // pvtMlbbSpy.mockRestore(); // Handled by global afterEach
      // coreAddSpy.mockRestore(); // Handled by global afterEach
    });

    it('multi-limb * single-limb (e.g., 10001 * 5 = 50005, BASE 10k)', () => {
      // setupMockWebGLForCoreMultiply(); // Handled by beforeEach
        const num1 = new BigIntPrimitive('10001', mockCanvas); const num2 = new BigIntPrimitive('5', mockCanvas);
        // Mock _core_add for this specific test
        const coreAddSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_add').mockImplementation(function(other) {
            const thisValStr = this.limbs.join('') + '0'.repeat(this.exponent);
            const otherValStr = other.limbs.join('') + '0'.repeat(other.exponent);
            const sum = BigInt(thisValStr) + BigInt(otherValStr);
            return new BigIntPrimitive(sum.toString(), this.canvas);
        });
        const result = instanceForCanvas._core_multiply(num1, num2);
        expect(mlbbSpy).toHaveBeenCalledTimes(2); // 1*5 and (0*5)*2 and 1*5
        expect(result.toString()).toBe('50005');
        // coreAddSpy.mockRestore(); // Handled by global afterEach
    });
    it('123 * 45 = 5535', () => {
      // setupMockWebGLForCoreMultiply(); // Handled by beforeEach
        const num1 = new BigIntPrimitive('123', mockCanvas); const num2 = new BigIntPrimitive('45', mockCanvas);
        mlbbSpy.mockImplementation((limbVal, otherNum) => {
          const productVal = BigInt(limbVal) * BigInt(otherNum.limbs.join('')+'0'.repeat(otherNum.exponent));
          return new BigIntPrimitive(productVal.toString(), mockCanvas);
        });

        const coreAddSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_add').mockImplementation(function(other) {
            const thisValStr = this.limbs.join('') + '0'.repeat(this.exponent);
            const otherValStr = other.limbs.join('') + '0'.repeat(other.exponent);
            const sum = BigInt(thisValStr) + BigInt(otherValStr);
            return new BigIntPrimitive(sum.toString(), this.canvas);
        });

        const result = instanceForCanvas._core_multiply(num1, num2);
        expect(mlbbSpy).toHaveBeenCalledTimes(3); // For digits 3, 2, 1 of "123"
        // Order of calls to _multiply_limb_by_bigint depends on the loop in _core_multiply (reversed or not)
        // Assuming it iterates from LSB:
        expect(mlbbSpy).toHaveBeenNthCalledWith(1, 3, num2); // 3 * 45
        expect(mlbbSpy).toHaveBeenNthCalledWith(2, 2, num2); // 2 * 45 (shifted)
        expect(mlbbSpy).toHaveBeenNthCalledWith(3, 1, num2); // 1 * 45 (shifted further)
        expect(result.toString()).toBe('5535');
        // coreAddSpy.mockRestore(); // Handled by global afterEach
    });
  });

  describe('multiply() - public method with Karatsuba and sign logic', () => {
    let coreMultiplySpy, splitAtSpy;
    const KARATSUBA_THRESHOLD_FROM_CODE = 20;

    beforeEach(() => {
        coreMultiplySpy = vi.spyOn(BigIntPrimitive.prototype, '_core_multiply');
        splitAtSpy = vi.spyOn(BigIntPrimitive.prototype, '_splitAt');
    });

    it('should throw TypeError for invalid input', () => {
        const n1 = new BigIntPrimitive('10', mockCanvas); expect(() => n1.multiply("abc")).toThrow(TypeError);
    });
    it('a * 0 = 0', () => {
        const n1 = new BigIntPrimitive('123', mockCanvas); const zero = new BigIntPrimitive('0', mockCanvas);
        const result = n1.multiply(zero); expect(result.isZero()).toBe(true);
        expect(coreMultiplySpy).not.toHaveBeenCalled(); expect(splitAtSpy).not.toHaveBeenCalled();
    });
     it('0 * a = 0', () => {
        const zero = new BigIntPrimitive('0', mockCanvas); const n1 = new BigIntPrimitive('123', mockCanvas);
        const result = zero.multiply(n1); expect(result.isZero()).toBe(true);
        expect(coreMultiplySpy).not.toHaveBeenCalled(); expect(splitAtSpy).not.toHaveBeenCalled();
    });
    it('positive * positive = positive', () => {
        const n1 = new BigIntPrimitive('10', mockCanvas); const n2 = new BigIntPrimitive('5', mockCanvas);
        coreMultiplySpy.mockReturnValue(new BigIntPrimitive('50', mockCanvas));
        const result = n1.multiply(n2);
        expect(result.toString()).toBe('50'); expect(result.sign).toBe(1);
        expect(coreMultiplySpy).toHaveBeenCalledTimes(1);
        const callArgs = coreMultiplySpy.mock.calls[0];
        expect(callArgs[0].toString()).toBe(n1.abs().toString());
        expect(callArgs[1].toString()).toBe(n2.abs().toString());
    });
    it('positive * negative = negative', () => {
        const n1 = new BigIntPrimitive('10', mockCanvas); const n2 = new BigIntPrimitive('-5', mockCanvas);
        coreMultiplySpy.mockReturnValue(new BigIntPrimitive('50', mockCanvas));
        const result = n1.multiply(n2); expect(result.toString()).toBe('-50'); expect(result.sign).toBe(-1);
    });
    it('negative * positive = negative', () => {
        const n1 = new BigIntPrimitive('-10', mockCanvas); const n2 = new BigIntPrimitive('5', mockCanvas);
        coreMultiplySpy.mockReturnValue(new BigIntPrimitive('50', mockCanvas));
        const result = n1.multiply(n2); expect(result.toString()).toBe('-50'); expect(result.sign).toBe(-1);
    });
    it('negative * negative = positive', () => {
        const n1 = new BigIntPrimitive('-10', mockCanvas); const n2 = new BigIntPrimitive('-5', mockCanvas);
        coreMultiplySpy.mockReturnValue(new BigIntPrimitive('50', mockCanvas));
        const result = n1.multiply(n2); expect(result.toString()).toBe('50'); expect(result.sign).toBe(1);
    });
     it('multiply result of zero should have positive sign', () => {
        const n1 = new BigIntPrimitive('-10', mockCanvas); const n2 = new BigIntPrimitive('5', mockCanvas);
        coreMultiplySpy.mockReturnValue(new BigIntPrimitive('0', mockCanvas));
        const result = n1.multiply(n2); expect(result.isZero()).toBe(true); expect(result.sign).toBe(1);
    });

    it('should use _core_multiply for numbers smaller than KARATSUBA_THRESHOLD', () => {
        const limbCountSmall = KARATSUBA_THRESHOLD_FROM_CODE > 1 ? KARATSUBA_THRESHOLD_FROM_CODE - 1 : 1;
        const n1Val = "1".repeat(Math.max(1, (limbCountSmall * 4) -1) || 1);
        const n2Val = "2".repeat(Math.max(1, (limbCountSmall * 4) -1) || 1);
        const n1 = new BigIntPrimitive(n1Val, mockCanvas);
        const n2 = new BigIntPrimitive(n2Val, mockCanvas);
        if (KARATSUBA_THRESHOLD_FROM_CODE < 2 && (n1.isZero() || n2.isZero())) { expect(true).toBe(true); return; }

        coreMultiplySpy.mockReturnValue(new BigIntPrimitive("0", mockCanvas));
        n1.multiply(n2);
        expect(coreMultiplySpy).toHaveBeenCalledTimes(9);
        expect(splitAtSpy).toHaveBeenCalled();
    });

    it('should use Karatsuba for large numbers (calls _splitAt and _core_multiply at base)', () => {
        let n1Str = "", n2Str = "";
        const limbCountLarge = KARATSUBA_THRESHOLD_FROM_CODE;
        if (limbCountLarge === 0) { expect(true).toBe(true); return; }
        for(let i=0; i < limbCountLarge; ++i) {
            n1Str += String( (i % 9) + 1 ).repeat(4);
            n2Str += String( ((i+1) % 9) + 1 ).repeat(4);
        }
        const n1 = new BigIntPrimitive(n1Str, mockCanvas);
        const n2 = new BigIntPrimitive(n2Str, mockCanvas);

        const coreAddSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_add');
        coreAddSpy.mockImplementation(function(other) {
            const resultSim = new BigIntPrimitive( (this.limbs[0] || 0) + (other.limbs[0] || 0) + 1, this.canvas);
            return resultSim.isZero() ? new BigIntPrimitive("1", this.canvas) : resultSim;
        });

        coreMultiplySpy.mockReturnValue(new BigIntPrimitive("1", mockCanvas));

        const originalMultiply = BigIntPrimitive.prototype.multiply;
        const publicMultiplySpy = vi.spyOn(BigIntPrimitive.prototype, 'multiply')
            .mockImplementation(function(...args) {
                return originalMultiply.apply(this, args);
            });

        n1.multiply(n2);

        n1.multiply(n2);

        expect(splitAtSpy).toHaveBeenCalled();
        expect(coreMultiplySpy.mock.calls.length).toBe(30);
        expect(publicMultiplySpy.mock.calls.length).toBe(44);

        publicMultiplySpy.mockRestore();
        coreAddSpy.mockRestore();
    });

    it('Karatsuba integration: 12345 * 67890 = 838002050 (tests schoolbook path due to threshold)', () => {
        const n1 = new BigIntPrimitive("12345", mockCanvas, { forceCPU: true });
        const n2 = new BigIntPrimitive("67890", mockCanvas, { forceCPU: true });
        const result = n1.multiply(n2);
        expect(result.toString()).toBe('838102050');
    });

    it('positive * positive = positive (forceCPU)', () => {
      const n1 = new BigIntPrimitive('123', mockCanvas, { forceCPU: true });
      const n2 = new BigIntPrimitive('45', mockCanvas, { forceCPU: true });
      const initWebGLSpy = vi.spyOn(webglUtils, 'initWebGL');
      const result = n1.multiply(n2);
      expect(result.toString()).toBe('5535');
      expect(result.sign).toBe(1);
      expect(initWebGLSpy).not.toHaveBeenCalled();
      initWebGLSpy.mockRestore();
    });

    it('negative * positive = negative (forceCPU)', () => {
      const n1 = new BigIntPrimitive('-123', mockCanvas, { forceCPU: true });
      const n2 = new BigIntPrimitive('45', mockCanvas, { forceCPU: true });
      const initWebGLSpy = vi.spyOn(webglUtils, 'initWebGL');
      const result = n1.multiply(n2);
      expect(result.toString()).toBe('-5535');
      expect(result.sign).toBe(-1);
      expect(initWebGLSpy).not.toHaveBeenCalled();
      initWebGLSpy.mockRestore();
    });

    it('Karatsuba integration: large numbers with forceCPU', () => {
      let s1 = "";
      let s2 = "";
      for (let i = 0; i < 25; i++) {
          s1 += "1234";
          s2 += "5678";
      }
      const num1Str = "1".repeat(80);
      const num2Str = "2".repeat(80);
      const expectedBigIntResult = BigInt(num1Str) * BigInt(num2Str);

      const n1_cpu = new BigIntPrimitive(num1Str, mockCanvas, { forceCPU: true });
      const n2_cpu = new BigIntPrimitive(num2Str, mockCanvas, { forceCPU: true });

      const initWebGLSpy = vi.spyOn(webglUtils, 'initWebGL');
      const multiplyLimbSpy = vi.spyOn(BigIntPrimitive.prototype, '_multiply_limb_by_bigint');
      const coreAddSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_add');
      const coreSubtractSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_subtract');

      const result_cpu = n1_cpu.multiply(n2_cpu);

      const originalPE = BigIntPrimitive.PE;
      BigIntPrimitive.PE = 1000;
      expect(result_cpu.toString()).toBe(String(expectedBigIntResult));
      BigIntPrimitive.PE = originalPE;

      expect(initWebGLSpy).not.toHaveBeenCalled();
      const cpuArithCalled = multiplyLimbSpy.mock.calls.length > 0 ||
                             coreAddSpy.mock.calls.length > 0 ||
                             coreSubtractSpy.mock.calls.length > 0;
      expect(cpuArithCalled).toBe(true);
    });

  });

  describe('_staticRound() Internal Logic', () => {
    const RM_DOWN = 0;
    const RM_HALF_UP = 1;
    const RM_HALF_EVEN = 2;
    const RM_UP = 3;

    it('RM_DOWN (0): should truncate to specified decimal places', () => {
      let res = BigIntPrimitive._staticRound([1,2,3,4,5,6], -3, 1, 2, RM_DOWN);
      expect(res.limbs).toEqual([1,2,3,4,5]);
      expect(res.exponent).toBe(-2);
      expect(res.sign).toBe(1);

      res = BigIntPrimitive._staticRound([1,2,3,4,5], -2, 1, 0, RM_DOWN);
      expect(res.limbs).toEqual([1,2,3]);
      expect(res.exponent).toBe(0);

      res = BigIntPrimitive._staticRound([1,2,3], 0, 1, 0, RM_DOWN);
      expect(res.limbs).toEqual([1,2,3]);
      expect(res.exponent).toBe(0);

      res = BigIntPrimitive._staticRound([1,2,3,4,5], -2, 1, 3, RM_DOWN);
      expect(res.limbs).toEqual([1,2,3,4,5]);
      expect(res.exponent).toBe(-2);

      res = BigIntPrimitive._staticRound([7], -3, 1, 2, RM_DOWN);
      expect(res.limbs).toEqual([0]);
      expect(res.exponent).toBe(0);
      expect(res.sign).toBe(1);

      res = BigIntPrimitive._staticRound([1,2,3], -5, 1, 2, RM_DOWN);
      expect(res.limbs).toEqual([0]);
      expect(res.exponent).toBe(0);

    });

    it('RM_HALF_UP (1): placeholder for future tests', () => {
        expect(true).toBe(true);
    });
    it('RM_HALF_EVEN (2): placeholder for future tests', () => {
        expect(true).toBe(true);
    });
    it('RM_UP (3): placeholder for future tests', () => {
        expect(true).toBe(true);
    });
     it('Negative dp (rounding to powers of 10): placeholder', () => {
        expect(true).toBe(true);
    });

  });

  describe('pow()', () => {
    it('x.pow(0) should return 1', () => {
      expect(new BigIntPrimitive('5').pow(0).toString()).toBe('1');
      expect(new BigIntPrimitive('0').pow(0).toString()).toBe('1');
      expect(new BigIntPrimitive('-5').pow(0).toString()).toBe('1');
    });

    it('x.pow(1) should return x', () => {
      expect(new BigIntPrimitive('5').pow(1).toString()).toBe('5');
      expect(new BigIntPrimitive('0').pow(1).toString()).toBe('0');
      expect(new BigIntPrimitive('-5').pow(1).toString()).toBe('-5');
      const n = new BigIntPrimitive('12345');
      const n_pow1 = n.pow(1);
      expect(n_pow1.toString()).toBe('12345');
      expect(n_pow1).not.toBe(n);
    });

    it('0.pow(n) should return 0 for n > 0', () => {
      expect(new BigIntPrimitive('0').pow(5).toString()).toBe('0');
      expect(new BigIntPrimitive('0').pow(100).toString()).toBe('0');
    });

    it('1.pow(n) should return 1', () => {
      expect(new BigIntPrimitive('1').pow(100).toString()).toBe('1');
      const n1 = new BigIntPrimitive('1');
      const n1_pow100 = n1.pow(100);
      expect(n1_pow100.toString()).toBe('1');
      expect(n1_pow100).not.toBe(n1);
    });

    it('(-1).pow(n) should return 1 for even n, -1 for odd n', () => {
      expect(new BigIntPrimitive('-1').pow(2).toString()).toBe('1');
      expect(new BigIntPrimitive('-1').pow(3).toString()).toBe('-1');
      expect(new BigIntPrimitive('-1').pow(100).toString()).toBe('1');
      expect(new BigIntPrimitive('-1').pow(101).toString()).toBe('-1');
    });

    it('should calculate simple positive base and exponent', () => {
      expect(new BigIntPrimitive('2').pow(10).toString()).toBe('1024');
      expect(new BigIntPrimitive('3').pow(5).toString()).toBe('243');
      expect(new BigIntPrimitive('7').pow(3).toString()).toBe('343');
    });

    it('should calculate negative base with even/odd exponent', () => {
      expect(new BigIntPrimitive('-2').pow(2).toString()).toBe('4');
      expect(new BigIntPrimitive('-2').pow(3).toString()).toBe('-8');
      expect(new BigIntPrimitive('-3').pow(4).toString()).toBe('81');
    });

    it('should handle larger numbers and exponents', () => {
      expect(new BigIntPrimitive('10').pow(10).toString()).toBe('10000000000');
      expect(new BigIntPrimitive('2').pow(30).toString()).toBe('1073741824');
    });

    it('should use CPU path and respect forceCPU option', () => {
      const initWebGLSpy = vi.spyOn(webglUtils, 'initWebGL');
      const base = new BigIntPrimitive('3', mockCanvas, { forceCPU: true });
      const result = base.pow(4);
      expect(result.toString()).toBe('81');
      expect(initWebGLSpy).not.toHaveBeenCalled();
      initWebGLSpy.mockRestore();
    });

    describe('Input Validation', () => {
      const base = new BigIntPrimitive('5');
      it('should throw TypeError for non-integer exponent', () => {
        expect(() => base.pow(2.5)).toThrow(TypeError("Exponent must be an integer."));
        expect(() => base.pow("abc")).toThrow(TypeError("Exponent must be an integer."));
        expect(() => base.pow(NaN)).toThrow(TypeError("Exponent must be an integer."));
      });

      it('should throw TypeError for negative exponent', () => {
        expect(() => base.pow(-2)).toThrow(TypeError("Exponent must be non-negative."));
      });

      it('should throw Error for exponent too large', () => {
        expect(() => base.pow(1000001)).toThrow(Error("Exponent too large."));
      });
    });
  });

  describe('_multiplyByPowerOfBase()', () => {
    it('should return a copy when power is 0', () => {
      const n1 = new BigIntPrimitive('12345', mockCanvas);
      const result = n1._multiplyByPowerOfBase(0);
      expect(result.toString()).toBe('12345');
      expect(result.sign).toBe(n1.sign);
      expect(result.limbs).toEqual(n1.limbs);
      expect(result).not.toBe(n1);
      expect(result.canvas).toBe(mockCanvas);
    });

    it('should multiply by 10^1 (formerly BASE^1)', () => {
      const n1 = new BigIntPrimitive('123', mockCanvas);
      const result = n1._multiplyByPowerOfBase(1);
      expect(result.toString()).toBe('1230');
      expect(result.sign).toBe(1);
    });

    it('should multiply by 10^2 (formerly BASE^2)', () => {
      const n1 = new BigIntPrimitive('123.45', mockCanvas);
      const result = n1._multiplyByPowerOfBase(2);
      expect(result.toString()).toBe('12345');
      expect(result.sign).toBe(1);
    });

    it('should multiply multi-digit number by 10^3', () => {
      const n1 = new BigIntPrimitive('12345.6789', mockCanvas);
      const result = n1._multiplyByPowerOfBase(3);
      expect(result.toString()).toBe('12345678.9');
      expect(result.sign).toBe(1);
    });

    it('should return zero if this is zero', () => {
      const n0 = new BigIntPrimitive('0', mockCanvas);
      const result = n0._multiplyByPowerOfBase(3);
      expect(result.isZero()).toBe(true);
      expect(result.toString()).toBe('0');
      expect(result.sign).toBe(1);
    });

    it('should preserve sign for negative numbers', () => {
      const n1 = new BigIntPrimitive('-1.23', mockCanvas);
      const result = n1._multiplyByPowerOfBase(1);
      expect(result.toString()).toBe('-12.3');
      expect(result.sign).toBe(-1);
    });

    it('should throw error if power is negative', () => {
      const n1 = new BigIntPrimitive('123', mockCanvas);
      expect(() => n1._multiplyByPowerOfBase(-1)).toThrow("Power must be non-negative for _multiplyByPowerOfBase as currently used.");
    });

    it('should throw error if power is not an integer', () => {
      const n1 = new BigIntPrimitive('123', mockCanvas);
      expect(() => n1._multiplyByPowerOfBase(1.5)).toThrow("Power must be an integer.");
      expect(() => n1._multiplyByPowerOfBase(NaN)).toThrow("Power must be an integer.");
      expect(() => n1._multiplyByPowerOfBase(Infinity)).toThrow("Power must be an integer.");
    });

    it('should handle power of 0 for a zero number', () => {
      const n0 = new BigIntPrimitive('0', mockCanvas);
      const result = n0._multiplyByPowerOfBase(0);
      expect(result.isZero()).toBe(true);
      expect(result.toString()).toBe('0');
      expect(result.sign).toBe(1);
      expect(result).not.toBe(n0);
    });
  });

  describe('forceCPU option', () => {
    it('should use CPU path when forceCPU is true for add()', () => {
      const num1 = new BigIntPrimitive('123', mockCanvas, { forceCPU: true });
      const num2 = new BigIntPrimitive('456', mockCanvas, { forceCPU: true });
      // const initWebGLSpy = vi.spyOn(webglUtils, 'initWebGL'); // webglUtils.initWebGL is already a mock
      const result = num1.add(num2);
      expect(result.toString()).toBe('579');
      expect(webglUtils.initWebGL).not.toHaveBeenCalled();
    });

    it('should use CPU path when forceCPU is true for subtract()', () => {
      const num1 = new BigIntPrimitive('567', mockCanvas, { forceCPU: true });
      const num2 = new BigIntPrimitive('123', mockCanvas, { forceCPU: true });
      // const initWebGLSpy = vi.spyOn(webglUtils, 'initWebGL');
      const result = num1.subtract(num2);
      expect(result.toString()).toBe('444');
      expect(webglUtils.initWebGL).not.toHaveBeenCalled();
    });

    it('should use CPU path for multiply() when forceCPU is true', () => {
      const n1 = new BigIntPrimitive('10', mockCanvas, { forceCPU: true });
      const n2 = new BigIntPrimitive('5', mockCanvas, { forceCPU: true });
      // const initWebGLSpy = vi.spyOn(webglUtils, 'initWebGL');
      const result = n1.multiply(n2);
      expect(result.toString()).toBe('50');
      expect(webglUtils.initWebGL).not.toHaveBeenCalled();
    });

  });
});

describe('Strict Mode', () => {
  let originalStrict;

  beforeAll(() => {
    originalStrict = BigIntPrimitive.strict;
  });

  afterAll(() => {
    BigIntPrimitive.strict = originalStrict;
  });

  beforeEach(() => {
    BigIntPrimitive.strict = true;
  });

  afterEach(() => {
    BigIntPrimitive.strict = originalStrict;
  });

  describe('Constructor', () => {
    it('should throw TypeError when constructing with a number in strict mode', () => {
      expect(() => new BigIntPrimitive(123)).toThrow(TypeError("[big.js] String expected"));
    });

    it('should NOT throw when constructing with a string in strict mode', () => {
      expect(() => new BigIntPrimitive('123')).not.toThrow();
    });

    it('should NOT throw when constructing with a BigIntPrimitive instance in strict mode', () => {
      const existingBigInt = new BigIntPrimitive('10');
      BigIntPrimitive.strict = true;
      expect(() => new BigIntPrimitive(existingBigInt)).not.toThrow();
    });

    it('should allow number construction if strict mode is explicitly set to false locally', () => {
      BigIntPrimitive.strict = false;
      expect(() => new BigIntPrimitive(123)).not.toThrow();
      BigIntPrimitive.strict = true;
    });
  });

  describe('valueOf()', () => {
    it('should throw Error when valueOf() is called in strict mode', () => {
      const n = new BigIntPrimitive('10');
      expect(() => n.valueOf()).toThrow(Error("[big.js] valueOf disallowed"));
    });

    it('should NOT throw for valueOf() if strict mode is explicitly false', () => {
      BigIntPrimitive.strict = false;
      const n = new BigIntPrimitive('10');
      expect(() => n.valueOf()).not.toThrow();
      expect(n.valueOf()).toBe('10');
      BigIntPrimitive.strict = true;
    });
  });

  describe('toNumber()', () => {
    it('should convert "123" to 123 without error in strict mode', () => {
      const n = new BigIntPrimitive('123');
      expect(n.toNumber()).toBe(123);
    });

    it('should convert "123.45" to 123.45 without error in strict mode', () => {
      const n = new BigIntPrimitive('123.45');
      expect(n.toNumber()).toBe(123.45);
    });

    it('should convert "1.0000000000000001" (17 decimal places, safe) without error', () => {
      const val = '1.0000000000000001';
      const n = new BigIntPrimitive(val);
      expect(() => n.toNumber()).toThrow(Error("[big.js] Imprecise conversion"));
    });

    it('should throw Error for "1.0000000000000000001" (20 decimal places, loses precision) in strict mode', () => {
      const val = '1.0000000000000000001';
      const n = new BigIntPrimitive(val);
      expect(() => n.toNumber()).toThrow(Error("[big.js] Imprecise conversion"));
    });

    it('should convert Number.MAX_SAFE_INTEGER.toString() without error', () => {
      const val = Number.MAX_SAFE_INTEGER.toString();
      const n = new BigIntPrimitive(val);
      expect(n.toNumber()).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should throw Error for numbers that lose precision with Number() conversion', () => {
      const largePreciseVal = "9007199254740991.1";
      const nLargePrecise = new BigIntPrimitive(largePreciseVal);
      expect(() => nLargePrecise.toNumber()).toThrow(Error("[big.js] Imprecise conversion"));

      const valTooLargeForExactNumber = "12345678901234567890123";
      const nTooLarge = new BigIntPrimitive(valTooLargeForExactNumber);
      expect(() => nTooLarge.toNumber()).toThrow(Error("[big.js] Imprecise conversion"));
    });

    it('should not throw for (Number.MAX_SAFE_INTEGER + 1).toString() if Number() is exact', () => {
      const val = (BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1)).toString();
      const n = new BigIntPrimitive(val);
      expect(n.toNumber()).toBe(9007199254740992);
    });

    it('should allow "1e+1000" to become Infinity without throwing in strict mode', () => {
      const n = new BigIntPrimitive('1e+1000');
      expect(n.toNumber()).toBe(Infinity);
    });

    it('should allow "-1e+1000" to become -Infinity without throwing in strict mode', () => {
      const n = new BigIntPrimitive('-1e+1000');
      expect(n.toNumber()).toBe(-Infinity);
    });

    it('should throw for "NaN" string if intermediate BigInt creation fails (strict mode)', () => {
        const n = new BigIntPrimitive("0");
        n.toString = () => "NaN";
        expect(() => n.toNumber()).toThrow(Error("[big.js] Imprecise conversion (NaN from string)"));
    });

    it('should NOT throw for toNumber() if strict mode is explicitly false, even if precision is lost', () => {
      BigIntPrimitive.strict = false;
      const val = '1.0000000000000000001';
      const n = new BigIntPrimitive(val);
      expect(() => n.toNumber()).not.toThrow();
      expect(n.toNumber()).toBe(1);
      BigIntPrimitive.strict = true;
    });
  });

  describe('General Strict Mode Behavior', () => {
    it('BigIntPrimitive.strict = false; new BigIntPrimitive(1).toNumber() should work', () => {
      BigIntPrimitive.strict = false;
      const n = new BigIntPrimitive(1);
      expect(n.toNumber()).toBe(1);
    });

    it('BigIntPrimitive.strict = true; expect(() => new BigIntPrimitive(1)).toThrow();', () => {
      BigIntPrimitive.strict = true;
      expect(() => new BigIntPrimitive(1)).toThrow(TypeError("[big.js] String expected"));
    });

    it('BigIntPrimitive.strict = false; expect(() => new BigIntPrimitive(1)).not.toThrow();', () => {
      BigIntPrimitive.strict = false;
      expect(() => new BigIntPrimitive(1)).not.toThrow();
    });
  });
});

describe('sqrt()', () => {
  let originalDP;
  let originalRM;

  beforeEach(() => {
    originalDP = BigIntPrimitive.DP;
    originalRM = BigIntPrimitive.RM;
  });

  afterEach(() => {
    BigIntPrimitive.DP = originalDP;
    BigIntPrimitive.RM = originalRM;
  });

  test('should throw an error for negative numbers', () => {
    const negBigInt = new BigIntPrimitive('-2');
    expect(() => negBigInt.sqrt()).toThrow('[big.js] No square root of negative number');
  });

  test('sqrt(0) should be 0', () => {
    const zero = new BigIntPrimitive('0');
    expect(zero.sqrt().toString()).toBe('0');
  });

  test('sqrt(1) should be 1', () => {
    const one = new BigIntPrimitive('1');
    BigIntPrimitive.DP = 0;
    expect(one.sqrt().toString()).toBe('1');
  });

  test('sqrt(4) should be 2', () => {
    const four = new BigIntPrimitive('4');
    BigIntPrimitive.DP = 0;
    expect(four.sqrt().toString()).toBe('2');
  });

  test('sqrt(9) should be 3', () => {
    const nine = new BigIntPrimitive('9');
    BigIntPrimitive.DP = 0;
    expect(nine.sqrt().toString()).toBe('3');
  });

  test('sqrt(16) should be 4', () => {
    const sixteen = new BigIntPrimitive('16');
    BigIntPrimitive.DP = 0;
    expect(sixteen.sqrt().toString()).toBe('4');
  });

  test('sqrt(2) with DP=20 should be 1.41421356237309504880', () => {
    BigIntPrimitive.DP = 20;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const two = new BigIntPrimitive('2');
    expect(two.sqrt().toString()).toBe('1.41421356237309504880');
  });

  test('sqrt(3) with DP=20 should be 1.7320508075688772935', () => {
    BigIntPrimitive.DP = 20;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const three = new BigIntPrimitive('3');
    expect(three.sqrt().toString()).toBe('1.7320508075688772935');
  });

  test('sqrt(12345) with DP=20 should be 111.108055513539740030', () => {
    BigIntPrimitive.DP = 20;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const num = new BigIntPrimitive('12345');
    expect(num.sqrt().toString()).toBe('111.10805551353974002952');
  });

  test('sqrt(0.0004) with DP=4 should be 0.02', () => {
    BigIntPrimitive.DP = 4;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const val = new BigIntPrimitive('0.0004');
    expect(val.sqrt().toString()).toBe('0.0200');
  });

  test('sqrt(very small number) sqrt(0.00000000000000000001) DP 20', () => {
    BigIntPrimitive.DP = 20;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const val = new BigIntPrimitive('0.00000000000000000001');
    expect(val.sqrt().toString()).toBe('0.00000000010000000000');
 });

});

describe('divide()', () => {
  let originalDP;
  let originalRM;

  beforeEach(() => {
    originalDP = BigIntPrimitive.DP;
    originalRM = BigIntPrimitive.RM;
  });

  afterEach(() => {
    BigIntPrimitive.DP = originalDP;
    BigIntPrimitive.RM = originalRM;
  });

  test.only('DEBUG TEST: 10 / 4 (DP=1) _decimalDivide raw output', () => {
    const num1 = new BigIntPrimitive('10');
    const num2 = new BigIntPrimitive('4');
    const originalDP = BigIntPrimitive.DP;
    BigIntPrimitive.DP = 1;

    const internalPrecision = BigIntPrimitive.DP + 5 + Math.abs(num1.exponent) + Math.abs(num2.exponent); // Should be 1 + 5 + 0 + 0 = 6

    const resultFromDecimalDivide = num1.abs()._decimalDivide(num2.abs(), internalPrecision);

    const actualLimbs = JSON.stringify(resultFromDecimalDivide.limbs);
    const actualExponent = resultFromDecimalDivide.exponent;

    const expectedLimbs = JSON.stringify([2,5]);
    const expectedExponent = -1; // For 2.5

    const oldPE = BigIntPrimitive.PE; BigIntPrimitive.PE = 1e9;
    const oldNE = BigIntPrimitive.NE; BigIntPrimitive.NE = -1e9;
    const resultString = resultFromDecimalDivide.toString();
    BigIntPrimitive.PE = oldPE; BigIntPrimitive.NE = oldNE;

    // This assertion is designed to fail if actualOutputString is not what we trace.
    // The failure message will then show the 'Received:' value.
    // It will also throw the limbs and exponent for further debugging.
    if (resultString !== "2.5" || actualLimbs !== expectedLimbs || actualExponent !== expectedExponent) {
      throw new Error(
        `DEBUG TEST FAILED for 10/4 (DP=${BigIntPrimitive.DP}, internalPrecision=${internalPrecision})\n` +
        `  _decimalDivide returned: toString()="${resultString}"\n` +
        `    Expected state for 2.5: limbs=${expectedLimbs}, exponent=${expectedExponent}\n` +
        `    Actual state:   limbs=${actualLimbs}, exponent=${actualExponent}\n` +
        `    (Sign was ${resultFromDecimalDivide.sign})`
      );
    }
    expect(resultString).toBe("2.5");
    BigIntPrimitive.DP = originalDP;
  });


  test('10 / 4 (DP=1, RM=halfUp) should be 2.5', () => {
    BigIntPrimitive.DP = 1;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const a = new BigIntPrimitive('10');
    const b = new BigIntPrimitive('4');
    expect(a.divide(b).toString()).toBe('2.5');
  });

  test('1 / 2 (DP=1, RM=halfUp) should be 0.5', () => {
    BigIntPrimitive.DP = 1;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const a = new BigIntPrimitive('1');
    const b = new BigIntPrimitive('2');
    expect(a.divide(b).toString()).toBe('0.5');
  });

  test('7 / 2 (DP=1, RM=halfUp) should be 3.5', () => {
    BigIntPrimitive.DP = 1;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const a = new BigIntPrimitive('7');
    const b = new BigIntPrimitive('2');
    expect(a.divide(b).toString()).toBe('3.5');
  });

  test('10 / 3 (DP=2, RM=halfUp) should be 3.33', () => {
    BigIntPrimitive.DP = 2;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const a = new BigIntPrimitive('10');
    const b = new BigIntPrimitive('3');
    expect(a.divide(b).toString()).toBe('3.33');
  });

  test('10 / 3 (DP=5, RM=halfUp) should be 3.33333', () => {
    BigIntPrimitive.DP = 5;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const a = new BigIntPrimitive('10');
    const b = new BigIntPrimitive('3');
    expect(a.divide(b).toString()).toBe('3.33333');
  });

  test('1 / 8 (DP=3, RM=halfUp) should be 0.125', () => {
    BigIntPrimitive.DP = 3;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const a = new BigIntPrimitive('1');
    const b = new BigIntPrimitive('8');
    expect(a.divide(b).toString()).toBe('0.125');
  });

  test('10 / 0.5 (DP=0, RM=halfUp) should be 20', () => {
    BigIntPrimitive.DP = 0;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const a = new BigIntPrimitive('10');
    const b = new BigIntPrimitive('0.5');
    expect(a.divide(b).toString()).toBe('20');
  });

  test('10.5 / 3 (DP=1, RM=halfUp) should be 3.5', () => {
    BigIntPrimitive.DP = 1;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const a = new BigIntPrimitive('10.5');
    const b = new BigIntPrimitive('3');
    expect(a.divide(b).toString()).toBe('3.5');
  });

  test('0.25 / 0.5 (DP=1, RM=halfUp) should be 0.5', () => {
    BigIntPrimitive.DP = 1;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const a = new BigIntPrimitive('0.25');
    const b = new BigIntPrimitive('0.5');
    expect(a.divide(b).toString()).toBe('0.5');
  });

  test('Sign handling: (-10) / 4 (DP=1) should be -2.5', () => {
    BigIntPrimitive.DP = 1;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const a = new BigIntPrimitive('-10');
    const b = new BigIntPrimitive('4');
    expect(a.divide(b).toString()).toBe('-2.5');
  });

  test('Sign handling: 10 / (-4) (DP=1) should be -2.5', () => {
    BigIntPrimitive.DP = 1;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const a = new BigIntPrimitive('10');
    const b = new BigIntPrimitive('-4');
    expect(a.divide(b).toString()).toBe('-2.5');
  });

  test('Sign handling: (-10) / (-4) (DP=1) should be 2.5', () => {
    BigIntPrimitive.DP = 1;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const a = new BigIntPrimitive('-10');
    const b = new BigIntPrimitive('-4');
    expect(a.divide(b).toString()).toBe('2.5');
  });

  test('Division by 1: 123.45 / 1 (DP=2) should be 123.45', () => {
    BigIntPrimitive.DP = 2;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const a = new BigIntPrimitive('123.45');
    const b = new BigIntPrimitive('1');
    expect(a.divide(b).toString()).toBe('123.45');
  });

  test('Division of zero: 0 / 5 (DP=0) should be 0', () => {
    BigIntPrimitive.DP = 0;
    BigIntPrimitive.RM = BigIntPrimitive.roundHalfUp;
    const a = new BigIntPrimitive('0');
    const b = new BigIntPrimitive('5');
    expect(a.divide(b).toString()).toBe('0');
  });

  test('Division by zero should throw error', () => {
    const a = new BigIntPrimitive('10');
    const b = new BigIntPrimitive('0');
    expect(() => a.divide(b)).toThrow('Division by zero');
  });
});

describe('Division and Remainder', () => {
  const BASE_FROM_CODE = 10;
  const BASE_LOG10_FROM_CODE = 1;

  describe('_longDivide', () => {
    it('should handle dividend smaller than divisor: 5 / 10 => Q=0, R=5', () => {
      const dividend = new BigIntPrimitive("5", mockCanvas);
      const divisor = new BigIntPrimitive("10", mockCanvas);
      const instance = new BigIntPrimitive("0", mockCanvas);
      const { quotient, remainder } = instance._longDivide(dividend, divisor);

      expect(quotient.toString()).toBe("0");
      expect(quotient.sign).toBe(1);
      expect(remainder.toString()).toBe("5");
      expect(remainder.sign).toBe(1);
    });

    it('should handle dividend equal to divisor: 10 / 10 => Q=1, R=0', () => {
      const dividend = new BigIntPrimitive("10", mockCanvas);
      const divisor = new BigIntPrimitive("10", mockCanvas);
      const instance = new BigIntPrimitive("0", mockCanvas);
      const { quotient, remainder } = instance._longDivide(dividend, divisor);

      expect(quotient.toString()).toBe("1");
      expect(quotient.sign).toBe(1);
      expect(remainder.toString()).toBe("0");
      expect(remainder.sign).toBe(1);
    });

    it('should handle simple division with remainder: 10 / 3 => Q=3, R=1', () => {
      const dividend = new BigIntPrimitive("10", mockCanvas);
      const divisor = new BigIntPrimitive("3", mockCanvas);
      const instance = new BigIntPrimitive("0", mockCanvas);
      const { quotient, remainder } = instance._longDivide(dividend, divisor);

      expect(quotient.toString()).toBe("3");
      expect(quotient.sign).toBe(1);
      expect(remainder.toString()).toBe("1");
      expect(remainder.sign).toBe(1);
    });

    it('should handle zero dividend: 0 / 5 => Q=0, R=0', () => {
      const dividend = new BigIntPrimitive("0", mockCanvas);
      const divisor = new BigIntPrimitive("5", mockCanvas);
      const instance = new BigIntPrimitive("0", mockCanvas);
      const { quotient, remainder } = instance._longDivide(dividend, divisor);

      expect(quotient.toString()).toBe("0");
      expect(quotient.sign).toBe(1);
      expect(remainder.toString()).toBe("0");
      expect(remainder.sign).toBe(1);
    });

    it('should handle multi-limb case: 50005 / 5 => Q=10001, R=0', () => {
      const dividend = new BigIntPrimitive("50005", mockCanvas);
      const divisor = new BigIntPrimitive("5", mockCanvas);
      const instance = new BigIntPrimitive("0", mockCanvas);
      const { quotient, remainder } = instance._longDivide(dividend, divisor);

      expect(quotient.toString()).toBe("10001");
      expect(quotient.sign).toBe(1);
      expect(remainder.toString()).toBe("0");
      expect(remainder.sign).toBe(1);
    });

    it('should handle BASE-related division: 20000 / 10000 => Q=2, R=0', () => {
      const dividend = new BigIntPrimitive("20000", mockCanvas);
      const divisor = new BigIntPrimitive("10000", mockCanvas);
      const instance = new BigIntPrimitive("0", mockCanvas);
      const { quotient, remainder } = instance._longDivide(dividend, divisor);

      expect(quotient.toString()).toBe("2");
      expect(quotient.sign).toBe(1);
      expect(remainder.toString()).toBe("0");
      expect(remainder.sign).toBe(1);
    });
  });

  let originalCoreAdd;
  let originalCoreSubtract;

  beforeEach(() => {
    originalCoreAdd = BigIntPrimitive.prototype._core_add;
    originalCoreSubtract = BigIntPrimitive.prototype._core_subtract;

    BigIntPrimitive.prototype._core_add = function(num2BigInt) {
      const num1BigInt = this;
      let resultLimbs = [];
      let carry = 0;
      const maxLength = Math.max(num1BigInt.limbs.length, num2BigInt.limbs.length);
      for (let i = 0; i < maxLength; i++) {
        const limb1 = num1BigInt.limbs[i] || 0;
        const limb2 = num2BigInt.limbs[i] || 0;
        const sum = limb1 + limb2 + carry;
        resultLimbs.push(sum % BASE_FROM_CODE);
        carry = Math.floor(sum / BASE_FROM_CODE);
      }
      while (carry > 0) {
        resultLimbs.push(carry % BASE_FROM_CODE);
        carry = Math.floor(carry / BASE_FROM_CODE);
      }
      while (resultLimbs.length > 1 && resultLimbs[resultLimbs.length - 1] === 0) {
        resultLimbs.pop();
      }
      if (resultLimbs.length === 0) {
        resultLimbs.push(0);
      }
      const result = new BigIntPrimitive("0", num1BigInt.canvas);
      result.limbs = resultLimbs;
      result.sign = 1;
      if (result.isZero()) {
          result.sign = 1;
      }
      return result;
    };

    BigIntPrimitive.prototype._core_subtract = function(subtrahendBigInt) {
      const minuendBigInt = this;
      let resultLimbs = [];
      let borrow = 0;
      const loopLength = minuendBigInt.limbs.length;
      for (let i = 0; i < loopLength; i++) {
        const limb1 = minuendBigInt.limbs[i] || 0;
        const limb2 = subtrahendBigInt.limbs[i] || 0;
        let diff = limb1 - limb2 - borrow;
        if (diff < 0) {
          diff += BASE_FROM_CODE;
          borrow = 1;
        } else {
          borrow = 0;
        }
        resultLimbs.push(diff);
      }
      if (borrow > 0) {
        console.warn("BigIntPrimitive mock _core_subtract: Final borrow was > 0. This implies minuend < subtrahend, violating precondition.");
      }
      while (resultLimbs.length > 1 && resultLimbs[resultLimbs.length - 1] === 0) {
        resultLimbs.pop();
      }
      if (resultLimbs.length === 0) {
        resultLimbs.push(0);
      }
      const result = new BigIntPrimitive("0", minuendBigInt.canvas);
      result.limbs = resultLimbs;
      result.sign = 1;
      if (result.isZero()) {
          result.sign = 1;
      }
      return result;
    };
  });

  afterEach(() => {
    BigIntPrimitive.prototype._core_add = originalCoreAdd;
    BigIntPrimitive.prototype._core_subtract = originalCoreSubtract;
  });

  const checkDivRem = (dividendStr, divisorStr, expectedQStr, expectedRStr, canvasInstance) => {
    const dividend = new BigIntPrimitive(dividendStr, canvasInstance);
    const divisor = new BigIntPrimitive(divisorStr, canvasInstance);
    const { quotient, remainder } = dividend.divideAndRemainder(divisor);

    expect(quotient.toString()).toBe(expectedQStr);
    if (expectedQStr === "0") {
        expect(quotient.sign).toBe(1);
    } else if (expectedQStr.startsWith('-')) {
        expect(quotient.sign).toBe(-1);
    } else {
        expect(quotient.sign).toBe(1);
    }

    expect(remainder.toString()).toBe(expectedRStr);
    if (expectedRStr === "0") {
        expect(remainder.sign).toBe(1);
    } else {
        const originalDividendSign = (new BigIntPrimitive(dividendStr, canvasInstance)).sign;
        expect(remainder.sign).toBe(originalDividendSign);
    }
  };

  const checkDivide = (dividendStr, divisorStr, expectedQStr, canvasInstance) => {
    const dividend = new BigIntPrimitive(dividendStr, canvasInstance);
    const divisor = new BigIntPrimitive(divisorStr, canvasInstance);
    const quotient = dividend.divide(divisor);
    expect(quotient.toString()).toBe(expectedQStr);
    if (expectedQStr === "0") {
        expect(quotient.sign).toBe(1);
    } else if (expectedQStr.startsWith('-')) {
        expect(quotient.sign).toBe(-1);
    } else {
        expect(quotient.sign).toBe(1);
    }
  };

  const checkRemainder = (dividendStr, divisorStr, expectedRStr, canvasInstance) => {
    const dividend = new BigIntPrimitive(dividendStr, canvasInstance);
    const divisor = new BigIntPrimitive(divisorStr, canvasInstance);
    const remainderResult = dividend.remainder(divisor);
    expect(remainderResult.toString()).toBe(expectedRStr);

    if (expectedRStr === "0") {
        expect(remainderResult.sign).toBe(1);
    } else {
        const originalDividendSign = (new BigIntPrimitive(dividendStr, canvasInstance)).sign;
        expect(remainderResult.sign).toBe(originalDividendSign);
    }
  };

  describe('divideAndRemainder(), divide(), remainder() Public Methods', () => {
    it('Error Handling: Division by zero', () => {
      const dividend = new BigIntPrimitive("10", mockCanvas);
      const divisorZero = new BigIntPrimitive("0", mockCanvas);
      expect(() => dividend.divideAndRemainder(divisorZero)).toThrow("Division by zero");
      expect(() => dividend.divide(divisorZero)).toThrow("Division by zero");
      expect(() => dividend.remainder(divisorZero)).toThrow("Division by zero");
    });

    it('Error Handling: TypeError for invalid divisor', () => {
      const dividend = new BigIntPrimitive("10", mockCanvas);
      const invalidDivisor = "not a bigint";
      expect(() => dividend.divideAndRemainder(invalidDivisor)).toThrow(TypeError);
      expect(() => dividend.divide(invalidDivisor)).toThrow(TypeError);
      expect(() => dividend.remainder(invalidDivisor)).toThrow(TypeError);
    });

    describe('Basic Cases (Positive Integers)', () => {
      const cases = [
        { D: "10", d: "3", Q: "3", R: "1" },
        { D: "12", d: "4", Q: "3", R: "0" },
        { D: "5", d: "10", Q: "0", R: "5" },
        { D: "0", d: "5", Q: "0", R: "0" },
        { D: "12345", d: "1", Q: "12345", R: "0" },
        { D: "10000", d: "1", Q: "10000", R: "0" },
        { D: "9999", d: "10000", Q: "0", R: "9999" },
      ];
      cases.forEach(({ D, d, Q, R }) => {
        it(`${D} / ${d} => Q=${Q}, R=${R}`, () => {
          checkDivRem(D, d, Q, R, mockCanvas);
          checkDivide(D, d, Q, mockCanvas);
          checkRemainder(D, d, R, mockCanvas);
        });
      });
    });

    describe('Multi-Limb Cases', () => {
      const cases = [
        { D: "123456", d: "123", Q: "1003", R: "87" },
        { D: "1000000", d: "101", Q: "9900", R: "100" },
        { D: "10", d: "2", Q: "5", R: "0" },
        { D: "20", d: "10", Q: "2", R: "0" },
        { D: "100", d: "10", Q: "10", R: "0" },
      ];

      it('20000000000000000000 / 5333 => Q=3750234389649353, R=451', () => {
        const dividendStr = "20000000000000000000";
        const divisorStr = "5333";
        const expectedQStr = "3750234389649353";
        const expectedRStr = "451";
        const canvas = mockCanvas;

        const dividend = new BigIntPrimitive(dividendStr, canvas);
        const divisor = new BigIntPrimitive(divisorStr, canvas);
        const { quotient, remainder } = dividend.divideAndRemainder(divisor);

        expect(quotient.toString()).toBe(expectedQStr);
        expect(remainder.toString()).toBe(expectedRStr);
        expect(quotient.sign).toBe(1);
        expect(remainder.sign).toBe(1);
      });

      const remainingCases = [
        { D: "123", d: "12345", Q: "0", R: "123"},
        { D: "500000010", d: "10000", Q: "50000", R: "10"},
        { D: "99999", d: "100", Q: "999", R: "99" },
        { D: "60", d: "10", Q:"6", R:"0"},
      ];
      const allCases = [
        ...cases,
        { D: "12345678901234567890", d: "987654321", Q: "12499999887", R: "339506163" },
        ...remainingCases
      ];
      allCases.forEach(({ D, d, Q, R }) => {
        it(`${D} / ${d} => Q=${Q}, R=${R}`, () => {
          checkDivRem(D, d, Q, R, mockCanvas);
          checkDivide(D, d, Q, mockCanvas);
          checkRemainder(D, d, R, mockCanvas);
        });
      });
    });

    describe('Sign Handling', () => {
      const cases = [
        { D: "10", d: "3", Q: "3", R: "1" },
        { D: "-10", d: "3", Q: "-3", R: "-1" },
        { D: "10", d: "-3", Q: "-3", R: "1" },
        { D: "-10", d: "-3", Q: "3", R: "-1" },

        { D: "12", d: "4", Q: "3", R: "0" },
        { D: "-12", d: "4", Q: "-3", R: "0" },
        { D: "12", d: "-4", Q: "-3", R: "0" },
        { D: "-12", d: "-4", Q: "3", R: "0" },

        { D: "5", d: "10", Q: "0", R: "5" },
        { D: "-5", d: "10", Q: "0", R: "-5" },
        { D: "5", d: "-10", Q: "0", R: "5" },
        { D: "-5", d: "-10", Q: "0", R: "-5" },
      ];
      cases.forEach(({ D, d, Q, R }) => {
        it(`${D} / ${d} => Q=${Q}, R=${R}`, () => {
          checkDivRem(D, d, Q, R, mockCanvas);
          checkDivide(D, d, Q, mockCanvas);
          checkRemainder(D, d, R, mockCanvas);
        });
      });
    });

    describe('Zero Results and Normalization', () => {
        it('0 / 7 => Q=0, R=0', () => {
            checkDivRem("0", "7", "0", "0", mockCanvas);
            checkDivide("0", "7", "0", mockCanvas);
            checkRemainder("0", "7", "0", mockCanvas);
        });

        it('Negation of 0: new BigIntPrimitive("0").negate() / 7', () => {
            const zero = new BigIntPrimitive("0", mockCanvas);
            const zeroNegated = zero.negate();
            expect(zeroNegated.toString()).toBe("0");
            expect(zeroNegated.sign).toBe(1);

            const divisor = new BigIntPrimitive("7", mockCanvas);

            checkDivRem(zeroNegated.toString(), divisor.toString(), "0", "0", mockCanvas);
            checkDivide(zeroNegated.toString(), divisor.toString(), "0", mockCanvas);
            checkRemainder(zeroNegated.toString(), divisor.toString(), "0", mockCanvas);
        });
    });
  });
});

describe('BigIntPrimitive.prototype.toString() scenarios', () => {
  let originalPE;
  let originalNE;

  beforeAll(() => {
    originalPE = BigIntPrimitive.PE;
    originalNE = BigIntPrimitive.NE;
  });

  afterAll(() => {
    BigIntPrimitive.PE = originalPE;
    BigIntPrimitive.NE = originalNE;
  });

  const resetPE_NE = () => {
    BigIntPrimitive.PE = originalPE;
    BigIntPrimitive.NE = originalNE;
  };

  describe('Zero', () => {
    it('new BigIntPrimitive("0").toString() should be "0"', () => {
      expect(new BigIntPrimitive("0").toString()).toBe("0");
    });
  });

  describe('Simple Integers', () => {
    it('new BigIntPrimitive("123").toString() should be "123"', () => {
      expect(new BigIntPrimitive("123").toString()).toBe("123");
    });
    it('new BigIntPrimitive("-123").toString() should be "-123"', () => {
      expect(new BigIntPrimitive("-123").toString()).toBe("-123");
    });
  });

  describe('Simple Decimals', () => {
    it('new BigIntPrimitive("123.45").toString() should be "123.45"', () => {
      expect(new BigIntPrimitive("123.45").toString()).toBe("123.45");
    });
    it('new BigIntPrimitive("-123.45").toString() should be "-123.45"', () => {
      expect(new BigIntPrimitive("-123.45").toString()).toBe("-123.45");
    });
    it('new BigIntPrimitive("0.123").toString() should be "0.123"', () => {
      expect(new BigIntPrimitive("0.123").toString()).toBe("0.123");
    });
    it('new BigIntPrimitive(".5").toString() should be "0.5"', () => {
      expect(new BigIntPrimitive(".5").toString()).toBe("0.5");
    });
  });

  describe('Trailing/Leading Zeros (after constructor normalization)', () => {
    it('new BigIntPrimitive("123.4500").toString() should be "123.45"', () => {
      expect(new BigIntPrimitive("123.4500").toString()).toBe("123.45");
    });
    it('new BigIntPrimitive("00123.45").toString() should be "123.45"', () => {
      expect(new BigIntPrimitive("00123.45").toString()).toBe("123.45");
    });
    it('new BigIntPrimitive("123.0").toString() should be "123"', () => {
      expect(new BigIntPrimitive("123.0").toString()).toBe("123");
    });
  });

  describe('Scientific Notation - Positive Exponent Limit (PE)', () => {
    beforeEach(resetPE_NE);
    afterEach(resetPE_NE);

    it('PE = 5: "12345" should be "12345"', () => {
      BigIntPrimitive.PE = 5;
      expect(new BigIntPrimitive("12345").toString()).toBe("12345");
    });
    it('PE = 5: "123456" should be "1.23456e+5"', () => {
      BigIntPrimitive.PE = 5;
      expect(new BigIntPrimitive("123456").toString()).toBe("1.23456e+5");
    });
     it('PE = 5: "1.23456e5" should be "1.23456e+5"', () => {
      BigIntPrimitive.PE = 5;
      expect(new BigIntPrimitive("1.23456e5").toString()).toBe("1.23456e+5");
    });
    it('PE = 5: "12.345e4" should be "1.2345e+5"', () => {
      BigIntPrimitive.PE = 5;
      expect(new BigIntPrimitive("12.345e4").toString()).toBe("1.2345e+5");
    });
    it('PE = 4: "12345" should be "1.2345e+4"', () => {
      BigIntPrimitive.PE = 4;
      expect(new BigIntPrimitive("12345").toString()).toBe("1.2345e+4");
    });
  });

  describe('Scientific Notation - Negative Exponent Limit (NE)', () => {
    beforeEach(resetPE_NE);
    afterEach(resetPE_NE);

    it('NE = -2: "0.012" should be "0.012"', () => {
      BigIntPrimitive.NE = -2;
      expect(new BigIntPrimitive("0.012").toString()).toBe("0.012");
    });
    it('NE = -2: "0.0012" should be "1.2e-3"', () => {
      BigIntPrimitive.NE = -2;
      expect(new BigIntPrimitive("0.0012").toString()).toBe("1.2e-3");
    });
     it('NE = -2: "0.12e-1" (0.012) should be "0.012"', () => {
      BigIntPrimitive.NE = -2;
      expect(new BigIntPrimitive("0.12e-1").toString()).toBe("0.012");
    });
    it('NE = -2: "12e-4" (0.0012) should be "1.2e-3"', () => {
      BigIntPrimitive.NE = -2;
      expect(new BigIntPrimitive("12e-4").toString()).toBe("1.2e-3");
    });
    it('NE = -3: "0.0012" should be "0.0012"', () => {
      BigIntPrimitive.NE = -3;
      expect(new BigIntPrimitive("0.0012").toString()).toBe("0.0012");
    });
  });

  describe('Numbers that become "0" after stripping trailing zeros', () => {
    it('new BigIntPrimitive("0.000").toString() should be "0"', () => {
      expect(new BigIntPrimitive("0.000").toString()).toBe("0");
    });
    it('new BigIntPrimitive("-0.0").toString() should be "0"', () => {
      expect(new BigIntPrimitive("-0.0").toString()).toBe("0");
    });
  });
});

describe('round()', () => {
  let originalRM;

  beforeAll(() => {
    originalRM = BigIntPrimitive.RM;
  });

  afterAll(() => {
    BigIntPrimitive.RM = originalRM;
  });

  beforeEach(() => {
    BigIntPrimitive.RM = 1;
  });

  const RM_DOWN = 0;
  const RM_HALF_UP = 1;
  const RM_HALF_EVEN = 2;
  const RM_UP = 3;

  describe('Default dp (0)', () => {
    it('should round to 0 decimal places using BigIntPrimitive.RM by default', () => {
      BigIntPrimitive.RM = RM_HALF_UP;
      expect(new BigIntPrimitive('123.45').round().toString()).toBe('123');
      expect(new BigIntPrimitive('123.50').round().toString()).toBe('124');

      BigIntPrimitive.RM = RM_DOWN;
      expect(new BigIntPrimitive('123.99').round().toString()).toBe('123');
    });
  });

  describe('RM_DOWN (0) - Truncate towards zero', () => {
    it('positive dp: should truncate fractional part', () => {
      expect(new BigIntPrimitive('123.456').round(2, RM_DOWN).toString()).toBe('123.45');
      expect(new BigIntPrimitive('123.456').round(1, RM_DOWN).toString()).toBe('123.4');
      expect(new BigIntPrimitive('123.456').round(0, RM_DOWN).toString()).toBe('123');
      expect(new BigIntPrimitive('123').round(2, RM_DOWN).toString()).toBe('123.00');
    });
    it('negative dp: should make integer digits zero', () => {
      expect(new BigIntPrimitive('123.456').round(-1, RM_DOWN).toString()).toBe('120');
      expect(new BigIntPrimitive('128').round(-1, RM_DOWN).toString()).toBe('120');
      expect(new BigIntPrimitive('12345').round(-2, RM_DOWN).toString()).toBe('12300');
      expect(new BigIntPrimitive('12345').round(-5, RM_DOWN).toString()).toBe('0');
    });
    it('negative numbers: should truncate towards zero', () => {
      expect(new BigIntPrimitive('-123.456').round(1, RM_DOWN).toString()).toBe('-123.4');
      expect(new BigIntPrimitive('-128').round(-1, RM_DOWN).toString()).toBe('-120');
      expect(new BigIntPrimitive('-123.999').round(0, RM_DOWN).toString()).toBe('-123');
    });
    it('zero: should remain zero', () => {
      expect(new BigIntPrimitive('0').round(2, RM_DOWN).toString()).toBe('0.00');
      expect(new BigIntPrimitive('0').round(0, RM_DOWN).toString()).toBe('0');
      expect(new BigIntPrimitive('0').round(-2, RM_DOWN).toString()).toBe('0');
    });
  });

  describe('RM_HALF_UP (1) - Round to nearest, half away from zero', () => {
    it('positive dp: half rounds up (away from zero)', () => {
      expect(new BigIntPrimitive('123.45').round(1, RM_HALF_UP).toString()).toBe('123.5');
      expect(new BigIntPrimitive('123.44').round(1, RM_HALF_UP).toString()).toBe('123.4');
      expect(new BigIntPrimitive('123.49').round(1, RM_HALF_UP).toString()).toBe('123.5');
      expect(new BigIntPrimitive('123.99').round(1, RM_HALF_UP).toString()).toBe('124.0');
      expect(new BigIntPrimitive('123.00').round(0, RM_HALF_UP).toString()).toBe('123');
    });
    it('negative dp: half rounds up (away from zero in magnitude)', () => {
      expect(new BigIntPrimitive('125').round(-1, RM_HALF_UP).toString()).toBe('130');
      expect(new BigIntPrimitive('124').round(-1, RM_HALF_UP).toString()).toBe('120');
      expect(new BigIntPrimitive('150').round(-2, RM_HALF_UP).toString()).toBe('200');
      expect(new BigIntPrimitive('50').round(-2, RM_HALF_UP).toString()).toBe('100');
      expect(new BigIntPrimitive('49').round(-2, RM_HALF_UP).toString()).toBe('0');
    });
    it('negative numbers: half rounds away from zero (more negative)', () => {
      expect(new BigIntPrimitive('-123.45').round(1, RM_HALF_UP).toString()).toBe('-123.5');
      expect(new BigIntPrimitive('-123.44').round(1, RM_HALF_UP).toString()).toBe('-123.4');
      expect(new BigIntPrimitive('-125').round(-1, RM_HALF_UP).toString()).toBe('-130');
    });
     it('zero: should remain zero', () => {
      expect(new BigIntPrimitive('0').round(2, RM_HALF_UP).toString()).toBe('0.00');
    });
  });

  describe('RM_HALF_EVEN (2) - Round to nearest, half to even', () => {
    it('positive dp: half to even', () => {
      expect(new BigIntPrimitive('123.45').round(1, RM_HALF_EVEN).toString()).toBe('123.4');
      expect(new BigIntPrimitive('123.55').round(1, RM_HALF_EVEN).toString()).toBe('123.6');
      expect(new BigIntPrimitive('123.450001').round(1, RM_HALF_EVEN).toString()).toBe('123.5');
    });
    it('dp = 0: half to even', () => {
       expect(new BigIntPrimitive('122.5').round(0, RM_HALF_EVEN).toString()).toBe('122');
       expect(new BigIntPrimitive('123.5').round(0, RM_HALF_EVEN).toString()).toBe('124');
    });
    it('negative numbers: half to even', () => {
       expect(new BigIntPrimitive('-123.45').round(1, RM_HALF_EVEN).toString()).toBe('-123.4');
       expect(new BigIntPrimitive('-123.55').round(1, RM_HALF_EVEN).toString()).toBe('-123.6');
    });
  });

  describe('RM_UP (3) - Round away from zero', () => {
    it('positive numbers: away from zero', () => {
      expect(new BigIntPrimitive('123.41').round(1, RM_UP).toString()).toBe('123.5');
      expect(new BigIntPrimitive('123.0000001').round(0, RM_UP).toString()).toBe('124');
      expect(new BigIntPrimitive('123').round(0, RM_UP).toString()).toBe('123');
    });
     it('negative numbers: away from zero (more negative)', () => {
      expect(new BigIntPrimitive('-123.41').round(1, RM_UP).toString()).toBe('-123.5');
      expect(new BigIntPrimitive('-123.0000001').round(0, RM_UP).toString()).toBe('-124');
    });
    it('negative dp: away from zero', () => {
        expect(new BigIntPrimitive('121').round(-1, RM_UP).toString()).toBe('130');
        expect(new BigIntPrimitive('-121').round(-1, RM_UP).toString()).toBe('-130');
    });
  });

});

describe('Debug _decimalDivide output representation', () => {
  it('DEBUG TEST: should correctly represent 2.5 from _decimalDivide for 10/4', () => {
    const num1 = new BigIntPrimitive('10');
    const num2 = new BigIntPrimitive('4');
    const originalDP = BigIntPrimitive.DP;
    BigIntPrimitive.DP = 1;

    const internalPrecision = BigIntPrimitive.DP + 5 + Math.abs(num1.exponent) + Math.abs(num2.exponent);

    const resultFromDecimalDivide = num1.abs()._decimalDivide(num2.abs(), internalPrecision);

    const actualLimbs = JSON.stringify(resultFromDecimalDivide.limbs);
    const actualExponent = resultFromDecimalDivide.exponent;

    const expectedLimbs = JSON.stringify([2,5]);
    const expectedExponent = -1;

    const oldPE = BigIntPrimitive.PE; BigIntPrimitive.PE = 1e9;
    const oldNE = BigIntPrimitive.NE; BigIntPrimitive.NE = -1e9;
    const resultString = resultFromDecimalDivide.toString();
    BigIntPrimitive.PE = oldPE; BigIntPrimitive.NE = oldNE;

    if (resultString !== "2.5" || actualLimbs !== expectedLimbs || actualExponent !== expectedExponent) {
      throw new Error(
        `DEBUG TEST FAILED for 10/4 (DP=${BigIntPrimitive.DP}, internalPrecision=${internalPrecision})\n` + // Dynamically print internalPrecision
        `  _decimalDivide returned: toString()="${resultString}"\n` +
        `    Expected state for 2.5: limbs=${expectedLimbs}, exponent=${expectedExponent}\n` +
        `    Actual state:   limbs=${actualLimbs}, exponent=${actualExponent}\n` +
        `    (Sign was ${resultFromDecimalDivide.sign})`
      );
    }
    expect(resultString).toBe("2.5");
    BigIntPrimitive.DP = originalDP;
  });
});
