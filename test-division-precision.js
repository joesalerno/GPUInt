import { BigIntPrimitive } from './lib/bigint.js';

// Test the specific division case
const canvas = document.createElement('canvas');
BigIntPrimitive.DP = 32; // Set high precision for testing

const num1 = new BigIntPrimitive("12345678901234567890", canvas);
const num2 = new BigIntPrimitive("98765432109876543210", canvas);

console.log("Testing division: 12345678901234567890 / 98765432109876543210");
console.log("Expected: 0.12499999886093750001423828124982");

// Force CPU calculation
const cpuResult = new BigIntPrimitive("12345678901234567890", canvas, { forceCPU: true })
    .divide(new BigIntPrimitive("98765432109876543210", canvas, { forceCPU: true }));
console.log("CPU Result: " + cpuResult.toString());

// GPU calculation
const gpuResult = num1.divide(num2);
console.log("GPU Result: " + gpuResult.toString());

// Check if they match
console.log("Results match: " + (cpuResult.toString() === gpuResult.toString()));
