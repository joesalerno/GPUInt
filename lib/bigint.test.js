import { describe, it, test, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { BigIntPrimitive } from './bigint';
import * as webglUtils from './webgl-utils';

// Mock canvas
const mockCanvas = {
  getContext: vi.fn().mockReturnValue({
    getExtension: vi.fn().mockReturnValue(true),
    getParameter: vi.fn((param) => {
      if (param === 34930) return 8192;
      return null;
    }),
    // Add other GL methods that might be called by WebGL utilities if not fully mocked out
    createShader: vi.fn(() => ({ mockShader: true })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true), // Assume success
    createProgram: vi.fn(() => ({ mockProgram: true })), // Assume success
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true), // Assume success
    useProgram: vi.fn(),
    getUniformLocation: vi.fn(() => ({ mockUniformLocation: true })),
    getAttribLocation: vi.fn(() => 0),
    createBuffer: vi.fn(() => ({ mockBuffer: true })),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    createFramebuffer: vi.fn(() => ({ mockFramebuffer: true })),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: vi.fn(() => 36053), // FRAMEBUFFER_COMPLETE
    deleteTexture: vi.fn(),
    deleteFramebuffer: vi.fn(),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
    deleteBuffer: vi.fn(),
    viewport: vi.fn(),
    drawArrays: vi.fn(),
  })
};

// Global mock for webgl-utils
vi.mock('./webgl-utils', () => ({
  initWebGL: vi.fn((canvas) => {
    if (!canvas) return null;
    return mockCanvas.getContext('webgl2');
  }),
  createShader: vi.fn((gl, type, source) => gl.createShader(type)), // Pass to mock gl
  createProgram: vi.fn((gl, vs, fs) => gl.createProgram()),      // Pass to mock gl
  createDataTexture: vi.fn(), // Will be spied on / specifically mocked in tests
  readDataFromTexture: vi.fn((gl, fbo, width, height, isOutput) => { // Keep general mock for read
    const dataSize = isOutput ? width * height * 4 : width * height;
    return new Float32Array(dataSize);
  }),
}));

describe('BigIntPrimitive', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: initWebGL returns mock GL, createProgram on mock GL returns mock program
    webglUtils.initWebGL.mockImplementation((canvas) => {
        if (!canvas) return null;
        return mockCanvas.getContext('webgl2');
    });
    // Global webglUtils.createProgram mock for tests that use it directly
    // Default to returning a mock program to allow deeper testing unless overridden
    webglUtils.createProgram.mockImplementation((gl, vs, fs) => gl.createProgram());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should correctly initialize from a positive integer string', () => {
      const num_small = new BigIntPrimitive('12345');
      expect(num_small.limbs).toEqual([1, 2345]);
      expect(num_small.sign).toBe(1);
      expect(num_small.exponent).toBe(0);
    });
    it('should correctly initialize from a negative integer string', () => {
      const num = new BigIntPrimitive('-98765');
      expect(num.limbs).toEqual([9, 8765]);
      expect(num.sign).toBe(-1);
    });
    it('should correctly initialize from "0"', () => {
      const num = new BigIntPrimitive('0');
      expect(num.limbs).toEqual([0]);
      expect(num.sign).toBe(1);
    });
  });

  describe('add() - public method with sign logic and CPU path', () => {
    const testCases = [
      // Simple addition
      { a: '123', b: '45', expected: '168', note: 'simple addition' },
      { a: '12345', b: '67890', expected: '80235', note: 'simple addition larger numbers' },
      // Addition involving a carry
      { a: '99', b: '1', expected: '100', note: 'carry to next limb (BASE 10000 implies smaller carries)' },
      { a: '9999', b: '1', expected: '10000', note: 'carry to new limb (9999 + 1 = 10000)' },
      { a: '1', b: '9999', expected: '10000', note: 'carry to new limb (1 + 9999 = 10000)' },
      { a: '8765', b: '1235', expected: '10000', note: '8765 + 1235 = 10000' },
      // Addition with zero
      { a: '123', b: '0', expected: '123', note: 'a + 0' },
      { a: '0', b: '123', expected: '123', note: '0 + a' },
      { a: '0', b: '0', expected: '0', note: '0 + 0' },
      // Addition of two negative numbers
      { a: '-123', b: '-45', expected: '-168', note: 'negative + negative' },
      { a: '-99', b: '-1', expected: '-100', note: 'negative + negative with carry' },
      // Addition of a positive and a negative number
      { a: '123', b: '-45', expected: '78', note: 'positive + negative (result positive)' },
      { a: '45', b: '-123', expected: '-78', note: 'positive + negative (result negative)' },
      { a: '123', b: '-123', expected: '0', note: 'positive + negative (result zero)' },
      { a: '-123', b: '45', expected: '-78', note: 'negative + positive (result negative)' },
      { a: '-45', b: '123', expected: '78', note: 'negative + positive (result positive)' },
      { a: '-123', b: '123', expected: '0', note: 'negative + positive (result zero)' },
      // Addition involving numbers with different exponents
      { a: '1.23', b: '0.0045', expected: '1.2345', note: '1.23 + 0.0045' }, // exp -2, exp -4 -> smallest exp -4. 12300 + 45 = 12345, exp -4
      { a: '123e2', b: '45e-1', expected: '12304.5', note: '12300 + 4.5' },   // 12300 (exp 0), 4.5 (exp 0) -> 12304.5
      { a: '1.2345', b: '2', expected: '3.2345', note: '1.2345 + 2' },
      { a: '200', b: '0.05', expected: '200.05', note: '200 + 0.05'},
      { a: '-1.23', b: '-0.0045', expected: '-1.2345', note: '-1.23 + -0.0045' },
      { a: '1.23', b: '-0.0045', expected: '1.2255', note: '1.23 + -0.0045' },
      { a: '-1.23', b: '0.0045', expected: '-1.2255', note: '-1.23 + 0.0045' },
      { a: '10000', b: '0.0001', expected: '10000.0001', note: 'large num + small fraction'}, // exp 0, exp -4. smallest exp -4. 100000000 + 1
      { a: '0.0001', b: '10000', expected: '10000.0001', note: 'small fraction + large num'},
    ];

    testCases.forEach(tc => {
      it(`should add ${tc.a} and ${tc.b} to get ${tc.expected} (${tc.note}) using CPU path`, () => {
        const numA = new BigIntPrimitive(tc.a, mockCanvas, { forceCPU: true });
        const numB = new BigIntPrimitive(tc.b, mockCanvas, { forceCPU: true });
        const result = numA.add(numB);
        expect(result.toString()).toBe(tc.expected);
        expect(result).toBeInstanceOf(BigIntPrimitive);
        expect(result).not.toBe(numA);
        expect(result).not.toBe(numB);
        // Ensure WebGL was not called for CPU path
        expect(webglUtils.initWebGL).not.toHaveBeenCalled();
        expect(webglUtils.createProgram).not.toHaveBeenCalled();
        expect(webglUtils.createDataTexture).not.toHaveBeenCalled();
        expect(webglUtils.readDataFromTexture).not.toHaveBeenCalled();
        vi.clearAllMocks();
      });
    });
  });

  describe('subtract() - public method with sign logic and CPU path', () => {
    const testCases = [
      // Simple subtraction of two positive numbers
      { a: '123', b: '45', expected: '78', note: 'a > b (123 - 45 = 78)' },
      { a: '45', b: '123', expected: '-78', note: 'a < b (45 - 123 = -78)' },
      { a: '123', b: '123', expected: '0', note: 'a = b (123 - 123 = 0)' },
      // Subtraction involving a borrow
      { a: '100', b: '1', expected: '99', note: 'borrow (100 - 1 = 99)' },
      { a: '10000', b: '1', expected: '9999', note: 'borrow across limbs (10000 - 1 = 9999)' },
      { a: '12345', b: '6789', expected: '5556', note: 'borrow internal (12345 - 6789 = 5556)' },
      // Subtraction with zero
      { a: '123', b: '0', expected: '123', note: 'a - 0' },
      { a: '0', b: '123', expected: '-123', note: '0 - a' },
      { a: '0', b: '0', expected: '0', note: '0 - 0' },
      // Subtraction of negative numbers
      { a: '-123', b: '-45', expected: '-78', note: '-a - -b (-123 - (-45) = -78)' },
      { a: '-45', b: '-123', expected: '78', note: '-a - -b (-45 - (-123) = 78)' },
      { a: '123', b: '-45', expected: '168', note: 'a - -b (123 - (-45) = 168)' },
      { a: '-123', b: '45', expected: '-168', note: '-a - b (-123 - 45 = -168)' },
      // Subtraction involving numbers with different exponents
      { a: '1.23', b: '0.0045', expected: '1.2255', note: '1.23 - 0.0045' }, // exp -2, exp -4. 12300 - 45 = 12255, exp -4
      { a: '0.0045', b: '1.23', expected: '-1.2255', note: '0.0045 - 1.23' }, // exp -4, exp -2. 45 - 12300 = -12255, exp -4
      { a: '123e2', b: '45e-1', expected: '12295.5', note: '12300 - 4.5' }, // 12300 (exp 0) - 4.5 (exp 0) = 12295.5
      { a: '1.2345', b: '2', expected: '-0.7655', note: '1.2345 - 2' }, // 12345e-4 - 20000e-4 = -7655e-4
      { a: '200', b: '0.05', expected: '199.95', note: '200 - 0.05'},
      { a: '-1.23', b: '-0.0045', expected: '-1.2255', note: '-1.23 - (-0.0045)' },
      { a: '1.23', b: '-0.0045', expected: '1.2345', note: '1.23 - (-0.0045)' },
      { a: '-1.23', b: '0.0045', expected: '-1.2345', note: '-1.23 - 0.0045' },
    ];

    testCases.forEach(tc => {
      it(`should subtract ${tc.b} from ${tc.a} to get ${tc.expected} (${tc.note}) using CPU path`, () => {
        const numA = new BigIntPrimitive(tc.a, mockCanvas, { forceCPU: true });
        const numB = new BigIntPrimitive(tc.b, mockCanvas, { forceCPU: true });
        const result = numA.subtract(numB);
        expect(result.toString()).toBe(tc.expected);
        expect(result).toBeInstanceOf(BigIntPrimitive);
        expect(result).not.toBe(numA);
        expect(result).not.toBe(numB);
        // Ensure WebGL was not called for CPU path
        expect(webglUtils.initWebGL).not.toHaveBeenCalled();
        expect(webglUtils.createProgram).not.toHaveBeenCalled();
        expect(webglUtils.createDataTexture).not.toHaveBeenCalled();
        expect(webglUtils.readDataFromTexture).not.toHaveBeenCalled();
        vi.clearAllMocks();
      });
    });
  });

  describe('multiply() - public method with Karatsuba and sign logic', () => {
    const multiplyTestCases = [
      { a: '123', b: '45', expected: '5535', note: 'simple integer multiplication' },
      { a: '123', b: '0', expected: '0', note: 'multiply by zero (a * 0)' },
      { a: '0', b: '45', expected: '0', note: 'multiply by zero (0 * a)' },
      { a: '123', b: '1', expected: '123', note: 'multiply by one (a * 1)' },
      { a: '-123', b: '45', expected: '-5535', note: 'negative * positive' },
      { a: '-123', b: '-45', expected: '5535', note: 'negative * negative' },
      { a: '1.2', b: '0.5', expected: '0.6', note: 'simple decimal multiplication (1.2 * 0.5 = 0.6)' },
    ];

    [true, false].forEach(forceCPU => {
      describe(`with forceCPU: ${forceCPU}`, () => {
        multiplyTestCases.forEach(tc => {
          it(`should multiply ${tc.a} and ${tc.b} to get ${tc.expected} (${tc.note})`, () => {
            const numA = new BigIntPrimitive(tc.a, mockCanvas, { forceCPU });
            const numB = new BigIntPrimitive(tc.b, mockCanvas, { forceCPU });
            const result = numA.multiply(numB);
            expect(result.toString()).toBe(tc.expected);

            if (!forceCPU) {
              if (numA.isZero() || numB.isZero()) {
                expect(webglUtils.initWebGL).not.toHaveBeenCalled();
                expect(webglUtils.createProgram).not.toHaveBeenCalled();
              } else {
                // Expect initWebGL to be called.
                expect(webglUtils.initWebGL).toHaveBeenCalledTimes(1);
                // If initWebGL effectively returns null (e.g. this.canvas is bad, or mock forces it),
                // then useWebGL becomes false, and createProgram (for multiply_limb) is not called.
                expect(webglUtils.createProgram).not.toHaveBeenCalled();
                expect(webglUtils.createDataTexture).not.toHaveBeenCalled();
                expect(webglUtils.readDataFromTexture).not.toHaveBeenCalled();
              }
            } else { // forceCPU: true
              expect(webglUtils.initWebGL).not.toHaveBeenCalled();
              expect(webglUtils.createProgram).not.toHaveBeenCalled();
              expect(webglUtils.createDataTexture).not.toHaveBeenCalled();
              expect(webglUtils.readDataFromTexture).not.toHaveBeenCalled();
            }
            vi.clearAllMocks();
          });
        });
      });
    });

    it('should return a new BigIntPrimitive instance', () => {
      const numA = new BigIntPrimitive('10');
      const numB = new BigIntPrimitive('5');
      const result = numA.multiply(numB);
      expect(result).toBeInstanceOf(BigIntPrimitive);
      expect(result).not.toBe(numA);
      expect(result).not.toBe(numB);
       vi.clearAllMocks(); // Ensure mocks clear after this specific test too.
    });
  });

  // Add other top-level describe blocks if they were in the original test file, e.g. for precision methods

  describe('_multiply_limb_by_bigint()', () => {
    const testCases = [
      { limb: 2, numStr: "1234", expectedStr: "2468", note: 'simple multiplication' },
      { limb: 0, numStr: "1234", expectedStr: "0", note: 'limb is zero' },
      { limb: 1234, numStr: "0", expectedStr: "0", note: 'number is zero' },
      { limb: 1, numStr: "9876", expectedStr: "9876", note: 'limb is one' },
      { limb: 5000, numStr: "3", expectedStr: "15000", note: 'result requires carry to new limb (BASE 10000)' }, // 15000 -> [1, 5000]
      { limb: 2, numStr: "1000020000", expectedStr: "2000040000", note: 'number with multiple limbs' }, // "1000020000" -> [1,2,0]. result [2,4,0]
      { limb: 10000, numStr: "1", expectedStr: "10000", note: 'limb is BASE (should be handled as 1*BASE + 0)'}, // Limb 10000 -> effectively [1,0] if it were a BigInt
    ];

    testCases.forEach(tc => {
      it(`should correctly multiply limb ${tc.limb} by BigInt ${tc.numStr} to get ${tc.expectedStr} (${tc.note})`, () => {
        const num = BigIntPrimitive.fromCoefficientString(tc.numStr, mockCanvas, { forceCPU: true }); // Ensure exp 0
        const instance = new BigIntPrimitive("0", mockCanvas, { forceCPU: true }); // Dummy instance to call the method
        const result = instance._multiply_limb_by_bigint(tc.limb, num);

        expect(result).toBeInstanceOf(BigIntPrimitive);
        expect(result.sign).toBe(1); // Should always be positive magnitude
        expect(result.toString()).toBe(tc.expectedStr); // Compares magnitude as string
        // The exponent of the result of _multiply_limb_by_bigint should be otherNumber.exponent (which is 0 here)
        if (tc.expectedStr !== "0") {
            expect(result.exponent).toBe(0);
        } else {
            expect(result.isZero()).toBe(true); // Canonical zero has exp 0
        }
      });
    });
  });

  describe('_core_multiply() - internal multiplication logic', () => {
    const testCases = [
      { aStr: "123", bStr: "45", expectedStr: "5535", note: "simple integers" },
      { aStr: "6789", bStr: "12345", expectedStr: "83810205", note: "multi-limb order swap" },
      { aStr: "123", bStr: "0", expectedStr: "0", note: "multiply by zero" },
      { aStr: "0", bStr: "456", expectedStr: "0", note: "zero multiply by number" },
      { aStr: "123", bStr: "1", expectedStr: "123", note: "multiply by one" },
      { aStr: "1", bStr: "456", expectedStr: "456", note: "one multiply by number" },
      { aStr: "10000", bStr: "10000", expectedStr: "100000000", note: "BASE * BASE" }, // [1,0,0] * [1,0,0] -> [1,0,0,0,0] if exp handled correctly
                                                                                      // Coeff: 1*1 = 1. Exponents added outside.
                                                                                      // Here, inputs are coeffs, so 10000*10000. Limbs [1,0]*[1,0]
                                                                                      // Result: [1,0,0].toString() = "100000000"
      { aStr: "9999", bStr: "9999", expectedStr: "99980001", note: "max limb * max limb" }, // [9999]*[9999] -> [9998,1]
    ];

    testCases.forEach(tc => {
      it(`should correctly multiply ${tc.aStr} and ${tc.bStr} to get ${tc.expectedStr} (${tc.note})`, () => {
        // _core_multiply expects positive BigIntPrimitives with exponent 0 (coefficients)
        const numA = BigIntPrimitive.fromCoefficientString(tc.aStr, mockCanvas, { forceCPU: true });
        const numB = BigIntPrimitive.fromCoefficientString(tc.bStr, mockCanvas, { forceCPU: true });

        const instance = new BigIntPrimitive("0", mockCanvas, {forceCPU: true}); // Dummy instance to call method
        const result = instance._core_multiply(numA, numB);

        expect(result).toBeInstanceOf(BigIntPrimitive);
        expect(result.sign).toBe(1); // _core_multiply returns magnitude
        expect(result.toString()).toBe(tc.expectedStr);
        // Exponent should be 0 as it multiplies coefficients. Final exponent adjustment is in public multiply()
        if (tc.expectedStr !== "0") {
            expect(result.exponent).toBe(0);
        } else {
            expect(result.isZero()).toBe(true); // Canonical zero has exp 0
        }
      });
    });
  });

  describe('_staticRound_cpu() - internal rounding logic', () => {
    const instance = new BigIntPrimitive("0", null, { forceCPU: true }); // Dummy instance to call the method
    const { roundDown, roundHalfUp, roundHalfEven, roundUp } = BigIntPrimitive;

    // Test cases: [coeffStr, decisionIndex, roundingMode, isNegative, expectedCoeffStr]
    const roundTestCases = [
      // Round Down (Truncate)
      { str: "12345", idx: 3, rm: roundDown, neg: false, exp: "123" }, // 123.45 -> 123
      { str: "12300", idx: 3, rm: roundDown, neg: false, exp: "123" }, // 123.00 -> 123
      { str: "12399", idx: 3, rm: roundDown, neg: false, exp: "123" }, // 123.99 -> 123
      { str: "5", idx: 0, rm: roundDown, neg: false, exp: "0" },     // 0.5 -> 0
      { str: "123", idx: 0, rm: roundDown, neg: false, exp: "0" },     // 0.123 -> 0
      { str: "123", idx: 1, rm: roundDown, neg: false, exp: "1" },     // 1.23 -> 1
      { str: "123", idx: 2, rm: roundDown, neg: false, exp: "12" },    // 12.3 -> 12
      { str: "123", idx: 3, rm: roundDown, neg: false, exp: "123" },   // 123 -> 123 (no rounding needed)
      { str: "0", idx: 0, rm: roundDown, neg: false, exp: "0" },       // 0.0 -> 0

      // Round Half Up
      { str: "12345", idx: 3, rm: roundHalfUp, neg: false, exp: "123" }, // 123.45, round based on '4' -> 123
      { str: "12350", idx: 3, rm: roundHalfUp, neg: false, exp: "124" }, // 123.50, round based on '5' -> 124
      { str: "12399", idx: 3, rm: roundHalfUp, neg: true, exp: "124" },  // -123.99, round based on '9' -> -124
      { str: "5", idx: 0, rm: roundHalfUp, neg: false, exp: "1" },     // 0.5 -> 1
      { str: "4", idx: 0, rm: roundHalfUp, neg: false, exp: "0" },     // 0.4 -> 0
      { str: "99", idx: 0, rm: roundHalfUp, neg: false, exp: "1" },    // 0.99 -> 1 (coeff "0" becomes "1")
      { str: "199", idx: 1, rm: roundHalfUp, neg: false, exp: "2" },   // "19.9" round at index 1 (first 9), keeps "1", rounds up to "2". Exponent handled by caller.

      // Round Half Even
      { str: "12250", idx: 3, rm: roundHalfEven, neg: false, exp: "122" }, // 122.50 (prev 2 is even) -> 122
      { str: "12350", idx: 3, rm: roundHalfEven, neg: false, exp: "124" }, // 123.50 (prev 3 is odd) -> 124
      { str: "12251", idx: 3, rm: roundHalfEven, neg: false, exp: "123" }, // 122.51 (more than half) -> 123
      { str: "12351", idx: 3, rm: roundHalfEven, neg: false, exp: "124" }, // 123.51 (more than half) -> 124
      { str: "250", idx: 1, rm: roundHalfEven, neg: false, exp: "2" },   // 2.50 (prev 2 is even) -> 2
      { str: "350", idx: 1, rm: roundHalfEven, neg: false, exp: "4" },   // 3.50 (prev 3 is odd) -> 4

      // Round Up
      { str: "12301", idx: 3, rm: roundUp, neg: false, exp: "124" }, // 123.01 (positive, >0) -> 124
      { str: "12300", idx: 3, rm: roundUp, neg: false, exp: "123" }, // 123.00 (positive, zero frac) -> 123
      { str: "12301", idx: 3, rm: roundUp, neg: true, exp: "123" },  // -123.01 (negative, round up is towards zero) -> -123
      { str: "1", idx: 0, rm: roundUp, neg: false, exp: "1" },      // 0.1 (positive) -> 1
      { str: "0", idx: 0, rm: roundUp, neg: false, exp: "0" },      // 0.0 -> 0
    ];

    roundTestCases.forEach(tc => {
      it(`should round "${tc.str}" at index ${tc.idx} (mode ${tc.rm}, neg ${tc.neg}) to "${tc.exp}"`, () => {
        const result = instance._staticRound_cpu(tc.str, tc.idx, tc.rm, tc.neg);
        expect(result).toBe(tc.exp);
      });
    });
  });

  describe('remainder() (and mod()) - public method', () => {
    let originalDP;
    let originalRM;

    beforeEach(() => {
      originalDP = BigIntPrimitive.DP;
      originalRM = BigIntPrimitive.RM;
      // Set a higher DP for remainder tests to ensure intermediate division is precise enough
      // before truncation for quotient. big.js internally uses current DP for the division.
      BigIntPrimitive.DP = 40;
    });

    afterEach(() => {
      BigIntPrimitive.DP = originalDP;
      BigIntPrimitive.RM = originalRM;
    });

    const testCases = [
      { a: '10', b: '3', expected: '1', note: 'positive integers' },
      { a: '7', b: '3', expected: '1', note: 'positive integers' },
      { a: '3', b: '10', expected: '3', note: 'positive integers, a < b' },
      { a: '0', b: '7', expected: '0', note: 'dividend is zero' },
      { a: '10', b: '-3', expected: '1', note: 'positive % negative, sign of dividend' },
      { a: '-10', b: '3', expected: '-1', note: 'negative % positive, sign of dividend' },
      { a: '-10', b: '-3', expected: '-1', note: 'negative % negative, sign of dividend' },
      { a: '-3', b: '10', expected: '-3', note: 'negative % positive, |a| < |b|, sign of dividend' },
      { a: '8.9', b: '1.2', expected: '0.5', note: 'decimals 8.9 % 1.2' },
      { a: '5.123', b: '0.1', expected: '0.023', note: 'decimals 5.123 % 0.1' },
      { a: '-5.123', b: '0.1', expected: '-0.023', note: 'decimals -5.123 % 0.1' },
      { a: '0.0089', b: '0.0012', expected: '0.0005', note: 'decimals 0.0089 % 0.0012'},
      { a: '1', b: '0.3', expected: '0.1', note: '1 % 0.3' },
      { a: '2', b: '0.3', expected: '0.2', note: '2 % 0.3' },
      { a: '3', b: '0.3', expected: '0', note: '3 % 0.3 (exact multiple)' },
      { a: '10.5', b: '0.5', expected: '0', note: '10.5 % 0.5 (exact multiple)'},
      { a: '-10.5', b: '0.5', expected: '0', note: '-10.5 % 0.5 (exact multiple, sign of dividend is preserved for 0 in big.js)'},
      { a: '10.25', b: '0.5', expected: '0.25', note: '10.25 % 0.5'},
      { a: '0.00000000000000000007', b: '0.00000000000000000002', expected: '0.00000000000000000001', note: 'very small numbers default DP'},
    ];

    for (const tc of testCases) {
      it(`should calculate remainder of ${tc.a} % ${tc.b} as ${tc.expected} (${tc.note || ''})`, () => {
        const numA = new BigIntPrimitive(tc.a, mockCanvas, { forceCPU: true });
        const numB = new BigIntPrimitive(tc.b, mockCanvas, { forceCPU: true });

        const remainderResult = numA.remainder(numB);
        expect(remainderResult.toString()).toBe(tc.expected);
        expect(remainderResult).toBeInstanceOf(BigIntPrimitive);

        // Also test mod() alias for some cases
        if (tc.a === '10' && tc.b === '3') {
            const modResult = numA.mod(numB);
            expect(modResult.toString()).toBe(tc.expected);
            expect(modResult).toBeInstanceOf(BigIntPrimitive);
        }
      });
    }

    it('should throw error for remainder by zero', () => {
      const numA = new BigIntPrimitive('10');
      const numB = new BigIntPrimitive('0');
      expect(() => numA.remainder(numB)).toThrow('[big.js] Division by zero');
      expect(() => numA.mod(numB)).toThrow('[big.js] Division by zero');
    });

    it('remainder of -0 should be 0 (not -0)', () => {
        const numA = new BigIntPrimitive("-0");
        const numB = new BigIntPrimitive("5");
        const result = numA.remainder(numB);
        expect(result.toString()).toBe("0");
        expect(result.sign).toBe(1);
    });

    it('should handle exponent according to big.js rule: exponent of zero or the exponent of the dividend, whichever is the greater', () => {
      let numA = new BigIntPrimitive("8.9");
      let numB = new BigIntPrimitive("1.2");
      let rem = numA.remainder(numB);
      expect(rem.toString()).toBe("0.5");

      numA = new BigIntPrimitive("0.0089");
      numB = new BigIntPrimitive("0.0012");
      rem = numA.remainder(numB);
      expect(rem.toString()).toBe("0.0005");

      numA = new BigIntPrimitive("1");
      numB = new BigIntPrimitive("0.3");
      rem = numA.remainder(numB);
      expect(rem.toString()).toBe("0.1");
    });

  });
});
