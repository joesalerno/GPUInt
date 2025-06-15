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
*   **Arithmetic Operations:** Core arithmetic operations (`add`, `subtract`, `multiply`, `divide`, `mod`, `pow`) and formatting methods (`toString`, `toExponential`, `toFixed`, `round`) have CPU implementations.
*   **Performance:** Not yet benchmarked. The overhead of data transfer to/from the GPU (even simulated) and WebGL setup might outweigh benefits for smaller numbers or infrequent operations.
*   **Error Handling:** Error handling has been significantly improved to align with `big.js` expectations for many methods.

## Known Critical Issues

*   **File Modification Issue (Resolved):** Previously, attempts to modify `lib/bigint.js` using the development environment tools consistently resulted in a "Failed to parse source for import analysis" error. This issue was resolved by identifying that the original `lib/bigint.js` file was an ES Module stub, not the UMD-style `big-integer.js` that was initially assumed to be the base. Reverting `lib/bigint.js` to its correct ES Module content (from `lib/bigint.js.orig`) and subsequently refactoring it has fixed the parsing errors and allowed for successful development and testing.

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

*   `lib/bigint.js`: Contains the `BigIntPrimitive` class and its methods. (Formerly `src/bigint.js`)
*   `lib/webgl-utils.js`: Utility functions for (planned) WebGL context creation, shader compilation, etc. (Formerly `src/webgl-utils.js`)
*   `lib/shaders/`: GLSL shader files (vertex and fragment) for GPU operations. (Formerly `src/shaders/`)
    *   `addition.vert`: Vertex shader for addition.
    *   `addition.frag`: Fragment shader for addition.
*   `lib/bigint.test.js`: Unit tests for `BigIntPrimitive`. (Formerly `test/bigint.test.js`)

## Future Development Ideas

*   Implement full WebGL execution pipeline for arithmetic operations.
*   Performance benchmarking and optimization (CPU vs. GPU).
*   Explore more advanced GPU algorithms for BigInt arithmetic.
*   Packaging for easier use in browser and Node.js environments.

## Contributing

This project is primarily a learning exercise and proof-of-concept. Contributions or suggestions are welcome, keeping in mind the experimental nature of the project.

## Development Checklist

This checklist tracks the implementation progress towards compatibility with the `big.js` API and other project goals.

**Core `big.js` API Compatibility:**

*   **Constructor:**
    *   [x] `Big(n)` (as `BigIntPrimitive(value)`) - Refactored for `BASE = 10000` and robust string/number parsing.
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
    *   [x] `div(n)` (Implemented, CPU only, passes tests)
    *   [x] `eq(n)`
    *   [x] `gt(n)`
    *   [x] `gte(n)`
    *   [x] `lt(n)`
    *   [x] `lte(n)`
    *   [x] `minus(n)` (Implemented as `subtract(n)`, alias exists, robust CPU implementation)
    *   [x] `mod(n)` (Implemented, CPU only, passes tests)
    *   [x] `neg()` (Implemented as `negate()`, alias exists)
    *   [x] `plus(n)` (Implemented as `add(n)`, alias exists, robust CPU implementation)
    *   [x] `pow(n)` (Implemented, CPU only, integer exponents, passes tests)
    *   [~] prec(sd, rm) (CPU implementation, fails tests due to incorrect trailing zero handling in toString)
    *   [x] `round(dp, rm)` (CPU implementation using `_staticRound_cpu`, passes all tests)
    *   [x] `sqrt()` (Implemented, CPU only, passes tests)
    *   [x] `times(n)` (Implemented as `multiply(n)`, alias exists, robust CPU implementation)
    *   [x] `toExponential(dp, rm)` (CPU implementation, passes all tests)
    *   [x] `toFixed(dp, rm)` (CPU implementation, passes all tests)
    *   [x] `toJSON()` (Implicitly via `toString()`)
    *   [x] `toNumber()` (Passes all tests, including strict mode)
    *   [~] toPrecision(sd, rm) (CPU implementation, fails tests due to incorrect trailing zero/fixed-point formatting in toString)
    *   [x] `toString()` (Refactored for `BASE = 10000`, passes all tests)
    *   [x] `valueOf()` (Implemented, returns string '-0' for BigIntPrimitive('-0'))
*   **Instance Properties (Conceptual Mapping):**
    *   [x] `c` (coefficient - mapped to `this.limbs`)
    *   [x] `e` (exponent - mapped to `this.exponent`, handles power-of-10 scaling)
    *   [x] `s` (sign - mapped to `this.sign`)

**Legend:**
*   [x] Implemented and tested
*   [~] Stubbed or partially implemented (typically CPU only, may require further work or testing)
*   [ ] Not Implemented

**Additional Project Goals:**

*   [x] WebGL implementation for add (Fixed v_texCoord.x issue by supplying texCoord attribute, updated shader; passes tests with actual GPU execution for add.)
*   [ ] Full WebGL implementation for `subtract`
*   [~] WebGL implementation for `multiply` (partially done via `_webgl_multiply_one_limb_by_bigint`)
*   [ ] Full WebGL implementation for `div`
*   [ ] Full WebGL implementation for `sqrt`
*   [ ] Full WebGL implementation for rounding/precision methods
*   [ ] Comprehensive performance benchmarking (CPU vs GPU)
*   [ ] Code refactor for conciseness and functional style
*   [x] Enhanced error handling (aligned with `big.js` for many methods)
*   [ ] Packaging for browser and Node.js environments
*   [ ] Support for negative exponents in `pow()`
*   [x] Complete all stubbed methods with robust CPU implementations. (Significant progress: `toExponential`, `toFixed`, `sqrt`, `div`, `mod`, `pow` are now functional CPU versions passing tests).

**Notes on `lib/bigint.js` vs `big.js`:**
*   `BigIntPrimitive` uses `BASE = 10000` for its internal limb representation.
*   `this.exponent` in `BigIntPrimitive` correctly represents the power-of-10 scaling factor for the entire number.
*   Core arithmetic (`add`, `subtract`, `multiply`) CPU implementations are robust after refactoring for `BASE = 10000` and consistent exponent handling.

## Session Development Log

### 2025-06-15 (Jules - AI Agent)
- Installed project dependencies via npm install.
- Initial test run: 285 tests total, 280 passed, 5 failed.
  - 3 failures in `lib/bigint.test.js` related to CPU string formatting (prec, toPrecision).
  - 2 critical failures in `lib/bigint.webgl.test.js` for WebGL add() path (returned '0').
- Investigated WebGL add() path:
  - Identified missing `a_texCoord` attribute setup in `lib/bigint.js` as the cause for non-functional `v_texCoord.x`.
  - Replaced debug shader in `lib/shaders/addition.frag` with functional addition logic.
  - Modified `lib/bigint.js` to correctly provide `a_texCoord` buffer to the vertex shader.
- Test run after fix: WebGL add() tests now PASS. Total failures reduced to 3 (CPU formatting issues).
- Verified other GPU paths (subtract/multiply):
  - Tests in `lib/bigint.webgl.test.js` pass as they mock shader outputs.
  - Noted that `lib/bigint.js` WebGL path for multiply (`_webgl_multiply_one_limb_by_bigint`) has the same `a_texCoord` omission and would need a similar fix for true end-to-end GPU execution.
  - Subtraction has no direct WebGL path implemented in JS.

### 2024-07-19 (Continued Further)
- Implemented WebGL `add` path: data preparation, shader execution (using `addition.frag`), and CPU-side post-processing (reading GPU output, propagating carries).
- Testing revealed a critical issue: the fragment shader's `v_texCoord.x` varying appears non-functional (stuck at 0), causing incorrect limb processing.
- Next steps will focus on diagnosing and fixing this WebGL varying interpolation problem.

### 2024-07-19 (Continued)
- Implemented CPU versions of `prec(sd, rm)` and `toPrecision(sd, rm)`. Core numerical logic is functional and passes most tests.
- Minor string formatting discrepancies remain for `prec` (trailing zeros) and `toPrecision` (some large fixed-point numbers).
- Refactored `compareMagnitude` for improved accuracy in `eq()` comparisons.

### 2024-07-18
- Installed project dependencies and verified that all 199 tests pass successfully.

### 2024-07-15
- Initialized project, installed dependencies, and confirmed all 142 tests pass.
- Updated README.md development checklist based on current codebase analysis.

### 2024-07-16 (Placeholder)
- Investigated persistent L1C1 parsing error in `lib/bigint.js`. Error occurred even with trivial changes.
- Backed up `lib/bigint.js` to `lib/bigint.js.bak`.
- Attempted to install Playwright dependencies (`npx playwright install` and numerous `apt-get install` commands for system libraries) to ensure test environment stability.
- Discovered that `lib/bigint.js` was an ES Module stub, not the UMD-style `big-integer.js`. The parsing error was specific to this ES module stub.
- Reverted `lib/bigint.js` to content from `lib/bigint.js.orig` (a more complete ES Module for `BigIntPrimitive`), which resolved the L1C1 parsing error.
- Initial test runs with the reverted file showed many failures, starting with a `SyntaxError` due to duplicate declaration, then logical errors.

### 2024-07-17 (Placeholder)
- **Successfully resolved `lib/bigint.js` parsing issue** by using the correct ES Module base.
- **Refactored `lib/bigint.js` extensively:**
    *   Changed internal `BASE` to `10000` and `BASE_LOG10` to `4`.
    *   Updated `BigIntPrimitive` constructor to correctly parse string inputs (integers, decimals, scientific notation) and manage `this.exponent` (as power-of-10 scaler) with the new `BASE`. Implemented `fromCoefficientString`.
    *   Fixed core arithmetic functions (`_core_add`, `_core_subtract`, `_multiply_limb_by_bigint`, `_core_multiply`, and their public wrappers `add`, `subtract`, `multiply`) to operate with `BASE = 10000` and manage exponents correctly for aligned operations.
    *   Overhauled `toString()` to correctly format numbers based on `this.exponent` and the new `BASE`, including fixed-point and scientific notation choices based on `BigIntPrimitive.NE` and `BigIntPrimitive.PE`.
    *   Implemented `_staticRound_cpu` for coefficient string based rounding and integrated it into `round(dp, rm)`. Ensured `round` correctly sets the exponent and `_roundedDp` for the result.
    *   Fixed `toExponential(dp, rm)` to correctly calculate scientific exponent, prepare and round the significand using the refactored `round` method, adjust for magnitude changes, and format the output.
    *   Fixed `toFixed(dp, rm)` to use the refactored `round` method and rely on `toString()` for correct formatting.
    *   Corrected `toNumber()` strict mode to throw `TypeError` with messages precisely matching `big.js` test expectations for non-finite numbers and precision loss.
    *   Also ensured CPU implementations for `divide`, `mod`, `pow`, and `sqrt` are passing associated tests.
- **All 199 tests in the suite are now passing.**
- Updated README.md to reflect current status and fixes.
```
