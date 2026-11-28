struct Tree {
    position: vec3f,
    scale: f32,
};

struct PlacedArgs {
    vertexCount: u32,
    instanceCount: u32,
    firstVertex: u32,
    firstInstance: u32,
};

struct VisibleArgs {
    vertexCount: u32,
    instanceCount: atomic<u32>,
    firstVertex: u32,
    firstInstance: u32,
};

struct CullParams {
    planes: array<vec4f, 6>,
    cameraPos: vec3f,
    maxDistance: f32,
    nearDistance: f32,
};

@group(0) @binding(0) var<storage, read> trees: array<Tree>;
@group(0) @binding(1) var<storage, read> placed: PlacedArgs;
@group(0) @binding(2) var<storage, read_write> visible: array<Tree>;
@group(0) @binding(3) var<storage, read_write> visibleArgs: array<VisibleArgs, 2>; // 0 is cones, 1 is impostors
@group(0) @binding(4) var<uniform> params: CullParams;
@group(0) @binding(5) var<storage, read_write> visibleImpostors: array<Tree>;

const BOUND_CENTER_HEIGHT = 0.25;
const BOUND_RADIUS = 0.35;

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x;
    if (i >= placed.instanceCount) {
        return;
    }

    let tree = trees[i];
    let center = tree.position + vec3f(0.0, BOUND_CENTER_HEIGHT * tree.scale, 0.0);
    let radius = BOUND_RADIUS * tree.scale;

    let d = distance(center, params.cameraPos);
    if (d > params.maxDistance) {
        return;
    }

    for (var p = 0; p < 6; p++) {
        let plane = params.planes[p];
        if (dot(plane.xyz, center) + plane.w < -radius) {
            return;
        }
    }

    if (d < params.nearDistance) {
        let slot = atomicAdd(&visibleArgs[0].instanceCount, 1u);
        visible[slot] = tree;
    } else {
        let slot = atomicAdd(&visibleArgs[1].instanceCount, 1u);
        visibleImpostors[slot] = tree;
    }
}