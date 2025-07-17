// Simple test to verify GPU performance optimizations are working
import { BigIntPrimitive } from './lib/bigint.js';

// Create a canvas element
const canvas = document.createElement('canvas');
canvas.width = 256;
canvas.height = 256;
document.body.appendChild(canvas);

console.log("Testing GPU performance with optimizations...");

// Test basic addition
const num1 = new BigIntPrimitive("123", canvas);
const num2 = new BigIntPrimitive("456", canvas);

console.log("Testing addition: 123 + 456");
const result = num1.add(num2);
console.log("Result:", result.toString());

// Test multiplication
const num3 = new BigIntPrimitive("12", canvas);
const num4 = new BigIntPrimitive("15", canvas);

console.log("Testing multiplication: 12 * 15");
const result2 = num3.multiply(num4);
console.log("Result:", result2.toString());

// Print performance monitor report
if (typeof window !== 'undefined' && window.PerformanceMonitor) {
    window.PerformanceMonitor.printReport();
}
