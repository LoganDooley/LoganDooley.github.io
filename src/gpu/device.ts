export interface GpuContext {
    adapter: GPUAdapter;
    device: GPUDevice;
    hasTimestamps: boolean;
}

let cached: Promise<GpuContext | null> | null = null;

export function getGpu(): Promise<GpuContext | null> {
    if (!cached) {
        cached = initGpu();
    }
    return cached;
}

async function initGpu(): Promise<GpuContext | null> {
    if (!navigator.gpu) {
        console.warn("WebGPU is not supported in this browser.");
        return null;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        console.warn("No suitable GPU adapter found.");
        return null;
    }

    const hasTimestamps = adapter.features.has("timestamp-query");
    const requiredFeatures: GPUFeatureName[] = [];
    if (hasTimestamps) {
        requiredFeatures.push("timestamp-query");
    }

    const device = await adapter.requestDevice({ requiredFeatures });

    device.lost.then((info) => {
        console.error(`WebGPU device lost: ${info.message}`);
    });

    return { adapter, device, hasTimestamps };
}