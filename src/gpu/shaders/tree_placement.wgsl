override TERRAIN_SIZE: f32;
override CANDIDATES: u32;

struct Tree {
    position: vec3f,
    scale: f32,
};

struct DrawArgs {
    vertexCount: u32,
    instanceCount: atomic<u32>,
    firstVertex: u32,
    firstInstance: u32,
};

@group(0) @binding(0) var heightmap: texture_2d<f32>;
@group(0) @binding(1) var heightSampler: sampler;
@group(0) @binding(2) var<storage, read_write> trees: array<Tree>;
@group(0) @binding(3) var<storage, read_write> drawArgs: DrawArgs;
@group(0) @binding(4) var trailMask: texture_2d<f32>;

const TREELINE = 100.0;
const TREELINE_WOBBLE = 3.0;
const MAX_SLOPE = 100.0;
const DENSITY = 0.55;

fn sampleTerrain(xz: vec2f) -> vec4f {
    let uv = xz / TERRAIN_SIZE + 0.5;
    return textureSampleLevel(heightmap, heightSampler, uv, 0.0);
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= CANDIDATES || id.y >= CANDIDATES) {
        return;
    }

    let cell = vec2f(id.xy);
    let jitter = vec2f(hash2(cell), hash2(cell + vec2f(31.7, 17.3)));
    let uv = (cell + jitter) / f32(CANDIDATES);
    let xz = (uv - 0.5) * TERRAIN_SIZE;

    let t = sampleTerrain(xz);
    let height = t.x;
    let slope = length(t.yz);

    // Nothing on steep slopes
    if (slope > MAX_SLOPE) {
        return;
    }

    // Nothing above the treeline
    let treeline = TREELINE + TREELINE_WOBBLE * fbm2(xz * 0.05).x;
    if (height > treeline) {
        return;
    }
    let belowTreeline = 1.0 - smoothstep(treeline - 4.0, treeline, height);

    // Clumps + clearings
    let clumps = fbm2(xz * 0.03 + vec2f(50.0)).x;
    let keepChance = (DENSITY + clumps) * belowTreeline;
    if (hash2(cell + vec2f(7.1, 91.3)) > keepChance) {
        return;
    }

    // Runs are clear of trees
    let clearing = textureSampleLevel(trailMask, heightSampler, uv, 0.0).y;
    if (clearing > 0.01) {
        return;
    }

    let index = atomicAdd(&drawArgs.instanceCount, 1u);
    let scale = 0.8 + 0.5 * hash2(cell + vec2f(3.3, 44.4));
    trees[index] = Tree(vec3f(xz.x, height - 0.05, xz.y), scale);
}