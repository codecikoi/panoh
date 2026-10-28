/**
 * The Madat mark, "M = pair": the letter M whose two stems end in dots, so it also reads as two people side by side.
 * Approved 2026-10-28. Source file: brand/madat-mark.svg (64×64 grid). Clear space is one dot radius (8/64) on every side,
 * minimum size 16px on screen; on the brand magenta it is white, on light surfaces it is magenta, never a third colour.
 */

export const MARK_VIEWBOX = "0 0 64 64";

/** Inner markup of the mark in the given colour, on the 64×64 grid. */
export function markBody(color: string): string {
  return (
    `<circle cx="13" cy="12.5" r="8" fill="${color}"/><circle cx="51" cy="12.5" r="8" fill="${color}"/>` +
    `<path d="M13 56V28L32 46L51 28V56" fill="none" stroke="${color}" stroke-width="10.5" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

export interface MarkOptions {
  /** Rendered size in CSS px (default 24). */
  size?: number;
  /** Mark colour (default the brand magenta, or white when a background is given). */
  color?: string;
  /** Fills a rounded square behind the mark and shrinks the mark to 64% of it (the app-icon look). */
  bg?: string;
  label?: string;
}

/** Inline `<svg>` of the mark; with `bg` it becomes the app icon: rounded magenta square, white mark. */
export function markSvg(options: MarkOptions = {}): string {
  const { size = 24, bg, label } = options;
  const color = options.color ?? (bg ? "#FFFFFF" : "#E40163");
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, "&quot;")}"` : 'aria-hidden="true"';
  const body = bg
    ? `<rect width="64" height="64" rx="14.5" fill="${bg}"/><g transform="translate(11.52 11.52) scale(0.64)">${markBody(color)}</g>`
    : markBody(color);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${MARK_VIEWBOX}" ${a11y}>${body}</svg>`;
}
