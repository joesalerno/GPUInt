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

```
