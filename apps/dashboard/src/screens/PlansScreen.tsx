import { categoryIcon } from "@madat/core/categories";
import { CategoryName, Icon, LoadError, Loading, Plate, Row } from "../components";
import { dateTimeLabel, dayLabel, formatMoney, monthLabel } from "../format";
import { useI18n } from "../i18n";
import type { Household, PlanRow, RecurringRow, ReminderRow } from "../types";
import { useApi } from "../useApi";

export function PlansScreen({ household }: { household: Household }) {
  const { t, locale } = useI18n();
  const recurring = useApi<{ recurring: RecurringRow[] }>(`/households/${household.id}/recurring`);
  const plans = useApi<{ plans: PlanRow[] }>(`/households/${household.id}/plans`);
  const reminders = useApi<{ reminders: ReminderRow[] }>(`/households/${household.id}/reminders`);
  if (recurring.error || plans.error || reminders.error) {
    return <LoadError onRetry={() => (recurring.reload(), plans.reload(), reminders.reload())} />;
  }
  if (!recurring.data || !plans.data || !reminders.data) return <Loading />;

  const payments = [...recurring.data.recurring].sort((a, b) => a.next.date.localeCompare(b.next.date));
  const own = reminders.data.reminders.filter((r) => r.kind === "reminder");
  const today = new Date().toISOString().slice(0, 10);
  if (!payments.length && !plans.data.plans.length && !own.length) return <div className="empty">{t("dash.no_plans")}</div>;

  return (
    <>
      {plans.data.plans.length ? (
        <>
          <div className="section-title">{t("dash.plans")}</div>
          <div className="card rows">
            {plans.data.plans.map((p) => (
              <Row key={p.id} plate={<Plate icon={categoryIcon(p.category)} />}>
                <div className="title">{p.title}</div>
                <div className="right num strong">{formatMoney(p.amount, p.currency, locale)}</div>
                <div className="line">
                  <span>
                    <CategoryName category={p.category} />
                  </span>
                  <span>
                    {p.dateApproximate ? t("dash.whole_month", { month: monthLabel(p.plannedOn.slice(0, 7), locale) }) : dayLabel(p.plannedOn, locale, true)}
                    {p.plannedOn < today ? (
                      <>
                        {" · "}
                        <span className="overdue">
                          <Icon name="hourglass" />
                          {t("plans.overdue")}
                        </span>
                      </>
                    ) : null}
                  </span>
                </div>
              </Row>
            ))}
          </div>
        </>
      ) : null}
      {payments.length ? (
        <>
          <div className="section-title">{t("dash.payments")}</div>
          <div className="card rows">
            {payments.map((p) => (
              <Row key={p.id} plate={<Plate icon="credit-card" />}>
                <div className="title">{p.name}</div>
                <div className="right num strong">{p.amount !== null ? formatMoney(p.amount, p.currency, locale) : "—"}</div>
                <div className="meta">{dayLabel(p.next.date, locale, true)}</div>
                <div className="meta right">{p.lastPaidPeriod === p.next.date.slice(0, 7) ? t("dash.paid") : ""}</div>
              </Row>
            ))}
          </div>
        </>
      ) : null}
      {own.length ? (
        <>
          <div className="section-title">{t("dash.reminders")}</div>
          <div className="card rows">
            {own.map((r) => (
              <Row key={r.id} plate={<Plate icon="bell" />}>
                <div className="title">{r.title}</div>
                <div className="right meta">{dateTimeLabel(r.dueAt, locale, household.timezone)}</div>
              </Row>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
