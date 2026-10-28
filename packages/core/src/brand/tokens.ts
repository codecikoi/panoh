/**
 * Madat design tokens: the eSmart UI kit (colours, radii, spacing, type) adopted for Madat on 2026-10-28.
 * One source for the dashboard (CSS variables injected at start-up) and the PDF report (inlined into its stylesheet),
 * so a colour changes in one place. Chat messages use emoji instead (Telegram cannot render SVG), see docs/BRAND.md.
 */

export type Scheme = "light" | "dark";

export interface BrandPalette {
  /** Brand magenta: primary buttons, the mark, active states. White text on it passes AA. */
  accent: string;
  accentPressed: string;
  /** Light magenta wash for selected chips, badges and icon plates. */
  accentTint: string;
  /** Faint magenta wash for highlighted rows and fields. */
  accentField: string;
  /** Magenta that is readable as text/links on the card surface (the plain accent is too dark on dark cards). */
  accentText: string;
  textStrong: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;
  /** Page background behind the cards. */
  surfaceScreen: string;
  surfaceCard: string;
  surfaceMuted: string;
  surfaceSoft: string;
  surfaceChip: string;
  surfacePressed: string;
  border: string;
  borderSoft: string;
  divider: string;
  success: string;
  successText: string;
  warning: string;
  warningText: string;
  warningBg: string;
  error: string;
  errorText: string;
  errorBg: string;
  /** Categorical slots 1–5 of the validated dataviz palette (slot 5 is violet, not pink, to stay clear of the magenta accent). */
  slots: readonly [string, string, string, string, string];
  /** Matching washes for icon plates behind each slot. */
  slotTints: readonly [string, string, string, string, string];
}

export const PALETTE: Record<Scheme, BrandPalette> = {
  light: {
    accent: "#E40163",
    accentPressed: "#B4004F",
    accentTint: "#FFE0EC",
    accentField: "#FFF6FA",
    accentText: "#E40163",
    textStrong: "#1B1E29",
    textPrimary: "#3C3C43",
    textSecondary: "#6E747E",
    textTertiary: "#9AA0AC",
    textDisabled: "#C4C2C6",
    surfaceScreen: "#F0ECEE",
    surfaceCard: "#FFFFFF",
    surfaceMuted: "#F4F4F4",
    surfaceSoft: "#F6F5F6",
    surfaceChip: "#EEF1F5",
    surfacePressed: "#E8E6E7",
    border: "#E2E6E9",
    borderSoft: "#ECEBED",
    divider: "#EBEBEF",
    success: "#27B768",
    successText: "#3D6B55",
    warning: "#E89128",
    warningText: "#8A5A12",
    warningBg: "#FFF6E8",
    error: "#E53935",
    errorText: "#B3261E",
    errorBg: "#FDE8E7",
    slots: ["#2A78D6", "#EB6834", "#1BAF7A", "#EDA100", "#7A5AF5"],
    slotTints: ["#DFEAFB", "#FDE3D8", "#D8F3E8", "#FCEFCF", "#E9E3FD"],
  },
  // Derived from the light kit, not from Telegram's theme: plum-tinted darks, lighter magenta for text.
  dark: {
    accent: "#E40163",
    accentPressed: "#B4004F",
    accentTint: "#3D1230",
    accentField: "#2A1422",
    accentText: "#FF5C9A",
    textStrong: "#F4F1F3",
    textPrimary: "#E3DEE2",
    textSecondary: "#A39DA8",
    textTertiary: "#7C757F",
    textDisabled: "#4F4852",
    surfaceScreen: "#141116",
    surfaceCard: "#1E1A20",
    surfaceMuted: "#26222A",
    surfaceSoft: "#231F27",
    surfaceChip: "#2B2630",
    surfacePressed: "#332D38",
    border: "#332E37",
    borderSoft: "#2B2630",
    divider: "#2E2932",
    success: "#34C97A",
    successText: "#7FD9A8",
    warning: "#F0A23F",
    warningText: "#F5C27A",
    warningBg: "#33260F",
    error: "#F0524E",
    errorText: "#FF8A86",
    errorBg: "#3A1716",
    slots: ["#3987E5", "#D95926", "#199E70", "#C98500", "#8F73FF"],
    slotTints: ["#1A2A44", "#3A1F14", "#12302A", "#332A10", "#28224A"],
  },
};

/** Corner radii in px, by what they wrap. */
export const RADIUS = { badge: 8, field: 12, plate: 14, card: 16, bubble: 18, tile: 20, sheet: 24, pill: 100 } as const;

/** Spacing scale in px; screens use 16 at the edges, cards 20 inside, controls are 56 tall, touch targets 48. */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, screen: 16, card: 20, control: 56, touch: 48 } as const;

/** Inter where installed, otherwise the platform face (SF on iOS/macOS, Roboto on Android), then Noto for other scripts. */
export const FONT_FAMILY =
  '"Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Noto Sans", system-ui, sans-serif';

/** Type scale: size/weight pairs from the kit. */
export const TYPE = {
  display: { size: 28, weight: 600 },
  title: { size: 20, weight: 600 },
  body: { size: 16, weight: 400 },
  body14: { size: 14, weight: 400 },
  caption: { size: 13, weight: 400 },
  caption12: { size: 12, weight: 500 },
  button: { size: 16, weight: 500 },
} as const;

/**
 * CSS custom property declarations (no selector) for one scheme, e.g. `--accent:#E40163;--bg:#F0ECEE;…`.
 * Wrap them yourself: `:root{…}` for light, `:root[data-scheme="dark"]{…}` for dark.
 */
export function brandCssVars(scheme: Scheme): string {
  const p = PALETTE[scheme];
  const vars: Record<string, string> = {
    accent: p.accent,
    "accent-pressed": p.accentPressed,
    "accent-tint": p.accentTint,
    "accent-field": p.accentField,
    "accent-text": p.accentText,
    "text-strong": p.textStrong,
    text: p.textPrimary,
    "text-2": p.textSecondary,
    "text-3": p.textTertiary,
    "text-disabled": p.textDisabled,
    bg: p.surfaceScreen,
    card: p.surfaceCard,
    muted: p.surfaceMuted,
    soft: p.surfaceSoft,
    chip: p.surfaceChip,
    pressed: p.surfacePressed,
    border: p.border,
    "border-soft": p.borderSoft,
    divider: p.divider,
    success: p.success,
    "success-text": p.successText,
    warning: p.warning,
    "warning-text": p.warningText,
    "warning-bg": p.warningBg,
    error: p.error,
    "error-text": p.errorText,
    "error-bg": p.errorBg,
    font: FONT_FAMILY,
  };
  p.slots.forEach((c, i) => (vars[`s${i + 1}`] = c));
  p.slotTints.forEach((c, i) => (vars[`t${i + 1}`] = c));
  for (const [k, v] of Object.entries(RADIUS)) vars[`r-${k}`] = `${v}px`;
  return Object.entries(vars)
    .map(([k, v]) => `--${k}:${v}`)
    .join(";");
}
