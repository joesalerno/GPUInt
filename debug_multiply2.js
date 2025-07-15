// Simple test to verify the expected result for second test
const num1 = 99999999n;
const num2 = 99999999n;
const result = num1 * num2;

console.log("BigInt calculation:");
console.log("num1:", num1.toString());
console.log("num2:", num2.toString());
console.log("result:", result.toString());
console.log("expected:", "9999999800000001");
console.log("webgl result:", "9998999700000001");
console.log("matches expected:", result.toString() === "9999999800000001");
console.log("difference:", result - 9998999700000001n);
