import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BigIntPrimitive } from './bigint'; // Actual BigIntPrimitive
// Do NOT mock './webgl-utils.js' here

describe('BigIntPrimitive WebGL Operations', () => {
  let canvas;

  beforeEach(() => {
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
    it('should subtract two positive single-limb numbers, no borrow (e.g., "567" - "123" = "444")', () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");
      const num1 = new BigIntPrimitive('567', canvas);
      const num2 = new BigIntPrimitive('123', canvas);
      const result = num1.subtract(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('444');
    });

    it('should subtract with borrow (e.g., "123" - "34" = "89")', () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");
      const num1 = new BigIntPrimitive('123', canvas);
      const num2 = new BigIntPrimitive('34', canvas);
      const result = num1.subtract(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('89');
    });

    it('should handle subtracting to zero (e.g., "123" - "123" = "0")', () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");
      const num1 = new BigIntPrimitive('123', canvas);
      const num2 = new BigIntPrimitive('123', canvas);
      const result = num1.subtract(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('0');
    });

    it('should handle subtracting a larger number from a smaller one (e.g., "100" - "200" = "-100")', () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");
      const num1 = new BigIntPrimitive('100', canvas);
      const num2 = new BigIntPrimitive('200', canvas);
      const result = num1.subtract(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('-100');
    });
  });

  describe('multiply() - WebGL Path (Simple Cases)', () => {
    it('should multiply two small BigIntPrimitives using WebGL (e.g., "12" * "3" = "36")', () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");
      const num1 = new BigIntPrimitive('12', canvas);
      const num2 = new BigIntPrimitive('3', canvas);
      const result = num1.multiply(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('36');
    });

    it('should multiply with one number being zero using WebGL (e.g., "123" * "0" = "0")', () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");
      const num1 = new BigIntPrimitive('123', canvas);
      const numZero = new BigIntPrimitive('0', canvas);
      const result = num1.multiply(numZero);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('0');
    });

    it('should multiply two single-digit numbers using WebGL (e.g., "7" * "8" = "56")', () => {
      if (!canvas) throw new Error("Canvas not initialized for test.");
      const num1 = new BigIntPrimitive('7', canvas);
      const num2 = new BigIntPrimitive('8', canvas);
      const result = num1.multiply(num2);
      expect(result).not.toBeNull();
      expect(result.toString()).toBe('56');
    });
  });
});
