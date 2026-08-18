import { describe, expect, it, vi } from "vitest";

const execFileSync = vi.fn();
vi.mock("node:child_process", () => ({ execFileSync: (...args: unknown[]) => execFileSync(...args) }));

describe("runPendingMigrations", () => {
  it("runs `prisma migrate deploy` with output inherited", async () => {
    execFileSync.mockReturnValueOnce(Buffer.from(""));
    const { runPendingMigrations } = await import("../../src/lib/migrate.js");

    runPendingMigrations();

    expect(execFileSync).toHaveBeenCalledWith("npx", ["prisma", "migrate", "deploy"], {
      stdio: "inherit",
    });
  });

  it("wraps a failed migration in a clear, actionable error instead of a raw child_process error", async () => {
    execFileSync.mockImplementationOnce(() => {
      throw new Error("P3009: migrate found failed migrations");
    });
    const { runPendingMigrations } = await import("../../src/lib/migrate.js");

    expect(() => runPendingMigrations()).toThrow(
      /Database migration failed, aborting startup before accepting traffic: P3009/,
    );
  });
});
