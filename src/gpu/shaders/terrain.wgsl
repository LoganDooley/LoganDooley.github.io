override GRID: u32;
override TERRAIN_SIZE: f32;

@group(1) @binding(0) var heightmap: texture_2d<f32>;
@group(1) @binding(1) var heightSampler: sampler;

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
    // 6 verts per quad
    let quad = vi / 6u;
    let corner = vi % 6u;

    var offsets = array<vec2u, 6>(
        vec2u(0u, 0u), vec2u(1u, 0u), vec2u(0u, 1u),
        vec2u(0u, 1u), vec2u(1u, 0u), vec2u(1u, 1u),
    );

    let cell = vec2u(quad % GRID, quad / GRID) + offsets[corner];
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
    let albedo = mix(snow, rock, smoothstep(0.35, 0.6, slope));

    let diffuse = max(dot(n, sun), 0.0);
    let sunColor = vec3f(1.0, 0.95, 0.85) * 0.8;
    let ambient = vec3f(0.30, 0.36, 0.48);
    var color = albedo * (diffuse * sunColor + ambient);

    // Distance based fog
    let dist = length(in.worldPos - frame.cameraPos);
    let fog = 1.0 - exp(-dist * 0.025);
    color = mix(color, SKY_HORIZON, fog);

    return vec4f(color, 1.0);
}