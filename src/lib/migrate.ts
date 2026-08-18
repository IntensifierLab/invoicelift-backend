import { execFileSync } from "node:child_process";

/**
 * Applies any pending Prisma migrations before the server starts accepting
 * traffic, via `prisma migrate deploy` (the same command CI runs against the
 * test DB). Prisma tracks applied migrations itself in the `_prisma_migrations`
 * table, so this is a no-op when the schema is already up to date.
 *
 * Throws with a clear, actionable message on failure so startup aborts
 * instead of serving traffic against a stale/broken schema.
 */
export function runPendingMigrations(): void {
  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Database migration failed, aborting startup before accepting traffic: ${reason}`);
  }
}
