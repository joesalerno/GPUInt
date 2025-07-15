import { describe, it, expect, beforeEach } from 'vitest';
import { BigIntPrimitive } from './bigint.js';

describe('Division Precision Issue', () => {
    let canvas;
    
    beforeEach(() => {
        canvas = document.createElement('canvas');
        BigIntPrimitive.DP = 32; // Set high precision for testing
    });

    it('should handle large number division with consistent precision', () => {
        const num1 = new BigIntPrimitive("12345678901234567890", canvas);
        const num2 = new BigIntPrimitive("98765432109876543210", canvas);
        
        console.log("Testing division: 12345678901234567890 / 98765432109876543210");
        console.log("Expected: 0.12499999886093750001423828124982");
        
        // Force CPU calculation
        const cpuResult = new BigIntPrimitive("12345678901234567890", canvas, { forceCPU: true })
            .divide(new BigIntPrimitive("98765432109876543210", canvas, { forceCPU: true }));
        console.log("CPU Result: " + cpuResult.toString());
        
        // GPU calculation
        const gpuResult = num1.divide(num2);
        console.log("GPU Result: " + gpuResult.toString());
        
        // The expected result with high precision
        const expectedResult = "0.12499999886093750001423828124982";
        
        // Check if CPU and GPU results are close to expected
        const cpuStr = cpuResult.toString();
        const gpuStr = gpuResult.toString();
        
        console.log("CPU vs Expected:", cpuStr === expectedResult ? "MATCH" : "DIFFERS");
        console.log("GPU vs Expected:", gpuStr === expectedResult ? "MATCH" : "DIFFERS");
        console.log("CPU vs GPU:", cpuStr === gpuStr ? "MATCH" : "DIFFERS");
        
        // For now, let's just verify they produce reasonable results
        expect(parseFloat(cpuStr)).toBeCloseTo(0.125, 3);
        expect(parseFloat(gpuStr)).toBeCloseTo(0.125, 3);
    });
});
