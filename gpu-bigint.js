async function initWebGPU() {
    if (!navigator.gpu) {
        console.error("WebGPU not supported on this browser.");
        return null;
    }
    console.log("Requesting GPU adapter...");
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            console.error("Failed to get GPU adapter. Adapter is null.");
            return null;
        }
        console.log("Adapter acquired. Requesting GPU device...");
        // No specific features requested for now, default should be fine.
        const device = await adapter.requestDevice();
        if (!device) {
            console.error("Failed to get GPU device. Device is null.");
            return null;
        }
        console.log("WebGPU device acquired successfully:", device);
        device.lost.then((info) => {
            console.error("WebGPU device lost:", info.message, info.reason);
        });
        return device;
    } catch (error) {
        console.error("Error initializing WebGPU:", error.message, error);
        return null;
    }
}

function jsBigIntToU32Array(bigintValue) {
    if (typeof bigintValue !== 'bigint') {
        throw new TypeError("Input must be a BigInt");
    }
    let sign = true;
    if (bigintValue < 0n) {
        sign = false;
        bigintValue = -bigintValue;
    }
    if (bigintValue === 0n) {
        return { sign, limbs: [0] };
    }
    const limbs = [];
    let tempBigInt = bigintValue;
    const mask = (1n << 32n) - 1n;
    while (tempBigInt > 0n) {
        limbs.push(Number(tempBigInt & mask));
        tempBigInt >>= 32n;
    }
    return { sign, limbs: limbs.length > 0 ? limbs : [0] };
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
        this.sign = sign;
        this.u32Array = limbs;
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
        usage: usage | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Uint32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
}

async function readDataFromGPUBuffer(device, gpuBuffer, bufferSize) {
    if (!device || typeof device.createBuffer !== 'function') { /* ... */ }
    if (!gpuBuffer || !(gpuBuffer instanceof GPUBuffer)) { /* ... */ }
    if (typeof bufferSize !== 'number' || bufferSize <= 0) { /* ... */ }

    const stagingBuffer = device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const commandEncoder = device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(gpuBuffer, 0, stagingBuffer, 0, bufferSize);
    device.queue.submit([commandEncoder.finish()]);
    await stagingBuffer.mapAsync(GPUMapMode.READ, 0, bufferSize);
    const copyArrayBuffer = stagingBuffer.getMappedRange(0, bufferSize);
    const data = new Uint32Array(copyArrayBuffer.slice(0));
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
    var valA: u32 = 0u; if (idx < arrayLength(&limbsA)) { valA = limbsA[idx]; }
    var valB: u32 = 0u; if (idx < arrayLength(&limbsB)) { valB = limbsB[idx]; }
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
    var valA: u32 = 0u; if (idx < arrayLength(&limbsA)) { valA = limbsA[idx]; }
    var valB: u32 = 0u; if (idx < arrayLength(&limbsB)) { valB = limbsB[idx]; }
    diff_limbs_raw[idx] = valA - valB;
    borrow_out_limbs[idx] = select(0u, 1u, valA < valB);
}`;

const limb_multiply_shader_wgsl = `struct Params { num_limbs_A: u32, num_limbs_B: u32, };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> limbsA: array<u32>;
@group(0) @binding(2) var<storage, read> limbsB: array<u32>;
@group(0) @binding(3) var<storage, write> partial_products_low: array<u32>;
@group(0) @binding(4) var<storage, write> partial_products_high: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let flat_idx = global_id.x;
    let n_a = params.num_limbs_A; let n_b = params.num_limbs_B;
    if (flat_idx >= n_a * n_b || n_b == 0u || n_a == 0u) { return; }
    let i = flat_idx / n_b; let j = flat_idx % n_b;
    let valA = limbsA[i]; let valB = limbsB[j];
    let product64 = u64(valA) * u64(valB);
    partial_products_low[flat_idx] = u32(product64 & 0xFFFFFFFFu);
    partial_products_high[flat_idx] = u32(product64 >> 32u);
}`;


class GPUBigMath {
    constructor(device) {
        if (!device) {
            throw new Error("GPUBigMath constructor requires a valid WebGPU device.");
        }
        this.device = device;

        this.addBindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
            ],
        });
        this.addPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.addBindGroupLayout] });

        this.subtractBindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
            ],
        });
        this.subtractPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.subtractBindGroupLayout] });

        this.multiplyBindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
            ],
        });
        this.multiplyPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.multiplyBindGroupLayout] });
    }

    async add(bigintA_native, bigintB_native) {
        const device = this.device;
        if (!device || typeof bigintA_native !== 'bigint' || typeof bigintB_native !== 'bigint') { /* error handling */ return null; }
        if (bigintA_native < 0n || bigintB_native < 0n) { /* error handling for positive only */ return null; }

        const objA = jsBigIntToU32Array(bigintA_native);
        const objB = jsBigIntToU32Array(bigintB_native);
        const n = Math.max(objA.limbs.length, objB.limbs.length);
        const paddedLimbsA = new Uint32Array(n); paddedLimbsA.set(objA.limbs);
        const paddedLimbsB = new Uint32Array(n); paddedLimbsB.set(objB.limbs);

        const bufferA = await createGPUBuffer(device, paddedLimbsA, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
        const bufferB = await createGPUBuffer(device, paddedLimbsB, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
        const bufferSumRaw = await createGPUBuffer(device, new Uint32Array(n), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
        const bufferCarryRaw = await createGPUBuffer(device, new Uint32Array(n), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
        if (!bufferA || !bufferB || !bufferSumRaw || !bufferCarryRaw) { /* error handling */ return null; }

        const shaderModule = device.createShaderModule({ code: limb_add_shader_wgsl });
        const pipeline = device.createComputePipeline({
            layout: this.addPipelineLayout,
            compute: { module: shaderModule, entryPoint: 'main' },
        });
        const bindGroup = device.createBindGroup({
            layout: this.addBindGroupLayout, // Use pre-created layout
            entries: [
                { binding: 0, resource: { buffer: bufferA } }, { binding: 1, resource: { buffer: bufferB } },
                { binding: 2, resource: { buffer: bufferSumRaw } }, { binding: 3, resource: { buffer: bufferCarryRaw } },
            ],
        });
        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(pipeline); passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(Math.ceil(n / 64));
        passEncoder.end();
        device.queue.submit([commandEncoder.finish()]);

        const sum_limbs_raw_array = await readDataFromGPUBuffer(device, bufferSumRaw, n * 4);
        const carry_limbs_raw_array = await readDataFromGPUBuffer(device, bufferCarryRaw, n * 4);
        if (!sum_limbs_raw_array || !carry_limbs_raw_array) { /* error handling */ return null; }

        const finalResultLimbsList = []; let currentCarry = 0n;
        for (let i = 0; i < n; i++) {
            const limbVal = BigInt(sum_limbs_raw_array[i]) + currentCarry;
            finalResultLimbsList.push(Number(limbVal & 0xFFFFFFFFn));
            currentCarry = (limbVal >> 32n) + BigInt(carry_limbs_raw_array[i]);
        }
        if (currentCarry > 0n) { while (currentCarry > 0n) { finalResultLimbsList.push(Number(currentCarry & 0xFFFFFFFFn)); currentCarry >>= 32n; } }
        else if (finalResultLimbsList.length === 0) { finalResultLimbsList.push(0); }
        while (finalResultLimbsList.length > 1 && finalResultLimbsList[finalResultLimbsList.length - 1] === 0) { finalResultLimbsList.pop(); }
        return u32ArrayToJsBigInt(new Uint32Array(finalResultLimbsList), true);
    }

    async subtract(bigintA_native, bigintB_native) {
        const device = this.device;
        if (!device) { throw new Error("GPUBigMath.subtract: Invalid WebGPU device."); }
        if (typeof bigintA_native !== 'bigint' || typeof bigintB_native !== 'bigint') { throw new Error("GPUBigMath.subtract: Inputs must be native BigInts."); }
        if (bigintA_native < 0n || bigintB_native < 0n) { throw new Error("GPUBigMath.subtract: Currently only supports subtraction of positive BigInts."); }
        if (bigintA_native < bigintB_native) { throw new Error("GPUBigMath.subtract: Subtraction would result in a negative number, which is not supported yet."); }

        const objA = jsBigIntToU32Array(bigintA_native); const objB = jsBigIntToU32Array(bigintB_native);
        const n = Math.max(objA.limbs.length, objB.limbs.length);
        const paddedLimbsA = new Uint32Array(n); paddedLimbsA.set(objA.limbs);
        const paddedLimbsB = new Uint32Array(n); paddedLimbsB.set(objB.limbs);

        const bufferA = await createGPUBuffer(device, paddedLimbsA, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
        const bufferB = await createGPUBuffer(device, paddedLimbsB, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
        const bufferDiffRaw = await createGPUBuffer(device, new Uint32Array(n), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
        const bufferBorrowOutRaw = await createGPUBuffer(device, new Uint32Array(n), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
        if (!bufferA || !bufferB || !bufferDiffRaw || !bufferBorrowOutRaw) { throw new Error("GPUBigMath.subtract: Failed to create one or more GPU buffers.");}

        const shaderModule = device.createShaderModule({ code: limb_subtract_shader_wgsl });
        const pipeline = device.createComputePipeline({
            layout: this.subtractPipelineLayout,
            compute: { module: shaderModule, entryPoint: 'main' },
        });
        const bindGroup = device.createBindGroup({
            layout: this.subtractBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: bufferA } }, { binding: 1, resource: { buffer: bufferB } },
                { binding: 2, resource: { buffer: bufferDiffRaw } }, { binding: 3, resource: { buffer: bufferBorrowOutRaw } },
            ],
        });
        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(pipeline); passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(Math.ceil(n / 64));
        passEncoder.end();
        device.queue.submit([commandEncoder.finish()]);

        const finalResultLimbsList = []; let propagatedBorrowIn = 0n;
        for (let i = 0; i < n; i++) {
            let limbA_i = BigInt(paddedLimbsA[i]); let limbB_i = BigInt(paddedLimbsB[i]);
            let val_A_eff = limbA_i - propagatedBorrowIn;
            let current_diff = val_A_eff - limbB_i;
            if (current_diff < 0n) { finalResultLimbsList.push(Number(current_diff + 0x100000000n)); propagatedBorrowIn = 1n; }
            else { finalResultLimbsList.push(Number(current_diff)); propagatedBorrowIn = 0n; }
        }
        if (propagatedBorrowIn === 1n) { console.error("GPUBigMath.subtract: Final propagated borrow is 1."); }
        while (finalResultLimbsList.length > 1 && finalResultLimbsList[finalResultLimbsList.length - 1] === 0) { finalResultLimbsList.pop(); }
        if (finalResultLimbsList.length === 0) finalResultLimbsList.push(0);
        return u32ArrayToJsBigInt(new Uint32Array(finalResultLimbsList), true);
    }

    async multiply(bigintA_native, bigintB_native) {
        const device = this.device;
        if (!device) { throw new Error("GPUBigMath.multiply: Invalid WebGPU device."); }
        if (typeof bigintA_native !== 'bigint' || typeof bigintB_native !== 'bigint') { throw new Error("GPUBigMath.multiply: Inputs must be native BigInts."); }

        let signA = bigintA_native >= 0n; let signB = bigintB_native >= 0n;
        const finalSign = (signA === signB);
        const absA = signA ? bigintA_native : -bigintA_native;
        const absB = signB ? bigintB_native : -bigintB_native;
        if (absA === 0n || absB === 0n) return 0n;

        const objA = jsBigIntToU32Array(absA); const objB = jsBigIntToU32Array(absB);
        const limbsA = objA.limbs; const limbsB = objB.limbs;
        const m = limbsA.length; const n = limbsB.length;
        if (m === 0 || n === 0) return 0n;

        const paramsArray = new Uint32Array([m, n]);
        const paramsBuffer = device.createBuffer({ size: paramsArray.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, });
        device.queue.writeBuffer(paramsBuffer, 0, paramsArray);

        const bufferA = await createGPUBuffer(device, limbsA, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
        const bufferB = await createGPUBuffer(device, limbsB, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
        const numPartialProducts = m * n;
        const bufferPPlow = await createGPUBuffer(device, new Uint32Array(numPartialProducts), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
        const bufferPPhigh = await createGPUBuffer(device, new Uint32Array(numPartialProducts), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
        if (!bufferA || !bufferB || !bufferPPlow || !bufferPPhigh || !paramsBuffer) { throw new Error("GPUBigMath.multiply: Failed to create one or more GPU buffers."); }

        const shaderModule = device.createShaderModule({ code: limb_multiply_shader_wgsl });
        const pipeline = device.createComputePipeline({
            layout: this.multiplyPipelineLayout,
            compute: { module: shaderModule, entryPoint: 'main' },
        });
        const bindGroup = device.createBindGroup({
            layout: this.multiplyBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: paramsBuffer } }, { binding: 1, resource: { buffer: bufferA } },
                { binding: 2, resource: { buffer: bufferB } }, { binding: 3, resource: { buffer: bufferPPlow } },
                { binding: 4, resource: { buffer: bufferPPhigh } },
            ],
        });
        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(pipeline); passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(Math.ceil(numPartialProducts / 64));
        passEncoder.end();
        device.queue.submit([commandEncoder.finish()]);

        const pp_low_array = await readDataFromGPUBuffer(device, bufferPPlow, numPartialProducts * 4);
        const pp_high_array = await readDataFromGPUBuffer(device, bufferPPhigh, numPartialProducts * 4);
        if (!pp_low_array || !pp_high_array) { throw new Error("GPUBigMath.multiply: Failed to read back partial products."); }

        const num_result_limbs = m + n;
        const result_limbs_bigint = new Array(num_result_limbs).fill(0n);
        for (let i = 0; i < m; i++) {
            for (let j = 0; j < n; j++) {
                const flat_idx = i * n + j;
                result_limbs_bigint[i + j] += BigInt(pp_low_array[flat_idx]);
                result_limbs_bigint[i + j + 1] += BigInt(pp_high_array[flat_idx]);
            }
        }
        const final_u32_limbs_list = []; let carry = 0n;
        for (let k = 0; k < num_result_limbs; k++) {
            const sum_val = result_limbs_bigint[k] + carry;
            final_u32_limbs_list.push(Number(sum_val & 0xFFFFFFFFn));
            carry = sum_val >> 32n;
        }
        while (carry > 0n) { final_u32_limbs_list.push(Number(carry & 0xFFFFFFFFn)); carry >>= 32n; }
        while (final_u32_limbs_list.length > 1 && final_u32_limbs_list[final_u32_limbs_list.length - 1] === 0) { final_u32_limbs_list.pop(); }
        if (final_u32_limbs_list.length === 0) { final_u32_limbs_list.push(0); }
        return u32ArrayToJsBigInt(new Uint32Array(final_u32_limbs_list), finalSign);
    }
}
