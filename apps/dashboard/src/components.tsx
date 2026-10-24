import type { ReactNode } from "react";
import type { CategoryStat } from "@madat/core";
import { CATEGORY_EMOJI, type Category } from "@madat/core/categories";
import { useI18n } from "./i18n";

export function CategoryName({ category }: { category: string }) {
  const { t } = useI18n();
  return (
    <>
      {CATEGORY_EMOJI[category as Category] ?? "📦"} {t(`cat.${category}`)}
    </>
  );
}

const SLOTS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)"];

/**
 * Part-to-whole at a glance: the five biggest categories in palette order plus a hatched "Other".
 * Tapping a segment (or its legend entry) highlights that category in the list below.
 */
export function ShareBar({ categories, total, active, onPick }: { categories: CategoryStat[]; total: number; active: string | null; onPick: (category: string | null) => void }) {
  const { t, locale } = useI18n();
  if (total <= 0 || !categories.length) return null;
  const top = categories.slice(0, 5);
  const rest = categories.slice(5);
  const restAmount = rest.reduce((s, c) => s + c.amount, 0);
  const pct = (n: number) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(n / total);
  const segments = [
    ...top.map((c, i) => ({ key: c.category, label: t(`cat.${c.category}`), amount: c.amount, color: SLOTS[i]!, hatch: false })),
    ...(restAmount > 0 ? [{ key: "__other", label: t("report.other"), amount: restAmount, color: "", hatch: true }] : []),
  ];
  const pick = (key: string) => onPick(active === key || key === "__other" ? null : key);
  return (
    <>
      <div className="stack" role="img" aria-label={segments.map((s) => `${s.label} ${pct(s.amount)}`).join(", ")}>
        {segments.map((s) => (
          <button
            key={s.key}
            className={`${s.hatch ? "hatch" : ""} ${active && active !== s.key ? "dim" : ""}`}
            style={{ flex: `${s.amount} 1 0`, ...(s.hatch ? {} : { background: s.color }) }}
            onClick={() => pick(s.key)}
            aria-label={`${s.label} ${pct(s.amount)}`}
          />
        ))}
      </div>
      <div className="legend">
        {segments.map((s) => (
          <button key={s.key} onClick={() => pick(s.key)}>
            <i className={s.hatch ? "hatch" : ""} style={s.hatch ? {} : { background: s.color }} />
            {s.label} · {pct(s.amount)}
          </button>
        ))}
      </div>
    </>
  );
}

export function Bar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="bar">
      <b style={{ width: `${Math.max(0, Math.min(100, value))}%`, ...(color ? { background: color } : {}) }} />
    </div>
  );
}

/**
 * Progress meter: name and percent, then amounts and status, then an optional note.
 * For limits (`severity`) the fill turns warning/critical near and over 100%, always with an icon, never colour alone;
 * savings goals only ever show progress.
 */
export function Meter({ label, pct, amounts, status, note, severity = false }: { label: ReactNode; pct: number; amounts: string; status?: string; note?: string; severity?: boolean }) {
  const [color, icon] = !severity ? [undefined, ""] : pct > 100 ? ["var(--critical)", " 🚨"] : pct >= 80 ? ["var(--warning)", " ⚠️"] : [undefined, ""];
  return (
    <div className="row meter">
      <div className="title">{label}</div>
      <div className="right num">
        {pct}%{icon}
      </div>
      <div className="line">
        <span className="num">{amounts}</span>
        {status ? <span>{status}</span> : null}
      </div>
      <Bar value={pct} {...(color ? { color } : {})} />
      {note ? <div className="meta" style={{ gridColumn: "1 / -1" }}>{note}</div> : null}
    </div>
  );
}

export function Loading() {
  return (
    <>
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="empty">
      <div>{t("dash.error")}</div>
      <button className="primary" onClick={onRetry}>
        {t("dash.retry")}
      </button>
    </div>
  );
}
