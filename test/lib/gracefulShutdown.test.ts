import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerGracefulShutdown } from "../../src/lib/gracefulShutdown.js";

function fakeApp(close: () => Promise<void>): FastifyInstance {
  return {
    close,
    log: { info: vi.fn(), error: vi.fn() },
  } as unknown as FastifyInstance;
}

describe("registerGracefulShutdown", () => {
  afterEach(() => {
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
    vi.useRealTimers();
  });

  it("closes the server and exits 0 once draining completes", async () => {
    let resolveClose!: () => void;
    const close = vi.fn(() => new Promise<void>((resolve) => (resolveClose = resolve)));
    const app = fakeApp(close);
    const exit = vi.fn();

    registerGracefulShutdown(app, { exit });
    process.emit("SIGTERM", "SIGTERM");

    expect(close).toHaveBeenCalledOnce();
    resolveClose();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  it("rejects a second signal instead of draining twice", () => {
    const close = vi.fn(() => new Promise<void>(() => {}));
    const app = fakeApp(close);
    const exit = vi.fn();

    registerGracefulShutdown(app, { exit });
    process.emit("SIGTERM", "SIGTERM");
    process.emit("SIGTERM", "SIGTERM");
    process.emit("SIGINT", "SIGINT");

    expect(close).toHaveBeenCalledOnce();
  });

  it("force-exits with a non-zero code once the drain window elapses", () => {
    vi.useFakeTimers();
    const close = vi.fn(() => new Promise<void>(() => {})); // never resolves
    const app = fakeApp(close);
    const exit = vi.fn();

    registerGracefulShutdown(app, { exit, drainTimeoutMs: 30_000 });
    process.emit("SIGTERM", "SIGTERM");

    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits with a non-zero code if close() itself rejects", async () => {
    const close = vi.fn(() => Promise.reject(new Error("close failed")));
    const app = fakeApp(close);
    const exit = vi.fn();

    registerGracefulShutdown(app, { exit });
    process.emit("SIGTERM", "SIGTERM");

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});
