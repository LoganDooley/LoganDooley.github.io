struct Tree {
    position: vec3f,
    scale: f32,
};

@group(1) @binding(0) var<storage, read> trees: array<Tree>;

const SEGMENTS = 8u;
const TREE_HEIGHT = 0.5;
const TREE_RADIUS = 0.15;

struct VsOut {
    @builtin(position) position: vec4f,
    @location(0) worldPos: vec3f,
    @location(1) normal: vec3f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
    let tree = trees[ii];

    // 1 tri per side
    let side = vi / 3u;
    let corner = vi % 3u;

    let angleStep = 6.2831853 / f32(SEGMENTS);
    let a0 = f32(side) * angleStep;
    let a1 = a0 + angleStep;
    let mid = a0 + 0.5 * angleStep;

    var local: vec3f;
    if (corner == 0u) {
        local = vec3f(0.0, TREE_HEIGHT, 0.0);
    } else if (corner == 1u) {
        local = vec3f(cos(a0) * TREE_RADIUS, 0.0, sin(a0) * TREE_RADIUS);
    } else {
        local = vec3f(cos(a1) * TREE_RADIUS, 0.0, sin(a1) * TREE_RADIUS);
    }

    let world = tree.position + local * tree.scale;

    var out: VsOut;
    out.position = frame.viewProj * vec4f(world, 1.0);
    out.worldPos = world;
    out.normal = normalize(vec3f(cos(mid) * TREE_HEIGHT, TREE_RADIUS, sin(mid) * TREE_HEIGHT));
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
    let n = normalize(in.normal);
    let sun = normalize(frame.sunDir);

    let green = vec3f(0.10, 0.22, 0.12);
    let diffuse = max(dot(n, sun), 0.0);
    let sunColor = vec3f(1.0, 0.95, 0.85) * 0.8;
    let ambient = vec3f(0.30, 0.36, 0.48);
    var color = green * (diffuse * sunColor + ambient);

    let dist = length(in.worldPos - frame.cameraPos);
    let fog = 1.0 - exp(-dist * frame.fogDensity);
    color = mix(color, SKY_HORIZON, fog);

    return vec4f(color, 1.0);
}