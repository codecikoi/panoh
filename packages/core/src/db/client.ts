import { fileURLToPath } from "node:url";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { env } from "../config.js";
import { log } from "../logger.js";
import * as schema from "./schema.js";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  driver: "postgres" | "pglite";
  migrate: () => Promise<void>;
  close: () => Promise<void>;
}

function migrationsFolder(): string {
  const configured = env().MIGRATIONS_DIR;
  if (configured) return configured;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
}

export async function createDb(options: { url?: string; pgliteDir?: string | ":memory:" } = {}): Promise<DbHandle> {
  const url = options.url ?? env().DATABASE_URL;
  if (url) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const postgres = (await import("postgres")).default;
    const client = postgres(url, { max: 10, prepare: false });
    const db = drizzle(client, { schema });
    log.info("db: connected", { driver: "postgres" });
    return {
      db: db as unknown as Db,
      driver: "postgres",
      migrate: () => migrate(db, { migrationsFolder: migrationsFolder() }),
      close: () => client.end({ timeout: 5 }),
    };
  }

  if (env().NODE_ENV === "production" && !options.pgliteDir) {
    throw new Error("DATABASE_URL is required in production (the embedded PGlite database is for local development only)");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = options.pgliteDir ?? env().PGLITE_DIR;
  const client = dir === ":memory:" ? await PGlite.create() : await PGlite.create(dir);
  const db = drizzle(client, { schema });
  log.info("db: connected", { driver: "pglite", dir });
  return {
    db: db as unknown as Db,
    driver: "pglite",
    migrate: () => migrate(db, { migrationsFolder: migrationsFolder() }),
    close: () => client.close(),
  };
}

/** Fresh in-memory database with migrations applied. Intended for tests. */
export async function createTestDb(): Promise<DbHandle> {
  const handle = await createDb({ pgliteDir: ":memory:" });
  await handle.migrate();
  return handle;
}
