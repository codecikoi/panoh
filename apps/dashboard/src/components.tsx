import type { CSSProperties, ReactNode } from "react";
import type { CategoryStat } from "@madat/core";
import { ICONS, type IconName } from "@madat/core/brand/icons";
import { MARK_VIEWBOX, markBody } from "@madat/core/brand/mark";
import { categoryIcon } from "@madat/core/categories";
import { useI18n } from "./i18n";

/** A Lucide icon from the set vendored in core (24px grid, 2px round strokes), coloured by `currentColor`. */
export function Icon({ name, size, className, label }: { name: IconName; size?: number; className?: string; label?: string }) {
  return (
    <svg
      className={`icon ${className ?? ""}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      // Static markup from core, never user input.
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

/** The Madat mark ("M = pair"), in `currentColor` unless a colour is given. */
export function Mark({ size = 24, color = "currentColor", className }: { size?: number; color?: string; className?: string }) {
  return <svg className={className} viewBox={MARK_VIEWBOX} width={size} height={size} aria-hidden dangerouslySetInnerHTML={{ __html: markBody(color) }} />;
}

/** Round icon plate at the start of a row; with `slot` (0–4) it takes that category colour and wash, otherwise neutral. */
export function Plate({ icon, slot }: { icon: IconName; slot?: number }) {
  const style: CSSProperties | undefined = slot === undefined ? undefined : { background: `var(--t${slot + 1})`, color: `var(--s${slot + 1})` };
  return (
    <span className="plate" style={style}>
      <Icon name={icon} />
    </span>
  );
}

/** List row: an optional plate, then a two-column grid (title/right, meta/meta, full-width lines) passed as children. */
export function Row({ plate, className, children }: { plate?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`row ${className ?? ""}`}>
      {plate}
      <div className="body">{children}</div>
    </div>
  );
}

/** Inline category label: small icon plus the translated name, for chips, change lists and secondary lines. */
export function CategoryName({ category }: { category: string }) {
  const { t } = useI18n();
  return (
    <>
      <Icon name={categoryIcon(category)} className="ci" />
      {t(`cat.${category}`)}
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
 * Progress meter: plate, name and percent, then amounts and status, then an optional note.
 * For limits (`severity`) the fill turns warning/critical near and over 100%, always with an icon, never colour alone;
 * savings goals only ever show progress.
 */
export function Meter({ icon, label, pct, amounts, status, note, severity = false }: { icon: IconName; label: ReactNode; pct: number | null; amounts: string; status?: string; note?: string; severity?: boolean }) {
  const level = !severity || pct === null ? null : pct > 100 ? "critical" : pct >= 80 ? "warning" : null;
  const color = level === "critical" ? "var(--error)" : level === "warning" ? "var(--warning)" : undefined;
  return (
    <Row className="meter" plate={<Plate icon={icon} />}>
      <div className="title">{label}</div>
      <div className={`right num ${level ? `severity ${level}` : ""}`}>
        {level ? <Icon name={level === "critical" ? "octagon-alert" : "triangle-alert"} /> : null}
        {pct === null ? "" : `${pct}%`}
      </div>
      <div className="line">
        <span className="num">{amounts}</span>
        {status ? <span>{status}</span> : null}
      </div>
      {pct === null ? null : <Bar value={pct} {...(color ? { color } : {})} />}
      {note ? <div className="meta" style={{ gridColumn: "1 / -1" }}>{note}</div> : null}
    </Row>
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
      <Mark className="mark" />
      <div>{t("dash.error")}</div>
      <button className="primary" onClick={onRetry}>
        {t("dash.retry")}
      </button>
    </div>
  );
}
