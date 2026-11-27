import { mat4 } from "wgpu-matrix"
import { LAYOUT, packLayout } from "./layout"
import type { GpuContext} from "./device";
import { planTrails, trailSegments, type HeightGrid, type Trail } from "./trails";
import { OrbitCamera} from "./orbitCamera";
import { GpuTimer } from "./gpuTimer";

import commonSrc from "./shaders/common.wgsl?raw";
import skySrc from "./shaders/sky.wgsl?raw";
import terrainSrc from "./shaders/terrain.wgsl?raw";
import noiseSrc from "./shaders/noise.wgsl?raw";
import terrainBakeSrc from "./shaders/terrain_bake.wgsl?raw";
import treePlacementSrc from "./shaders/tree_placement.wgsl?raw";
import treesSrc from "./shaders/trees.wgsl?raw";
import pathGridSrc from "./shaders/path_grid.wgsl?raw";
import trailMaskSrc from "./shaders/trail_mask.wgsl?raw";

const TERRAIN_GRID = 512;
const DEPTH_FORMAT: GPUTextureFormat = "depth24plus";
const TERRAIN_SIZE = 120;
const HEIGHTMAP_SIZE = 2048;

const TREE_CANDIDATES = 512;
const MAX_TREES = TREE_CANDIDATES * TREE_CANDIDATES;
const TREE_VERTICES = 8 * 3;

const PATH_GRID = 256;

const TRAIL_MASK_SIZE = 1024;

export class Scene {
    private device: GPUDevice;
    private canvas: HTMLCanvasElement;
    private context: GPUCanvasContext;
    private format: GPUTextureFormat;

    private skyPipeline: GPURenderPipeline;
    private terrainPipeline: GPURenderPipeline;
    private treePipeline: GPURenderPipeline;

    private treeBuffer: GPUBuffer;
    private treeBindGroup: GPUBindGroup;
    private drawArgsBuffer: GPUBuffer;

    private frameBuffer: GPUBuffer;
    private frameBindGroup: GPUBindGroup;
    private frameData = new Float32Array(28);

    private depthTexture: GPUTexture | null = null;

    private heightmap: GPUTexture;
    private heightSampler: GPUSampler;
    private terrainBindGroup: GPUBindGroup;

    private frameId: number | null = null;

    private trails: Trail[] = [];
    private generating = false;
    private trailMask: GPUTexture;

    private cameraMode: "default" | "topDown" | "orbit" = "default";
    private orbit = new OrbitCamera();
    private defaultView = { eye: [0, 20, 48], target: [0, 12, -10] };

    private timer: GpuTimer | null = null;
    private timingPanel: HTMLElement | null = null;
    private lastPanelUpdate = 0;

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
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "float" },
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
            code: commonSrc + noiseSrc + terrainSrc,
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

        // Trees
        const treeLayout = this.device.createBindGroupLayout({
            label: "tree layout",
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "read-only-storage" },
                },
            ],
        });
        const treePipelineLayout = this.device.createPipelineLayout({
            label: "tree pipeline layout",
            bindGroupLayouts: [frameLayout, treeLayout],
        });

        const treeModule = this.device.createShaderModule({
            label: "tree shader",
            code: commonSrc + treesSrc
        });
        this.treePipeline = this.device.createRenderPipeline({
            label: "tree pipeline",
            layout: treePipelineLayout,
            vertex: {
                module: treeModule,
                entryPoint: "vs_main",
            },
            fragment: {
                module: treeModule,
                entryPoint: "fs_main",
                targets: [{ format: this.format}],
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

        this.heightSampler = this.device.createSampler({
            label: "heightmap sampler",
            magFilter: "linear",
            minFilter: "linear",
        });

        this.trailMask = this.device.createTexture({
            label: "trail mask",
            size: [TRAIL_MASK_SIZE, TRAIL_MASK_SIZE],
            format: "rgba8unorm",
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
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
                    resource: this.heightSampler,
                },
                {
                    binding: 2,
                    resource: this.trailMask.createView()
                },
            ],
        });

        this.treeBuffer = this.device.createBuffer({
            label: "trees",
            size: MAX_TREES * 16,
            usage: GPUBufferUsage.STORAGE,
        });

        this.drawArgsBuffer = this.device.createBuffer({
            label: "tree draw args",
            size: 4 * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
        });

        this.treeBindGroup = this.device.createBindGroup({
            label: "tree bind group",
            layout: treeLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.treeBuffer }
                }
            ],
        });

        if (gpu.hasTimestamps) {
            this.timer = new GpuTimer(this.device, ["sky", "terrain", "trees"]);
        }

        void this.generateWorld();

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

    enableDevControls(): void {
        window.addEventListener("keydown", (event) => {
            if (event.key === "n") {
                LAYOUT.seed.x = Math.random() * 1000;
                LAYOUT.seed.y = Math.random() * 1000;
                void this.generateWorld();
                console.log(`seed: { x: ${LAYOUT.seed.x.toFixed(3)}, y: ${LAYOUT.seed.y.toFixed(3)} },`);
            } else if (event.key === "t") {
                this.cameraMode = this.cameraMode === "topDown" ? "default" : "topDown";
            } else if (event.key === "c") {
                if (this.cameraMode !== "orbit") {
                    this.orbit.setFromLookAt(this.defaultView.eye, this.defaultView.target); // start from the default view
                }
                this.cameraMode = this.cameraMode === "orbit" ? "default" : "orbit";
            } else if (event.key === "l") {
                const format = (v: number[]) => `[${v.map((n) => n.toFixed(1)).join(", ")}]`;
                console.log(`camera: { eye: ${format(this.orbit.eye)}, target: ${format(this.orbit.target)} },`);
            }
        });

        this.orbit.attach(() => this.cameraMode === "orbit");

        console.log("Dev controls: N = new seed, T = top-down, C = orbit camera (drag/scroll), L = log camera");
    }

    private async generateWorld(): Promise<void> {
        if (this.generating) {
            return;
        }

        this.generating = true;

        try {
            this.bakeTerrain();
            const grid = await this.readHeightGrid();
            const plan = planTrails(grid);
            this.trails = plan.trails;
            this.defaultView = plan.camera;
            this.buildTrailMask();
            this.placeTrees();
        } finally {
            this.generating = false;
        }
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

        const layoutData = packLayout();
        const layoutBuffer = this.device.createBuffer({
            label: "terrain layout",
            size: layoutData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(layoutBuffer, 0, layoutData);

        const bindGroup = this.device.createBindGroup({
            label: "terrain bake bind group",
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: this.heightmap.createView()
                },
                {
                    binding: 1,
                    resource: { buffer: layoutBuffer}
                },
            ],
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

    private placeTrees(): void {
        const module = this.device.createShaderModule({
            label: "tree placement shader",
            code: noiseSrc + treePlacementSrc,
        });

        const pipeline = this.device.createComputePipeline({
            label: "tree placement pipeline",
            layout: "auto",
            compute: {
                module,
                entryPoint: "cs_main",
                constants: {
                    TERRAIN_SIZE,
                    CANDIDATES: TREE_CANDIDATES,
                },
            },
        });

        const bindGroup = this.device.createBindGroup({
            label: "tree placement bind group",
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: this.heightmap.createView()
                },
                {
                    binding: 1,
                    resource: this.heightSampler
                },
                {
                    binding: 2,
                    resource: { buffer: this.treeBuffer }
                },
                {
                    binding: 3,
                    resource: { buffer: this.drawArgsBuffer }
                },
                {
                    binding: 4,
                    resource: this.trailMask.createView()
                }
            ],
        });

        this.device.queue.writeBuffer(
            this.drawArgsBuffer, 0, new Uint32Array([TREE_VERTICES, 0, 0, 0]),
        );

        const encoder = this.device.createCommandEncoder({
            label: "tree placement encoder",
        });

        const pass = encoder.beginComputePass({
            label: "tree placement pass"
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        const workgroups = Math.ceil(TREE_CANDIDATES / 8);
        pass.dispatchWorkgroups(workgroups, workgroups);
        pass.end();

        this.device.queue.submit([encoder.finish()]);
    }

    private async readHeightGrid(): Promise<HeightGrid> {
        const byteSize = PATH_GRID * PATH_GRID * 4;

        const storage = this.device.createBuffer({
            label: "path grid",
            size: byteSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const readback = this.device.createBuffer({
            label: "path grid readback",
            size: byteSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        const module = this.device.createShaderModule({
            label: "path grid shader",
            code: pathGridSrc
        });
        const pipeline = this.device.createComputePipeline({
            label: "path grid pipeline",
            layout: "auto",
            compute: {
                module, entryPoint: "cs_main",
                constants: { TERRAIN_SIZE, GRID: PATH_GRID}
            },
        });
        const bindGroup = this.device.createBindGroup({
            label: "path grid bind group",
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: this.heightmap.createView()
                },
                {
                    binding: 1,
                    resource: this.heightSampler
                },
                {
                    binding: 2,
                    resource: { buffer: storage }
                },
            ],
        });

        const encoder = this.device.createCommandEncoder({
            label: "path grid encoder",
        });
        const pass = encoder.beginComputePass({
            label: "path grid pass"
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);

        pass.dispatchWorkgroups(Math.ceil(PATH_GRID / 8), Math.ceil(PATH_GRID / 8));
        pass.end();
        encoder.copyBufferToBuffer(storage, 0, readback, 0, byteSize);

        this.device.queue.submit([encoder.finish()]);

        await readback.mapAsync(GPUMapMode.READ);
        const heights = new Float32Array(readback.getMappedRange().slice(0));
        readback.unmap();

        storage.destroy();
        readback.destroy();

        return { size: PATH_GRID, terrainSize: TERRAIN_SIZE, heights };
    }

    private buildTrailMask(): void {
        const data = trailSegments(this.trails);
        const segmentBuffer = this.device.createBuffer({
            label: "trail segments",
            size: data.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.device.queue.writeBuffer(segmentBuffer, 0, data);

        const module = this.device.createShaderModule({
            label: "trail mask shader",
            code: trailMaskSrc
        });
        const pipeline = this.device.createComputePipeline({
            label: "trail mask pipeline",
            layout: "auto",
            compute: {
                module, entryPoint: "cs_main",
                constants: { TERRAIN_SIZE}
            },
        });
        const bindGroup = this.device.createBindGroup({
            label: "trail mask bind group",
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: this.trailMask.createView()
                },
                {
                    binding: 1,
                    resource: { buffer: segmentBuffer }
                },
            ],
        });

        const encoder = this.device.createCommandEncoder({
            label: "trail mask encoder",
        });
        const pass = encoder.beginComputePass({
            label: "trail mask pass"
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        const workgroups = Math.ceil(TRAIL_MASK_SIZE / 8);
        pass.dispatchWorkgroups(workgroups, workgroups);
        pass.end();

        this.device.queue.submit([encoder.finish()]);
    }

    private resize(): void {
        const dpr = Math.min(window.devicePixelRatio, 1.0);
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

        const { eye: viewEye, target: viewTarget } = this.defaultView;
        const fx = viewTarget[0] - viewEye[0];
        const fz = viewTarget[2] - viewEye[2];
        const flat = Math.hypot(fx, fz) || 1;
        const drift = Math.sin(t * 0.1) * 3;

        let eye = [viewEye[0] - (fz / flat) * drift, viewEye[1], viewEye[2] + (fx / flat) * drift];
        let target = viewTarget;
        let up = [0, 1, 0];

        if (this.cameraMode === "topDown") {
            eye = [0, 140, 0];
            target = [0, 0, 0];
            up = [0, 0, -1];
        } else if (this.cameraMode === "orbit") {
            eye = this.orbit.eye;
            target = this.orbit.target;
        }

        const view = mat4.lookAt(eye, target, up);
        const viewProj = mat4.multiply(proj, view);

        this.frameData.set(viewProj, 0);
        this.frameData.set(eye, 16);
        this.frameData[19] = t;
        this.frameData.set([0.5, 0.6, 0.3], 20);
        this.frameData[23] = this.cameraMode === "topDown" ? 0 : 0.01;
        this.frameData[24] = this.canvas.width;
        this.frameData[25] = this.canvas.height;

        this.device.queue.writeBuffer(this.frameBuffer, 0, this.frameData);
    }

    private render(timeSeconds: number): void {
        this.updateFrameUniforms(timeSeconds);
        const depth = this.ensureDepthTexture();

        const encoder = this.device.createCommandEncoder({ label: "frame" });
        const colorView = this.context.getCurrentTexture().createView();
        const depthView = depth.createView();

        const beginPass = (name: string, index: number, clear: boolean) =>
            encoder.beginRenderPass({
                label: `${name} pass`,
                colorAttachments: [
                    {
                        view: colorView,
                        clearValue: { r: 0, g: 0, b: 0, a: 1 },
                        loadOp: clear ? "clear" : "load",
                        storeOp: "store",
                    },
                ],
                depthStencilAttachment: {
                    view: depthView,
                    depthClearValue: 1.0,
                    depthLoadOp: clear ? "clear" : "load",
                    depthStoreOp: "store",
                },
                timestampWrites: this.timer?.passWrites(index),
            });

        let pass = beginPass("sky", 0, true);
        pass.setBindGroup(0, this.frameBindGroup);
        pass.setPipeline(this.skyPipeline);
        pass.draw(3);
        pass.end();

        pass = beginPass("terrain", 1, false);
        pass.setBindGroup(0, this.frameBindGroup);
        pass.setPipeline(this.terrainPipeline);
        pass.setBindGroup(1, this.terrainBindGroup);
        pass.draw(TERRAIN_GRID * TERRAIN_GRID * 6);
        pass.end();

        pass = beginPass("trees", 2, false);
        pass.setBindGroup(0, this.frameBindGroup);
        pass.setPipeline(this.treePipeline);
        pass.setBindGroup(1, this.treeBindGroup);
        pass.drawIndirect(this.drawArgsBuffer, 0);
        pass.end();

        this.timer?.resolve(encoder);
        this.device.queue.submit([encoder.finish()]);
        this.timer?.read();
        this.updateTimingPanel(timeSeconds);
    }

    showTimings(): void {
        if (!this.timer) {
            console.log("GPU timings unavailable. Timestamp queries not supported.");
            return;
        }
        const panel = document.createElement("pre");
        panel.className = "panel gpu-timings";
        document.body.appendChild(panel);
        this.timingPanel = panel;
    }

    private updateTimingPanel(t: number): void {
        if (!this.timer || !this.timingPanel || t - this.lastPanelUpdate < 0.25) {
            return;
        }
        this.lastPanelUpdate = t;

        const rows = this.timer.results();
        const total = rows.reduce((sum, r) => sum + r.ms, 0);
        this.timingPanel.textContent = [
            "GPU frame time",
            ...rows.map((r) => `${r.name.padEnd(8)} ${r.ms.toFixed(2)} ms`),
            `${"total".padEnd(8)} ${total.toFixed(2)} ms`,
        ].join("\n");
    }
}