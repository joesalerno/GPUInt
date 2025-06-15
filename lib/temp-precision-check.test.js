import { test, expect } from 'vitest';
import { BigIntPrimitive } from './bigint.js'; // Assuming bigint.js is in the same dir (lib/)

test('Minimal check for 1e20.toPrecision(21)', () => {
  const num = new BigIntPrimitive('1e20');
  const result = num.toPrecision(21);
  console.log(`[[MINIMAL TEST FILE]] Value from toPrecision(21): '${result}', type: ${typeof result}`);
  expect(result).toBe('100000000000000000000');
});

test('Minimal check for 1e20.toPrecision(22)', () => {
  const num = new BigIntPrimitive('1e20');
  const result = num.toPrecision(22);
  console.log(`[[MINIMAL TEST FILE]] Value from toPrecision(22): '${result}', type: ${typeof result}`);
  expect(result).toBe('100000000000000000000.0');
});
