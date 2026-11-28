struct Tree {
    position: vec3f,
    scale: f32,
};

@group(1) @binding(0) var<storage, read> trees: array<Tree>;

const TREE_HEIGHT = 0.5;
const TREE_RADIUS = 0.15;

struct VsOut {
    @builtin(position) position: vec4f,
    @location(0) worldPos: vec3f,
    @location(1) across: f32,
    @location(2) up: f32,
    @location(3) forward: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
    let tree = trees[ii];

    let forward = normalize(frame.cameraPos.xz - tree.position.xz);
    let side = vec2f(-forward.y, forward.x);

    var across = 0.0;
    var up = 1.0;
    if (vi == 1u) {
        across = -1.0;
        up = 0.0;
    } else if (vi == 2u) {
        across = 1.0;
        up = 0.0;
    }

    let offset = side * across * TREE_RADIUS;
    let world = tree.position + vec3f(offset.x, up * TREE_HEIGHT, offset.y) * tree.scale;

    var out: VsOut;
    out.position = frame.viewProj * vec4f(world, 1.0);
    out.worldPos = world;
    out.across = across;
    out.up = up;
    out.forward = forward;
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
    let u = clamp(in.across / max(1.0 - in.up, 0.001), -1.0, 1.0);

    let angle = u * 1.5707963;
    let side = vec2f(-in.forward.y, in.forward.x);
    let around = side * sin(angle) + in.forward * cos(angle);

    let n = normalize(vec3f(around.x * TREE_HEIGHT, TREE_RADIUS, around.y * TREE_HEIGHT));
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