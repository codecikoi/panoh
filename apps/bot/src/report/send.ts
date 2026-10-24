import { createHash } from "node:crypto";
import { InlineKeyboard, InputFile, type Api } from "grammy";
import {
  formatPeriod,
  loadReport,
  log,
  periodKey,
  presetPeriods,
  reportFingerprint,
  t,
  todayISO,
  type Period,
} from "@madat/core";
import type { Deps, Scope } from "../bot/context.js";
import { assistantName } from "../bot/render.js";
import { renderReportHtml } from "./html.js";
import { htmlToPdf } from "./pdf.js";

/** Runs at most `concurrency` jobs at a time; the rest wait in arrival order. */
export class JobQueue {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly concurrency = 1) {}

  /** Jobs running or waiting right now. */
  get size(): number {
    return this.running + this.waiting.length;
  }

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running++;
    try {
      return await job();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}

const PER_HOUR = 10;
const queue = new JobQueue(1);
const recent = new Map<number, number[]>();
/** Telegram file ids of reports already sent, keyed by everything that shows up in the PDF. */
const sentFiles = new Map<string, string>();

function allow(householdId: number, now = Date.now()): boolean {
  const list = (recent.get(householdId) ?? []).filter((at) => now - at < 3600_000);
  if (list.length >= PER_HOUR) {
    recent.set(householdId, list);
    return false;
  }
  list.push(now);
  recent.set(householdId, list);
  return true;
}

function remember(key: string, fileId: string): void {
  sentFiles.set(key, fileId);
  if (sentFiles.size > 500) sentFiles.delete(sentFiles.keys().next().value!);
}

function fileName(name: string, period: Period): string {
  const safe = name.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "Madat";
  return period.kind === "month" ? `${safe}_${period.from.slice(0, 7)}.pdf` : `${safe}_${period.from}_${period.to}.pdf`;
}

/** Buttons with the usual periods; each sends `rep:<periodKey>`. */
export function reportPickerKeyboard(scope: Scope): InlineKeyboard {
  const p = presetPeriods(todayISO(scope.tz));
  return new InlineKeyboard()
    .text(t(scope.locale, "btn.this_week"), `rep:${periodKey(p.thisWeek)}`)
    .text(t(scope.locale, "btn.last_week"), `rep:${periodKey(p.lastWeek)}`)
    .row()
    .text(t(scope.locale, "btn.this_month"), `rep:${periodKey(p.thisMonth)}`)
    .text(t(scope.locale, "btn.last_month"), `rep:${periodKey(p.lastMonth)}`);
}

export interface SendReportOptions {
  /** Message to answer in groups. */
  replyTo?: number;
}

/** Builds the PDF for a period (or reuses an identical one) and sends it as a document. */
export async function sendReport(api: Api, deps: Deps, scope: Scope, chatId: number, period: Period, options: SendReportOptions = {}): Promise<void> {
  const L = scope.locale;
  const reply = options.replyTo && scope.household.chatType !== "private" ? { reply_parameters: { message_id: options.replyTo } } : {};
  const label = formatPeriod(period, L);
  if (!allow(scope.household.id)) {
    await api.sendMessage(chatId, t(L, "report.rate_limited"), reply);
    return;
  }
  const data = await loadReport(deps.db, scope.household, period);
  if (!data.transactions.length) {
    await api.sendMessage(chatId, t(L, "report.empty", { period: label }), reply);
    return;
  }
  const name = assistantName(scope);
  const caption = t(L, "report.caption", { name, period: label });
  const key = createHash("sha1")
    .update(JSON.stringify([scope.household.id, L, name, scope.household.title, { ...data, transactions: reportFingerprint(data.transactions) }]))
    .digest("hex");
  const cached = sentFiles.get(key);
  if (cached) {
    try {
      await api.sendDocument(chatId, cached, { caption, ...reply });
      return;
    } catch (err) {
      log.warn("report: cached file rejected, rendering again", { err });
      sentFiles.delete(key);
    }
  }

  const ahead = queue.size;
  const waiting = await api.sendMessage(
    chatId,
    ahead > 0 ? t(L, "report.queued", { period: label, count: ahead }) : t(L, "report.preparing", { period: label }),
    reply,
  );
  try {
    void api.sendChatAction(chatId, "upload_document").catch(() => undefined);
    const html = renderReportHtml({
      locale: L,
      tz: scope.tz,
      assistantName: name,
      title: scope.household.chatType === "private" ? null : scope.household.title,
      data,
    });
    const pdf = await queue.run(() => htmlToPdf(html));
    const sent = await api.sendDocument(chatId, new InputFile(pdf, fileName(name, period)), { caption, ...reply });
    if (sent.document) remember(key, sent.document.file_id);
    await api.deleteMessage(chatId, waiting.message_id).catch(() => undefined);
  } catch (err) {
    log.error("report failed", { err, householdId: scope.household.id });
    await api.editMessageText(chatId, waiting.message_id, t(L, "report.failed")).catch(() => undefined);
  }
}
