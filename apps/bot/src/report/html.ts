import { DateTime } from "luxon";
import {
  CATEGORY_EMOJI,
  escapeHtml,
  formatMoney,
  formatPercent,
  formatPeriod,
  t,
  type BudgetStat,
  type Category,
  type CategoryStat,
  type GoalStat,
  type LocaleKey,
  type ReportData,
} from "@madat/core";

export interface ReportView {
  locale: string;
  tz: string;
  assistantName: string;
  /** Group title, when the report is for a group. */
  title: string | null;
  data: ReportData;
}

const RTL = new Set(["ar", "fa", "he", "ur"]);

/** Categorical slots 1–5 of the validated reference palette (light); "Other" is hatched, never a sixth hue. */
const SLOTS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
const STATUS = { warning: "#fab219", critical: "#d03b3b" };

const CSS = `
@page { size: A4; margin: 16mm 14mm 18mm; @bottom-center { content: counter(page) " / " counter(pages); font: 9px var(--font); color: #8a8984; } }
:root {
  --font: "Noto Sans", "Noto Sans Arabic", "Noto Sans Hebrew", "Noto Sans Devanagari", "Noto Sans Bengali", "Noto Sans Thai",
    "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", "Noto Color Emoji", system-ui, -apple-system, "Segoe UI", sans-serif;
  --surface: #ffffff; --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #8a8984; --hairline: #e6e5e0;
  --accent: #2a78d6; --accent-track: #cde2fb; --tile: #f6f5f1;
}
* { box-sizing: border-box; }
html { color-scheme: light; }
body { margin: 0; background: var(--surface); color: var(--text-primary); font: 10.5px/1.45 var(--font);
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 22px; line-height: 1.2; margin: 0; letter-spacing: -0.01em; }
h2 { font-size: 13px; margin: 22px 0 8px; break-after: avoid; }
.sub { color: var(--text-secondary); margin-top: 4px; }
.muted { color: var(--text-muted); }
.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px;
  padding-bottom: 12px; border-bottom: 1px solid var(--hairline); }
.brand { font-size: 11px; color: var(--accent); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 16px; }
.tile { background: var(--tile); border-radius: 8px; padding: 10px 12px; }
.tile .label { color: var(--text-secondary); font-size: 10px; }
.tile .value { font-size: 18px; font-weight: 700; margin-top: 2px; }
.tile .delta { color: var(--text-secondary); font-size: 9.5px; margin-top: 2px; }
.stack { display: flex; gap: 2px; height: 14px; margin: 4px 0 8px; }
.stack span { display: block; height: 100%; }
.stack span:first-child { border-start-start-radius: 4px; border-end-start-radius: 4px; }
.stack span:last-child { border-start-end-radius: 4px; border-end-end-radius: 4px; }
.hatch { background: repeating-linear-gradient(45deg, #b9b8b2 0 2px, #ecebe6 2px 5px); }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--text-secondary); }
.legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-inline-end: 5px; vertical-align: -1px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: start; font-weight: 600; color: var(--text-secondary); font-size: 9.5px; padding: 4px 6px; border-bottom: 1px solid var(--hairline); }
td { padding: 4px 6px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
tr { break-inside: avoid; }
td.r, th.r { text-align: end; }
.bar { position: relative; height: 6px; background: var(--accent-track); border-radius: 3px; min-width: 60px; margin-top: 4px; }
.bar b { position: absolute; inset-block: 0; inset-inline-start: 0; background: var(--accent); border-radius: 3px; }
.meter { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 6px 0; border-bottom: 1px solid var(--hairline); break-inside: avoid; }
.meter .bar { grid-column: 1 / -1; height: 8px; border-radius: 4px; }
.meter .bar b { border-radius: 4px; }
.day td { background: var(--tile); font-weight: 600; color: var(--text-secondary); }
.in { color: var(--text-primary); }
ul { margin: 4px 0 0; padding-inline-start: 18px; }
li { margin: 2px 0; }
.forecast { background: var(--tile); border-radius: 8px; padding: 10px 12px; }
.forecast div + div { margin-top: 3px; }
footer { margin-top: 20px; color: var(--text-muted); font-size: 9px; }
`;

type Tr = (key: LocaleKey, params?: Record<string, string | number>) => string;

function catName(tr: Tr, category: string): string {
  return tr(`cat.${category}` as LocaleKey);
}

function catLabel(tr: Tr, category: string): string {
  return `${CATEGORY_EMOJI[category as Category] ?? "📦"} ${escapeHtml(catName(tr, category))}`;
}

function delta(tr: Tr, locale: string, value: number | null): string {
  return value === null ? "" : `<div class="delta">${escapeHtml(tr("report.vs_prev", { pct: formatPercent(value, locale) }))}</div>`;
}

function shareBar(share: number): string {
  return `<div class="bar"><b style="width:${Math.max(0, Math.min(100, share))}%"></b></div>`;
}

/** Top five categories in palette order, everything else folded into one hatched "Other" segment. */
function stackedBar(tr: Tr, locale: string, cats: CategoryStat[], total: number): string {
  if (total <= 0 || !cats.length) return "";
  const top = cats.slice(0, 5);
  const rest = cats.slice(5).reduce((sum, c) => sum + c.amount, 0);
  const segments = top.map((c, i) => ({ label: catName(tr, c.category), amount: c.amount, color: SLOTS[i]!, hatch: false }));
  if (rest > 0) segments.push({ label: tr("report.other"), amount: rest, color: "", hatch: true });
  const pctOf = (amount: number) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(amount / total);
  const bar = segments
    .map((s) => `<span class="${s.hatch ? "hatch" : ""}" style="flex:${s.amount} 1 0;${s.hatch ? "" : `background:${s.color}`}"></span>`)
    .join("");
  const legend = segments
    .map((s) => `<span><i class="${s.hatch ? "hatch" : ""}" style="${s.hatch ? "" : `background:${s.color}`}"></i>${escapeHtml(s.label)} · ${pctOf(s.amount)}</span>`)
    .join("");
  return `<div class="stack" role="img">${bar}</div><div class="legend">${legend}</div>`;
}

function categoryTable(tr: Tr, view: ReportView, cats: CategoryStat[], withChange: boolean): string {
  const money = (n: number) => formatMoney(n, view.data.currency, view.locale);
  const rows = cats
    .map(
      (c) => `<tr><td>${catLabel(tr, c.category)}${shareBar(c.share)}</td><td class="r num">${money(c.amount)}</td><td class="r num">${c.share}%</td>${
        withChange ? `<td class="r num">${c.deltaPct === null ? "—" : formatPercent(c.deltaPct, view.locale)}</td>` : ""
      }</tr>`,
    )
    .join("");
  return `<table><thead><tr><th>${tr("report.col_category")}</th><th class="r">${tr("report.col_amount")}</th><th class="r">${tr(
    "report.col_share",
  )}</th>${withChange ? `<th class="r">${tr("report.col_change")}</th>` : ""}</tr></thead><tbody>${rows}</tbody></table>`;
}

function meter(label: string, right: string, fill: number, color: string, track: string): string {
  return `<div class="meter"><div>${label}</div><div class="num">${right}</div><div class="bar" style="background:${track}"><b style="width:${Math.max(
    0,
    Math.min(100, fill),
  )}%;background:${color}"></b></div></div>`;
}

function budgetMeters(tr: Tr, view: ReportView, budgets: BudgetStat[]): string {
  const money = (n: number) => formatMoney(n, view.data.currency, view.locale);
  return budgets
    .map((b) => {
      // Severity rides on fill colour plus an icon, never colour alone.
      const [color, track, icon] =
        b.pct > 100 ? [STATUS.critical, "#f6d3d3", " 🚨"] : b.pct >= 80 ? [STATUS.warning, "#fdebc4", " ⚠️"] : ["var(--accent)", "var(--accent-track)", ""];
      return meter(catLabel(tr, b.category), `${money(b.spent)} / ${money(b.limit)} · ${b.pct}%${icon}`, b.pct, color, track);
    })
    .join("");
}

function goalMeters(view: ReportView, tr: Tr, goals: GoalStat[]): string {
  return goals
    .map((g) => {
      const money = (n: number) => formatMoney(n, g.currency, view.locale);
      const pace = g.monthlyNeed && g.saved < g.target ? ` <span class="muted">· ${escapeHtml(tr("report.goal_pace", { amount: money(g.monthlyNeed) }))}</span>` : "";
      return meter(`💰 <b>${escapeHtml(g.title)}</b>${pace}`, `${money(g.saved)} / ${money(g.target)} · ${g.pct}%`, g.pct, "var(--accent)", "var(--accent-track)");
    })
    .join("");
}

function transactionsTable(tr: Tr, view: ReportView): string {
  const { data, locale } = view;
  let lastDay = "";
  const rows: string[] = [];
  for (const tx of data.transactions) {
    if (tx.occurredOn !== lastDay) {
      lastDay = tx.occurredOn;
      const label = DateTime.fromISO(tx.occurredOn, { zone: "utc" }).setLocale(locale).toLocaleString({ weekday: "short", day: "numeric", month: "long" });
      rows.push(`<tr class="day"><td colspan="3">${escapeHtml(label)}</td></tr>`);
    }
    const sign = tx.kind === "income" ? "+" : "−";
    const own = formatMoney(tx.amount, tx.currency, locale);
    const converted =
      tx.currency !== data.currency && tx.amountBase !== null ? `<div class="muted">≈ ${formatMoney(tx.amountBase, data.currency, locale)}</div>` : "";
    rows.push(
      `<tr><td>${catLabel(tr, tx.category)}</td><td>${escapeHtml(tx.note)}</td><td class="r num ${tx.kind === "income" ? "in" : ""}">${sign}${own}${converted}</td></tr>`,
    );
  }
  return `<table><thead><tr><th>${tr("report.col_category")}</th><th>${tr("report.col_note")}</th><th class="r">${tr(
    "report.col_amount",
  )}</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

/** Self-contained HTML for the PDF report: no scripts, no network, every user-provided string escaped. */
export function renderReportHtml(view: ReportView): string {
  const { data, locale } = view;
  const tr: Tr = (key, params) => t(locale, key, params);
  const money = (n: number) => formatMoney(n, data.currency, locale);
  const period = escapeHtml(formatPeriod(data.period, locale));
  const generated = DateTime.now().setZone(view.tz).setLocale(locale).toLocaleString(DateTime.DATETIME_MED);
  const parts: string[] = [];

  parts.push(`<header><div><div class="brand">${escapeHtml(view.assistantName)}</div><h1>${escapeHtml(tr("report.title"))} · ${period}</h1>${
    view.title ? `<div class="sub">${escapeHtml(view.title)}</div>` : ""
  }</div><div class="sub num">${escapeHtml(tr("report.generated", { date: generated }))}</div></header>`);

  parts.push(`<div class="tiles">
    <div class="tile"><div class="label">${escapeHtml(tr("report.kpi_income"))}</div><div class="value num">${money(data.income)}</div>${delta(tr, locale, data.incomeDeltaPct)}</div>
    <div class="tile"><div class="label">${escapeHtml(tr("report.kpi_expenses"))}</div><div class="value num">${money(data.expense)}</div>${delta(tr, locale, data.expenseDeltaPct)}</div>
    <div class="tile"><div class="label">${escapeHtml(tr("report.kpi_balance"))}</div><div class="value num">${data.net >= 0 ? "+" : ""}${money(data.net)}</div><div class="delta">${escapeHtml(
      tr("report.avg_day", { amount: money(data.avgPerDay) }),
    )}</div></div>
  </div>`);

  const forecast = data.month?.outlook.forecast;
  if (forecast && forecast.ahead > 0) {
    const free =
      forecast.free >= 0
        ? tr("summary.forecast_free", { amount: money(forecast.free) }) + (forecast.perDay ? tr("summary.forecast_per_day", { amount: money(forecast.perDay) }) : "")
        : `${tr("summary.forecast_short", { amount: money(-forecast.free) })}<div class="muted">${tr("summary.forecast_note")}</div>`;
    const partsAhead = [
      forecast.payments > 0 ? tr("summary.part_payments", { amount: money(forecast.payments) }) : "",
      forecast.plans > 0 ? tr("summary.part_plans", { amount: money(forecast.plans) }) : "",
      forecast.goals > 0 ? tr("summary.part_goals", { amount: money(forecast.goals) }) : "",
    ].filter(Boolean);
    parts.push(`<h2>${escapeHtml(tr("report.month_balance"))}</h2><div class="forecast"><div>${tr("summary.forecast_ahead", {
      amount: money(forecast.ahead),
      parts: partsAhead.join(", "),
    })}</div><div>${free}</div></div>`);
  }

  if (data.categories.length) {
    parts.push(`<h2>${escapeHtml(tr("report.by_category"))}</h2>${stackedBar(tr, locale, data.categories, data.expense)}`);
    parts.push(categoryTable(tr, view, data.categories, data.hasPrev));
  }
  if (data.incomeCategories.length) {
    parts.push(`<h2>${escapeHtml(tr("report.income_by_category"))}</h2>${categoryTable(tr, view, data.incomeCategories, false)}`);
  }
  if (data.month?.outlook.budgets.length) parts.push(`<h2>${tr("summary.budgets")}</h2>${budgetMeters(tr, view, data.month.outlook.budgets)}`);
  if (data.month?.outlook.goals.length) parts.push(`<h2>${tr("summary.goals")}</h2>${goalMeters(view, tr, data.month.outlook.goals)}`);
  if (data.month?.outlook.plans.length) {
    const rows = data.month.outlook.plans
      .map(
        (p) =>
          `<tr><td>${catLabel(tr, p.category)}</td><td>${escapeHtml(p.title)}${p.overdue ? ` <span class="muted">· ⏳ ${escapeHtml(tr("plans.overdue"))}</span>` : ""}</td><td class="r num">${formatMoney(
            p.originalAmount,
            p.currency,
            locale,
          )}</td></tr>`,
      )
      .join("");
    parts.push(`<h2>${tr("summary.plans")}</h2><table><tbody>${rows}</tbody></table>`);
  }
  const insights = data.month?.insights;
  if (insights && (insights.highlights.length || insights.tips.length)) {
    const list = (items: string[]) => `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
    if (insights.highlights.length) parts.push(`<h2>${tr("summary.insights")}</h2>${list(insights.highlights)}`);
    if (insights.tips.length) parts.push(`<h2>${tr("summary.tips")}</h2>${list(insights.tips)}`);
  }
  if (data.unconverted.length) {
    parts.push(`<p class="muted">${tr("summary.unconverted", { list: data.unconverted.map((u) => formatMoney(u.amount, u.currency, locale)).join(", ") })}</p>`);
  }
  parts.push(`<h2>${escapeHtml(tr("report.transactions", { count: data.transactions.length }))}</h2>${transactionsTable(tr, view)}`);
  parts.push(`<footer>${escapeHtml(view.assistantName)} · ${escapeHtml(tr("report.footer"))}</footer>`);

  return `<!doctype html><html lang="${escapeHtml(locale)}" dir="${RTL.has(locale) ? "rtl" : "ltr"}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<title>${escapeHtml(view.assistantName)} · ${period}</title><style>${CSS}</style></head><body>${parts.join("\n")}</body></html>`;
}
