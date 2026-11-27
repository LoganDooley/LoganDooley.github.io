export const LAYOUT = {
    seed: { x: 0, y: 0},
};

export function packLayout(): Float32Array {
    const { seed } = LAYOUT;
    return new Float32Array([
        seed.x, seed.y, 0, 0
    ]);
}