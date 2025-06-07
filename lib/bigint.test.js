import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BigIntPrimitive } from './bigint';
import * as webglUtils from './webgl-utils';

// Mock canvas
const mockCanvas = {
  getContext: vi.fn().mockReturnValue({
    getExtension: vi.fn().mockReturnValue(true), // for OES_texture_float
    // Add any other canvas context methods that might be called by webgl-utils if not fully mocked
  })
};

// Global mock for webgl-utils
vi.mock('./webgl-utils', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    initWebGL: vi.fn().mockImplementation((canvas) => {
      if (!canvas) return null;
      return {
        VERTEX_SHADER: 0x8B31,
        FRAGMENT_SHADER: 0x8B30,
        FRAMEBUFFER_COMPLETE: 36053,
        createShader: vi.fn().mockReturnValue({ shaderId: Math.random(), source: 'mock gl.createShader' }),
        createProgram: vi.fn().mockReturnValue({ programId: Math.random(), source: 'mock gl.createProgram' }),
        getAttribLocation: vi.fn().mockReturnValue(0),
        getUniformLocation: vi.fn().mockReturnValue(0),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        activeTexture: vi.fn(),
        bindTexture: vi.fn(),
        uniform1i: vi.fn(),
        // Core WebGL functions used in bigint.js's add method directly on GL context
        createFramebuffer: vi.fn().mockReturnValue({ fboId: Math.random() }),
        bindFramebuffer: vi.fn(),
        framebufferTexture2D: vi.fn(),
        checkFramebufferStatus: vi.fn().mockReturnValue(36053), // FRAMEBUFFER_COMPLETE
        createBuffer: vi.fn().mockReturnValue({ bufferId: Math.random() }),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        viewport: vi.fn(),
        useProgram: vi.fn(), // Added
        drawArrays: vi.fn(),
        // Cleanup functions
        deleteTexture: vi.fn(),
        deleteFramebuffer: vi.fn(),
        deleteProgram: vi.fn(),
        deleteShader: vi.fn(),
        deleteBuffer: vi.fn(),
        // Other utilities that might be called by webgl-utils if not fully mocked elsewhere
        texParameteri: vi.fn(),
        texImage2D: vi.fn(),
      };
    }),
    // Mocking the utility functions themselves, these are called by bigint.js:
    createShader: vi.fn().mockImplementation((gl, type, source) => {
      if (!gl || !source) return null; // Basic validation
      return { shaderId: Math.random(), type, source, from: 'mockWebglUtils.createShader' }; // Mock shader object
    }),
    createProgram: vi.fn().mockImplementation((gl, vertexShader, fragmentShader) => {
      if (!gl || !vertexShader || !fragmentShader) return null; // Basic validation
      return { programId: Math.random(), from: 'mockWebglUtils.createProgram' }; // Mock program object
    }),
    createDataTexture: vi.fn().mockImplementation((gl, data, width, height, isOutput) => {
      return { id: Math.random(), data, width, height, isOutput, source: 'mockWebglUtils.createDataTexture' };
    }),
    readDataFromTexture: vi.fn().mockImplementation((gl, fbo, width, height, isOutput) => {
      // This is a generic mock. Specific tests for 'add' will need to override this.
      const mockResult = new Float32Array(width * height * 4);
      // Default behavior: simulate adding "0" + "0" = "0"
      mockResult[0] = 0; // R: resultLimb
      mockResult[1] = 0; // G: carryOut
      mockResult[2] = 0; // B
      mockResult[3] = 1; // A
      return mockResult;
    }),
  };
});

describe('BigIntPrimitive', () => {
  beforeEach(() => {
    // Clears all spies, calls to mocked functions, and resets mocked implementations to undefined.
    vi.resetAllMocks();

    // After vi.resetAllMocks(), globally mocked functions (like those in webgl-utils)
    // lose their .mockImplementation defined in the vi.mock factory.
    // So, we need to re-apply default implementations here if tests rely on them
    // OR ensure each test perfectly sets up its required mocks.

    // Re-apply default implementations for webglUtils mocks
    // This ensures that if a test doesn't spyOn a particular webglUtil function,
    // it still gets a basic working mock.
    webglUtils.initWebGL.mockImplementation((canvas) => {
      if (!canvas) return null;
      return { /* a default mock gl, same as in global mock if needed */
        VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, FRAMEBUFFER_COMPLETE: 36053,
        createShader: vi.fn().mockReturnValue({ shaderId: Math.random() }),
        createProgram: vi.fn().mockReturnValue({ programId: Math.random() }), // Mock program object
        getAttribLocation: vi.fn().mockReturnValue(0),
        getUniformLocation: vi.fn().mockReturnValue(0),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        activeTexture: vi.fn(),
        bindTexture: vi.fn(),
        uniform1i: vi.fn(),
        // Add all GL methods that bigint.js calls on the gl object
        createFramebuffer: vi.fn().mockReturnValue({ fboId: Math.random() }),
        bindFramebuffer: vi.fn(),
        framebufferTexture2D: vi.fn(),
        checkFramebufferStatus: vi.fn().mockReturnValue(36053), // FRAMEBUFFER_COMPLETE
        createBuffer: vi.fn().mockReturnValue({ bufferId: Math.random() }),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        viewport: vi.fn(),
        useProgram: vi.fn(), // Added
        drawArrays: vi.fn(),
        deleteTexture: vi.fn(),
        deleteFramebuffer: vi.fn(),
        deleteProgram: vi.fn(),
        deleteShader: vi.fn(),
        deleteBuffer: vi.fn(),
        texParameteri: vi.fn(), // Other GL functions that might be used
        texImage2D: vi.fn(),
       };
    });
    webglUtils.createShader.mockImplementation((gl, type, source) => {
      if (!gl || !source) return null;
      return { shaderId: Math.random(), type, source, from: 'mockWebglUtils.createShader_beforeEach' };
    });
    webglUtils.createProgram.mockImplementation((gl, vertexShader, fragmentShader) => {
      if (!gl || !vertexShader || !fragmentShader) return null;
      return { programId: Math.random(), from: 'mockWebglUtils.createProgram_beforeEach' };
    });
    webglUtils.createDataTexture.mockImplementation((gl, data, width, height, isOutput) => {
      return { id: Math.random(), data, width, height, isOutput, source: 'mockWebglUtils.createDataTexture_beforeEach' };
    });
    webglUtils.readDataFromTexture.mockImplementation((gl, fbo, width, height, isOutput) => {
      const mockResult = new Float32Array(width * height * 4);
      mockResult[0] = 0; mockResult[1] = 0; mockResult[2] = 0; mockResult[3] = 1; // Default to 0 result
      return mockResult;
    });
  });

  describe('_core_subtract() with WebGL mock', () => {
    // Test simple subtraction, no borrow needed from JS level
    // Example: "5678" - "1234" = "4444"
    it('should subtract two positive single-limb numbers, no borrow', () => {
      const num1 = new BigIntPrimitive('5678', mockCanvas); // this.limbs = [5678]
      const num2 = new BigIntPrimitive('1234', mockCanvas); // positiveOtherBigInt.limbs = [1234]

      vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementation((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width * 4); // width = 1
        if (width === 1) {
          // Shader computes 5678 - 1234 - 0 (borrowIn from texture) = 4444
          // resultLimb = 4444, borrowOut = 0
          outputPixelDataRGBA[0] = 4444; // resultLimb
          outputPixelDataRGBA[1] = 0;   // borrowOut
        }
        return outputPixelDataRGBA;
      });

      const result = num1._core_subtract(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('4444');
      expect(result.sign).toBe(1);
    });

    // Test subtraction requiring a borrow that the shader handles internally (diff < 0)
    // Example: "12345" - "2346" = "9999" (BASE 10000)
    // num1 ("12345"): limbs [2345, 1]
    // num2 ("2346"): limbs [2346]
    // Expected result "9999", limbs [9999]
    // maxLength = 2
    // GPU pass (conceptual, as it's one draw call):
    // Limb 0: num1[0]=2345, num2[0]=2346. borrowIn=0. diff = 2345-2346-0 = -1. Shader: result=9999, borrowOut=1
    // Limb 1: num1[1]=1,   num2[1]=0.   borrowIn=0. diff = 1-0-0 = 1.     Shader: result=1,    borrowOut=0
    // Shader output (readDataFromTexture):
    //   resultLimbsFromGPU = [9999, 1]
    //   borrowOutFromGPU   = [1, 0]
    // JS processing:
    // i=0: propagatedBorrow=0. diffLimbShaderOutput=9999. jsBorrow=0. currentLimbFinal=9999. propagatedBorrow=borrowOutFromGPU[0]=1. finalResultLimbs=[9999]
    // i=1: propagatedBorrow=1. diffLimbShaderOutput=1.   jsBorrow=1. currentLimbFinal=1-1=0. propagatedBorrow=borrowOutFromGPU[1]=0. finalResultLimbs=[9999,0] -> normalized to [9999]
    it('should subtract with borrow handled by shader and JS propagation', () => {
      const num1 = new BigIntPrimitive('12345', mockCanvas);
      const num2 = new BigIntPrimitive('2346', mockCanvas);

      vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementation((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width * 4); // width = 2
        if (width === 2) {
          // Limb 0 (shader output for 2345 - 2346 - 0)
          outputPixelDataRGBA[0*4 + 0] = 9999; // resultLimb
          outputPixelDataRGBA[0*4 + 1] = 1;   // borrowOut
          // Limb 1 (shader output for 1 - 0 - 0)
          outputPixelDataRGBA[1*4 + 0] = 1;    // resultLimb
          outputPixelDataRGBA[1*4 + 1] = 0;    // borrowOut
        }
        return outputPixelDataRGBA;
      });

      const result = num1._core_subtract(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('9999');
      expect(result.sign).toBe(1);
    });

    // Test "10000" - "1" = "9999"
    // num1("10000"): limbs [0, 1]
    // num2("1"): limbs [1]
    // Expected: "9999", limbs [9999]
    // maxLength = 2
    // GPU (shader outputs):
    //   Limb 0: 0 - 1 - 0 = -1. Shader: result=9999, borrowOut=1
    //   Limb 1: 1 - 0 - 0 = 1.  Shader: result=1,    borrowOut=0
    //   readDataFromTexture returns: resultLimbsGPU=[9999,1], borrowOutGPU=[1,0]
    // JS processing:
    //   i=0: propBorrowIn=0. diffLimb=9999. currentLimb=9999-0=9999. final=[9999]. propBorrowOut=borrowOutGPU[0]=1.
    //   i=1: propBorrowIn=1. diffLimb=1.   currentLimb=1-1=0.     final=[9999,0]. propBorrowOut=borrowOutGPU[1]=0.
    //   Normalized: [9999]
    it('should correctly subtract "10000" - "1"', () => {
        const num1 = new BigIntPrimitive('10000', mockCanvas);
        const num2 = new BigIntPrimitive('1', mockCanvas);

        vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementation((gl, fbo, width, height, isOutput) => {
            const outputPixelDataRGBA = new Float32Array(width * 4); // width = 2
            if (width === 2) {
                outputPixelDataRGBA[0*4 + 0] = 9999; // resultLimb for limb 0
                outputPixelDataRGBA[0*4 + 1] = 1;   // borrowOut for limb 0
                outputPixelDataRGBA[1*4 + 0] = 1;    // resultLimb for limb 1
                outputPixelDataRGBA[1*4 + 1] = 0;    // borrowOut for limb 1
            }
            return outputPixelDataRGBA;
        });
        const result = num1._core_subtract(num2);
        expect(result.toString()).toBe('9999');
        expect(result.sign).toBe(1);
    });

    // Test subtraction resulting in zero
    // Example: "12345" - "12345" = "0"
    it('should subtract to zero', () => {
      const num1 = new BigIntPrimitive('12345', mockCanvas);
      const num2 = new BigIntPrimitive('12345', mockCanvas);
      // num1.limbs = [2345, 1], num2.limbs = [2345, 1]. maxLength = 2
      // GPU (shader outputs):
      //   Limb 0: 2345 - 2345 - 0 = 0. Shader: result=0, borrowOut=0
      //   Limb 1: 1 - 1 - 0 = 0.     Shader: result=0, borrowOut=0
      //   readDataFromTexture returns: resultLimbsGPU=[0,0], borrowOutGPU=[0,0]
      // JS processing leads to finalResultLimbs = [0,0], normalized to [0]
      vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementation((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width * 4); // width = 2
         if (width === 2) {
            outputPixelDataRGBA[0*4 + 0] = 0;
            outputPixelDataRGBA[0*4 + 1] = 0;
            outputPixelDataRGBA[1*4 + 0] = 0;
            outputPixelDataRGBA[1*4 + 1] = 0;
        }
        return outputPixelDataRGBA;
      });

      const result = num1._core_subtract(num2);
      expect(result.isZero()).toBe(true);
      expect(result.toString()).toBe('0');
      expect(result.sign).toBe(1);
    });

    // Test a more complex multi-limb subtraction with borrows
    // Example: "12345678" - "3456789" = "8888889"
    // num1 ("12345678"): limbs [5678, 1234]
    // num2 ("3456789"):  limbs [6789, 345]
    // Expected: "8888889", limbs [8889, 888]
    // maxLength = 2
    // GPU shader outputs (num1Limb - num2Limb - 0):
    // Limb 0: 5678 - 6789 = -1111. Shader: result=8889, borrowOut=1
    // Limb 1: 1234 - 345  = 889.   Shader: result=889, borrowOut=0
    // readDataFromTexture returns: resultLimbsGPU=[8889, 889], borrowOutGPU=[1,0]
    // JS processing:
    // i=0: propBorrowIn=0. diffLimb=8889. currentLimb=8889-0=8889. final=[8889]. propBorrowOut=borrowOutGPU[0]=1
    // i=1: propBorrowIn=1. diffLimb=889.  currentLimb=889-1=888.  final=[8889,888]. propBorrowOut=borrowOutGPU[1]=0
    // Result limbs: [8889, 888] -> "8888889"
    it('should handle multi-limb subtraction with borrows', () => {
        const num1 = new BigIntPrimitive('12345678', mockCanvas);
        const num2 = new BigIntPrimitive('3456789', mockCanvas);

        vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementation((gl, fbo, width, height, isOutput) => {
            const outputPixelDataRGBA = new Float32Array(width * 4); // width = 2
            if (width === 2) {
                outputPixelDataRGBA[0*4 + 0] = 8889; // resultLimb for 5678-6789
                outputPixelDataRGBA[0*4 + 1] = 1;    // borrowOut
                outputPixelDataRGBA[1*4 + 0] = 889;  // resultLimb for 1234-345
                outputPixelDataRGBA[1*4 + 1] = 0;    // borrowOut
            }
            return outputPixelDataRGBA;
        });
        const result = num1._core_subtract(num2);
        expect(result.toString()).toBe('8888889');
        expect(result.sign).toBe(1);
    });
  });

  // New tests for negate, abs, isPositive, isNegative, compareMagnitude
  describe('Sign, Absolute Value, and Comparison', () => {
    it('negate() should flip the sign of a positive number', () => {
      const n1 = new BigIntPrimitive('123', mockCanvas);
      const n2 = n1.negate();
      expect(n2.toString()).toBe('-123');
      expect(n2.sign).toBe(-1);
      expect(n1.sign).toBe(1); // Original unchanged
      expect(n2.canvas).toBe(mockCanvas);
    });

    it('negate() should flip the sign of a negative number', () => {
      const n1 = new BigIntPrimitive('-123', mockCanvas);
      const n2 = n1.negate();
      expect(n2.toString()).toBe('123');
      expect(n2.sign).toBe(1);
      expect(n1.sign).toBe(-1); // Original unchanged
    });

    it('negate() should handle zero correctly', () => {
      const n1 = new BigIntPrimitive('0', mockCanvas);
      const n2 = n1.negate();
      expect(n2.toString()).toBe('0');
      expect(n2.sign).toBe(1); // Zero's sign is always 1
    });

    it('abs() should return positive for a negative number', () => {
      const n1 = new BigIntPrimitive('-123', mockCanvas);
      const n2 = n1.abs();
      expect(n2.toString()).toBe('123');
      expect(n2.sign).toBe(1);
      expect(n1.sign).toBe(-1); // Original unchanged
      expect(n2.canvas).toBe(mockCanvas);
    });

    it('abs() should return positive for a positive number', () => {
      const n1 = new BigIntPrimitive('123', mockCanvas);
      const n2 = n1.abs();
      expect(n2.toString()).toBe('123');
      expect(n2.sign).toBe(1);
    });

    it('abs() should handle zero correctly', () => {
      const n1 = new BigIntPrimitive('0', mockCanvas);
      const n2 = n1.abs();
      expect(n2.toString()).toBe('0');
      expect(n2.sign).toBe(1);
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
      const n1 = new BigIntPrimitive('123');
      const n2 = new BigIntPrimitive('45');
      const n3 = new BigIntPrimitive('123');
      const n4 = new BigIntPrimitive('-123');
      const n5 = new BigIntPrimitive('-45');
      const n6 = new BigIntPrimitive('0');

      expect(n1.compareMagnitude(n2)).toBe(1);  // 123 > 45
      expect(n2.compareMagnitude(n1)).toBe(-1); // 45 < 123
      expect(n1.compareMagnitude(n3)).toBe(0);  // 123 == 123

      // Compare with negative numbers (should compare absolute values)
      expect(n1.compareMagnitude(n5)).toBe(1);  // abs(123) > abs(-45)
      expect(n2.compareMagnitude(n4)).toBe(-1); // abs(45) < abs(-123)
      expect(n1.compareMagnitude(n4)).toBe(0);  // abs(123) == abs(-123)

      // Compare with zero
      expect(n1.compareMagnitude(n6)).toBe(1); // 123 > 0
      expect(n6.compareMagnitude(n1)).toBe(-1); // 0 < 123
      expect(n6.compareMagnitude(new BigIntPrimitive("0"))).toBe(0); // 0 == 0
    });
  });

  describe('constructor', () => {
    it('should create BigIntPrimitive from a valid positive string', () => {
      const n = new BigIntPrimitive('12345678901234567890');
      expect(n.toString()).toBe('12345678901234567890');
    });

    it('should create BigIntPrimitive from a valid number', () => {
      const n = new BigIntPrimitive(12345);
      expect(n.toString()).toBe('12345');
    });

    it('should create BigIntPrimitive for zero string "0"', () => {
      const n = new BigIntPrimitive('0');
      expect(n.toString()).toBe('0');
      expect(n.isZero()).toBe(true);
    });

    it('should create BigIntPrimitive for zero number 0', () => {
      const n = new BigIntPrimitive(0);
      expect(n.toString()).toBe('0');
      expect(n.isZero()).toBe(true);
    });

    it('should handle empty string as zero', () => {
      const n = new BigIntPrimitive('');
      expect(n.toString()).toBe('0');
      expect(n.isZero()).toBe(true);
    });

    it('should throw TypeError for invalid string input', () => {
      expect(() => new BigIntPrimitive('abc')).toThrow(TypeError);
      expect(() => new BigIntPrimitive('123a45')).toThrow(TypeError);
    });

    it('should throw TypeError for non-integer number input', () => {
      expect(() => new BigIntPrimitive(123.45)).toThrow(TypeError);
    });

    it('should throw TypeError for invalid input types', () => {
      expect(() => new BigIntPrimitive(null)).toThrow(TypeError);
      expect(() => new BigIntPrimitive(undefined)).toThrow(TypeError);
      expect(() => new BigIntPrimitive({})).toThrow(TypeError);
      expect(() => new BigIntPrimitive([])).toThrow(TypeError);
    });

    it('should correctly parse numbers into limbs (BASE 10000)', () => {
      const n1 = new BigIntPrimitive('12345'); // limbs: [2345, 1]
      expect(n1.limbs).toEqual([2345, 1]);
      const n2 = new BigIntPrimitive('10000'); // limbs: [0, 1]
      expect(n2.limbs).toEqual([0, 1]);
      const n3 = new BigIntPrimitive('9999'); // limbs: [9999]
      expect(n3.limbs).toEqual([9999]);
       const n4 = new BigIntPrimitive('12345678'); // limbs: [5678, 1234]
      expect(n4.limbs).toEqual([5678, 1234]);
    });
  });

  describe('toString()', () => {
    it('should convert simple BigIntPrimitive to string', () => {
      const n = new BigIntPrimitive('98765');
      expect(n.toString()).toBe('98765');
    });

    it('should convert multi-limb BigIntPrimitive to string', () => {
      // BASE is 10000, BASE_LOG10 is 4
      // limbs are stored in reverse order of significance
      const n = new BigIntPrimitive("0", mockCanvas); // use mockCanvas
      n.limbs = [5678, 1234]; // Represents 12345678
      expect(n.toString()).toBe('12345678');
    });

    it('should convert single limb BigIntPrimitive to string, no padding needed', () => {
      const n = new BigIntPrimitive("0", mockCanvas);
      n.limbs = [123];
      expect(n.toString()).toBe('123');
    });

    it('should correctly pad with zeros for intermediate limbs', () => {
      const n = new BigIntPrimitive("0", mockCanvas);
      n.limbs = [1, 1]; // Represents 10001 (if BASE=10000)
      expect(n.toString()).toBe('10001');

      const n2 = new BigIntPrimitive("0", mockCanvas);
      n2.limbs = [12, 34, 5]; // Represents 500340012
      expect(n2.toString()).toBe('500340012');
    });
  });

  describe('isZero()', () => {
    it('should return true for zero', () => {
      const n = new BigIntPrimitive('0');
      expect(n.isZero()).toBe(true);
    });

    it('should return false for non-zero', () => {
      const n = new BigIntPrimitive('123');
      expect(n.isZero()).toBe(false);
    });
  });

  describe('subtract() - public method with sign logic', () => {
    let coreAddSpy, coreSubtractSpy;

    beforeEach(() => {
      // Spy on the actual prototype methods, they will be reset by vi.resetAllMocks()
      coreAddSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_add');
      coreSubtractSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_subtract');
    });

    // A - B (A > B, both positive)
    it('should handle positive - positive (a > b)', () => {
      const a = new BigIntPrimitive('500', mockCanvas);
      const b = new BigIntPrimitive('200', mockCanvas);
      coreSubtractSpy.mockReturnValue(new BigIntPrimitive('300', mockCanvas)); // a.abs()._core_subtract(b.abs())

      const result = a.subtract(b);
      expect(result.toString()).toBe('300');
      expect(coreSubtractSpy).toHaveBeenCalledTimes(1);
      expect(coreAddSpy).not.toHaveBeenCalled();
    });

    // A - B (A < B, both positive) -> -(B - A)
    it('should handle positive - positive (a < b)', () => {
      const a = new BigIntPrimitive('200', mockCanvas);
      const b = new BigIntPrimitive('500', mockCanvas);
      // b.abs()._core_subtract(a.abs()) will be called
      coreSubtractSpy.mockReturnValue(new BigIntPrimitive('300', mockCanvas));

      const result = a.subtract(b);
      expect(result.toString()).toBe('-300');
      expect(coreSubtractSpy).toHaveBeenCalledTimes(1);
      expect(coreAddSpy).not.toHaveBeenCalled();
    });

    // A - B (A == B, both positive)
    it('should handle positive - positive (a == b)', () => {
      const a = new BigIntPrimitive('500', mockCanvas);
      const b = new BigIntPrimitive('500', mockCanvas);
      // coreSubtractSpy should ideally not be called due to compareMagnitude optimization

      const result = a.subtract(b);
      expect(result.toString()).toBe('0');
      expect(coreSubtractSpy).not.toHaveBeenCalled();
      expect(coreAddSpy).not.toHaveBeenCalled();
    });

    // A - (-B) -> A + B (A positive, B positive)
    it('should handle positive - negative', () => {
      const a = new BigIntPrimitive('500', mockCanvas);
      const negB = new BigIntPrimitive('-200', mockCanvas); // -B means B is "200"
      coreAddSpy.mockReturnValue(new BigIntPrimitive('700', mockCanvas)); // a.abs()._core_add(negB.abs())

      const result = a.subtract(negB);
      expect(result.toString()).toBe('700');
      expect(coreAddSpy).toHaveBeenCalledTimes(1);
      expect(coreSubtractSpy).not.toHaveBeenCalled();
    });

    // (-A) - B -> -(A + B) (A positive, B positive)
    it('should handle negative - positive', () => {
      const negA = new BigIntPrimitive('-500', mockCanvas);
      const b = new BigIntPrimitive('200', mockCanvas);
      coreAddSpy.mockReturnValue(new BigIntPrimitive('700', mockCanvas)); // negA.abs()._core_add(b.abs())

      const result = negA.subtract(b);
      expect(result.toString()).toBe('-700');
      expect(coreAddSpy).toHaveBeenCalledTimes(1);
      expect(coreSubtractSpy).not.toHaveBeenCalled();
    });

    // (-A) - (-B) where abs(A) > abs(B) -> -(abs(A) - abs(B))
    it('should handle negative - negative (abs(a) > abs(b))', () => {
      const negA = new BigIntPrimitive('-500', mockCanvas); // A is 500
      const negB = new BigIntPrimitive('-200', mockCanvas); // B is 200
      // negA.abs()._core_subtract(negB.abs()) -> 500 - 200
      coreSubtractSpy.mockReturnValue(new BigIntPrimitive('300', mockCanvas));

      const result = negA.subtract(negB);
      expect(result.toString()).toBe('-300');
      expect(coreSubtractSpy).toHaveBeenCalledTimes(1);
      expect(coreAddSpy).not.toHaveBeenCalled();
    });

    // (-A) - (-B) where abs(A) < abs(B) -> abs(B) - abs(A)
    it('should handle negative - negative (abs(a) < abs(b))', () => {
      const negA = new BigIntPrimitive('-200', mockCanvas); // A is 200
      const negB = new BigIntPrimitive('-500', mockCanvas); // B is 500
      // negB.abs()._core_subtract(negA.abs()) -> 500 - 200
      coreSubtractSpy.mockReturnValue(new BigIntPrimitive('300', mockCanvas));

      const result = negA.subtract(negB);
      expect(result.toString()).toBe('300');
      expect(coreSubtractSpy).toHaveBeenCalledTimes(1);
      expect(coreAddSpy).not.toHaveBeenCalled();
    });

    // (-A) - (-B) where A == B
    it('should handle negative - negative (a == b)', () => {
      const negA = new BigIntPrimitive('-500', mockCanvas);
      const negB = new BigIntPrimitive('-500', mockCanvas);

      const result = negA.subtract(negB);
      expect(result.toString()).toBe('0');
      expect(coreSubtractSpy).not.toHaveBeenCalled();
      expect(coreAddSpy).not.toHaveBeenCalled();
    });

    // Operations involving zero
    it('a - 0 = a', () => {
      const a = new BigIntPrimitive('123', mockCanvas);
      const zero = new BigIntPrimitive('0', mockCanvas);
      // This becomes a.abs()._core_subtract(zero.abs()) -> "123" - "0"
      coreSubtractSpy.mockReturnValue(new BigIntPrimitive('123', mockCanvas));

      const result = a.subtract(zero);
      expect(result.toString()).toBe('123');
      // Check if _core_subtract was called, or if there's an optimization for subtracting zero
      // Based on current subtract() logic, it will call _core_subtract if not (a == 0 and b == 0)
      expect(coreSubtractSpy).toHaveBeenCalledTimes(1);
    });

    it('0 - a = -a', () => {
      const zero = new BigIntPrimitive('0', mockCanvas);
      const a = new BigIntPrimitive('123', mockCanvas);
      // This becomes a.abs()._core_subtract(zero.abs()) and sign flipped
      coreSubtractSpy.mockReturnValue(new BigIntPrimitive('123', mockCanvas));

      const result = zero.subtract(a);
      expect(result.toString()).toBe('-123');
      expect(coreSubtractSpy).toHaveBeenCalledTimes(1);
    });

    it('0 - (-a) = a', () => {
        const zero = new BigIntPrimitive('0', mockCanvas);
        const negA = new BigIntPrimitive('-123', mockCanvas);
        // This becomes zero.abs()._core_add(negA.abs()) -> "0" + "123"
        coreAddSpy.mockReturnValue(new BigIntPrimitive('123', mockCanvas));

        const result = zero.subtract(negA);
        expect(result.toString()).toBe('123'); // Sign of zero is 1.
        expect(coreAddSpy).toHaveBeenCalledTimes(1);
    });

    it('0 - 0 = 0', () => {
      const zero1 = new BigIntPrimitive('0', mockCanvas);
      const zero2 = new BigIntPrimitive('0', mockCanvas);

      const result = zero1.subtract(zero2);
      expect(result.toString()).toBe('0');
      expect(coreSubtractSpy).not.toHaveBeenCalled();
      expect(coreAddSpy).not.toHaveBeenCalled();
    });
  });

  describe('add() with WebGL mock', () => {
    it('should add two small BigIntPrimitives (e.g., "123" + "456" = "579")', () => {
      // Specific mock for this test case's expected WebGL output using spyOn
      const readDataMock = vi.spyOn(webglUtils, 'readDataFromTexture');
      readDataMock.mockImplementation((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width * 4);
        if (width === 1) { // For "123" + "456", width (maxLength) is 1
            outputPixelDataRGBA[0] = 579; // Result: 123 + 456 = 579
            outputPixelDataRGBA[1] = 0;   // Carry: 0
        }
        return outputPixelDataRGBA;
      });

      const num1 = new BigIntPrimitive('123', mockCanvas);
      const num2 = new BigIntPrimitive('456', mockCanvas);
      const result = num1.add(num2);

      expect(result).not.toBeNull();
      if (result) { // Type guard for TypeScript and to prevent error if null
        expect(result.toString()).toBe('579');
      }
      expect(webglUtils.initWebGL).toHaveBeenCalledWith(mockCanvas);
      // createDataTexture is called for num1, num2, carryIn, and texOutput
      expect(webglUtils.createDataTexture).toHaveBeenCalledTimes(4);
      expect(webglUtils.readDataFromTexture).toHaveBeenCalledTimes(1);
      // readDataMock.mockRestore(); // Rely on resetAllMocks in beforeEach
    });

    it('should add two larger BigIntPrimitives requiring multiple limbs (e.g., "8000" + "7000" = "15000", BASE=10000)', () => {
      const readDataMock = vi.spyOn(webglUtils, 'readDataFromTexture');
      readDataMock.mockImplementation((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width * 4);
        // For "8000" + "7000", maxLength will be 1. So width = 1.
        if (width === 1) {
            outputPixelDataRGBA[0] = 5000; // resultLimb for 15000 % 10000
            outputPixelDataRGBA[1] = 1;   // carryOut for 15000 / 10000
        }
        return outputPixelDataRGBA;
      });

      const num1 = new BigIntPrimitive('8000', mockCanvas);
      const num2 = new BigIntPrimitive('7000', mockCanvas);
      const result = num1.add(num2);

      expect(result).not.toBeNull();
      expect(result.toString()).toBe('15000'); // Limbs: [5000, 1]
      // readDataMock.mockRestore(); // Rely on resetAllMocks in beforeEach
    });

    it('should add numbers resulting in a carry propagation across multiple limbs (e.g., "9999" + "1" = "10000")', () => {
      // num1.limbs = [9999], num2.limbs = [1]
      // Expected sum "10000", result.limbs = [0, 1]
      const readDataMock = vi.spyOn(webglUtils, 'readDataFromTexture');
      readDataMock.mockImplementation((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width * 4);
        // For "9999" + "1", maxLength will be 1. So width = 1.
        if (width === 1) {
            outputPixelDataRGBA[0] = 0; // resultLimb for 10000 % 10000
            outputPixelDataRGBA[1] = 1; // carryOut for 10000 / 10000
        }
        return outputPixelDataRGBA;
      });

      const num1 = new BigIntPrimitive('9999', mockCanvas);
      const num2 = new BigIntPrimitive('1', mockCanvas);
      const result = num1.add(num2);

      expect(result).not.toBeNull();
      expect(result.toString()).toBe('10000');
      // readDataMock.mockRestore(); // Rely on resetAllMocks in beforeEach
    });

    it('should handle adding zero to a number', () => {
      const readDataMock = vi.spyOn(webglUtils, 'readDataFromTexture');
      readDataMock.mockImplementation((gl, fbo, width, height, isOutput) => {
        // num1 = "12345" (limbs [2345, 1] if BASE=10000), numZero = "0" (limbs [0])
        // maxLength = 2. So width = 2.
        const outputPixelDataRGBA = new Float32Array(width * 4);
        if (width === 2) {
            // GPU processing for idx 0: num1[0]=2345, numZero[0]=0. Sum=2345. Out: sum=2345, carry=0
            outputPixelDataRGBA[0*4 + 0] = 2345;
            outputPixelDataRGBA[0*4 + 1] = 0;
            // GPU processing for idx 1: num1[1]=1, numZero[1]=0 (padded). Sum=1. Out: sum=1, carry=0
            outputPixelDataRGBA[1*4 + 0] = 1;
            outputPixelDataRGBA[1*4 + 1] = 0;
        }
        // If width is not 2, it will return zeros, leading to test failure, which is good.
        return outputPixelDataRGBA;
      });

      const num1 = new BigIntPrimitive('12345', mockCanvas);
      const numZero = new BigIntPrimitive('0', mockCanvas);
      const result = num1.add(numZero);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.toString()).toBe('12345');
      }
      // readDataMock.mockRestore(); // Rely on resetAllMocks in beforeEach
    });

    // More complex test: Adding two multi-limb numbers.
    // "123456789" + "987654321" = "1111111110"
    // BASE = 10000
    // num1 ("123456789"): limbs [56789 % 10000, floor(56789/10000)=5 (no, this is wrong) ] -> [6789, 3456, 12]
    //   num1.limbs = [6789, 3456, 12] (12,3456,6789)
    // num2 ("987654321"): limbs [54321 % 10000, floor(54321/10000)=5 (no) ] -> [4321, 7654, 98]
    //   num2.limbs = [4321, 7654, 98] (98,7654,4321)
    // Expected sum: "1111111110" -> limbs [1110, 1111, 111] (111,1111,1110)
    // MaxLength = 3
    // GPU pass 1 (index 0): 6789 + 4321 = 11110. GPU out: limb=1110, carry=1
    // GPU pass 2 (index 1): 3456 + 7654 = 11110. GPU out: limb=1110, carry=1
    // GPU pass 3 (index 2):   12 +   98 =  0110. GPU out: limb=0110, carry=0
    // JS processing:
    // finalResultLimbs[0]: outputPixelDataRGBA[0*4+0]=1110. propagatedCarry=0. sum=1110. final=1110. propagatedCarry=outputPixelDataRGBA[0*4+1]=1 + floor(1110/10000)=0 => propCarry=1
    // finalResultLimbs[1]: outputPixelDataRGBA[1*4+0]=1110. propagatedCarry=1. sum=1111. final=1111. propagatedCarry=outputPixelDataRGBA[1*4+1]=1 + floor(1111/10000)=0 => propCarry=1
    // finalResultLimbs[2]: outputPixelDataRGBA[2*4+0]=0110. propagatedCarry=1. sum=0111. final=0111. propagatedCarry=outputPixelDataRGBA[2*4+1]=0 + floor(0111/10000)=0 => propCarry=0
    // finalResultLimbs = [1110, 1111, 111]
    // This is 111,1111,1110 which is 1111111110
    it('should add two multi-limb numbers with carries', () => {
      const readDataMock = vi.spyOn(webglUtils, 'readDataFromTexture');
      readDataMock.mockImplementation((gl, fbo, width, height, isOutput) => {
        // width here would be Math.max(num1.limbs.length, num2.limbs.length) which is 3
        const outputPixelDataRGBA = new Float32Array(width * 4);
        // Simulating GPU output for "123456789" + "987654321"
        // Input limbs (reversed from string):
        // num1 ("123456789"): [6789, 3456, 12]
        // num2 ("987654321"): [4321, 7654, 98]

        // GPU output for index 0 (limbs 6789, 4321): sum=11110 -> resultLimb=1110, carryOut=1
        outputPixelDataRGBA[0*4 + 0] = 1110;
        outputPixelDataRGBA[0*4 + 1] = 1;

        // GPU output for index 1 (limbs 3456, 7654): sum=11110 -> resultLimb=1110, carryOut=1
        outputPixelDataRGBA[1*4 + 0] = 1110;
        outputPixelDataRGBA[1*4 + 1] = 1;

        // GPU output for index 2 (limbs 12, 98): sum=110 -> resultLimb=110, carryOut=0
        outputPixelDataRGBA[2*4 + 0] = 110;
        outputPixelDataRGBA[2*4 + 1] = 0;

        return outputPixelDataRGBA;
      });

      const num1 = new BigIntPrimitive('123456789', mockCanvas);
      const num2 = new BigIntPrimitive('987654321', mockCanvas);
      const result = num1.add(num2);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.toString()).toBe('11111111110'); // Corrected expected value
      }
      // readDataMock.mockRestore(); // Rely on resetAllMocks in beforeEach
    });

  });
});
