export interface HeightGrid {
    size: number;
    terrainSize: number;
    heights: Float32Array;
}

export type Point = [number, number];

export interface SlopeRange {
    min: number;
    max: number;
}

export const DIFFICULTY = {
    green: { min: 0.05, max: 0.27 },
    blue: { min: 0.15, max: 0.47 },
    black: { min: 0.3, max: 0.7 }
};

export type Difficulty = keyof typeof DIFFICULTY;

export interface Trail {
    difficulty: Difficulty;
    points: Point[];
}

const NEIGHBOURS: [number, number][] = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
];

const SLOPE_PENALTY = 100;
const AVOID_RADIUS = 6;
const AVOID_PENALTY = 4;
const MERGE_RADIUS = 8;

export function cellToWorld(grid: HeightGrid, index: number): Point {
    const x = index % grid.size;
    const z = Math.floor(index / grid.size);
    return [
        ((x + 0.5) / grid.size - 0.5) * grid.terrainSize,
        ((z + 0.5) / grid.size - 0.5) * grid.terrainSize,
    ];
}

export function findSummits(grid: HeightGrid, count: number, minSeparation: number): number[] {
    const { size, heights } = grid;
    const margin = Math.floor(size * 0.1);

    const peaks: number[] = [];
    for (let z = margin; z < size - margin; z++) {
        for (let x = margin; x < size - margin; x++) {
            let i = z * size + x;
            let isPeak = true;
            for (const [dx, dz] of NEIGHBOURS) {
                if (heights[(z + dz) * size + (x + dx)] > heights[i]) {
                    isPeak = false;
                    break;
                }
            }
            if (isPeak) {
                peaks.push(i);
            }
        }
    }

    peaks.sort((a, b) => heights[b] - heights[a]);

    const chosen: number[] = [];
    for (const candidate of peaks) {
        const [cx, cz] = cellToWorld(grid, candidate);
        const farEnough = chosen.every((s) => {
            const [sx, sz] = cellToWorld(grid, s);
            return Math.hypot(cx - sx, cz - sz) >= minSeparation;
        });
        if (farEnough) {
            chosen.push(candidate);
        }
        if (chosen.length === count) {
            break;
        }
    }
    return chosen;
}

export function findBase(grid: HeightGrid): number {
    const { size, heights } = grid;
    const margin = Math.floor(size * 0.1);
    let best = -1;
    for (let z = Math.floor(size * 0.6); z < size - margin; z++) {
        for (let x = margin; x < size - margin; x++) {
            const i = z * size + x;
            if (best < 0 || heights[i] < heights[best]) {
                best = i;
            }
        }
    }
    return best;
}

// A* code
class MinHeap {
    private nodes: number[] = [];
    private priorities: number[] = [];

    get size(): number {
        return this.nodes.length;
    }

    push(node: number, priority: number): void {
        this.nodes.push(node);
        this.priorities.push(priority);
        let i = this.nodes.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.priorities[parent] <= this.priorities[i]) {
                break;
            }
            this.swap(i, parent);
            i = parent;
        }
    }

    pop(): number {
        const top = this.nodes[0];
        const last = this.nodes.length - 1;
        this.swap(0, last);
        this.nodes.pop();
        this.priorities.pop();

        let i = 0;
        while (true) {
            const left = 2 * i + 1;
            const right = left + 1;
            let smallest = i;
            if (left < this.nodes.length && this.priorities[left] < this.priorities[smallest]) {
                smallest = left;
            }
            if (right < this.nodes.length && this.priorities[right] < this.priorities[smallest]) {
                smallest = right;
            }
            if (smallest === i) {
                break;
            }
            this.swap(i, smallest);
            i = smallest;
        }
        return top;
    }

    private swap(a: number, b: number): void {
        [this.nodes[a], this.nodes[b]] = [this.nodes[b], this.nodes[a]];
        [this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]];
    }
}

function stepCost(grid: HeightGrid, from: number, to: number, stepLength: number, range: SlopeRange, avoid: Float32Array,): number {
    const run = stepLength * (grid.terrainSize / grid.size);
    const drop = grid.heights[from] - grid.heights[to];
    const slope = drop / run;

    let excess = 0;
    if (slope < range.min) {
        excess = range.min - slope;
    } else if (slope > range.max) {
        excess = slope - range.max;
    }
    return run * (1 + SLOPE_PENALTY * excess * excess + AVOID_PENALTY * avoid[to]);
}

export function findPath(grid: HeightGrid, start: number, goal: number, range: SlopeRange, avoid: Float32Array,): number[] | null {
    const { size } = grid;
    const cellSize = grid.terrainSize / size;
    const [goalX, goalZ] = [goal % size, Math.floor(goal / size)];

    const heuristic = (i: number) => Math.hypot((i % size) - goalX, Math.floor(i / size) - goalZ) * cellSize;

    const cost = new Float64Array(size * size).fill(Infinity);
    const cameFrom = new Int32Array(size * size).fill(-1);
    const closed = new Uint8Array(size * size);
    const open = new MinHeap();

    cost[start] = 0;
    open.push(start, heuristic(start));

    while (open.size > 0) {
        const current = open.pop();
        if (current === goal) {
            const path = [current];
            while (cameFrom[path[path.length - 1]] !== -1) {
                path.push(cameFrom[path[path.length - 1]]);
            }
            return path.reverse();
        }
        if (closed[current]) {
            continue;
        }
        closed[current] = 1;

        const cx = current % size;
        const cz = Math.floor(current / size);
        for (const [dx, dz] of NEIGHBOURS) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= size || nz >= size) {
                continue;
            }
            const next = nz * size + nx;
            if (closed[next]) {
                continue;
            }
            const stepLength = dx !== 0 && dz !== 0 ? Math.SQRT2 : 1;
            const newCost = cost[current] + stepCost(grid, current, next, stepLength, range, avoid);
            if (newCost < cost[next]) {
                cost[next] = newCost;
                cameFrom[next] = current;
                open.push(next, newCost + heuristic(next));
            }
        }
    }

    return null;
}

// Path smoothing
function distanceToSegment(p: Point, a: Point, b: Point): number {
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const lengthSq = abx * abx + abz * abz;
    let t = lengthSq > 0 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / lengthSq : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * abz));
}

export function simplify(points: Point[], tolerance: number): Point[] {
    if (points.length < 3) {
        return points;
    }
    const first = points[0];
    const last = points[points.length - 1];

    let farthest = 0;
    let farthestDistance = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const d = distanceToSegment(points[i], first, last);
        if (d > farthestDistance) {
            farthestDistance = d;
            farthest = i;
        }
    }

    if (farthestDistance <= tolerance) {
        return [first, last];
    }

    const left = simplify(points.slice(0, farthest + 1), tolerance);
    const right = simplify(points.slice(farthest), tolerance);
    return [...left.slice(0, -1), ...right];
}

function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
    const t2 = t * t;
    const t3 = t2 * t;
    const blend = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    return [blend(p0[0], p1[0], p2[0], p3[0]), blend(p0[1], p1[1], p2[1], p3[1])];
}

export function smoothPath(points: Point[], tolerance: number, spacing: number): Point[] {
    const control = simplify(points, tolerance);
    if (control.length < 2) {
        return control;
    }

    const padded = [control[0], ...control, control[control.length - 1]];

    const result: Point[] = [];
    for (let i = 1; i < padded.length - 2; i++) {
        const [p0, p1, p2, p3] = [padded[i - 1], padded[i], padded[i + 1], padded[i + 2]];
        const segmentLength = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        const steps = Math.max(1, Math.ceil(segmentLength / spacing));
        for (let k = 0; k < steps; k++) {
            result.push(catmullRom(p0, p1, p2, p3, k / steps));
        }
    }
    result.push(control[control.length - 1]);
    return result;
}

export function trailSegments(trails: Trail[]): Float32Array {
    const data: number[] = [];
    for (const trail of trails) {
        const p = trail.points;
        for (let i = 1; i < p.length; i++) {
            data.push(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
        }
    }
    if (data.length === 0) {
        data.push(1e6, 1e6, 1e6, 1e6);
    }
    return new Float32Array(data);
}

function markTrail(grid: HeightGrid, avoid: Float32Array, cells: number[], endpoints: Point[]): void {
    const { size } = grid;
    for (const c of cells) {
        const cx = c % size;
        const cz = Math.floor(c / size);
        for (let dz = -AVOID_RADIUS; dz <= AVOID_RADIUS; dz++) {
            for (let dx = -AVOID_RADIUS; dx <= AVOID_RADIUS; dx++) {
                const x = cx + dx;
                const z = cz + dz;
                if (x < 0 || z < 0 || x >= size || z >= size) {
                    continue;
                }
                const falloff = 1 - Math.hypot(dx, dz) / AVOID_RADIUS;
                if (falloff <= 0) {
                    continue;
                }

                const i = z * size + x;
                const [wx, wz] = cellToWorld(grid, i);
                let nearest = Infinity;
                for (const [ex, ez] of endpoints) {
                    nearest = Math.min(nearest, Math.hypot(wx - ex, wz - ez));
                }
                const fade = Math.min(1, Math.max(0, (nearest - MERGE_RADIUS) / MERGE_RADIUS));

                avoid[i] = Math.max(avoid[i], falloff * fade);
            }
        }
    }
}

function logTrail(grid: HeightGrid, cells: number[], difficulty: Difficulty): void {
    let steepest = 0;
    let length = 0;
    for (let i = 1; i < cells.length; i++) {
        const [ax, az] = cellToWorld(grid, cells[i - 1]);
        const [bx, bz] = cellToWorld(grid, cells[i]);
        const run = Math.hypot(bx - ax, bz - az);
        length += run;
        steepest = Math.max(steepest, (grid.heights[cells[i - 1]] - grid.heights[cells[i]]) / run);
    }
    const [sx, sz] = cellToWorld(grid, cells[0]);
    console.log(
        `${difficulty.padEnd(5)} from (${sx.toFixed(1)}, ${sz.toFixed(1)}):` +
        ` length ${length.toFixed(1)}, steepest ${steepest.toFixed(2)}` +
        ` (max ${DIFFICULTY[difficulty].max})`,
    );
}

export function planTrails(grid: HeightGrid): Trail[] {
    const summits = findSummits(grid, 2, 25);
    const base = findBase(grid);
    const endpoints = [base, ...summits].map((c) => cellToWorld(grid, c));

    const avoid = new Float32Array(grid.size * grid.size);
    const order: Difficulty[] = ["black", "blue", "green"];

    const trails: Trail[] = [];

    for (const summit of summits) {
        for (const difficulty of order) {
            const cells = findPath(grid, summit, base, DIFFICULTY[difficulty], avoid);
            if (!cells) {
                console.warn("No path found from summit", cellToWorld(grid, summit));
                continue;
            }
            markTrail(grid, avoid, cells, endpoints);
            trails.push({
                difficulty,
                points: smoothPath(cells.map((c) => cellToWorld(grid, c)), 0.6, 0.5),
            });
            logTrail(grid, cells, difficulty);
        }
    }
    return trails;
}