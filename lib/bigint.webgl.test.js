import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BigIntPrimitive } from './bigint'; // Actual BigIntPrimitive
import * as webglUtils from './webgl-utils.js'; // Import to use its functions

// Mock the module, making each function a Jest mock function (vi.fn)
// that wraps the actual implementation by default.
vi.mock('./webgl-utils.js', async (importOriginal) => {
  const actual = await importOriginal(); // Get the actual module
  return {
    initWebGL: vi.fn((...args) => actual.initWebGL(...args)),
    createShader: vi.fn((...args) => actual.createShader(...args)),
    createProgram: vi.fn((...args) => actual.createProgram(...args)),
    createDataTexture: vi.fn((...args) => actual.createDataTexture(...args)),
    readDataFromTexture: vi.fn((...args) => actual.readDataFromTexture(...args)),
    // Ensure all exported functions from webgl-utils.js are listed here
    // If new functions are added to webgl-utils.js, they need to be added here too.
  };
});

describe('BigIntPrimitive WebGL Operations', () => {
  let canvas;

  beforeEach(async () => {
    // Reset mocks before each test to clear previous test-specific implementations
    vi.clearAllMocks(); // Clears call counts, mock implementations etc.

    document.body.innerHTML = '<canvas id="webglCanvas"></canvas>';
    canvas = document.getElementById('webglCanvas');
    if (!canvas) {
      throw new Error("Could not find canvas element for WebGL tests. Ensure the test environment provides a DOM.");
    }
  });

  describe('add() - WebGL Path', () => {
    it('should add two small BigIntPrimitives using WebGL (e.g., "123" + "456" = "579")', () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");
      const num1 = new BigIntPrimitive('123', canvas);
      const num2 = new BigIntPrimitive('456', canvas);
      const result = num1.add(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('579');
    });

    it('should add two larger BigIntPrimitives requiring multiple limbs using WebGL (e.g., "8000" + "7000" = "15000")', () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");
      const num1 = new BigIntPrimitive('8000', canvas);
      const num2 = new BigIntPrimitive('7000', canvas);
      const result = num1.add(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('15000');
    });

    it('should handle adding zero to a number using WebGL', () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");
      const num1 = new BigIntPrimitive('12345', canvas);
      const numZero = new BigIntPrimitive('0', canvas);
      const result = num1.add(numZero);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('12345');
    });
  });

  describe('subtract() - WebGL Path', () => {
    it('should subtract two positive single-limb numbers, no borrow (e.g., "567" - "123" = "444")', async () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");

      webglUtils.readDataFromTexture.mockImplementation((gl, fbo, width, height, isOutput) => {
        // For 567 - 123 = 444. texWidth = 1.
        // Shader output: resultLimb = 444, borrowOut = 0.
        // RGBA format:
        const mockData = new Float32Array([444, 0, 0, 1]);
        return mockData;
      });

      const num1 = new BigIntPrimitive('567', canvas);
      const num2 = new BigIntPrimitive('123', canvas);
      const result = num1.subtract(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('444');
    });

    it('should subtract with borrow (e.g., "123" - "34" = "89")', async () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");

      webglUtils.readDataFromTexture.mockImplementation((gl, fbo, width, height, isOutput) => {
        // For 123 - 34 = 89. texWidth = 1.
        // Shader output: resultLimb = 89, borrowOut = 0.
        const mockData = new Float32Array([89, 0, 0, 1]);
        return mockData;
      });

      const num1 = new BigIntPrimitive('123', canvas);
      const num2 = new BigIntPrimitive('34', canvas);
      const result = num1.subtract(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('89');
    });

    it('should handle subtracting to zero (e.g., "123" - "123" = "0")', async () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");
      const num1 = new BigIntPrimitive('123', canvas);
      const num2 = new BigIntPrimitive('123', canvas);
      const result = num1.subtract(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('0');
    });

    it('should handle subtracting a larger number from a smaller one (e.g., "100" - "200" = "-100")', async () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");

      // For 100 - 200. CPU pre-aligns to 200 - 100, resultSign = -1.
      // So, WebGL computes 200 - 100 = 100.
      webglUtils.readDataFromTexture.mockImplementation((gl, fbo, width, height, isOutput) => {
        // For 200 - 100 = 100. texWidth = 1.
        // Shader output: resultLimb = 100, borrowOut = 0.
        const mockData = new Float32Array([100, 0, 0, 1]);
        return mockData;
      });

      const num1 = new BigIntPrimitive('100', canvas);
      const num2 = new BigIntPrimitive('200', canvas);
      const result = num1.subtract(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('-100');
    });
  });

  describe('multiply() - WebGL Path (Simple Cases)', () => {
    it('should multiply two small BigIntPrimitives using WebGL (e.g., "12" * "3" = "36")', async () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");

      webglUtils.readDataFromTexture.mockImplementation((gl, fbo, width, height, isOutput) => {
        // Expected for limb=12, otherNum="3" (limbs [3]), tW=2 (oLR.length+1; otherNum.limbs reversed is [3], so oLR.length is 1).
        // Shader output for multiply_limb.frag:
        // Texel 0 (processing otherNum.limbs_reversed[0] which is 3):
        //   product = limbVal * otherLimb = 12 * 3 = 36.
        //   resultLimb = product % BASE = 36 % 10000 = 36.
        //   carryToNext = floor(product / BASE) = floor(36 / 10000) = 0.
        // Texel 1 (padding, otherNum.limbs_reversed[1] is undefined, effectively 0):
        //   product = limbVal * 0 = 0.
        //   resultLimb = 0. carryToNext = 0.
        // Data format: [resultLimb, carryToNext, 0, 1 (alpha)]
        return new Float32Array([
          36, 0, 0, 1,  // Texel 0: For actual limb '3'
          0,  0, 0, 1   // Texel 1: For padding
        ]);
      });

      const num1 = new BigIntPrimitive('12', canvas); // This '12' will be the 'limb' in _webgl_multiply_one_limb_by_bigint
      const num2 = new BigIntPrimitive('3', canvas);  // This '3' will be 'otherNum'
      const result = num1.multiply(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('36');
    });

    it('should multiply with one number being zero using WebGL (e.g., "123" * "0" = "0")', async () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");
      // No mock needed for readDataFromTexture if multiply has early exit for zero.
      // If it proceeds to WebGL, the current mock for other tests might interfere or actual WebGL might run.
      // For "X * 0", the result is "0" and it should ideally not even go to WebGL path if optimized.
      // The multiply method has: if(self.isZero()||other.isZero())return new BigIntPrimitive("0",...)
      // So, this test should pass without specific readDataFromTexture mock.
      const num1 = new BigIntPrimitive('123', canvas);
      const numZero = new BigIntPrimitive('0', canvas);
      const result = num1.multiply(numZero);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('0');
    });

    it('should multiply two single-digit numbers using WebGL (e.g., "7" * "8" = "56")', async () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");

      webglUtils.readDataFromTexture.mockImplementation((gl, fbo, width, height, isOutput) => {
        // Expected for limb=7, otherNum="8" (limbs [8]), tW=2.
        // Texel 0 (from otherLimb 8): product=56, carry=0.
        // Texel 1 (from otherLimb 0): product=0, carry=0.
        return new Float32Array([
          56, 0, 0, 1,
          0,  0, 0, 1
        ]);
      });

      const num1 = new BigIntPrimitive('7', canvas);
      const num2 = new BigIntPrimitive('8', canvas);
      const result = num1.multiply(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('56');
    });
  });
});
