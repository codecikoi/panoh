import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config.js";

let client: Anthropic | undefined;

export function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ timeout: env().AI_TIMEOUT_MS, maxRetries: 2 });
  return client;
}
