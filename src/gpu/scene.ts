import { mat4 } from "wgpu-matrix"
import type { GpuContext} from "./device";
import commonSrc from "./shaders/common.wgsl?raw";
import skySrc from "./shaders/sky.wgsl?raw";
import terrainSrc from "./shaders/terrain.wgsl?raw";
import noiseSrc from "./shaders/noise.wgsl?raw";
import terrainBakeSrc from "./shaders/terrain_bake.wgsl?raw";

const TERRAIN_GRID = 256;
const DEPTH_FORMAT: GPUTextureFormat = "depth24plus";
const TERRAIN_SIZE = 120;
const HEIGHTMAP_SIZE = 1024;

export class Scene {
    private device: GPUDevice;
    private canvas: HTMLCanvasElement;
    private context: GPUCanvasContext;
    private format: GPUTextureFormat;

    private skyPipeline: GPURenderPipeline;
    private terrainPipeline: GPURenderPipeline;

    private frameBuffer: GPUBuffer;
    private frameBindGroup: GPUBindGroup;
    private frameData = new Float32Array(28);

    private depthTexture: GPUTexture | null = null;

    private heightmap: GPUTexture;
    private terrainBindGroup: GPUBindGroup;

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

        // Bind group layout shared by every pipeline
        const frameLayout = this.device.createBindGroupLayout({
            label: "frame layout",
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" },
                },
            ],
        });

        const pipelineLayout = this.device.createPipelineLayout({
            label: "scene pipeline layout",
            bindGroupLayouts: [frameLayout],
        });

        const terrainLayout = this.device.createBindGroupLayout({
            label: "terrain layout",
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "float" },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    sampler: { type: "filtering" },
                },
            ],
        });
        const terrainPipelineLayout = this.device.createPipelineLayout({
            label: "terrain pipeline layout",
            bindGroupLayouts: [frameLayout, terrainLayout],
        });

        // Sky
        const skyModule = this.device.createShaderModule({
            label: "sky shader",
            code: commonSrc + skySrc,
        });
        this.skyPipeline = this.device.createRenderPipeline({
            label: "sky pipeline",
            layout: pipelineLayout,
            vertex: {
                module: skyModule,
                entryPoint: "vs_main"
            },
            fragment: {
                module: skyModule,
                entryPoint: "fs_main",
                targets: [{format: this.format}],
            },
            depthStencil: {
                format: DEPTH_FORMAT,
                depthWriteEnabled: false,
                depthCompare: "always",
            },
        });

        // Terrain
        const terrainModule = this.device.createShaderModule({
            label: "terrain shader",
            code: commonSrc + terrainSrc,
        });
        const terrainConstants = { GRID: TERRAIN_GRID, TERRAIN_SIZE };
        this.terrainPipeline = this.device.createRenderPipeline({
            label: "terrain pipeline",
            layout: terrainPipelineLayout,
            vertex: {
                module: terrainModule,
                entryPoint: "vs_main",
                constants: terrainConstants,
            },
            fragment: {
                module: terrainModule,
                entryPoint: "fs_main",
                targets: [{ format: this.format }],
                constants: terrainConstants,
            },
            primitive: { cullMode: "none" },
            depthStencil: {
                format: DEPTH_FORMAT,
                depthWriteEnabled: true,
                depthCompare: "less",
            },
        });

        // Uniform buffer
        this.frameBuffer = this.device.createBuffer({
            label: "frame uniforms",
            size: this.frameData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.frameBindGroup = this.device.createBindGroup({
            label: "frame bind group",
            layout: frameLayout,
            entries: [{
                binding: 0,
                resource: { buffer: this.frameBuffer }
            }],
        });

        // Heightmap
        this.heightmap = this.device.createTexture({
            label: "heightmap",
            size: [HEIGHTMAP_SIZE, HEIGHTMAP_SIZE],
            format: "rgba16float",
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });

        const heightSampler = this.device.createSampler({
            label: "heightmap sampler",
            magFilter: "linear",
            minFilter: "linear",
        });

        this.terrainBindGroup = this.device.createBindGroup({
            label: "terrain bind group",
            layout: terrainLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.heightmap.createView(),
                },
                {
                    binding: 1,
                    resource: heightSampler,
                },
            ],
        });

        this.bakeTerrain();

        // Resizing
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

    private bakeTerrain(): void {
        const module = this.device.createShaderModule({
            label: "terrain bake shader",
            code: noiseSrc + terrainBakeSrc,
        });

        const pipeline = this.device.createComputePipeline({
            label: "terrain bake pipeline",
            layout: "auto",
            compute: {
                module,
                entryPoint: "cs_main",
                constants: { TERRAIN_SIZE },
            },
        });

        const bindGroup = this.device.createBindGroup({
            label: "terrain bake bind group",
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: this.heightmap.createView() }],
        });

        const encoder = this.device.createCommandEncoder({
            label: "terrain bake"
        });
        const pass = encoder.beginComputePass({
            label: "terrain bake pass",
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);

        // Workgroup size is set to 8, 8 right now
        const workgroups = Math.ceil(HEIGHTMAP_SIZE / 8);
        pass.dispatchWorkgroups(workgroups, workgroups);
        pass.end();

        this.device.queue.submit([encoder.finish()]);
    }

    private resize(): void {
        const dpr = Math.min(window.devicePixelRatio, 1.5);
        const maxSize = this.device.limits.maxTextureDimension2D;

        const width = Math.floor(this.canvas.clientWidth * dpr);
        const height = Math.floor(this.canvas.clientHeight * dpr);

        this.canvas.width = Math.max(1, Math.min(width, maxSize));
        this.canvas.height = Math.max(1, Math.min(height, maxSize));
    }

    private ensureDepthTexture(): GPUTexture {
        const { width, height } = this.canvas;
        if (!this.depthTexture ||
            this.depthTexture.width !== width ||
            this.depthTexture.height !== height) {
            this.depthTexture?.destroy();
            this.depthTexture = this.device.createTexture({
                label: "depth",
                size: [width, height],
                format: DEPTH_FORMAT,
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            });
        }
        return this.depthTexture;
    }

    private updateFrameUniforms(t: number): void {
        const aspect = this.canvas.width / this.canvas.height;
        const proj = mat4.perspective((50 * Math.PI) / 180, aspect, 0.1, 300);

        // Rotate around the peak
        const angle = t * 0.05;
        const eye = [Math.sin(angle) * 32, 14, Math.cos(angle) * 32];
        const view = mat4.lookAt(eye, [0, 8, 0], [0, 1, 0]);
        const viewProj = mat4.multiply(proj, view);

        this.frameData.set(viewProj, 0);
        this.frameData.set(eye, 16);
        this.frameData[19] = t;
        this.frameData.set([0.5, 0.6, 0.3], 20);
        this.frameData[24] = this.canvas.width;
        this.frameData[25] = this.canvas.height;

        this.device.queue.writeBuffer(this.frameBuffer, 0, this.frameData);
    }

    private render(timeSeconds: number): void {
        this.updateFrameUniforms(timeSeconds);
        const depth = this.ensureDepthTexture();

        const encoder = this.device.createCommandEncoder({ label: "frame" });
        const pass = encoder.beginRenderPass({
            label: "main pass",
            colorAttachments: [
                {
                    view: this.context.getCurrentTexture().createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
            depthStencilAttachment: {
                view: depth.createView(),
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "discard",
            },
        });

        pass.setBindGroup(0, this.frameBindGroup);

        pass.setPipeline(this.skyPipeline);
        pass.draw(3);

        pass.setPipeline(this.terrainPipeline);
        pass.setBindGroup(1, this.terrainBindGroup);
        pass.draw(TERRAIN_GRID * TERRAIN_GRID * 6);

        pass.end();

        this.device.queue.submit([encoder.finish()]);
    }
}