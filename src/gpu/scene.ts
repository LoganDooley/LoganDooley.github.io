import type { GpuContext} from "./device";
import shaderSource from "./shaders/background.wgsl?raw";


export class Scene {
    private device: GPUDevice;
    private canvas: HTMLCanvasElement;
    private context: GPUCanvasContext;
    private format: GPUTextureFormat;

    private pipeline: GPURenderPipeline;
    private uniformBuffer: GPUBuffer;
    private bindGroup: GPUBindGroup;
    private uniformData = new Float32Array(4);

    private frameId: number | null = null;

    constructor(gpu: GpuContext, canvas: HTMLCanvasElement) {
        this.device = gpu.device;
        this.canvas = canvas;

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

        // Create render pipeline
        const shaderModule = this.device.createShaderModule({
            label: "background shader",
            code: shaderSource,
        });

        this.pipeline = this.device.createRenderPipeline({
            label: "background pipeline",
            layout: "auto",
            vertex: { module: shaderModule, entryPoint: "vs_main" },
            fragment: { module: shaderModule, entryPoint: "fs_main", targets: [{ format: this.format}],},
            primitive: { topology: "triangle-list" },
        });

        // Create uniforms
        this.uniformBuffer = this.device.createBuffer({
            label: "background uniforms",
            size: this.uniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.bindGroup = this.device.createBindGroup({
            label: "background bind group",
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.uniformBuffer }}],
        });

        // Keep canvas resolution up to date with screen size
        const observer = new ResizeObserver(() => this.resize());
        observer.observe(canvas);
        this.resize();
    }

    start(): void {
        if (this.frameId !== null) {
            return;
        }

        const loop = (now: number) => {
            this.render(now / 1000);
            this.frameId = requestAnimationFrame(loop);
        };
        this.frameId = requestAnimationFrame(loop);
    }

    private resize(): void {
        const dpr = Math.min(window.devicePixelRatio, 1.5);
        const maxSize = this.device.limits.maxTextureDimension2D;

        const width = Math.floor(this.canvas.clientWidth * dpr);
        const height = Math.floor(this.canvas.clientHeight * dpr);

        this.canvas.width = Math.max(1, Math.min(width, maxSize));
        this.canvas.height = Math.max(1, Math.min(height, maxSize));
    }

    private render(timeSeconds: number): void {
        this.uniformData[0] = this.canvas.width;
        this.uniformData[1] = this.canvas.height;
        this.uniformData[2] = timeSeconds;

        // Write uniform data into queue
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

        const encoder = this.device.createCommandEncoder({ label: "frame" });

        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.context.getCurrentTexture().createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.draw(3); // 3 vertices for full screen tri
        pass.end();

        this.device.queue.submit([encoder.finish()]);
    }
}