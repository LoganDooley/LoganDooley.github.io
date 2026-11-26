fn hash2(p: vec2f) -> f32 {
    let h = dot(p, vec2f(127.1, 311.7));
    return fract(sin(h) * 43758.5453);
}

fn randomGradient(cell: vec2f) -> vec2f {
    let angle = 6.2831853 * hash2(cell);
    return vec2f(cos(angle), sin(angle));
}

// Gradient noise. Returns vec3 of (value, d/dx, d/dy)
fn noise2d(p: vec2f) -> vec3f {
    let i = floor(p);
    let f = fract(p);

    // Quintic curve and derivative
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let du = 30 * f * f * (f * (f - 2.0) + 1.0);

    // Corner gradients
    let ga = randomGradient(i);
    let gb = randomGradient(i + vec2f(1.0, 0.0));
    let gc = randomGradient(i + vec2f(0.0, 1.0));
    let gd = randomGradient(i + vec2f(1.0, 1.0));

    let va = dot(ga, f);
    let vb = dot(gb, f - vec2f(1.0, 0.0));
    let vc = dot(gc, f - vec2f(0.0, 1.0));
    let vd = dot(gd, f - vec2f(1.0, 1.0));

    let k1 = vb - va;
    let k2 = vc - va;
    let k3 = va - vb - vc + vd;

    let value = va + k1 * u.x + k2 * u.y + k3 * u.x * u.y;

    let grad = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * vec2f(k1 + k3 * u.y, k2 + k3 * u.x);

    return vec3f(value, grad);
}

const OCTAVE_ROTATION = mat2x2f(0.8, 0.6, -0.6, 0.8);

// Returns vec3 of (value, d/dx, d/dy)
fn fbm2(p: vec2f) -> vec3f {
    var sum = vec3f(0.0);
    var amp = 0.5;
    var m = mat2x2f(1.0, 0.0, 0.0, 1.0);

    for (var o = 0; o < 6; o++) {
        let n = noise2d(m * p);
        sum += amp * vec3f(n.x, transpose(m) * n.yz);
        m = 2.0 * OCTAVE_ROTATION * m;
        amp *= 0.5;
    }
    return sum;
}