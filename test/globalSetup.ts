import { config as loadEnv } from "dotenv";
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const dbPath = resolve(rootDir, "prisma/test.db");

export async function setup(): Promise<void> {
  const env: Record<string, string | undefined> = { ...process.env };
  loadEnv({ path: resolve(rootDir, ".env.test"), processEnv: env });

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    cwd: rootDir,
    env,
  });
}

export async function teardown(): Promise<void> {
  if (existsSync(dbPath)) rmSync(dbPath);
  if (existsSync(`${dbPath}-journal`)) rmSync(`${dbPath}-journal`);
}
