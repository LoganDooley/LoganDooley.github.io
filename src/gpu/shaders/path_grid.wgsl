override TERRAIN_SIZE: f32;
override GRID: u32;

@group(0) @binding(0) var heightmap: texture_2d<f32>;
@group(0) @binding(1) var heightSampler: sampler;
@group(0) @binding(2) var<storage, read_write> heights: array<f32>;

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= GRID || id.y >= GRID) {
        return;
    }

    let uv = (vec2f(id.xy) + 0.5) / f32(GRID);
    heights[id.y * GRID + id.x] = textureSampleLevel(heightmap, heightSampler, uv, 0.0).x;
}