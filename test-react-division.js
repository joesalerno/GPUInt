// Test the specific division case mentioned in the React app
import { BigIntPrimitive } from './lib/bigint.js';

// Test the large number division case from the React app
const a = new BigIntPrimitive('12345678901234567890');
const b = new BigIntPrimitive('98765432109876543210');

console.log('Testing division: 12345678901234567890 / 98765432109876543210');
console.log('Expected: 0.12499999886093750001423828124982');

// GPU result
const gpuResult = a.divide(b);
console.log('GPU Result:', gpuResult.toString());

// CPU result for comparison
const cpuResult = a.divide(b, { forceCPU: true });
console.log('CPU Result:', cpuResult.toString());

// Check if they match
console.log('Results match:', gpuResult.toString() === cpuResult.toString());

// Check if GPU result matches expected
const expected = '0.12499999886093750001423828124982';
console.log('GPU matches expected:', gpuResult.toString() === expected);
