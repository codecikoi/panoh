import { useState } from "react";
import { CategoryName, LoadError, Loading } from "../components";
import { dayLabel, formatMoney } from "../format";
import { useI18n } from "../i18n";
import { tg } from "../telegram";
import type { Household, Tx } from "../types";
import { useApi } from "../useApi";

export function OperationsScreen({ household, month }: { household: Household; month: string }) {
  const { t, locale } = useI18n();
  const res = useApi<{ transactions: Tx[] }>(`/households/${household.id}/transactions?month=${month}`);
  const [filter, setFilter] = useState<string | null>(null);
  if (res.error) return <LoadError onRetry={res.reload} />;
  if (!res.data) return <Loading />;

  const all = res.data.transactions;
  const categories = [...new Set(all.map((tx) => tx.category))];
  const rows = filter ? all.filter((tx) => tx.category === filter) : all;
  const days = new Map<string, Tx[]>();
  for (const tx of rows) days.set(tx.occurredOn, [...(days.get(tx.occurredOn) ?? []), tx]);

  return (
    <>
      {categories.length > 1 ? (
        <div className="chips">
          <button className={filter === null ? "on" : ""} onClick={() => (tg.tap(), setFilter(null))}>
            {t("dash.all")}
          </button>
          {categories.map((c) => (
            <button key={c} className={filter === c ? "on" : ""} onClick={() => (tg.tap(), setFilter(c))}>
              <CategoryName category={c} />
            </button>
          ))}
        </div>
      ) : null}
      {!rows.length ? <div className="empty">{t("dash.no_operations")}</div> : null}
      {[...days.entries()].map(([day, list]) => (
        <section key={day}>
          <div className="day">{dayLabel(day, locale)}</div>
          <div className="card rows">
            {list.map((tx) => (
              <div key={tx.id} className="row">
                <div className="title">
                  <CategoryName category={tx.category} />
                </div>
                <div className="right num">
                  {tx.kind === "income" ? "+" : "−"}
                  {formatMoney(tx.amount, tx.currency, locale)}
                </div>
                <div className="meta title">{tx.note}</div>
                <div className="meta right num">
                  {tx.status === "pending" ? <span className="pending">{t("dash.pending")}</span> : null}
                  {tx.currency !== household.baseCurrency && tx.amountBase !== null ? `≈ ${formatMoney(tx.amountBase, household.baseCurrency, locale)}` : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
