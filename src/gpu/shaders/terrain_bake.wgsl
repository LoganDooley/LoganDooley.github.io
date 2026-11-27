override TERRAIN_SIZE: f32;

@group(0) @binding(0) var heightmap: texture_storage_2d<rgba16float, write>;

struct TerrainLayout {
    seed: vec4f,
};

@group(0) @binding(1) var<uniform> terrainLayout: TerrainLayout;

const FREQUENCY = 0.02;
const WARP = 0.6;
const AMPLITUDE = 30.0;

// Returns vec3 of (height, dh/dx, dh/dz)
fn terrain(p: vec2f) -> vec3f {
    let s = p * FREQUENCY + terrainLayout.seed.xy;

    // Domain warping
    let wx = fbm2(s + vec2f(17.3, 4.1));
    let wz = fbm2(s + vec2f(-8.7, 31.9));
    let q = s + WARP * vec2f(wx.x, wz.x);

    // Ridged noise
    let r = ridgedFbm2(q);

    let gradS = r.yz + WARP * (r.y * wx.yz + r.z * wz.yz);

    return vec3f(AMPLITUDE * r.x, AMPLITUDE * FREQUENCY * gradS);
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