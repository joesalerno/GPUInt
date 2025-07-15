// Test script to verify formatting options
import { BigIntPrimitive } from './lib/bigint.js';

// Create a mock canvas element
const canvas = document.createElement('canvas');

// Test number
const testNumber = new BigIntPrimitive("12345678901234567890.123456789", canvas);

console.log('Original number:', testNumber.toString());

// Test 1: Default decimal with grouping
console.log('\n--- Test 1: Default decimal with grouping ---');
const format1 = testNumber.toFormat({
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
  style: 'decimal'
});
console.log('Result:', format1);

// Test 2: Currency format
console.log('\n--- Test 2: Currency format ---');
const format2 = testNumber.toFormat({
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
  style: 'currency',
  currency: 'USD'
});
console.log('Result:', format2);

// Test 3: Percent format
console.log('\n--- Test 3: Percent format ---');
const format3 = testNumber.toFormat({
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
  style: 'percent'
});
console.log('Result:', format3);

// Test 4: Scientific notation
console.log('\n--- Test 4: Scientific notation ---');
const format4 = testNumber.toFormat({
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  notation: 'scientific'
});
console.log('Result:', format4);

// Test 5: No grouping
console.log('\n--- Test 5: No grouping ---');
const format5 = testNumber.toFormat({
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
  style: 'decimal'
});
console.log('Result:', format5);

// Test 6: Different decimal places
console.log('\n--- Test 6: Different decimal places ---');
const format6 = testNumber.toFormat({
  minimumFractionDigits: 5,
  maximumFractionDigits: 5,
  useGrouping: true,
  style: 'decimal'
});
console.log('Result:', format6);
