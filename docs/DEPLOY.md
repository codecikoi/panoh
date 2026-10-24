# Deployment

Both apps are stateless Node services (one bundled `dist/index.js` each) that need Postgres and the environment from `.env.example`. Any container host works; the recommended setup is Google Cloud Run + Cloud SQL.

## Google Cloud Run + Cloud SQL (recommended)

Why: HTTPS endpoints out of the box (webhook + API), managed Postgres with backups, scale-to-zero pricing (a family bot costs a few dollars a month), and everything in one console.

```bash
PROJECT=my-madat REGION=europe-west1
gcloud config set project $PROJECT

# 1. Postgres
gcloud sql instances create madat-db --database-version=POSTGRES_16 --tier=db-f1-micro --region=$REGION
gcloud sql databases create madat --instance=madat-db
gcloud sql users create madat --instance=madat-db --password='STRONG_PASSWORD'

# 2. Secrets
printf '%s' "$BOT_TOKEN" | gcloud secrets create BOT_TOKEN --data-file=-
printf '%s' "$ANTHROPIC_API_KEY" | gcloud secrets create ANTHROPIC_API_KEY --data-file=-
printf '%s' "postgres://madat:STRONG_PASSWORD@localhost/madat?host=/cloudsql/$PROJECT:$REGION:madat-db" | gcloud secrets create DATABASE_URL --data-file=-

# 3. Bot (webhook mode). Build from the repo root so the Dockerfile sees the workspace.
gcloud run deploy madat-bot --source . --region=$REGION \
  --add-cloudsql-instances=$PROJECT:$REGION:madat-db \
  --set-secrets=BOT_TOKEN=BOT_TOKEN:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,DATABASE_URL=DATABASE_URL:latest \
  --set-env-vars=BOT_MODE=webhook,WEBHOOK_SECRET=change-me,INTERNAL_TOKEN=change-me-too,DEFAULT_LOCALE=en,DEFAULT_CURRENCY=USD,DEFAULT_TIMEZONE=UTC \
  --min-instances=0 --max-instances=2 --allow-unauthenticated
# Set WEBHOOK_URL to the service URL printed above + /telegram/webhook and redeploy (or set it in the console).

# 4. Scheduler: wake the bot every minute so reminders fire even at zero instances
gcloud scheduler jobs create http madat-tick --schedule="* * * * *" --location=$REGION \
  --uri="https://<bot-service-url>/internal/tick" --http-method=POST \
  --headers="Authorization=Bearer change-me-too"

# 5. API (for the dashboard)
gcloud run deploy madat-api --source . --region=$REGION \
  --add-cloudsql-instances=$PROJECT:$REGION:madat-db \
  --set-secrets=BOT_TOKEN=BOT_TOKEN:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,DATABASE_URL=DATABASE_URL:latest \
  --set-env-vars=DASHBOARD_ORIGIN=https://your-dashboard.example \
  --allow-unauthenticated
```

Notes:
* `--source .` uses the Dockerfile only if you point at it: pass `--dockerfile apps/bot/Dockerfile` with a recent gcloud, or build images yourself: `docker build -f apps/bot/Dockerfile -t gcr.io/$PROJECT/madat-bot .` and deploy with `--image`.
* Both services run the SQL migrations at startup (idempotent; the images ship `drizzle/`).
* Keep `--min-instances=1` on the bot if you want the in-process scheduler instead of Cloud Scheduler; both can coexist (ticks are idempotent).
* Cloud Run logs are JSON lines from the app, so `severity` filtering works out of the box.

## Generic Docker / VPS (what runs in production now)

One small VPS (1 vCPU, 2 GB RAM) runs Postgres and the bot with `docker compose`; the bot uses long polling, so nothing needs to be reachable from the internet except SSH.

1. Ubuntu LTS, Docker (`curl -fsSL https://get.docker.com | sh`), `ufw allow OpenSSH && ufw enable`, SSH keys only.
2. Add the server to `~/.ssh/config` as host `madat` (or set `MADAT_HOST`).
3. Create `/opt/madat/.env` on the server (mode 600) with `BOT_TOKEN`, `ANTHROPIC_API_KEY`, `DEFAULT_LOCALE`, `DEFAULT_CURRENCY`, `DEFAULT_TIMEZONE` and a random `POSTGRES_PASSWORD` (hex, so it needs no URL escaping).
4. `deploy/deploy.sh` copies the working tree to `/opt/madat`, installs the daily backup cron and runs `docker compose -f deploy/compose.prod.yml up -d --build`. `deploy/deploy.sh logs` / `status` for operations.
5. Backups: `deploy/backup.sh` dumps the database daily to `/var/backups/madat` (14 days). Copy them off the server as well.

The bot image includes headless Chromium and Noto fonts for the PDF reports (about 1.7 GB); `CHROMIUM_PATH` points at it. Locally the bot finds Google Chrome or Chromium by itself.

Stop any other running instance of the bot first: Telegram delivers updates to one poller only.

## Health and operations

* `GET /health` on both services.
* `POST /internal/tick` (Bearer `INTERNAL_TOKEN`) runs one scheduler pass.
* The bot logs a warning at start when Telegram privacy mode is still enabled (`can_read_all_group_messages: false`).
* Exchange rates refresh once a day; if the rate service is unreachable, amounts in other currencies stay visible as "not converted".
