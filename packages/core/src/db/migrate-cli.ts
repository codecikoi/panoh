import { createDb } from "./client.js";
import { log } from "../logger.js";

const handle = await createDb();
await handle.migrate();
log.info("migrations applied", { driver: handle.driver });
await handle.close();
