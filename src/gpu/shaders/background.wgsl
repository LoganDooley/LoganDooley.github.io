struct Uniforms {
    resolution: vec2f,
    time: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VsOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VsOut {
    // Cover the whole screen with a triangle
    let pos = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;

    var out: VsOut;
    out.position = vec4f(pos, 0.0, 1.0);
    out.uv = pos * 0.5 + 0.5;
    return out;
}

fn hash(x: f32) -> f32 {
    return fract(sin(x * 127.1) * 43758.5453);
}

fn noise(x: f32) -> f32 {
     let i = floor(x);
     let f = fract(x);
     let t = f * f * (3.0 - 2.0 * f); // smoothstep
     return mix(hash(i), hash(i + 1.0), t);
}

fn fbm(x: f32) -> f32 {
    var sum = 0.0;
    var amp = 0.5;
    var freq = 1.0;
    for (var o = 0; o < 5; o++) {
        sum += amp * noise(x * freq);
        freq *= 2.0;
        amp *= 0.5;
    }

    return sum;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
    let aspect = u.resolution.x / u.resolution.y;
    let x = in.uv.x * aspect;

    let skyHorizon = vec3f(0.85, 0.90, 0.95);
    let skyTop = vec3f(0.30, 0.45, 0.70);
    var color = mix(skyHorizon, skyTop, in.uv.y);

    // Far mountains
    let farHeight = 0.45 + 0.25 * fbm(x * 1.5 + 10.0);
    if (in.uv.y < farHeight) {
        color = vec3f(0.62, 0.70, 0.80);
    }

    // Near mountains
    let nearHeight = 0.25 + 0.35 * fbm(x * 2.5 + u.time * 0.05);
    if (in.uv.y < nearHeight) {
        color = vec3f(0.92, 0.95, 0.98);
    }

    return vec4f(color, 1.0);
}