#!/usr/bin/env bash
# Copies the working tree to the server and rebuilds the bot there.
#   deploy/deploy.sh            # deploy
#   deploy/deploy.sh logs       # follow bot logs
#   deploy/deploy.sh status     # containers and health
# Needs the "madat" host in ~/.ssh/config. The server's .env is never overwritten.
set -euo pipefail
HOST="${MADAT_HOST:-madat}"
DIR=/opt/madat
COMPOSE="docker compose --env-file $DIR/.env -f $DIR/deploy/compose.prod.yml"
cd "$(dirname "$0")/.."

case "${1:-deploy}" in
  logs) exec ssh -t "$HOST" "$COMPOSE logs -f --tail=100 bot" ;;
  status) exec ssh "$HOST" "$COMPOSE ps" ;;
  deploy)
    rsync -az --delete \
      --exclude node_modules --exclude '**/node_modules' --exclude '**/dist' \
      --exclude .git --exclude data --exclude .env --exclude '.env.*' \
      ./ "$HOST:$DIR/"
    ssh "$HOST" "set -e
      install -m 755 $DIR/deploy/backup.sh /usr/local/bin/madat-backup
      echo '30 3 * * * root /usr/local/bin/madat-backup >> /var/log/madat-backup.log 2>&1' > /etc/cron.d/madat-backup
      $COMPOSE up -d --build --remove-orphans
      docker image prune -f >/dev/null
      $COMPOSE ps"
    ;;
  *) echo "usage: $0 [deploy|logs|status]" >&2; exit 1 ;;
esac
