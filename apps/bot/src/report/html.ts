import { DateTime } from "luxon";
import {
  NO_CUSTOM_CATEGORIES,
  PALETTE,
  TOTAL_BUDGET,
  brandCssVars,
  categoryIcon,
  formatDate,
  isCustomCategory,
  escapeHtml,
  formatMoney,
  formatPercent,
  formatPeriod,
  iconSvg,
  markSvg,
  t,
  type BudgetStat,
  type CategoryLookup,
  type CategoryStat,
  type GoalStat,
  type IconName,
  type LocaleKey,
  type PersonStat,
  type ReportData,
} from "@madat/core";

export interface ReportView {
  locale: string;
  tz: string;
  assistantName: string;
  /** Group title, when the report is for a group. */
  title: string | null;
  /** The family's own categories, for their names. */
  categories?: CategoryLookup;
  data: ReportData;
}

const RTL = new Set(["ar", "fa", "he", "ur"]);

/** Print is always on white, so the light palette; categorical slots 1–5, "Other" is hatched, never a sixth hue. */
const P = PALETTE.light;

const CSS = `
@page { size: A4; margin: 16mm 14mm 18mm; @bottom-center { content: counter(page) " / " counter(pages); font: 9px var(--font); color: ${P.textTertiary}; } }
:root { ${brandCssVars("light")}; }
:root {
  /* Inter first (installed in the bot image), then Noto for every script the bot speaks, then the kit stack. */
  --font: "Inter", "Noto Sans", "Noto Sans Arabic", "Noto Sans Hebrew", "Noto Sans Devanagari", "Noto Sans Bengali", "Noto Sans Thai",
    "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", system-ui, -apple-system, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html { color-scheme: light; }
body { margin: 0; background: var(--card); color: var(--text); font: 10.5px/1.45 var(--font);
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 22px; line-height: 1.2; margin: 0; letter-spacing: -0.01em; color: var(--text-strong); font-weight: 600; }
h2 { font-size: 13px; font-weight: 600; color: var(--text-strong); margin: 22px 0 8px; break-after: avoid; }
.sub { color: var(--text-2); margin-top: 4px; }
.muted { color: var(--text-3); }
.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
svg { vertical-align: middle; }
header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px;
  padding-bottom: 12px; border-bottom: 1px solid var(--divider); }
.brand { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--accent); font-weight: 600; letter-spacing: 0.02em; margin-bottom: 6px; }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 16px; }
.tile { background: var(--soft); border-radius: var(--r-plate); padding: 10px 12px; }
.tile .label { color: var(--text-2); font-size: 10px; }
.tile .value { font-size: 18px; font-weight: 600; color: var(--text-strong); margin-top: 2px; }
.tile .delta { color: var(--text-2); font-size: 9.5px; margin-top: 2px; }
.stack { display: flex; gap: 2px; height: 14px; margin: 4px 0 8px; }
.stack span { display: block; height: 100%; }
.stack span:first-child { border-start-start-radius: 4px; border-end-start-radius: 4px; }
.stack span:last-child { border-start-end-radius: 4px; border-end-end-radius: 4px; }
.hatch { background: repeating-linear-gradient(45deg, ${P.textTertiary} 0 2px, ${P.surfaceChip} 2px 5px); }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--text-2); }
.legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-inline-end: 5px; vertical-align: -1px; }
.cat { white-space: nowrap; }
.cat svg { color: var(--text-2); margin-inline-end: 4px; vertical-align: -2px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: start; font-weight: 500; color: var(--text-2); font-size: 9.5px; padding: 4px 6px; border-bottom: 1px solid var(--divider); }
td { padding: 4px 6px; border-bottom: 1px solid var(--divider); vertical-align: top; }
tr { break-inside: avoid; }
td.r, th.r { text-align: end; }
.bar { position: relative; height: 6px; background: var(--muted); border-radius: 3px; min-width: 60px; margin-top: 4px; }
.bar b { position: absolute; inset-block: 0; inset-inline-start: 0; background: var(--accent); border-radius: 3px; }
.meter { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 6px 0; border-bottom: 1px solid var(--divider); break-inside: avoid; }
.meter .bar { grid-column: 1 / -1; height: 8px; border-radius: 4px; }
.meter .bar b { border-radius: 4px; }
.warning { color: var(--warning-text); }
.critical { color: var(--error-text); }
.warning svg, .critical svg { vertical-align: -2px; margin-inline-start: 3px; }
.ok { color: var(--success-text); }
.forecast svg { vertical-align: -2px; margin-inline-start: 0; }
.day td { background: var(--soft); font-weight: 500; color: var(--text-2); }
.in { color: var(--text-strong); font-weight: 500; }
ul { margin: 4px 0 0; padding-inline-start: 18px; }
li { margin: 2px 0; }
.forecast { background: var(--soft); border-radius: var(--r-plate); padding: 10px 12px; }
.forecast div + div { margin-top: 3px; }
footer { margin-top: 20px; color: var(--text-3); font-size: 9px; display: flex; align-items: center; gap: 6px; }
`;

type Tr = (key: LocaleKey, params?: Record<string, string | number>) => string;
type CatName = (category: string) => string;

/** Chat strings open with an emoji (see docs/BRAND.md); in print we drop it and use a Lucide icon where one helps. */
function plain(text: string): string {
  return text.replace(/^(?:[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]+\s*)+/u, "");
}

/** Built-in names come from the locale, the family's own from the lookup, the month total has its own string. */
function catNamer(tr: Tr, custom: CategoryLookup): CatName {
  return (category) => {
    const own = custom.get(category);
    if (own) return own.name;
    if (category === TOTAL_BUDGET) return tr("cat.total");
    if (isCustomCategory(category)) return category;
    return tr(`cat.${category}` as LocaleKey);
  };
}

function icon(name: IconName, size = 11): string {
  return iconSvg(name, { size, strokeWidth: 2 });
}

/** Category label for tables: a small Lucide icon plus the name. */
function catLabel(catName: CatName, category: string): string {
  return `<span class="cat">${icon(categoryIcon(category))}${escapeHtml(catName(category))}</span>`;
}

function delta(tr: Tr, locale: string, value: number | null): string {
  return value === null ? "" : `<div class="delta">${escapeHtml(tr("report.vs_prev", { pct: formatPercent(value, locale) }))}</div>`;
}

function shareBar(share: number): string {
  return `<div class="bar"><b style="width:${Math.max(0, Math.min(100, share))}%"></b></div>`;
}

/** Top five categories in palette order, everything else folded into one hatched "Other" segment. */
function stackedBar(tr: Tr, catName: CatName, locale: string, cats: CategoryStat[], total: number): string {
  if (total <= 0 || !cats.length) return "";
  const top = cats.slice(0, 5);
  const rest = cats.slice(5).reduce((sum, c) => sum + c.amount, 0);
  const segments = top.map((c, i) => ({ label: catName(c.category), amount: c.amount, color: P.slots[i]!, hatch: false }));
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

function categoryTable(tr: Tr, catName: CatName, view: ReportView, cats: CategoryStat[], withChange: boolean): string {
  const money = (n: number) => formatMoney(n, view.data.currency, view.locale);
  const rows = cats
    .map(
      (c) => `<tr><td>${catLabel(catName, c.category)}${shareBar(c.share)}</td><td class="r num">${money(c.amount)}</td><td class="r num">${c.share}%</td>${
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

function budgetMeters(catName: CatName, view: ReportView, budgets: BudgetStat[]): string {
  const money = (n: number) => formatMoney(n, view.data.currency, view.locale);
  return budgets
    .map((b) => {
      // Severity rides on fill colour plus an icon, never colour alone.
      const [color, track, mark] =
        b.pct > 100
          ? [P.error, P.errorBg, `<span class="critical">${icon("octagon-alert")}</span>`]
          : b.pct >= 80
            ? [P.warning, P.warningBg, `<span class="warning">${icon("triangle-alert")}</span>`]
            : ["var(--accent)", "var(--muted)", ""];
      return meter(catLabel(catName, b.category), `${money(b.spent)} / ${money(b.limit)} · ${b.pct}%${mark}`, b.pct, color, track);
    })
    .join("");
}

function goalMeters(view: ReportView, tr: Tr, goals: GoalStat[]): string {
  return goals
    .map((g) => {
      const money = (n: number) => formatMoney(n, g.currency, view.locale);
      const label = `<span class="cat">${icon("piggy-bank")}<b>${escapeHtml(g.title)}</b></span>`;
      // An open-ended stash: only what was put aside, no progress.
      if (g.target === null) return `<div class="meter"><div>${label}</div><div class="num">${money(g.saved)}</div></div>`;
      const pace = g.monthlyNeed && g.saved < g.target ? ` <span class="muted">· ${escapeHtml(tr("report.goal_pace", { amount: money(g.monthlyNeed) }))}</span>` : "";
      return meter(`${label}${pace}`, `${money(g.saved)} / ${money(g.target)} · ${g.pct ?? 0}%`, g.pct ?? 0, "var(--accent)", "var(--muted)");
    })
    .join("");
}

/** Who spent what: one meter per member, share of the attributed expenses, income in the small print. */
function personMeters(view: ReportView, people: PersonStat[]): string {
  const money = (n: number) => formatMoney(n, view.data.currency, view.locale);
  return people
    .map((p) => {
      const label = `<span class="cat">${icon("user")}${escapeHtml(p.name)}</span>`;
      const income = p.income > 0 ? ` <span class="muted">· +${money(p.income)}</span>` : "";
      return meter(label, `${money(p.expense)} · ${p.share}%${income}`, p.share, "var(--accent)", "var(--muted)");
    })
    .join("");
}

function transactionsTable(tr: Tr, catName: CatName, view: ReportView): string {
  const { data, locale } = view;
  // The author column only for a group with known names: in a private chat there is one person.
  const who = (userId: number | null) => (userId === null ? "" : (data.names[userId] ?? ""));
  const withAuthors = view.title !== null && data.transactions.some((tx) => who(tx.userId) !== "");
  const columns = withAuthors ? 4 : 3;
  let lastDay = "";
  const rows: string[] = [];
  for (const tx of data.transactions) {
    if (tx.occurredOn !== lastDay) {
      lastDay = tx.occurredOn;
      const label = DateTime.fromISO(tx.occurredOn, { zone: "utc" }).setLocale(locale).toLocaleString({ weekday: "short", day: "numeric", month: "long" });
      rows.push(`<tr class="day"><td colspan="${columns}">${escapeHtml(label)}</td></tr>`);
    }
    const sign = tx.kind === "income" ? "+" : "−";
    const own = formatMoney(tx.amount, tx.currency, locale);
    const converted =
      tx.currency !== data.currency && tx.amountBase !== null ? `<div class="muted">≈ ${formatMoney(tx.amountBase, data.currency, locale)}</div>` : "";
    // A record built up by replies lists its positions, each with its amount and, in a group, who added it.
    const note =
      tx.items && tx.items.length > 1
        ? tx.items
            .map((i) => {
              const by = withAuthors && who(i.userId) ? ` · ${escapeHtml(who(i.userId))}` : "";
              return `<div>${escapeHtml(i.note)} <span class="muted num">· ${formatMoney(i.amount, tx.currency, locale)}${by}</span></div>`;
            })
            .join("")
        : escapeHtml(tx.note);
    const author = withAuthors ? `<td class="muted">${escapeHtml(who(tx.userId))}</td>` : "";
    rows.push(`<tr><td>${catLabel(catName, tx.category)}</td><td>${note}</td>${author}<td class="r num ${tx.kind === "income" ? "in" : ""}">${sign}${own}${converted}</td></tr>`);
  }
  const authorHead = withAuthors ? `<th>${tr("report.col_who")}</th>` : "";
  return `<table><thead><tr><th>${tr("report.col_category")}</th><th>${tr("report.col_note")}</th>${authorHead}<th class="r">${tr(
    "report.col_amount",
  )}</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

/** Self-contained HTML for the PDF report: no scripts, no network, every user-provided string escaped. */
export function renderReportHtml(view: ReportView): string {
  const { data, locale } = view;
  const tr: Tr = (key, params) => t(locale, key, params);
  const catName = catNamer(tr, view.categories ?? NO_CUSTOM_CATEGORIES);
  const money = (n: number) => formatMoney(n, data.currency, locale);
  const period = escapeHtml(formatPeriod(data.period, locale));
  const generated = DateTime.now().setZone(view.tz).setLocale(locale).toLocaleString(DateTime.DATETIME_MED);
  const parts: string[] = [];

  parts.push(`<header><div><div class="brand">${markSvg({ size: 16 })}${escapeHtml(view.assistantName)}</div><h1>${escapeHtml(tr("report.title"))} · ${period}</h1>${
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
  const balance = data.month?.balance;
  const balanceLine =
    balance && balance.current !== null
      ? `<div><span class="muted">${icon("wallet")}</span> ${plain(tr("summary.balance", { amount: money(balance.current), date: formatDate(balance.asOf, locale) }))}</div>`
      : "";
  if (balanceLine && !(forecast && forecast.ahead > 0)) {
    parts.push(`<h2>${escapeHtml(tr("report.month_balance"))}</h2><div class="forecast">${balanceLine}</div>`);
  }
  if (forecast && forecast.ahead > 0) {
    const free =
      forecast.free >= 0
        ? `<span class="ok">${icon("check")}</span> ${plain(tr("summary.forecast_free", { amount: money(forecast.free) }))}${
            forecast.perDay ? tr("summary.forecast_per_day", { amount: money(forecast.perDay) }) : ""
          }`
        : `<span class="warning">${icon("triangle-alert")}</span> ${plain(tr("summary.forecast_short", { amount: money(-forecast.free) }))}<div class="muted">${plain(
            tr("summary.forecast_note"),
          )}</div>`;
    const partsAhead = [
      forecast.payments > 0 ? tr("summary.part_payments", { amount: money(forecast.payments) }) : "",
      forecast.plans > 0 ? tr("summary.part_plans", { amount: money(forecast.plans) }) : "",
      forecast.goals > 0 ? tr("summary.part_goals", { amount: money(forecast.goals) }) : "",
    ].filter(Boolean);
    parts.push(`<h2>${escapeHtml(tr("report.month_balance"))}</h2><div class="forecast">${balanceLine}<div><span class="muted">${icon("hourglass")}</span> ${plain(
      tr("summary.forecast_ahead", { amount: money(forecast.ahead), parts: partsAhead.join(", ") }),
    )}</div><div>${free}</div></div>`);
  }

  if (data.categories.length) {
    parts.push(`<h2>${escapeHtml(tr("report.by_category"))}</h2>${stackedBar(tr, catName, locale, data.categories, data.expense)}`);
    parts.push(categoryTable(tr, catName, view, data.categories, data.hasPrev));
  }
  if (data.incomeCategories.length) {
    parts.push(`<h2>${escapeHtml(tr("report.income_by_category"))}</h2>${categoryTable(tr, catName, view, data.incomeCategories, false)}`);
  }
  const spenders = data.byPerson.filter((p) => p.expense > 0);
  if (view.title !== null && spenders.length >= 2) parts.push(`<h2>${escapeHtml(tr("report.spent_by"))}</h2>${personMeters(view, spenders)}`);
  if (data.month?.outlook.budgets.length) parts.push(`<h2>${plain(tr("summary.budgets"))}</h2>${budgetMeters(catName, view, data.month.outlook.budgets)}`);
  if (data.month?.outlook.goals.length) parts.push(`<h2>${plain(tr("summary.goals"))}</h2>${goalMeters(view, tr, data.month.outlook.goals)}`);
  if (data.month?.outlook.plans.length) {
    const rows = data.month.outlook.plans
      .map(
        (p) =>
          `<tr><td>${catLabel(catName, p.category)}</td><td>${escapeHtml(p.title)}${
            p.overdue ? ` <span class="warning">· ${icon("hourglass")} ${escapeHtml(tr("plans.overdue"))}</span>` : ""
          }</td><td class="r num">${formatMoney(p.originalAmount, p.currency, locale)}</td></tr>`,
      )
      .join("");
    parts.push(`<h2>${plain(tr("summary.plans"))}</h2><table><tbody>${rows}</tbody></table>`);
  }
  const insights = data.month?.insights;
  if (insights && (insights.highlights.length || insights.tips.length)) {
    const list = (items: string[]) => `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
    if (insights.highlights.length) parts.push(`<h2>${plain(tr("summary.insights"))}</h2>${list(insights.highlights)}`);
    if (insights.tips.length) parts.push(`<h2>${plain(tr("summary.tips"))}</h2>${list(insights.tips)}`);
  }
  if (data.unconverted.length) {
    parts.push(`<p class="muted">${plain(tr("summary.unconverted", { list: data.unconverted.map((u) => formatMoney(u.amount, u.currency, locale)).join(", ") }))}</p>`);
  }
  parts.push(`<h2>${escapeHtml(tr("report.transactions", { count: data.transactions.length }))}</h2>${transactionsTable(tr, catName, view)}`);
  parts.push(`<footer>${markSvg({ size: 11, color: P.textTertiary })}${escapeHtml(view.assistantName)} · ${escapeHtml(tr("report.footer"))}</footer>`);

  return `<!doctype html><html lang="${escapeHtml(locale)}" dir="${RTL.has(locale) ? "rtl" : "ltr"}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<title>${escapeHtml(view.assistantName)} · ${period}</title><style>${CSS}</style></head><body>${parts.join("\n")}</body></html>`;
}
