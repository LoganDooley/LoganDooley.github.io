override TERRAIN_SIZE: f32;

@group(0) @binding(0) var heightmap: texture_storage_2d<rgba16float, write>;

// Returns vec3 of (height, dh/dx, dh/dz)
fn terrain(p: vec2f) -> vec3f {
    let peak = 18.0 * exp(-dot(p, p) / 400.0);
    let peakGrad = peak * (-p / 200.0);

    let freq = 0.06;
    let n = fbm2(p * freq);
    let detail = 7.0 * n.x;
    let detailGrad = 7.0 * freq * n.yz;

    return vec3f(peak + detail, peakGrad + detailGrad);
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id: vec3u) {
    let size = textureDimensions(heightmap);
    if (id.x >= size.x || id.y >= size.y) {
        return;
    }

    let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
    let p = (uv - 0.5) * TERRAIN_SIZE;

    textureStore(heightmap, id.xy, vec4f(terrain(p), 0.0));
}