import { categoryIcon } from "@madat/core/categories";
import { LoadError, Loading, Meter } from "../components";
import { dayLabel, formatMoney, monthLabel } from "../format";
import { useI18n } from "../i18n";
import type { Household, Outlook } from "../types";
import { useApi } from "../useApi";

export function GoalsScreen({ household }: { household: Household }) {
  const { t, locale } = useI18n();
  const res = useApi<Outlook>(`/households/${household.id}/planning`);
  if (res.error) return <LoadError onRetry={res.reload} />;
  if (!res.data) return <Loading />;
  const { budgets, goals } = res.data;
  const money = (n: number, currency = household.baseCurrency) => formatMoney(n, currency, locale);
  const deadline = (iso: string) => {
    const [y, m] = iso.split("-").map(Number) as [number, number];
    const monthEnd = new Date(Date.UTC(y, m, 0)).getUTCDate() === Number(iso.slice(8));
    return monthEnd ? monthLabel(iso.slice(0, 7), locale) : dayLabel(iso, locale, true);
  };

  return (
    <>
      <div className="section-title">{t("dash.limits")}</div>
      <div className={`card rows ${budgets.length ? "" : "pad"}`}>
        {budgets.length ? (
          budgets.map((b) => (
            <Meter
              key={b.category}
              icon={categoryIcon(b.category)}
              label={t(`cat.${b.category}`)}
              pct={b.pct}
              amounts={`${money(b.spent)} / ${money(b.limit)}`}
              status={b.remaining >= 0 ? t("dash.limit_left", { amount: money(b.remaining) }) : t("dash.limit_over", { amount: money(-b.remaining) })}
              severity
            />
          ))
        ) : (
          <div className="hint small">{t("dash.no_limits")}</div>
        )}
      </div>

      <div className="section-title">{t("dash.goals")}</div>
      <div className={`card rows ${goals.length ? "" : "pad"}`}>
        {goals.length ? (
          goals.map((g) => (
            <Meter
              key={g.id}
              icon="piggy-bank"
              label={g.title}
              pct={g.pct}
              amounts={`${money(g.saved, g.currency)} / ${money(g.target, g.currency)}`}
              {...(g.deadline ? { status: t("dash.goal_deadline", { date: deadline(g.deadline) }) } : {})}
              {...(g.monthlyNeed && g.saved < g.target ? { note: t("report.goal_pace", { amount: money(g.monthlyNeed, g.currency) }) } : {})}
            />
          ))
        ) : (
          <div className="hint small">{t("dash.no_goals")}</div>
        )}
      </div>
    </>
  );
}
