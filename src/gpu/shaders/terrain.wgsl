override GRID: u32;
override TERRAIN_SIZE: f32;

const ROCK_EDGE = 0.45;
const BREAKUP = 0.12;
const MIN_SOFTNESS = 0.03;

@group(1) @binding(0) var heightmap: texture_2d<f32>;
@group(1) @binding(1) var heightSampler: sampler;
@group(1) @binding(2) var trailMask: texture_2d<f32>;

// Returns vec4 of (height, dh/dx, dh/dz, _)
fn sampleTerrain(xz: vec2f) -> vec4f {
    let uv = xz / TERRAIN_SIZE + 0.5;
    return textureSampleLevel(heightmap, heightSampler, uv, 0.0);
}

fn normalFromGradient(g: vec2f) -> vec3f {
    return normalize(vec3f(-g.x, 1.0, -g.y));
}

struct VsOut {
    @builtin(position) position: vec4f,
    @location(0) worldPos: vec3f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
    let pointsPerRow = GRID + 1u;
    let cell = vec2u(vi % pointsPerRow, vi / pointsPerRow);
    let xz = (vec2f(cell) / f32(GRID) - 0.5) * TERRAIN_SIZE;

    let height = sampleTerrain(xz).x;
    let world = vec3f(xz.x, height, xz.y);

    var out: VsOut;
    out.position = frame.viewProj * vec4f(world, 1.0);
    out.worldPos = world;
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
    let n = normalFromGradient(sampleTerrain(in.worldPos.xz).yz);
    let sun = normalize(frame.sunDir);

    let snow = vec3f(0.95, 0.97, 1.0);
    let rock = vec3f(0.35, 0.33, 0.32);
    let slope = 1.0 - n.y;
    let xz = in.worldPos.xz;
    let breakup = 0.6 * noise2d(xz * 0.4).x + 0.4 * noise2d(xz * 1.3 + vec2f(17.0, 9.0)).x;
    let rockiness = slope + BREAKUP * breakup;

    let width = max(fwidth(rockiness), MIN_SOFTNESS);
    let rockAmount = smoothstep(ROCK_EDGE - width, ROCK_EDGE + width, rockiness);
    let albedo = mix(snow, rock, rockAmount);

    let trailUv = in.worldPos.xz / TERRAIN_SIZE + 0.5;
    let run = textureSampleLevel(trailMask, heightSampler, trailUv, 0.0).x;
    let groomed = vec3f(0.98, 0.99, 1.0);
    let surface = mix(albedo, groomed, run);

    let diffuse = max(dot(n, sun), 0.0);
    let sunColor = vec3f(1.0, 0.95, 0.85) * 0.8;
    let ambient = vec3f(0.30, 0.36, 0.48);
    var color = surface * (diffuse * sunColor + ambient);

    // Distance based fog
    let dist = length(in.worldPos - frame.cameraPos);
    let fog = 1.0 - exp(-dist * frame.fogDensity);
    color = mix(color, SKY_HORIZON, fog);

    return vec4f(color, 1.0);
}