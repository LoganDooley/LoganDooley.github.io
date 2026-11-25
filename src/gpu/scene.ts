import type { GpuContext} from "./device";

export class Scene {
    private device: GPUDevice;
    private context: GPUCanvasContext;
    private format: GPUTextureFormat;

    constructor(gpu: GpuContext, canvas: HTMLCanvasElement) {
        this.device = gpu.device;

        const context = canvas.getContext("webgpu");
        if (!context) {
            throw new Error("Could not get a WebGPU context from the canvas.");
        }
        this.context = context;

        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: "opaque",
        });
    }

    render(): void {
        const encoder = this.device.createCommandEncoder();

        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.context.getCurrentTexture().createView(),
                    clearValue: { r: 0.35, g: 0.5, b: 0.66, a: 1.0 },
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
        });
        pass.end();

        this.device.queue.submit([encoder.finish()]);
    }
}