import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { IconName } from "@madat/core/brand/icons";
import { canAuthenticate } from "./api";
import { Icon, Mark } from "./components";
import { currentMonth, monthLabel, shiftMonth } from "./format";
import { I18nContext, loadStrings, makeI18n, type I18n, type Strings } from "./i18n";
import { tg } from "./telegram";
import type { Household, MeResponse } from "./types";
import { useApi } from "./useApi";
import { GoalsScreen } from "./screens/GoalsScreen";
import { MonthScreen } from "./screens/MonthScreen";
import { OperationsScreen } from "./screens/OperationsScreen";
import { PlansScreen } from "./screens/PlansScreen";

type Tab = "month" | "operations" | "plans" | "goals";
const TABS: { id: Tab; icon: IconName; key: string }[] = [
  { id: "month", icon: "chart-column", key: "dash.tab_month" },
  { id: "operations", icon: "receipt", key: "dash.tab_operations" },
  { id: "plans", icon: "calendar", key: "dash.tab_plans" },
  { id: "goals", icon: "target", key: "dash.tab_goals" },
];

/** Opened from a group: t.me/<bot>/<app>?startapp=<householdId>_<YYYY-MM>; from a private chat: ?month=YYYY-MM. */
function initialSelection(): { householdId: number | null; month: string | null } {
  const query = new URLSearchParams(location.search);
  const m = /^(\d+)_(\d{4}-\d{2})$/.exec(tg.startParam ?? "");
  const month = m?.[2] ?? query.get("month");
  return {
    householdId: m ? Number(m[1]) : query.get("household") ? Number(query.get("household")) : null,
    month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null,
  };
}

export function App() {
  const initial = useMemo(initialSelection, []);
  const me = useApi<MeResponse>(canAuthenticate ? "/me" : null);
  const [householdId, setHouseholdId] = useState<number | null>(initial.householdId);
  const [month, setMonth] = useState<string | null>(initial.month);
  const [tab, setTab] = useState<Tab>(() => {
    const requested = new URLSearchParams(location.search).get("tab");
    return TABS.some((x) => x.id === requested) ? (requested as Tab) : "month";
  });
  const [base, setBase] = useState<{ locale: string; strings: Strings } | null>(null);

  const households = me.data?.households ?? [];
  const household: Household | undefined = households.find((h) => h.id === householdId) ?? households[0];
  const nowMonth = household ? currentMonth(household.timezone) : null;
  const shownMonth = month ?? nowMonth;

  useEffect(() => {
    const locale = household?.locale ?? tg.languageCode.split("-")[0] ?? "en";
    loadStrings(locale)
      .then(({ locale: l, strings }) => {
        setBase({ locale: l, strings });
        document.documentElement.lang = l;
        document.documentElement.dir = ["ar", "fa", "he", "ur"].includes(l) ? "rtl" : "ltr";
      })
      .catch(() => setBase({ locale: "en", strings: {} }));
  }, [household?.locale]);

  // The family's own categories are named like built-in ones: `cat.<key>` → their name.
  const i18n: I18n | null = useMemo(() => {
    if (!base) return null;
    const own = Object.fromEntries((household?.categories ?? []).map((c) => [`cat.${c.key}`, c.name]));
    return makeI18n(base.locale, { ...base.strings, ...own });
  }, [base, household]);

  if (!i18n) return null;
  const { t, locale } = i18n;

  let body: ReactNode;
  if (!canAuthenticate) body = <div className="empty">{t("dash.not_in_telegram")}</div>;
  else if (me.error) body = <div className="empty">{t("dash.error")}</div>;
  else if (!me.data) body = null;
  else if (!household || !shownMonth) body = <div className="empty">{t("dash.no_households")}</div>;
  else if (tab === "month") body = <MonthScreen household={household} month={shownMonth} />;
  else if (tab === "operations") body = <OperationsScreen household={household} month={shownMonth} />;
  else if (tab === "plans") body = <PlansScreen household={household} />;
  else body = <GoalsScreen household={household} />;

  const monthTabs = tab === "month" || tab === "operations";
  return (
    <I18nContext.Provider value={i18n}>
      {household && shownMonth ? (
        <div className="top">
          {households.length > 1 ? (
            <div className="household">
              <select value={household.id} onChange={(e) => (tg.tap(), setHouseholdId(Number(e.target.value)))}>
                {households.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.title ?? t("dash.private_chat")}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="brandrow">
              <Mark size={18} color="var(--accent)" />
              {t("app.name")}
            </div>
          )}
          {monthTabs ? (
            <div className="months">
              <button aria-label="previous month" onClick={() => (tg.tap(), setMonth(shiftMonth(shownMonth, -1)))}>
                <Icon name="chevron-left" />
              </button>
              <h1>{monthLabel(shownMonth, locale)}</h1>
              <button aria-label="next month" disabled={shownMonth >= nowMonth!} onClick={() => (tg.tap(), setMonth(shiftMonth(shownMonth, 1)))}>
                <Icon name="chevron-right" />
              </button>
            </div>
          ) : (
            <div className="months" style={{ justifyContent: "center" }}>
              <h1>{t(TABS.find((x) => x.id === tab)!.key)}</h1>
            </div>
          )}
        </div>
      ) : null}
      <main>{body}</main>
      {household ? (
        <nav className="tabs">
          {TABS.map((x) => (
            <button key={x.id} className={tab === x.id ? "on" : ""} onClick={() => (tg.tap(), setTab(x.id), window.scrollTo(0, 0))}>
              <Icon name={x.icon} />
              {t(x.key)}
            </button>
          ))}
        </nav>
      ) : null}
    </I18nContext.Provider>
  );
}
