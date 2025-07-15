import { BigIntPrimitive } from './lib/bigint.js';

// Test 1/8 division with both GPU and CPU
console.log("=== Testing 1/8 division ===");

// Test GPU path
console.log("\n--- GPU Test ---");
const canvas = {
  getContext: () => null,
  width: 1,
  height: 1
};

const num1_gpu = new BigIntPrimitive("1", canvas, { forceCPU: false });
const num2_gpu = new BigIntPrimitive("8", canvas, { forceCPU: false });

console.log("GPU: 1/8 =", num1_gpu.divide(num2_gpu).toString());

// Test CPU path
console.log("\n--- CPU Test ---");
const num1_cpu = new BigIntPrimitive("1", canvas, { forceCPU: true });
const num2_cpu = new BigIntPrimitive("8", canvas, { forceCPU: true });

console.log("CPU: 1/8 =", num1_cpu.divide(num2_cpu).toString());

// Test divideAndRemainder
console.log("\n--- divideAndRemainder Test ---");
const result_gpu = num1_gpu.divideAndRemainder(num2_gpu);
console.log("GPU divideAndRemainder quotient:", result_gpu.quotient.toString());
console.log("GPU divideAndRemainder remainder:", result_gpu.remainder.toString());

const result_cpu = num1_cpu.divideAndRemainder(num2_cpu);
console.log("CPU divideAndRemainder quotient:", result_cpu.quotient.toString());
console.log("CPU divideAndRemainder remainder:", result_cpu.remainder.toString());
