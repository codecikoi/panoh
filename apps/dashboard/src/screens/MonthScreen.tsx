import { useState } from "react";
import type { CategoryStat } from "@madat/core";
import { categoryIcon } from "@madat/core/categories";
import { apiPost } from "../api";
import { monthChanges } from "../changes";
import { Bar, CategoryName, Icon, LoadError, Loading, Plate, Row, ShareBar } from "../components";
import { dayLabel, formatMoney, formatMoneyCompact, formatPercent, lastDayOf, monthLabel } from "../format";
import { useI18n } from "../i18n";
import { tg } from "../telegram";
import type { Household, SummaryResponse } from "../types";
import { useApi } from "../useApi";

export function MonthScreen({ household, month }: { household: Household; month: string }) {
  const { t, locale } = useI18n();
  // Numbers first (fast); the AI insights are filled in by a second request.
  const base = useApi<SummaryResponse>(`/households/${household.id}/summary?month=${month}&insights=0`);
  const withInsights = useApi<SummaryResponse>(base.data ? `/households/${household.id}/summary?month=${month}` : null);
  const [active, setActive] = useState<string | null>(null);
  const [pdf, setPdf] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  if (base.error) return <LoadError onRetry={base.reload} />;
  if (!base.data) return <Loading />;
  const s = base.data.summary;
  const insights = withInsights.data?.insights ?? null;
  const money = (n: number) => formatMoney(n, s.currency, locale);
  const f = s.outlook.forecast;

  if (s.recordCount === 0) return <div className="empty">{t("dash.empty_month", { month: monthLabel(month, locale) })}</div>;

  const requestPdf = async () => {
    setPdf("sending");
    try {
      await apiPost(`/households/${household.id}/report`, { from: `${month}-01`, to: lastDayOf(month) });
      setPdf("sent");
      tg.notify("success");
    } catch {
      setPdf("failed");
      tg.notify("error");
    }
  };

  const changes = monthChanges(s);
  const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));
  // Who spent what: only in a group and only when at least two members have expenses.
  const spenders = household.chatType === "private" ? [] : s.byPerson.filter((p) => p.expense > 0);

  return (
    <>
      <div className="kpis">
        <div className="kpi wide">
          <div className="label">{t("dash.expenses")}</div>
          <div className="value num">{money(s.expense)}</div>
          <div className="sub">
            {s.expenseDeltaPct !== null ? t("dash.vs_prev_month", { pct: formatPercent(s.expenseDeltaPct, locale) }) : null}
            {s.isCurrentMonth && s.daysElapsed >= 3 && s.projected !== null ? (
              <div>
                {t("dash.per_day", { amount: money(s.avgPerDay) })} · {t("dash.projected", { amount: money(s.projected) })}
              </div>
            ) : null}
          </div>
        </div>
        <div className="kpi">
          <div className="label">{t("dash.income")}</div>
          <div className="value num">{formatMoneyCompact(s.income, s.currency, locale)}</div>
          {s.incomeDeltaPct !== null ? <div className="sub">{t("dash.vs_prev_month", { pct: formatPercent(s.incomeDeltaPct, locale) })}</div> : null}
        </div>
        {f && f.ahead > 0 ? (
          <div className="kpi">
            <div className="label">{f.free >= 0 ? t("dash.free") : t("dash.short")}</div>
            <div className={`value num ${f.free < 0 ? "negative" : ""}`}>{formatMoneyCompact(Math.abs(f.free), s.currency, locale)}</div>
            <div className="sub">{f.free >= 0 && f.perDay ? t("dash.per_day", { amount: money(f.perDay) }) : t("dash.ahead", { amount: money(f.ahead) })}</div>
          </div>
        ) : (
          <div className="kpi">
            <div className="label">{t("dash.balance")}</div>
            <div className="value num">{(s.net > 0 ? "+" : s.net < 0 ? "−" : "") + formatMoneyCompact(Math.abs(s.net), s.currency, locale)}</div>
          </div>
        )}
      </div>
      {f && f.ahead > 0 && f.free < 0 ? <div className="toast">{t("dash.only_received")}</div> : null}
      {s.balance && s.balance.current !== null ? (
        <div className="card pad balance">
          <Icon name="wallet" />
          <span>{t("dash.money_left")}</span>
          <b className="num">{money(s.balance.current)}</b>
          <span className="meta">{t("dash.since", { date: dayLabel(s.balance.asOf, locale, true) })}</span>
        </div>
      ) : null}

      <div className="section-title">{t("dash.changes")}</div>
      <div className="card pad">
        {changes.firstMonth ? (
          <div className="hint">{t("dash.first_month")}</div>
        ) : !changes.grew.length && !changes.dropped.length && !changes.appeared.length ? (
          <div className="hint">{t("dash.nothing_changed")}</div>
        ) : (
          <>
            <ChangeGroup title={t("dash.grew")} items={changes.grew} render={(c) => `${signed(c.delta)}${c.deltaPct !== null ? ` · ${formatPercent(c.deltaPct, locale)}` : ""}`} />
            <ChangeGroup title={t("dash.dropped")} items={changes.dropped} render={(c) => `${signed(c.delta)}${c.deltaPct !== null ? ` · ${formatPercent(c.deltaPct, locale)}` : ""}`} />
            <ChangeGroup title={t("dash.new")} items={changes.appeared} render={(c) => money(c.amount)} />
          </>
        )}
      </div>

      <div className="section-title">{t("dash.categories")}</div>
      <div className="card">
        <ShareBar categories={s.categories} total={s.expense} active={active} onPick={setActive} />
        <div className="rows">
          {s.categories.map((c, i) => (
            <Row key={c.category} className={active === c.category ? "active" : ""} plate={<Plate icon={categoryIcon(c.category)} slot={i < 5 ? i : undefined} />}>
              <div className="title">
                {t(`cat.${c.category}`)}
                {c.prevAmount === 0 && s.hasPrev ? <span className="badge">{t("dash.new_badge")}</span> : null}
              </div>
              <div className="right num strong">{money(c.amount)}</div>
              <div className="meta">
                {c.share}% · {c.count}
              </div>
              <div className="meta right num">{c.deltaPct !== null ? formatPercent(c.deltaPct, locale) : ""}</div>
            </Row>
          ))}
        </div>
      </div>

      {spenders.length >= 2 ? (
        <>
          <div className="section-title">{t("dash.spent_by")}</div>
          <div className="card rows">
            {spenders.map((p) => (
              <Row key={p.userId} plate={<Plate icon="user" />}>
                <div className="title">{p.name}</div>
                <div className="right num strong">{money(p.expense)}</div>
                <div className="meta">
                  {p.share}% · {p.count}
                </div>
                <div className="meta right num">{p.income > 0 ? `+${money(p.income)}` : ""}</div>
                <Bar value={p.share} />
              </Row>
            ))}
          </div>
        </>
      ) : null}

      {insights && (insights.highlights.length > 0 || insights.tips.length > 0) ? (
        <>
          {insights.highlights.length ? (
            <>
              <div className="section-title">{t("dash.insights")}</div>
              <div className="card pad">
                <ul className="notes">{insights.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
              </div>
            </>
          ) : null}
          {insights.tips.length ? (
            <>
              <div className="section-title">{t("dash.tips")}</div>
              <div className="card pad">
                <ul className="notes">{insights.tips.map((h) => <li key={h}>{h}</li>)}</ul>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      <button className="primary" disabled={pdf === "sending"} onClick={() => void requestPdf()}>
        {t("dash.pdf_month")}
      </button>
      {pdf === "sent" ? <div className="toast">{household.chatType === "private" ? t("dash.pdf_sent_private") : t("dash.pdf_sent_group")}</div> : null}
      {pdf === "failed" ? <div className="toast">{t("dash.pdf_failed")}</div> : null}
    </>
  );
}

function ChangeGroup({ title, items, render }: { title: string; items: CategoryStat[]; render: (c: CategoryStat) => string }) {
  if (!items.length) return null;
  return (
    <div className="change-group">
      <h3>{title}</h3>
      {items.map((c) => (
        <div key={c.category} className="change">
          <span>
            <CategoryName category={c.category} />
          </span>
          <span className="num">{render(c)}</span>
        </div>
      ))}
    </div>
  );
}
