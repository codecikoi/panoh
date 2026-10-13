import type { Api } from "grammy";
import { getInsights, loadMonthlySummary, log } from "@madat/core";
import type { Deps, Scope } from "./context.js";
import { summaryKeyboard, summaryText } from "./render.js";
import { safeEdit } from "./telegram.js";

export interface SendSummaryOptions {
  editMessageId?: number;
  intro?: string;
  withInsights?: boolean;
}

/** Sends the computed summary right away, then appends AI insights once they are ready. */
export async function sendSummary(api: Api, deps: Deps, scope: Scope, chatId: number, month: string, options: SendSummaryOptions = {}): Promise<void> {
  const summary = await loadMonthlySummary(deps.db, scope.household, month);
  const isPrivate = scope.household.chatType === "private";
  const keyboard = summaryKeyboard(scope, month, { dashboardUrl: deps.dashboardUrl, dashboardLink: deps.dashboardLink, isPrivate });
  const base = summaryText(scope, summary);
  const text = options.intro ? `${options.intro}\n\n${base}` : base;
  let messageId = options.editMessageId;
  if (messageId) {
    await safeEdit(api, chatId, messageId, text, keyboard);
  } else {
    const sent = await api.sendMessage(chatId, text, { reply_markup: keyboard });
    messageId = sent.message_id;
  }
  if (options.withInsights === false || summary.recordCount === 0) return;
  try {
    const insights = await getInsights(deps.db, scope.household, summary);
    if (!insights) return;
    const withInsights = summaryText(scope, summary, insights);
    await safeEdit(api, chatId, messageId, options.intro ? `${options.intro}\n\n${withInsights}` : withInsights, keyboard);
  } catch (err) {
    log.error("summary insights failed", { err });
  }
}
