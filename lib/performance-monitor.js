/**
 * Performance Monitor for GPU BigInt Operations
 * Tracks timing, cache efficiency, and resource usage
 */

class PerformanceMonitor {
    constructor() {
        this.metrics = {
            operations: {
                add: { count: 0, totalTime: 0, gpuTime: 0, cpuTime: 0 },
                subtract: { count: 0, totalTime: 0, gpuTime: 0, cpuTime: 0 },
                multiply: { count: 0, totalTime: 0, gpuTime: 0, cpuTime: 0 },
                divide: { count: 0, totalTime: 0, gpuTime: 0, cpuTime: 0 }
            },
            gpu: {
                contextCreations: 0,
                shaderCompilations: 0,
                textureCreations: 0,
                framebufferCreations: 0,
                gpuMemoryUsed: 0,
                fallbacksToCpu: 0
            },
            cache: {
                hits: 0,
                misses: 0,
                evictions: 0
            }
        };
        this.activeTimers = new Map();
        this.isEnabled = false;
    }

    enable() {
        this.isEnabled = true;
        console.log('[PerformanceMonitor] Performance monitoring enabled');
    }

    disable() {
        this.isEnabled = false;
        console.log('[PerformanceMonitor] Performance monitoring disabled');
    }

    startTimer(operation, operationType = 'total') {
        if (!this.isEnabled) return null;
        
        const key = `${operation}_${operationType}`;
        const startTime = performance.now();
        this.activeTimers.set(key, startTime);
        return key;
    }

    endTimer(timerKey) {
        if (!this.isEnabled || !timerKey) return 0;
        
        const startTime = this.activeTimers.get(timerKey);
        if (!startTime) return 0;
        
        const endTime = performance.now();
        const duration = endTime - startTime;
        this.activeTimers.delete(timerKey);
        
        // Parse timer key to update metrics
        const [operation, operationType] = timerKey.split('_');
        if (this.metrics.operations[operation]) {
            this.metrics.operations[operation].count++;
            this.metrics.operations[operation].totalTime += duration;
            
            if (operationType === 'gpu') {
                this.metrics.operations[operation].gpuTime += duration;
            } else if (operationType === 'cpu') {
                this.metrics.operations[operation].cpuTime += duration;
            }
        }
        
        return duration;
    }

    recordGpuMetric(metric, value = 1) {
        if (!this.isEnabled) return;
        
        if (this.metrics.gpu[metric] !== undefined) {
            this.metrics.gpu[metric] += value;
        }
    }

    recordCacheMetric(metric, value = 1) {
        if (!this.isEnabled) return;
        
        if (this.metrics.cache[metric] !== undefined) {
            this.metrics.cache[metric] += value;
        }
    }

    getMetrics() {
        return JSON.parse(JSON.stringify(this.metrics));
    }

    getOperationStats(operation) {
        const ops = this.metrics.operations[operation];
        if (!ops || ops.count === 0) return null;
        
        return {
            operation,
            totalOperations: ops.count,
            averageTime: ops.totalTime / ops.count,
            averageGpuTime: ops.gpuTime / ops.count,
            averageCpuTime: ops.cpuTime / ops.count,
            gpuRatio: ops.gpuTime / ops.totalTime,
            cpuRatio: ops.cpuTime / ops.totalTime
        };
    }

    getAllOperationStats() {
        return Object.keys(this.metrics.operations).map(op => this.getOperationStats(op)).filter(Boolean);
    }

    getCacheEfficiency() {
        const total = this.metrics.cache.hits + this.metrics.cache.misses;
        return total > 0 ? (this.metrics.cache.hits / total) * 100 : 0;
    }

    getGpuEfficiency() {
        const totalOps = Object.values(this.metrics.operations).reduce((sum, op) => sum + op.count, 0);
        return totalOps > 0 ? ((totalOps - this.metrics.gpu.fallbacksToCpu) / totalOps) * 100 : 0;
    }

    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalOperations: Object.values(this.metrics.operations).reduce((sum, op) => sum + op.count, 0),
                cacheEfficiency: this.getCacheEfficiency(),
                gpuEfficiency: this.getGpuEfficiency(),
                gpuFallbacks: this.metrics.gpu.fallbacksToCpu
            },
            operations: this.getAllOperationStats(),
            gpu: this.metrics.gpu,
            cache: this.metrics.cache
        };
        
        return report;
    }

    printReport() {
        if (!this.isEnabled) {
            console.log('[PerformanceMonitor] Performance monitoring is disabled');
            return;
        }
        
        const report = this.generateReport();
        
        console.log('\n=== GPU BigInt Performance Report ===');
        console.log(`Generated: ${report.timestamp}`);
        console.log(`\nSummary:`);
        console.log(`  Total Operations: ${report.summary.totalOperations}`);
        console.log(`  Cache Efficiency: ${report.summary.cacheEfficiency.toFixed(2)}%`);
        console.log(`  GPU Efficiency: ${report.summary.gpuEfficiency.toFixed(2)}%`);
        console.log(`  GPU Fallbacks: ${report.summary.gpuFallbacks}`);
        
        console.log('\nOperation Details:');
        report.operations.forEach(op => {
            console.log(`  ${op.operation.toUpperCase()}:`);
            console.log(`    Count: ${op.totalOperations}`);
            console.log(`    Avg Time: ${op.averageTime.toFixed(2)}ms`);
            console.log(`    GPU Time: ${op.averageGpuTime.toFixed(2)}ms (${(op.gpuRatio * 100).toFixed(1)}%)`);
            console.log(`    CPU Time: ${op.averageCpuTime.toFixed(2)}ms (${(op.cpuRatio * 100).toFixed(1)}%)`);
        });
        
        console.log('\nGPU Resource Usage:');
        console.log(`  Context Creations: ${report.gpu.contextCreations}`);
        console.log(`  Shader Compilations: ${report.gpu.shaderCompilations}`);
        console.log(`  Texture Creations: ${report.gpu.textureCreations}`);
        console.log(`  Framebuffer Creations: ${report.gpu.framebufferCreations}`);
        
        console.log('\nCache Performance:');
        console.log(`  Hits: ${report.cache.hits}`);
        console.log(`  Misses: ${report.cache.misses}`);
        console.log(`  Evictions: ${report.cache.evictions}`);
        console.log('=====================================\n');
    }

    reset() {
        this.metrics = {
            operations: {
                add: { count: 0, totalTime: 0, gpuTime: 0, cpuTime: 0 },
                subtract: { count: 0, totalTime: 0, gpuTime: 0, cpuTime: 0 },
                multiply: { count: 0, totalTime: 0, gpuTime: 0, cpuTime: 0 },
                divide: { count: 0, totalTime: 0, gpuTime: 0, cpuTime: 0 }
            },
            gpu: {
                contextCreations: 0,
                shaderCompilations: 0,
                textureCreations: 0,
                framebufferCreations: 0,
                gpuMemoryUsed: 0,
                fallbacksToCpu: 0
            },
            cache: {
                hits: 0,
                misses: 0,
                evictions: 0
            }
        };
        this.activeTimers.clear();
        console.log('[PerformanceMonitor] Metrics reset');
    }

    clearMetrics() {
        this.reset();
    }

    // Decorator function for timing methods
    timeOperation(operation, operationType = 'total') {
        return (target, propertyKey, descriptor) => {
            const originalMethod = descriptor.value;
            
            descriptor.value = function(...args) {
                const timer = this.startTimer(operation, operationType);
                try {
                    const result = originalMethod.apply(this, args);
                    this.endTimer(timer);
                    return result;
                } catch (error) {
                    this.endTimer(timer);
                    throw error;
                }
            };
            
            return descriptor;
        };
    }
}

// Global instance
const performanceMonitor = new PerformanceMonitor();

// Export for use in other modules
export { performanceMonitor as PerformanceMonitor };
