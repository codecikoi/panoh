import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { anthropic } from "./client.js";
import { env } from "../config.js";
import { log } from "../logger.js";
import type { MonthlySummary } from "../services/summary.js";

const InsightsSchema = z.object({
  highlights: z.array(z.string()),
  tips: z.array(z.string()),
  mood: z.enum(["good", "neutral", "warning"]),
});

export type Insights = z.infer<typeof InsightsSchema>;

const INSIGHTS_SYSTEM_PROMPT = `You write the short "insights" section of a monthly family budget summary for a Telegram bot.
You receive the computed numbers (already correct, already in the household's base currency). You never compute or invent numbers: quote only values present in the input, rounded sensibly.
Write in the language given by "locale". Tone: warm, concise, friendly, like a smart friend, no lecturing, no generic advice.
- highlights: 2–4 one-line observations that matter (what grew, what dominates, unusual single purchases, pace vs last month, upcoming bills vs balance). Each ≤ 120 characters, may start with an emoji.
- tips: 1–3 concrete, specific suggestions grounded in the data (e.g. which category to cap and by how much). ≤ 120 characters each. If the data is thin, give one gentle tip about tracking consistently.
- The JSON may contain "outlook": forecast (money still to pay this month and the free money left; only income already received is counted), budgets (monthly limits per category with usage), goals (savings goals with progress and the monthly pace needed), plans (planned expenses this month). Use them when relevant: a limit that is close or exceeded, a shortfall, a goal falling behind.
- mood: "good" if spending is under control, "warning" if expenses exceed income, the forecast shows a shortfall, a limit is exceeded or a category jumped a lot, otherwise "neutral".
Plain text only, no markdown, no HTML.`;

export async function generateInsights(summary: MonthlySummary, locale: string): Promise<Insights | null> {
  // Who spent what stays between the family: the model gets the numbers without the per-person split.
  const { byPerson: _byPerson, ...shared } = summary;
  const payload = JSON.stringify(shared);
  try {
    const response = await anthropic().beta.messages.parse({
      model: env().AI_INSIGHTS_MODEL,
      max_tokens: 2048,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: INSIGHTS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `locale: ${locale}\n\nSummary JSON:\n${payload}` }],
      output_config: { effort: "medium", format: betaZodOutputFormat(InsightsSchema) },
    });
    if (response.stop_reason === "refusal") {
      log.warn("insights: refusal", { category: response.stop_details?.category ?? null });
      return null;
    }
    const parsed = response.parsed_output;
    if (!parsed) return null;
    return {
      highlights: parsed.highlights.slice(0, 4),
      tips: parsed.tips.slice(0, 3),
      mood: parsed.mood,
    };
  } catch (err) {
    log.error("insights: failed", { err });
    return null;
  }
}
