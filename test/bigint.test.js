// test/bigint.test.js
const { BigIntPrimitive } = require('../src/bigint.js'); // Assuming bigint.js is in src

// Simple assertion function
function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`Assertion failed: ${message}. Expected "${expected}", but got "${actual}".`);
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

    // Constructor tests
    let num = new BigIntPrimitive("12345678901234567890");
    assertDeepEqual(num.limbs, [7890, 3456, 9012, 5678, 1234], "Constructor: large string to limbs");
    assertEqual(num.sign, 1, "Constructor: sign of positive number");

    let numFromNum = new BigIntPrimitive(12345);
    assertDeepEqual(numFromNum.limbs, [2345, 1], "Constructor: number to limbs");

    let zeroNum = new BigIntPrimitive("0");
    assertDeepEqual(zeroNum.limbs, [0], "Constructor: zero string to limbs");
    assertEqual(zeroNum.isZero(), true, "isZero: for '0'");

    let num2 = new BigIntPrimitive("9999");
    assertDeepEqual(num2.limbs, [9999], "Constructor: single limb exact base");

    let num3 = new BigIntPrimitive("10000");
    assertDeepEqual(num3.limbs, [0, 1], "Constructor: single limb over base");
    assertEqual(num3.isZero(), false, "isZero: for '10000'");

    // toString tests
    assertEqual(num.toString(), "12345678901234567890", "toString: large number");
    assertEqual(zeroNum.toString(), "0", "toString: zero");
    assertEqual(num2.toString(), "9999", "toString: single limb exact base");
    assertEqual(num3.toString(), "10000", "toString: single limb over base");
    assertEqual(new BigIntPrimitive("00123").toString(), "123", "toString: leading zeros in input string");

    // Addition tests (relies on simulated WebGL in add method)
    // 1. Simple addition, no carry between limbs initially from GPU perspective
    let a = new BigIntPrimitive("1234");
    let b = new BigIntPrimitive("5678");
    let sum1 = a.add(b); // 1234 + 5678 = 6912
    assertEqual(sum1.toString(), "6912", "Add: 1234 + 5678");

    // 2. Addition with carry between limbs (CPU processed)
    let c = new BigIntPrimitive("9999");
    let d = new BigIntPrimitive("1");
    let sum2 = c.add(d); // 9999 + 1 = 10000
    assertEqual(sum2.toString(), "10000", "Add: 9999 + 1");

    // 3. Larger numbers
    let e = new BigIntPrimitive("12345678"); // limbs: [5678, 1234]
    let f = new BigIntPrimitive("87654321"); // limbs: [4321, 8765]
    // 12345678 + 87654321 = 99999999
    let sum3 = e.add(f);
    assertEqual(sum3.toString(), "99999999", "Add: 12345678 + 87654321");

    // 4. Addition resulting in more limbs
    let g = new BigIntPrimitive("99999999"); // limbs: [9999, 9999]
    let h = new BigIntPrimitive("1");       // limbs: [1]
    // 99999999 + 1 = 100000000
    let sum4 = g.add(h);
    assertEqual(sum4.toString(), "100000000", "Add: 99999999 + 1");

    // 5. Add zero
    let i = new BigIntPrimitive("12345");
    let j = new BigIntPrimitive("0");
    let sum5 = i.add(j);
    assertEqual(sum5.toString(), "12345", "Add: 12345 + 0");
    let sum6 = j.add(i);
    assertEqual(sum6.toString(), "12345", "Add: 0 + 12345");

    // 6. Different number of limbs
    let k = new BigIntPrimitive("100000000"); // [0,0,1]
    let l = new BigIntPrimitive("123");      // [123]
    // 100000000 + 123 = 100000123
    let sum7 = k.add(l);
    assertEqual(sum7.toString(), "100000123", "Add: 100000000 + 123");

    let m = new BigIntPrimitive("12345678901234567890");
    let n = new BigIntPrimitive("98765432109876543210");
    // Expected: 111111111011111111100
    let sum8 = m.add(n);
    assertEqual(sum8.toString(), "111111111011111111100", "Add: Large numbers sum");


    console.log("All BigIntPrimitive tests passed!");
}

// Run the tests
try {
    runTests();
} catch (e) {
    console.error("Test failed:", e.message);
    console.error(e.stack);
}
