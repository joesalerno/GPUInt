// Simple test to verify the expected result
const num1 = 1234567890123456n;
const num2 = 9876543210987654n;
const result = num1 * num2;

console.log("BigInt calculation:");
console.log("num1:", num1.toString());
console.log("num2:", num2.toString());
console.log("result:", result.toString());
console.log("expected:", "12193263113702171333485751812224");
console.log("matches:", result.toString() === "12193263113702171333485751812224");
