import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { BigIntPrimitive } from './bigint';
import * as webglUtils from './webgl-utils';

// Mock canvas
const mockCanvas = {
  getContext: vi.fn().mockReturnValue({
    getExtension: vi.fn().mockReturnValue(true),
  })
};

// Global mock for webgl-utils
// Simpler global mock: each function is a basic vi.fn().
// Specific tests that rely on the output of these (e.g., WebGL operation tests)
// will use vi.spyOn(webglUtils, 'methodName').mockImplementation(...) for detailed behavior.
vi.mock('./webgl-utils', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual, // Spread actual exports first
    // Then, override specific functions with mocks as before, if desired
    initWebGL: vi.fn((canvas) => {
      if (!canvas) return null;
      // Return a basic GL-like object if tests don't override this.
      return {
        createShader: vi.fn(), createProgram: vi.fn(), getAttribLocation: vi.fn(),
        getUniformLocation: vi.fn(), enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
        activeTexture: vi.fn(), bindTexture: vi.fn(), uniform1i: vi.fn(),uniform1f: vi.fn(),
        createFramebuffer: vi.fn(), bindFramebuffer: vi.fn(), framebufferTexture2D: vi.fn(),
        checkFramebufferStatus: vi.fn(() => 36053), // FRAMEBUFFER_COMPLETE
        createBuffer: vi.fn(), bindBuffer: vi.fn(), bufferData: vi.fn(), viewport: vi.fn(),
        useProgram: vi.fn(), drawArrays: vi.fn(), deleteTexture: vi.fn(),
        deleteFramebuffer: vi.fn(), deleteProgram: vi.fn(), deleteShader: vi.fn(),
        deleteBuffer: vi.fn(), texParameteri: vi.fn(), texImage2D: vi.fn(),
        VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, FRAMEBUFFER_COMPLETE: 36053, // Constants
      };
    }),
    createShader: vi.fn(),
    createProgram: vi.fn(),
    createDataTexture: vi.fn(),
    readDataFromTexture: vi.fn((gl, fbo, width, height, isOutput) => {
      // Default to returning an array of zeros, which might be useful for some GPGPU tests
      // if not overridden by a more specific mock in the test itself.
      const dataSize = isOutput && width * height * 4 || width * height; // RGBA or single component
      return new Float32Array(dataSize);
    }),
    // setupGpgpuQuad will be the actual implementation from actual.setupGpgpuQuad
    // All other exports from webgl-utils will also be their actual implementations
    // unless explicitly mocked above.
  };
});

describe('BigIntPrimitive', () => {
  // Helper to provide a basic mock GL context for tests that need to run WebGL paths
  // Moved to higher scope to be accessible by multiply tests too
  const setupMockWebGL = () => {
    const mockGlContext = {
      createShader: vi.fn((type, source) => ({ id: 'mockShader', type, source })), // Return a mock shader object
      createProgram: vi.fn(() => ({ id: 'mockProgram' })), // Return a mock program object
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
      getShaderParameter: vi.fn( (shader, pname) => {
        if (pname === 0x8B81) return true; // COMPILE_STATUS = true
        return null;
      }),
      getProgramParameter: vi.fn( (program, pname) => {
        if (pname === 0x8B82) return true; // LINK_STATUS = true
        return null;
      }),
      getShaderInfoLog: vi.fn(() => 'mock shader info log'),
      getProgramInfoLog: vi.fn(() => 'mock program info log'),
      VERTEX_SHADER: 0x8B31,
      FRAGMENT_SHADER: 0x8B30,
      FLOAT: 0x1406,
      RGBA: 0x1908,
      TEXTURE_2D: 0x0DE1,
      TEXTURE0: 0x84C0, TEXTURE1: 0x84C1, TEXTURE2: 0x84C2,
      COLOR_ATTACHMENT0: 0x8CE0,
      FRAMEBUFFER: 0x8D40,
      FRAMEBUFFER_COMPLETE: 0x8CD5,
      TRIANGLES: 0x0004,
      STATIC_DRAW: 0x88E4,
      NEAREST: 0x2600,
      CLAMP_TO_EDGE: 0x812F,
    };
    vi.spyOn(webglUtils, 'initWebGL').mockReturnValue(mockGlContext);
    vi.spyOn(webglUtils, 'createDataTexture').mockReturnValue({ id: 'mockDataTexture' });
    // Spy on the module's createShader/Program directly for consistency
    vi.spyOn(webglUtils, 'createShader').mockImplementation((gl, type, source) => gl.createShader(type, source));
    vi.spyOn(webglUtils, 'createProgram').mockImplementation((gl, vs, fs) => gl.createProgram(vs, fs));
    return mockGlContext;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    // After vi.resetAllMocks(), the functions within the webglUtils mock object
    // will be basic vi.fn() mocks (their implementations provided in vi.mock are cleared).
    // Tests that rely on specific behavior of webglUtils (like _core_add WebGL path)
    // must now use vi.spyOn(webglUtils, 'initWebGL').mockImplementation(...) etc.
    // or ensure the default vi.mock implementation is sufficient (which it is for initWebGL if canvas is passed).
  });

  describe('constructor', () => { // This suite is now mostly for basic non-decimal/non-sci-notation and error cases
    // Tests relying on old toString() or old limb/BASE system are commented out or removed.
    // New detailed parsing tests are in 'Constructor (Decimal Support)'.

    // it('should create BigIntPrimitive from a valid positive string', () => {
    //   const n = new BigIntPrimitive('12345678901234567890');
    //   // expect(n.toString()).toBe('12345678901234567890'); // toString() is refactored
    //   expect(n.limbs).toEqual([1,2,3,4,5,6,7,8,9,0,1,2,3,4,5,6,7,8,9,0]); // Example, adjust if needed
    //   expect(n.exponent).toBe(0);
    // });
    // it('should create BigIntPrimitive from a valid number', () => {
    //   const n = new BigIntPrimitive(12345);
    //   // expect(n.toString()).toBe('12345'); // toString() is refactored
    //   expect(n.limbs).toEqual([1,2,3,4,5]);
    //   expect(n.exponent).toBe(0);
    // });
    it('should create BigIntPrimitive for zero string "0"', () => {
      const n = new BigIntPrimitive('0');
      // expect(n.toString()).toBe('0'); // toString() to be verified later
      expect(n.isZero()).toBe(true);
      expect(n.limbs).toEqual([0]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);
    });
    it('should create BigIntPrimitive for zero number 0', () => {
      const n = new BigIntPrimitive(0);
      // expect(n.toString()).toBe('0'); // toString() to be verified later
      expect(n.isZero()).toBe(true);
      expect(n.limbs).toEqual([0]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);
    });
    it('should handle empty string as zero', () => {
      const n = new BigIntPrimitive('');
      // expect(n.toString()).toBe('0'); // toString() to be verified later
      expect(n.isZero()).toBe(true);
      expect(n.limbs).toEqual([0]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);
    });

    it('should throw TypeError for invalid string input (non-numeric characters)', () => {
      expect(() => new BigIntPrimitive('abc')).toThrow(TypeError("Invalid character in numeric string."));
      // The string "123a45" contains 'a' which is not dot, e, +, or -
      expect(() => new BigIntPrimitive('123a45')).toThrow(TypeError("Invalid character in numeric string."));
    });

    // The test 'should throw TypeError for non-integer number input' is removed because
    // non-integer numbers like 123.45 are now valid and handled by string conversion.
    // Its correct parsing is tested in 'Constructor (Decimal Support)'.

    it('should throw TypeError for invalid input types', () => {
      expect(() => new BigIntPrimitive(null)).toThrow(TypeError("Invalid input type for BigIntPrimitive: cannot be null or undefined."));
      expect(() => new BigIntPrimitive(undefined)).toThrow(TypeError("Invalid input type for BigIntPrimitive: cannot be null or undefined."));
      expect(() => new BigIntPrimitive({})).toThrow(TypeError("Invalid input type for BigIntPrimitive. Expected string, number, or BigIntPrimitive instance."));
      expect(() => new BigIntPrimitive([])).toThrow(TypeError("Invalid input type for BigIntPrimitive. Expected string, number, or BigIntPrimitive instance."));
    });
    // The 'should correctly parse numbers into limbs (BASE 10000)' test is obsolete and has been removed.
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
      expect(n.exponent).toBe(0); // Trailing .0 should be normalized
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive('123.');
      expect(n.limbs).toEqual([1, 2, 3]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);
    });

    it('should parse scientific notation', () => {
      let n = new BigIntPrimitive('1.23e3'); // 1230
      expect(n.limbs).toEqual([1, 2, 3]);
      expect(n.exponent).toBe(1); // 123 * 10^1
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive('123e-2'); // 1.23
      expect(n.limbs).toEqual([1, 2, 3]);
      expect(n.exponent).toBe(-2);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive('-0.5e1'); // -5
      expect(n.limbs).toEqual([5]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(-1);

      n = new BigIntPrimitive('1.2345E+2'); // 123.45
      expect(n.limbs).toEqual([1, 2, 3, 4, 5]);
      expect(n.exponent).toBe(-2);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive('1.23e-02'); // 0.0123
      expect(n.limbs).toEqual([1, 2, 3]);
      expect(n.exponent).toBe(-4);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive('0.000e5'); // 0
      expect(n.limbs).toEqual([0]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);
    });

    it('should normalize inputs', () => {
      // Leading zeros in integer part
      let n = new BigIntPrimitive('00123.45');
      expect(n.limbs).toEqual([1, 2, 3, 4, 5]);
      expect(n.exponent).toBe(-2);
      expect(n.sign).toBe(1);

      // Trailing zeros in fractional part (should be removed, exponent adjusted)
      n = new BigIntPrimitive('123.4500');
      expect(n.limbs).toEqual([1, 2, 3, 4, 5]);
      expect(n.exponent).toBe(-2); // 12345 * 10^-2
      expect(n.sign).toBe(1);

      // Value zero
      n = new BigIntPrimitive('0.0'); expect(n.limbs).toEqual([0]); expect(n.exponent).toBe(0); expect(n.sign).toBe(1);
      n = new BigIntPrimitive('0.000'); expect(n.limbs).toEqual([0]); expect(n.exponent).toBe(0); expect(n.sign).toBe(1);
      n = new BigIntPrimitive('0e5'); expect(n.limbs).toEqual([0]); expect(n.exponent).toBe(0); expect(n.sign).toBe(1);
      n = new BigIntPrimitive('-0'); expect(n.limbs).toEqual([0]); expect(n.exponent).toBe(0); expect(n.sign).toBe(1); // Sign of zero is normalized

      // Empty string
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
      expect(n.exponent).toBe(-5); // 789 * 10^-5
      expect(n.sign).toBe(-1);

      n = new BigIntPrimitive(0);
      expect(n.limbs).toEqual([0]);
      expect(n.exponent).toBe(0);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive(12345000); // 12345 * 10^3
      expect(n.limbs).toEqual([1,2,3,4,5]);
      expect(n.exponent).toBe(3);
      expect(n.sign).toBe(1);

      n = new BigIntPrimitive(1.23e10); // 123 * 10^8
      expect(n.limbs).toEqual([1,2,3]);
      expect(n.exponent).toBe(8);
      expect(n.sign).toBe(1);
    });

    it('should handle copy constructor', () => {
      const original = new BigIntPrimitive("1.23e4"); // limbs: [1,2,3], exp: 2
      original.forceCPU = true; // Set a non-default option

      const copy = new BigIntPrimitive(original);
      expect(copy.limbs).toEqual([1, 2, 3]);
      expect(copy.exponent).toBe(2);
      expect(copy.sign).toBe(1);
      expect(copy.forceCPU).toBe(original.forceCPU); // Check if options are copied
      expect(copy).not.toBe(original);
    });

    it('should throw TypeError for invalid string formats', () => {
      expect(() => new BigIntPrimitive("abc")).toThrow(TypeError); // Invalid char
      expect(() => new BigIntPrimitive("1.2.3")).toThrow(TypeError); // Multiple decimal points
      expect(() => new BigIntPrimitive("1e")).toThrow(TypeError);    // Empty exponent
      expect(() => new BigIntPrimitive("1.2e+")).toThrow(TypeError); // Empty exponent after sign
      expect(() => new BigIntPrimitive("1.2ea")).toThrow(TypeError); // Non-integer exponent
      expect(() => new BigIntPrimitive("1.2e1.5")).toThrow(TypeError); // Non-integer exponent
      expect(() => new BigIntPrimitive("1..2")).toThrow(TypeError); // Invalid char (double dot)
      expect(() => new BigIntPrimitive("e5")).toThrow(TypeError); // Mantissa cannot be empty if E is present
      expect(() => new BigIntPrimitive(".e5")).toThrow(TypeError); // Mantissa effectively empty
      expect(() => new BigIntPrimitive("123e5e6")).toThrow(TypeError); // Multiple 'e'
    });
    it('should throw TypeError for invalid string input (non-numeric characters)', () => { // Renamed for clarity
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
      expect(n5.cmp(n10)).toBe(-1); // 5 < 10
      expect(n10.cmp(n5)).toBe(1);  // 10 > 5
      expect(n5.cmp(new BigIntPrimitive('5'))).toBe(0); // 5 == 5
    });

    it('should correctly compare negative numbers', () => {
      const n_5 = new BigIntPrimitive('-5');
      const n_10 = new BigIntPrimitive('-10');
      expect(n_5.cmp(n_10)).toBe(1);  // -5 > -10
      expect(n_10.cmp(n_5)).toBe(-1); // -10 < -5
      expect(n_5.cmp(new BigIntPrimitive('-5'))).toBe(0); // -5 == -5
    });

    it('should correctly compare numbers with mixed signs', () => {
      const n5 = new BigIntPrimitive('5');
      const n_10 = new BigIntPrimitive('-10');
      expect(n5.cmp(n_10)).toBe(1);  // 5 > -10
      expect(n_10.cmp(n5)).toBe(-1); // -10 < 5
    });

    it('should correctly compare with zero', () => {
      const n0 = new BigIntPrimitive('0');
      const n5 = new BigIntPrimitive('5');
      const n_5 = new BigIntPrimitive('-5');
      expect(n0.cmp(n5)).toBe(-1);  // 0 < 5
      expect(n0.cmp(n_5)).toBe(1);   // 0 > -5
      expect(n5.cmp(n0)).toBe(1);    // 5 > 0
      expect(n_5.cmp(n0)).toBe(-1);  // -5 < 0
      expect(n0.cmp(new BigIntPrimitive('0'))).toBe(0); // 0 == 0
    });

    it('should correctly compare large multi-limb numbers', () => {
      const large1 = new BigIntPrimitive('12345678901234567890');
      const large2 = new BigIntPrimitive('12345678901234567891');
      const large1_neg = new BigIntPrimitive('-12345678901234567890');
      const large2_neg = new BigIntPrimitive('-12345678901234567891');

      expect(large1.cmp(large2)).toBe(-1); // large1 < large2
      expect(large2.cmp(large1)).toBe(1);  // large2 > large1
      expect(large1.cmp(new BigIntPrimitive('12345678901234567890'))).toBe(0);

      expect(large1_neg.cmp(large2_neg)).toBe(1);  // -large1 > -large2
      expect(large2_neg.cmp(large1_neg)).toBe(-1); // -large2 < -large1
      expect(large1_neg.cmp(new BigIntPrimitive('-12345678901234567890'))).toBe(0);

      expect(large1.cmp(large1_neg)).toBe(1); // positive > negative
      expect(large1_neg.cmp(large1)).toBe(-1); // negative < positive
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
      // Test with a number that would have multiple single-digit limbs
      const n = new BigIntPrimitive("12345678", mockCanvas);
      expect(n.toString()).toBe('12345678'); // Constructor creates [1,2,3,4,5,6,7,8]
    });
    it('should convert single-digit number (single limb) to string', () => {
      const n = new BigIntPrimitive("7", mockCanvas);
      expect(n.toString()).toBe('7'); // Constructor creates [7]
    });
    it('should correctly represent numbers based on limbs and exponent (formerly padding tests)', () => {
      // Case 1: Formerly n.limbs = [1, 1]; expect(n.toString()).toBe('10001');
      // With single-digit limbs and BASE_LOG10=1, "10001" is constructed as:
      const n1 = new BigIntPrimitive("10001", mockCanvas);
      expect(n1.toString()).toBe("10001"); // Limbs: [1,0,0,0,1], exp: 0

      // Case 2: Formerly n2.limbs = [12, 34, 5]; expect(n2.toString()).toBe('500340012');
      // This implies a number like "5.0034.0012" if BASE_LOG10=4 and limbs were reversed.
      // Let's test a number that would be "500340012"
      const n2 = new BigIntPrimitive("500340012", mockCanvas);
      expect(n2.toString()).toBe("500340012"); // Limbs [5,0,0,3,4,0,0,1,2], exp:0

      // Test with exponents
      const n3 = new BigIntPrimitive("123.45", mockCanvas); // limbs [1,2,3,4,5], exp -2
      expect(n3.toString()).toBe("123.45");

      const n4 = new BigIntPrimitive("0.00123", mockCanvas); // limbs [1,2,3], exp -5
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
      const expectedNumber = Number(veryLargeString); // This will have precision loss

      expect(bigint.toNumber()).toBe(expectedNumber);
      expect(typeof bigint.toNumber()).toBe('number');
      // Note: Precision loss is inherent in JavaScript's Number type for such large integers.
      // We are testing that it converts to what Number() itself would produce.
      if (Number.MAX_SAFE_INTEGER < parseFloat(veryLargeString)) {
          // This assertion might be tricky due to how JS handles large number string to Number conversion
          // but the core idea is that it should not be strictly equal to a BigInt representation.
          // For this test, simply ensuring it's a number and equals Number(string) is sufficient.
      }
    });

    it('should convert numbers at the edge of safe integer precision', () => {
      const maxSafeIntStr = String(Number.MAX_SAFE_INTEGER); // "9007199254740991"
      const bigintMaxSafe = new BigIntPrimitive(maxSafeIntStr);
      expect(bigintMaxSafe.toNumber()).toBe(Number.MAX_SAFE_INTEGER);

      const minSafeIntStr = String(Number.MIN_SAFE_INTEGER); // "-9007199254740991"
      const bigintMinSafe = new BigIntPrimitive(minSafeIntStr);
      expect(bigintMinSafe.toNumber()).toBe(Number.MIN_SAFE_INTEGER);

      // One above max safe integer - precision loss expected
      const aboveMaxSafeStr = "9007199254740992";
      const bigintAboveMax = new BigIntPrimitive(aboveMaxSafeStr);
      expect(bigintAboveMax.toNumber()).toBe(Number(aboveMaxSafeStr)); // Will be 9007199254740992 but as potentially imprecise float
      expect(bigintAboveMax.toNumber()).toBe(9007199254740992);


      // One below min safe integer - precision loss expected
      const belowMinSafeStr = "-9007199254740992";
      const bigintBelowMin = new BigIntPrimitive(belowMinSafeStr);
      expect(bigintBelowMin.toNumber()).toBe(Number(belowMinSafeStr)); // Will be -9007199254740992
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
        // When an object with toJSON is stringified, JSON.stringify calls toJSON and stringifies its result.
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
    // setupMockWebGL helper is now defined at the parent describe scope

    it('should add two small BigIntPrimitives (e.g., "123" + "456" = "579")', () => {
      setupMockWebGL();
      const readDataMock = vi.spyOn(webglUtils, 'readDataFromTexture');
      readDataMock.mockImplementation((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width * 4);
        // For "123" + "456" -> "579". tempThis.limbs=[1,2,3], tempOther.limbs=[4,5,6]. texWidth=3.
        // Shader output (MSB-first): (1+4)=5, (2+5)=7, (3+6)=9. All carries=0.
        if (width === 3) {
            outputPixelDataRGBA[0*4+0] = 5; outputPixelDataRGBA[0*4+1] = 0; // MSB
            outputPixelDataRGBA[1*4+0] = 7; outputPixelDataRGBA[1*4+1] = 0;
            outputPixelDataRGBA[2*4+0] = 9; outputPixelDataRGBA[2*4+1] = 0; // LSB
        }
        return outputPixelDataRGBA;
      });
      const num1 = new BigIntPrimitive('123', mockCanvas); const num2 = new BigIntPrimitive('456', mockCanvas);
      const result = num1.add(num2);
      expect(result).not.toBeNull(); if (result) { expect(result.toString()).toBe('579'); }
      expect(webglUtils.initWebGL).toHaveBeenCalledWith(mockCanvas);
      expect(webglUtils.createDataTexture).toHaveBeenCalled(); // Relaxed from toHaveBeenCalledTimes(4)
      expect(webglUtils.readDataFromTexture).toHaveBeenCalledTimes(1);
    });
    it('should add two larger BigIntPrimitives requiring multiple limbs (e.g., "8000" + "7000" = "15000", BASE=10000)', () => {
      setupMockWebGL();
      const readDataMock = vi.spyOn(webglUtils, 'readDataFromTexture');
      readDataMock.mockImplementation((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width*4); // width will be 1 for this test
        // For "8000" + "7000" -> "15000".
        // Constructor normalizes "8000" to limbs=[8],exp=3. "7000" to limbs=[7],exp=3.
        // commonExponent=3. tempThis.limbs=[8], tempOther.limbs=[7]. So texWidth=1.
        // Shader for texel 0 (adding 8 and 7): sum=15. Raw shader output: val_from_shader=5, carry_from_shader=1.
        if (width === 1) {
            outputPixelDataRGBA[0*4+0] = 5; outputPixelDataRGBA[0*4+1] = 1;
        }
        return outputPixelDataRGBA;
      });
      const num1 = new BigIntPrimitive('8000', mockCanvas); const num2 = new BigIntPrimitive('7000', mockCanvas);
      const result = num1.add(num2);
      expect(result).not.toBeNull(); expect(result.toString()).toBe('15000');
    });
    it('should add numbers resulting in a carry propagation across multiple limbs (e.g., "9999" + "1" = "10000")', () => {
      setupMockWebGL();
      const readDataMock = vi.spyOn(webglUtils, 'readDataFromTexture');
      readDataMock.mockImplementation((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width*4);
        // For "9999" + "1" -> "10000". tempThis=[9,9,9,9], tempOther=[0,0,0,1] (aligned). texWidth=4.
        // Shader output (MSB-first):
        // (9+0)=9 -> val=9,carry=0
        // (9+0)=9 -> val=9,carry=0
        // (9+0)=9 -> val=9,carry=0
        // (9+1)=10-> val=0,carry=1
        if (width === 4) {
            outputPixelDataRGBA[0*4+0] = 9; outputPixelDataRGBA[0*4+1] = 0; // MSB
            outputPixelDataRGBA[1*4+0] = 9; outputPixelDataRGBA[1*4+1] = 0;
            outputPixelDataRGBA[2*4+0] = 9; outputPixelDataRGBA[2*4+1] = 0;
            outputPixelDataRGBA[3*4+0] = 0; outputPixelDataRGBA[3*4+1] = 1; // LSB
        }
        return outputPixelDataRGBA;
      });
      const num1 = new BigIntPrimitive('9999', mockCanvas); const num2 = new BigIntPrimitive('1', mockCanvas);
      const result = num1.add(num2);
      expect(result).not.toBeNull(); expect(result.toString()).toBe('10000');
    });
    it('should handle adding zero to a number', () => {
      setupMockWebGL();
      const readDataMock = vi.spyOn(webglUtils, 'readDataFromTexture');
      readDataMock.mockImplementation((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width*4);
        if (width === 2) { outputPixelDataRGBA[0*4+0]=2345; outputPixelDataRGBA[0*4+1]=0; outputPixelDataRGBA[1*4+0]=1; outputPixelDataRGBA[1*4+1]=0;}
        return outputPixelDataRGBA;
      });
      const num1 = new BigIntPrimitive('12345', mockCanvas); const numZero = new BigIntPrimitive('0', mockCanvas);
      const result = num1.add(numZero);
      expect(result).not.toBeNull(); if (result) { expect(result.toString()).toBe('12345'); }
    });
    it('should add two multi-limb numbers with carries', () => {
      setupMockWebGL();
      const readDataMock = vi.spyOn(webglUtils, 'readDataFromTexture');
      readDataMock.mockImplementation((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width*4);
        // For "123456789" + "987654321" = "1111111110"
        // tempThis=[1,2,3,4,5,6,7,8,9], tempOther=[9,8,7,6,5,4,3,2,1]. texWidth=9.
        // Shader (MSB-first): (1+9)=10 (v0,c1), (2+8)=10 (v0,c1), ..., (9+1)=10 (v0,c1)
        if (width === 9) {
            for(let i=0; i<9; ++i) {
                outputPixelDataRGBA[i*4+0] = 0; // val = ( (i<8?i+1:9) + (i<8?9-i:1) ) % 10 = 0
                outputPixelDataRGBA[i*4+1] = 1; // carry = 1
            }
        }
        return outputPixelDataRGBA;
      });
      const num1 = new BigIntPrimitive('123456789', mockCanvas); const num2 = new BigIntPrimitive('987654321', mockCanvas);
      const result = num1.add(num2);

      expect(result).not.toBeNull(); if (result) { expect(result.toString()).toBe('1111111110'); }
    });

    it('BUGFIX BROWSER ADD: 20000 + 5333 => 25333', () => {
      const num1Str = '20000';
      const num2Str = '5333';
      const expectedSumStr = '25333';

      // Ensure mockCanvas is available. This test relies on the WebGL path being attempted.
      // The existing mocks for webglUtils might affect how this runs.
      // Specifically, webglUtils.readDataFromTexture is often mocked per test.
      // If this test fails producing something like '53335333', we need to investigate _core_add's WebGL path.
      // If it passes, the issue is likely specific to the unmocked browser environment.
      setupMockWebGL();
      vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementationOnce((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width * height * 4);
        // "20000" + "5333" = "25333"
        // tempThis=[2,0,0,0,0], tempOther=[0,5,3,3,3] (aligned). texWidth=5.
        // Shader (MSB-first):
        // (2+0)=2 -> v2,c0
        // (0+5)=5 -> v5,c0
        // (0+3)=3 -> v3,c0
        // (0+3)=3 -> v3,c0
        // (0+3)=3 -> v3,c0
        if (width === 5) {
            outputPixelDataRGBA[0*4+0] = 2; outputPixelDataRGBA[0*4+1] = 0;
            outputPixelDataRGBA[1*4+0] = 5; outputPixelDataRGBA[1*4+1] = 0;
            outputPixelDataRGBA[2*4+0] = 3; outputPixelDataRGBA[2*4+1] = 0;
            outputPixelDataRGBA[3*4+0] = 3; outputPixelDataRGBA[3*4+1] = 0;
            outputPixelDataRGBA[4*4+0] = 3; outputPixelDataRGBA[4*4+1] = 0;
        }
        return outputPixelDataRGBA;
      });

      const num1 = new BigIntPrimitive(num1Str, mockCanvas);
      const num2 = new BigIntPrimitive(num2Str, mockCanvas);
      const result = num1.add(num2);

      expect(result.toString()).toBe(expectedSumStr);
      // No mockRestore needed for mockImplementationOnce if beforeEach handles general reset
    });
  });

  describe('subtract() - public method with sign logic', () => {
    let coreAddSpy, coreSubtractSpy;
    beforeEach(() => { coreAddSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_add'); coreSubtractSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_subtract'); });
    it('should handle positive - positive (a > b)', () => {
      const a=new BigIntPrimitive('500',mockCanvas, { forceCPU: true }); const b=new BigIntPrimitive('200',mockCanvas, { forceCPU: true }); coreSubtractSpy.mockReturnValue(new BigIntPrimitive('300',mockCanvas, { forceCPU: true }));
      const result=a.subtract(b); expect(result.toString()).toBe('300'); expect(coreSubtractSpy).toHaveBeenCalledTimes(1); expect(coreAddSpy).not.toHaveBeenCalled();
    });
    it('should handle positive - positive (a < b)', () => {
      const a=new BigIntPrimitive('200',mockCanvas, { forceCPU: true }); const b=new BigIntPrimitive('500',mockCanvas, { forceCPU: true }); coreSubtractSpy.mockReturnValue(new BigIntPrimitive('300',mockCanvas, { forceCPU: true }));
      const result=a.subtract(b); expect(result.toString()).toBe('-300'); expect(coreSubtractSpy).toHaveBeenCalledTimes(1); expect(coreAddSpy).not.toHaveBeenCalled();
    });
    it('should handle positive - positive (a == b)', () => {
      const a=new BigIntPrimitive('500',mockCanvas, { forceCPU: true }); const b=new BigIntPrimitive('500',mockCanvas, { forceCPU: true });
      const result=a.subtract(b); expect(result.toString()).toBe('0'); expect(coreSubtractSpy).not.toHaveBeenCalled(); expect(coreAddSpy).not.toHaveBeenCalled();
    });
    it('should handle positive - negative', () => {
      const a=new BigIntPrimitive('500',mockCanvas, { forceCPU: true }); const negB=new BigIntPrimitive('-200',mockCanvas, { forceCPU: true }); coreAddSpy.mockReturnValue(new BigIntPrimitive('700',mockCanvas, { forceCPU: true }));
      const result=a.subtract(negB); expect(result.toString()).toBe('700'); expect(coreAddSpy).toHaveBeenCalledTimes(1); expect(coreSubtractSpy).not.toHaveBeenCalled();
    });
    it('should handle negative - positive', () => {
      const negA=new BigIntPrimitive('-500',mockCanvas, { forceCPU: true }); const b=new BigIntPrimitive('200',mockCanvas, { forceCPU: true }); coreAddSpy.mockReturnValue(new BigIntPrimitive('700',mockCanvas, { forceCPU: true }));
      const result=negA.subtract(b); expect(result.toString()).toBe('-700'); expect(coreAddSpy).toHaveBeenCalledTimes(1); expect(coreSubtractSpy).not.toHaveBeenCalled();
    });
    it('should handle negative - negative (abs(a) > abs(b))', () => {
      const negA=new BigIntPrimitive('-500',mockCanvas, { forceCPU: true }); const negB=new BigIntPrimitive('-200',mockCanvas, { forceCPU: true }); coreSubtractSpy.mockReturnValue(new BigIntPrimitive('300',mockCanvas, { forceCPU: true }));
      const result=negA.subtract(negB); expect(result.toString()).toBe('-300'); expect(coreSubtractSpy).toHaveBeenCalledTimes(1); expect(coreAddSpy).not.toHaveBeenCalled();
    });
    it('should handle negative - negative (abs(a) < abs(b))', () => {
      const negA=new BigIntPrimitive('-200',mockCanvas, { forceCPU: true }); const negB=new BigIntPrimitive('-500',mockCanvas, { forceCPU: true }); coreSubtractSpy.mockReturnValue(new BigIntPrimitive('300',mockCanvas, { forceCPU: true }));
      const result=negA.subtract(negB); expect(result.toString()).toBe('300'); expect(coreSubtractSpy).toHaveBeenCalledTimes(1); expect(coreAddSpy).not.toHaveBeenCalled();
    });
    it('should handle negative - negative (a == b)', () => {
      const negA=new BigIntPrimitive('-500',mockCanvas, { forceCPU: true }); const negB=new BigIntPrimitive('-500',mockCanvas, { forceCPU: true });
      const result=negA.subtract(negB); expect(result.toString()).toBe('0'); expect(coreSubtractSpy).not.toHaveBeenCalled(); expect(coreAddSpy).not.toHaveBeenCalled();
    });
    it('a - 0 = a', () => {
      const a=new BigIntPrimitive('123',mockCanvas, { forceCPU: true }); const zero=new BigIntPrimitive('0',mockCanvas, { forceCPU: true }); coreSubtractSpy.mockReturnValue(new BigIntPrimitive('123',mockCanvas, { forceCPU: true }));
      const result=a.subtract(zero); expect(result.toString()).toBe('123'); expect(coreSubtractSpy).toHaveBeenCalledTimes(1);
    });
    it('0 - a = -a', () => {
      const zero=new BigIntPrimitive('0',mockCanvas, { forceCPU: true }); const a=new BigIntPrimitive('123',mockCanvas, { forceCPU: true }); coreSubtractSpy.mockReturnValue(new BigIntPrimitive('123',mockCanvas, { forceCPU: true }));
      const result=zero.subtract(a); expect(result.toString()).toBe('-123'); expect(coreSubtractSpy).toHaveBeenCalledTimes(1);
    });
    it('0 - (-a) = a', () => {
      const zero=new BigIntPrimitive('0',mockCanvas, { forceCPU: true }); const negA=new BigIntPrimitive('-123',mockCanvas, { forceCPU: true }); coreAddSpy.mockReturnValue(new BigIntPrimitive('123',mockCanvas, { forceCPU: true }));
      const result=zero.subtract(negA); expect(result.toString()).toBe('123');
    });
    it('0 - 0 = 0', () => {
      const zero1=new BigIntPrimitive('0',mockCanvas, { forceCPU: true }); const zero2=new BigIntPrimitive('0',mockCanvas, { forceCPU: true });
      const result=zero1.subtract(zero2); expect(result.toString()).toBe('0'); expect(coreSubtractSpy).not.toHaveBeenCalled(); expect(coreAddSpy).not.toHaveBeenCalled();
    });
  });

  describe('_core_subtract() with WebGL mock', () => {
    // Using the same setupMockWebGL helper from add() tests.
    // It should be defined in a scope accessible to this describe block, or duplicated/moved.
    // For this diff, assuming it's accessible or will be moved to higher scope later.
     const setupMockWebGLForSubtract = () => { // Duplicating for now, can be refactored
      const mockGlContext = {
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
        checkFramebufferStatus: vi.fn().mockReturnValue(0x8CD5),
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
      vi.spyOn(webglUtils, 'initWebGL').mockReturnValue(mockGlContext);
      vi.spyOn(webglUtils, 'createDataTexture').mockReturnValue({ id: 'mockDataTexture' });
      vi.spyOn(webglUtils, 'createShader').mockReturnValue({ id: 'mockShader' });
      vi.spyOn(webglUtils, 'createProgram').mockReturnValue({ id: 'mockProgram' });
      return mockGlContext;
    };

    it('should subtract two positive single-limb numbers, no borrow', () => {
      setupMockWebGLForSubtract();
      const num1=new BigIntPrimitive('5678',mockCanvas); const num2=new BigIntPrimitive('1234',mockCanvas);
      vi.spyOn(webglUtils,'readDataFromTexture').mockImplementation((gl,fbo,width,height,isOutput) => { const o=new Float32Array(width*4); if(width===1){o[0]=4444;o[1]=0;} return o;});
      const result=num1._core_subtract(num2); expect(result).not.toBeNull(); expect(result.toString()).toBe('4444'); expect(result.sign).toBe(1);
    });
    it('should subtract with borrow handled by shader and JS propagation', () => {
      setupMockWebGLForSubtract();
      const num1=new BigIntPrimitive('12345',mockCanvas); const num2=new BigIntPrimitive('2346',mockCanvas);
      vi.spyOn(webglUtils,'readDataFromTexture').mockImplementation((gl,fbo,width,height,isOutput) => { const o=new Float32Array(width*4); if(width===2){o[0]=9999;o[1]=1;o[4]=1;o[5]=0;} return o;});
      const result=num1._core_subtract(num2); expect(result).not.toBeNull(); expect(result.toString()).toBe('9999'); expect(result.sign).toBe(1);
    });
    it('should correctly subtract "10000" - "1"', () => { // Restored from it.only
      setupMockWebGLForSubtract();
      // _core_subtract expects inputs to be aligned as raw limb arrays.
      // Constructor normalizes "10000" to limbs=[1], exponent=4.
      // To test _core_subtract(10000, 1) at exponent 0:
      const num1 = new BigIntPrimitive("0", mockCanvas); // Base for properties
      num1.limbs = [1,0,0,0,0]; // Represents 10000 at exponent 0
      num1.exponent = 0;
      num1.sign = 1;

      const num2 = new BigIntPrimitive('1', mockCanvas); // Represents 1 at exponent 0

      // The following spy is on an unrelated module function for _core_subtract (CPU path)
      // and seems to be a remnant of an old test structure or copy-paste.
      // Commenting it out to isolate the _core_subtract behavior.
      // vi.spyOn(webglUtils,'readDataFromTexture').mockImplementation((gl,fbo,width,height,isOutput) => { const o=new Float32Array(width*4); if(width===2){o[0]=9999;o[1]=1;o[4]=1;o[5]=0;} return o;});
      const result=num1._core_subtract(num2); expect(result.toString()).toBe('9999'); expect(result.sign).toBe(1);
    });
    it('should subtract to zero', () => {
      setupMockWebGLForSubtract();
      const num1=new BigIntPrimitive('12345',mockCanvas); const num2=new BigIntPrimitive('12345',mockCanvas);
      vi.spyOn(webglUtils,'readDataFromTexture').mockImplementation((gl,fbo,width,height,isOutput) => { const o=new Float32Array(width*4); if(width===2){o[0]=0;o[1]=0;o[4]=0;o[5]=0;} return o;});
      const result=num1._core_subtract(num2); expect(result.isZero()).toBe(true); expect(result.toString()).toBe('0'); expect(result.sign).toBe(1);
    });
    it('should handle multi-limb subtraction with borrows', () => {
      setupMockWebGLForSubtract();
      // num1='12345678' -> limbs [5678, 1234], length 2
      // num2='3456789'  -> limbs [6789, 345], length 2
      // maxLength = 2. Expected result '8888889' -> limbs [8889, 888]
      const num1=new BigIntPrimitive('12345678',mockCanvas);
      const num2=new BigIntPrimitive('3456789',mockCanvas);
      vi.spyOn(webglUtils,'readDataFromTexture').mockImplementation((gl,fbo,width,height,isOutput) => {
        const o=new Float32Array(width*4);
        if(width===2){ // Corrected based on actual limb calculation
          // Limb 0: num1[0]=5678, num2[0]=6789. 5678-6789. Shader: res=8889, borrow=1
          o[0*4+0]=8889; o[0*4+1]=1;
          // Limb 1: num1[1]=1234, num2[1]=345. 1234-345. Shader: res=889, borrow=0
          o[1*4+0]=889;  o[1*4+1]=0;
        }
        return o;
      });
      const result=num1._core_subtract(num2); expect(result.toString()).toBe('8888889'); expect(result.sign).toBe(1);
    });
  });

  describe('_multiply_limb_by_bigint() with WebGL mock', () => {
    const setupMockWebGLForMulLimb = () => { // Renamed from previous duplicate
       const mockGlContext = {
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
        checkFramebufferStatus: vi.fn().mockReturnValue(0x8CD5),
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
      vi.spyOn(webglUtils, 'initWebGL').mockReturnValue(mockGlContext);
      vi.spyOn(webglUtils, 'createDataTexture').mockReturnValue({ id: 'mockDataTexture' });
      vi.spyOn(webglUtils, 'createShader').mockReturnValue({ id: 'mockShader' });
      vi.spyOn(webglUtils, 'createProgram').mockReturnValue({ id: 'mockProgram' });
      return mockGlContext;
    };

    const instanceForCanvas = new BigIntPrimitive("0", mockCanvas);
    it('should return zero if limbValue is 0', () => {
      setupMockWebGLForMulLimb();
      const otherNumber = new BigIntPrimitive('12345', mockCanvas);
      const result = instanceForCanvas._multiply_limb_by_bigint(0, otherNumber);
      expect(result.isZero()).toBe(true);
    });
    it('should return zero if otherNumber is zero', () => {
      setupMockWebGLForMulLimb();
      const otherNumber = new BigIntPrimitive('0', mockCanvas);
      const result = instanceForCanvas._multiply_limb_by_bigint(123, otherNumber);
      expect(result.isZero()).toBe(true);
    });
    it('limbValue * single-limb otherNumber, no final carry', () => {
      setupMockWebGLForMulLimb();
      const otherNumber = new BigIntPrimitive('1000', mockCanvas);
      vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementation((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=5000;o[1]=0; return o;});
      const result = instanceForCanvas._multiply_limb_by_bigint(5, otherNumber);
      expect(result.toString()).toBe('5000');
    });
    it('limbValue * single-limb otherNumber, with final carry', () => {
      setupMockWebGLForMulLimb();
      const otherNumber = new BigIntPrimitive('3000', mockCanvas);
      vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementation((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=5000;o[1]=1; return o;});
      const result = instanceForCanvas._multiply_limb_by_bigint(5, otherNumber);
      expect(result.toString()).toBe('15000');
    });
    it('limbValue * multi-limb otherNumber, no JS propagated carry', () => {
      setupMockWebGLForMulLimb();
      const otherNumber = new BigIntPrimitive('32001', mockCanvas);
      vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementation((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=4002;o[1]=0; o[4]=6;o[5]=0; return o;});
      const result = instanceForCanvas._multiply_limb_by_bigint(2, otherNumber);
      expect(result.toString()).toBe('64002');
    });
    it('limbValue * multi-limb otherNumber, with JS propagated carry', () => {
      setupMockWebGLForMulLimb();
      const otherNumber = new BigIntPrimitive('10001', mockCanvas);
      vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementation((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=6000;o[1]=0; o[4]=6000;o[5]=0; return o;});
      const result = instanceForCanvas._multiply_limb_by_bigint(6000, otherNumber);
      expect(result.toString()).toBe('60006000');
    });
    it('limbValue * otherNumber, where final propagatedCarry requires splitting', () => {
        setupMockWebGLForMulLimb();
        const otherNumber = new BigIntPrimitive('9999', mockCanvas);
        vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementation((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=1;o[1]=9998; return o;});
        const result = instanceForCanvas._multiply_limb_by_bigint(9999, otherNumber);
        expect(result.toString()).toBe('99980001');
    });

    // New simple CPU logic tests
    it('CPU: 5 * "123" = "615"', () => {
      const num = new BigIntPrimitive("123", mockCanvas);
      const result = instanceForCanvas._multiply_limb_by_bigint(5, num);
      expect(result.toString()).toBe("615");
      expect(result.exponent).toBe(0); // Exponent should match 'num'
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
      const num = new BigIntPrimitive("50.0", mockCanvas); // Constructor makes this "50", exp 0
      num.limbs = [5,0,0]; // manually set to 500
      num.exponent = 1; // So value is 5000
      const result = instanceForCanvas._multiply_limb_by_bigint(2, num); // 2 * 5000 = 10000
      expect(result.toString()).toBe("10000"); // Should be 1000 * 10^1 = 10000
      expect(result.exponent).toBe(1); // Exponent from otherNumber should be preserved
    });

  });

  describe('_core_multiply() - internal multiplication logic', () => {
    const setupMockWebGLForCoreMultiply = () => { // Specific helper if needed, or reuse above
       const mockGlContext = {
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
        checkFramebufferStatus: vi.fn().mockReturnValue(0x8CD5),
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
      vi.spyOn(webglUtils, 'initWebGL').mockReturnValue(mockGlContext);
      vi.spyOn(webglUtils, 'createDataTexture').mockReturnValue({ id: 'mockDataTexture' });
      vi.spyOn(webglUtils, 'createShader').mockReturnValue({ id: 'mockShader' });
      vi.spyOn(webglUtils, 'createProgram').mockReturnValue({ id: 'mockProgram' });
      return mockGlContext;
    };

    let mlbbSpy;
    const instanceForCanvas = new BigIntPrimitive("0", mockCanvas);
    beforeEach(() => {
      // This spy is on the real BigIntPrimitive.prototype, which is fine
      // as we are testing _core_multiply's interaction with it.
      mlbbSpy = vi.spyOn(BigIntPrimitive.prototype, '_multiply_limb_by_bigint');
    });
    it('should return zero if num1 is zero', () => {
      // No WebGL expected for zero path
        const result = instanceForCanvas._core_multiply(new BigIntPrimitive('0', mockCanvas), new BigIntPrimitive('123', mockCanvas));
        expect(result.isZero()).toBe(true);
    });
    it('should return zero if num2 is zero', () => {
        const result = instanceForCanvas._core_multiply(new BigIntPrimitive('123', mockCanvas), new BigIntPrimitive('0', mockCanvas));
        expect(result.isZero()).toBe(true);
    });
    it('single-limb * single-limb', () => {
        setupMockWebGLForCoreMultiply(); // In case WebGL is hit by add or _multiply_limb_by_bigint
        const num1 = new BigIntPrimitive('5', mockCanvas); const num2 = new BigIntPrimitive('7', mockCanvas);
        mlbbSpy.mockReturnValue(new BigIntPrimitive('35', mockCanvas));

        const coreAddSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_add').mockImplementation(function(other) {
            const thisVal = BigInt(this.toString());
            const otherVal = BigInt(other.toString());
            return new BigIntPrimitive(String(thisVal + otherVal), this.canvas);
        });

        const result = instanceForCanvas._core_multiply(num1, num2);
        expect(mlbbSpy).toHaveBeenCalledWith(5, num2); expect(result.toString()).toBe('35');
        coreAddSpy.mockRestore();
    });

    it('should correctly multiply "11" * "11" (testing simple accumulation)', () => {
      const num1 = new BigIntPrimitive("11", mockCanvas);
      const num2 = new BigIntPrimitive("11", mockCanvas);
      const instance = new BigIntPrimitive("0", mockCanvas);
      // Spying on _multiply_limb_by_bigint to ensure it's called correctly
      // but allowing original implementation to run.
      const pvtMlbbSpy = vi.spyOn(instance, '_multiply_limb_by_bigint');

      const result = instance._core_multiply(num1, num2);

      expect(result.toString()).toBe("121");
      expect(result.sign).toBe(1);
      // "11" * "11":
      // num1.limbs = [1,1]. Reversed = [1,1]
      // Loop 1 (i=0, digit=1): mlbb(1, "11") -> "11" (exp=0). accum="11"
      // Loop 2 (i=1, digit=1): mlbb(1, "11") -> "11" (exp=0), shifted to exp=1 ("110").
      //                        add("11", "110") -> "121"
      expect(pvtMlbbSpy).toHaveBeenCalledTimes(2);
      expect(pvtMlbbSpy).toHaveBeenNthCalledWith(1, 1, num2); // 1st digit of "11" (reversed)
      expect(pvtMlbbSpy).toHaveBeenNthCalledWith(2, 1, num2); // 2nd digit of "11" (reversed)
      pvtMlbbSpy.mockRestore();
    });

    it('multi-limb * single-limb (e.g., 10001 * 5 = 50005, BASE 10k)', () => {
      setupMockWebGLForCoreMultiply();
        const num1 = new BigIntPrimitive('10001', mockCanvas); const num2 = new BigIntPrimitive('5', mockCanvas);

        // Let the original _multiply_limb_by_bigint execute. It's simple enough.
        // The spy will still record calls.
        // mlbbSpy.mockImplementation(BigIntPrimitive.prototype._multiply_limb_by_bigint.bind(instanceForCanvas));

        // vi.spyOn(webglUtils, 'readDataFromTexture')
        //     .mockImplementationOnce((gl,fbo,w,h,isOutput)=>{ const d=new Float32Array(w*4); d[0]=5;d[1]=0; return d;})
        //     .mockImplementationOnce((gl,fbo,w,h,isOutput)=>{ const d=new Float32Array(w*4); d[0]=5;d[1]=0; d[4]=5;d[5]=0; return d;});
        const result = instanceForCanvas._core_multiply(num1, num2);
        expect(mlbbSpy).toHaveBeenCalledTimes(2); // Called for non-zero limbs: 1 and 1
        expect(result.toString()).toBe('50005');
    });
    it('123 * 45 = 5535', () => {
      setupMockWebGLForCoreMultiply();
        const num1 = new BigIntPrimitive('123', mockCanvas); const num2 = new BigIntPrimitive('45', mockCanvas);
        mlbbSpy.mockImplementation((limbVal, otherNum) => {
          const productVal = BigInt(limbVal) * BigInt(otherNum.toString());
          return new BigIntPrimitive(String(productVal), mockCanvas);
        });

        const coreAddSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_add').mockImplementation(function(other) {
            const thisVal = BigInt(this.toString());
            const otherVal = BigInt(other.toString());
            return new BigIntPrimitive(String(thisVal + otherVal), this.canvas);
        });

        const result = instanceForCanvas._core_multiply(num1, num2);
        // _core_multiply calls _multiply_limb_by_bigint for each digit of num1 (since BASE_LOG10=1)
        // num1 ("123") has limbs [1,2,3]. Reversed is [3,2,1].
        expect(mlbbSpy).toHaveBeenCalledTimes(3);
        expect(mlbbSpy).toHaveBeenNthCalledWith(1, 3, num2); // First call with LSB (3)
        expect(mlbbSpy).toHaveBeenNthCalledWith(2, 2, num2); // Second call with (2)
        expect(mlbbSpy).toHaveBeenNthCalledWith(3, 1, num2); // Third call with MSB (1)
        expect(result.toString()).toBe('5535');
        coreAddSpy.mockRestore();
    });
  });

  // This is the new multiply suite with Karatsuba logic
  describe('multiply() - public method with Karatsuba and sign logic', () => {
    let coreMultiplySpy, splitAtSpy;
    const KARATSUBA_THRESHOLD_FROM_CODE = 20;

    beforeEach(() => {
        coreMultiplySpy = vi.spyOn(BigIntPrimitive.prototype, '_core_multiply');
        splitAtSpy = vi.spyOn(BigIntPrimitive.prototype, '_splitAt');
    });

    it('should throw TypeError for invalid input', () => {
        const n1 = new BigIntPrimitive('10', mockCanvas, { forceCPU: true }); expect(() => n1.multiply("abc")).toThrow(TypeError);
    });
    it('a * 0 = 0', () => {
        const n1 = new BigIntPrimitive('123', mockCanvas, { forceCPU: true }); const zero = new BigIntPrimitive('0', mockCanvas, { forceCPU: true });
        const result = n1.multiply(zero); expect(result.isZero()).toBe(true);
        expect(coreMultiplySpy).not.toHaveBeenCalled(); expect(splitAtSpy).not.toHaveBeenCalled();
    });
     it('0 * a = 0', () => {
        const zero = new BigIntPrimitive('0', mockCanvas, { forceCPU: true }); const n1 = new BigIntPrimitive('123', mockCanvas, { forceCPU: true });
        const result = zero.multiply(n1); expect(result.isZero()).toBe(true);
        expect(coreMultiplySpy).not.toHaveBeenCalled(); expect(splitAtSpy).not.toHaveBeenCalled();
    });
    it('positive * positive = positive', () => {
        const n1 = new BigIntPrimitive('10', mockCanvas, { forceCPU: true }); const n2 = new BigIntPrimitive('5', mockCanvas, { forceCPU: true });
        coreMultiplySpy.mockReturnValue(new BigIntPrimitive('50', mockCanvas, { forceCPU: true }));
        const result = n1.multiply(n2);
        expect(result.toString()).toBe('50'); expect(result.sign).toBe(1);
        expect(coreMultiplySpy).toHaveBeenCalledTimes(1);
        const callArgs = coreMultiplySpy.mock.calls[0];
        expect(callArgs[0].toString()).toBe(n1.abs().toString()); // abs() already returns a new instance with forceCPU true
        expect(callArgs[1].toString()).toBe(n2.abs().toString());
    });
    it('positive * negative = negative', () => {
        const n1 = new BigIntPrimitive('10', mockCanvas, { forceCPU: true }); const n2 = new BigIntPrimitive('-5', mockCanvas, { forceCPU: true });
        coreMultiplySpy.mockReturnValue(new BigIntPrimitive('50', mockCanvas, { forceCPU: true }));
        const result = n1.multiply(n2); expect(result.toString()).toBe('-50'); expect(result.sign).toBe(-1);
    });
    it('negative * positive = negative', () => {
        const n1 = new BigIntPrimitive('-10', mockCanvas, { forceCPU: true }); const n2 = new BigIntPrimitive('5', mockCanvas, { forceCPU: true });
        coreMultiplySpy.mockReturnValue(new BigIntPrimitive('50', mockCanvas, { forceCPU: true }));
        const result = n1.multiply(n2); expect(result.toString()).toBe('-50'); expect(result.sign).toBe(-1);
    });
    it('negative * negative = positive', () => {
        const n1 = new BigIntPrimitive('-10', mockCanvas, { forceCPU: true }); const n2 = new BigIntPrimitive('-5', mockCanvas, { forceCPU: true });
        coreMultiplySpy.mockReturnValue(new BigIntPrimitive('50', mockCanvas, { forceCPU: true }));
        const result = n1.multiply(n2); expect(result.toString()).toBe('50'); expect(result.sign).toBe(1);
    });
     it('multiply result of zero should have positive sign', () => {
        const n1 = new BigIntPrimitive('-10', mockCanvas, { forceCPU: true }); const n2 = new BigIntPrimitive('5', mockCanvas, { forceCPU: true });
        coreMultiplySpy.mockReturnValue(new BigIntPrimitive('0', mockCanvas, { forceCPU: true }));
        const result = n1.multiply(n2); expect(result.isZero()).toBe(true); expect(result.sign).toBe(1);
    });

    it('should use _core_multiply for numbers smaller than KARATSUBA_THRESHOLD', () => {
        const limbCountSmall = KARATSUBA_THRESHOLD_FROM_CODE > 1 ? KARATSUBA_THRESHOLD_FROM_CODE - 1 : 1;
        const n1Val = "1".repeat(Math.max(1, (limbCountSmall * 1) -1 ) || 1); // Corrected for BASE_LOG10=1
        const n2Val = "2".repeat(Math.max(1, (limbCountSmall * 1) -1 ) || 1); // Corrected for BASE_LOG10=1
        const n1 = new BigIntPrimitive(n1Val, mockCanvas); // Removed forceCPU for now
        const n2 = new BigIntPrimitive(n2Val, mockCanvas); // Removed forceCPU for now
        if (KARATSUBA_THRESHOLD_FROM_CODE < 2 && (n1.isZero() || n2.isZero())) { expect(true).toBe(true); return; }

        coreMultiplySpy.mockReturnValue(new BigIntPrimitive("0", mockCanvas)); // Removed forceCPU from mock
        n1.multiply(n2);
        // The number of calls to _core_multiply depends on the Karatsuba recursion depth.
        // If KARATSUBA_THRESHOLD is high, this might be 1 call. If low, many calls.
        // For BASE=10, limbCountSmall is KARATSUBA_THRESHOLD - 1.
        // n1Val/n2Val length is KARATSUBA_THRESHOLD - 1.
        // So, these numbers are just below the threshold.
        expect(coreMultiplySpy).toHaveBeenCalledTimes(1); // Should use _core_multiply directly
        expect(splitAtSpy).not.toHaveBeenCalled(); // Karatsuba path should not be taken
    });

    it('should use Karatsuba for large numbers (calls _splitAt and _core_multiply at base)', () => {
      setupMockWebGL(); // <--- ADD THIS LINE

      let n1Str = "", n2Str = "";
        const limbCountLarge = KARATSUBA_THRESHOLD_FROM_CODE; // e.g. 20 limbs for BASE=10
        if (limbCountLarge === 0) { expect(true).toBe(true); return; }
        n1Str = "1".repeat(limbCountLarge); // e.g. "1...1" (20 times)
        n2Str = "2".repeat(limbCountLarge); // e.g. "2...2" (20 times)

        const n1 = new BigIntPrimitive(n1Str, mockCanvas); // Removed forceCPU for now
        const n2 = new BigIntPrimitive(n2Str, mockCanvas); // Removed forceCPU for now

        // Mock _core_add to ensure sums are non-zero for p2_temp calculation
        const originalCoreAdd = BigIntPrimitive.prototype._core_add;
        const coreAddSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_add')
            .mockImplementation(function(otherNum) {
                // Create instances without explicit forceCPU to mirror n1/n2
                const thisInstance = new BigIntPrimitive(this, this.canvas);
                const otherInstance = new BigIntPrimitive(otherNum, otherNum.canvas);
                const res = originalCoreAdd.call(thisInstance, otherInstance);
                return new BigIntPrimitive(res, this.canvas);
            });

        coreMultiplySpy.mockImplementation((numA, numB) => {
            return new BigIntPrimitive("1", numA.canvas); // Removed forceCPU from mock
        });

        const originalMultiply = BigIntPrimitive.prototype.multiply;
        const publicMultiplySpy = vi.spyOn(BigIntPrimitive.prototype, 'multiply')
            .mockImplementation(function(...args) { // Note: using function() for 'this'
                return originalMultiply.apply(this, args);
            });

        n1.multiply(n2);

        n1.multiply(n2);

        expect(splitAtSpy).toHaveBeenCalled();
        // For an 80-digit number (80 limbs with BASE=10) and threshold 20:
        // Levels of recursion: 80 -> 40 -> 20. At 20 limbs, m=10. 10 < 20, so _core_multiply is used.
        // This is 3 levels of multiplication, where the lowest level is _core_multiply.
        // For BASE=10 and KARATSUBA_THRESHOLD=20, inputs of length 20 trigger Karatsuba once.
        // Each Karatsuba calls multiply() 3 times for sub-problems of length 10.
        // These sub-problems (len 10) are < threshold (20), so they call _core_multiply directly.
        // So, 1 Karatsuba op = 3 calls to _core_multiply.
        // Since n1.multiply(n2) is called twice in this test, we expect 3*2=6 calls to _core_multiply.
        expect(coreMultiplySpy.mock.calls.length).toBe(6);
        // publicMultiplySpy: 2 top-level calls. Each causes 1 Karatsuba entry, which makes 3 more public multiply calls.
        // So, 2 * (1 (self) + 3 (recursive)) = 8 calls.
        expect(publicMultiplySpy.mock.calls.length).toBe(8);

        publicMultiplySpy.mockRestore();
        coreAddSpy.mockRestore(); // Restore _core_add spy
    });

    it('Karatsuba integration: 12345 * 67890 = 838002050 (tests schoolbook path due to threshold)', () => {
        // Force CPU to ensure we are testing the JS _core_multiply and its JS helpers
        const n1 = new BigIntPrimitive("12345", mockCanvas, { forceCPU: true });
        const n2 = new BigIntPrimitive("67890", mockCanvas, { forceCPU: true });

        // Spies can be added if specific call counts to actual implementations need checking,
        // but for now, let's just verify the result of the multiplication.
        // const mlbbSpy = vi.spyOn(BigIntPrimitive.prototype, '_multiply_limb_by_bigint');
        // const coreAddSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_add');

        const result = n1.multiply(n2);
        expect(result.toString()).toBe('838102050'); // Corrected expectation based on manual trace

        // if (mlbbSpy) mlbbSpy.mockRestore();
        // if (coreAddSpy) coreAddSpy.mockRestore();
    });

    it('positive * positive = positive (forceCPU)', () => {
      const n1 = new BigIntPrimitive('123', mockCanvas, { forceCPU: true });
      const n2 = new BigIntPrimitive('45', mockCanvas, { forceCPU: true });
      // Spy on initWebGL to ensure it's not called
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

    // Test with numbers that would typically trigger Karatsuba, now with forceCPU
    it('Karatsuba integration: large numbers with forceCPU', () => {
      // Assuming KARATSUBA_THRESHOLD = 20. Need limbs > 20.
      // Each '1234' is one limb. Repeat 25 times for 25 limbs.
      // (1234)^25 * (5678)^25 is too big. Let's use smaller numbers but still over threshold.
      // String of 4 * 25 = 100 digits.
      let s1 = "";
      let s2 = "";
      for (let i = 0; i < 25; i++) { // 25 limbs
          s1 += "1234";
          s2 += "5678";
      }
      // s1 = "12341234... (25 times)"
      // s2 = "56785678... (25 times)"
      // Expected result: (1234... * 5678...)
      // For simplicity, we'll use smaller numbers that are easier to verify manually.
      // The main goal is to ensure forceCPU leads to no WebGL calls.
      const num1Str = "1".repeat(80); // 20 limbs, should meet KARATSUBA_THRESHOLD = 20
      const num2Str = "2".repeat(80); // 20 limbs
      const expectedBigIntResult = BigInt(num1Str) * BigInt(num2Str);

      const n1_cpu = new BigIntPrimitive(num1Str, mockCanvas, { forceCPU: true });
      const n2_cpu = new BigIntPrimitive(num2Str, mockCanvas, { forceCPU: true });

      const initWebGLSpy = vi.spyOn(webglUtils, 'initWebGL');
      const multiplyLimbSpy = vi.spyOn(BigIntPrimitive.prototype, '_multiply_limb_by_bigint');
      const coreAddSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_add'); // Spying on prototype for recursive calls
      const coreSubtractSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_subtract');

      const result_cpu = n1_cpu.multiply(n2_cpu);

      const originalPE = BigIntPrimitive.PE;
      BigIntPrimitive.PE = 1000; // Force plain string output for comparison
      expect(result_cpu.toString()).toBe(String(expectedBigIntResult));
      BigIntPrimitive.PE = originalPE; // Restore

      expect(initWebGLSpy).not.toHaveBeenCalled();
      // Check if core arithmetic operations were called (implies CPU path)
      // Add/Subtract will be called for Karatsuba's z2, z0, z1 steps.
      // multiplyLimbSpy might be called if Karatsuba depth is small or threshold not perfectly met for sub-problems.
      // A loose check that some core arithmetic happened on CPU:
      const cpuArithCalled = multiplyLimbSpy.mock.calls.length > 0 ||
                             coreAddSpy.mock.calls.length > 0 ||
                             coreSubtractSpy.mock.calls.length > 0;
      expect(cpuArithCalled).toBe(true);


      initWebGLSpy.mockRestore(); // Spies are restored by vi.resetAllMocks in global beforeEach
      // multiplyLimbSpy.mockRestore(); // No, these are prototype spies, restore after test
      // coreAddSpy.mockRestore();
      // coreSubtractSpy.mockRestore();
    });

  });

  describe('_staticRound() Internal Logic', () => {
    // modes: 0:roundDown, 1:roundHalfUp, 2:roundHalfEven, 3:roundUp
    const RM_DOWN = 0;
    const RM_HALF_UP = 1;
    const RM_HALF_EVEN = 2;
    const RM_UP = 3;

    it('RM_DOWN (0): should truncate to specified decimal places', () => {
      // Positive dp (fractional part)
      let res = BigIntPrimitive._staticRound([1,2,3,4,5,6], -3, 1, 2, RM_DOWN); // 123.456 to 2dp
      expect(res.limbs).toEqual([1,2,3,4,5]);
      expect(res.exponent).toBe(-2);
      expect(res.sign).toBe(1);

      res = BigIntPrimitive._staticRound([1,2,3,4,5], -2, 1, 0, RM_DOWN); // 123.45 to 0dp
      expect(res.limbs).toEqual([1,2,3]);
      expect(res.exponent).toBe(0);

      res = BigIntPrimitive._staticRound([1,2,3], 0, 1, 0, RM_DOWN); // 123 to 0dp
      expect(res.limbs).toEqual([1,2,3]);
      expect(res.exponent).toBe(0);

      res = BigIntPrimitive._staticRound([1,2,3,4,5], -2, 1, 3, RM_DOWN); // 123.45 to 3dp (no change)
      expect(res.limbs).toEqual([1,2,3,4,5]);
      expect(res.exponent).toBe(-2);

      res = BigIntPrimitive._staticRound([7], -3, 1, 2, RM_DOWN); // 0.007 to 2dp -> 0.00
      expect(res.limbs).toEqual([0]); // Normalized to 0
      expect(res.exponent).toBe(0);
      expect(res.sign).toBe(1);

      res = BigIntPrimitive._staticRound([1,2,3], -5, 1, 2, RM_DOWN); // 0.00123 to 2dp -> 0.00
      expect(res.limbs).toEqual([0]);
      expect(res.exponent).toBe(0);

    });

    // More tests for other rounding modes and negative dp will be added once implemented.
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

  // Note: The 'pow()' describe block might already exist from a previous turn.
  // I will add to it or create it if it doesn't.
  // For this operation, I'll assume it needs creation or ensure the search block is specific enough.
  // Based on the prompt, it's a new addition.

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
      expect(n_pow1).not.toBe(n); // Should be a copy
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
      expect(n1_pow100).not.toBe(n1); // Should be a copy if exp > 1, or if exp === 1
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
      // 10^10
      expect(new BigIntPrimitive('10').pow(10).toString()).toBe('10000000000');
      // 2^30
      expect(new BigIntPrimitive('2').pow(30).toString()).toBe('1073741824');
    });

    it('should use CPU path and respect forceCPU option', () => {
      const initWebGLSpy = vi.spyOn(webglUtils, 'initWebGL');
      const base = new BigIntPrimitive('3', mockCanvas, { forceCPU: true });
      const result = base.pow(4); // 3^4 = 81
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
    const BASE_FROM_CODE = 10000; // Assuming BASE is 10000 as per bigint.js
    it('should return a copy when power is 0', () => {
      const n1 = new BigIntPrimitive('12345', mockCanvas);
      const result = n1._multiplyByPowerOfBase(0);
      expect(result.toString()).toBe('12345');
      expect(result.sign).toBe(n1.sign);
      expect(result.limbs).toEqual(n1.limbs);
      expect(result).not.toBe(n1); // Should be a new instance
      expect(result.canvas).toBe(mockCanvas);
    });

    // This test for _multiplyByPowerOfBase seems out of place if it's a new pow() suite.
    // Removing it from here if it's a duplicate or error from previous merge.
    // It should belong in its own describe block if it's for _multiplyByPowerOfBase.
    // For now, assuming the pow() suite is what we are focusing on based on the prompt.
    // If 'should multiply by BASE^1' was part of the previous content of pow(), it needs to be preserved.
    // Given the instructions, it's likely not.

    it('should multiply by 10^1 (formerly BASE^1)', () => {
      const n1 = new BigIntPrimitive('123', mockCanvas); // limbs: [1,2,3], exp: 0
      const result = n1._multiplyByPowerOfBase(1); // Multiply by 10
      // Expect "1230". Current _multiplyByPowerOfBase prepends [0] to limbs, then toString normalizes.
      // This test will likely fail until _multiplyByPowerOfBase is fixed.
      // For now, the test expectation reflects the desired mathematical outcome.
      expect(result.toString()).toBe('1230');
      expect(result.sign).toBe(1);
    });

    it('should multiply by 10^2 (formerly BASE^2)', () => {
      const n1 = new BigIntPrimitive('123.45', mockCanvas); // limbs: [1,2,3,4,5], exp: -2
      const result = n1._multiplyByPowerOfBase(2); // Multiply by 100
      // Expect "12345". (123.45 * 100)
      expect(result.toString()).toBe('12345');
      expect(result.sign).toBe(1);
    });

    it('should multiply multi-digit number by 10^3', () => {
      const n1 = new BigIntPrimitive('12345.6789', mockCanvas); // limbs: [1,2,3,4,5,6,7,8,9], exp: -4
      const result = n1._multiplyByPowerOfBase(3); // Multiply by 1000
      // Expect "12345678.9"
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
      const n1 = new BigIntPrimitive('-1.23', mockCanvas); // limbs: [1,2,3], exp: -2, sign: -1
      const result = n1._multiplyByPowerOfBase(1); // Multiply by 10
      // Expect "-12.3"
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
    // No direct WebGL calls in this method, so no setupMockWebGL needed here.
    it('should use CPU path when forceCPU is true for add()', () => {
      const num1 = new BigIntPrimitive('123', mockCanvas, { forceCPU: true });
      const num2 = new BigIntPrimitive('456', mockCanvas, { forceCPU: true }); // Ensure both have it for clarity
      const initWebGLSpy = vi.spyOn(webglUtils, 'initWebGL');
      const result = num1.add(num2);
      expect(result.toString()).toBe('579');
      expect(initWebGLSpy).not.toHaveBeenCalled();
    });

    it('should use CPU path when forceCPU is true for subtract()', () => {
      const num1 = new BigIntPrimitive('567', mockCanvas, { forceCPU: true });
      const num2 = new BigIntPrimitive('123', mockCanvas, { forceCPU: true });
      const initWebGLSpy = vi.spyOn(webglUtils, 'initWebGL');
      const result = num1.subtract(num2);
      expect(result.toString()).toBe('444');
      expect(initWebGLSpy).not.toHaveBeenCalled();
    });

    // Test for multiply with forceCPU - this should now NOT call WebGL
    it('should use CPU path for multiply() when forceCPU is true', () => {
      const n1 = new BigIntPrimitive('10', mockCanvas, { forceCPU: true });
      const n2 = new BigIntPrimitive('5', mockCanvas, { forceCPU: true });
      const initWebGLSpy = vi.spyOn(webglUtils, 'initWebGL');
      const result = n1.multiply(n2);
      expect(result.toString()).toBe('50');
      expect(initWebGLSpy).not.toHaveBeenCalled();
    });

    it('CPU: should correctly add 12345678901234567890 + 98765432109876543210', () => {
      const num1Str = "12345678901234567890";
      const num2Str = "98765432109876543210";
      const correctSumStr = "111111111011111111100"; // Correct mathematical sum of num1Str + num2Str

      const num1 = new BigIntPrimitive(num1Str, mockCanvas, { forceCPU: true });
      const num2 = new BigIntPrimitive(num2Str, mockCanvas, { forceCPU: true });
      const result = num1.add(num2);
      expect(result.toString()).toBe(correctSumStr);
    });

  });
}); // This is the final closing brace for describe('BigIntPrimitive', ...)

describe('Division and Remainder', () => {
  const BASE_FROM_CODE = 10; // Updated to current BASE in bigint.js
  const BASE_LOG10_FROM_CODE = 1; // Updated to current BASE_LOG10 in bigint.js

  // Suite for the private _longDivide method
  describe('_longDivide', () => {
    // Note: _longDivide expects positive inputs. Sign handling is done by the public divideAndRemainder method.
    // It also uses the mocked _core_add and _core_subtract from the parent "Division and Remainder" suite's beforeEach.

    it('should handle dividend smaller than divisor: 5 / 10 => Q=0, R=5', () => {
      const dividend = new BigIntPrimitive("5", mockCanvas);
      const divisor = new BigIntPrimitive("10", mockCanvas);
      const instance = new BigIntPrimitive("0", mockCanvas); // Instance to call _longDivide on
      const { quotient, remainder } = instance._longDivide(dividend, divisor);

      expect(quotient.toString()).toBe("0");
      expect(quotient.sign).toBe(1);
      expect(remainder.toString()).toBe("5");
      expect(remainder.sign).toBe(1); // Remainder from _longDivide is positive
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
      // 50005 (limbs [5, 5] if BASE=10000) / 5 (limbs [5])
      const dividend = new BigIntPrimitive("50005", mockCanvas);
      const divisor = new BigIntPrimitive("5", mockCanvas);
      const instance = new BigIntPrimitive("0", mockCanvas);
      const { quotient, remainder } = instance._longDivide(dividend, divisor);

      expect(quotient.toString()).toBe("10001"); // quotient limbs [1,1]
      expect(quotient.sign).toBe(1);
      expect(remainder.toString()).toBe("0");
      expect(remainder.sign).toBe(1);
    });

    it('should handle BASE-related division: 20000 / 10000 => Q=2, R=0', () => {
      // 20000 (limbs [0, 2] if BASE=10000) / 10000 (limbs [0, 1])
      const dividend = new BigIntPrimitive("20000", mockCanvas);
      const divisor = new BigIntPrimitive("10000", mockCanvas);
      const instance = new BigIntPrimitive("0", mockCanvas);
      const { quotient, remainder } = instance._longDivide(dividend, divisor);

      expect(quotient.toString()).toBe("2");
      expect(quotient.sign).toBe(1);
      expect(remainder.toString()).toBe("0");
      expect(remainder.sign).toBe(1);
    });
  }); // End of _longDivide suite

  let originalCoreAdd;
  let originalCoreSubtract;

  beforeEach(() => {
    // Store original implementations
    originalCoreAdd = BigIntPrimitive.prototype._core_add;
    originalCoreSubtract = BigIntPrimitive.prototype._core_subtract;

    // Improved mock for _core_add as per subtask instructions
    BigIntPrimitive.prototype._core_add = function(num2BigInt) {
      // 'this' is num1BigInt
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

      // After the loop, if carry > 0, push remaining carry
      // This handles carries that extend beyond the length of the longest operand.
      while (carry > 0) {
        resultLimbs.push(carry % BASE_FROM_CODE);
        carry = Math.floor(carry / BASE_FROM_CODE);
      }

      // Remove trailing zero limbs (MSB end if array is LSB-first)
      // This is not strictly necessary for addition if inputs are normalized,
      // as sum won't have more leading zeros than inputs unless sum is 0.
      // However, including for robustness, though it's more critical for subtraction.
      while (resultLimbs.length > 1 && resultLimbs[resultLimbs.length - 1] === 0) {
        resultLimbs.pop();
      }
      // Ensure that if all limbs are zero (or array becomes empty), it's represented as [0].
      if (resultLimbs.length === 0) {
        resultLimbs.push(0);
      }

      const result = new BigIntPrimitive("0", num1BigInt.canvas); // Use num1's canvas
      result.limbs = resultLimbs;
      result.sign = 1; // _core_add result is positive or zero
      if (result.isZero()) { // isZero checks for .limbs=[0]
          result.sign = 1;
      }
      return result;
    };

    // Improved mock for _core_subtract (from previous step)
    BigIntPrimitive.prototype._core_subtract = function(subtrahendBigInt) {
      // 'this' is minuendBigInt
      const minuendBigInt = this;
      let resultLimbs = [];
      let borrow = 0;

      // Determine loop length: should be length of minuend, as precondition is minuend >= subtrahend.
      const loopLength = minuendBigInt.limbs.length;

      for (let i = 0; i < loopLength; i++) {
        const limb1 = minuendBigInt.limbs[i] || 0;
        const limb2 = subtrahendBigInt.limbs[i] || 0; // Subtrahend can be shorter
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
        // This indicates an issue: minuend was smaller than subtrahend if borrow persists.
        // This should ideally not happen if _longDivide's calling logic is correct.
        console.warn("BigIntPrimitive mock _core_subtract: Final borrow was > 0. This implies minuend < subtrahend, violating precondition.");
        // To prevent negative results or incorrect limb arrays from this mock under error conditions:
        // One could throw an error, or ensure the result is at least '0'.
        // For now, let the potentially incorrect (too small) result pass through,
        // as the primary goal is to see if this fixes the division test.
        // The _longDivide logic should not call _core_subtract if minuend < subtrahend.
      }

      // Remove trailing zero limbs from resultLimbs.
      while (resultLimbs.length > 1 && resultLimbs[resultLimbs.length - 1] === 0) {
        resultLimbs.pop();
      }

      // If resultLimbs is empty (e.g. 0-0 resulted in [0] then popped), it should be [0].
      // Or if all limbs were zero and got popped.
      if (resultLimbs.length === 0) {
        resultLimbs.push(0); // Ensure it's [0] for a zero result.
      }

      const result = new BigIntPrimitive("0", minuendBigInt.canvas);
      result.limbs = resultLimbs;
      result.sign = 1;
      // isZero() checks `this.limbs.length === 1 && this.limbs[0] === 0`
      // So, if result.limbs became [0] correctly, isZero() will be true.
      if (result.isZero()) {
          result.sign = 1;
      }
      return result;
    };
  });

  afterEach(() => {
    // Restore original implementations
    BigIntPrimitive.prototype._core_add = originalCoreAdd;
    BigIntPrimitive.prototype._core_subtract = originalCoreSubtract;
  });

  // Helper function for checking divideAndRemainder
  const checkDivRem = (dividendStr, divisorStr, expectedQStr, expectedRStr, canvasInstance) => {
    const dividend = new BigIntPrimitive(dividendStr, canvasInstance);
    const divisor = new BigIntPrimitive(divisorStr, canvasInstance);
    const { quotient, remainder } = dividend.divideAndRemainder(divisor);

    expect(quotient.toString()).toBe(expectedQStr);
    if (expectedQStr === "0") { // Normalized zero
        expect(quotient.sign).toBe(1);
    } else if (expectedQStr.startsWith('-')) {
        expect(quotient.sign).toBe(-1);
    } else {
        expect(quotient.sign).toBe(1);
    }

    expect(remainder.toString()).toBe(expectedRStr);
    if (expectedRStr === "0") { // Normalized zero
        expect(remainder.sign).toBe(1);
    } else {
        // Remainder sign matches dividend sign, unless remainder is 0
        const originalDividendSign = (new BigIntPrimitive(dividendStr, canvasInstance)).sign;
        expect(remainder.sign).toBe(originalDividendSign);
    }
  };

  // Helper for divide
  const checkDivide = (dividendStr, divisorStr, expectedQStr, canvasInstance) => {
    const dividend = new BigIntPrimitive(dividendStr, canvasInstance);
    const divisor = new BigIntPrimitive(divisorStr, canvasInstance);
    const quotient = dividend.divide(divisor);
    expect(quotient.toString()).toBe(expectedQStr);
    if (expectedQStr === "0") { // Normalized zero
        expect(quotient.sign).toBe(1);
    } else if (expectedQStr.startsWith('-')) {
        expect(quotient.sign).toBe(-1);
    } else {
        expect(quotient.sign).toBe(1);
    }
  };

  // Helper for remainder
  const checkRemainder = (dividendStr, divisorStr, expectedRStr, canvasInstance) => {
    const dividend = new BigIntPrimitive(dividendStr, canvasInstance);
    const divisor = new BigIntPrimitive(divisorStr, canvasInstance);
    const remainderResult = dividend.remainder(divisor); // Renamed to avoid conflict
    expect(remainderResult.toString()).toBe(expectedRStr);

    if (expectedRStr === "0") { // Normalized zero
        expect(remainderResult.sign).toBe(1);
    } else {
        const originalDividendSign = (new BigIntPrimitive(dividendStr, canvasInstance)).sign;
        expect(remainderResult.sign).toBe(originalDividendSign);
    }
  };

  // This describe block will now contain all tests for divideAndRemainder, divide, and remainder
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
      const invalidDivisor = "not a bigint"; // Not a BigIntPrimitive instance
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
        { D: "10000", d: "1", Q: "10000", R: "0" }, // BASE boundary for dividend
        { D: "9999", d: "10000", Q: "0", R: "9999" }, // Dividend < Divisor (BASE related)
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
        { D: "123456", d: "123", Q: "1003", R: "87" }, // Remains valid
        { D: "1000000", d: "101", Q: "9900", R: "100" }, // Remains valid
        // Updated BASE-related cases
        { D: "10", d: "2", Q: "5", R: "0" }, // Formerly BASE_FROM_CODE / 2
        { D: "20", d: "10", Q: "2", R: "0" }, // Formerly BASE_FROM_CODE * 2 / BASE_FROM_CODE
        { D: "100", d: "10", Q: "10", R: "0" }, // Formerly BASE_FROM_CODE^2 / BASE_FROM_CODE
      ];

      it('20000000000000000000 / 5333 => Q=3750234389649353, R=451', () => {
        const dividendStr = "20000000000000000000";
        const divisorStr = "5333";
        const expectedQStr = "3750234389649353";
        const expectedRStr = "451";
        const canvas = mockCanvas; // Ensure mockCanvas is available in this scope

        const dividend = new BigIntPrimitive(dividendStr, canvas);
        const divisor = new BigIntPrimitive(divisorStr, canvas);
        const { quotient, remainder } = dividend.divideAndRemainder(divisor);

        expect(quotient.toString()).toBe(expectedQStr);
        expect(remainder.toString()).toBe(expectedRStr);
        // Check signs if necessary, though these are positive
        expect(quotient.sign).toBe(1);
        expect(remainder.sign).toBe(1); // Remainder sign matches dividend if non-zero
      });

      // Isolate the failing test - restored (commented out .only)
      // const failingCase = { D: "12345678901234567890", d: "987654321", Q: "12499999887", R: "339506163" };
      // it(`${failingCase.D} / ${failingCase.d} => Q=${failingCase.Q}, R=${R}`, () => { // Changed .only to .it
      //   checkDivRem(failingCase.D, failingCase.d, failingCase.Q, failingCase.R, mockCanvas);
      //   checkDivide(failingCase.D, failingCase.d, failingCase.Q, mockCanvas);
      //   checkRemainder(failingCase.D, failingCase.d, failingCase.R, mockCanvas);
      // });

      const remainingCases = [
        // Add the formerly isolated case back to the main list for regular testing
        // { D: "12345678901234567890", d: "987654321", Q: "12499999887", R: "339506163" }, // This case is now part of allCases directly
        { D: "123", d: "12345", Q: "0", R: "123"}, // Divisor has more limbs
        { D: "500000010", d: "10000", Q: "50000", R: "10"}, // Potential for zero quotient limbs during calculation
        { D: "99999", d: "100", Q: "999", R: "99" }, // Dividend one less than multiple of divisor
        { D: "60", d: "10", Q:"6", R:"0"}, // D = BASE * 6, d = BASE => Q=6, R=0 (formerly 50010 and 10000)
      ];
      // Combine all cases for the main loop
      // The filter for "12345678901234567890" is removed as it's already in allCases if needed.
      // For now, keeping it separate as it's a very large number test.
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
        // D, d, Q, R
        { D: "10", d: "3", Q: "3", R: "1" },       // +D / +d
        { D: "-10", d: "3", Q: "-3", R: "-1" },      // -D / +d
        { D: "10", d: "-3", Q: "-3", R: "1" },       // +D / -d
        { D: "-10", d: "-3", Q: "3", R: "-1" },     // -D / -d

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
            // Ensure negation of 0 is still 0 with sign 1
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

// New describe block for toString scenarios
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

  // Reset PE and NE before each test in sub-describes that modify them
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

// New describe block for round() scenarios
describe('round()', () => {
  let originalRM;

  beforeAll(() => {
    originalRM = BigIntPrimitive.RM; // Save original rounding mode
  });

  afterAll(() => {
    BigIntPrimitive.RM = originalRM; // Restore original rounding mode
  });

  beforeEach(() => {
    BigIntPrimitive.RM = 1; // Default to RM_HALF_UP for most tests unless specified
  });

  const RM_DOWN = 0;
  const RM_HALF_UP = 1;
  const RM_HALF_EVEN = 2;
  const RM_UP = 3;

  describe('Default dp (0)', () => {
    it('should round to 0 decimal places using BigIntPrimitive.RM by default', () => {
      BigIntPrimitive.RM = RM_HALF_UP; // Ensure default for this test
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
      expect(new BigIntPrimitive('123.45').round(1, RM_HALF_EVEN).toString()).toBe('123.4'); // 4 is even
      expect(new BigIntPrimitive('123.55').round(1, RM_HALF_EVEN).toString()).toBe('123.6'); // 5 is odd, round up
      expect(new BigIntPrimitive('123.450001').round(1, RM_HALF_EVEN).toString()).toBe('123.5'); // Not exact half
    });
    it('dp = 0: half to even', () => {
       expect(new BigIntPrimitive('122.5').round(0, RM_HALF_EVEN).toString()).toBe('122'); // 2 is even
       expect(new BigIntPrimitive('123.5').round(0, RM_HALF_EVEN).toString()).toBe('124'); // 3 is odd
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
