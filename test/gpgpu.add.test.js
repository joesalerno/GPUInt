// test/gpgpu.add.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BigIntPrimitive } from '../lib/bigint.js';
const { createMockCanvas, getHeadlessGLContext } = require('./webgl-test-utils.cjs'); // Use require for CJS module

// Skip these tests if running in an environment where headless-gl might not be set up
// (e.g., some CIs without Xvfb/Mesa, or if 'gl' module fails to load)
let initialGL;
let canRunGpgpuTests = true;
let setupErrorMessage = '';

try {
    const testCanvas = createMockCanvas(1, 1);
    initialGL = testCanvas.getContext('webgl');
    if (!initialGL) {
        canRunGpgpuTests = false;
        setupErrorMessage = 'Skipping GPGPU tests: Failed to get headless-gl context during setup.';
        console.warn(setupErrorMessage);
    } else {
        const hasOesTextureFloat = initialGL.getExtension('OES_texture_float');
        const hasWebglColorBufferFloat = initialGL.getExtension('WEBGL_color_buffer_float');

        if (!hasOesTextureFloat) {
            canRunGpgpuTests = false;
            setupErrorMessage = 'Skipping GPGPU tests: OES_texture_float not supported by headless-gl context.';
            console.warn(setupErrorMessage);
        }
        // Check WEBGL_color_buffer_float, potentially appending to setupErrorMessage
        if (!hasWebglColorBufferFloat) {
            const message = 'WEBGL_color_buffer_float not supported by headless-gl context.';
            if (!canRunGpgpuTests) { // If OES_texture_float also failed
                setupErrorMessage = `${setupErrorMessage} And ${message}`;
            } else {
                setupErrorMessage = `Skipping GPGPU tests: ${message}`;
            }
            canRunGpgpuTests = false;
            // console.warn was already done in getHeadlessGLContext, but good to have specific skip reason here
            console.warn(setupErrorMessage); // Log the final combined or specific message
        }

        if (typeof initialGL.destroy === 'function') { // headless-gl specific cleanup
            initialGL.destroy();
        }
        initialGL = null;
    }
} catch (e) {
    canRunGpgpuTests = false;
    setupErrorMessage = `Skipping GPGPU tests due to error during headless-gl context setup: ${e.message}`;
    console.warn(setupErrorMessage);
}

// Conditionally describe the suite
const describeOrSkip = canRunGpgpuTests ? describe : describe.skip;

describeOrSkip('BigIntPrimitive GPGPU Operations via headless-gl', () => {
    let testGL;
    let testMockCanvas;

    beforeAll(() => {
        // Create a single context for all tests in this suite if preferred,
        // or create per test. Per test is cleaner for resource management.
        // For now, let's ensure it can be created.
    });

    afterAll(() => {
        // If a shared context was created, destroy it.
    });

    // Use a helper for common test setup
    const runGpgpuAddTest = (num1Str, num2Str, expectedSumStr, testName) => {
        it(testName || `GPU Add: ${num1Str} + ${num2Str} = ${expectedSumStr}`, () => {
            // Create a new context for each test to ensure isolation
            testMockCanvas = createMockCanvas(64, 1); // texWidth can be up to 64 for large numbers
            testGL = testMockCanvas.getContext('webgl');
            if (!testGL) {
                // This should ideally not happen if canRunGpgpuTests is true,
                // but as a safeguard:
                expect.fail("Failed to create headless-gl context for test execution.");
                return;
            }

            // Ensure OES_texture_float and WEBGL_color_buffer_float are available for this context as well
            const hasOESTF = testGL.getExtension('OES_texture_float');
            const hasWCBF = testGL.getExtension('WEBGL_color_buffer_float');
            if (!hasOESTF || !hasWCBF) {
              let extErr = '';
              if (!hasOESTF) extErr += 'OES_texture_float not supported. ';
              if (!hasWCBF) extErr += 'WEBGL_color_buffer_float not supported. ';
              expect.fail(extErr + 'Skipping this GPGPU test.');
              // Clean up context for this test even if failing due to extensions
              if (typeof testGL.destroy === 'function') { testGL.destroy(); }
              return;
            }

            delete BigIntPrimitive._shaderProgramsCache["additionProgram"];
            const num1 = new BigIntPrimitive(num1Str, testMockCanvas, { forceCPU: false });
            const num2 = new BigIntPrimitive(num2Str, testMockCanvas, { forceCPU: false });

            // Ensure GPU path is attempted by not forcing CPU
            num1.forceCPU = false;
            num2.forceCPU = false;

            const result = num1.add(num2);
            expect(result.toString()).toBe(expectedSumStr);

            // Cleanup context for this test
            if (typeof testGL.destroy === 'function') { // headless-gl specific cleanup
                testGL.destroy();
            }
        });
    };

    // Test Cases for GPU add
    runGpgpuAddTest("123", "456", "579");
    runGpgpuAddTest("8000", "7000", "15000");
    runGpgpuAddTest("9999", "1", "10000");
    runGpgpuAddTest(
        "12345678901234567890",
        "98765432109876543210",
        "111111111011111111100",
        "GPU Add: Large Number Test (A+B)"
    );
    runGpgpuAddTest(
        "12345678901234567890",
        "12345678901234567890",
        "24691357802469135780",
        "GPU Add: Large Number Test (A+A)"
    );
    runGpgpuAddTest("5", "0", "5", "GPU Add: X + 0");
    runGpgpuAddTest("0", "5", "5", "GPU Add: 0 + X"); // Corrected test

    // Test with different exponents (commonExponent will be handled by add method's CPU part before GPU)
    runGpgpuAddTest("1.23", "4.56", "5.79"); // e.g., 123e-2 + 456e-2 = 579e-2
    runGpgpuAddTest("12300", "45600", "57900"); // e.g., 123e2 + 456e2 = 579e2

    // A test that might stress texWidth and carry
    runGpgpuAddTest("99", "1", "100");
    runGpgpuAddTest("999", "1", "1000");

});
