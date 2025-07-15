import { BigIntPrimitive } from './lib/bigint.js';

// Test the exact example from the user
const canvas = document.createElement('canvas');

const a = new BigIntPrimitive("12345678901234567890", canvas);
const b = new BigIntPrimitive("98765432109876543210", canvas);

console.log("Testing division precision:");
console.log("a =", a.toString());
console.log("b =", b.toString());

// Set high precision for comparison
BigIntPrimitive.DP = 50;

// Test CPU division
const cpuResult = a.divide(b);
console.log("CPU result:", cpuResult.toString());

// Test GPU division
const gpuResult = a.divide(b);
console.log("GPU result:", gpuResult.toString());

// Compare at the exact precision where they differ
console.log("\nComparing at digit level:");
const cpuStr = cpuResult.toString();
const gpuStr = gpuResult.toString();

console.log("CPU str:", cpuStr);
console.log("GPU str:", gpuStr);

// Find first difference
let firstDiff = -1;
for (let i = 0; i < Math.min(cpuStr.length, gpuStr.length); i++) {
    if (cpuStr[i] !== gpuStr[i]) {
        firstDiff = i;
        break;
    }
}

if (firstDiff !== -1) {
    console.log(`First difference at position ${firstDiff}:`);
    console.log(`CPU: ${cpuStr.substring(firstDiff - 3, firstDiff + 3)}`);
    console.log(`GPU: ${gpuStr.substring(firstDiff - 3, firstDiff + 3)}`);
} else {
    console.log("No differences found");
}
