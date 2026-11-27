export class GpuTimer {
    private device: GPUDevice;
    private names: string[];
    private averages: number[];
    private querySet: GPUQuerySet;
    private resolveBuffer: GPUBuffer;
    private readbackBuffer: GPUBuffer;
    private copiedThisFrame = false;

    constructor(device: GPUDevice, names: string[]) {
        this.device = device;
        this.names = names;
        this.averages = names.map(() => 0);

        const count = names.length * 2;
        this.querySet = device.createQuerySet({
            label: "gpu timer",
            type: "timestamp",
            count
        });
        this.resolveBuffer = device.createBuffer({
            label: "gpu timer resolve",
            size: count * 8,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
        this.readbackBuffer = device.createBuffer({
            label: "gpu timer readback",
            size: count * 8,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
    }

    passWrites(index: number): GPURenderPassTimestampWrites {
        return {
            querySet: this.querySet,
            beginningOfPassWriteIndex: index * 2,
            endOfPassWriteIndex: index * 2 + 1
        };
    }

    resolve(encoder: GPUCommandEncoder): void {
        this.copiedThisFrame = false;
        if (this.readbackBuffer.mapState !== "unmapped") {
            return;
        }
        encoder.resolveQuerySet(this.querySet, 0, this.names.length * 2, this.resolveBuffer, 0);

        encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readbackBuffer, 0, this.readbackBuffer.size);
        this.copiedThisFrame = true;
    }

    read(): void {
        if (!this.copiedThisFrame) {
            return;
        }

        this.readbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
            const times = new BigUint64Array(this.readbackBuffer.getMappedRange());
            for (let i = 0; i < this.names.length; i++) {
                const begin = times[i * 2];
                const end = times[i * 2 + 1];
                if (end > begin) {
                    const ms = Number(end - begin) / 1e6;
                    // Moving average
                    this.averages[i] = this.averages[i] * 0.95 + ms * 0.05;
                }
            }
            this.readbackBuffer.unmap();
        });
    }

    results(): { name: string, ms: number }[] {
        return this.names.map((name, i) => ({
            name, ms: this.averages[i]
        }));
    }
}