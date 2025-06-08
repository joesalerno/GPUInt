import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BigIntPrimitive } from './bigint';
import * as webglUtils from './webgl-utils';

// Mock canvas
const mockCanvas = {
  getContext: vi.fn().mockReturnValue({
    getExtension: vi.fn().mockReturnValue(true),
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
        createFramebuffer: vi.fn().mockReturnValue({ fboId: Math.random() }),
        bindFramebuffer: vi.fn(),
        framebufferTexture2D: vi.fn(),
        checkFramebufferStatus: vi.fn().mockReturnValue(36053),
        createBuffer: vi.fn().mockReturnValue({ bufferId: Math.random() }),
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
        uniform1f: vi.fn(),
      };
    }),
    createShader: vi.fn().mockImplementation((gl, type, source) => {
      if (!gl || !source) return null;
      return { shaderId: Math.random(), type, source, from: 'mockWebglUtils.createShader' };
    }),
    createProgram: vi.fn().mockImplementation((gl, vertexShader, fragmentShader) => {
      if (!gl || !vertexShader || !fragmentShader) return null;
      return { programId: Math.random(), from: 'mockWebglUtils.createProgram' };
    }),
    createDataTexture: vi.fn().mockImplementation((gl, data, width, height, isOutput) => {
      return { id: Math.random(), data, width, height, isOutput, source: 'mockWebglUtils.createDataTexture' };
    }),
    readDataFromTexture: vi.fn().mockImplementation((gl, fbo, width, height, isOutput) => {
      const mockResult = new Float32Array(width * height * 4);
      mockResult[0] = 0; mockResult[1] = 0; mockResult[2] = 0; mockResult[3] = 1;
      return mockResult;
    }),
  };
});

describe('BigIntPrimitive', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    webglUtils.initWebGL.mockImplementation((canvas) => {
      if (!canvas) return null;
      return {
        VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, FRAMEBUFFER_COMPLETE: 36053,
        createShader: vi.fn().mockReturnValue({ shaderId: Math.random() }),
        createProgram: vi.fn().mockReturnValue({ programId: Math.random() }),
        getAttribLocation: vi.fn().mockReturnValue(0),
        getUniformLocation: vi.fn().mockReturnValue(0),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        activeTexture: vi.fn(),
        bindTexture: vi.fn(),
        uniform1i: vi.fn(),
        createFramebuffer: vi.fn().mockReturnValue({ fboId: Math.random() }),
        bindFramebuffer: vi.fn(),
        framebufferTexture2D: vi.fn(),
        checkFramebufferStatus: vi.fn().mockReturnValue(36053),
        createBuffer: vi.fn().mockReturnValue({ bufferId: Math.random() }),
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
        uniform1f: vi.fn(),
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
      mockResult[0] = 0; mockResult[1] = 0; mockResult[2] = 0; mockResult[3] = 1;
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
      const n1 = new BigIntPrimitive('12345'); expect(n1.limbs).toEqual([2345, 1]);
      const n2 = new BigIntPrimitive('10000'); expect(n2.limbs).toEqual([0, 1]);
      const n3 = new BigIntPrimitive('9999'); expect(n3.limbs).toEqual([9999]);
      const n4 = new BigIntPrimitive('12345678'); expect(n4.limbs).toEqual([5678, 1234]);
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

  describe('toString()', () => {
    it('should convert simple BigIntPrimitive to string', () => {
      const n = new BigIntPrimitive('98765'); expect(n.toString()).toBe('98765');
    });
    it('should convert multi-limb BigIntPrimitive to string', () => {
      const n = new BigIntPrimitive("0", mockCanvas); n.limbs = [5678, 1234];
      expect(n.toString()).toBe('12345678');
    });
    it('should convert single limb BigIntPrimitive to string, no padding needed', () => {
      const n = new BigIntPrimitive("0", mockCanvas); n.limbs = [123];
      expect(n.toString()).toBe('123');
    });
    it('should correctly pad with zeros for intermediate limbs', () => {
      const n = new BigIntPrimitive("0", mockCanvas); n.limbs = [1, 1];
      expect(n.toString()).toBe('10001');
      const n2 = new BigIntPrimitive("0", mockCanvas); n2.limbs = [12, 34, 5];
      expect(n2.toString()).toBe('500340012');
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
    it('should add two small BigIntPrimitives (e.g., "123" + "456" = "579")', () => {
      const readDataMock = vi.spyOn(webglUtils, 'readDataFromTexture');
      readDataMock.mockImplementation((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width * 4);
        if (width === 1) { outputPixelDataRGBA[0] = 579; outputPixelDataRGBA[1] = 0; }
        return outputPixelDataRGBA;
      });
      const num1 = new BigIntPrimitive('123', mockCanvas); const num2 = new BigIntPrimitive('456', mockCanvas);
      const result = num1.add(num2);
      expect(result).not.toBeNull(); if (result) { expect(result.toString()).toBe('579'); }
      expect(webglUtils.initWebGL).toHaveBeenCalledWith(mockCanvas);
      expect(webglUtils.createDataTexture).toHaveBeenCalledTimes(4);
      expect(webglUtils.readDataFromTexture).toHaveBeenCalledTimes(1);
    });
    it('should add two larger BigIntPrimitives requiring multiple limbs (e.g., "8000" + "7000" = "15000", BASE=10000)', () => {
      const readDataMock = vi.spyOn(webglUtils, 'readDataFromTexture');
      readDataMock.mockImplementation((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width*4); if (width === 1) { outputPixelDataRGBA[0]=5000; outputPixelDataRGBA[1]=1;} return outputPixelDataRGBA;
      });
      const num1 = new BigIntPrimitive('8000', mockCanvas); const num2 = new BigIntPrimitive('7000', mockCanvas);
      const result = num1.add(num2);
      expect(result).not.toBeNull(); expect(result.toString()).toBe('15000');
    });
    it('should add numbers resulting in a carry propagation across multiple limbs (e.g., "9999" + "1" = "10000")', () => {
      const readDataMock = vi.spyOn(webglUtils, 'readDataFromTexture');
      readDataMock.mockImplementation((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width*4); if (width === 1) {outputPixelDataRGBA[0]=0; outputPixelDataRGBA[1]=1;} return outputPixelDataRGBA;
      });
      const num1 = new BigIntPrimitive('9999', mockCanvas); const num2 = new BigIntPrimitive('1', mockCanvas);
      const result = num1.add(num2);
      expect(result).not.toBeNull(); expect(result.toString()).toBe('10000');
    });
    it('should handle adding zero to a number', () => {
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
      const readDataMock = vi.spyOn(webglUtils, 'readDataFromTexture');
      readDataMock.mockImplementation((gl, fbo, width, height, isOutput) => {
        const outputPixelDataRGBA = new Float32Array(width*4);
        outputPixelDataRGBA[0*4+0]=1110; outputPixelDataRGBA[0*4+1]=1;
        outputPixelDataRGBA[1*4+0]=1110; outputPixelDataRGBA[1*4+1]=1;
        outputPixelDataRGBA[2*4+0]=110; outputPixelDataRGBA[2*4+1]=0;
        return outputPixelDataRGBA;
      });
      const num1 = new BigIntPrimitive('123456789', mockCanvas); const num2 = new BigIntPrimitive('987654321', mockCanvas);
      const result = num1.add(num2);
      expect(result).not.toBeNull(); if (result) { expect(result.toString()).toBe('11111111110'); }
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
      const result=zero.subtract(negA); expect(result.toString()).toBe('123'); expect(coreAddSpy).toHaveBeenCalledTimes(1);
    });
    it('0 - 0 = 0', () => {
      const zero1=new BigIntPrimitive('0',mockCanvas); const zero2=new BigIntPrimitive('0',mockCanvas);
      const result=zero1.subtract(zero2); expect(result.toString()).toBe('0'); expect(coreSubtractSpy).not.toHaveBeenCalled(); expect(coreAddSpy).not.toHaveBeenCalled();
    });
  });

  describe('_core_subtract() with WebGL mock', () => {
    it('should subtract two positive single-limb numbers, no borrow', () => {
      const num1=new BigIntPrimitive('5678',mockCanvas); const num2=new BigIntPrimitive('1234',mockCanvas);
      vi.spyOn(webglUtils,'readDataFromTexture').mockImplementation((gl,fbo,width,height,isOutput) => { const o=new Float32Array(width*4); if(width===1){o[0]=4444;o[1]=0;} return o;});
      const result=num1._core_subtract(num2); expect(result).not.toBeNull(); expect(result.toString()).toBe('4444'); expect(result.sign).toBe(1);
    });
    it('should subtract with borrow handled by shader and JS propagation', () => {
      const num1=new BigIntPrimitive('12345',mockCanvas); const num2=new BigIntPrimitive('2346',mockCanvas);
      vi.spyOn(webglUtils,'readDataFromTexture').mockImplementation((gl,fbo,width,height,isOutput) => { const o=new Float32Array(width*4); if(width===2){o[0]=9999;o[1]=1;o[4]=1;o[5]=0;} return o;});
      const result=num1._core_subtract(num2); expect(result).not.toBeNull(); expect(result.toString()).toBe('9999'); expect(result.sign).toBe(1);
    });
    it('should correctly subtract "10000" - "1"', () => {
      const num1=new BigIntPrimitive('10000',mockCanvas); const num2=new BigIntPrimitive('1',mockCanvas);
      vi.spyOn(webglUtils,'readDataFromTexture').mockImplementation((gl,fbo,width,height,isOutput) => { const o=new Float32Array(width*4); if(width===2){o[0]=9999;o[1]=1;o[4]=1;o[5]=0;} return o;});
      const result=num1._core_subtract(num2); expect(result.toString()).toBe('9999'); expect(result.sign).toBe(1);
    });
    it('should subtract to zero', () => {
      const num1=new BigIntPrimitive('12345',mockCanvas); const num2=new BigIntPrimitive('12345',mockCanvas);
      vi.spyOn(webglUtils,'readDataFromTexture').mockImplementation((gl,fbo,width,height,isOutput) => { const o=new Float32Array(width*4); if(width===2){o[0]=0;o[1]=0;o[4]=0;o[5]=0;} return o;});
      const result=num1._core_subtract(num2); expect(result.isZero()).toBe(true); expect(result.toString()).toBe('0'); expect(result.sign).toBe(1);
    });
    it('should handle multi-limb subtraction with borrows', () => {
      const num1=new BigIntPrimitive('12345678',mockCanvas); const num2=new BigIntPrimitive('3456789',mockCanvas);
      vi.spyOn(webglUtils,'readDataFromTexture').mockImplementation((gl,fbo,width,height,isOutput) => { const o=new Float32Array(width*4); if(width===2){o[0]=8889;o[1]=1;o[4]=889;o[5]=0;} return o;});
      const result=num1._core_subtract(num2); expect(result.toString()).toBe('8888889'); expect(result.sign).toBe(1);
    });
  });

  describe('_multiply_limb_by_bigint() with WebGL mock', () => {
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
      vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementation((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=5000;o[1]=0; return o;});
      const result = instanceForCanvas._multiply_limb_by_bigint(5, otherNumber);
      expect(result.toString()).toBe('5000');
    });
    it('limbValue * single-limb otherNumber, with final carry', () => {
      const otherNumber = new BigIntPrimitive('3000', mockCanvas);
      vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementation((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=5000;o[1]=1; return o;});
      const result = instanceForCanvas._multiply_limb_by_bigint(5, otherNumber);
      expect(result.toString()).toBe('15000');
    });
    it('limbValue * multi-limb otherNumber, no JS propagated carry', () => {
      const otherNumber = new BigIntPrimitive('32001', mockCanvas);
      vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementation((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=4002;o[1]=0; o[4]=6;o[5]=0; return o;});
      const result = instanceForCanvas._multiply_limb_by_bigint(2, otherNumber);
      expect(result.toString()).toBe('64002');
    });
    it('limbValue * multi-limb otherNumber, with JS propagated carry', () => {
      const otherNumber = new BigIntPrimitive('10001', mockCanvas);
      vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementation((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=6000;o[1]=0; o[4]=6000;o[5]=0; return o;});
      const result = instanceForCanvas._multiply_limb_by_bigint(6000, otherNumber);
      expect(result.toString()).toBe('60006000');
    });
    it('limbValue * otherNumber, where final propagatedCarry requires splitting', () => {
        const otherNumber = new BigIntPrimitive('9999', mockCanvas);
        vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementation((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=1;o[1]=9998; return o;});
        const result = instanceForCanvas._multiply_limb_by_bigint(9999, otherNumber);
        expect(result.toString()).toBe('99980001');
    });
  });

  describe('_core_multiply() - internal multiplication logic', () => {
    let mlbbSpy;
    const instanceForCanvas = new BigIntPrimitive("0", mockCanvas);
    beforeEach(() => { mlbbSpy = vi.spyOn(BigIntPrimitive.prototype, '_multiply_limb_by_bigint'); });
    it('should return zero if num1 is zero', () => {
        const result = instanceForCanvas._core_multiply(new BigIntPrimitive('0', mockCanvas), new BigIntPrimitive('123', mockCanvas));
        expect(result.isZero()).toBe(true);
    });
    it('should return zero if num2 is zero', () => {
        const result = instanceForCanvas._core_multiply(new BigIntPrimitive('123', mockCanvas), new BigIntPrimitive('0', mockCanvas));
        expect(result.isZero()).toBe(true);
    });
    it('single-limb * single-limb', () => {
        const num1 = new BigIntPrimitive('5', mockCanvas); const num2 = new BigIntPrimitive('7', mockCanvas);
        mlbbSpy.mockReturnValue(new BigIntPrimitive('35', mockCanvas));
        vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementationOnce((gl,fbo,w,h,isOutput)=>{ const o=new Float32Array(w*4); o[0]=35;o[1]=0; return o;});
        const result = instanceForCanvas._core_multiply(num1, num2);
        expect(mlbbSpy).toHaveBeenCalledWith(5, num2); expect(result.toString()).toBe('35');
    });
    it('multi-limb * single-limb (e.g., 10001 * 5 = 50005, BASE 10k)', () => {
        const num1 = new BigIntPrimitive('10001', mockCanvas); const num2 = new BigIntPrimitive('5', mockCanvas);
        mlbbSpy.mockImplementationOnce((l,o) => (l===1&&o.toString()==='5')?new BigIntPrimitive('5',mockCanvas):new BigIntPrimitive('0',mockCanvas));
        mlbbSpy.mockImplementationOnce((l,o) => (l===1&&o.toString()==='5')?new BigIntPrimitive('5',mockCanvas):new BigIntPrimitive('0',mockCanvas));
        vi.spyOn(webglUtils, 'readDataFromTexture')
            .mockImplementationOnce((gl,fbo,w,h,isOutput)=>{ const d=new Float32Array(w*4); d[0]=5;d[1]=0; return d;})
            .mockImplementationOnce((gl,fbo,w,h,isOutput)=>{ const d=new Float32Array(w*4); d[0]=5;d[1]=0; d[4]=5;d[5]=0; return d;});
        const result = instanceForCanvas._core_multiply(num1, num2);
        expect(mlbbSpy).toHaveBeenCalledTimes(2); expect(result.toString()).toBe('50005');
    });
    it('123 * 45 = 5535', () => {
        const num1 = new BigIntPrimitive('123', mockCanvas); const num2 = new BigIntPrimitive('45', mockCanvas);
        mlbbSpy.mockReturnValue(new BigIntPrimitive('5535', mockCanvas));
        vi.spyOn(webglUtils, 'readDataFromTexture').mockImplementationOnce((gl,fbo,w,h,isOutput)=>{ const d=new Float32Array(w*4); d[0]=5535;d[1]=0; return d;});
        const result = instanceForCanvas._core_multiply(num1, num2);
        expect(mlbbSpy).toHaveBeenCalledWith(123, num2); expect(result.toString()).toBe('5535');
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
        expect(coreMultiplySpy).toHaveBeenCalledTimes(1);
        expect(splitAtSpy).not.toHaveBeenCalled();
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

        // Mock _core_add to ensure sums are non-zero for p2_temp calculation
        const coreAddSpy = vi.spyOn(BigIntPrimitive.prototype, '_core_add');
        coreAddSpy.mockImplementation(function(other) { // 'this' is the first operand
            // Return a simple non-zero sum, e.g., by creating a new BigInt from 'this' + 'other's length
            // For simplicity, just ensure it's not zero.
            const resultSim = new BigIntPrimitive( (this.limbs[0] || 0) + (other.limbs[0] || 0) + 1, this.canvas);
            return resultSim.isZero() ? new BigIntPrimitive("1", this.canvas) : resultSim;
        });

        coreMultiplySpy.mockReturnValue(new BigIntPrimitive("1", mockCanvas));

        const originalMultiply = BigIntPrimitive.prototype.multiply;
        const publicMultiplySpy = vi.spyOn(BigIntPrimitive.prototype, 'multiply')
            .mockImplementation(function(...args) { // Note: using function() for 'this'
                return originalMultiply.apply(this, args);
            });

        n1.multiply(n2);

        expect(splitAtSpy).toHaveBeenCalled();
        expect(coreMultiplySpy.mock.calls.length).toBe(3);
        // For KARATSUBA_THRESHOLD = 20, n=20, m=10.
        // Sub-problems a,b,c,d (10 limbs) and sums (10-11 limbs) are all < 20.
        // So, a.multiply(c) etc. use _core_multiply. Public multiply is called only once.
        expect(publicMultiplySpy.mock.calls.length).toBe(1);

        publicMultiplySpy.mockRestore();
        coreAddSpy.mockRestore(); // Restore _core_add spy
    });

    it('Karatsuba integration: 12345 * 67890 = 838002050 (tests schoolbook path due to threshold)', () => {
        const n1 = new BigIntPrimitive("12345", mockCanvas);
        const n2 = new BigIntPrimitive("67890", mockCanvas);
        const mlbbSpy = vi.spyOn(BigIntPrimitive.prototype, '_multiply_limb_by_bigint');
        mlbbSpy.mockImplementationOnce((limbVal, otherNum) => {
            if (limbVal === 2345 && otherNum.toString() === "67890") return new BigIntPrimitive("159102050", mockCanvas);
            return new BigIntPrimitive("0", mockCanvas);
        });
        mlbbSpy.mockImplementationOnce((limbVal, otherNum) => {
            if (limbVal === 1 && otherNum.toString() === "67890") return new BigIntPrimitive("67890", mockCanvas);
            return new BigIntPrimitive("0", mockCanvas);
        });
        vi.spyOn(webglUtils, 'readDataFromTexture')
            .mockImplementationOnce((gl, fbo, width, height, isOutput) => {
                const res = new BigIntPrimitive("159102050");
                const data = new Float32Array(width * 4);
                for(let i=0; i<width; ++i) { data[i*4+0] = res.limbs[i]||0; data[i*4+1] = 0; }
                return data;
            })
            .mockImplementationOnce((gl, fbo, width, height, isOutput) => {
                const res = new BigIntPrimitive("838002050");
                const data = new Float32Array(width * 4);
                for(let i=0; i<width; ++i) { data[i*4+0] = res.limbs[i]||0; data[i*4+1] = 0; }
                return data;
            });
        const result = n1.multiply(n2);
        expect(result.toString()).toBe('838002050');
        mlbbSpy.mockRestore();
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

    it('should multiply by BASE^1', () => {
      const n1 = new BigIntPrimitive('123', mockCanvas); // limbs: [123]
      const result = n1._multiplyByPowerOfBase(1);
      // Expected limbs: [0, 123] -> "1230000"
      expect(result.toString()).toBe('1230000');
      expect(result.sign).toBe(1);
      expect(result.limbs).toEqual([0, 123]);
    });

    it('should multiply by BASE^2', () => {
      const n1 = new BigIntPrimitive('12345', mockCanvas); // limbs: [2345, 1]
      const result = n1._multiplyByPowerOfBase(2);
      // Expected limbs: [0, 0, 2345, 1] -> "1234500000000"
      expect(result.toString()).toBe('1234500000000');
      expect(result.sign).toBe(1);
      expect(result.limbs).toEqual([0, 0, 2345, 1]);
    });

    it('should multiply multi-limb number by BASE^1', () => {
      const n1 = new BigIntPrimitive('123456789', mockCanvas); // limbs: [6789, 3456, 12]
      const result = n1._multiplyByPowerOfBase(1);
      // Expected: "1234567890000"
      // Input '123456789' has limbs [6789, 2345, 1]
      // Shifted by 1 power: [0, 6789, 2345, 1]
      expect(result.toString()).toBe('1234567890000');
      expect(result.sign).toBe(1);
      expect(result.limbs).toEqual([0, 6789, 2345, 1]);
    });

    it('should return zero if this is zero', () => {
      const n0 = new BigIntPrimitive('0', mockCanvas);
      const result = n0._multiplyByPowerOfBase(3);
      expect(result.isZero()).toBe(true);
      expect(result.toString()).toBe('0');
      expect(result.sign).toBe(1);
    });

    it('should preserve sign for negative numbers', () => {
      const n1 = new BigIntPrimitive('-123', mockCanvas); // limbs: [123], sign: -1
      const result = n1._multiplyByPowerOfBase(1);
      // Expected: "-1230000"
      expect(result.toString()).toBe('-1230000');
      expect(result.sign).toBe(-1);
      expect(result.limbs).toEqual([0, 123]);
    });

    it('should throw error if power is negative', () => {
      const n1 = new BigIntPrimitive('123', mockCanvas);
      expect(() => n1._multiplyByPowerOfBase(-1)).toThrow("Power must be non-negative for _multiplyByPowerOfBase.");
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
}); // This is the final closing brace for describe('BigIntPrimitive', ...)

// Unskip this, though tests for it are not the primary focus of this subtask
describe('_longDivide', () => {
  // TODO: Add tests for _longDivide if direct testing is needed beyond public methods
});

describe('Division and Remainder', () => {
  const BASE_FROM_CODE = 10000; // As defined in bigint.js
  const BASE_LOG10_FROM_CODE = 4; // As defined in bigint.js, used by BigIntPrimitive constructor

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
        { D: "123456", d: "123", Q: "1003", R: "87" },
        { D: "1000000", d: "101", Q: "9900", R: "100" },
        { D: String(BASE_FROM_CODE), d: "2", Q: String(BASE_FROM_CODE / 2), R: "0" },
        { D: String(BASE_FROM_CODE * 2), d: String(BASE_FROM_CODE), Q: "2", R: "0" },
        { D: String(BASE_FROM_CODE * BASE_FROM_CODE), d: String(BASE_FROM_CODE), Q: String(BASE_FROM_CODE), R: "0" },
      ];
      // Isolate the failing test - restored (commented out .only)
      // const failingCase = { D: "12345678901234567890", d: "987654321", Q: "12499999887", R: "339506163" };
      // it(`${failingCase.D} / ${failingCase.d} => Q=${failingCase.Q}, R=${failingCase.R}`, () => { // Changed .only to .it
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
        { D: String(BASE_FROM_CODE * 5 + 10), d: String(BASE_FROM_CODE), Q:"5", R:"10"}, // D = 50010, d = 10000 => Q=5, R=10
      ];
      // Combine all cases for the main loop
      const allCases = [
        ...cases, // The ones before the failing one
        // The failingCase is now included in remainingCases or directly if it was the only one
        { D: "12345678901234567890", d: "987654321", Q: "12499999887", R: "339506163" }, // Explicitly add it here
        ...remainingCases.filter(c => c.D !== "12345678901234567890") // Ensure no duplicates if it was in remainingCases
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
