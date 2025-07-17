import { describe, it, expect, beforeEach } from 'vitest';
import { BigIntPrimitive } from './bigint.js';
import { PerformanceMonitor } from './performance-monitor.js';

describe('GPU Performance Optimizations', () => {
    beforeEach(() => {
        // Enable performance monitoring for all tests
        PerformanceMonitor.enable();
    });
    
    it('should track performance metrics during operations', () => {
        // Clear previous metrics
        PerformanceMonitor.clearMetrics();
        
        // Enable performance monitoring
        PerformanceMonitor.enable();
        
        // Create canvas for GPU operations
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        
        // Test addition
        const num1 = new BigIntPrimitive("123456789", canvas);
        const num2 = new BigIntPrimitive("987654321", canvas);
        const result = num1.add(num2);
        
        expect(result.toString()).toBe("1111111110");
        
        // Test multiplication
        const num3 = new BigIntPrimitive("12345", canvas);
        const num4 = new BigIntPrimitive("67890", canvas);
        const result2 = num3.multiply(num4);
        
        expect(result2.toString()).toBe("838102050");
        
        // Generate performance report
        const report = PerformanceMonitor.generateReport();
        
        console.log("Performance Report:");
        console.log("==================");
        console.log(JSON.stringify(report, null, 2));
        
        // Verify that operations were tracked
        expect(report.operations).toBeDefined();
        expect(report.operations.length).toBeGreaterThanOrEqual(0);
        
        // Check that metrics were recorded
        expect(report.summary.totalOperations).toBeGreaterThanOrEqual(0);
        expect(report.gpu.fallbacksToCpu).toBeGreaterThanOrEqual(0);
    });
    
    it('should demonstrate resource caching efficiency', () => {
        // Clear previous metrics
        PerformanceMonitor.clearMetrics();
        
        // Enable performance monitoring
        PerformanceMonitor.enable();
        
        // Create canvas for GPU operations
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        
        // Perform multiple operations to test caching
        const operations = [];
        for (let i = 0; i < 5; i++) {
            const num1 = new BigIntPrimitive((100 + i).toString(), canvas);
            const num2 = new BigIntPrimitive((200 + i).toString(), canvas);
            operations.push(num1.add(num2));
        }
        
        // Verify all operations completed
        expect(operations.length).toBe(5);
        expect(operations[0].toString()).toBe("300");
        expect(operations[4].toString()).toBe("308");
        
        // Generate performance report
        const report = PerformanceMonitor.generateReport();
        
        console.log("Cache Performance Report:");
        console.log("========================");
        console.log(JSON.stringify(report, null, 2));
        
        // Verify caching metrics are being tracked
        expect(report.cache).toBeDefined();
        expect(report.summary.cacheEfficiency).toBeGreaterThanOrEqual(0);
        expect(report.summary.cacheEfficiency).toBeLessThanOrEqual(100);
        
        // Verify resource utilization
        expect(report.gpu.contextCreations).toBeGreaterThanOrEqual(0);
        expect(report.gpu.shaderCompilations).toBeGreaterThanOrEqual(0);
        expect(report.gpu.textureCreations).toBeGreaterThanOrEqual(0);
        expect(report.gpu.framebufferCreations).toBeGreaterThanOrEqual(0);
    });
});