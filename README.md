# WebGL-BigInt: A GPU-Accelerated BigInt Concept

WebGL-BigInt is an experimental JavaScript library aimed at exploring GPU acceleration for large number arithmetic using WebGL. This project is currently in a conceptual and developmental stage.

## Features (Conceptual / In-Progress)

*   Representation of arbitrarily large integers.
*   Basic arithmetic operations (currently focusing on addition).
*   Leverages WebGL for potential performance gains in computation, though the WebGL component is currently **simulated** in the JavaScript logic.

## Current Status & Limitations

*   **Experimental:** This library is NOT production-ready.
*   **Simulated GPU:** The core BigInt operations (like addition) are implemented in JavaScript, including a *simulation* of how data would be processed on a GPU via WebGL. Actual WebGL shader execution for arithmetic is designed but not fully implemented and tested in a browser environment.
*   **`BigIntPrimitive` Class:** The main class for handling large numbers.
*   **Addition:** The `add` method currently supports addition of positive integers. Negative numbers and other operations (subtraction, multiplication, division) are not yet implemented.
*   **Performance:** Not yet benchmarked. The overhead of data transfer to/from the GPU (even simulated) and WebGL setup might outweigh benefits for smaller numbers or infrequent operations.
*   **Error Handling:** Basic error handling is in place, but it's not exhaustive.

## Usage

First, you would need to include/import the `BigIntPrimitive` class.

```javascript
// Assuming you have a way to load src/bigint.js
// const BigIntPrimitive = require('./src/bigint.js'); // If in Node.js like environment

// Create BigIntPrimitive instances
const num1 = new BigIntPrimitive("12345678901234567890");
const num2 = new BigIntPrimitive("98765432109876543210");

// Perform addition
const sum = num1.add(num2);

console.log(num1.toString()); // Output: 12345678901234567890
console.log(num2.toString()); // Output: 98765432109876543210
console.log(sum.toString());  // Output: 111111111011111111100
```

## Project Structure

*   `src/bigint.js`: Contains the `BigIntPrimitive` class and its methods.
*   `src/webgl-utils.js`: Utility functions for (planned) WebGL context creation, shader compilation, etc.
*   `src/shaders/`: GLSL shader files (vertex and fragment) for GPU operations.
    *   `addition.vert`: Vertex shader for addition.
    *   `addition.frag`: Fragment shader for addition.
*   `test/bigint.test.js`: Basic unit tests.

## Future Development Ideas

*   Implement full WebGL execution pipeline for arithmetic operations.
*   Support for negative numbers and other arithmetic operations (subtraction, multiplication, division).
*   Performance benchmarking and optimization.
*   Explore more advanced GPU algorithms for BigInt arithmetic.
*   Packaging for easier use in browser and Node.js environments.

## Contributing

This project is primarily a learning exercise and proof-of-concept. Contributions or suggestions are welcome, keeping in mind the experimental nature of the project.

## Development Checklist

This checklist tracks the implementation progress towards compatibility with the `big.js` API and other project goals.

**Core `big.js` API Compatibility:**

*   **Constructor:**
    *   [x] `Big(n)` (as `BigIntPrimitive(value)`)
*   **Static Properties:**
    *   [x] `DP` (BigIntPrimitive.DP)
    *   [x] `RM` (BigIntPrimitive.RM)
    *   [x] `NE` (BigIntPrimitive.NE)
    *   [x] `PE` (BigIntPrimitive.PE)
    *   [x] `strict` (BigIntPrimitive.strict)
    *   [x] `roundDown` (BigIntPrimitive.roundDown)
    *   [x] `roundHalfUp` (BigIntPrimitive.roundHalfUp)
    *   [x] `roundHalfEven` (BigIntPrimitive.roundHalfEven)
    *   [x] `roundUp` (BigIntPrimitive.roundUp)
*   **Instance Methods:**
    *   [x] `abs()`
    *   [x] `cmp(n)`
    *   [~] `div(n)` (CPU logic for division exists via `_decimalDivide_cpu` and `_longDivide_cpu`; public method `divide(n)` is a stub, `div(n)` is an alias)
    *   [x] `eq(n)`
    *   [x] `gt(n)`
    *   [x] `gte(n)`
    *   [x] `lt(n)`
    *   [x] `lte(n)`
    *   [x] `minus(n)` (Implemented as `subtract(n)`, alias exists)
    *   [~] `mod(n)` (CPU logic for remainder exists via `divideAndRemainder` using `_longDivide_cpu`; public method `remainder(n)` is a stub, `mod(n)` is an alias)
    *   [x] `neg()` (Implemented as `negate()`, alias exists)
    *   [x] `plus(n)` (Implemented as `add(n)`, alias exists)
    *   [x] `pow(n)` (Implemented, CPU only, integer exponents)
    *   [~] `prec(sd, rm)` (Stubbed, CPU only)
    *   [x] `round(dp, rm)` (CPU implementation exists using `_staticRound_cpu`)
    *   [~] `sqrt()` (Stubbed, CPU only)
    *   [x] `times(n)` (Implemented as `multiply(n)`, alias exists)
    *   [~] `toExponential(dp, rm)` (Stubbed, CPU only)
    *   [~] `toFixed(dp, rm)` (Stubbed, CPU only)
    *   [x] `toJSON()` (Implicitly via `toString()`)
    *   [ ] `toNumber()`
    *   [~] `toPrecision(sd, rm)` (Stubbed, CPU only)
    *   [x] `toString()`
    *   [ ] `valueOf()` (big.js version differs slightly for -0)
*   **Instance Properties (Conceptual Mapping):**
    *   [x] `c` (coefficient - mapped to `this.limbs`)
    *   [x] `e` (exponent - mapped to `this.exponent`)
    *   [x] `s` (sign - mapped to `this.sign`)

**Legend:**
*   [x] Implemented
*   [~] Stubbed (exists but not fully functional, typically CPU only)
*   [ ] Not Implemented

**Additional Project Goals:**

*   [ ] Full WebGL implementation for `add`
*   [~] Full WebGL implementation for `subtract` (WebGL path exists, appears more complete than `add` but needs full review and verification)
*   [~] WebGL implementation for `multiply` (partially done via `_webgl_multiply_one_limb_by_bigint`)
*   [ ] Full WebGL implementation for `div`
*   [ ] Full WebGL implementation for `sqrt`
*   [ ] Full WebGL implementation for rounding/precision methods
*   [ ] Comprehensive performance benchmarking (CPU vs GPU)
*   [ ] Code refactor for conciseness and functional style
*   [ ] Enhanced error handling
*   [ ] Packaging for browser and Node.js environments
*   [ ] Support for negative exponents in `pow()`
*   [ ] Complete all stubbed methods with robust CPU implementations.

**Notes on `lib/bigint.js` vs `big.js`:**
*   `BigIntPrimitive` uses a BASE (e.g., 10000) for its internal limb representation, while `big.js` typically uses an array of base-10 digits for its coefficient.
*   The meaning of `exponent` in `BigIntPrimitive` relates to the scaling of its limbs, which might differ from `big.js`'s direct power-of-10 exponent for the entire number.
*   The current WebGL implementation for `add` is incomplete (falls back to CPU). `subtract` and `multiply` have more developed WebGL paths but might also need further review and completion.

```
