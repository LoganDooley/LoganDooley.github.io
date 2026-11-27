struct Frame {
    viewProj: mat4x4f,
    cameraPos: vec3f,
    time: f32,
    sunDir: vec3f,
    fogDensity: f32,
    resolution: vec2f,
    _pad1: vec2f
};

@group(0) @binding(0) var<uniform> frame: Frame;

const SKY_HORIZON = vec3f(0.85, 0.90, 0.95);
const SKY_TOP = vec3f(0.30, 0.45, 0.70);