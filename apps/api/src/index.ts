import { serve } from "@hono/node-server";
import { createDb, env, log, requireEnv } from "@madat/core";
import { createApp } from "./app.js";

const e = env();
const handle = await createDb();
try {
  await handle.migrate();
} catch (err) {
  log.warn("api: migrations failed (another instance may be migrating)", { err });
}
const app = createApp({
  db: handle.db,
  botToken: requireEnv("BOT_TOKEN"),
  corsOrigin: e.DASHBOARD_ORIGIN,
  botUrl: e.BOT_INTERNAL_URL,
  internalToken: e.INTERNAL_TOKEN,
});

const server = serve({ fetch: app.fetch, port: e.PORT, hostname: "0.0.0.0" }, (info) => {
  log.info("api: listening", { port: info.port });
});

async function shutdown(): Promise<void> {
  server.close();
  await handle.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
