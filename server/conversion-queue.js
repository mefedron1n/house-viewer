// Single-process queue. Replace with Redis/BullMQ before horizontal API scaling.
export class ConversionQueue {
  constructor({
    concurrency = 1,
    maxQueue = 10,
    maxPerOwner = 2,
    worker,
    onStateChange = () => {},
  }) {
    this.concurrency = Math.max(1, concurrency);
    this.maxQueue = Math.max(0, maxQueue);
    this.maxPerOwner = Math.max(1, maxPerOwner);
    this.worker = worker;
    this.onStateChange = onStateChange;
    this.jobs = new Map();
    this.running = 0;
    this.accepting = true;
  }
  enqueue(job) {
    if (!this.accepting)
      throw Object.assign(new Error("Queue is shutting down"), { code: "QUEUE_STOPPED" });
    const owned = job.ownerKey
      ? [...this.jobs.values()].filter(
          (item) =>
            item.ownerKey === job.ownerKey &&
            ["queued", "validating", "analyzing", "converting", "optimizing"].includes(item.status)
        ).length
      : 0;
    if (owned >= this.maxPerOwner)
      throw Object.assign(new Error("Owner job limit reached"), { code: "OWNER_QUEUE_LIMIT" });
    if (this.size >= this.maxQueue)
      throw Object.assign(new Error("Queue is full"), { code: "QUEUE_FULL" });
    this.jobs.set(job.id, job);
    this.pump();
    return job;
  }
  get(id) {
    return this.jobs.get(id);
  }
  delete(id) {
    return this.jobs.delete(id);
  }
  stop() {
    this.accepting = false;
  }
  get size() {
    return [...this.jobs.values()].filter((job) => job.status === "queued").length;
  }
  pump() {
    for (const job of this.jobs.values()) {
      if (this.running >= this.concurrency || job.status !== "queued") continue;
      this.running++;
      this.onStateChange(this);
      Promise.resolve(this.worker(job)).finally(() => {
        this.running--;
        this.onStateChange(this);
        this.pump();
      });
    }
  }
}
