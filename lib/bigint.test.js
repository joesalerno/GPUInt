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
