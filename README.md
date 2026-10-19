# Madat

A friendly family helper for money that lives in your Telegram chat. Mention an expense, an income, a bill, a planned purchase or a reminder in your own words and Madat keeps the books, nudges you about payments, watches limits and savings goals, tells you how much free money is left this month and sends a monthly summary with insights.

```
+ groceries 45$                      → ✍ Expense · $45 · 🛒 Groceries
remind me on Friday to pay the rent  → ⏰ I'll remind you Fri 17 Oct, 09:00
loan 300$ every month on the 15th    → 🔁 Loan · $300 · every month on day 15
paid the loan                        → ✅ Paid · Loan · $300
wedding gift 300$ in December        → 🗓 Plan · $300 · 🎁 Gifts · December 2026, no exact date
limit on groceries 400$              → 🎯 Limit for 🛒 Groceries: $400 a month
saving for a vacation 2000$ by July  → 🐷 Savings goal · vacation · ≈ $222 a month to make it
/summary                             → 📊 October 2026 … by category, vs September, tips
```

Works in a private chat or in a group with your partner. Any language: parsing is done by Claude, and the bot's own replies ship in 30 languages (English, Russian and Uzbek hand-written; the other 27 machine-translated, regenerate with `pnpm locales:translate --force`; after adding English keys run `pnpm locales:translate --missing`). Trigger keywords exist for all 30.

## How it works

```
Telegram ──▶ apps/bot ──▶ packages/core ──▶ Postgres
              │  grammY      ├─ ai/extract   (Claude Haiku 5.5: message → structured items)
              │  scheduler   ├─ ai/insights  (Claude Opus 5.5: numbers → highlights & tips)
              │              ├─ services     (households, transactions, reminders, recurring, planning, summary)
              │              └─ i18n, triggers, money, dates
Mini App ──▶ apps/api  (Hono, Telegram initData auth) ──▶ packages/core
```

* **Only marked messages are processed.** In groups the bot reacts to messages that start with the prefix (`+` by default), start with the bot's name (`madat …` or `мадат …`, any case), mention the bot, reply to it, contain a trigger keyword (`spent`, `paid`, `remind`, `потратил`, `оплатил`, `напомни`, `sarfladim`, …) or contain an amount with a currency. Everything else is ignored and never stored. Private chats process every message.
* **Numbers are computed in code.** The summary (totals, categories, month-over-month deltas, projections, upcoming bills) is calculated from the database; Claude only writes the short insights section from those numbers.
* **Every record is confirmed in chat** with ✏️ / 🗑 buttons. Reply to a confirmation with "not 150, 115" or "category transport" to fix it; "undo" or /undo removes the last record. Low-confidence parses ask "record this?" before counting.
* **Bills remind themselves.** A recurring payment reminds N days before and on the day, with a ✅ Paid button that also books the expense.
* **Plans, limits and savings.** A planned expense («gift 300$ in December», a month or an exact day) reminds on its day with ✅ Paid / snooze / cancel buttons and books the expense with plan-vs-fact. A monthly limit per category adds «🎯 Groceries: $360 of $400 (90%)» to each expense confirmation. A savings goal with a deadline shows the monthly pace; «put 200$ aside for the vacation» records a savings expense linked to the goal.
* **Free money this month.** The summary adds what is still ahead this month (unpaid bills, open plans, the goals' monthly pace) and the result: income already received − spent − ahead. Future income is deliberately not counted, so a negative number is a real shortfall.
* **Reminders without a time** get the household's default reminder time (09:00 unless changed in /settings) and a 🕒 button to pick another hour; replying «at 15:00» to the confirmation also moves it.
* **Multi-currency.** Each household has a base currency; other currencies are converted with daily rates (open.er-api.com). Unconverted amounts are shown separately, never silently dropped.

## Repository layout

```
apps/bot        Telegram bot + scheduler (one deployable)
apps/api        REST API for the dashboard (Mini App auth)
apps/dashboard  (stage 2) Telegram Mini App
packages/core   shared domain: DB schema & migrations, AI, services, i18n
```

pnpm workspace, TypeScript, Node 22+. Apps are bundled into a single file each with tsup, so the Docker images contain no `node_modules`.

## Quick start (local)

1. Create a bot with [@BotFather](https://t.me/BotFather): `/newbot`. Then `/setprivacy` → **Disable** so the bot can see group messages (needed for keyword/prefix triggers; mentions and replies work regardless). Optionally `/setcommands` is not needed, the bot registers its commands itself.
2. `cp .env.example .env` and fill `BOT_TOKEN` and `ANTHROPIC_API_KEY`. Leave `DATABASE_URL` empty to use the embedded PGlite database (no Postgres needed locally).
3. Install and run:

```bash
pnpm install
pnpm dev:bot        # long polling, migrations run automatically
pnpm dev:api        # optional, on PORT=8081
```

4. Write to the bot in a private chat, or add it to a group with your partner and send `/start`.

PGlite is single-process: run either the bot or the API against it, not both at once. To develop both together use Postgres (`docker compose up db` and set `DATABASE_URL=postgres://madat:madat@localhost:5432/madat`).

Useful commands:

```bash
pnpm test                 # unit + integration tests (PGlite in memory, Telegram and Claude mocked)
pnpm typecheck
pnpm build                # bundles apps/bot and apps/api into dist/
pnpm simulate             # runs the extraction prompt on sample messages (needs ANTHROPIC_API_KEY)
pnpm locales:translate    # regenerates machine-translated locales with Claude (--force to redo all)
pnpm db:generate          # new SQL migration after changing packages/core/src/db/schema.ts
```

## Bot commands

| Command | What it does |
|---|---|
| `/summary` `[last \| YYYY-MM]` | Month overview by category, compared with the previous month, with insights and tips |
| `/last` | Last 10 records |
| `/undo` | Delete the last record |
| `/reminders` | Open reminders |
| `/payments` | Recurring payments and their next due dates |
| `/plans` | Planned expenses, overdue ones marked |
| `/budgets` | Monthly limits per category with this month's usage; 🗑 buttons remove them |
| `/goals` | Savings goals: progress, deadline, monthly pace |
| `/settings` | Currency, timezone, language, default reminder time (inline buttons); also `/currency EUR`, `/timezone Europe/Berlin`, `/language ru` |
| `/keywords` `[add \| remove words]` | Trigger words for this chat |
| `/help` | Examples |

## Configuration

See [.env.example](.env.example). Highlights:

| Variable | Notes |
|---|---|
| `BOT_MODE` | `polling` for local dev, `webhook` in production (`WEBHOOK_URL`, `WEBHOOK_SECRET`) |
| `DATABASE_URL` | Postgres connection string. Empty → embedded PGlite in `PGLITE_DIR` (dev only) |
| `AI_EXTRACT_MODEL` / `AI_INSIGHTS_MODEL` | `claude-haiku-5-5` for parsing (≈ $0.0002 per message), `claude-opus-5-5` for insights |
| `DEFAULT_LOCALE` / `DEFAULT_CURRENCY` / `DEFAULT_TIMEZONE` | Defaults for new chats; languages tied to one country (uz, kk, tr, de, …) override currency and timezone automatically |
| `INTERNAL_TOKEN` | Enables `POST /internal/tick` for an external cron on scale-to-zero hosts |
| `TELEGRAM_PROXY` | Optional HTTP(S) proxy for the Telegram API. Without it the bot still survives DNS filtering: if the system resolver answers `api.telegram.org` with a private IP, it resolves through DNS-over-HTTPS automatically |
| `DASHBOARD_URL` / `DASHBOARD_TME_LINK` | Adds the "Open dashboard" button once the Mini App exists |

## Deployment

See [docs/DEPLOY.md](docs/DEPLOY.md) for Google Cloud Run + Cloud SQL (recommended) and the generic Docker setup. `docker-compose.yml` runs Postgres + bot + API locally.

## Roadmap

1. **Stage 1 (this repo):** bot, parsing, confirmations, corrections, reminders, recurring payments, text summary, API.
2. **Stage 2:** Mini App dashboard (`apps/dashboard`): categories, month-over-month comparison, upcoming bills, insights.
3. **Stage 3:** public launch: onboarding, Telegram Stars subscription, free-tier limits, voice messages, receipts.

## Testing strategy

* `packages/core`: pure-function tests (triggers, money, dates, summary math, initData signatures) and integration tests against an in-memory PGlite with real migrations.
* `apps/bot`: end-to-end flow tests drive the real grammY bot with a fake Telegram API transformer and a mocked extractor: welcome, expense confirmation, pending → confirm, reply corrections, reminders, recurring payments, payment done, planned expenses (date by reply, plan alert, paid button), limits, savings goals, summary, undo, settings.
* Prompts are exercised against the live model with `pnpm simulate`.
