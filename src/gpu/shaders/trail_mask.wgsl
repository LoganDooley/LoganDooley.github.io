override TERRAIN_SIZE: f32;

@group(0) @binding(0) var trailMask: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var<storage, read> segments: array<vec4f>;

const RUN_HALF_WIDTH = 0.7;
const CLEARING_MARGIN = 0.3;
const EDGE = 0.2;

fn distanceToSegment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
    let ab = b - a;
    let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return length(p - (a + t * ab));
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id: vec3u) {
    let size = textureDimensions(trailMask);
    if (id.x >= size.x || id.y >= size.y) {
        return;
    }

    let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
    let p = (uv - 0.5) * TERRAIN_SIZE;

    var d = 1e9;
    for (var i = 0u; i < arrayLength(&segments); i++) {
        let s = segments[i];
        d = min(d, distanceToSegment(p, s.xy, s.zw));
    }

    let clearingHalfWidth = RUN_HALF_WIDTH + CLEARING_MARGIN;
    let run = 1.0 - smoothstep(RUN_HALF_WIDTH - EDGE, RUN_HALF_WIDTH, d);
    let clearing = 1.0 - smoothstep(clearingHalfWidth - EDGE, clearingHalfWidth, d);

    textureStore(trailMask, id.xy, vec4f(run, clearing, 0.0, 1.0));
}