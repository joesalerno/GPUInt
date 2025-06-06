async function initWebGPU() {
    if (!navigator.gpu) {
        console.error("WebGPU not supported on this browser.");
        return null;
    }

    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            console.error("Failed to get GPU adapter.");
            return null;
        }
        const device = await adapter.requestDevice();
        if (!device) {
            console.error("Failed to get GPU device.");
            return null;
        }
        console.log("WebGPU initialized successfully.");
        return device;
    } catch (error) {
        console.error("Error initializing WebGPU:", error);
        return null;
    }
}

function jsBigIntToU32Array(bigintValue) {
    if (typeof bigintValue !== 'bigint') {
        throw new TypeError("Input must be a BigInt");
    }

    let sign = true; // true for positive, false for negative
    if (bigintValue < 0n) {
        sign = false;
        bigintValue = -bigintValue; // Work with positive value for conversion
    }

    if (bigintValue === 0n) {
        return { sign, limbs: [0] };
    }

    const limbs = [];
    let tempBigInt = bigintValue;
    const mask = (1n << 32n) - 1n; // Mask for 32 bits

    while (tempBigInt > 0n) {
        limbs.push(Number(tempBigInt & mask));
        tempBigInt >>= 32n;
    }

    return { sign, limbs: limbs.length > 0 ? limbs : [0] }; // Ensure at least one limb for zero
}

function u32ArrayToJsBigInt(limbs, sign) {
    if (!Array.isArray(limbs) || !limbs.every(l => typeof l === 'number' && l >= 0 && l <= 0xFFFFFFFF)) {
        throw new TypeError("Limbs must be an array of u32 numbers.");
    }
    if (typeof sign !== 'boolean') {
        throw new TypeError("Sign must be a boolean.");
    }

    let resultBigInt = 0n;
    for (let i = limbs.length - 1; i >= 0; i--) {
        resultBigInt <<= 32n;
        resultBigInt += BigInt(limbs[i]);
    }

    return sign ? resultBigInt : -resultBigInt;
}

class GPUBigInt {
    constructor(nativeBigInt) {
        if (typeof nativeBigInt !== 'bigint') {
            throw new TypeError("GPUBigInt constructor expects a native JavaScript BigInt.");
        }
        const { sign, limbs } = jsBigIntToU32Array(nativeBigInt);
        this.sign = sign; // true for positive, false for negative
        this.u32Array = limbs; // Array of u32, least significant at index 0
    }

    toNativeBigInt() {
        return u32ArrayToJsBigInt(this.u32Array, this.sign);
    }
}

async function createGPUBuffer(device, data, usage) {
    if (!(data instanceof Uint32Array)) {
        console.error("Data must be a Uint32Array.");
        return null;
    }
    if (!device || typeof device.createBuffer !== 'function') {
        console.error("Invalid WebGPU device provided.");
        return null;
    }

    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: usage | GPUBufferUsage.COPY_DST, // Ensure COPY_DST for writeBuffer
        mappedAtCreation: true,
    });

    new Uint32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();

    // The above lines write data to the buffer while it's mapped.
    // For completeness, if we wanted to use queue.writeBuffer, it would look like:
    // device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    // However, mappedAtCreation is generally more direct for initial data population.

    return buffer;
}

async function readDataFromGPUBuffer(device, gpuBuffer, bufferSize) {
    if (!device || typeof device.createBuffer !== 'function') {
        console.error("Invalid WebGPU device provided.");
        return null;
    }
    if (!gpuBuffer || !(gpuBuffer instanceof GPUBuffer)) {
        console.error("Invalid GPUBuffer provided.");
        return null;
    }
    if (typeof bufferSize !== 'number' || bufferSize <= 0) {
        console.error("Invalid bufferSize provided.");
        return null;
    }

    const stagingBuffer = device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const commandEncoder = device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(
        gpuBuffer, // source
        0, // sourceOffset
        stagingBuffer, // destination
        0, // destinationOffset
        bufferSize // size
    );

    device.queue.submit([commandEncoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ, 0, bufferSize);
    const copyArrayBuffer = stagingBuffer.getMappedRange(0, bufferSize);
    const data = new Uint32Array(copyArrayBuffer.slice(0)); // Use slice to copy the data
    stagingBuffer.unmap();

    return data;
}

// Shader strings defined at module level
const limb_add_shader_wgsl = `@group(0) @binding(0) var<storage, read> limbsA: array<u32>;
@group(0) @binding(1) var<storage, read> limbsB: array<u32>;
@group(0) @binding(2) var<storage, write> sum_limbs_raw: array<u32>;
@group(0) @binding(3) var<storage, write> carry_limbs_raw: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;
    if (idx >= arrayLength(&sum_limbs_raw)) { return; }
    var valA: u32 = 0u;
    if (idx < arrayLength(&limbsA)) { valA = limbsA[idx]; }
    var valB: u32 = 0u;
    if (idx < arrayLength(&limbsB)) { valB = limbsB[idx]; }
    let sum64 = u64(valA) + u64(valB);
    sum_limbs_raw[idx] = u32(sum64 & 0xFFFFFFFFu);
    carry_limbs_raw[idx] = u32(sum64 >> 32u);
}`;

const limb_subtract_shader_wgsl = `@group(0) @binding(0) var<storage, read> limbsA: array<u32>;
@group(0) @binding(1) var<storage, read> limbsB: array<u32>;
@group(0) @binding(2) var<storage, write> diff_limbs_raw: array<u32>;
@group(0) @binding(3) var<storage, write> borrow_out_limbs: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;
    if (idx >= arrayLength(&diff_limbs_raw)) { return; }
    var valA: u32 = 0u;
    if (idx < arrayLength(&limbsA)) { valA = limbsA[idx]; }
    var valB: u32 = 0u;
    if (idx < arrayLength(&limbsB)) { valB = limbsB[idx]; }
    diff_limbs_raw[idx] = valA - valB;
    borrow_out_limbs[idx] = select(0u, 1u, valA < valB);
}`;

// GPUBigMath class definition comes after helper functions and shader strings
// GPUBigMath class and its methods are already defined above this section in the current file content.
// The global gpuMultiply function is what needs to be removed.
// The limb_multiply_shader_wgsl is also correctly defined at module level before GPUBigMath.

// We need to remove the global gpuMultiply function.
// The GPUBigMath class already contains the multiply method.
// The SEARCH block should start from the beginning of the global gpuMultiply function.
// The REPLACE block will be empty, effectively deleting it.

// The limb_multiply_shader_wgsl constant should remain as it is correctly placed.
// The GPUBigMath class definition and its methods should remain.

// The following is the global gpuMultiply function that needs to be deleted.
// async function gpuMultiply(device, bigintA_native, bigintB_native) { ... }
// This was defined after the GPUBigMath class in the previous incorrect diff.
// Let's verify the current file content again. The file content from the previous turn shows
// GPUBigMath class, then limb_multiply_shader_wgsl, then the global gpuMultiply.
// So the structure is:
// ... gpuSubtract global function ...
// class GPUBigMath { ... add, subtract, multiply methods ... }
// const limb_multiply_shader_wgsl = `...`;
// async function gpuMultiply(device, bigintA_native, bigintB_native) { ... } // This is the one to delete

// The GPUBigMath.multiply method already uses the module-scoped limb_multiply_shader_wgsl.
// So the main task is just to delete the global gpuMultiply.
