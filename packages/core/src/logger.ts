import { env } from "./config.js";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { value: String(err) };
}

function write(level: Level, msg: string, data?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[env().LOG_LEVEL]) return;
  const payload: Record<string, unknown> = { level, msg, time: new Date().toISOString(), ...data };
  if (data && "err" in data) payload.err = serializeError(data.err);
  const line = JSON.stringify(payload);
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const log = {
  debug: (msg: string, data?: Record<string, unknown>) => write("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
};
