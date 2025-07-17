import { BigIntPrimitive } from './lib/bigint.js';

// Test GPU addition with larger numbers
const canvas = document.createElement('canvas');
canvas.width = 256;
canvas.height = 256;

// Create large numbers that will trigger GPU path
const num1 = new BigIntPrimitive('12345678901234567890123456789012345678901234567890', canvas);
const num2 = new BigIntPrimitive('98765432109876543210987654321098765432109876543210', canvas);

console.log('Testing GPU addition with large numbers...');
console.log('Num1:', num1.toString());
console.log('Num2:', num2.toString());

try {
    const result = num1.add(num2);
    console.log('Result:', result.toString());
    console.log('GPU addition test completed successfully!');
} catch (error) {
    console.error('GPU addition test failed:', error.message);
}
