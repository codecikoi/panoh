import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default("./data/pglite"),
  MIGRATIONS_DIR: z.string().optional(),

  AI_EXTRACT_MODEL: z.string().default("claude-haiku-5-5"),
  AI_INSIGHTS_MODEL: z.string().default("claude-opus-5-5"),
  AI_TIMEOUT_MS: z.coerce.number().default(30_000),

  BOT_TOKEN: z.string().optional(),
  BOT_MODE: z.enum(["polling", "webhook"]).default("polling"),
  WEBHOOK_URL: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  INTERNAL_TOKEN: z.string().optional(),
  TELEGRAM_PROXY: z.string().optional(),
  PORT: z.coerce.number().default(8080),

  DASHBOARD_URL: z.string().optional(),
  DASHBOARD_TME_LINK: z.string().optional(),
  DASHBOARD_ORIGIN: z.string().optional(),

  DEFAULT_LOCALE: z.string().default("en"),
  DEFAULT_CURRENCY: z.string().default("USD"),
  DEFAULT_TIMEZONE: z.string().default("UTC"),
  RATES_URL: z.string().default("https://open.er-api.com/v6/latest/USD"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value as NonNullable<Env[K]>;
}
