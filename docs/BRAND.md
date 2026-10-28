# Madat brand guide

How Madat looks and sounds, and where each piece lives in the code. The source of truth for colours, radii, type and
icons is `packages/core/src/brand/` (TypeScript tokens); the dashboard and the PDF report both read from it, so a change
there changes both. Chat messages are plain Telegram text and use a small, fixed set of emoji instead (see below).

## Name

**Madat** (also *madad*): "help" in Arabic, Persian, Uzbek and Tajik. Two syllables, reads the same in every script,
and does not collide with everyday words, so "Madat, groceries 150k" is unambiguous as an address to the bot.
The Telegram display name is "Madat — family helper" (set by the bot on start-up, in 30 languages). Families may rename
the assistant for their own chat (`/name`); the brand name and the mark stay the same.

## Voice

Madat is a member of the family, not a service. It writes the way a careful, friendly person would: short sentences,
no jargon, no exclamation marks in a row. It confirms every record, asks when unsure, and never invents a number: the code
does the arithmetic, the model only phrases it. Advice is specific ("cafés are 40% above last month") and never preachy.

## The mark: "M = pair"

`brand/madat-mark.svg` (64×64 grid). The letter M whose two stems end in dots, so the same shape reads as a monogram and
as two people side by side: a couple keeping one budget.

- Geometry: dots r=8 at (13, 12.5) and (51, 12.5); stroke path `M13 56 V28 L32 46 L51 28 V56`, width 10.5, round caps and joins.
- Colours: white on the brand magenta, or magenta `#E40163` on light surfaces. Never a third colour, never a gradient, never an outline.
- Clear space: one dot radius (8/64 of the width) on every side. Minimum size 16 px on screen, 4 mm in print.
- App icon: magenta rounded square (radius 22.5%), the mark at 64% of the width, centred. `apps/dashboard/public/icon.svg`, `brand/avatar-magenta.png` (1024², Telegram bot avatar), `brand/miniapp-cover-640x360.png` (BotFather Mini App photo).
- Code: `markSvg()` / `markBody()` in `packages/core/src/brand/mark.ts`; React `<Mark>` in `apps/dashboard/src/components.tsx`.

## Colour

Tokens come from the eSmart UI kit (adopted 2026-10-28). Light values below; the dark scheme in `tokens.ts` is derived from
them (plum-tinted darks, a lighter magenta for text), not from Telegram's theme.

| Token | Light | Use |
|---|---|---|
| `accent` | `#E40163` | primary buttons, the mark, active tab, fills |
| `accentPressed` | `#B4004F` | pressed primary button |
| `accentTint` | `#FFE0EC` | selected chips, badges, icon plates |
| `accentField` | `#FFF6FA` | highlighted rows and fields |
| `textStrong` / `textPrimary` | `#1B1E29` / `#3C3C43` | headings and amounts / body |
| `textSecondary` / `textTertiary` | `#6E747E` / `#9AA0AC` | labels / captions and section titles |
| `surfaceScreen` / `surfaceCard` | `#F0ECEE` / `#FFFFFF` | page / cards |
| `surfaceMuted` / `surfaceSoft` / `surfaceChip` | `#F4F4F4` / `#F6F5F6` / `#EEF1F5` | tracks, tiles, neutral plates |
| `border` / `divider` | `#E2E6E9` / `#EBEBEF` | field borders / row separators |
| `success` / `successText` | `#27B768` / `#3D6B55` | positive states |
| `warning` / `warningText` / `warningBg` | `#E89128` / `#8A5A12` / `#FFF6E8` | limit at 80%+, overdue |
| `error` / `errorText` / `errorBg` | `#E53935` / `#B3261E` / `#FDE8E7` | limit exceeded, shortfall |

Categorical colours (charts, the five biggest categories): `#2A78D6` `#EB6834` `#1BAF7A` `#EDA100` `#7A5AF5`, with washes
`#DFEAFB` `#FDE3D8` `#D8F3E8` `#FCEFCF` `#E9E3FD`. Slot 5 is violet so no chart colour competes with the magenta accent.
Everything past the fifth category is one hatched "Other" segment, never a sixth hue. Status is never colour alone: a limit
near or over 100% also carries an icon.

## Type, radii, spacing

- Font: Inter where installed (the bot image installs it for PDFs), otherwise the platform face (SF on iOS/macOS, Roboto on Android), then Noto for other scripts. Weights 400/500/600 only.
- Scale: display 28/600, title 20/600, body 16/400, body 14, caption 13, caption 12/500, button 16/500. Amounts use tabular figures.
- Radii: badge 8, field 12, plate 14, card 16, bubble 18, tile 20, sheet 24, pill 100.
- Spacing: 4/8/12/16/20/24; 16 at screen edges, 20 inside cards, controls 56 tall, touch targets 48.

## Icons

[Lucide](https://lucide.dev) (ISC), 24-px grid, 2-px round strokes, the same grid as the kit's own icons. The ~50 icons the
product needs are vendored as inner SVG markup in `packages/core/src/brand/icons.ts` (`iconSvg()` for HTML strings, React
`<Icon>` in the dashboard), so neither app ships the icon package. Category → icon lives in `CATEGORY_ICON`
(`packages/core/src/categories.ts`) next to the emoji map; new categories get both.

Tabs: month `chart-column`, operations `receipt`, plans `calendar`, goals `target`. Payments `credit-card`, reminders `bell`,
savings `piggy-bank`, overdue and pending `hourglass`, limit warning `triangle-alert`, limit exceeded `octagon-alert`.

## Emoji in chat

Telegram messages cannot carry SVG, so chat keeps emoji: the category emoji (`CATEGORY_EMOJI`) and one icon per meaning,
always at the start of the line:

| | Meaning |
|---|---|
| ✅ | done, saved, paid, yes, free money |
| 🗑 | deleted, cancel |
| ✏️ | edit, updated |
| 🤔 | a question back, waiting for confirmation, nothing recognised |
| ⚠️ / 🚨 | attention (limit at 80%+, shortfall) / limit exceeded |
| ⏰ / 🔁 / 💳 | reminder / recurring payment / payment alert |
| 🗓 | plan, date, upcoming |
| ⏳ | still ahead, overdue, snoozed, preparing |
| 🎯 / 💰 | limit, tip / savings, income |
| 📊 / 📄 | summary, dashboard / PDF report |
| 💡 / 👋 / 🎉 | insight / greeting / celebration |

Do not add new emoji to messages; reuse one from this table. The settings menu (⚙️ 🌐 💱 🕒 🔑 ✏️) is the one place with
icon-per-item buttons.

## Assets

- `brand/madat-mark.svg` — the mark, source file.
- `brand/avatar-magenta.svg|png` — bot avatar (BotFather `/setuserpic`), 1024×1024.
- `brand/avatar-white.svg|png` — mark on white, for light backgrounds and documents.
- `brand/mark-magenta-transparent-1024.png`, `brand/mark-white-transparent-1024.png` — the mark alone on a transparent background, for compositing.
- `brand/miniapp-cover-640x360.png` — Mini App photo (BotFather `/myapps` → Edit Photo).
- `apps/dashboard/public/icon.svg` — favicon / app icon.
