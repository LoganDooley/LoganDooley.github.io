export class OrbitCamera {
    target = [0, 10, 0];
    distance = 60;
    yaw = 0;
    pitch = 0.4;

    private dragButton: number | null = null;
    private lastX = 0;
    private lastY = 0;

    get eye(): number[] {
        const horizontal = this.distance * Math.cos(this.pitch);
        return [
            this.target[0] + horizontal * Math.sin(this.yaw),
            this.target[1] + horizontal * Math.sin(this.pitch),
            this.target[2] + horizontal * Math.cos(this.yaw),
        ];
    }

    setFromLookAt(eye: number[], target: number[]): void {
        const dx = eye[0] - target[0];
        const dy = eye[1] - target[1];
        const dz = eye[2] - target[2];
        this.target = [...target];
        this.distance = Math.hypot(dx, dy, dz);
        this.pitch = Math.asin(dy / this.distance);
        this.yaw = Math.atan2(dx, dz);
    }

    attach(isActive: () => boolean): void {
        window.addEventListener("pointerdown", (event) => {
            if (!isActive()) {
                return;
            }
            this.dragButton = event.button;
            this.lastX = event.clientX;
            this.lastY = event.clientY;
            event.preventDefault();
        });

        window.addEventListener("pointermove", (event) => {
            if (this.dragButton === null || !isActive()) {
                return;
            }
            const dx = event.clientX - this.lastX;
            const dy = event.clientY - this.lastY;
            this.lastX = event.clientX;
            this.lastY = event.clientY;

            if (this.dragButton === 0) {
                this.rotate(dx, dy);
            } else if (this.dragButton === 2) {
                this.pan(dx, dy);
            }
        });

        window.addEventListener("pointerup", () => {
            this.dragButton = null;
        });

        window.addEventListener("wheel", (event) => {
            if (!isActive()) {
                return;
            }
            event.preventDefault();
            this.distance = clamp(this.distance * Math.exp(event.deltaY * 0.001), 3, 250);
        }, { passive: false },
        );

        window.addEventListener("contextmenu", (event) => {
            if (isActive()) {
                event.preventDefault();
            }
        });
    }

    private rotate(dx: number, dy: number): void {
        this.yaw -= dx * 0.005;
        this.pitch = clamp(this.pitch + dy * 0.005, -0.2, 1.55);
    }

    private pan(dx: number, dy: number): void {
        const speed = this.distance * 0.0015;
        const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
        const forward = [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)];
        for (let i = 0; i < 3; i++) {
            this.target[i] += (-right[i] * dx + forward[i] * dy) * speed;
        }
    }
}

function clamp(x: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, x));
}