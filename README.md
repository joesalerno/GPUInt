# WebGL-BigInt: A GPU-Accelerated BigInt Concept

WebGL-BigInt is an experimental JavaScript library aimed at exploring GPU acceleration for large number arithmetic using WebGL. This project is currently in a conceptual and developmental stage.

## Features (Conceptual / In-Progress)

*   Representation of arbitrarily large integers.
*   Basic arithmetic operations.
*   Leverages WebGL for potential performance gains in computation.

## Current Status & Limitations

*   **Experimental:** This library is NOT production-ready.
*   **CPU Fallback:** Most operations have a CPU implementation. WebGL paths are experimental.
*   **`BigIntPrimitive` Class:** The main class for handling large numbers.
*   **Arithmetic Operations:** Core arithmetic operations (`add`, `subtract`, `multiply`, `divide`, `mod`, `pow`) and formatting methods (`toString`, `toExponential`, `toFixed`, `round`) have CPU implementations. WebGL paths for some operations like `add` and `multiply_limb_by_bigint` exist but may have issues.
*   **Performance:** Not yet benchmarked. The overhead of data transfer to/from the GPU and WebGL setup might outweigh benefits for smaller numbers or infrequent operations.

## Known Issues

*   **WebGL `_webgl_multiply_one_limb_by_bigint` GPU Output:** The WebGL path for this method produces an incorrect result (100 instead of 36 for 12*3). The shader seems to receive incorrect input values or there's a precision issue. This is currently the primary failing test.
*   **Test Environment:** Previous sessions reported issues with the test environment itself, causing 'Internal error occurred when running command'. This needs to be monitored.

## Usage

First, you would need to include/import the `BigIntPrimitive` class.

```javascript
// Assuming you have a way to load lib/bigint.js
// import { BigIntPrimitive } from './lib/bigint.js'; // Example for ES Modules

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

*   `lib/bigint.js`: Contains the `BigIntPrimitive` class and its methods.
*   `lib/webgl-utils.js`: Utility functions for WebGL context creation, shader compilation, etc.
*   `lib/shaders/`: GLSL shader files (vertex and fragment) for GPU operations.
*   `lib/bigint.test.js`: Unit tests for `BigIntPrimitive` CPU paths.
*   `lib/bigint.webgl.test.js`: Unit tests for `BigIntPrimitive` WebGL paths.
*   `src/`: Contains the React demonstration application.

## Development Checklist (Living Document)

This checklist tracks the implementation progress towards compatibility with the `big.js` API and other project goals.

**Overall Project Goals:**

*   [~] Achieve full `big.js` API compatibility.
*   [ ] Ensure all CPU path tests pass consistently.
*   [~] Ensure all GPU path (WebGL) tests pass consistently. (1 known failure)
*   [ ] Implement and verify React component tests.
*   [ ] Concise, functional code with simple, short functions.
*   [ ] GPU acceleration for blazingly fast BigDecimal math.
*   [x] Maintain this ongoing living development checklist in README.md.

**Key Bug Fixes & Issues:**

*   [!] WebGL `_webgl_multiply_one_limb_by_bigint` produces incorrect result (100 instead of 36).
*   [ ] Investigate and resolve any test environment instability.

**Core `big.js` API Compatibility (CPU Path):**

*   **Constructor:**
    *   [x] `Big(n)` (as `BigIntPrimitive(value)`)
*   **Static Properties:**
    *   [x] `DP`
    *   [x] `RM`
    *   [x] `NE`
    *   [x] `PE`
    *   [x] `strict`
    *   [x] `roundDown`
    *   [x] `roundHalfUp`
    *   [x] `roundHalfEven`
    *   [x] `roundUp`
*   **Instance Methods (CPU Path):**
    *   [x] `abs()`
    *   [x] `cmp(n)`
    *   [x] `div(n)`
    *   [x] `eq(n)`
    *   [x] `gt(n)`
    *   [x] `gte(n)`
    *   [x] `lt(n)`
    *   [x] `lte(n)`
    *   [x] `minus(n)` (alias for `subtract`)
    *   [x] `mod(n)`
    *   [x] `neg()` (alias for `negate`)
    *   [x] `plus(n)` (alias for `add`)
    *   [x] `pow(n)` (integer exponents)
    *   [x] `prec(sd, rm)`
    *   [x] `round(dp, rm)`
    *   [x] `sqrt()`
    *   [x] `times(n)` (alias for `multiply`)
    *   [x] `toExponential(dp, rm)`
    *   [x] `toFixed(dp, rm)`
    *   [x] `toJSON()` (via `toString()`)
    *   [x] `toNumber()`
    *   [x] `toPrecision(sd, rm)`
    *   [x] `toString()`
    *   [x] `valueOf()` (via `toString()`)
*   **Instance Properties (Conceptual Mapping):**
    *   [x] `c` (coefficient - `this.limbs`)
    *   [x] `e` (exponent - `this.exponent`)
    *   [x] `s` (sign - `this.sign`)

**WebGL Path Implementation & Verification:**

*   [x] WebGL: `add()` path structure exists. (Functionality verified in previous sessions)
*   [ ] WebGL: `subtract()` path implementation.
*   [!] WebGL: `multiply()` path (`_webgl_multiply_one_limb_by_bigint` has GPU output issue).
*   [ ] WebGL: `div()` path implementation.
*   [ ] WebGL: `sqrt()` path implementation.
*   [ ] WebGL: Rounding/precision methods GPU implementation.

**React Application:**

*   [ ] Verify React app tests.
*   [ ] Ensure React app correctly uses the library for CPU paths.
*   [ ] Ensure React app correctly uses the library for GPU paths.

**Legend:**
*   [x] Implemented and tested/verified for key scenarios.
*   [~] Partially implemented or minor known differences/issues.
*   [!] Known critical issue or test failure.
*   [ ] Not Implemented / Pending.

## Session Development Log

### 2025-06-16 (Jules - AI Agent - Current Session)
- Started by listing files to understand project structure.
- Examined `package.json` to find test script (`vitest`).
- Created initial plan:
    1. Run tests and analyze failures.
    2. Verify failing tests.
    3. Fix failing tests.
    4. Update README.md.
    5. Implement missing big.js API functions.
    6. Submit changes.
- Ran tests: Identified 1 failing test: `BigIntPrimitive WebGL Operations > multiply() - WebGL Path (Simple Cases) > [_webgl_multiply_one_limb_by_bigint] should multiply limb 12 by BigInt "3" (Actual GPU)`. Expected 36, got 100.
- Verified failing test: Confirmed test expectation (36) is correct. Analyzed `lib/bigint.js`, `lib/shaders/multiply_limb.frag`, and `lib/bigint.webgl.test.js`. The issue seems to be that the shader receives incorrect inputs or has precision problems, as JS setup and shader logic appear correct for the inputs.
- Decided to temporarily prioritize overall progress and CPU stability over fixing the isolated WebGL failure.
- Updated this `README.md` with a new development checklist and current session log.

### Previous Session Logs (Summarized from existing README)
- **2025-06-16:** WebGL `_webgl_multiply_one_limb_by_bigint` diagnostics, shader fixes. CPU `prec()` and `toPrecision()` updates and fixes.
- **2025-06-15 (Continued):** Further investigation into WebGL multiply, `prec()`, and `toPrecision()` CPU formatting.
- **2025-06-15:** Initial test run (5 failures). Fixed WebGL `add()` path.
- **2024-07-19 (Further):** Implemented WebGL `add` path and CPU post-processing. Identified `v_texCoord.x` issue.
- **2024-07-19:** Implemented CPU `prec()` and `toPrecision()`. Refactored `compareMagnitude`.
- **2024-07-18:** Installed dependencies, 199 tests passing.
- **2024-07-15:** Initialized project, 142 tests passing.
- **2024-07-16 (Placeholder):** Investigated and resolved `lib/bigint.js` parsing error by reverting to correct ES Module base.
- **2024-07-17 (Placeholder):** Extensive refactoring of `lib/bigint.js` (BASE change, constructor, core arithmetic, `toString`, rounding, `toExponential`, `toFixed`, `toNumber`). All 199 tests passing after this.

(Note: Please replace YYYY-MM-DD with the current date upon completion of this task)
