#!/usr/bin/env bash
# ローカルのPostgreSQLを一時的に起動し、シムとマイグレーションを適用する（DBテスト用）
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PGDATA="${PGDATA:-$PWD/.pgtest/data}"
PORT="${PGTEST_PORT:-54329}"
RUN=()
if [ "$(id -u)" = "0" ]; then RUN=(runuser -u postgres --); fi
case "${1:-start}" in
  start)
    if [ ! -d "$PGDATA" ]; then
      mkdir -p "$PGDATA"
      if [ "$(id -u)" = "0" ]; then chown -R postgres "$(dirname "$PGDATA")"; fi
      "${RUN[@]}" "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
    fi
    if ! "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
      "${RUN[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$PGDATA/../pg.log" -w start >/dev/null
    fi
    echo "postgres://postgres@127.0.0.1:$PORT/postgres"
    ;;
  stop)
    "${RUN[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null || true
    ;;
esac
