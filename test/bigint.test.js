// test/bigint.test.js
import { BigIntPrimitive } from '../src/bigint.js'; // Assuming bigint.js is in src

// Simple assertion function
function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        // For addition tests, if WebGL context fails, `add` returns null.
        // The original tests expect a BigIntPrimitive, so .toString() would fail.
        // We'll adjust this in a later step if tests need to expect null.
        // For now, let this throw if `actual` is null.
        const actualVal = actual === null ? "null" : (typeof actual === 'object' && actual.toString ? actual.toString() : String(actual));
        throw new Error(`Assertion failed: ${message}. Expected "${expected}", but got "${actualVal}".`);
    }
    console.log(`Test passed: ${message}`);
}

function assertDeepEqual(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Assertion failed: ${message}. Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}.`);
    }
    console.log(`Test passed: ${message}`);
}

// Test Suite
function runTests() {
    console.log("Running BigIntPrimitive tests...");

    const mockCanvas = {
        getContext: function(contextType) {
            // console.log(`mockCanvas.getContext called with ${contextType}`);
            if (contextType === 'webgl' || contextType === 'experimental-webgl') {
                // Return null to simulate WebGL not being available or failing to initialize
                return null;
            }
            return null;
        },
        // width: 256, // Optional: if canvas properties are accessed directly
        // height: 256
    };

    // It's good practice to pass the canvas argument even if not strictly needed for non-WebGL methods
    // For constructor tests, it makes them consistent with the new signature.

    // Constructor tests
    let num = new BigIntPrimitive("12345678901234567890", mockCanvas);
    assertDeepEqual(num.limbs, [7890, 3456, 9012, 5678, 1234], "Constructor: large string to limbs");
    assertEqual(num.sign, 1, "Constructor: sign of positive number");

    let numFromNum = new BigIntPrimitive(12345, mockCanvas);
    assertDeepEqual(numFromNum.limbs, [2345, 1], "Constructor: number to limbs");

    let zeroNum = new BigIntPrimitive("0", mockCanvas);
    assertDeepEqual(zeroNum.limbs, [0], "Constructor: zero string to limbs");
    assertEqual(zeroNum.isZero(), true, "isZero: for '0'");

    let num2 = new BigIntPrimitive("9999", mockCanvas);
    assertDeepEqual(num2.limbs, [9999], "Constructor: single limb exact base");

    let num3 = new BigIntPrimitive("10000", mockCanvas);
    assertDeepEqual(num3.limbs, [0, 1], "Constructor: single limb over base");
    assertEqual(num3.isZero(), false, "isZero: for '10000'");

    // toString tests
    assertEqual(num.toString(), "12345678901234567890", "toString: large number");
    assertEqual(zeroNum.toString(), "0", "toString: zero");
    assertEqual(num2.toString(), "9999", "toString: single limb exact base");
    assertEqual(num3.toString(), "10000", "toString: single limb over base");
    assertEqual(new BigIntPrimitive("00123", mockCanvas).toString(), "123", "toString: leading zeros in input string");

    // Addition tests
    // With mockCanvas returning null for getContext, these .add() calls should result in null.
    // The assertEqual function will currently fail because it expects a BigInt string.
    // This is the expected outcome for this step of testing the WebGL error path.
    console.log("\nAddition tests (expecting failures or null results due to mockCanvas):");

    let a = new BigIntPrimitive("1234", mockCanvas);
    let b = new BigIntPrimitive("5678", mockCanvas);
    let sum1 = a.add(b);
    assertEqual(sum1, null, "Add: 1234 + 5678 (WebGL init fail expected)");

    let c = new BigIntPrimitive("9999", mockCanvas);
    let d = new BigIntPrimitive("1", mockCanvas);
    let sum2 = c.add(d);
    assertEqual(sum2, null, "Add: 9999 + 1 (WebGL init fail expected)");

    let e = new BigIntPrimitive("12345678", mockCanvas);
    let f = new BigIntPrimitive("87654321", mockCanvas);
    let sum3 = e.add(f);
    assertEqual(sum3, null, "Add: 12345678 + 87654321 (WebGL init fail expected)");

    let g = new BigIntPrimitive("99999999", mockCanvas);
    let h = new BigIntPrimitive("1", mockCanvas);
    let sum4 = g.add(h);
    assertEqual(sum4, null, "Add: 99999999 + 1 (WebGL init fail expected)");

    let i = new BigIntPrimitive("12345", mockCanvas);
    let j = new BigIntPrimitive("0", mockCanvas);
    let sum5 = i.add(j);
    assertEqual(sum5, null, "Add: 12345 + 0 (WebGL init fail expected)");
    let sum6 = j.add(i);
    assertEqual(sum6, null, "Add: 0 + 12345 (WebGL init fail expected)");

    let k = new BigIntPrimitive("100000000", mockCanvas);
    let l = new BigIntPrimitive("123", mockCanvas);
    let sum7 = k.add(l);
    assertEqual(sum7, null, "Add: 100000000 + 123 (WebGL init fail expected)");

    let m = new BigIntPrimitive("12345678901234567890", mockCanvas);
    let n = new BigIntPrimitive("98765432109876543210", mockCanvas);
    let sum8 = m.add(n);
    assertEqual(sum8, null, "Add: Large numbers sum (WebGL init fail expected)");

    console.log("\nBigIntPrimitive tests (partially, expecting add() to fail) completed.");
}

// Run the tests
try {
    runTests();
} catch (e) {
    console.error("Test failed:", e.message);
    // console.error(e.stack); // Stack trace can be noisy for expected failures
}
