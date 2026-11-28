#!/usr/bin/env bash
# Reloads the MySQL seed data, so "upcoming" stays are upcoming again relative to TODAY.
# (The seed dates are relative to the day the SQL runs; an old volume's dates drift into the past.)
# Run from anywhere:   infra/seed/reseed.sh
# It empties the seeded tables and reloads them. Anything created since (new bookings...) is lost.
set -euo pipefail
cd "$(dirname "$0")/.."
SQL_FILE="mysql/03_seed.sql"
if docker compose ps --status running mysql 2>/dev/null | grep -q mysql; then
  docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < "$SQL_FILE"
  echo "Seed reloaded into the Docker MySQL."
else
  : "${MYSQL_HOST:=127.0.0.1}" "${MYSQL_PORT:=3306}" "${MYSQL_USER:=xenia}" "${MYSQL_PASSWORD:=xenia}" "${MYSQL_DATABASE:=xenia}"
  mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < "$SQL_FILE"
  echo "Seed reloaded into $MYSQL_HOST:$MYSQL_PORT/$MYSQL_DATABASE."
fi
